/**
 * Per-instance inbound overrides: workspace (cwd) and model selection.
 *
 * Covers the pure resolvers plus a manager round-trip proving the values are
 * validated and persisted onto the inbound record. Regression shape: removing
 * the override wiring (dropping `workspace`/`provider`/`model` from the record
 * or from the session pool options) makes these assertions fail.
 * @module dsh-a2a/tests/unit/inbound-overrides.spec
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  DomainInboundStore,
  InboundServerManager,
  buildModelOverride,
  resolveInstanceBaseUrl,
  resolveInstanceCwd,
  validateBaseUrl,
  trimOptional,
  validateWorkspace,
  type InboundManagerHost,
  type WebServerLike,
} from '../../src/servers/inbound-manager.ts'
import type { TaskStore, InboundServerRecord } from '../../src/server/store.ts'

const root = mkdtempSync(join(tmpdir(), 'dsh-a2a-ws-'))
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** In-memory KV table behind a real DomainInboundStore (same code path as prod). */
function memoryStore() {
  const cells = new Map<string, string>()
  const table = {
    get: (key: string) => cells.get(key),
    put: async (key: string, value: string) => {
      cells.set(key, value)
    },
    entries: () => cells.entries(),
    keys: () => cells.keys(),
  }
  const store = new DomainInboundStore(table)
  const rows = {
    get: (id: string): InboundServerRecord | undefined => {
      const raw = cells.get(`in:${id}`)
      return raw === undefined || raw === '' ? undefined : (JSON.parse(raw) as InboundServerRecord)
    },
    get size(): number {
      return [...cells.values()].filter((v) => v !== '').length
    },
  }
  return { store, rows }
}

function fakeWebServer(): WebServerLike {
  // `register` returns a disposer FUNCTION (not a handle object); the route layer
  // calls it when an instance is rebuilt or removed.
  return {
    register: () => () => {},
  } as unknown as WebServerLike
}

function hostWith(sessionCwd: string, captured: { cwd?: string; model?: { provider?: string; model?: string } }): InboundManagerHost {
  return {
    webServer: fakeWebServer(),
    tasks: {} as TaskStore,
    logger: { info() {}, warn() {}, error() {} },
    sessionCwd,
    defaultBaseUrl: 'http://127.0.0.1:25675',
    subagentProvider: 'none',
    inboundTrace: false,
    newId: (() => { let n = 0; return () => `inst${++n}` })(),
    // `agents` deliberately undefined: assembly falls back to the refusal
    // executor, so no live agent loop is needed to check record plumbing.
    resolveDefaultModel: () => ({ provider: 'deepseek', model: 'default-model' }),
    ...captured,
  } as unknown as InboundManagerHost
}

describe('validateWorkspace', () => {
  it('accepts an omitted workspace (inherit default)', () => {
    expect(validateWorkspace(undefined)).toEqual({ ok: true })
  })

  it('treats a blank workspace as inherit default', () => {
    expect(validateWorkspace('   ')).toEqual({ ok: true })
  })

  it('accepts an existing absolute directory and trims it', () => {
    expect(validateWorkspace(`  ${root}  `)).toEqual({ ok: true, value: root })
  })

  it('rejects a relative path', () => {
    const result = validateWorkspace('relative/dir')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toContain('must be an absolute path')
  })

  it('rejects a missing directory', () => {
    const result = validateWorkspace(join(root, 'nope-does-not-exist'))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toContain('does not exist')
  })

  it('rejects a file masquerading as a workspace', () => {
    const file = join(root, 'a-file.txt')
    writeFileSync(file, 'x')
    const result = validateWorkspace(file)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toContain('not a directory')
  })
})

describe('resolveInstanceCwd', () => {
  it('prefers the record override', () => {
    expect(resolveInstanceCwd({ workspace: '/srv/project-a' }, '/srv/default')).toBe('/srv/project-a')
  })

  it('falls back to the deployment cwd', () => {
    expect(resolveInstanceCwd({}, '/srv/default')).toBe('/srv/default')
  })
})

