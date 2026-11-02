/**
 * Shared agent machinery for the inbound executors: one DSH agent session per
 * A2A context (create, or resume a persisted one), serialized turns, and
 * optional agent-preset composition so a spawned session actually carries
 * tools. Adapted from the createDshAgentExecutor pattern pioneered by
 * dsh-a2a (MIT).
 * @module dsh-a2a/server/exec/agent-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Part } from '../../protocol.ts'
import { previewArguments, type TraceCall } from '../trace.ts'

/** The slice of a live DSH `Agent` this runtime drives (structural mirror). */
export interface LiveAgent {
  readonly session: { readonly id?: string; deriveMessages(): readonly AgentMessage[] }
  send(message: AgentUserMessage, target: 'next-turn', wakeup: boolean): void
  whenIdle(): Promise<void>
  cancel(cause: string): void
  /**
   * Agent-scoped context. Optional so minimal test doubles stay valid; when
   * present it carries the live assistant-stream and error notifications that
   * make token streaming and failure propagation observable.
   */
  readonly ctx?: AgentContextLike
}

/** The slice of an agent-scoped Cordis context used for live notifications. */
export interface AgentContextLike {
  on(name: string, listener: (...args: unknown[]) => void): (() => void) | void
}

/** One derived history message. */
export interface AgentMessage {
  readonly role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  readonly content: readonly { readonly type: string; readonly text?: string }[]
}

/** One text content block handed to the agent. */
export interface AgentTextBlock {
  readonly type: 'text'
  readonly text: string
}

/** One durable image attachment block handed to the agent. */
export interface AgentImageBlock {
  readonly type: 'image'
  readonly attachment: unknown
}

/** One durable file attachment block handed to the agent. */
export interface AgentFileBlock {
  readonly type: 'file'
  readonly attachment: unknown
}

/** Content block accepted by the harness user-message codec. */
export type AgentContentBlock = AgentTextBlock | AgentImageBlock | AgentFileBlock

/** One user message handed to the agent. */
export interface AgentUserMessage {
  readonly id: string
  readonly role: 'user'
  readonly content: readonly AgentContentBlock[]
  readonly source: { readonly kind: 'a2a' }
}

/** One text delta observed on the live assistant stream. */
export type TurnStreamEvent =
  | { readonly type: 'text-delta'; readonly text: string }

/** Per-turn options: live observation only; the turn's result remains the return value. */
export interface RunTurnOptions {
  readonly onEvent?: (event: TurnStreamEvent) => void
  /** Receives redacted tool lifecycle observations when trace is activated. */
  readonly onTrace?: (call: TraceCall) => void
}

/** Structural slice of the attachment store used to admit A2A file parts. */
export interface AttachmentsLike {
  admitPromptContent(content: readonly AttachmentAdmissionPart[]): Promise<readonly AgentContentBlock[]>
  admitEncodedFile(input: { readonly data: string; readonly name?: string }): Promise<unknown>
}

/** One prompt part before image/file admission. */
export type AttachmentAdmissionPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mediaType: string; readonly name?: string }
  | { readonly type: 'file'; readonly attachment: unknown }

/** Owned agent plus its capability disposer (structural mirror of AgentHandle). */
export interface AgentHandle {
  readonly agent: LiveAgent
  dispose(): Promise<void>
}

/** Structural slice of `ctx.agents` this runtime calls. */
export interface AgentRegistryLike {
  create(options: {
    readonly sessionId: string
    readonly meta?: { readonly cwd?: string; readonly agentPreset?: string }
    readonly agentOptions?: { readonly provider?: string; readonly model?: string; readonly maxTokens?: number }
    readonly setup?: (agentCtx: unknown) => void | Promise<void>
  }): Promise<AgentHandle>
  resume(options: {
    readonly resumeSessionId: string
    readonly agentOptions?: { readonly provider?: string; readonly model?: string; readonly maxTokens?: number }
    readonly setup?: (agentCtx: unknown) => void | Promise<void>
  }): Promise<AgentHandle>
}

/** Structural slice of `ctx.agentPresets` (preset roster). */
export interface AgentPresetsLike {
  resolve(id?: string): Promise<{ readonly id: string; readonly name?: string }>
  mount(agentCtx: unknown, id: string): Promise<unknown>
  /** Standing scope key of a preset's mount (no agent required; undefined = default preset). */
  standingKeyFor?(id?: string): Promise<unknown>
}

