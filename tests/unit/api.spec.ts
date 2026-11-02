/**
 * Dashboard API tests: snapshot shape, loopback enforcement, and control
 * action dispatch through the service facade.
 * @module dsh-a2a/tests/unit/api.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from '../../src/api.ts'
import type { A2AServiceImpl } from '../../src/service.ts'
import type { UpdateChecker, UpdateInfo } from '../../src/update.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { EventEmitter } from 'node:events'

/** A structural request whose socket carries a remote address. */
function reqWith(remoteAddress: string | undefined, method = 'GET', body = '', url = '/a2a/api'): IncomingMessage & { body?: string } {
  const req = new EventEmitter() as IncomingMessage & { body?: string }
  req.method = method
  req.url = url
  req.headers = {}
  req.socket = { remoteAddress, remotePort: 12345 } as unknown as IncomingMessage['socket']
  req.body = body
  const read = (req as unknown as { on: (e: string, cb: (c: Buffer) => void) => void }).on.bind(req)
  ;(req as unknown as { on: (e: string, cb: (c: Buffer | string) => void) => void }).on = (e: string, cb: (c: Buffer | string) => void) => {
    if (e === 'data' && body.length > 0) setImmediate(() => cb(Buffer.from(body)))
    if (e === 'end') setImmediate(() => cb(''))
    return read(e, cb as (c: Buffer) => void)
  }
  return req
}

function resCollector() {
  let status = 0
  let headers: Record<string, string> = {}
  let body = ''
  const res = {
    writeHead(s: number, h?: Record<string, string>) {
      status = s
      headers = h ?? {}
    },
    end(text?: string) {
      body = text ?? ''
    },
    output: () => ({ status, headers, body }),
  } as unknown as ServerResponse & { output(): { status: number; headers: Record<string, string>; body: string } }
  return res
}

function facadeStub(overrides: Partial<A2AServiceImpl> = {}): A2AServiceImpl {  return {
    status: () => ({ inbounds: [], outbounds: [], tasks: 0, peers: [] }),
    presets: vi.fn(async () => []),
    models: vi.fn(async () => []),
    tools: vi.fn(async () => []),
    modelDiagnostics: vi.fn(async () => ({})),
    settings: () => ({ mode: 'inherit' as const, effectiveBaseUrl: 'http://127.0.0.1:25675' }),
    updateSettings: vi.fn(async () => ({ ok: true, message: 'settings updated' })),
    listInboundServers: () => [],
    createInboundServer: vi.fn(async () => ({ ok: true, message: 'created', id: 'in-1' })),
    removeInboundServer: vi.fn(async () => ({ ok: true, message: 'removed' })),
    setInboundServerEnabled: vi.fn(async () => ({ ok: true, message: 'toggled' })),
    updateInboundServer: vi.fn(async () => ({ ok: true, message: 'updated' })),
    setInboundAuth: vi.fn(async () => ({ ok: true, message: 'auth set' })),
    listOutboundServers: () => [],
    createOutboundServer: vi.fn(async () => ({ ok: true, message: 'created', id: 'out-1' })),
    removeOutboundServer: vi.fn(async () => ({ ok: true, message: 'removed' })),
    setOutboundServerEnabled: vi.fn(async () => ({ ok: true, message: 'toggled' })),
    refreshOutboundServer: vi.fn(async () => ({ ok: true, message: 'refreshed' })),
    setOutboundAuth: vi.fn(async () => ({ ok: true, message: 'auth set' })),
    discoverOutbound: vi.fn(async () => ({ ok: true, message: 'discovered', preview: { name: 'remote' } })),
    updateOutboundServer: vi.fn(async () => ({ ok: true, message: 'updated' })),
    getTask: () => undefined,
    listTasks: () => ({ tasks: [], total: 0, nextOffset: null }),
    cancelTask: vi.fn(async () => ({ ok: false, message: 'nope' })),
    listSessions: () => [],
    cancelSessionTasks: vi.fn(async () => ({ ok: true, message: 'canceled' })),
    closeSession: vi.fn(async () => ({ ok: true, message: 'closed' })),
    sessionMessages: () => [],
    metrics: () => ({}),
    agentCard: () => undefined,
    sendTestMessage: vi.fn(async () => ({})),
    closeInbound: vi.fn(async () => ({ ok: true, message: 'peer closed' })),
    inbounds: () => [],
    ...overrides,
  }
}

