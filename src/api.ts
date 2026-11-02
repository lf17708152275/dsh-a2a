/**
 * GUI control API for the A2A settings dashboard: one `GET /a2a/api`
 * snapshot plus `POST /a2a/api` control actions (inbound/outbound server
 * CRUD + enable/disable, task view/cancel, test console, session conversation)
 * and focused GET endpoints for an AgentCard, one task, one conversation, and
 * metrics. The browser half talks only to this route; it carries no protocol
 * knowledge. Loopback-only by default so the dashboard cannot be driven from
 * the wire.
 *
 * The route body is bound to the same `A2AServiceImpl` facade the `/a2a`
 * command surface uses, so GUI actions and commands cannot disagree.
 * @module dsh-a2a/api
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { A2AServiceImpl } from './service.ts'
import type { UpdateChecker } from './update.ts'

/** Control actions the dashboard can issue. */
export type ApiAction =
  | { readonly action: 'inbound.create'; readonly name: string; readonly description: string; readonly version: string; readonly endpointPath?: string; readonly preset?: string; readonly authTokenEnv?: string; readonly trace?: boolean; readonly enabled?: boolean; readonly workspace?: string; readonly provider?: string; readonly model?: string; readonly toolAllow?: readonly string[]; readonly baseUrl?: string }
  | { readonly action: 'inbound.remove' | 'inbound.enable' | 'inbound.disable' | 'inbound.update'; readonly id: string; readonly name?: string; readonly description?: string; readonly version?: string; readonly endpointPath?: string; readonly preset?: string; readonly authTokenEnv?: string; readonly trace?: boolean; readonly workspace?: string; readonly provider?: string; readonly model?: string; readonly toolAllow?: readonly string[]; readonly baseUrl?: string }
  | { readonly action: 'inbound.setAuth'; readonly id: string; readonly token?: string }
  | { readonly action: 'inbound.sendTest'; readonly id: string; readonly text: string; readonly contextId?: string; readonly skill?: string }
  | { readonly action: 'outbound.create'; readonly name: string; readonly agentCardUrl: string; readonly bearerTokenEnv?: string; readonly preset?: string; readonly enabled?: boolean; readonly timeoutMs?: number; readonly disabledSkills?: readonly string[]; readonly skillOverrides?: Readonly<Record<string, { readonly name?: string; readonly description?: string }>> }
  | { readonly action: 'outbound.remove' | 'outbound.enable' | 'outbound.disable' | 'outbound.refresh'; readonly id: string }
  | { readonly action: 'outbound.setAuth'; readonly id: string; readonly token?: string }
  | { readonly action: 'outbound.discover'; readonly agentCardUrl: string; readonly token?: string }
  | { readonly action: 'outbound.update'; readonly id: string; readonly name?: string; readonly preset?: string; readonly timeoutMs?: number; readonly disabledSkills?: readonly string[]; readonly skillOverrides?: Readonly<Record<string, { readonly name?: string; readonly description?: string }>> }
  | { readonly action: 'task.cancel'; readonly id: string }
  | { readonly action: 'inbound.close'; readonly id: string }
  | { readonly action: 'session.cancel' | 'session.close'; readonly id: string; readonly serverId?: string }
  | { readonly action: 'settings.update'; readonly baseUrl?: string }

/** One snapshot of the whole plugin for the dashboard. */
export interface ApiSnapshot {
  /** Installed plugin version, shown without waiting for an update check. */
  readonly version: string
  readonly inbounds: readonly unknown[]
  readonly outbounds: readonly unknown[]
  readonly tasks: readonly unknown[]
  readonly taskTotal: number
  readonly taskNextOffset: number | null
  readonly peers: readonly unknown[]
  readonly sessions: readonly unknown[]
  readonly metrics: unknown
  /** Deployment-wide settings (advertised base URL mode/override). */
  readonly settings: unknown
}

const DEFAULT_MAX_BODY_BYTES = 1_048_576

function readBody(req: IncomingMessage, maxBytes = DEFAULT_MAX_BODY_BYTES): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > maxBytes) {
        const error = new Error('request body too large') as Error & { code: string }
        error.code = 'BODY_TOO_LARGE'
        req.resume()
        reject(error)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.once('error', reject)
  })
}

/** The caller is the local machine (never a remote peer). */
function isLoopback(req: IncomingMessage): boolean {
  const address = req.socket?.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-cache' })
  res.end(JSON.stringify(value))
}