/** One skill-catalogue row as `ctx.skills.list()` returns it. */
export interface SkillRowLike {
  readonly name: string
  readonly description?: string
  readonly whenToUse?: string
  readonly invocation?: { readonly modelInvocable?: boolean }
}

/** Structural slice of `ctx.skills` (the skill registry). */
export interface SkillsLike {
  list(options: { readonly scope?: unknown }): Promise<readonly SkillRowLike[]>
}

/** Structural slice of `ctx.credentials` (env-var-name credential refs). */
export interface CredentialsLike {
  /** Resolve one env-var name to its current value (layered, per call). */
  resolve(ref: string): Promise<{ readonly value: string } | undefined>
  /** Store/overwrite a value for an env-var name in the managed layer. */
  set(ref: string, value: string): Promise<void>
  /** Clear a stored value for an env-var name. */
  unset(ref: string): Promise<void>
}

/** Runtime options shared by the executors. */
export interface AgentRuntimeOptions {
  /** Absolute cwd frozen into each spawned session's durable header. */
  readonly cwd: string
  /** Optional per-task model resolution (reads the deployment default). */
  readonly resolveAgentOptions?: () => { readonly provider?: string; readonly model?: string; readonly maxTokens?: number } | undefined
  /** Preset roster; when present every spawned session joins the default preset. */
  readonly agentPresets?: AgentPresetsLike
  /** When set, every spawned session joins THIS preset id instead of the deployment default. */
  readonly presetId?: () => string | undefined
  /** Attachment store used to turn A2A raw file/image parts into durable references. */
  readonly attachments?: AttachmentsLike
  /** Stable namespace mixed into the derived session id (inbound server id). */
  readonly sessionNamespace?: string
  /** Once-per-context hook after the first prompt lands (cosmetic naming). */
  readonly onSessionOpened?: (info: { readonly sessionId: string; readonly contextId: string; readonly firstPrompt: string }) => void | Promise<void>
  /**
   * Lift a stale archive flag before the first turn of an opened session.
   * DSH's archived-session gate rejects every proposed step, so an archived
   * session completes a turn with no assistant text at all; an inbound task is
   * explicit activity, so the host revives the session instead of failing.
   */
  readonly reviveArchivedSession?: (sessionId: string) => void | Promise<void>
}

/** An error raised when a turn is canceled by its caller. */
export class AgentTurnCanceled extends Error {
  constructor() {
    super('a2a: turn canceled')
    this.name = 'AgentTurnCanceled'
  }
}

/**
 * Per-context session pool: one live DSH agent per A2A contextId, created or
 * resumed through the registry, turns serialized per context, every session
 * disposeable on teardown.
 */
export class ContextSessionPool {
  private readonly handles = new Map<string, AgentHandle>()
  private readonly openings = new Map<string, Promise<AgentHandle>>()
  /** Per-context promise chain: a turn waits for the previous turn to settle. */
  private readonly tails = new Map<string, Promise<void>>()

  constructor(
    private readonly agents: AgentRegistryLike,
    private readonly opts: AgentRuntimeOptions,
  ) {}

  /** Session id derived from the A2A context id and instance namespace (stable across restarts). */
  static sessionIdFor(contextId: string, namespace?: string): string {
    return namespace !== undefined && namespace.length > 0 ? `a2a-${namespace}-${contextId}` : `a2a-${contextId}`
  }

  /** Get or open the live agent for a context; errors propagate. */
  async agentFor(contextId: string): Promise<{ readonly agent: LiveAgent; readonly sessionId: string; readonly justOpened: boolean }> {
    const justOpened = !this.handles.has(contextId) && !this.openings.has(contextId)
    const handle = await this.openHandle(contextId)
    return {
      agent: handle.agent,
      sessionId: ContextSessionPool.sessionIdFor(contextId, this.opts.sessionNamespace),
      justOpened,
    }
  }

  /** Open (or resume) the live handle with a per-context single-flight guard. */
  private async openHandle(contextId: string): Promise<AgentHandle> {
    const existing = this.handles.get(contextId)
    if (existing !== undefined) return existing
    const opening = this.openings.get(contextId)
    if (opening !== undefined) return opening
    const promise = this.openHandleUncached(contextId)
    this.openings.set(contextId, promise)
    try {
      const handle = await promise
      this.handles.set(contextId, handle)
      return handle
    } finally {
      if (this.openings.get(contextId) === promise) this.openings.delete(contextId)
    }
  }

