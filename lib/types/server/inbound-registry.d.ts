/**
 * Inbound connection registry: which remote peers are talking to this DSH's
 * A2A server. Fed by the A2A server's `onInbound` hook (every JSON-RPC
 * request / SSE open), surfaced through the dashboard API, and disconnectable
 * (`closePeer` cancels the peer's active tasks and drops the record).
 * @module dsh-a2a/server/inbound-registry
 */
/** One live inbound connection (observed peer). */
export interface InboundPeerRecord {
    /** Stable per-process id (random). */
    readonly id: string;
    /** Short display label derived from the request source. */
    readonly label: string;
    /** Source socket address, when visible ("127.0.0.1:54321"). */
    readonly source: string | null;
    /** First-seen ISO timestamp. */
    readonly firstSeen: string;
    /** Last-activity ISO timestamp. */
    readonly lastSeen: string;
    /** Number of tasks this peer created or continued. */
    readonly taskCount: number;
    /** Ids of tasks still running for this peer. */
    readonly activeTaskIds: readonly string[];
    /** True while at least one streaming (SSE) connection is open. */
    readonly streaming: boolean;
}
/** Control and observation contract the dashboard API and facade use. */
export interface InboundRegistry {
    list(): readonly InboundPeerRecord[];
    /** Cancel a peer's active tasks and remove its record. */
    closePeer(peerId: string): {
        readonly ok: boolean;
        readonly message: string;
    };
    /** Active task ids of one peer (the facade cancels them on close). */
    activeTasksOf(peerId: string): readonly string[];
}
/** In-memory inbound peer registry. */
export declare class LiveInboundRegistry implements InboundRegistry {
    private readonly peers;
    private findBySource;
    /** Observe one inbound event: method, source, task ids, streaming flag. */
    note(input: {
        readonly method: string;
        readonly source?: string;
        readonly taskIds: readonly string[];
        readonly streaming: boolean;
    }): void;
    /** A task settled: drop it from every peer's active set. */
    settle(taskId: string): void;
    /** Decrement streaming count when an SSE connection closes. */
    endStream(source?: string): void;
    list(): readonly InboundPeerRecord[];
    closePeer(peerId: string): {
        readonly ok: boolean;
        readonly message: string;
    };
    activeTasksOf(peerId: string): readonly string[];
}
//# sourceMappingURL=inbound-registry.d.ts.map