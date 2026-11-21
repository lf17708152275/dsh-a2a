/**
 * Plugin version and update check.
 *
 * The dashboard shows this plugin's version and offers a "check for updates"
 * action. Checking is explicit and read-only: it never installs anything; it
 * asks the npm registry and the GitHub repository from `package.json` for the
 * latest published version, compares it with the installed one, and reports the
 * update command for the user to run. The panel asks once when it opens, and
 * the button forces a fresh lookup.
 *
 * Principles:
 * - the repository/package identity comes from the plugin's own
 *   `package.json`, never from a hard-coded URL;
 * - "unknown" is reported as unknown — a failed lookup never renders as
 *   "up to date";
 * - the result is cached for six hours; an explicit refresh bypasses it;
 * - the network is only touched by `check()`, never by snapshot traffic.
 * @module dsh-a2a/update
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Where a latest-version answer came from. */
export type UpdateSource = 'npm' | 'github'

/** Runtime versions useful when reporting a problem alongside the plugin version. */
export interface RuntimeVersions {
  readonly node: string
  readonly platform: string
  readonly arch: string
  /** Active DSH profile, when the host exports `DSH_PROFILE`. */
  readonly profile: string | null
}

/** One update-check answer, shaped for the dashboard. */
export interface UpdateInfo {
  /** Whether a latest version was actually obtained. */
  readonly ok: boolean
  /** Installed plugin version (empty when `package.json` could not be read). */
  readonly current: string
  /** Highest version reported by any source, or null when none answered. */
  readonly latest: string | null
  /** `latest` is strictly newer than `current`. */
  readonly hasUpdate: boolean
  /** The installed version is newer than every published source (a local build). */
  readonly ahead: boolean
  /** Why the lookup failed, or null when it succeeded. */
  readonly error: string | null
  /** Which source supplied `latest`; null when none did. */
  readonly source: UpdateSource | null
  readonly repoUrl: string | null
  readonly packageName: string
  /** Epoch milliseconds of the check that produced this answer. */
  readonly checkedAt: number
  /** True when this answer was served from the in-process cache. */
  readonly cached: boolean
  readonly runtime: RuntimeVersions
}

/** What the API route needs from an update checker. */
export interface UpdateChecker {
  readonly current: string
  readonly packageName: string
  readonly repoUrl: string | null
  check(force?: boolean): Promise<UpdateInfo>
}

/** Options for {@link createUpdateChecker}. */
export interface UpdateCheckerOptions {
  /** Directory holding the plugin's `package.json`. */
  readonly packageRoot: string
  /** Clock override (tests). */
  readonly now?: () => number
  /** Fetch override (tests). */
  readonly fetchImpl?: typeof fetch
  /** How long a result may be reused. Defaults to six hours. */
  readonly cacheTtlMs?: number
  /** Per-request network timeout. Defaults to eight seconds. */
  readonly timeoutMs?: number
  /** npm registry base URL override. */
  readonly registryBaseUrl?: string
}

/** A parsed semantic version. */
interface ParsedVersion {
  readonly core: readonly number[]
  readonly prerelease: readonly string[]
}

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

const VERSION_PATTERN = /^\s*[vV]?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/

/** Parse a version such as `1.2.3`, `v1.2.3`, or `1.2.3-rc.1`. */
export function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(value)
  if (match === null) return null
  const core = [Number(match[1] ?? 0), Number(match[2] ?? 0), Number(match[3] ?? 0)]
  const prerelease = match[4] === undefined ? [] : match[4].split('.').filter((part) => part !== '')
  return { core, prerelease }
}

/**
 * Compare two semantic versions.
 * @returns a negative number when `a < b`, zero when equal, positive when `a > b`.
 * @throws when either side is not a parseable version.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === null) throw new Error(`invalid version: ${JSON.stringify(a)}`)
  if (right === null) throw new Error(`invalid version: ${JSON.stringify(b)}`)
  for (let index = 0; index < 3; index += 1) {
    const x = left.core[index] ?? 0
    const y = right.core[index] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

/** SemVer prerelease precedence; an absent prerelease outranks a present one. */
function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const x = left[index]
    const y = right[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) {
      const delta = Number(x) - Number(y)
      if (delta !== 0) return delta > 0 ? 1 : -1
      continue
    }
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

interface PackageMeta {
  readonly name?: string
  readonly version?: string
  readonly repoUrl: string | null
}

