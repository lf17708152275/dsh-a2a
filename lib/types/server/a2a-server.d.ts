/**
 * The inbound A2A server: JSON-RPC dispatch, the task lifecycle, and SSE
 * streaming. Transport-agnostic — `handle` / `handleStream` take a structural
 * request and return bytes; the HTTP binding lives in routes.ts.
 * @module dsh-a2a/server/a2a-server
 */
import { type AgentCard, type Message, type Part, type Task } from '../protocol.ts';
import type { TaskStore } from './store.ts';
import type { ExecutorSet } from './executor.ts';
import type { A2aMetrics } from './metrics.ts';
/** What the policy gate sees for one inbound task. */
export interface GateInput {
    readonly contextId: string;
    readonly skill: string;
    readonly parts: readonly Part[];
    readonly remotePeerId: string | null;
}
export type GateResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly reason: string;
};
/** Observational facts about one inbound JSON-RPC request. */
export interface InboundFacts {
    readonly method: string;
    readonly source?: string;
    readonly taskIds: readonly string[];
    readonly streaming: boolean;
}
export interface A2AServerOptions {
    readonly card: AgentCard;
    readonly store: TaskStore;
    readonly executors: ExecutorSet;
    /** Present when inbound bearer auth is configured. */
    readonly authToken?: string;
    /**
     * This instance's id, stamped onto every task record it creates so views
     * can attribute a task (and its session) to the inbound instance it came
     * through. Absent in unit harnesses → records stay unattributed.
     */
    readonly serverId?: string;
    /** Policy gate: skill allow-list + the `a2a/inbound-task` waterfall. */
    readonly gate: (input: GateInput) => Promise<GateResult>;
    readonly onInbound?: (facts: InboundFacts) => void;
    readonly onTaskCreated?: (taskId: string) => void;
    readonly onTaskSettled?: (taskId: string) => void;
    /** One SSE subscription opened for a task (per subscriber, so counts). */
    readonly onStreamOpen?: (info: {
        readonly taskId: string;
        readonly contextId: string;
    }) => void;
    /** One SSE subscription for a task closed (terminal frame delivered). */
    readonly onStreamClose?: (taskId: string) => void;
    /** AgentCard route path for this instance; default = well-known A2A path. */
    readonly cardPath?: string;
    /**
     * Build the AgentCard served for one request. Used by instances whose
     * advertised base URL is dynamic (derived from the request's forwarded
     * host), so the card reflects the address the client actually used.
     */
    readonly cardForRequest?: (req: ServerRequest) => AgentCard;
    /** Per-task execution budget in milliseconds; 0/undefined disables it. */
    readonly taskTimeoutMs?: number;
    /** Sliding-window request cap per source; 0/undefined disables it. */
    readonly requestsPerMinute?: number;
    /** Maximum concurrently executing tasks for this instance; 0/undefined disables it. */
    readonly maxConcurrentTasks?: number;
    /** In-memory SSE event log size per task (reconnect replay). */
    readonly maxEventLog?: number;
    /** When true, this instance may activate the optional trace extension. */
    readonly traceEnabled?: boolean;
    readonly metrics?: A2aMetrics;
}
/** Structural request the server handles (HTTP adapter fills it). */
export interface ServerRequest {
    readonly method?: string;
    readonly url?: string;
    readonly headers?: Record<string, string>;
    readonly socket?: {
        readonly remoteAddress?: string;
        readonly remotePort?: number;
    };
}
export interface ServerResponseSpec {
    readonly status: number;
    readonly contentType: string;
    readonly body: string;
    readonly headers?: Record<string, string>;
}
/** A2A JSON-RPC / SSE server over a structural request. */
export declare class A2AServer {
    private readonly opts;
    card: AgentCard;
    private readonly listeners;
    private readonly waiters;
    private readonly running;
    private readonly eventLogs;
    private readonly limiter;
    private readonly maxEventLog;
    private nextEventId;
    constructor(opts: A2AServerOptions);
    /** Swap the served AgentCard (runtime identity edits). Routes re-read `server.card` on every request. */
    setCard(next: AgentCard): void;
    /** The AgentCard route path for this instance. */
    cardPath(): string;
    /** Extensions this request successfully activates (only optional trace today). */
    activatedExtensions(req: ServerRequest): readonly string[];
    /** Response headers that acknowledge activated extensions. */
    responseHeaders(req: ServerRequest): Record<string, string>;
    /**
     * Abort a running task by control path (facade /a2a task cancel): abort the
     * executor's signal, settle the task CANCELED, and wake stream waiters.
     * @returns false when the task is unknown or already terminal.
     */
    abort(taskId: string): boolean;
    /** True when the request carries the configured bearer token. */
    authorized(req: ServerRequest): boolean;
    /**
     * Check request-rate and bearer auth before an HTTP binding commits a 200/SSE
     * status. Returns the rejection response, or undefined when the request may
     * proceed. `handle`/`handleStream` call this themselves; the route layer
     * calls it before it writes SSE headers and then marks the stream as
     * preflighted so counters are not charged twice.
     */
    preflight(req: ServerRequest): ServerResponseSpec | undefined;
    /**
     * The AgentCard to advertise for one request: the static card unless a
     * `cardForRequest` hook is configured (used by the `auto` base URL mode).
     * Routes that serve the card directly must go through this, not `.card`.
     */
    cardFor(req: ServerRequest): AgentCard;
    /** Route one inbound HTTP request (GET card, POST JSON-RPC). */
    handle(req: ServerRequest, body: string): Promise<ServerResponseSpec>;
    /**
     * Route one SSE request (SendStreamingMessage / SubscribeToTask). Frames are
     * pushed to `onEvent` as they happen; the caller must have checked
     * `authorized()` before writing 200 headers.
     */
    handleStream(req: ServerRequest, body: string, onEvent: (frame: string) => void, options?: {
        readonly preflighted?: boolean;
    }): Promise<{
        readonly status: number;
        readonly headers?: Record<string, string>;
    }>;
    /**
     * Submit one message from the dashboard test console (loopback admin path).
     * This is the same gate + task lifecycle as the wire endpoint, minus HTTP
     * auth, and is intentionally not exposed over the A2A endpoint.
     */
    sendTest(message: Message): Promise<Task>;
    /** Dispatch one JSON-RPC request; throws {code, message} on errors. */
    private dispatch;
    /**
     * Gate input for a message, using the existing task's context/skill when the
     * message is a continuation or idempotent replay. This prevents a follow-up
     * without `metadata.skill` from being checked against the wrong skill.
     */
    private gateInputFor;
    /**
     * Bind one message to a task. A message with a `taskId` continues that task
     * (or returns it for an idempotent `messageId` replay); a messageId seen
     * before returns its original task. A task id outside this instance's scope
     * is indistinguishable from a missing task because the store is scoped.
     */
    private ensureTask;
    /** Run one task to a terminal or interrupted state, emitting status/artifact frames. */
    private runTask;
    /** Build the event sink that folds executor events into store + frames. */
    private eventSink;
    /** Assign an SSE event id, retain it for reconnect replay, and broadcast it. */
    private emit;
    private replay;
    private noteInbound;
    private remotePeerOf;
    /** Apply the per-instance request limiter. */
    private limit;
    private waitTerminal;
    private settle;
    /** Filter, sort, and cursor-page tasks for the spec ListTasks method. */
    private listTasks;
}
//# sourceMappingURL=a2a-server.d.ts.map