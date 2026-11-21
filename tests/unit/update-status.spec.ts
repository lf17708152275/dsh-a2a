/**
 * Version-strip presentation tests: the "unknown is not up to date" rule,
 * tone selection, and the profile-specific two-step update command.
 * @module dsh-a2a/tests/unit/update-status.spec
 */

import { describe, expect, it } from 'vitest'
import { updateCommandFor, updateStatusText, updateToneOf, type UpdateInfo } from '../../src/client/update-status.ts'

function info(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    ok: true,
    current: '0.5.0',
    latest: '0.5.0',
    hasUpdate: false,
    ahead: false,
    error: null,
    source: 'npm',
    repoUrl: 'https://github.com/lf17708152275/dsh-a2a',
    cached: false,
    runtime: { node: '24.0.0', platform: 'linux', arch: 'x64', profile: 'web' },
    ...overrides,
  }
}

describe('updateStatusText', () => {
  it('shows progress before the first answer', () => {
    expect(updateStatusText(undefined, undefined)).toBe('正在检查更新…')
  })

  it('prioritizes a request failure over a previous answer', () => {
    expect(updateStatusText(info(), 'network down')).toBe('检查更新失败：network down')
  })

  it('reports an available update', () => {
    expect(updateStatusText(info({ latest: '0.5.1', hasUpdate: true }), undefined)).toBe('有新版本 v0.5.1')
  })

  it('never renders a failed lookup as up to date', () => {
    const text = updateStatusText(info({ ok: false, latest: null, error: 'offline' }), undefined)
    expect(text).toContain('暂时查不到')
    expect(text).not.toContain('已是最新')
  })

  it('distinguishes a local build ahead of the published version', () => {
    expect(updateStatusText(info({ latest: '0.4.0', ahead: true }), undefined)).toContain('比已发布版本新')
    expect(updateStatusText(info(), undefined)).toBe('已是最新版（v0.5.0）')
  })
})

describe('updateToneOf', () => {
  it('maps every state to a visual tone', () => {
    expect(updateToneOf(undefined, undefined)).toBe('pending')
    expect(updateToneOf(info({ latest: '0.5.1', hasUpdate: true }), undefined)).toBe('update')
    expect(updateToneOf(info(), undefined)).toBe('ok')
    expect(updateToneOf(info({ ok: false, error: 'offline' }), undefined)).toBe('unknown')
    expect(updateToneOf(info(), 'network down')).toBe('unknown')
  })
})

describe('updateCommandFor', () => {
  it('uses the active profile and removes before installing', () => {
    expect(updateCommandFor('desktop')).toBe([
      'dsh plugin --profile desktop remove @hanphone/dsh-a2a',
      'dsh plugin --profile desktop add github:lf17708152275/dsh-a2a',
    ].join('\n'))
  })

  it('installs from the fork repository, never from the npm package name', () => {
    const command = updateCommandFor('web')
    const add = command.split('\n')[1] ?? ''
    expect(add).toContain('github:lf17708152275/dsh-a2a')
    expect(add).not.toContain('add @hanphone/dsh-a2a')
  })

  it('falls back to web for a missing or malformed profile name', () => {
    expect(updateCommandFor(null)).toContain('--profile web ')
    expect(updateCommandFor('bad profile; rm -rf /')).toContain('--profile web ')
  })
})