describe('buildModelOverride', () => {
  it('inherits when neither field is set', () => {
    expect(buildModelOverride({} as InboundServerRecord)).toBeUndefined()
  })

  it('inherits when both fields are blank', () => {
    expect(buildModelOverride({ provider: '  ', model: '' } as InboundServerRecord)).toBeUndefined()
  })

  it('keeps only the provider override', () => {
    expect(buildModelOverride({ provider: 'deepseek' } as InboundServerRecord)).toEqual({ provider: 'deepseek' })
  })

  it('keeps only the model override', () => {
    expect(buildModelOverride({ model: 'deepseek-chat' } as InboundServerRecord)).toEqual({ model: 'deepseek-chat' })
  })

  it('keeps both overrides, trimmed', () => {
    expect(buildModelOverride({ provider: ' deepseek ', model: ' deepseek-chat ' } as InboundServerRecord))
      .toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  })
})

describe('validateBaseUrl', () => {
  it('accepts an omitted baseUrl (inherit deployment default)', () => {
    expect(validateBaseUrl(undefined)).toEqual({ ok: true })
  })

  it('treats a blank baseUrl as inherit default', () => {
    expect(validateBaseUrl('   ')).toEqual({ ok: true })
  })

  it('accepts an absolute http URL and trims whitespace and the trailing slash', () => {
    expect(validateBaseUrl('  http://192.168.31.20/  ')).toEqual({ ok: true, value: 'http://192.168.31.20' })
  })

  it('accepts an https URL with a path-free origin', () => {
    expect(validateBaseUrl('https://companion.example.com')).toEqual({ ok: true, value: 'https://companion.example.com' })
  })

  it('rejects a relative value', () => {
    const result = validateBaseUrl('/a2a/family')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toContain('must be an absolute URL')
  })

  it('rejects a non-http scheme', () => {
    const result = validateBaseUrl('ftp://192.168.31.20')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toContain('must use http or https')
  })
})

describe('resolveInstanceBaseUrl', () => {
  it('prefers the record override', () => {
    expect(resolveInstanceBaseUrl({ baseUrl: 'https://edge.example.com' }, 'http://127.0.0.1:25675'))
      .toBe('https://edge.example.com')
  })

  it('falls back to the deployment base url', () => {
    expect(resolveInstanceBaseUrl({}, 'http://127.0.0.1:25675')).toBe('http://127.0.0.1:25675')
  })
})

describe('trimOptional', () => {
  it('collapses blanks and undefined to undefined', () => {
    expect(trimOptional(undefined)).toBeUndefined()
    expect(trimOptional('   ')).toBeUndefined()
    expect(trimOptional(' x ')).toBe('x')
  })
})

