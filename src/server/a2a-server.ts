/**
 * The inbound A2A server: JSON-RPC dispatch, the task lifecycle, and SSE
 * streaming. Transport-agnostic — `handle` / `handleStream` take a structural
 * request and return bytes; the HTTP binding lives in routes.ts.
 * @module dsh-a2a/server/a2a-server
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import {
  A2A_ERROR_CODES,
  A2A_EXTENSIONS_HEADER,
  A2A_METHODS,
  INTERRUPTED_STATES,
  PROTOCOL_VERSION,
  Role,
  TaskState,
  isTerminal,
  partsToText,
  type AgentCard,
  type JsonRpcRequest,
  type ListTasksResponse,
  type Message,
  type Part,
  type StreamResponse,
  type Task,
} from '../protocol.ts'
import { parseRpc, rpcError, rpcSuccess } from '../jsonrpc.ts'
import type { TaskStore, TaskRecord } from './store.ts'
import { ScopedTaskStore } from './store.ts'
import type { A2aExecutorEvent, ExecutorSet } from './executor.ts'
import { SlidingWindowLimiter } from './rate-limit.ts'
import type { A2aMetrics } from './metrics.ts'
import { TRACE_EXTENSION_URI } from './trace.ts'

/** What the policy gate sees for one inbound task. */
export interface GateInput {
  readonly contextId: string
  readonly skill: string
  readonly parts: readonly Part[]
  readonly remotePeerId: string | null
}

export type GateResult = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/** Observational facts about one inbound JSON-RPC request. */
export interface InboundFacts {
  readonly method: string
  readonly source?: string
  readonly taskIds: readonly string[]
  readonly streaming: boolean
}

export interface A2AServerOptions {
  readonly card: AgentCard
  readonly store: TaskStore
  readonly executors: ExecutorSet
  /** Present when inbound bearer auth is configured. */
  readonly authToken?: string
  /**
   * This instance's id, stamped onto every task record it creates so views
   * can attribute a task (and its session) to the inbound instance it came
   * through. Absent in unit harnesses → records stay unattributed.
   */
  readonly serverId?: string
  /** Policy gate: skill allow-list + the `a2a/inbound-task` waterfall. */
  readonly gate: (input: GateInput) => Promise<GateResult>
  readonly onInbound?: (facts: InboundFacts) => void
  readonly onTaskCreated?: (taskId: string) => void
  readonly onTaskSettled?: (taskId: string) => void
  /** One SSE subscription opened for a task (per subscriber, so counts). */
  readonly onStreamOpen?: (info: { readonly taskId: string; readonly contextId: string }) => void
  /** One SSE subscription for a task closed (terminal frame delivered). */
  readonly onStreamClose?: (taskId: string) => void
  /** AgentCard route path for this instance; default = well-known A2A path. */
  readonly cardPath?: string
  /**
   * Build the AgentCard served for one request. Used by instances whose
   * advertised base URL is dynamic (derived from the request's forwarded
   * host), so the card reflects the address the client actually used.
   */
  readonly cardForRequest?: (req: ServerRequest) => AgentCard
  /** Per-task execution budget in milliseconds; 0/undefined disables it. */
  readonly taskTimeoutMs?: number
  /** Sliding-window request cap per source; 0/undefined disables it. */
  readonly requestsPerMinute?: number
  /** Maximum concurrently executing tasks for this instance; 0/undefined disables it. */
  readonly maxConcurrentTasks?: number
  /** In-memory SSE event log size per task (reconnect replay). */
  readonly maxEventLog?: number
  /** When true, this instance may activate the optional trace extension. */
  readonly traceEnabled?: boolean
  readonly metrics?: A2aMetrics
}

/** Structural request the server handles (HTTP adapter fills it). */
export interface ServerRequest {
  readonly method?: string
  readonly url?: string
  readonly headers?: Record<string, string>
  readonly socket?: { readonly remoteAddress?: string; readonly remotePort?: number }
}

export interface ServerResponseSpec {
  readonly status: number
  readonly contentType: string
  readonly body: string
  readonly headers?: Record<string, string>
}

interface EnsuredTask {
  readonly record: TaskRecord
  readonly replay: boolean
  readonly created: boolean
  readonly continuation: boolean
}

interface LoggedEvent {
  readonly id: number
  readonly frame: StreamResponse
}

/** A2A JSON-RPC / SSE server over a structural request. */
export class A2AServer {
  card: AgentCard
  private readonly listeners = new Map<string, Set<(frame: StreamResponse, eventId?: number) => void>>()
  private readonly waiters = new Map<string, Set<() => void>>()
  private readonly running = new Map<string, AbortController>()
  private readonly eventLogs = new Map<string, LoggedEvent[]>()
  private readonly limiter: SlidingWindowLimiter | undefined
  private readonly maxEventLog: number
  private nextEventId = 1

  constructor(private readonly opts: A2AServerOptions) {
    this.card = opts.card
    // Defense in depth: even if a caller passes the shared store directly,
    // a serverId-bound server still refuses another instance's tasks.
    if (opts.serverId !== undefined && !(opts.store instanceof ScopedTaskStore)) {
      this.opts = { ...opts, store: new ScopedTaskStore(opts.store, opts.serverId) }
    }
    this.limiter = opts.requestsPerMinute !== undefined && opts.requestsPerMinute > 0
      ? new SlidingWindowLimiter(opts.requestsPerMinute, 60_000)
      : undefined
    this.maxEventLog = opts.maxEventLog ?? 200
  }

