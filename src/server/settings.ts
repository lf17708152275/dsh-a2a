/**
 * Deployment-wide inbound settings, editable at runtime from the GUI dashboard
 * and persisted in the `a2a` domain's `identity` table (the same kv table the
 * service identity uses, under its own key). Only the advertised base URL
 * lives here today: `auto` derives it per request, an absolute http(s) URL
 * pins it, and an absent value falls back to the loader config.
 * @module dsh-a2a/server/settings
 */

import type { A2aDomain } from './store.ts'

/** Persisted deployment settings (all fields optional = inherit the next layer). */
export interface DeploymentSettingsRecord {
  /** `auto` or an absolute http(s) origin; absent = the loader `baseUrl` config. */
  readonly baseUrl?: string
}

const SETTINGS_KEY = 'settings'

function decode(raw: string | undefined): DeploymentSettingsRecord | undefined {
  if (raw === undefined || raw === '') return undefined
  try {
    const parsed = JSON.parse(raw) as { baseUrl?: unknown }
    const baseUrl = typeof parsed.baseUrl === 'string' && parsed.baseUrl.length > 0 ? parsed.baseUrl : undefined
    return baseUrl === undefined ? {} : { baseUrl }
  } catch {
    return undefined
  }
}

function encode(value: DeploymentSettingsRecord): string {
  return JSON.stringify(value)
}

/** Read the persisted deployment settings (undefined when never configured). */
export function readDeploymentSettings(domain: A2aDomain): DeploymentSettingsRecord | undefined {
  return decode(domain.identity.get(SETTINGS_KEY))
}

/** Persist deployment settings; a blank `baseUrl` clears the override. */
export async function writeDeploymentSettings(domain: A2aDomain, record: DeploymentSettingsRecord): Promise<void> {
  await domain.identity.put(SETTINGS_KEY, encode(record))
}