function updateStub(overrides: Partial<UpdateInfo> = {}): UpdateChecker {
  const current = '0.4.0'
  return {
    current,
    packageName: '@hanphone/dsh-a2a',
    repoUrl: 'https://github.com/HanphoneJan/dsh-a2a',
    check: vi.fn(async (_force?: boolean): Promise<UpdateInfo> => ({
      ok: true,
      current,
      latest: current,
      hasUpdate: false,
      ahead: false,
      error: null,
      source: 'npm',
      repoUrl: 'https://github.com/HanphoneJan/dsh-a2a',
      packageName: '@hanphone/dsh-a2a',
      checkedAt: 1,
      cached: false,
      runtime: { node: 'v24.0.0', platform: 'linux', arch: 'x64', profile: 'web' },
      ...overrides,
    })),
  }
}

describe('handleApiRequest', () => {
  it('serves a snapshot on GET for loopback callers', async () => {
    const res = resCollector()
    await handleApiRequest(reqWith('127.0.0.1'), res, facadeStub())
    const out = res.output()
    expect(out.status).toBe(200)
    expect(JSON.parse(out.body).inbounds).toEqual([])
  })

  it('rejects non-loopback callers with 403', async () => {
    const res = resCollector()
    await handleApiRequest(reqWith('203.0.113.5'), res, facadeStub())
    expect(res.output().status).toBe(403)
  })

  it('serves the preset roster on GET /a2a/api/presets', async () => {
    const impl = facadeStub({ presets: vi.fn(async () => [{ id: 'ptc', name: 'PTC 模式' }]) })
    const res = resCollector()
    await handleApiRequest(reqWith('127.0.0.1', 'GET', '', '/a2a/api/presets'), res, impl)
    const out = res.output()
    expect(out.status).toBe(200)
    expect(JSON.parse(out.body)).toEqual([{ id: 'ptc', name: 'PTC 模式' }])
  })

  it('dispatches inbound.create with the supplied input', async () => {
    const impl = facadeStub()
    const res = resCollector()
    await handleApiRequest(
      reqWith('127.0.0.1', 'POST', JSON.stringify({ action: 'inbound.create', name: 'Main', description: 'd', version: '1.0.0', preset: 'ptc' })),
      res,
      impl,
    )
    expect(res.output().status).toBe(200)
    expect(impl.createInboundServer).toHaveBeenCalledWith({
      name: 'Main', description: 'd', version: '1.0.0', preset: 'ptc',
    })
  })

  it('dispatches inbound.enable/disable/remove by id', async () => {
    const impl = facadeStub()
    const res = resCollector()
    await handleApiRequest(reqWith('127.0.0.1', 'POST', JSON.stringify({ action: 'inbound.enable', id: 'in-1' })), res, impl)
    expect(impl.setInboundServerEnabled).toHaveBeenCalledWith('in-1', true)
    await handleApiRequest(reqWith('127.0.0.1', 'POST', JSON.stringify({ action: 'inbound.disable', id: 'in-1' })), res, impl)
    expect(impl.setInboundServerEnabled).toHaveBeenCalledWith('in-1', false)
    await handleApiRequest(reqWith('127.0.0.1', 'POST', JSON.stringify({ action: 'inbound.remove', id: 'in-1' })), res, impl)
    expect(impl.removeInboundServer).toHaveBeenCalledWith('in-1')
  })

  it('dispatches outbound.create with the supplied spec', async () => {
    const impl = facadeStub()
    const res = resCollector()
    await handleApiRequest(
      reqWith('127.0.0.1', 'POST', JSON.stringify({ action: 'outbound.create', name: 'remote', agentCardUrl: 'https://x/card.json', preset: 'ptc' })),
      res,
      impl,
    )
    expect(res.output().status).toBe(200)
    expect(impl.createOutboundServer).toHaveBeenCalledWith({
      name: 'remote', agentCardUrl: 'https://x/card.json', preset: 'ptc',
    })
  })

  it('dispatches inbound.setAuth with the token (and clears when empty)', async () => {
    const impl = facadeStub()
    const res = resCollector()
    await handleApiRequest(reqWith('127.0.0.1', 'POST', JSON.stringify({ action: 'inbound.setAuth', id: 'in-1', token: 'sec' })), res, impl)
    expect(impl.setInboundAuth).toHaveBeenCalledWith('in-1', 'sec')
    await handleApiRequest(reqWith('127.0.0.1', 'POST', JSON.stringify({ action: 'inbound.setAuth', id: 'in-1' })), res, impl)
    expect(impl.setInboundAuth).toHaveBeenLastCalledWith('in-1', undefined)
  })

  it('dispatches outbound.discover and outbound.update', async () => {
    const impl = facadeStub()
    const res = resCollector()
    await handleApiRequest(reqWith('127.0.0.1', 'POST', JSON.stringify({ action: 'outbound.discover', agentCardUrl: 'https://x/card.json', token: 'sec' })), res, impl)
    expect(res.output().status).toBe(200)
    expect(impl.discoverOutbound).toHaveBeenCalledWith('https://x/card.json', 'sec')
    await handleApiRequest(reqWith('127.0.0.1', 'POST', JSON.stringify({ action: 'outbound.update', id: 'out-1', name: 'n2', preset: 'ptc', timeoutMs: 5000 })), res, impl)
    expect(impl.updateOutboundServer).toHaveBeenCalledWith('out-1', { name: 'n2', preset: 'ptc', timeoutMs: 5000 })
  })

  it('returns 409 with the facade message when a control action fails', async () => {
    const impl = facadeStub({ cancelTask: vi.fn(async () => ({ ok: false, message: 'task not found' })) })
    const res = resCollector()
    await handleApiRequest(reqWith('127.0.0.1', 'POST', JSON.stringify({ action: 'task.cancel', id: 't1' })), res, impl)
    const out = res.output()
    expect(out.status).toBe(409)
    expect(JSON.parse(out.body).message).toBe('task not found')
  })

  it('dispatches inbound.close with the peer id', async () => {
    const impl = facadeStub()
    const res = resCollector()
    await handleApiRequest(reqWith('127.0.0.1', 'POST', JSON.stringify({ action: 'inbound.close', id: 'peer-1' })), res, impl)
    expect(res.output().status).toBe(200)
    expect(impl.closeInbound).toHaveBeenCalledWith('peer-1')
  })

  it('dispatches session.cancel and session.close by context id', async () => {
    const impl = facadeStub()
    const res = resCollector()
    await handleApiRequest(reqWith('127.0.0.1', 'POST', JSON.stringify({ action: 'session.cancel', id: 'ctx-1' })), res, impl)
    expect(res.output().status).toBe(200)
    expect(impl.cancelSessionTasks).toHaveBeenCalledWith('ctx-1')
    await handleApiRequest(reqWith('127.0.0.1', 'POST', JSON.stringify({ action: 'session.close', id: 'ctx-1' })), res, impl)
    expect(res.output().status).toBe(200)
    expect(impl.closeSession).toHaveBeenCalledWith('ctx-1')
  })

  it('includes inbounds/outbounds/tasks/peers/sessions in the snapshot', async () => {
    const impl = facadeStub({
      status: () => ({
        inbounds: [{ id: 'in-1' }],
        outbounds: [{ id: 'out-1' }],
        tasks: 0,
        peers: [{ id: 'p1' }],
        sessions: [{ contextId: 'c1' }],
      }),
    })
    const res = resCollector()
    await handleApiRequest(reqWith('127.0.0.1'), res, impl)
    const body = JSON.parse(res.output().body)
    expect(body.inbounds).toEqual([{ id: 'in-1' }])
    expect(body.outbounds).toEqual([{ id: 'out-1' }])
    expect(body.peers).toEqual([{ id: 'p1' }])
    expect(body.sessions).toEqual([{ contextId: 'c1' }])
  })

  it('falls back to the facade listSessions when status carries none', async () => {
    const impl = facadeStub({ status: () => ({ inbounds: [], outbounds: [], tasks: 0 }), listSessions: () => [{ contextId: 'from-facade' }] })
    const res = resCollector()
    await handleApiRequest(reqWith('127.0.0.1'), res, impl)
    expect(JSON.parse(res.output().body).sessions).toEqual([{ contextId: 'from-facade' }])
  })

  it('puts the installed plugin version in the snapshot', async () => {
    const res = resCollector()
    await handleApiRequest(reqWith('127.0.0.1'), res, facadeStub(), updateStub())
    expect(JSON.parse(res.output().body).version).toBe('0.4.0')
  })

  it('serves the update answer and forwards the explicit refresh flag', async () => {
    const update = updateStub({ latest: '0.5.0', hasUpdate: true })
    const res = resCollector()
    await handleApiRequest(reqWith('127.0.0.1', 'GET', '', '/a2a/api/update'), res, facadeStub(), update)
    expect(update.check).toHaveBeenCalledWith(false)
    expect(JSON.parse(res.output().body)).toMatchObject({ ok: true, current: '0.4.0', latest: '0.5.0', hasUpdate: true })

    const forced = resCollector()
    await handleApiRequest(reqWith('127.0.0.1', 'GET', '', '/a2a/api/update?refresh=1'), forced, facadeStub(), update)
    expect(update.check).toHaveBeenLastCalledWith(true)
  })

  it('keeps the dashboard usable when the update checker is not mounted', async () => {
    const res = resCollector()
    await handleApiRequest(reqWith('127.0.0.1', 'GET', '', '/a2a/api/update'), res, facadeStub())
    expect(res.output().status).toBe(200)
    expect(JSON.parse(res.output().body)).toMatchObject({ ok: false })
  })
})