/** Handle one dashboard API request against the service facade. */
export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  impl: A2AServiceImpl,
  update?: UpdateChecker,
): Promise<void> {
  if (!isLoopback(req)) {
    res.writeHead(403, { 'content-type': 'text/plain' })
    res.end('forbidden')
    return
  }
  const parsed = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = parsed.pathname
  if (req.method === 'GET' && path === '/a2a/api/update') {
    if (update === undefined) {
      json(res, 200, { ok: false, error: 'update checker is not mounted' })
      return
    }
    try {
      json(res, 200, await update.check(parsed.searchParams.get('refresh') === '1'))
    } catch (err) {
      // A lookup failure is a reportable result, not a broken dashboard.
      json(res, 200, { ok: false, current: update.current, latest: null, error: (err as Error).message })
    }
    return
  }
  if (req.method === 'GET' && path === '/a2a/api/presets') {
    json(res, 200, await impl.presets())
    return
  }
  if (req.method === 'GET' && path === '/a2a/api/tools') {
    json(res, 200, await impl.tools())
    return
  }
  if (req.method === 'GET' && path === '/a2a/api/models') {
    if (parsed.searchParams.get('debug') === '1') {
      json(res, 200, { models: await impl.models(), diagnostics: await impl.modelDiagnostics() })
    } else {
      json(res, 200, await impl.models())
    }
    return
  }
  if (req.method === 'GET' && path === '/a2a/api/card') {
    const id = parsed.searchParams.get('id') ?? ''
    const card = impl.agentCard(id)
    if (card === undefined) json(res, 404, { ok: false, message: `inbound server ${id} not found` })
    else json(res, 200, card)
    return
  }
  if (req.method === 'GET' && path === '/a2a/api/task') {
    const id = parsed.searchParams.get('id') ?? ''
    const task = impl.getTask(id)
    if (task === undefined) json(res, 404, { ok: false, message: `task ${id} not found` })
    else json(res, 200, task)
    return
  }
  if (req.method === 'GET' && path === '/a2a/api/session') {
    const contextId = parsed.searchParams.get('contextId') ?? ''
    const serverId = parsed.searchParams.get('serverId') ?? undefined
    try {
      json(res, 200, impl.sessionMessages(contextId, serverId))
    } catch (err) {
      json(res, 409, { ok: false, message: (err as Error).message })
    }
    return
  }
  if (req.method === 'GET' && path === '/a2a/api/metrics') {
    json(res, 200, impl.metrics())
    return
  }
  if (req.method === 'GET') {
    json(res, 200, snapshotOf(impl, parsed.searchParams, update))
    return
  }
  if (req.method === 'POST') {
    let payload: ApiAction
    try {
      payload = JSON.parse(await readBody(req)) as ApiAction
    } catch (err) {
      const tooLarge = (err as { code?: string }).code === 'BODY_TOO_LARGE'
      json(res, tooLarge ? 413 : 400, { ok: false, message: tooLarge ? 'request body too large' : 'invalid JSON body' })
      return
    }
    let result: { readonly ok: boolean; readonly message: string; readonly task?: unknown }
    try {
      result = await dispatch(payload, impl)
    } catch (err) {
      result = { ok: false, message: (err as Error).message }
    }
    json(res, result.ok ? 200 : 409, result)
    return
  }
  res.writeHead(405, { 'content-type': 'text/plain' })
  res.end('Method Not Allowed')
}

function snapshotOf(impl: A2AServiceImpl, params: URLSearchParams, update?: UpdateChecker): ApiSnapshot {
  const status = impl.status() as { inbounds: readonly unknown[]; outbounds: readonly unknown[]; tasks: number; peers?: readonly unknown[]; sessions?: readonly unknown[] }
  const limit = parsePositiveInt(params.get('taskLimit'), 50)
  const offset = parseNonNegativeInt(params.get('taskOffset'), 0)
  const state = params.get('taskState') ?? undefined
  const contextId = params.get('taskContextId') ?? undefined
  const serverId = params.get('taskServerId') ?? undefined
  const result = impl.listTasks({
    limit,
    offset,
    ...(state !== undefined && state.length > 0 ? { state } : {}),
    ...(contextId !== undefined && contextId.length > 0 ? { contextId } : {}),
    ...(serverId !== undefined && serverId.length > 0 ? { serverId } : {}),
  })
  const page = Array.isArray(result)
    ? { tasks: result, total: result.length, nextOffset: null }
    : result
  return {
    version: update?.current ?? '',
    inbounds: status.inbounds ?? [],
    outbounds: status.outbounds ?? [],
    tasks: page.tasks,
    taskTotal: page.total,
    taskNextOffset: page.nextOffset,
    // `status()` may already carry aggregated peers; fall back to the facade.
    peers: (status.peers ?? impl.inbounds()) as readonly unknown[],
    // `status()` carries the aggregated session views when mounted.
    sessions: (status.sessions ?? impl.listSessions()) as readonly unknown[],
    metrics: impl.metrics?.() ?? {},
    settings: impl.settings(),
  }
}