  /** Swap the served AgentCard (runtime identity edits). Routes re-read `server.card` on every request. */
  setCard(next: AgentCard): void {
    this.card = next
  }

  /** The AgentCard route path for this instance. */
  cardPath(): string {
    return this.opts.cardPath ?? '/.well-known/agent-card.json'
  }

  /** Extensions this request successfully activates (only optional trace today). */
  activatedExtensions(req: ServerRequest): readonly string[] {
    if (this.opts.traceEnabled !== true) return []
    const raw = headerValue(req, A2A_EXTENSIONS_HEADER)
    if (raw === undefined) return []
    const requested = raw.split(',').map((value) => value.trim()).filter((value) => value.length > 0)
    return requested.includes(TRACE_EXTENSION_URI) ? [TRACE_EXTENSION_URI] : []
  }

  /** Response headers that acknowledge activated extensions. */
  responseHeaders(req: ServerRequest): Record<string, string> {
    const activated = this.activatedExtensions(req)
    return activated.length > 0 ? { [A2A_EXTENSIONS_HEADER]: activated.join(', ') } : {}
  }

  /**
   * Abort a running task by control path (facade /a2a task cancel): abort the
   * executor's signal, settle the task CANCELED, and wake stream waiters.
   * @returns false when the task is unknown or already terminal.
   */
  abort(taskId: string): boolean {
    const record = this.opts.store.get(taskId)
    if (record === undefined || isTerminal(record.state)) return false
    this.running.get(taskId)?.abort()
    this.opts.store.setState(taskId, TaskState.CANCELED, { code: 'canceled', text: 'Task canceled' })
    this.emit(taskId, { statusUpdate: { taskId, contextId: record.contextId, status: statusOf(this.opts.store.get(taskId)!) } })
    this.settle(taskId)
    return true
  }

  /** True when the request carries the configured bearer token. */
  authorized(req: ServerRequest): boolean {
    const token = this.opts.authToken
    if (!token) return true
    const header = req.headers?.['authorization'] ?? ''
    const match = /^Bearer\s+(.+)$/i.exec(header.trim())
    if (match === null || match[1] === undefined) return false
    const expected = createHash('sha256').update(token).digest()
    const provided = createHash('sha256').update(match[1]).digest()
    return timingSafeEqual(expected, provided)
  }

  /**
   * Check request-rate and bearer auth before an HTTP binding commits a 200/SSE
   * status. Returns the rejection response, or undefined when the request may
   * proceed. `handle`/`handleStream` call this themselves; the route layer
   * calls it before it writes SSE headers and then marks the stream as
   * preflighted so counters are not charged twice.
   */
  preflight(req: ServerRequest): ServerResponseSpec | undefined {
    const limited = this.limit(req)
    if (limited !== undefined) return limited
    if (!this.authorized(req)) {
      this.opts.metrics?.recordAuthFailure(this.opts.serverId, 'unknown', sourceOf(req))
      return {
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify(rpcError(null, -32040, 'Unauthorized')),
        headers: { 'WWW-Authenticate': 'Bearer' },
      }
    }
    return undefined
  }

  /**
   * The AgentCard to advertise for one request: the static card unless a
   * `cardForRequest` hook is configured (used by the `auto` base URL mode).
   * Routes that serve the card directly must go through this, not `.card`.
   */
  cardFor(req: ServerRequest): AgentCard {
    return this.opts.cardForRequest?.(req) ?? this.card
  }

  /** Route one inbound HTTP request (GET card, POST JSON-RPC). */
  async handle(req: ServerRequest, body: string): Promise<ServerResponseSpec> {
    const path = (req.url ?? '').split('?')[0] ?? ''
    const card = this.cardFor(req)
    if (req.method === 'GET' && path === this.cardPath()) {
      return { status: 200, contentType: 'application/json', body: JSON.stringify(card), headers: { 'A2A-Version': PROTOCOL_VERSION } }
    }
    if (req.method !== 'POST' || path !== endpointOf(card)) {
      return { status: 404, contentType: 'text/plain', body: 'Not Found' }
    }
    const rejected = this.preflight(req)
    if (rejected !== undefined) return rejected
    const version = requestedVersion(req)
    if (version !== undefined && !sameProtocol(version)) {
      return {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(rpcError(null, A2A_ERROR_CODES.VERSION_NOT_SUPPORTED, `Unsupported A2A-Version ${version}; this endpoint implements ${PROTOCOL_VERSION}`)),
        headers: { 'A2A-Version': PROTOCOL_VERSION },
      }
    }
    const rpc = parseRpc(body)
    if (rpc === undefined) {
      return {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(rpcError(null, A2A_ERROR_CODES.INVALID_REQUEST, 'Invalid JSON-RPC request')),
        headers: { 'A2A-Version': PROTOCOL_VERSION },
      }
    }
    this.opts.metrics?.recordRequest(this.opts.serverId, rpc.method, sourceOf(req))
    const activated = this.activatedExtensions(req)
    const responseHeaders = { ...this.responseHeaders(req), 'A2A-Version': PROTOCOL_VERSION }
    try {
      const result = await this.dispatch(rpc, activated)
      const source = sourceOf(req)
      this.opts.onInbound?.({
        method: rpc.method,
        ...(source !== undefined ? { source } : {}),
        taskIds: extractTaskIds(result),
        streaming: false,
      })
      return {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(rpcSuccess(rpc.id, result)),
        headers: responseHeaders,
      }
    } catch (err) {
      const e = err as { code?: number; message?: string; data?: unknown }
      return {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(rpcError(rpc.id, typeof e.code === 'number' ? e.code : A2A_ERROR_CODES.INTERNAL_ERROR, e.message ?? String(err), e.data)),
        headers: responseHeaders,
      }
    }
  }

