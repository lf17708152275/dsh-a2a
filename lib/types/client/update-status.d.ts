/**
 * Pure presentation helpers for the version/update strip.
 *
 * Kept free of React and DOM so the "unknown is not up to date" rule and the
 * profile-specific update command are unit-testable without a browser.
 * @module dsh-a2a/client/update-status
 */
/** The host's update-check answer (mirrors src/update.ts `UpdateInfo`). */
export interface UpdateInfo {
    readonly ok: boolean;
    readonly current: string;
    readonly latest: string | null;
    readonly hasUpdate: boolean;
    readonly ahead: boolean;
    readonly error: string | null;
    readonly source: 'npm' | 'github' | null;
    readonly repoUrl: string | null;
    readonly cached: boolean;
    readonly runtime: {
        readonly node: string;
        readonly platform: string;
        readonly arch: string;
        readonly profile: string | null;
    };
}
/** Visual tone for the version-strip status text. */
export type UpdateTone = 'pending' | 'update' | 'ok' | 'unknown';
/** Human-readable status; a failed lookup never reads as "up to date". */
export declare function updateStatusText(update: UpdateInfo | undefined, error: string | undefined): string;
/** Tone paired with {@link updateStatusText}. */
export declare function updateToneOf(update: UpdateInfo | undefined, error: string | undefined): UpdateTone;
/**
 * Two-step update command for the given profile (`remove`, then `add`).
 * A missing or malformed profile falls back to `web`; the value is only
 * displayed and copied, never executed.
 */
export declare function updateCommandFor(profile: string | null | undefined): string;
//# sourceMappingURL=update-status.d.ts.map