function repositoryUrl(manifest: Record<string, unknown>): string | null {
  const repository = manifest['repository']
  const candidate = typeof repository === 'object' && repository !== null
    ? (repository as { url?: unknown }).url
    : repository
  const raw = typeof candidate === 'string' && candidate.trim() !== ''
    ? candidate
    : typeof manifest['homepage'] === 'string'
      ? manifest['homepage']
      : ''
  if (raw.trim() === '') return null
  return raw
    .trim()
    .replace(/^git\+/, '')
    .replace(/^git:/, 'https:')
    .replace(/\.git$/i, '')
    .replace(/#readme$/i, '')
}

function readPackageMeta(packageRoot: string): PackageMeta {
  try {
    const parsed = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { repoUrl: null }
    const manifest = parsed as Record<string, unknown>
    return {
      ...(typeof manifest['name'] === 'string' ? { name: manifest['name'] } : {}),
      ...(typeof manifest['version'] === 'string' ? { version: manifest['version'] } : {}),
      repoUrl: repositoryUrl(manifest),
    }
  } catch {
    return { repoUrl: null }
  }
}

/** npm registry's `latest` endpoint for one package. */
function npmLatestUrl(packageName: string, baseUrl: string): string {
  const path = packageName.replace('/', '%2F')
  return `${baseUrl.replace(/\/+$/, '')}/${path}/latest`
}

/** Candidate raw `package.json` URLs for a GitHub repository. */
function githubPackageUrls(repoUrl: string | null): string[] {
  const match = /github\.com[/:]([^/]+)\/([^/#?]+)/i.exec(repoUrl ?? '')
  if (match === null) return []
  const owner = match[1]
  const name = (match[2] ?? '').replace(/\.git$/i, '')
  if (owner === undefined || name === '') return []
  return [
    `https://raw.githubusercontent.com/${owner}/${name}/HEAD/package.json`,
    // jsDelivr mirrors GitHub, but caches aggressively; last resort only.
    `https://cdn.jsdelivr.net/gh/${owner}/${name}@main/package.json`,
  ]
}

async function fetchJson(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<unknown> {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json', 'user-agent': '@lf17708152275/dsh-a2a update-check' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.json()
}

function versionOf(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined
  const version = (payload as { version?: unknown }).version
  return typeof version === 'string' && version.trim() !== '' ? version : undefined
}

function runtimeVersions(): RuntimeVersions {
  const profile = process.env['DSH_PROFILE']
  return {
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    profile: typeof profile === 'string' && profile !== '' ? profile : null,
  }
}

/**
 * Create a lazily-checking update checker for one package root.
 * @param options - package location, cache/network overrides.
 */
export function createUpdateChecker(options: UpdateCheckerOptions): UpdateChecker {
  const meta = readPackageMeta(options.packageRoot)
  const current = meta.version ?? ''
  const packageName = meta.name ?? '@lf17708152275/dsh-a2a'
  const repoUrl = meta.repoUrl
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  const registryBaseUrl = options.registryBaseUrl ?? DEFAULT_REGISTRY
  const runtime = runtimeVersions()

  let cache: UpdateInfo | undefined
  let inflight: Promise<UpdateInfo> | undefined

  const unavailable = (error: string, checkedAt: number): UpdateInfo => ({
    ok: false,
    current,
    latest: null,
    hasUpdate: false,
    ahead: false,
    error,
    source: null,
    repoUrl,
    packageName,
    checkedAt,
    cached: false,
    runtime,
  })

  async function lookup(): Promise<UpdateInfo> {
    if (current === '') return unavailable('读不到插件版本（package.json 缺少 version）', now())
    const errors: string[] = []
    const candidates: Array<{ readonly source: UpdateSource; readonly version: string }> = []

    const collect = async (source: UpdateSource, url: string, parse: (payload: unknown) => string | undefined): Promise<void> => {
      try {
        const version = parse(await fetchJson(url, fetchImpl, timeoutMs))
        if (version === undefined) throw new Error('响应里没有 version')
        if (parseVersion(version) === null) throw new Error(`版本号无法解析：${version}`)
        candidates.push({ source, version })
      } catch (err) {
        errors.push(`${source}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const lookups: Array<Promise<void>> = [collect('npm', npmLatestUrl(packageName, registryBaseUrl), versionOf)]
    for (const url of githubPackageUrls(repoUrl)) {
      lookups.push(collect('github', url, versionOf))
    }
    await Promise.all(lookups)

    let latest: { readonly source: UpdateSource; readonly version: string } | undefined
    for (const candidate of candidates) {
      if (latest === undefined || compareVersions(candidate.version, latest.version) > 0) latest = candidate
    }

    const checkedAt = now()
    if (latest === undefined) {
      return unavailable(errors.length > 0 ? errors.join('; ') : '没有可用的更新源', checkedAt)
    }
    const comparison = compareVersions(latest.version, current)
    return {
      ok: true,
      current,
      latest: latest.version,
      hasUpdate: comparison > 0,
      ahead: comparison < 0,
      error: null,
      source: latest.source,
      repoUrl,
      packageName,
      checkedAt,
      cached: false,
      runtime,
    }
  }

  return {
    current,
    packageName,
    repoUrl,
    async check(force = false): Promise<UpdateInfo> {
      if (!force && cache !== undefined && now() - cache.checkedAt < cacheTtlMs) {
        return { ...cache, cached: true }
      }
      if (inflight !== undefined) return inflight
      inflight = lookup()
        .catch((err: unknown) => unavailable(err instanceof Error ? err.message : String(err), now()))
        .then((info) => {
          cache = info
          return info
        })
        .finally(() => {
          inflight = undefined
        })
      return inflight
    },
  }
}