  /**
   * Route one SSE request (SendStreamingMessage / SubscribeToTask). Frames are
   * pushed to `onEvent` as they happen; the caller must have checked
   * `authorized()` before writing 200 headers.
   */
  async handleStream(req: ServerRequest, body: string, onEvent: (frame: string) => void, options: { readonly preflighted?: boolean } = {}): Promise<{ readonly status: number; readonly headers?: Record<string, string> }> {
    if (req.method !== 'POST') {
      onEvent(formatError(null, 404, 'Not Found'))
      return { status: 200 }
    }
    if (options.preflighted !== true) {
      const rejected = this.preflight(req)
      if (rejected !== undefined) return { status: rejected.status, ...(rejected.headers !== undefined ? { headers: rejected.headers } : {}) }
    }
    const rpc = parseRpc(body)
    if (rpc === undefined) {
      onEvent(formatError(null, A2A_ERROR_CODES.INVALID_REQUEST, 'Invalid JSON-RPC request'))
      return { status: 200 }
    }
    const rpcId = rpc.id ?? null
    const version = requestedVersion(req)
    if (version !== undefined && !sameProtocol(version)) {
      onEvent(formatError(rpcId, A2A_ERROR_CODES.VERSION_NOT_SUPPORTED, `Unsupported A2A-Version ${version}; this endpoint implements ${PROTOCOL_VERSION}`))
      return { status: 200, headers: { 'A2A-Version': PROTOCOL_VERSION } }
    }
    if (rpc.method !== A2A_METHODS.sendStreamingMessage && rpc.method !== A2A_METHODS.subscribeToTask) {
      onEvent(formatError(rpcId, A2A_ERROR_CODES.METHOD_NOT_FOUND, `Unknown method ${rpc.method ?? ''}`))
      return { status: 200 }
    }
    this.opts.metrics?.recordRequest(this.opts.serverId, rpc.method, sourceOf(req))

    const params = (rpc.params ?? {}) as { message?: Message; id: string | undefined; configuration?: { acceptedOutputModes?: readonly string[]; historyLength?: number } }
    const historyLength = typeof params.configuration?.historyLength === 'number' ? params.configuration.historyLength : undefined
    const trace = this.activatedExtensions(req).includes(TRACE_EXTENSION_URI)
    let record: TaskRecord | undefined
    let shouldRun = false
    if (rpc.method === A2A_METHODS.sendStreamingMessage) {
      try {
        if (params.message === undefined) {
          onEvent(formatError(rpcId, A2A_ERROR_CODES.INVALID_PARAMS, 'Missing message'))
          return { status: 200 }
        }
        const configuration = params.configuration
        if (!acceptsText(configuration?.acceptedOutputModes)) {
          onEvent(formatError(rpcId, A2A_ERROR_CODES.CONTENT_TYPE_NOT_SUPPORTED, 'This agent produces text/plain output'))
          return { status: 200 }
        }
        const gateOutcome = await this.opts.gate(this.gateInputFor(params.message, this.remotePeerOf(req)))
        if (!gateOutcome.ok) {
          onEvent(formatError(rpcId, -32000, gateOutcome.reason))
          return { status: 200 }
        }
        const ensured = this.ensureTask(params.message, this.remotePeerOf(req))
        record = ensured.record
        shouldRun = !ensured.replay
        this.noteInbound(req, rpc.method, [record.taskId], true)
      } catch (err) {
        const error = err as { code?: number; message?: string }
        onEvent(formatError(rpcId, typeof error.code === 'number' ? error.code : A2A_ERROR_CODES.INTERNAL_ERROR, error.message ?? String(err)))
        return { status: 200 }
      }
    } else {
      const id = params.id
      if (id === undefined) {
        onEvent(formatError(rpcId, A2A_ERROR_CODES.INVALID_PARAMS, 'Missing task id'))
        return { status: 200 }
      }
      record = this.opts.store.get(id)
      this.noteInbound(req, rpc.method, id ? [id] : [], true)
      if (record === undefined) {
        onEvent(formatError(rpcId, A2A_ERROR_CODES.TASK_NOT_FOUND, `Task ${id} not found`))
        return { status: 200 }
      }
      if (isTerminal(record.state)) {
        onEvent(formatError(rpcId, A2A_ERROR_CODES.UNSUPPORTED_OPERATION, `Task ${id} is already in terminal state ${record.state}`))
        return { status: 200 }
      }
    }

    const sub = (frame: StreamResponse, eventId?: number): void => onEvent(formatResult(rpcId, frame, eventId))
    let listeners = this.listeners.get(record.taskId)
    if (listeners === undefined) {
      listeners = new Set()
      this.listeners.set(record.taskId, listeners)
    }
    // Capture the log ceiling before attaching the listener. Events emitted
    // after this point are delivered live and must not also be replayed.
    const replayCeiling = this.nextEventId - 1
    listeners.add(sub)
    try {
      this.opts.onStreamOpen?.({ taskId: record.taskId, contextId: record.contextId })
      // The spec requires the first streamed event to be the current Task;
      // status/artifact frames follow it (or replay after a cursor).
      const current = this.opts.store.get(record.taskId)
      if (current !== undefined) sub({ task: toTask(current, true, historyLength, true) })
      if (shouldRun) void this.runTask(record, trace, historyLength)
      const lastEventId = parseEventId(req.headers?.['last-event-id'])
      if (lastEventId !== undefined) this.replay(record.taskId, lastEventId, replayCeiling, sub)
      await this.waitTerminal(record.taskId)
      const finalRecord = this.opts.store.get(record.taskId)
      if (finalRecord !== undefined) sub({ task: toTask(finalRecord, true, historyLength, true) })
    } finally {
      listeners.delete(sub)
      if (listeners.size === 0) this.listeners.delete(record.taskId)
      this.opts.onStreamClose?.(record.taskId)
    }
    return { status: 200, headers: { 'A2A-Version': PROTOCOL_VERSION, ...this.responseHeaders(req) } }
  }