describe('InboundServerManager overrides', () => {
  const base = { name: 'ws', description: 'd', version: '1.0.0' }

  it('persists workspace and model overrides on create', async () => {
    const { store, rows } = memoryStore()
    const manager = new InboundServerManager(hostWith('/srv/default', {}), store)
    const created = await manager.add({ ...base, workspace: root, provider: 'deepseek', model: 'deepseek-chat' })
    expect(created.ok).toBe(true)
    const record = rows.get(created.id!)
    expect(record?.workspace).toBe(root)
    expect(record?.provider).toBe('deepseek')
    expect(record?.model).toBe('deepseek-chat')
  })

  it('omits overrides that were not supplied', async () => {
    const { store, rows } = memoryStore()
    const manager = new InboundServerManager(hostWith('/srv/default', {}), store)
    const created = await manager.add({ ...base })
    expect(created.ok).toBe(true)
    const record = rows.get(created.id!)
    expect(record?.workspace).toBeUndefined()
    expect(record?.provider).toBeUndefined()
    expect(record?.model).toBeUndefined()
  })

  it('refuses to create with a missing workspace', async () => {
    const { store, rows } = memoryStore()
    const manager = new InboundServerManager(hostWith('/srv/default', {}), store)
    const created = await manager.add({ ...base, workspace: join(root, 'ghost') })
    expect(created.ok).toBe(false)
    expect(created.message).toContain('does not exist')
    expect(rows.size).toBe(0)
  })

  it('updates an override and clears it with a blank value', async () => {
    const { store, rows } = memoryStore()
    const manager = new InboundServerManager(hostWith('/srv/default', {}), store)
    const created = await manager.add({ ...base, workspace: root, model: 'deepseek-chat' })
    const id = created.id!

    const updated = await manager.update(id, { model: 'deepseek-reasoner' })
    expect(updated.ok).toBe(true)
    expect(rows.get(id)?.model).toBe('deepseek-reasoner')
    expect(rows.get(id)?.workspace).toBe(root)

    const cleared = await manager.update(id, { model: '', workspace: '' })
    expect(cleared.ok).toBe(true)
    expect(rows.get(id)?.model).toBeUndefined()
    expect(rows.get(id)?.workspace).toBeUndefined()
  })

  it('persists the advertised baseUrl override on create', async () => {
    const { store, rows } = memoryStore()
    const manager = new InboundServerManager(hostWith('/srv/default', {}), store)
    const created = await manager.add({ ...base, baseUrl: ' http://192.168.31.20/ ' })
    expect(created.ok).toBe(true)
    expect(rows.get(created.id!)?.baseUrl).toBe('http://192.168.31.20')
  })

  it('omits the baseUrl override that was not supplied', async () => {
    const { store, rows } = memoryStore()
    const manager = new InboundServerManager(hostWith('/srv/default', {}), store)
    const created = await manager.add({ ...base })
    expect(created.ok).toBe(true)
    expect(rows.get(created.id!)?.baseUrl).toBeUndefined()
  })

  it('refuses to create with a non-absolute baseUrl', async () => {
    const { store, rows } = memoryStore()
    const manager = new InboundServerManager(hostWith('/srv/default', {}), store)
    const created = await manager.add({ ...base, baseUrl: 'edge.example.com' })
    expect(created.ok).toBe(false)
    expect(created.message).toContain('must be an absolute URL')
    expect(rows.size).toBe(0)
  })

  it('updates and clears the baseUrl override with a blank value', async () => {
    const { store, rows } = memoryStore()
    const manager = new InboundServerManager(hostWith('/srv/default', {}), store)
    const created = await manager.add({ ...base, baseUrl: 'http://192.168.31.20' })
    const id = created.id!

    const updated = await manager.update(id, { baseUrl: 'https://companion.example.com/' })
    expect(updated.ok).toBe(true)
    expect(rows.get(id)?.baseUrl).toBe('https://companion.example.com')

    const cleared = await manager.update(id, { baseUrl: '' })
    expect(cleared.ok).toBe(true)
    expect(rows.get(id)?.baseUrl).toBeUndefined()
  })

  it('refuses an update with a non-http baseUrl', async () => {
    const { store, rows } = memoryStore()
    const manager = new InboundServerManager(hostWith('/srv/default', {}), store)
    const created = await manager.add({ ...base, baseUrl: 'http://192.168.31.20' })
    const id = created.id!
    const updated = await manager.update(id, { baseUrl: 'ftp://192.168.31.20' })
    expect(updated.ok).toBe(false)
    expect(rows.get(id)?.baseUrl).toBe('http://192.168.31.20')
  })

  it('advertises the per-instance baseUrl in the assembled agent card', async () => {
    const { store } = memoryStore()
    const manager = new InboundServerManager(hostWith('/srv/default', {}), store)
    const created = await manager.add({ ...base, baseUrl: 'https://companion.example.com' })
    const card = manager.get(created.id!)?.card as { supportedInterfaces?: Array<{ url?: string }> }
    expect(card.supportedInterfaces?.[0]?.url).toBe(`https://companion.example.com/a2a/${created.id}`)
  })

  it('falls back to the deployment base url in the card when unset', async () => {
    const { store } = memoryStore()
    const manager = new InboundServerManager(hostWith('/srv/default', {}), store)
    const created = await manager.add({ ...base })
    const card = manager.get(created.id!)?.card as { supportedInterfaces?: Array<{ url?: string }> }
    expect(card.supportedInterfaces?.[0]?.url).toBe(`http://127.0.0.1:25675/a2a/${created.id}`)
  })

  it('refuses an update that points at a non-directory', async () => {
    const { store, rows } = memoryStore()
    const manager = new InboundServerManager(hostWith('/srv/default', {}), store)
    const created = await manager.add({ ...base, workspace: root })
    const id = created.id!
    const updated = await manager.update(id, { workspace: join(root, 'ghost') })
    expect(updated.ok).toBe(false)
    expect(rows.get(id)?.workspace).toBe(root)
  })
})