describe('dashboard read endpoints and test console', () => {
  it('serves card, task, session and metrics reads', async () => {
    const impl = facadeStub({
      agentCard: () => ({ name: 'card' }),
      getTask: () => ({ id: 'task-1' }),
      sessionMessages: () => [{ role: 'assistant' }],
      metrics: () => ({ requests: 3 }),
    })
    const card = resCollector()
    await handleApiRequest(reqWith('127.0.0.1', 'GET', '', '/a2a/api/card?id=in-1'), card, impl)
    expect(JSON.parse(card.output().body)).toEqual({ name: 'card' })
    const task = resCollector()
    await handleApiRequest(reqWith('127.0.0.1', 'GET', '', '/a2a/api/task?id=task-1'), task, impl)
    expect(JSON.parse(task.output().body)).toEqual({ id: 'task-1' })
    const session = resCollector()
    await handleApiRequest(reqWith('127.0.0.1', 'GET', '', '/a2a/api/session?contextId=c&serverId=s'), session, impl)
    expect(JSON.parse(session.output().body)).toEqual([{ role: 'assistant' }])
    const metrics = resCollector()
    await handleApiRequest(reqWith('127.0.0.1', 'GET', '', '/a2a/api/metrics'), metrics, impl)
    expect(JSON.parse(metrics.output().body)).toEqual({ requests: 3 })
  })

  it('dispatches the inbound test console and returns the task', async () => {
    const sendTestMessage = vi.fn(async () => ({ id: 'task-test' }))
    const impl = facadeStub({ sendTestMessage })
    const res = resCollector()
    await handleApiRequest(
      reqWith('127.0.0.1', 'POST', JSON.stringify({ action: 'inbound.sendTest', id: 'in-1', text: 'hello', contextId: 'ctx' })),
      res,
      impl,
    )
    expect(sendTestMessage).toHaveBeenCalledWith('in-1', { text: 'hello', contextId: 'ctx' })
    expect(JSON.parse(res.output().body).task).toEqual({ id: 'task-test' })
  })
})