  /**
   * Submit one message from the dashboard test console (loopback admin path).
   * This is the same gate + task lifecycle as the wire endpoint, minus HTTP
   * auth, and is intentionally not exposed over the A2A endpoint.
   */
  async sendTest(message: Message): Promise<Task> {
    const gateOutcome = await this.opts.gate(this.gateInputFor(message, null))
    if (!gateOutcome.ok) throw rpcFault(A2A_ERROR_CODES.INVALID_PARAMS, gateOutcome.reason)
    const ensured = this.ensureTask(message, null)
    if (!ensured.replay) await this.runTask(ensured.record, false)
    else await this.waitTerminal(ensured.record.taskId)
    return toTask(this.opts.store.get(ensured.record.taskId) ?? ensured.record, true, undefined, true)
  }

  /** Dispatch one JSON-RPC request; throws {code, message} on errors. */
  private async dispatch(rpc: JsonRpcRequest, activated: readonly string[]): Promise<unknown> {
    const method = rpc.method
    const params = (rpc.params ?? {}) as Record<string, unknown>
    switch (method) {
      case A2A_METHODS.sendMessage: {
        const message = params['message'] as Message | undefined
        if (message === undefined) throw rpcFault(A2A_ERROR_CODES.INVALID_PARAMS, 'Missing message')
        const configuration = params['configuration'] as { returnImmediately?: boolean; historyLength?: number; acceptedOutputModes?: readonly string[] } | undefined
        if (!acceptsText(configuration?.acceptedOutputModes)) {
          throw rpcFault(A2A_ERROR_CODES.CONTENT_TYPE_NOT_SUPPORTED, 'This agent produces text/plain output')
        }
        const gateOutcome = await this.opts.gate(this.gateInputFor(message, null))
        if (!gateOutcome.ok) throw rpcFault(A2A_ERROR_CODES.INVALID_PARAMS, gateOutcome.reason)
        const ensured = this.ensureTask(message, null)
        const trace = activated.includes(TRACE_EXTENSION_URI)
        // handle() records this inbound after dispatch with the real source.
        if (!ensured.replay) {
          if (configuration?.returnImmediately === true) {
            void this.runTask(ensured.record, trace, configuration.historyLength)
            const current = this.opts.store.get(ensured.record.taskId) ?? ensured.record
            return { task: toTask(current, true, configuration.historyLength, true) }
          }
          await this.runTask(ensured.record, trace, configuration?.historyLength)
        } else if (configuration?.returnImmediately !== true) {
          await this.waitTerminal(ensured.record.taskId)
        }
        const settled = this.opts.store.get(ensured.record.taskId)
        return { task: toTask(settled ?? ensured.record, true, configuration?.historyLength, true) }
      }
      case A2A_METHODS.getTask: {
        const id = params['id'] as string | undefined
        if (id === undefined) throw rpcFault(A2A_ERROR_CODES.INVALID_PARAMS, 'Missing task id')
        const record = this.opts.store.get(id)
        if (record === undefined) throw rpcFault(A2A_ERROR_CODES.TASK_NOT_FOUND, `Task ${id} not found`)
        const historyLength = typeof params['historyLength'] === 'number' ? params['historyLength'] : undefined
        return toTask(record, true, historyLength, true)
      }
      case A2A_METHODS.listTasks:
        return this.listTasks(params)
      case A2A_METHODS.cancelTask: {
        const id = params['id'] as string | undefined
        if (id === undefined) throw rpcFault(A2A_ERROR_CODES.INVALID_PARAMS, 'Missing task id')
        const record = this.opts.store.get(id)
        if (record === undefined) throw rpcFault(A2A_ERROR_CODES.TASK_NOT_FOUND, `Task ${id} not found`)
        if (isTerminal(record.state)) throw rpcFault(A2A_ERROR_CODES.TASK_CANCEL_NOT_ALLOWED, `Task ${id} already in terminal state ${record.state}`)
        const controller = this.running.get(id)
        controller?.abort()
        this.opts.store.setState(id, TaskState.CANCELED, { code: 'canceled', text: 'Task canceled by caller' })
        this.emit(id, { statusUpdate: { taskId: id, contextId: record.contextId, status: statusOf(this.opts.store.get(id)!) } })
        this.settle(id)
        return toTask(this.opts.store.get(id)!)
      }
      case A2A_METHODS.getExtendedAgentCard:
        return this.card
      case A2A_METHODS.createTaskPushNotificationConfig:
      case A2A_METHODS.getTaskPushNotificationConfig:
      case A2A_METHODS.listTaskPushNotificationConfigs:
      case A2A_METHODS.deleteTaskPushNotificationConfig:
        throw rpcFault(A2A_ERROR_CODES.PUSH_NOTIFICATION_NOT_SUPPORTED, 'Push notifications are not supported by this agent')
      default:
        throw rpcFault(A2A_ERROR_CODES.METHOD_NOT_FOUND, `Unknown method ${method}`)
    }
  }