  private async openHandleUncached(contextId: string): Promise<AgentHandle> {
    const sessionId = ContextSessionPool.sessionIdFor(contextId, this.opts.sessionNamespace)
    const agentOptions = this.opts.resolveAgentOptions?.()
    const withModel = agentOptions ? { agentOptions } : {}
    const presets = this.opts.agentPresets
    let presetId: string | undefined
    let setup: ((agentCtx: unknown) => Promise<void>) | undefined
    if (presets !== undefined) {
      const wanted = this.opts.presetId?.() ?? undefined
      presetId = (wanted !== undefined ? await presets.resolve(wanted) : await presets.resolve()).id
      setup = async (agentCtx: unknown): Promise<void> => {
        await presets.mount(agentCtx, presetId!)
      }
    }
    const meta: { readonly cwd: string; readonly agentPreset?: string } = presetId
      ? { cwd: this.opts.cwd, agentPreset: presetId }
      : { cwd: this.opts.cwd }
    const createOptions = {
      sessionId,
      meta,
      ...withModel,
      ...(setup ? { setup } : {}),
    }
    let handle: AgentHandle
    try {
      handle = await this.agents.create(createOptions)
    } catch (err) {
      // DSH raises `session "x" already exists` / `... is already owned by an
      // active write handle`; both must resume, not fail the task.
      if (/already (has|owns|exists|owned)|persisted/i.test((err as Error).message)) {
        handle = await this.agents.resume({ resumeSessionId: sessionId, ...withModel, ...(setup ? { setup } : {}) })
      } else {
        throw err
      }
    }
    // Best effort: an archived session rejects every step (turn ends blocked
    // with no assistant text), so revive it before the first turn runs.
    try {
      await this.opts.reviveArchivedSession?.(sessionId)
    } catch {
      // Revival is an optimization; a failed unarchive must not fail the task.
    }
    return handle
  }

  /** True while this pool holds a live handle for the context. */
  has(contextId: string): boolean {
    return this.handles.has(contextId)
  }

  /** The live context's derived conversation, or an empty list when not open. */
  messages(contextId: string): readonly AgentMessage[] {
    return this.handles.get(contextId)?.agent.session.deriveMessages() ?? []
  }

  /**
   * Convert A2A parts into durable prompt content. Text and data parts become
   * text; raw image/file parts are admitted through the attachment store so the
   * DSH session receives real attachments rather than URL placeholders.
   */
  async contentBlocks(parts: readonly Part[]): Promise<AgentContentBlock[]> {
    if (parts.length === 0) return []
    const attachments = this.opts.attachments
    const admission: AttachmentAdmissionPart[] = []
    const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
    for (const part of parts) {
      if ('text' in part && typeof part.text === 'string') {
        admission.push({ type: 'text', text: part.text })
        continue
      }
      if ('data' in part && part.data !== undefined) {
        admission.push({ type: 'text', text: JSON.stringify(part.data) })
        continue
      }
      if ('raw' in part && typeof part.raw === 'string') {
        if (attachments !== undefined) {
          if (part.mediaType !== undefined && imageTypes.has(part.mediaType)) {
            admission.push({
              type: 'image',
              data: part.raw,
              mediaType: part.mediaType,
              ...(part.filename !== undefined ? { name: part.filename } : {}),
            })
            continue
          }
          try {
            const ref = await attachments.admitEncodedFile({
              data: part.raw,
              ...(part.filename !== undefined ? { name: part.filename } : {}),
            })
            admission.push({ type: 'file', attachment: ref })
            continue
          } catch {
            // Fall through to the textual placeholder for an unadmittable file.
          }
        }
        admission.push({ type: 'text', text: filePlaceholder(part) })
        continue
      }
      if ('url' in part && typeof part.url === 'string') {
        admission.push({ type: 'text', text: part.url })
        continue
      }
      if ('filename' in part) admission.push({ type: 'text', text: filePlaceholder(part) })
    }
    if (attachments === undefined) return admission.map((part) => part.type === 'text' ? { type: 'text', text: part.text } : { type: 'text', text: '[attachment unavailable]' })
    try {
      return [...await attachments.admitPromptContent(admission)]
    } catch {
      // A refused attachment must not silently disappear; keep a readable
      // placeholder so the agent can explain what the caller sent.
      return admission.map((part) => part.type === 'text'
        ? { type: 'text', text: part.text }
        : { type: 'text', text: part.type === 'image' ? `[image ${part.name ?? part.mediaType} rejected]` : '[file attachment rejected]' })
    }
  }

