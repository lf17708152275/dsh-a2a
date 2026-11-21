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
/** Where a latest-version answer came from. */
export type UpdateSource = 'npm' | 'github';
/** Runtime versions useful when reporting a problem alongside the plugin version. */
export interface RuntimeVersions {
    readonly node: string;
    readonly platform: string;
    readonly arch: string;
    /** Active DSH profile, when the host exports `DSH_PROFILE`. */
    readonly profile: string | null;
}
/** One update-check answer, shaped for the dashboard. */
export interface UpdateInfo {
    /** Whether a latest version was actually obtained. */
    readonly ok: boolean;
    /** Installed plugin version (empty when `package.json` could not be read). */
    readonly current: string;
    /** Highest version reported by any source, or null when none answered. */
    readonly latest: string | null;
    /** `latest` is strictly newer than `current`. */
    readonly hasUpdate: boolean;
    /** The installed version is newer than every published source (a local build). */
    readonly ahead: boolean;
    /** Why the lookup failed, or null when it succeeded. */
    readonly error: string | null;
    /** Which source supplied `latest`; null when none did. */
    readonly source: UpdateSource | null;
    readonly repoUrl: string | null;
    readonly packageName: string;
    /** Epoch milliseconds of the check that produced this answer. */
    readonly checkedAt: number;
    /** True when this answer was served from the in-process cache. */
    readonly cached: boolean;
    readonly runtime: RuntimeVersions;
}
/** What the API route needs from an update checker. */
export interface UpdateChecker {
    readonly current: string;
    readonly packageName: string;
    readonly repoUrl: string | null;
    check(force?: boolean): Promise<UpdateInfo>;
}
/** Options for {@link createUpdateChecker}. */
export interface UpdateCheckerOptions {
    /** Directory holding the plugin's `package.json`. */
    readonly packageRoot: string;
    /** Clock override (tests). */
    readonly now?: () => number;
    /** Fetch override (tests). */
    readonly fetchImpl?: typeof fetch;
    /** How long a result may be reused. Defaults to six hours. */
    readonly cacheTtlMs?: number;
    /** Per-request network timeout. Defaults to eight seconds. */
    readonly timeoutMs?: number;
    /** npm registry base URL override. */
    readonly registryBaseUrl?: string;
}
/** A parsed semantic version. */
interface ParsedVersion {
    readonly core: readonly number[];
    readonly prerelease: readonly string[];
}
/** Parse a version such as `1.2.3`, `v1.2.3`, or `1.2.3-rc.1`. */
export declare function parseVersion(value: string): ParsedVersion | null;
/**
 * Compare two semantic versions.
 * @returns a negative number when `a < b`, zero when equal, positive when `a > b`.
 * @throws when either side is not a parseable version.
 */
export declare function compareVersions(a: string, b: string): number;
/**
 * Create a lazily-checking update checker for one package root.
 * @param options - package location, cache/network overrides.
 */
export declare function createUpdateChecker(options: UpdateCheckerOptions): UpdateChecker;
export {};
//# sourceMappingURL=update.d.ts.map