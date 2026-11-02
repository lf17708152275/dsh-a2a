/**
 * Deployment-wide settings store: the advertised base URL mode persisted in
 * the `a2a` domain's `identity` table (GUI-editable).
 *
 * Regression shape: dropping the persistence (or the blank-clears rule) makes
 * these assertions fail.
 * @module dsh-a2a/tests/unit/deployment-settings.spec
 */

import { describe, expect, it } from 'vitest'
import { readDeploymentSettings, writeDeploymentSettings, type DeploymentSettingsRecord } from '../../src/server/settings.ts'
import type { A2aDomain } from '../../src/server/store.ts'

/** In-memory stand-in for the domain's identity kv table. */
function memoryDomain(): { domain: A2aDomain; cells: Map<string, string> } {
  const cells = new Map<string, string>()
  const domain = {
    identity: {
      get: (key: string) => cells.get(key),
      put: async (key: string, value: string) => {
        cells.set(key, value)
      },
    },
  } as unknown as A2aDomain
  return { domain, cells }
}

describe('deployment settings store', () => {
  it('reads undefined before anything is written', () => {
    const { domain } = memoryDomain()
    expect(readDeploymentSettings(domain)).toBeUndefined()
  })

  it('round-trips an auto mode override', async () => {
    const { domain, cells } = memoryDomain()
    await writeDeploymentSettings(domain, { baseUrl: 'auto' })
    expect(cells.get('settings')).toBe('{"baseUrl":"auto"}')
    expect(readDeploymentSettings(domain)).toEqual({ baseUrl: 'auto' })
  })

  it('round-trips a custom origin override', async () => {
    const { domain } = memoryDomain()
    await writeDeploymentSettings(domain, { baseUrl: 'http://192.168.31.20' })
    expect(readDeploymentSettings(domain)).toEqual({ baseUrl: 'http://192.168.31.20' })
  })

  it('treats an empty record as cleared (inherit the loader config)', async () => {
    const { domain } = memoryDomain()
    await writeDeploymentSettings(domain, { baseUrl: 'auto' })
    const cleared: DeploymentSettingsRecord = {}
    await writeDeploymentSettings(domain, cleared)
    expect(readDeploymentSettings(domain)).toEqual({})
  })

  it('ignores a corrupt payload instead of throwing', () => {
    const { domain, cells } = memoryDomain()
    cells.set('settings', 'not json')
    expect(readDeploymentSettings(domain)).toBeUndefined()
  })

  it('ignores a non-string baseUrl', () => {
    const { domain, cells } = memoryDomain()
    cells.set('settings', '{"baseUrl":42}')
    expect(readDeploymentSettings(domain)).toEqual({})
  })
})