  /**
   * Dispose ONE context's session (the caller aborts its active tasks first).
   * Removes the handle and its serialization tail, disposes the handle, and
   * lets a non-cooperative in-flight turn drain in the background. Returns
   * whether a handle was held.
   *
   * Close is an in-memory resource release, NOT a conversation tombstone: the
   * A2A protocol has no "closed context" notion, so the next task on the same
   * contextId simply re-opens a fresh handle through `agentFor` (and the host
   * agent runtime may or may not resume persisted history — host behavior).
   */
  async disposeContext(contextId: string): Promise<boolean> {
    const handle = this.handles.get(contextId)
    if (handle === undefined) return false
    this.handles.delete(contextId)
    const tail = this.tails.get(contextId)
    this.tails.delete(contextId)
    // Disposing the handle is the cancellation signal for the host runtime.
    // Do not block the control path on a tail whose executor ignores abort:
    // the task has already been settled by its AbortController, and the turn
    // drains (or is torn down by the handle) in the background.
    await Promise.allSettled([handle.dispose()])
    if (tail !== undefined) void tail.catch(() => {})
    return true
  }

  /**
   * Run one turn on a context's session, serialized behind the previous turn.
   * The return value is this turn's assistant text, not the agent's global last
   * assistant message; errors and cancellations are surfaced to the caller.
   */
  async runTurn(contextId: string, prompt: string | readonly Part[], signal: AbortSignal, options: RunTurnOptions = {}): Promise<string> {
    const previous = this.tails.get(contextId) ?? Promise.resolve()
    const run = previous.catch(() => {}).then(() => this.runTurnExclusive(contextId, prompt, signal, options))
    const tail = run.then(() => {}, () => {})
    this.tails.set(contextId, tail)
    try {
      return await run
    } finally {
      if (this.tails.get(contextId) === tail) this.tails.delete(contextId)
    }
  }

  private async runTurnExclusive(contextId: string, prompt: string | readonly Part[], signal: AbortSignal, options: RunTurnOptions): Promise<string> {
    const { agent, sessionId, justOpened } = await this.agentFor(contextId)
    const promptText = typeof prompt === 'string' ? prompt : partsToText(prompt)
    const content = typeof prompt === 'string' ? [{ type: 'text' as const, text: prompt }] : await this.contentBlocks(prompt)
    const onAbort = (): void => agent.cancel('a2a-canceled')
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })

    let failure: unknown
    const disposers: Array<() => void> = []
    const listen = (name: string, listener: (...args: unknown[]) => void): void => {
      try {
        const dispose = agent.ctx?.on(name, listener)
        if (typeof dispose === 'function') disposers.push(dispose)
      } catch {
        // Notification support is optional in minimal harnesses.
      }
    }
    listen('agent/error', (payload) => {
      const value = payload as { readonly agent?: unknown; readonly error?: unknown }
      if (value.agent !== undefined && value.agent !== agent) return
      failure = value.error
    })
    listen('agent/assistant-stream', (payload) => {
      const value = payload as { readonly agent?: unknown; readonly frame?: AssistantStreamPayload }
      if (value.agent !== undefined && value.agent !== agent) return
      const frame = value.frame
      if (frame?.type !== 'chunk') return
      const chunk = frame.chunk
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
        options.onEvent?.({ type: 'text-delta', text: chunk.text })
      }
    })

    // Trace is metadata-only: observe tool lifecycle, never the result content.
    const openCalls = new Map<string, { readonly tool: string; readonly startedAt: number }>()
    const emitTrace = (call: TraceCall): void => options.onTrace?.(call)
    if (options.onTrace !== undefined) {
      listen('session/event', (...args) => {
        const [session, event] = args as [ { readonly id?: string } | undefined, SessionEventLike | undefined ]
        if (session?.id !== undefined && session.id !== sessionId) return
        if (event === undefined) return
        const at = typeof event.time === 'number' ? event.time : Date.now()
        if (event.type === 'tool/call') {
          const data = event.data as ToolCallData | undefined
          const callId = typeof data?.callId === 'string' ? data.callId : ''
          if (callId.length === 0) return
          const tool = typeof data?.name === 'string' && data.name.length > 0 ? data.name : 'tool'
          const argsPreview = previewArguments(data?.arguments)
          openCalls.set(callId, { tool, startedAt: at })
          emitTrace({
            callId,
            tool,
            phase: 'start',
            status: 'running',
            ...(argsPreview !== undefined ? { argsPreview } : {}),
            timestamp: new Date(at).toISOString(),
          })
          return
        }
        if (event.type === 'tool/result') {
          const data = event.data as ToolResultData | undefined
          const callId = typeof data?.message?.toolCallId === 'string' ? data.message.toolCallId : ''
          if (callId.length === 0) return
          const started = openCalls.get(callId)
          openCalls.delete(callId)
          const tool = started?.tool ?? 'tool'
          const durationMs = started === undefined ? undefined : Math.max(0, at - started.startedAt)
          emitTrace({
            callId,
            tool,
            phase: 'end',
            status: data?.message?.isError === true ? 'error' : 'ok',
            ...(durationMs !== undefined ? { durationMs } : {}),
            timestamp: new Date(at).toISOString(),
          })
        }
      })
    }

    const baseline = agent.session.deriveMessages().length
    const userMessage: AgentUserMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      // A producer-owned source kind: the v4 session codec refuses the
      // retired shared `plugin` wrapper (SessionFormatError), which left the
      // inbound turn with no durable message. `a2a` is this plugin's own kind.
      source: { kind: 'a2a' },
    }
    try {
      agent.send(userMessage, 'next-turn', true)
      if (justOpened) {
        try {
          await this.opts.onSessionOpened?.({ sessionId, contextId, firstPrompt: promptText })
        } catch {
          // Cosmetic naming must never fail the task.
        }
      }
      await agent.whenIdle()
      if (failure !== undefined) throw toError(failure)
      const messages = agent.session.deriveMessages().slice(baseline)
      const reply = lastAssistantText(messages)
      if (signal.aborted && reply.length === 0) throw new AgentTurnCanceled()
      return reply
    } finally {
      for (const [callId, started] of openCalls) {
        emitTrace({
          callId,
          tool: started.tool,
          phase: 'end',
          status: 'unknown',
          durationMs: Math.max(0, Date.now() - started.startedAt),
          timestamp: new Date().toISOString(),
        })
      }
      openCalls.clear()
      for (const dispose of disposers.splice(0)) {
        try { dispose() } catch { /* listener already gone */ }
      }
    }
  }

  /** Dispose every live per-context session (called on plugin unload). */
  async disposeAll(): Promise<void> {
    const live = [...this.handles.values()]
    const openings = [...this.openings.values()]
    const pending = [...this.tails.values()]
    this.handles.clear()
    this.openings.clear()
    this.tails.clear()
    await Promise.allSettled(openings)
    await Promise.allSettled(live.map((h) => h.dispose()))
    for (const tail of pending) void tail.catch(() => {})
  }
}