  /**
   * Gate input for a message, using the existing task's context/skill when the
   * message is a continuation or idempotent replay. This prevents a follow-up
   * without `metadata.skill` from being checked against the wrong skill.
   */
  private gateInputFor(message: Message, remotePeerId: string | null): GateInput {
    const task = message.taskId !== undefined ? this.opts.store.get(message.taskId) : undefined
    const replay = task === undefined && typeof message.messageId === 'string' && message.messageId.length > 0
      ? this.opts.store.list().find((record) => record.messageIds?.includes(message.messageId) === true)
      : undefined
    const existing = task ?? replay
    return {
      contextId: existing?.contextId ?? message.contextId ?? 'new',
      skill: existing?.skill ?? (message.metadata?.['skill'] as string | undefined) ?? 'chat',
      parts: message.parts,
      remotePeerId,
    }
  }

  /**
   * Bind one message to a task. A message with a `taskId` continues that task
   * (or returns it for an idempotent `messageId` replay); a messageId seen
   * before returns its original task. A task id outside this instance's scope
   * is indistinguishable from a missing task because the store is scoped.
   */
  private ensureTask(message: Message, remotePeerId: string | null): EnsuredTask {
    const serverId = this.opts.serverId
    const messageId = typeof message.messageId === 'string' && message.messageId.length > 0 ? message.messageId : undefined
    if (message.taskId !== undefined) {
      const existing = this.opts.store.get(message.taskId)
      if (existing === undefined) throw rpcFault(A2A_ERROR_CODES.TASK_NOT_FOUND, `Task ${message.taskId} not found`)
      if (message.contextId !== undefined && message.contextId !== existing.contextId) {
        throw rpcFault(A2A_ERROR_CODES.INVALID_PARAMS, `contextId ${message.contextId} does not match task ${existing.taskId}`)
      }
      if (messageId !== undefined && existing.messageIds?.includes(messageId) === true) {
        return { record: existing, replay: true, created: false, continuation: false }
      }
      if (isTerminal(existing.state)) {
        throw rpcFault(A2A_ERROR_CODES.UNSUPPORTED_OPERATION, `Task ${existing.taskId} is already in terminal state ${existing.state}`)
      }
      if (this.running.has(existing.taskId)) {
        throw rpcFault(A2A_ERROR_CODES.UNSUPPORTED_OPERATION, `Task ${existing.taskId} is still running; wait for it to settle or cancel it before continuing`)
      }
      // Record the visible continuation input before replacing `parts`; the
      // store seeds a legacy record's current input when `inputs` is absent.
      this.opts.store.appendInput(existing.taskId, message)
      const updated = this.opts.store.setParts(existing.taskId, message.parts)
      const withMessage = messageId !== undefined ? this.opts.store.appendMessageId(existing.taskId, messageId) : updated
      return { record: withMessage, replay: false, created: false, continuation: true }
    }
    if (messageId !== undefined) {
      const replay = this.opts.store.list().find((record) => record.messageIds?.includes(messageId) === true)
      if (replay !== undefined) return { record: replay, replay: true, created: false, continuation: false }
    }
    const contextId = message.contextId ?? crypto.randomUUID()
    const skill = (message.metadata?.['skill'] as string | undefined) ?? 'chat'
    const record = this.opts.store.create({
      contextId,
      skill,
      parts: message.parts,
      remotePeerId,
      ...(serverId !== undefined ? { serverId } : {}),
      ...(messageId !== undefined ? { messageId } : {}),
      message: { ...message, contextId },
    })
    this.opts.metrics?.recordTaskCreated(serverId, record.taskId)
    this.opts.onTaskCreated?.(record.taskId)
    return { record, replay: false, created: true, continuation: false }
  }

