/**
 * Pure presentation helpers for the version/update strip.
 *
 * Kept free of React and DOM so the "unknown is not up to date" rule and the
 * profile-specific update command are unit-testable without a browser.
 * @module dsh-a2a/client/update-status
 */

/** The host's update-check answer (mirrors src/update.ts `UpdateInfo`). */
export interface UpdateInfo {
  readonly ok: boolean
  readonly current: string
  readonly latest: string | null
  readonly hasUpdate: boolean
  readonly ahead: boolean
  readonly error: string | null
  readonly source: 'npm' | 'github' | null
  readonly repoUrl: string | null
  readonly cached: boolean
  readonly runtime: {
    readonly node: string
    readonly platform: string
    readonly arch: string
    readonly profile: string | null
  }
}

/** Visual tone for the version-strip status text. */
export type UpdateTone = 'pending' | 'update' | 'ok' | 'unknown'

/**
 * Where the plugin installs from: this fork's repository.
 *
 * Upstream publishes to npm as `@hanphone/dsh-a2a`; this fork carries its own
 * package name, so an install that names the npm package can never be mistaken
 * for the fork.
 */
export const INSTALL_SPEC = 'github:lf17708152275/dsh-a2a'

/** Human-readable status; a failed lookup never reads as "up to date". */
export function updateStatusText(update: UpdateInfo | undefined, error: string | undefined): string {
  if (error !== undefined) return `检查更新失败：${error}`
  if (update === undefined) return '正在检查更新…'
  if (update.hasUpdate) return `有新版本 v${update.latest ?? ''}`
  if (!update.ok) return `暂时查不到最新版本（${update.error ?? '网络'}）—— 这不代表没有问题`
  if (update.ahead) return `本地版本比已发布版本新（${update.latest ?? ''}）`
  return `已是最新版（v${update.latest ?? ''}）`
}

/** Tone paired with {@link updateStatusText}. */
export function updateToneOf(update: UpdateInfo | undefined, error: string | undefined): UpdateTone {
  if (error !== undefined) return 'unknown'
  if (update === undefined) return 'pending'
  if (update.hasUpdate) return 'update'
  return update.ok ? 'ok' : 'unknown'
}

/**
 * Two-step update command for the given profile (`remove`, then `add`).
 * A missing or malformed profile falls back to `web`; the value is only
 * displayed and copied, never executed.
 *
 * The install source is this fork's repository, not the npm package: the npm
 * name resolves to the upstream release, so copying a command that names only
 * `@hanphone/dsh-a2a` would quietly replace the fork with upstream code.
 */
export function updateCommandFor(profile: string | null | undefined): string {
  const candidate = profile ?? ''
  const name = /^[A-Za-z0-9._-]+$/.test(candidate) ? candidate : 'web'
  return [
    `dsh plugin --profile ${name} remove @lf17708152275/dsh-a2a`,
    `dsh plugin --profile ${name} add ${INSTALL_SPEC}`,
  ].join('\n')
}