async function dispatch(payload: ApiAction, impl: A2AServiceImpl): Promise<{ readonly ok: boolean; readonly message: string; readonly task?: unknown }> {
  switch (payload.action) {
    case 'inbound.create':
      return impl.createInboundServer({
        name: payload.name,
        description: payload.description,
        version: payload.version,
        ...(payload.endpointPath !== undefined ? { endpointPath: payload.endpointPath } : {}),
        ...(payload.preset !== undefined ? { preset: payload.preset } : {}),
        ...(payload.authTokenEnv !== undefined ? { authTokenEnv: payload.authTokenEnv } : {}),
        ...(payload.trace !== undefined ? { trace: payload.trace } : {}),
        ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
        ...(payload.workspace !== undefined ? { workspace: payload.workspace } : {}),
        ...(payload.provider !== undefined ? { provider: payload.provider } : {}),
        ...(payload.model !== undefined ? { model: payload.model } : {}),
        ...(payload.toolAllow !== undefined ? { toolAllow: payload.toolAllow } : {}),
        ...(payload.baseUrl !== undefined ? { baseUrl: payload.baseUrl } : {}),
      })
    case 'inbound.remove':
      return impl.removeInboundServer(payload.id)
    case 'inbound.enable':
      return impl.setInboundServerEnabled(payload.id, true)
    case 'inbound.disable':
      return impl.setInboundServerEnabled(payload.id, false)
    case 'inbound.update':
      return impl.updateInboundServer(payload.id, {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        ...(payload.version !== undefined ? { version: payload.version } : {}),
        ...(payload.endpointPath !== undefined ? { endpointPath: payload.endpointPath } : {}),
        ...(payload.preset !== undefined ? { preset: payload.preset } : {}),
        ...(payload.authTokenEnv !== undefined ? { authTokenEnv: payload.authTokenEnv } : {}),
        ...(payload.trace !== undefined ? { trace: payload.trace } : {}),
        ...(payload.workspace !== undefined ? { workspace: payload.workspace } : {}),
        ...(payload.provider !== undefined ? { provider: payload.provider } : {}),
        ...(payload.model !== undefined ? { model: payload.model } : {}),
        ...(payload.toolAllow !== undefined ? { toolAllow: payload.toolAllow } : {}),
        ...(payload.baseUrl !== undefined ? { baseUrl: payload.baseUrl } : {}),
      })
    case 'inbound.setAuth':
      return impl.setInboundAuth(payload.id, payload.token !== undefined && payload.token.length > 0 ? payload.token : undefined)
    case 'inbound.sendTest':
      return {
        ok: true,
        message: 'test message submitted',
        task: await impl.sendTestMessage(payload.id, {
          text: payload.text,
          ...(payload.contextId !== undefined ? { contextId: payload.contextId } : {}),
          ...(payload.skill !== undefined ? { skill: payload.skill } : {}),
        }),
      }
    case 'settings.update':
      return impl.updateSettings(payload.baseUrl !== undefined ? { baseUrl: payload.baseUrl } : {})
    case 'outbound.create':
      return impl.createOutboundServer({
        name: payload.name,
        agentCardUrl: payload.agentCardUrl,
        ...(payload.bearerTokenEnv !== undefined ? { bearerTokenEnv: payload.bearerTokenEnv } : {}),
        ...(payload.preset !== undefined ? { preset: payload.preset } : {}),
        ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
        ...(payload.timeoutMs !== undefined ? { timeoutMs: payload.timeoutMs } : {}),
        ...(payload.disabledSkills !== undefined ? { disabledSkills: payload.disabledSkills } : {}),
        ...(payload.skillOverrides !== undefined ? { skillOverrides: payload.skillOverrides } : {}),
      })
    case 'outbound.remove':
      return impl.removeOutboundServer(payload.id)
    case 'outbound.enable':
      return impl.setOutboundServerEnabled(payload.id, true)
    case 'outbound.disable':
      return impl.setOutboundServerEnabled(payload.id, false)
    case 'outbound.refresh':
      return impl.refreshOutboundServer(payload.id)
    case 'outbound.setAuth':
      return impl.setOutboundAuth(payload.id, payload.token !== undefined && payload.token.length > 0 ? payload.token : undefined)
    case 'outbound.discover':
      return impl.discoverOutbound(payload.agentCardUrl, payload.token !== undefined && payload.token.length > 0 ? payload.token : undefined)
    case 'outbound.update':
      return impl.updateOutboundServer(payload.id, {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.preset !== undefined ? { preset: payload.preset } : {}),
        ...(payload.timeoutMs !== undefined ? { timeoutMs: payload.timeoutMs } : {}),
        ...(payload.disabledSkills !== undefined ? { disabledSkills: payload.disabledSkills } : {}),
        ...(payload.skillOverrides !== undefined ? { skillOverrides: payload.skillOverrides } : {}),
      })
    case 'task.cancel':
      return impl.cancelTask(payload.id)
    case 'inbound.close':
      return impl.closeInbound(payload.id)
    case 'session.cancel':
      return payload.serverId !== undefined
        ? impl.cancelSessionTasks(payload.id, payload.serverId)
        : impl.cancelSessionTasks(payload.id)
    case 'session.close':
      return payload.serverId !== undefined
        ? impl.closeSession(payload.id, payload.serverId)
        : impl.closeSession(payload.id)
    default:
      return { ok: false, message: `unknown action ${String((payload as { action?: unknown }).action)}` }
  }
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  const value = raw === null ? Number.NaN : Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function parseNonNegativeInt(raw: string | null, fallback: number): number {
  const value = raw === null ? Number.NaN : Number.parseInt(raw, 10)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}
