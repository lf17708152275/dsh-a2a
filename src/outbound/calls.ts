/**
 * Outbound A2A client: AgentCard discovery plus the JSON-RPC methods the
 * tools layer needs. Supports blocking and streaming sends, cancellation
 * propagation, and bounded retries for transient transport failures.
 * @module dsh-a2a/outbound/calls
 */

import {
  A2A_ERROR_CODES,
  A2A_METHODS,
  PROTOCOL_VERSION,
  isTerminal,
  type AgentCard,
  type JsonRpcResponse,
  type Message,
  type Part,
  type StreamResponse,
  type Task,
} from '../protocol.ts'

/** Error carrying the remote JSON-RPC error code. */
export class A2AError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = 'A2AError'
  }
}

export interface ClientOptions {
  readonly bearerToken?: string
  /** Per-call timeout in ms. Default 60000. */
  readonly timeoutMs?: number
  /** Retries for transient transport/5xx failures. Default 2. */
  readonly retries?: number
  /** Base delay between retries. Default 150ms. */
  readonly retryDelayMs?: number
  readonly fetchImpl?: typeof fetch
}

/** Per-call options shared by blocking and streaming sends. */
export interface SendOptions {
  readonly signal?: AbortSignal
  /** Use SendStreamingMessage when the remote advertises streaming. */
  readonly stream?: boolean
  readonly onEvent?: (frame: StreamResponse) => void
  /** Observe the accumulated task after each applied frame (progress hook). */
  readonly onTask?: (task: Task) => void
}

/** A connected remote A2A agent (one AgentCard endpoint). */
export class A2AClient {
  readonly card: AgentCard
  private readonly endpoint: string

  private constructor(
    card: AgentCard,
    endpoint: string,
    private readonly opts: ClientOptions,
  ) {
    this.card = card
    this.endpoint = endpoint
  }