  /** Run one task to a terminal or interrupted state, emitting status/artifact frames. */
  private async runTask(record: TaskRecord, trace = false, historyLength?: number): Promise<void> {
    if (this.running.has(record.taskId)) return
    if (this.opts.maxConcurrentTasks !== undefined && this.opts.maxConcurrentTasks > 0 && this.running.size >= this.opts.maxConcurrentTasks) {
      this.opts.store.setState(record.taskId, TaskState.FAILED, { code: 'quota', text: 'Inbound task concurrency quota exceeded' })
      const failed = this.opts.store.get(record.taskId)
      if (failed !== undefined) this.emit(record.taskId, { task: toTask(failed, true, historyLength, true) })
      this.opts.metrics?.recordTaskSettled(this.opts.serverId, record.taskId, TaskState.FAILED, 0)
      this.settle(record.taskId)
      this.opts.onTaskSettled?.(record.taskId)
      return
    }
    const controller = new AbortController()
    this.running.set(record.taskId, controller)
    const startedAt = Date.now()
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    this.opts.store.setState(record.taskId, TaskState.WORKING)
    this.emit(record.taskId, { statusUpdate: { taskId: record.taskId, contextId: record.contextId, status: statusOf(this.opts.store.get(record.taskId)!) } })
    const onEvent = this.eventSink(record.taskId, record.contextId, trace)
    try {
      const executor = this.opts.executors.resolve(record.skill)
      const execution = executor.execute(
        {
          taskId: record.taskId,
          contextId: record.contextId,
          skill: record.skill,
          parts: record.parts,
          prompt: partsToText(record.parts),
          signal: controller.signal,
          ...(trace ? { trace: true } : {}),
        },
        { onEvent },
      )
      const races: Array<Promise<Awaited<typeof execution>>> = [execution]
      races.push(new Promise<never>((_, reject) => {
        if (controller.signal.aborted) reject(new TaskAborted())
        else controller.signal.addEventListener('abort', () => reject(new TaskAborted()), { once: true })
      }))
      if (this.opts.taskTimeoutMs !== undefined && this.opts.taskTimeoutMs > 0) {
        const timeout = this.opts.taskTimeoutMs
        races.push(new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true
            controller.abort()
            reject(new TaskTimeout(timeout))
          }, timeout)
          timer.unref?.()
        }))
      }
      const output = await Promise.race(races)
      const settled = this.opts.store.get(record.taskId)
      if (settled === undefined || settled.state === TaskState.CANCELED) return
      if (output.parts.length > 0 && output.appendResult !== false) {
        onEvent({ type: 'artifact', artifactId: 'result', parts: output.parts, append: false, lastChunk: true })
      }
      const current = this.opts.store.get(record.taskId)
      if (current === undefined) return
      if (output.state !== undefined) {
        this.opts.store.setState(record.taskId, output.state, {
          code: output.state === TaskState.INPUT_REQUIRED ? 'input_required' : 'auth_required',
          text: output.statusMessage ?? (output.state === TaskState.INPUT_REQUIRED ? 'Additional input required' : 'Authentication required'),
        })
      } else if (INTERRUPTED_STATES.has(current.state)) {
        // The executor already transitioned to an interrupted state; do not
        // clobber it with COMPLETED when the turn returns.
      } else {
        if (output.statusMessage !== undefined && output.statusMessage.length > 0) {
          this.opts.store.setStatusText(record.taskId, output.statusMessage)
        }
        this.opts.store.setState(record.taskId, TaskState.COMPLETED)
      }
    } catch (err) {
      const settled = this.opts.store.get(record.taskId)
      if (settled !== undefined && settled.state === TaskState.CANCELED) {
        // Idempotent cancel already settled the task.
      } else if (timedOut) {
        this.opts.store.setState(record.taskId, TaskState.FAILED, {
          code: 'timeout',
          text: `Task exceeded its ${this.opts.taskTimeoutMs ?? 0}ms execution budget`,
        })
      } else {
        this.opts.store.setState(record.taskId, TaskState.FAILED, { code: 'executor', text: (err as Error).message })
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      this.running.delete(record.taskId)
      const terminal = this.opts.store.get(record.taskId)
      if (terminal !== undefined) {
        this.emit(record.taskId, { task: toTask(terminal, true, historyLength, true) })
        this.opts.metrics?.recordTaskSettled(this.opts.serverId, record.taskId, terminal.state, Date.now() - startedAt)
      }
      this.settle(record.taskId)
      this.opts.onTaskSettled?.(record.taskId)
    }
  }

  /** Build the event sink that folds executor events into store + frames. */
  private eventSink(taskId: string, contextId: string, trace: boolean): (ev: A2aExecutorEvent) => void {
    return (ev) => {
      const current = this.opts.store.get(taskId)
      if (current === undefined || isTerminal(current.state)) return
      if (ev.type === 'status') {
        this.opts.store.setState(taskId, ev.state)
        this.emit(taskId, { statusUpdate: { taskId, contextId, status: statusOf(this.opts.store.get(taskId)!) } })
      } else if (ev.type === 'trace') {
        if (!trace) return
        const record = this.opts.store.appendTrace(taskId, ev.call)
        this.emit(taskId, {
          statusUpdate: {
            taskId,
            contextId,
            status: statusOf(record),
            metadata: { [TRACE_EXTENSION_URI]: { event: ev.call } },
          },
        })
      } else if (ev.artifactId !== undefined && ev.parts !== undefined) {
        const record = this.opts.store.appendArtifact(taskId, {
          artifactId: ev.artifactId,
          ...(ev.name !== undefined ? { name: ev.name } : {}),
          parts: ev.parts,
          ...(ev.append !== undefined ? { append: ev.append } : {}),
          ...(ev.lastChunk !== undefined ? { lastChunk: ev.lastChunk } : {}),
        })
        const artifact = record.artifacts.find((a) => a.artifactId === ev.artifactId)
        if (artifact !== undefined) {
          this.emit(taskId, {
            artifactUpdate: {
              taskId,
              contextId,
              artifact: {
                artifactId: artifact.artifactId,
                ...(artifact.name !== undefined ? { name: artifact.name } : {}),
                // A2A's append flag is wire-level: an append chunk carries only
                // the new parts; a replacement carries the whole artifact.
                parts: ev.append === true ? ev.parts : artifact.parts,
              },
              ...(ev.append !== undefined ? { append: ev.append } : {}),
              ...(ev.lastChunk !== undefined ? { lastChunk: ev.lastChunk } : {}),
            },
          })
        }
      }
    }
  }

  /** Assign an SSE event id, retain it for reconnect replay, and broadcast it. */
  private emit(taskId: string, frame: StreamResponse): void {
    const id = this.nextEventId++
    let log = this.eventLogs.get(taskId)
    if (log === undefined) {
      log = []
      this.eventLogs.set(taskId, log)
      if (this.eventLogs.size > 1000) {
        const oldest = this.eventLogs.keys().next().value
        if (oldest !== undefined && oldest !== taskId) this.eventLogs.delete(oldest)
      }
    }
    log.push({ id, frame })
    if (log.length > this.maxEventLog) log.splice(0, log.length - this.maxEventLog)
    for (const listener of this.listeners.get(taskId) ?? []) listener(frame, id)
  }

  private replay(taskId: string, lastEventId: number, ceiling: number, sub: (frame: StreamResponse, eventId?: number) => void): boolean {
    const log = this.eventLogs.get(taskId) ?? []
    let replayed = false
    for (const event of log) {
      // The initial Task snapshot already contains every artifact through the
      // ceiling, so replaying artifactUpdate frames would make a spec client
      // append those parts a second time. Status frames are safe to replay.
      if (event.id <= lastEventId || event.id > ceiling || 'artifactUpdate' in event.frame) continue
      sub(event.frame, event.id)
      replayed = true
    }
    return replayed
  }

  private noteInbound(req: ServerRequest | { method: string }, method: string, taskIds: readonly string[], streaming: boolean): void {
    const source = sourceOf(req as ServerRequest)
    this.opts.onInbound?.({
      method,
      ...(source !== undefined ? { source } : {}),
      taskIds,
      streaming,
    })
  }

  private remotePeerOf(req: ServerRequest): string | null {
    const source = sourceOf(req)
    return source ? hashOf(source) : null
  }

  /** Apply the per-instance request limiter. */
  private limit(req: ServerRequest): ServerResponseSpec | undefined {
    if (this.limiter === undefined) return undefined
    const key = addressOf(req)
    const decision = this.limiter.allow(key)
    if (decision.ok) return undefined
    return {
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify(rpcError(null, -32000, 'Rate limit exceeded')),
      headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
    }
  }

  private async waitTerminal(taskId: string): Promise<void> {
    const current = this.opts.store.get(taskId)
    if (current !== undefined && (isTerminal(current.state) || INTERRUPTED_STATES.has(current.state))) return
    await new Promise<void>((resolve) => {
      let waiters = this.waiters.get(taskId)
      if (waiters === undefined) {
        waiters = new Set()
        this.waiters.set(taskId, waiters)
      }
      waiters.add(resolve)
    })
  }

  private settle(taskId: string): void {
    const waiters = this.waiters.get(taskId)
    if (waiters === undefined) return
    this.waiters.delete(taskId)
    for (const waiter of waiters) waiter()
  }

  /** Filter, sort, and cursor-page tasks for the spec ListTasks method. */
  private listTasks(params: Record<string, unknown>): ListTasksResponse {
    const contextId = typeof params['contextId'] === 'string' ? params['contextId'] : undefined
    const status = params['status']
    const accepted = new Set<string>(Array.isArray(status) ? status.filter((s): s is string => typeof s === 'string') : typeof status === 'string' ? [status] : [])
    const after = typeof params['statusTimestampAfter'] === 'string' ? params['statusTimestampAfter'] : undefined
    const includeArtifacts = params['includeArtifacts'] === true
    const historyLength = typeof params['historyLength'] === 'number' ? params['historyLength'] : undefined
    const pageSizeRaw = typeof params['pageSize'] === 'number' ? params['pageSize'] : 50
    const pageSize = Math.max(1, Math.min(100, Math.floor(pageSizeRaw)))
    const offset = decodePageToken(params['pageToken'])
    const filtered = this.opts.store.list()
      .filter((record) => contextId === undefined || record.contextId === contextId)
      .filter((record) => accepted.size === 0 || accepted.has(record.state))
      .filter((record) => after === undefined || record.updatedAt >= after)
      .sort((a, b) => (a.updatedAt === b.updatedAt ? (a.taskId < b.taskId ? 1 : -1) : (a.updatedAt < b.updatedAt ? 1 : -1)))
    const page = filtered.slice(offset, offset + pageSize)
    return {
      tasks: page.map((record) => toTask(record, includeArtifacts, historyLength, true)),
      nextPageToken: offset + pageSize < filtered.length ? encodePageToken(offset + pageSize) : '',
      pageSize,
      totalSize: filtered.length,
    }
  }
}

