/**
 * @lf17708152275/dsh-a2a — Cordis plugin entry.
 *
 * Mounts the A2A v1.0.1 dual-end plugin as a MULTI-INSTANCE composition: an
 * arbitrary set of inbound A2A servers (each a preset-bound session pool, its
 * own endpoint + AgentCard + creator-declared skills + auth) and an arbitrary
 * set of outbound A2A connections (each a remote URL + preset + timeout).
 * Instances are persisted in the `a2a` domain (`inbound_servers` /
 * `outbound_servers` tables) and created/edited/started/stopped entirely from
 * the GUI — the plugin `Config` is minimal and instance setup is not
 * patch-config driven. The protocol surface is aligned with the official A2A
 * v1.0.1 spec (see docs/reference/http-api.md).
 *
 * Optional services are probed rather than injected so a composition lacking
 * one half idles just that half; only the storage domain is required.
 *
 * Function-plugin export shape: named `name`/`inject`/`Config`/`apply`, no
 * default export (mixing forms makes the Loader drop the namespace).
 * @module dsh-a2a
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type OpResult } from './service.ts';
import { type CompositionLike, type InspectionLike } from './server/preset-capabilities.ts';
export declare const name = "a2a";
/** Only the storage domain is required; the other halves are probed. */
export declare const inject: readonly ["storageDomain"];
/** Minimal host-level config; per-instance setup happens in the GUI/domain. */
export interface A2AConfig {
    /** Advertised base URL for every inbound card; absent lets a default stand. */
    baseUrl?: string;
    /** Subagent driver provider for the inbound subagent executors. */
    subagentProvider: string;
    /** Default outbound connection timeout (ms). */
    defaultTimeoutMs: number;
    /** Per-task inbound execution budget (ms); 0 disables it. */
    inboundTimeoutMs: number;
    /** Sliding-window request cap per inbound source per minute; 0 disables it. */
    requestsPerMinute: number;
    /** Maximum concurrent tasks per inbound instance; 0 disables it. */
    maxConcurrentTasks: number;
    /** Maximum accepted inbound HTTP body in bytes. */
    maxBodyBytes: number;
    /** Automatic outbound AgentCard refresh interval (ms); 0 disables it. */
    outboundRefreshMs: number;
    /** Deployment gate/default for the optional inbound trace extension. */
    inboundTrace: boolean;
}
/** Loader-validated config schema (defaults applied by the Loader). */
export declare const Config: z<A2AConfig>;
export declare function apply(ctx: Context, config: A2AConfig): void;
/** The part of the host agent-preset registry the dashboard reads. */
export interface AgentPresetRosterHost {
    list(): Promise<Array<{
        id: string;
        name?: string;
        description?: string;
    }>>;
    /** Declaration rows + activation state for every registered preset. */
    compositionInventory?(): Promise<readonly CompositionLike[]>;
    /** Coarser fallback: module names per preset without activation states. */
    inspectCompositions?(): readonly InspectionLike[];
    readonly defaultId?: string;
}
export type { OpResult };
export { A2AServer } from './server/a2a-server.ts';
export { A2AClient, A2AError } from './outbound/calls.ts';
export { A2AService } from './service.ts';
//# sourceMappingURL=index.d.ts.map