  /** Fetch and validate an AgentCard, then connect to its JSON-RPC endpoint. */
  static async connect(agentCardUrl: string, opts: ClientOptions = {}): Promise<A2AClient> {
    const timeoutMs = opts.timeoutMs ?? 60_000
    const fetchImpl = opts.fetchImpl ?? fetch
    const response = await withRetries(opts.retries ?? 2, opts.retryDelayMs ?? 150, async () => {
      const result = await fetchImpl(agentCardUrl, {
        headers: {
          accept: 'application/json',
          'a2a-version': PROTOCOL_VERSION,
          ...(opts.bearerToken ? { authorization: `Bearer ${opts.bearerToken}` } : {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (result.status >= 500) throw new A2AError(A2A_ERROR_CODES.INTERNAL_ERROR, `agent card fetch failed: HTTP ${result.status}`)
      return result
    })
    if (!response.ok) {
      throw new A2AError(A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, `agent card fetch failed: HTTP ${response.status}`)
    }
    const card = (await response.json()) as AgentCard
    if (typeof card.name !== 'string' || !Array.isArray(card.skills)) {
      throw new A2AError(A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, `invalid agent card at ${agentCardUrl}`)
    }
    const iface = card.supportedInterfaces?.find((i) => (i.protocolBinding ?? 'JSONRPC') === 'JSONRPC')
      ?? card.supportedInterfaces?.[0]
    const endpoint = iface?.url
    if (!endpoint) {
      throw new A2AError(A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, `agent card at ${agentCardUrl} advertises no JSON-RPC interface`)
    }
    return new A2AClient(card, endpoint, opts)
  }

  /** Send a message and wait (or poll/stream) until the task settles. */
  async sendMessage(message: Message, options: SendOptions = {}): Promise<Task> {
    if (options.stream === true && this.card.capabilities?.streaming === true) {
      return this.sendStreamingMessage(message, options)
    }
    const result = await this.call<unknown>(A2A_METHODS.sendMessage, { message }, options.signal)
    const task = taskFromResult(result)
    if (task === undefined) throw new A2AError(A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, 'SendMessage returned neither a task nor a message')
    if (isTerminal(task.status.state)) return task
    return this.pollTask(task.id, options.signal)
  }

  /**
   * Send a message over SSE and return the settled task. Transport failures
   * before the first frame are retried; once progress was observed a retry
   * could duplicate remote work, so the error is surfaced instead.
   */
  async sendStreamingMessage(message: Message, options: SendOptions = {}): Promise<Task> {
    const retries = this.opts.retries ?? 2
    let lastEventId: string | undefined
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.sendStreamingOnce(message, options, lastEventId, (id) => { lastEventId = id })
      } catch (err) {
        if (options.signal?.aborted === true || attempt >= retries || !retryableError(err)) throw err
        await new Promise((resolve) => setTimeout(resolve, (this.opts.retryDelayMs ?? 150) * (attempt + 1)))
      }
    }
  }

  private async sendStreamingOnce(message: Message, options: SendOptions = {}, lastEventId?: string, onEventId?: (id: string) => void): Promise<Task> {
    const fetchImpl = this.opts.fetchImpl ?? fetch
    const timeoutMs = this.opts.timeoutMs ?? 60_000
    const { signal, cleanup } = mergedSignal(options.signal, timeoutMs)
    let task: Task | undefined
    try {
      const response = await fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'a2a-version': PROTOCOL_VERSION,
          ...(this.opts.bearerToken ? { authorization: `Bearer ${this.opts.bearerToken}` } : {}),
          ...(lastEventId !== undefined ? { 'last-event-id': lastEventId } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method: A2A_METHODS.sendStreamingMessage, params: { message } }),
        signal,
      })
      if (response.status === 401) throw new A2AError(-32040, 'remote agent rejected credentials (401)')
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after')
        throw new A2AError(-32000, `remote agent rate-limited the request${retryAfter ? `; retry after ${retryAfter}s` : ''}`)
      }
      if (!response.ok || response.body === null) {
        throw new A2AError(A2A_ERROR_CODES.INTERNAL_ERROR, `A2A stream failed: HTTP ${response.status}`)
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        for (;;) {
          const split = buffer.indexOf('\n\n')
          if (split < 0) break
          const raw = buffer.slice(0, split)
          buffer = buffer.slice(split + 2)
          const eventId = /^id:\s*(\d+)/m.exec(raw)?.[1]
          if (eventId !== undefined) onEventId?.(eventId)
          const parsed = parseSseEvent(raw)
          if (parsed === undefined) continue
          if ('error' in parsed) throw new A2AError(parsed.error.code, parsed.error.message)
          task = applyFrame(task, parsed)
          options.onTask?.(task)
          options.onEvent?.(parsed)
          if (task !== undefined && isTerminal(task.status.state)) return task
        }
      }
      if (task !== undefined && isTerminal(task.status.state)) return task
      throw new A2AError(A2A_ERROR_CODES.INTERNAL_ERROR, 'A2A stream closed without a terminal task')
    } catch (err) {
      if (signal.aborted) {
        // Best-effort cancel propagation; the caller's abort/timeout must not
        // be delayed by the remote's cancellation acknowledgement.
        if (task !== undefined) void this.cancelTask(task.id).catch(() => {})
        if (options.signal?.aborted === true) throw abortError(options.signal.reason)
        throw new A2AError(-32000, `A2A stream timed out after ${timeoutMs}ms`)
      }
      throw err
    } finally {
      cleanup()
    }
  }

  async getTask(taskId: string, signal?: AbortSignal): Promise<Task> {
    return this.call<Task>(A2A_METHODS.getTask, { id: taskId }, signal)
  }

  async listTasks(params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<Task[]> {
    const result = await this.call<unknown>(A2A_METHODS.listTasks, params, signal)
    if (Array.isArray(result)) return result as Task[]
    const value = result as { tasks?: unknown }
    return Array.isArray(value.tasks) ? value.tasks as Task[] : []
  }

  async cancelTask(taskId: string, signal?: AbortSignal): Promise<Task> {
    return this.call<Task>(A2A_METHODS.cancelTask, { id: taskId }, signal)
  }

  /** Poll a task until terminal or the overall timeout elapses. */
  private async pollTask(taskId: string, signal?: AbortSignal): Promise<Task> {
    const budget = this.opts.timeoutMs ?? 60_000
    const deadline = Date.now() + budget
    for (;;) {
      if (signal?.aborted === true) {
        void this.cancelTask(taskId).catch(() => {})
        throw abortError(signal.reason)
      }
      const task = await this.getTask(taskId, signal).catch(async (err: unknown) => {
        if (signal?.aborted === true) {
          void this.cancelTask(taskId).catch(() => {})
          throw abortError(signal.reason)
        }
        throw err
      })
      if (isTerminal(task.status.state)) return task
      if (Date.now() >= deadline) {
        void this.cancelTask(taskId).catch(() => {})
        throw new A2AError(-32000, `task ${taskId} did not settle within ${budget}ms`)
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  private async call<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    const timeoutMs = this.opts.timeoutMs ?? 60_000
    const fetchImpl = this.opts.fetchImpl ?? fetch
    const retries = this.opts.retries ?? 2
    return withRetries(retries, this.opts.retryDelayMs ?? 150, async () => {
      const { signal: merged, cleanup } = mergedSignal(signal, timeoutMs)
      try {
        let response: Response
        try {
          response = await fetchImpl(this.endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
              'a2a-version': PROTOCOL_VERSION,
              ...(this.opts.bearerToken ? { authorization: `Bearer ${this.opts.bearerToken}` } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
            signal: merged,
          })
        } catch (err) {
          if (signal?.aborted === true) throw abortError(signal.reason)
          if (merged.aborted) throw new A2AError(-32000, `A2A call ${method} timed out after ${timeoutMs}ms`)
          if (err instanceof Error && err.name === 'TimeoutError') {
            throw new A2AError(-32000, `A2A call ${method} timed out after ${timeoutMs}ms`)
          }
          throw err
        }
        if (response.status === 401) {
          throw new A2AError(-32040, 'remote agent rejected credentials (401)')
        }
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after')
          throw new A2AError(-32000, `remote agent rate-limited the request${retryAfter ? `; retry after ${retryAfter}s` : ''}`)
        }
        if (!response.ok) {
          throw new A2AError(
            response.status >= 500 ? A2A_ERROR_CODES.INTERNAL_ERROR : A2A_ERROR_CODES.INVALID_REQUEST,
            `A2A call ${method} failed: HTTP ${response.status}`,
          )
        }
        const payload = (await response.json()) as JsonRpcResponse
        if ('error' in payload) {
          const error = payload.error
          throw new A2AError(error.code, error.message)
        }
        return payload.result as T
      } finally {
        cleanup()
      }
    })
  }
}

/** Whether an error is safe to retry at the transport layer. */
function retryableError(err: unknown): boolean {
  if (err instanceof A2AError) return err.code === A2A_ERROR_CODES.INTERNAL_ERROR || /timed out|fetch|network|ECONN|socket/i.test(err.message)
  return err instanceof Error && err.name !== 'AbortError'
}

/** Retry transient transport failures and 5xx responses. */
async function withRetries<T>(retries: number, delayMs: number, task: () => Promise<T>): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await task()
    } catch (err) {
      if (attempt >= retries || !retryableError(err)) throw err
      attempt += 1
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt))
    }
  }
}

