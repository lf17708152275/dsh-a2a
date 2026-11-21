/**
 * Deployment-wide inbound settings, editable at runtime from the GUI dashboard
 * and persisted in the `a2a` domain's `identity` table (the same kv table the
 * service identity uses, under its own key). Only the advertised base URL
 * lives here today: `auto` derives it per request, an absolute http(s) URL
 * pins it, and an absent value falls back to the loader config.
 * @module dsh-a2a/server/settings
 */
import type { A2aDomain } from './store.ts';
/** Persisted deployment settings (all fields optional = inherit the next layer). */
export interface DeploymentSettingsRecord {
    /** `auto` or an absolute http(s) origin; absent = the loader `baseUrl` config. */
    readonly baseUrl?: string;
}
/** Read the persisted deployment settings (undefined when never configured). */
export declare function readDeploymentSettings(domain: A2aDomain): DeploymentSettingsRecord | undefined;
/** Persist deployment settings; a blank `baseUrl` clears the override. */
export declare function writeDeploymentSettings(domain: A2aDomain, record: DeploymentSettingsRecord): Promise<void>;
//# sourceMappingURL=settings.d.ts.map