class TaskAborted extends Error {
  constructor() {
    super('a2a: task aborted')
    this.name = 'TaskAborted'
  }
}

class TaskTimeout extends Error {
  constructor(readonly timeoutMs: number) {
    super(`a2a: task exceeded ${timeoutMs}ms`)
    this.name = 'TaskTimeout'
  }
}

/** Read the JSON-RPC endpoint path off the card's first interface. */
function endpointOf(card: AgentCard): string {
  const url = card.supportedInterfaces?.[0]?.url
  if (!url) return '/a2a'
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

function sourceOf(req: ServerRequest): string | undefined {
  const s = req.socket
  if (!s?.remoteAddress) return undefined
  return `${s.remoteAddress}:${s.remotePort ?? ''}`
}

/** Case-tolerant header lookup for structural requests and Node's lowercase map. */
function headerValue(req: ServerRequest, name: string): string | undefined {
  const headers = req.headers
  if (headers === undefined) return undefined
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && typeof value === 'string') return value
  }
  return undefined
}

/** Rate-limit key: one client address, not one TCP connection. */
function addressOf(req: ServerRequest): string {
  return req.socket?.remoteAddress ?? 'unknown'
}

/** A2A-Version from the header or the HTTP query parameter, if supplied. */
function sameProtocol(version: string): boolean {
  return version.split('.').slice(0, 2).join('.') === PROTOCOL_VERSION
}