/** Combine an optional caller signal with a per-call timeout. */
function mergedSignal(signal: AbortSignal | undefined, timeoutMs: number): { readonly signal: AbortSignal; readonly cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  timer.unref?.()
  const onAbort = (): void => controller.abort(signal?.reason)
  if (signal?.aborted === true) onAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

function abortError(reason: unknown): Error {
  const error = new Error(reason instanceof Error ? reason.message : 'A2A call canceled')
  error.name = 'AbortError'
  ;(error as Error & { cause?: unknown }).cause = reason
  return error
}

/** Parse one SSE block into a StreamResponse or a JSON-RPC error. */
function parseSseEvent(raw: string): StreamResponse | { error: { code: number; message: string } } | undefined {
  const data = raw.replace(/\r/g, '').split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n')
  if (data.length === 0) return undefined
  try {
    const payload = JSON.parse(data) as {
      result?: StreamResponse
      error?: { code?: number; message?: string }
      code?: number
      message?: string
    }
    if (payload.error !== undefined) {
      return { error: { code: typeof payload.error.code === 'number' ? payload.error.code : -32000, message: payload.error.message ?? 'remote stream error' } }
    }
    if (payload.result !== undefined) return payload.result
    // Legacy/error frames from older plugin versions used a bare {code,message}.
    if (typeof payload.code === 'number' && typeof payload.message === 'string') {
      return { error: { code: payload.code, message: payload.message } }
    }
    return payload as StreamResponse
  } catch {
    return undefined
  }
}

/**
 * Merge an appended artifact slice into the parts already collected.
 *
 * A2A `append` means "these parts continue the artifact", and streaming peers
 * emit one small text fragment per delta. Storing each fragment as its own part
 * makes any consumer that separates parts (a newline, a bullet) print the answer
 * one word per line, so a text fragment is folded into the trailing text part
 * and any non-text part still starts a new one.
 */
export function appendParts(existing: readonly Part[], incoming: readonly Part[]): Part[] {
  const merged = [...existing]
  for (const part of incoming) {
    const last = merged[merged.length - 1]
    if (last !== undefined && 'text' in last && typeof last.text === 'string' && 'text' in part && typeof part.text === 'string') {
      merged[merged.length - 1] = { ...last, text: last.text + part.text }
      continue
    }
    merged.push(part)
  }
  return merged
}

/** Fold one stream frame into the task snapshot. */
function applyFrame(current: Task | undefined, frame: StreamResponse): Task {
  if ('task' in frame) return frame.task
  if ('message' in frame) {
    const messageTask = taskFromMessage(frame.message)
    if (current === undefined) return messageTask
    return {
      ...current,
      status: messageTask.status,
      artifacts: [...(current.artifacts ?? []), ...(messageTask.artifacts ?? [])],
    }
  }
  if ('statusUpdate' in frame) {
    const update = frame.statusUpdate
    return {
      ...(current ?? { id: update.taskId }),
      id: update.taskId,
      ...(update.contextId !== undefined ? { contextId: update.contextId } : {}),
      status: update.status,
    }
  }
  const update = frame.artifactUpdate
  const base: Task = current ?? {
    id: update.taskId,
    ...(update.contextId !== undefined ? { contextId: update.contextId } : {}),
    status: { state: 'TASK_STATE_WORKING' as Task['status']['state'], timestamp: new Date().toISOString() },
  }
  const artifacts = [...(base.artifacts ?? [])]
  const index = artifacts.findIndex((artifact) => artifact.artifactId === update.artifact.artifactId)
  if (index >= 0) {
    artifacts[index] = update.append === true
      ? { ...artifacts[index]!, parts: appendParts(artifacts[index]!.parts ?? [], update.artifact.parts) }
      : { ...update.artifact }
  } else {
    artifacts.push(update.artifact)
  }
  return { ...base, artifacts }
}

/** Accept the spec envelope `{task}`/`{message}`, plus a bare Task for older peers. */
function taskFromResult(result: unknown): Task | undefined {
  if (result === null || typeof result !== 'object') return undefined
  const value = result as { task?: Task; message?: Message; id?: string; status?: Task['status'] }
  if (value.task !== undefined) return value.task
  if (value.message !== undefined) return taskFromMessage(value.message)
  if (typeof value.id === 'string' && value.status !== undefined) return value as Task
  return undefined
}

/** A message-only stream/response becomes a completed task-shaped result for the tool layer. */
function taskFromMessage(message: Message): Task {
  return {
    id: message.taskId ?? '',
    ...(message.contextId !== undefined ? { contextId: message.contextId } : {}),
    status: { state: 'TASK_STATE_COMPLETED' as Task['status']['state'], timestamp: new Date().toISOString() },
    artifacts: [{ artifactId: `message-${message.messageId}`, parts: message.parts }],
  }
}
