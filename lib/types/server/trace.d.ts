/**
 * Optional inbound trace extension: discoverable through AgentCard
 * `capabilities.extensions` and activated per request with `A2A-Extensions`.
 * Trace data is metadata only — never an artifact, never history, never the
 * model-facing result. This module owns the URI, schema types, redaction and
 * size bounds.
 * @module dsh-a2a/server/trace
 */
import type { AgentExtension } from '../protocol.ts';
/** Stable extension URI; a breaking schema change needs a new URI. */
export declare const TRACE_EXTENSION_URI = "https://github.com/hanphone/dsh-a2a/blob/main/docs/extensions/dsh-trace/v1.md";
/** Per-task trace bounds. The extension spec documents both. */
export declare const TRACE_MAX_CALLS = 64;
export declare const TRACE_MAX_PREVIEW_CHARS = 200;
/** Lifecycle of one observed tool call. */
export type TracePhase = 'start' | 'end';
/** `running` is only valid on a start event. */
export type TraceStatus = 'running' | 'ok' | 'error' | 'unknown';
/** One tool-call observation carried in extension metadata. */
export interface TraceCall {
    readonly callId: string;
    readonly tool: string;
    readonly phase: TracePhase;
    readonly status: TraceStatus;
    readonly durationMs?: number;
    /** Redacted and truncated argument preview; never the raw argument string. */
    readonly argsPreview?: string;
    readonly timestamp: string;
}
/** The durable per-task trace summary returned on `Task.metadata`. */
export interface TraceSummary {
    readonly calls: readonly TraceCall[];
    readonly truncated?: boolean;
}
/** AgentCard declaration for this extension. */
export declare function traceExtension(): AgentExtension;
/** Append one call to a bounded summary. */
export declare function appendTrace(summary: TraceSummary | undefined, call: TraceCall): TraceSummary;
/**
 * Redact and truncate a raw tool-argument JSON string for presentation.
 * Unparseable arguments are replaced wholesale so a malformed secret cannot
 * leak through a best-effort text slice.
 */
export declare function previewArguments(raw: unknown, limit?: number): string | undefined;
//# sourceMappingURL=trace.d.ts.map