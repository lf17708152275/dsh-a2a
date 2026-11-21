/**
 * Composition tests: boot the plugin's `apply()` on a real Cordis Context
 * with stub host services (storageDomain, webServer, tools, commands) and
 * drive the assembled multi-instance composition through the registered HTTP
 * routes: inbound-server instance CRUD/route isolation, the skill gate, the
 * `a2a/inbound-task` policy seam, and outbound connections mapping remote
 * skills to model tools.
 * @module dsh-a2a/tests/composition/composition.spec
 */

import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, Config } from '../../src/index.ts'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { InboundTaskDecision } from '../../src/events.ts'
import { a2aDomainSpec } from '../../src/server/store.ts'
import { TaskState } from '../../src/protocol.ts'

/** A minimal in-memory kv table matching the storage-domain KvTable contract. */
function fakeTable() {
  const rows = new Map<string, string>()
  return {
    get: (key: string) => rows.get(key),
    entries: () => rows.entries(),
    keys: () => rows.keys(),
    get size() {
      return rows.size
    },
    put: async (key: string, value: string) => { rows.set(key, value) },
    delete: async (key: string) => rows.delete(key),
    update: async (key: string, fn: (current: string) => string) => {
      const next = fn(rows.get(key) ?? '')
      rows.set(key, next)
      return next
    },
  }
}

/** Structural DomainFacility fake: opens the a2a domain over three kv tables. */
function fakeStorageDomain() {
  const tables = new Map<string, ReturnType<typeof fakeTable>>()
  const open = vi.fn(async () => ({
    name: 'a2a',
    table: (name: string) => {
      let table = tables.get(name)
      if (table === undefined) {
        table = fakeTable()
        tables.set(name, table)
      }
      return table
    },
    close: async () => {},
  }))
  return { open } as unknown as DomainFacility
}

interface FakeRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (...args: unknown[]) => unknown
}

function fakeWebServer() {
  const routes: FakeRoute[] = []
  const register = vi.fn((route: { kind: 'exact' | 'prefix'; path: string; handler(...args: unknown[]): unknown }) => {
    routes.push(route)
    return () => {
      const index = routes.indexOf(route as unknown as FakeRoute)
      if (index >= 0) routes.splice(index, 1)
    }
  })
  return { register, routes }
}

function fakeTools() {
  const tools = new Map<string, { name: string; description?: string }>()
  const registered: unknown[] = []
  const register = vi.fn((def: unknown) => {
    const d = def as { name: string }
    registered.push(def)
    const dispose = () => registered.splice(registered.indexOf(def), 1)
    tools.set(d.name, { name: d.name })
    return dispose
  })
  return { get: (name: string) => tools.get(name), register, registered }
}

function fakeCommands() {
  const definitions: Array<{ name: string }> = []
  const register = vi.fn((def: { name: string }) => {
    definitions.push(def)
    return () => {
      const index = definitions.indexOf(def)
      if (index >= 0) definitions.splice(index, 1)
    }
  })
  return { register, definitions }
}

/** Fake HTTP request/responses so a registered route handler is exercisable. */
function invoke(route: FakeRoute, body: string, url = '/a2a', headers: Record<string, string> = {}) {
  const req = new EventEmitter() as EventEmitter & {
    method?: string
    url?: string
    headers: Record<string, string>
    socket?: { remoteAddress?: string; remotePort?: number }
  }
  req.method = 'POST'
  req.url = url
  req.headers = { 'content-type': 'application/json', accept: 'application/json', ...headers }
  const chunks: Buffer[] = []
  let sent: { status: number; headers: Record<string, string>; body: string } | undefined
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      sent = { status, headers, body: '' }
    },
    write(chunk: string) {
      if (sent) sent.body += chunk
      else chunks.push(Buffer.from(chunk))
    },
    end(chunk?: string) {
      if (chunk && sent !== undefined) sent.body += chunk
    },
  }
  // Deliver the request body after the handler subscribes.
  setImmediate(() => {
    req.emit('data', Buffer.from(body))
    req.emit('end')
  })
  const result = (route.handler as (r: typeof req, s: typeof res) => unknown)(req as never, res as never)
  return {
    result,
    response: () => sent,
    unavailable: () => chunks,
  }
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map((ctx) => ctx.fiber.dispose()))
})

