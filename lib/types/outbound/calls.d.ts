/**
 * Outbound A2A client: AgentCard discovery plus the JSON-RPC methods the
 * tools layer needs. Supports blocking and streaming sends, cancellation
 * propagation, and bounded retries for transient transport failures.
 * @module dsh-a2a/outbound/calls
 */
import { type AgentCard, type Message, type StreamResponse, type Task } from '../protocol.ts';
/** Error carrying the remote JSON-RPC error code. */
export declare class A2AError extends Error {
    readonly code: number;
    constructor(code: number, message: string);
}
export interface ClientOptions {
    readonly bearerToken?: string;
    /** Per-call timeout in ms. Default 60000. */
    readonly timeoutMs?: number;
    /** Retries for transient transport/5xx failures. Default 2. */
    readonly retries?: number;
    /** Base delay between retries. Default 150ms. */
    readonly retryDelayMs?: number;
    readonly fetchImpl?: typeof fetch;
}
/** Per-call options shared by blocking and streaming sends. */
export interface SendOptions {
    readonly signal?: AbortSignal;
    /** Use SendStreamingMessage when the remote advertises streaming. */
    readonly stream?: boolean;
    readonly onEvent?: (frame: StreamResponse) => void;
    /** Observe the accumulated task after each applied frame (progress hook). */
    readonly onTask?: (task: Task) => void;
}
/** A connected remote A2A agent (one AgentCard endpoint). */
export declare class A2AClient {
    private readonly opts;
    readonly card: AgentCard;
    private readonly endpoint;
    private constructor();
    /** Fetch and validate an AgentCard, then connect to its JSON-RPC endpoint. */
    static connect(agentCardUrl: string, opts?: ClientOptions): Promise<A2AClient>;
    /** Send a message and wait (or poll/stream) until the task settles. */
    sendMessage(message: Message, options?: SendOptions): Promise<Task>;
    /**
     * Send a message over SSE and return the settled task. Transport failures
     * before the first frame are retried; once progress was observed a retry
     * could duplicate remote work, so the error is surfaced instead.
     */
    sendStreamingMessage(message: Message, options?: SendOptions): Promise<Task>;
    private sendStreamingOnce;
    getTask(taskId: string, signal?: AbortSignal): Promise<Task>;
    listTasks(params?: Record<string, unknown>, signal?: AbortSignal): Promise<Task[]>;
    cancelTask(taskId: string, signal?: AbortSignal): Promise<Task>;
    /** Poll a task until terminal or the overall timeout elapses. */
    private pollTask;
    private call;
}
//# sourceMappingURL=calls.d.ts.map