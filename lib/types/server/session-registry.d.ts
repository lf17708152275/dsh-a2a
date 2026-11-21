/**
 * Inbound session observation and views: which A2A contexts have a live
 * per-context DSH session, and where they are streaming. The LIVE half of the
 * session layer is a per-instance registry fed by the A2A server's SSE
 * lifecycle hooks (open subscriptions per task); everything else — task
 * counts, timestamps, running/idle status — is DERIVED from the shared task
 * store. That split is deliberate: a composition without an agent loop (no
 * session pool) still renders the session table from task records — degraded,
 * never crashing — while stream-open observations only exist where an A2A
 * server is actually mounted.
 *
 * Views are aggregated by `(serverId, contextId)` (one row per inbound
 * instance conversation), because the session id is a pure function of both
 * (`ContextSessionPool.sessionIdFor`). Two instances may therefore reuse the
 * same client-chosen contextId without sharing a session.
 * @module dsh-a2a/server/session-registry
 */
import type { TaskRecord } from './store.ts';
/** One aggregated inbound session view (per A2A contextId). */
export interface SessionView {
    readonly contextId: string;
    /** DSH session id backing this context (`a2a-<contextId>`, stable). */
    readonly sessionId: string;
    /** Inbound instance that handled this context's most recent task. */
    readonly serverId?: string;
    readonly serverName?: string;
    /** Agent preset composing this context's sessions. */
    readonly preset?: string;
    /** running = at least one non-terminal task; idle otherwise. */
    readonly status: 'running' | 'idle';
    /** Total tasks this context has produced (all states). */
    readonly taskCount: number;
    /** Tasks still in flight (SUBMITTED / WORKING). */
    readonly activeCount: number;
    readonly firstSeen: string;
    readonly lastSeen: string;
    /** True while at least one SSE subscription is open for this context's tasks. */
    readonly streaming: boolean;
    /** True while a live session-pool handle exists for this context. */
    readonly live: boolean;
}
/** Per-instance live observation: open SSE subscriptions, counted per task. */
export declare class ContextSessionRegistry {
    private readonly streamCounts;
    noteStreamOpen(taskId: string): void;
    noteStreamClose(taskId: string): void;
    streamingOpenCount(taskId: string): number;
    /** Drop all observations (instance teardown / swap). */
    clear(): void;
}
/** The slice of a live inbound instance the aggregation reads (structural). */
export interface SessionInstanceLike {
    readonly id: string;
    readonly name: string;
    readonly preset?: string | undefined;
    readonly sessions: ContextSessionRegistry;
    /** Live per-context session pool; absent = no agent loop mounted. */
    readonly sessionPool?: {
        has(contextId: string): boolean;
        messages?(contextId: string): readonly unknown[];
    } | undefined;
}
/**
 * Build per-context session views from the shared task store and the live
 * inbound instances. Rows exist whenever the context has task records, so the
 * table survives restarts and agent-less compositions (degraded: no live
 * handles, no stream observation); only in-memory state resets on restart.
 */
export declare function aggregateSessionViews(tasks: readonly TaskRecord[], instances: readonly SessionInstanceLike[]): SessionView[];
//# sourceMappingURL=session-registry.d.ts.map