function harness(config: ReturnType<typeof Config> = Config()) {
  const ctx = new Context()
  contexts.push(ctx)
  const storageDomain = fakeStorageDomain()
  const webServer = fakeWebServer()
  const tools = fakeTools()
  const commands = fakeCommands()
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('webServer', webServer as never)
  ctx.provide('tools', tools as never)
  ctx.provide('commands', commands as never)
  apply(ctx, config)
  return { ctx, storageDomain, webServer, tools, commands }
}

async function waitForFacade(ctx: Context): Promise<void> {
  await vi.waitFor(() => {
    expect(ctx.a2a).toBeDefined()
  })
}

async function sendMessage(ctx: Context, webServer: ReturnType<typeof fakeWebServer>, endpoint: string, text: string, skill?: string, id = 1, messageId = 'm1') {
  const route = webServer.routes.find((r) => r.path === endpoint && r.kind === 'prefix')!
  const { response } = invoke(route, JSON.stringify({
    jsonrpc: '2.0', id, method: 'SendMessage',
    params: { message: { messageId, role: 'user', parts: [{ text }], ...(skill !== undefined ? { metadata: { skill } } : {}) } },
  }), endpoint)
  await vi.waitFor(() => expect(response()).toBeDefined())
  return JSON.parse(response()!.body)
}

/** SendMessage variant carrying an explicit contextId (drives the session layer). */
function sendWithContext(route: { readonly kind: 'exact' | 'prefix'; readonly path: string; readonly handler: (...args: unknown[]) => unknown }, contextId: string, text: string, id = 10) {
  // url comes from the route's own path (the registered endpoint).
  return invoke(route, JSON.stringify({
    jsonrpc: '2.0', id, method: 'SendMessage',
    params: { message: { messageId: `mc-${id}`, role: 'user', parts: [{ text }], contextId } },
  }), route.path)
}

/**
 * Minimal agent registry stub: sessions reply instantly by default, or hang on
 * an externally released `whenIdle` (to hold tasks in WORKING for cancel
 * tests). Records every create call to observe close→reopen behavior.
 */
function fakeAgents() {
  const creates: string[] = []
  let hang = false
  const releases: Array<() => void> = []
  const create = vi.fn(async (opts: { sessionId: string }) => {
    creates.push(opts.sessionId)
    const history: Array<{ role: 'user' | 'assistant'; content: Array<{ type: string; text?: string }> }> = []
    const agent = {
      session: { deriveMessages: () => history },
      send: (message: { content: readonly { type: string; text?: string }[] }) => {
        const text = message.content.map((b) => b.text ?? '').join('\n')
        history.push({ role: 'user' as const, content: [{ type: 'text', text }] })
        history.push({ role: 'assistant' as const, content: [{ type: 'text', text: `hi from agent: ${text}` }] })
      },
      whenIdle: hang
        ? () => new Promise<void>((resolve) => { releases.push(resolve) })
        : async () => {},
      cancel: () => {},
    }
    return { agent, dispose: async () => {} }
  })
  return {
    create,
    creates,
    releaseAll: () => { for (const resolve of releases.splice(0)) resolve() },
    setHang: (value: boolean) => { hang = value },
  }
}