/** Structural shape of one assistant-stream frame (only the fields we consume). */
interface AssistantStreamPayload {
  readonly type?: string
  readonly chunk?: {
    readonly type?: string
    readonly text?: string
  }
}

/** Structural slice of one session event used for trace observation. */
interface SessionEventLike {
  readonly type?: string
  readonly time?: number
  readonly data?: unknown
}

interface ToolCallData {
  readonly callId?: unknown
  readonly name?: unknown
  readonly arguments?: unknown
}

interface ToolResultData {
  readonly message?: { readonly toolCallId?: unknown; readonly isError?: unknown }
}

/** Read the last assistant message's text off a derived-history slice. */
function lastAssistantText(history: readonly AgentMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i]
    if (message === undefined) continue
    if (message.role === 'assistant') {
      return message.content
        .filter((b) => b.type === 'text')
        .map((b) => (typeof b.text === 'string' ? b.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim()
    }
  }
  return ''
}

/** Text rendering of A2A parts for titles and text-only fallbacks. */
function partsToText(parts: readonly Part[]): string {
  return parts.map((part) => {
    if ('text' in part && typeof part.text === 'string') return part.text
    if ('data' in part && part.data !== undefined) return JSON.stringify(part.data)
    if ('url' in part && typeof part.url === 'string') return part.url
    if ('filename' in part) return filePlaceholder(part)
    return ''
  }).filter(Boolean).join('\n')
}

function filePlaceholder(part: { readonly filename?: string; readonly mediaType?: string }): string {
  return `[file ${part.filename ?? part.mediaType ?? 'binary'}]`
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Probe for a readable service method via the reflection layer WITHOUT taking
 * an inject dependency (optional services). Returns undefined when the service
 * is absent or the method missing.
 */
export function probeService(ctx: Context, name: string, method: string): unknown {
  try {
    const reflect = (ctx as unknown as { reflect?: { get(n: string, strict?: boolean): unknown } }).reflect
    const svc = reflect?.get(name, true)
    if (svc !== undefined && svc !== null && typeof (svc as Record<string, unknown>)[method] === 'function') return svc
  } catch {
    // reflection unavailable or resolution threw — treat as absent
  }
  return undefined
}