function requestedVersion(req: ServerRequest): string | undefined {
  const header = req.headers?.['a2a-version'] ?? req.headers?.['A2A-Version']
  if (header !== undefined && header.trim().length > 0) return header.trim()
  try {
    const url = new URL(req.url ?? '', 'http://127.0.0.1')
    const query = url.searchParams.get('A2A-Version') ?? url.searchParams.get('a2a-version')
    return query !== null && query.trim().length > 0 ? query.trim() : undefined
  } catch {
    return undefined
  }
}

/** One JSON-RPC result SSE frame. */
function formatResult(id: string | number | null, frame: StreamResponse, eventId?: number): string {
  return `${eventId !== undefined ? `id: ${eventId}\n` : ''}data: ${JSON.stringify({ jsonrpc: '2.0', id, result: frame })}\n\n`
}

/** One JSON-RPC error SSE frame (same envelope as the non-streaming binding). */
function formatError(id: string | number | null, code: number, message: string, data?: unknown): string {
  return `data: ${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } })}\n\n`
}

function hashOf(value: string): string {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0
  return `peer-${h.toString(16)}`
}

function acceptsText(modes: readonly string[] | undefined): boolean {
  if (modes === undefined || modes.length === 0) return true
  return modes.some((mode) => mode === '*/*' || mode === 'text/*' || mode === 'text/plain' || mode.startsWith('text/'))
}

function rpcFault(code: number, message: string): { code: number; message: string; data?: unknown } {
  return { code, message }
}

function statusOf(record: TaskRecord): Task['status'] {
  const text = record.error?.message ?? record.statusText
  return {
    state: record.state,
    timestamp: record.updatedAt,
    ...(text !== undefined
      ? {
        message: {
          messageId: `a2a-status-${record.taskId}`,
          role: Role.AGENT,
          parts: [{ text }],
          ...(record.error === undefined ? { metadata: { reason: 'no-visible-output' } } : {}),
        },
      }
      : {}),
  }
}

function toTask(record: TaskRecord, includeArtifacts = true, historyLength?: number, includeHistory = false): Task {
  const history = includeHistory ? taskHistory(record, historyLength) : undefined
  return {
    id: record.taskId,
    contextId: record.contextId,
    status: statusOf(record),
    ...(includeArtifacts ? { artifacts: record.artifacts } : {}),
    ...(history !== undefined && history.length > 0 ? { history } : {}),
    metadata: {
      skill: record.skill,
      ...(record.serverId !== undefined ? { serverId: record.serverId } : {}),
      ...(record.trace !== undefined ? { [TRACE_EXTENSION_URI]: record.trace } : {}),
    },
  }
}

/** Best-effort history from the durable task inputs and visible output. */
function taskHistory(record: TaskRecord, historyLength: number | undefined): readonly Message[] {
  const messages: Message[] = []
  if (record.inputs !== undefined && record.inputs.length > 0) {
    messages.push(...record.inputs)
  } else if (record.parts.length > 0) {
    messages.push({
      messageId: record.messageIds?.at(-1) ?? `a2a-input-${record.taskId}`,
      ...(record.contextId !== undefined ? { contextId: record.contextId } : {}),
      taskId: record.taskId,
      role: Role.USER,
      parts: record.parts,
    })
  }
  const output = resultTextOf(record.artifacts)
  const statusText = record.error?.message ?? record.statusText
  if (output.length > 0 || statusText !== undefined) {
    messages.push({
      messageId: `a2a-output-${record.taskId}`,
      ...(record.contextId !== undefined ? { contextId: record.contextId } : {}),
      taskId: record.taskId,
      role: Role.AGENT,
      parts: output.length > 0 ? [{ text: output }] : [{ text: statusText ?? '' }],
      ...(output.length === 0 && statusText !== undefined ? { metadata: { reason: 'no-visible-output' } } : {}),
    })
  }
  if (historyLength === undefined) return messages
  if (historyLength <= 0) return []
  return messages.slice(-historyLength)
}

/** Visible delivery text: only the designated `result` artifact, text parts only. */
function resultTextOf(artifacts: TaskRecord['artifacts']): string {
  return artifacts
    .filter((artifact) => artifact.artifactId === 'result')
    .flatMap((artifact) => artifact.parts)
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .filter((text) => text.length > 0)
    .join('\n')
    .trim()
}

function extractTaskIds(result: unknown): readonly string[] {
  if (result === null || typeof result !== 'object') return []
  const value = result as { id?: string; task?: { id?: string }; tasks?: Array<{ id?: string }> }
  if (typeof value.id === 'string') return [value.id]
  if (typeof value.task?.id === 'string') return [value.task.id]
  if (Array.isArray(value.tasks)) return value.tasks.map((t) => t.id).filter((id): id is string => typeof id === 'string')
  if (Array.isArray(result)) {
    return (result as Array<{ id?: string }>).map((t) => t.id).filter((id): id is string => typeof id === 'string')
  }
  return []
}

function parseEventId(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : undefined
}

function encodePageToken(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url')
}

function decodePageToken(raw: unknown): number {
  if (typeof raw !== 'string' || raw.length === 0) return 0
  try {
    const offset = Number.parseInt(Buffer.from(raw, 'base64url').toString('utf8'), 10)
    return Number.isFinite(offset) && offset >= 0 ? offset : 0
  } catch {
    return 0
  }
}