describe('plugin composition (multi-instance)', () => {
  it('boots with no instances and registers the dashboard api', async () => {
    const { ctx, webServer, commands } = harness()
    await waitForFacade(ctx)
    expect(commands.definitions.some((d) => d.name === 'a2a')).toBe(true)
    expect(ctx.a2a.listInboundServers()).toEqual([])
    expect(ctx.a2a.listOutboundServers()).toEqual([])
    expect(webServer.routes.map((r) => r.path)).toEqual(['/a2a/api'])
  })

  it('creates inbound instances with independent endpoints and cards', async () => {
    const { ctx, webServer } = harness()
    await waitForFacade(ctx)
    const created = await ctx.a2a.createInboundServer({ name: 'Main', description: 'main', version: '1.0.0' })
    expect(created.ok).toBe(true)
    const views = ctx.a2a.listInboundServers() as Array<{ id: string; endpointPath: string; cardPath: string; enabled: boolean; skills: Array<{ id: string; name: string }> }>
    expect(views).toHaveLength(1)
    const id = views[0]!.id
    expect(views[0]!.endpointPath).toBe(`/a2a/${id}`)
    expect(views[0]!.cardPath).toBe(`/a2a/${id}/agent-card.json`)
    expect(views[0]!.enabled).toBe(true)
    // Declared skills default to the chat skill with no preset bound.
    expect(views[0]!.skills.map((s) => s.name)).toEqual(['chat'])
    expect(webServer.routes.map((r) => r.path)).toEqual(['/a2a/api', `/a2a/${id}/agent-card.json`, `/a2a/${id}`])
  })

  it('rejects a SendMessage for a skill outside the declared list', async () => {
    const { ctx, webServer } = harness()
    await waitForFacade(ctx)
    await ctx.a2a.createInboundServer({ name: 'Main', description: 'main', version: '1.0.0' })
    const view = ctx.a2a.listInboundServers()[0] as { endpointPath: string }
    const body = await sendMessage(ctx, webServer, view.endpointPath, 'run rm -rf', 'coding')
    expect(body.error.code).toBe(-32602)
    expect(body.error.message).toMatch(/unknown skill/)
  })

  it('lets a policy listener veto a chat task through a2a/inbound-task', async () => {
    const { ctx, webServer } = harness()
    await waitForFacade(ctx)
    ctx.on('a2a/inbound-task', (decision: InboundTaskDecision, next) => {
      if (decision.parts.some((p) => 'text' in p && /veto/i.test(p.text ?? ''))) {
        decision.rejected = { reason: 'vetoed by policy' }
      }
      return next()
    })
    await ctx.a2a.createInboundServer({ name: 'Main', description: 'main', version: '1.0.0' })
    const view = ctx.a2a.listInboundServers()[0] as { endpointPath: string }
    const body = await sendMessage(ctx, webServer, view.endpointPath, 'please veto this')
    expect(body.error.message).toMatch(/vetoed by policy/)
  })

  it('settles an accepted chat task and persists it in the domain store', async () => {
    const { ctx, webServer, storageDomain } = harness()
    await waitForFacade(ctx)
    await ctx.a2a.createInboundServer({ name: 'Main', description: 'main', version: '1.0.0' })
    const view = ctx.a2a.listInboundServers()[0] as { endpointPath: string }
    const body = await sendMessage(ctx, webServer, view.endpointPath, 'hello')
    const task = body.result.task
    expect(task.status.state).toBe('TASK_STATE_FAILED') // no agent loop: readable refusal
    expect(task.status.message.parts[0].text).toMatch(/refusing inbound task/)
    expect((await ctx.a2a.listTasks() as { tasks: unknown[] }).tasks.length).toBe(1)
    expect((storageDomain.open as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  it('isolates two inbound instances end to end (independent tasks)', async () => {
    const { ctx, webServer } = harness()
    await waitForFacade(ctx)
    await ctx.a2a.createInboundServer({ name: 'First', description: 'a', version: '1.0.0' })
    await ctx.a2a.createInboundServer({ name: 'Second', description: 'b', version: '1.0.0' })
    const views = ctx.a2a.listInboundServers() as Array<{ endpointPath: string }>
    expect(views).toHaveLength(2)
    const body1 = await sendMessage(ctx, webServer, views[0]!.endpointPath, 'one', undefined, 1, 'ma')
    const body2 = await sendMessage(ctx, webServer, views[1]!.endpointPath, 'two', undefined, 2, 'mb')
    expect(body1.result.task.id).not.toBe(body2.result.task.id)
    expect((await ctx.a2a.listTasks() as { tasks: unknown[] }).tasks.length).toBe(2)
  })

  it('removes an inbound instance and unregisters its routes', async () => {
    const { ctx, webServer } = harness()
    await waitForFacade(ctx)
    await ctx.a2a.createInboundServer({ name: 'Main', description: 'main', version: '1.0.0' })
    const view = ctx.a2a.listInboundServers()[0] as { id: string }
    await ctx.a2a.removeInboundServer(view.id)
    expect(ctx.a2a.listInboundServers()).toEqual([])
    expect(webServer.routes.map((r) => r.path)).toEqual(['/a2a/api'])
  })

  it('creates an outbound instance and maps its remote skills to model tools', async () => {
    const card = {
      name: 'remote', description: 'Remote agent', version: '1.0.0',
      supportedInterfaces: [{ url: 'https://remote.example/a2a', protocolBinding: 'JSONRPC' }],
      skills: [{ id: 'chat' }],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(card), { status: 200 })))
    try {
      const { ctx, tools } = harness()
      await waitForFacade(ctx)
      const created = await ctx.a2a.createOutboundServer({ name: 'remote-1', agentCardUrl: 'https://remote.example/card.json', timeoutMs: 1000 })
      expect(created.ok).toBe(true)
      const views = ctx.a2a.listOutboundServers() as Array<{ name: string; state: string; skillCount: number }>
      expect(views).toHaveLength(1)
      expect(views[0]!.state).toBe('connected')
      expect(views[0]!.skillCount).toBe(1)
      // The remote skill becomes a model tool on the tools registry.
      await vi.waitFor(() => {
        expect(tools.get('a2a__remote-1__chat')).toBeDefined()
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports the agent-preset roster for the GUI pickers (empty without the service)', async () => {
    const { ctx } = harness()
    await waitForFacade(ctx)
    expect(await ctx.a2a.presets()).toEqual([])
  })

  it('surfaces per-context sessions with an agent loop and persists the binding', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const storageDomain = fakeStorageDomain()
    const webServer = fakeWebServer()
    const tools = fakeTools()
    const commands = fakeCommands()
    const agents = fakeAgents()
    ctx.provide('storageDomain', storageDomain)
    ctx.provide('webServer', webServer as never)
    ctx.provide('tools', tools as never)
    ctx.provide('commands', commands as never)
    ctx.provide('agents', agents as never)
    apply(ctx, Config())
    await waitForFacade(ctx)

    const created = await ctx.a2a.createInboundServer({ name: 'Main', description: 'main', version: '1.0.0', enabled: true })
    expect(created.ok).toBe(true)
    const id = (ctx.a2a.listInboundServers() as Array<{ id: string }>)[0]!.id
    const route = webServer.routes.find((r) => r.path === `/a2a/${id}` && r.kind === 'prefix')!

    const contextId = 'ctx-fixed'
    // The hang-less fake replies immediately: task completes with the reply text.
    const first = await (async () => {
      const pending = sendWithContext(route, contextId, 'hello')
      const [result] = await Promise.all([pending.result, vi.waitFor(() => { expect(pending.response()).toBeDefined() })])
      await result
      return JSON.parse(pending.response()!.body)
    })()
    expect(first.result.task.status.state).toBe(TaskState.COMPLETED)

    // The session view aggregates one row per contextId with live pool info.
    let sessions = ctx.a2a.listSessions()
    expect(sessions).toHaveLength(1)
    const view = sessions[0]!
    expect(view.contextId).toBe(contextId)
    expect(view.sessionId).toBe(`a2a-${id}-${contextId}`)
    expect(view.serverId).toBe(id)
    expect(view.serverName).toBe('Main')
    expect(view.status).toBe('idle')
    expect(view.taskCount).toBe(1)
    expect(view.activeCount).toBe(0)
    expect(view.live).toBe(true)
    expect(view.streaming).toBe(false)

    // The first open persisted the contextId → sessionId binding durably
    // (write-chain visible through the domain's own handle).
    const handle = await (storageDomain.open as ReturnType<typeof vi.fn>)(a2aDomainSpec)
    const contextsTable = (handle as { table(name: string): { get(key: string): string | undefined } }).table('contexts')
    expect(JSON.parse(contextsTable.get(`ctx:${id}:${contextId}`)!)).toEqual({ sessionId: `a2a-${id}-${contextId}` })

    // The view also degrades after close: row remains (task history) but no handle.
    await ctx.a2a.closeSession(contextId)
    sessions = ctx.a2a.listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.live).toBe(false)
    expect(sessions[0]!.activeCount).toBe(0)
  })

  it('cancels a context\'s active tasks and reopens the session on the next task', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const storageDomain = fakeStorageDomain()
    const webServer = fakeWebServer()
    const tools = fakeTools()
    const commands = fakeCommands()
    const agents = fakeAgents()
    agents.setHang(true)
    ctx.provide('storageDomain', storageDomain)
    ctx.provide('webServer', webServer as never)
    ctx.provide('tools', tools as never)
    ctx.provide('commands', commands as never)
    ctx.provide('agents', agents as never)
    apply(ctx, Config())
    await waitForFacade(ctx)

    const created = await ctx.a2a.createInboundServer({ name: 'Main', description: 'main', version: '1.0.0', enabled: true })
    expect(created.ok).toBe(true)
    const id = (ctx.a2a.listInboundServers() as Array<{ id: string }>)[0]!.id
    const route = webServer.routes.find((r) => r.path === `/a2a/${id}` && r.kind === 'prefix')!
    const contextId = 'ctx-live'

    // Fire the message; the hanging whenIdle keeps the task WORKING.
    const pending = sendWithContext(route, contextId, 'work')
    const tasks = () => ctx.a2a.listTasks().tasks as Array<{ taskId: string; contextId: string; state: string }>
    await vi.waitFor(() => {
      expect(tasks().some((t) => t.contextId === contextId && t.state === TaskState.WORKING)).toBe(true)
    })
    let sessions = ctx.a2a.listSessions()
    expect(sessions[0]!.status).toBe('running')
    expect(sessions[0]!.activeCount).toBe(1)

    // Cancel-all aborts the context's active tasks; the session stays open.
    const cancel = await ctx.a2a.cancelSessionTasks(contextId)
    expect(cancel.ok).toBe(true)
    expect(cancel.message).toMatch(/canceled 1 active task/)
    const canceledTask = tasks().find((t) => t.contextId === contextId)!
    expect(canceledTask.state).toBe(TaskState.CANCELED)
    sessions = ctx.a2a.listSessions()
    expect(sessions[0]!.status).toBe('idle')
    expect(sessions[0]!.activeCount).toBe(0)
    expect(sessions[0]!.live).toBe(true)

    // Close disposes the handle; the next task reopens a fresh one.
    await ctx.a2a.closeSession(contextId)
    sessions = ctx.a2a.listSessions()
    expect(sessions[0]!.live).toBe(false)

    // Release the drained turn so the first response finishes cleanly.
    agents.releaseAll()
    await pending.result

    expect(agents.creates).toEqual([`a2a-${id}-${contextId}`])
    // The next task reopens a fresh handle; un-hang so it can settle.
    agents.setHang(false)
    const again = await (async () => {
      const second = sendWithContext(route, contextId, 'again', 11)
      await vi.waitFor(() => expect(second.response()).toBeDefined())
      return JSON.parse(second.response()!.body)
    })()
    expect(again.result.task.status.state).toBe(TaskState.COMPLETED)
    // A second open ⇒ a second create (close is a release, not a tombstone).
    expect(agents.creates).toEqual([`a2a-${id}-${contextId}`, `a2a-${id}-${contextId}`])
    sessions = ctx.a2a.listSessions()
    expect(sessions[0]!.live).toBe(true)
    expect(sessions[0]!.taskCount).toBe(2)
  })
})
describe('inbound authorization scope', () => {
  it('does not expose one instance\'s tasks through another token', async () => {
    process.env['A2A_TEST_SCOPE_A'] = 'token-a'
    process.env['A2A_TEST_SCOPE_B'] = 'token-b'
    const { ctx, webServer } = harness()
    await waitForFacade(ctx)
    await ctx.a2a.createInboundServer({ name: 'A', description: 'a', version: '1.0.0', authTokenEnv: 'A2A_TEST_SCOPE_A' })
    await ctx.a2a.createInboundServer({ name: 'B', description: 'b', version: '1.0.0', authTokenEnv: 'A2A_TEST_SCOPE_B' })
    const views = ctx.a2a.listInboundServers() as Array<{ id: string; endpointPath: string }>
    const a = views[0]!
    const b = views[1]!
    const routeA = webServer.routes.find((r) => r.path === a.endpointPath && r.kind === 'prefix')!
    const routeB = webServer.routes.find((r) => r.path === b.endpointPath && r.kind === 'prefix')!

    const sent = invoke(routeB, JSON.stringify({
      jsonrpc: '2.0', id: 50, method: 'SendMessage',
      params: { message: { messageId: 'scope-b', role: 'user', contextId: 'shared-context', parts: [{ text: 'secret' }] } },
    }), b.endpointPath, { authorization: 'Bearer token-b' })
    await vi.waitFor(() => expect(sent.response()).toBeDefined())
    const taskId = JSON.parse(sent.response()!.body).result.task.id as string

    const listed = invoke(routeA, JSON.stringify({ jsonrpc: '2.0', id: 51, method: 'ListTasks', params: {} }), a.endpointPath, { authorization: 'Bearer token-a' })
    await vi.waitFor(() => expect(listed.response()).toBeDefined())
    expect(JSON.parse(listed.response()!.body).result.tasks).toEqual([])

    const got = invoke(routeA, JSON.stringify({ jsonrpc: '2.0', id: 52, method: 'GetTask', params: { id: taskId } }), a.endpointPath, { authorization: 'Bearer token-a' })
    await vi.waitFor(() => expect(got.response()).toBeDefined())
    expect(JSON.parse(got.response()!.body).error.code).toBe(-32001)

    const owner = invoke(routeB, JSON.stringify({ jsonrpc: '2.0', id: 53, method: 'GetTask', params: { id: taskId } }), b.endpointPath, { authorization: 'Bearer token-b' })
    await vi.waitFor(() => expect(owner.response()).toBeDefined())
    expect(JSON.parse(owner.response()!.body).result.id).toBe(taskId)

    // The same client-chosen contextId remains two separate sessions because
    // the instance id namespaces both the task scope and the derived session.
    const sentA = invoke(routeA, JSON.stringify({
      jsonrpc: '2.0', id: 54, method: 'SendMessage',
      params: { message: { messageId: 'scope-a', role: 'user', contextId: 'shared-context', parts: [{ text: 'a' }] } },
    }), a.endpointPath, { authorization: 'Bearer token-a' })
    await vi.waitFor(() => expect(sentA.response()).toBeDefined())
    const sessions = ctx.a2a.listSessions().filter((session) => session.contextId === 'shared-context')
    expect(sessions).toHaveLength(2)
    expect(new Set(sessions.map((session) => session.sessionId)).size).toBe(2)
  })
})
