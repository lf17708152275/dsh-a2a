/**
 * Update-check tests: semver ordering (including prereleases), npm/GitHub
 * source selection, cache reuse, forced refresh, and honest failure reporting.
 * @module dsh-a2a/tests/unit/update.spec
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareVersions, createUpdateChecker } from '../../src/update.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function packageRoot(version = '0.4.0'): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-a2a-update-'))
  roots.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: '@lf17708152275/dsh-a2a',
    version,
    repository: { type: 'git', url: 'git+https://github.com/HanphoneJan/dsh-a2a.git' },
  }))
  return root
}

/** A fetch stub keyed by URL substring; unmatched URLs 404. */
function stubFetch(routes: ReadonlyArray<readonly [string, unknown]>): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    for (const [fragment, payload] of routes) {
      if (!url.includes(fragment)) continue
      if (payload instanceof Error) throw payload
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('missing', { status: 404 })
  }) as typeof fetch
  return { fetch: fetchImpl, calls }
}

describe('compareVersions', () => {
  it('orders releases, ignores a leading v, and treats a release as newer than its prerelease', () => {
    expect(compareVersions('0.4.0', '0.4.0')).toBe(0)
    expect(compareVersions('v0.4.0', '0.4.0')).toBe(0)
    expect(compareVersions('0.4.1', '0.4.0')).toBe(1)
    expect(compareVersions('0.4.0', '0.10.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-rc.2')).toBe(1)
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
  })

  it('rejects unparseable versions instead of guessing', () => {
    expect(() => compareVersions('latest', '1.0.0')).toThrow(/invalid version/)
  })
})

describe('createUpdateChecker', () => {
  it('reports an npm release newer than the installed version', async () => {
    const stub = stubFetch([['registry.npmjs.org', { version: '0.5.0' }]])
    const checker = createUpdateChecker({ packageRoot: packageRoot('0.4.0'), fetchImpl: stub.fetch })
    const info = await checker.check()
    expect(info).toMatchObject({
      ok: true,
      current: '0.4.0',
      latest: '0.5.0',
      hasUpdate: true,
      ahead: false,
      source: 'npm',
      error: null,
      cached: false,
    })
    expect(info.repoUrl).toBe('https://github.com/HanphoneJan/dsh-a2a')
    expect(info.runtime.node).toBe(process.versions.node)
  })

  it('prefers the higher version when GitHub is ahead of npm', async () => {
    const stub = stubFetch([
      ['registry.npmjs.org', { version: '0.4.0' }],
      ['raw.githubusercontent.com', { version: '0.6.0' }],
    ])
    const checker = createUpdateChecker({ packageRoot: packageRoot('0.4.0'), fetchImpl: stub.fetch })
    const info = await checker.check()
    expect(info.latest).toBe('0.6.0')
    expect(info.source).toBe('github')
    expect(info.hasUpdate).toBe(true)
  })

  it('reports a local build ahead of the published version without claiming an update', async () => {
    const stub = stubFetch([['registry.npmjs.org', { version: '0.4.0' }]])
    const checker = createUpdateChecker({ packageRoot: packageRoot('0.5.0'), fetchImpl: stub.fetch })
    const info = await checker.check()
    expect(info.ok).toBe(true)
    expect(info.hasUpdate).toBe(false)
    expect(info.ahead).toBe(true)
  })

  it('says unknown — never "up to date" — when every source fails', async () => {
    const stub = stubFetch([
      ['registry.npmjs.org', new Error('offline')],
      ['raw.githubusercontent.com', new Error('offline')],
      ['cdn.jsdelivr.net', new Error('offline')],
    ])
    const checker = createUpdateChecker({ packageRoot: packageRoot('0.4.0'), fetchImpl: stub.fetch })
    const info = await checker.check()
    expect(info.ok).toBe(false)
    expect(info.latest).toBeNull()
    expect(info.hasUpdate).toBe(false)
    expect(info.error).toMatch(/offline/)
  })

  it('reuses the cached answer until it expires or a refresh is forced', async () => {
    let now = 1_000
    const stub = stubFetch([['registry.npmjs.org', { version: '0.5.0' }]])
    const checker = createUpdateChecker({ packageRoot: packageRoot('0.4.0'), fetchImpl: stub.fetch, now: () => now, cacheTtlMs: 100 })
    await checker.check()
    const firstCalls = stub.calls.length
    const cached = await checker.check()
    expect(cached.cached).toBe(true)
    expect(stub.calls.length).toBe(firstCalls)
    now += 101
    const expired = await checker.check()
    expect(expired.cached).toBe(false)
    expect(stub.calls.length).toBeGreaterThan(firstCalls)
    const beforeRefresh = stub.calls.length
    await checker.check(true)
    expect(stub.calls.length).toBeGreaterThan(beforeRefresh)
  })

  it('reports a missing installed version instead of inventing one', async () => {
    const root = packageRoot('')
    const checker = createUpdateChecker({ packageRoot: root, fetchImpl: vi.fn() as unknown as typeof fetch })
    const info = await checker.check()
    expect(info.ok).toBe(false)
    expect(info.current).toBe('')
    expect(info.error).toMatch(/读不到插件版本/)
  })
})
