/**
 * Optional inbound trace extension: discoverable through AgentCard
 * `capabilities.extensions` and activated per request with `A2A-Extensions`.
 * Trace data is metadata only — never an artifact, never history, never the
 * model-facing result. This module owns the URI, schema types, redaction and
 * size bounds.
 * @module dsh-a2a/server/trace
 */

import type { AgentExtension } from '../protocol.ts'

/** Stable extension URI; a breaking schema change needs a new URI. */
export const TRACE_EXTENSION_URI = 'https://github.com/lf17708152275/dsh-a2a/blob/main/docs/extensions/dsh-trace/v1.md'

/** Per-task trace bounds. The extension spec documents both. */
export const TRACE_MAX_CALLS = 64
export const TRACE_MAX_PREVIEW_CHARS = 200

/** Lifecycle of one observed tool call. */
export type TracePhase = 'start' | 'end'

/** `running` is only valid on a start event. */
export type TraceStatus = 'running' | 'ok' | 'error' | 'unknown'

/** One tool-call observation carried in extension metadata. */
export interface TraceCall {
  readonly callId: string
  readonly tool: string
  readonly phase: TracePhase
  readonly status: TraceStatus
  readonly durationMs?: number
  /** Redacted and truncated argument preview; never the raw argument string. */
  readonly argsPreview?: string
  readonly timestamp: string
}

/** The durable per-task trace summary returned on `Task.metadata`. */
export interface TraceSummary {
  readonly calls: readonly TraceCall[]
  readonly truncated?: boolean
}

/** AgentCard declaration for this extension. */
export function traceExtension(): AgentExtension {
  return {
    uri: TRACE_EXTENSION_URI,
    description: 'Optional tool-call trace metadata. Disabled unless the client activates this extension.',
    required: false,
    params: {
      carrier: 'metadata',
      default: 'off',
      args: 'redacted-preview',
      maxCalls: TRACE_MAX_CALLS,
    },
  }
}

/** Append one call to a bounded summary. */
export function appendTrace(summary: TraceSummary | undefined, call: TraceCall): TraceSummary {
  const calls = [...(summary?.calls ?? []), call]
  const truncated = summary?.truncated === true || calls.length > TRACE_MAX_CALLS
  return {
    calls: truncated ? calls.slice(-TRACE_MAX_CALLS) : calls,
    ...(truncated ? { truncated: true } : {}),
  }
}

const SECRET_KEY = /token|secret|password|passwd|api[-_]?key|authorization|cookie|credential|private[-_]?key/i

/**
 * Redact and truncate a raw tool-argument JSON string for presentation.
 * Unparseable arguments are replaced wholesale so a malformed secret cannot
 * leak through a best-effort text slice.
 */
export function previewArguments(raw: unknown, limit = TRACE_MAX_PREVIEW_CHARS): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return '[unparseable arguments]'
  }
  let text: string
  try {
    text = JSON.stringify(redact(value, 0))
  } catch {
    return '[unrenderable arguments]'
  }
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text
}

function redact(value: unknown, depth: number): unknown {
  if (depth > 6) return '[depth-limit]'
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(item, depth + 1)
    }
    return out
  }
  if (typeof value === 'string' && value.length > 120) return `${value.slice(0, 119)}…`
  return value
}
