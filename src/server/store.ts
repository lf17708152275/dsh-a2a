/**
 * Durable task storage for the inbound half: one `a2a` domain over the routed
 * storage backend (the deployment picks the medium, normally SQLite). Records
 * are serialized JSON so the domain tables stay plain kv rows; the domain
 * SCHEMA_VERSION guards format evolution. A memory store keeps unit tests and
 * minimal embeddings free of a backend.
 * @module dsh-a2a/server/store
 */

import { z } from 'zod'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
  type KvTable,
} from '@deepseek-ai/dsh-storage-domain'
import { Role, TaskState, type Message, type Part } from '../protocol.ts'
import { appendTrace, type TraceCall, type TraceSummary } from './trace.ts'

/** One durable inbound/outbound task record. */
export interface TaskRecord {
  readonly taskId: string
  readonly contextId: string
  readonly skill: string
  readonly state: TaskState
  readonly createdAt: string
  readonly updatedAt: string
  readonly sessionId: string | null
  readonly remotePeerId: string | null
  readonly parts: readonly Part[]
  readonly artifacts: readonly { readonly artifactId: string; readonly name?: string; readonly parts: readonly Part[] }[]
  readonly executor: 'session' | 'subagent'
  readonly summary: string | null
  readonly error?: { readonly code: string; readonly message: string }
  /** The inbound server instance this task arrived through. */
  readonly serverId?: string
  /** Client message ids already accepted by this task (idempotency key). */
  readonly messageIds?: readonly string[]
  /** A2A-visible input messages in acceptance order (task-level history). */
  readonly inputs?: readonly Message[]
  /** Non-error status text, e.g. "completed without visible output". */
  readonly statusText?: string
  /** Opt-in trace summary; absent when the extension was never activated. */
  readonly trace?: TraceSummary
}

/** One durable context→session binding (inbound conversation ↔ DSH session). */
export interface ContextBinding {
  readonly sessionId: string
}

/** One durable outbound agent record (client registry persistence). */
export interface OutboundAgentRecord {
  readonly id: string
  readonly name: string
  readonly agentCardUrl: string
  readonly bearerTokenEnv?: string
  readonly enabled: boolean
  readonly timeoutMs: number
  readonly lastCardAt: string | null
  readonly disabledSkills?: readonly string[]
  readonly skillOverrides?: Readonly<Record<string, { readonly name?: string; readonly description?: string }>>
}

/** One durable inbound server instance. */
export interface InboundServerRecord {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version: string
  readonly endpointPath: string
  /** Agent preset id composing inbound sessions; absent falls back to the deployment default. */
  readonly preset?: string
  readonly authTokenEnv?: string
  readonly enabled: boolean
  /** Instance policy for the optional trace extension (global config is a hard gate). */
  readonly trace?: boolean
  /**
   * Per-instance working directory for inbound agent sessions. Absent = the
   * deployment default (`<DSH_HOME>/a2a-sessions`). Applied when a session is
   * created, so changing it never rewrites the cwd of already-open contexts.
   */
  readonly workspace?: string
  /** Per-instance model provider override; absent = the deployment default. */
  readonly provider?: string
  /** Per-instance model id override; absent = the deployment default. */
  readonly model?: string
}

/** One durable outbound server connection instance. */
export interface OutboundServerRecord {
  readonly id: string
  readonly name: string
  readonly agentCardUrl: string
  readonly bearerTokenEnv?: string
  /** Preset composing this DSH's local session when talking to the remote. */
  readonly preset?: string
  readonly enabled: boolean
  readonly timeoutMs: number
  /** Skill ids excluded from model-tool registration. */
  readonly disabledSkills?: readonly string[]
  /** Per-skill name/description presentation overrides. */
  readonly skillOverrides?: Readonly<Record<string, { readonly name?: string; readonly description?: string }>>
  /** Last successful AgentCard read. */
  readonly lastCardAt?: string
}

/** JSON-encoded record schema shared by every `a2a` table. */
const json = z.string()

/** The `a2a` storage domain: JSON-encoded records, one table per record kind. */
export const a2aDomainSpec = defineDomain({
  name: 'a2a',
  version: 1,
  tables: {
    tasks: domainTable<string, string>(json),
    contexts: domainTable<string, string>(json),
    agents: domainTable<string, string>(json),
    identity: domainTable<string, string>(json),
    inbound_servers: domainTable<string, string>(json),
    outbound_servers: domainTable<string, string>(json),
  },
})

export type A2aDomainSpec = typeof a2aDomainSpec

/**
 * Serialize/deserialize helpers for the domain tables. Plain JSON round-trip
 * with shape assertions; `decodeRecord` returns undefined on any mismatch.
 */
export function encodeRecord(value: unknown): string {
  return JSON.stringify(value)
}

export function decodeRecord<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

/**
 * Open the `a2a` domain on the mounted storage-domain facility and expose
 * its tables. The caller owns the returned handle and closes it on teardown.
 */
export async function openDomain(domain: DomainFacility): Promise<A2aDomain> {
  const handle = await domain.open(a2aDomainSpec)
  return new A2aDomain(handle)
}

/** A2a domain facade: typed JSON tables over the routed backend. */
export class A2aDomain {
  constructor(readonly handle: Domain<A2aDomainSpec>) {}

  get tasks(): KvTable<string, string> {
    return this.handle.table('tasks')
  }

  get contexts(): KvTable<string, string> {
    return this.handle.table('contexts')
  }

  get agents(): KvTable<string, string> {
    return this.handle.table('agents')
  }

  get identity(): KvTable<string, string> {
    return this.handle.table('identity')
  }

  get inbound_servers(): KvTable<string, string> {
    return this.handle.table('inbound_servers')
  }

  get outbound_servers(): KvTable<string, string> {
    return this.handle.table('outbound_servers')
  }

  async close(): Promise<void> {
    await this.handle.close()
  }
}

/** Task-store contract shared by the domain-backed and memory stores. */
export interface TaskStore {
  create(input: { contextId: string; skill: string; parts: readonly Part[]; remotePeerId: string | null; serverId?: string; messageId?: string; message?: Message }): TaskRecord
  get(taskId: string): TaskRecord | undefined
  list(): TaskRecord[]
  setState(taskId: string, state: TaskState, message?: { code: string; text: string }): TaskRecord
  appendArtifact(taskId: string, artifact: { artifactId: string; name?: string; parts: readonly Part[]; append?: boolean; lastChunk?: boolean }): TaskRecord
  /** Replace the task's current input parts (a continuation message). */
  setParts(taskId: string, parts: readonly Part[]): TaskRecord
  /** Append one accepted A2A-visible input message (task history). */
  appendInput(taskId: string, message: Message): TaskRecord
  /** Remember one accepted client message id for idempotent retries. */
  appendMessageId(taskId: string, messageId: string): TaskRecord
  /** Set or clear the non-error status text shown in `status.message`. */
  setStatusText(taskId: string, text: string | undefined): TaskRecord
  /** Append one bounded trace observation. */
  appendTrace(taskId: string, call: TraceCall): TaskRecord
  setContextSession(contextId: string, sessionId: string): Promise<void>
  getContextSession(contextId: string): Promise<string | undefined>
  close(): Promise<void>
}

function now(): string {
  return new Date().toISOString()
}

function recordKey(taskId: string): string {
  return `task:${taskId}`
}

function contextKey(contextId: string): string {
  return `ctx:${contextId}`
}

/** In-memory TaskStore (unit tests, minimal embeddings). */
export class MemoryTaskStore implements TaskStore {
  private tasks = new Map<string, TaskRecord>()
  private contexts = new Map<string, string>()

  create(input: { contextId: string; skill: string; parts: readonly Part[]; remotePeerId: string | null; serverId?: string; messageId?: string; message?: Message }): TaskRecord {
    const taskId = `a2a-${crypto.randomUUID()}`
    const record: TaskRecord = {
      taskId,
      contextId: input.contextId,
      skill: input.skill,
      state: TaskState.SUBMITTED,
      createdAt: now(),
      updatedAt: now(),
      sessionId: null,
      remotePeerId: input.remotePeerId,
      parts: input.parts,
      artifacts: [],
      executor: 'session',
      summary: null,
      ...(input.serverId !== undefined ? { serverId: input.serverId } : {}),
      ...(input.messageId !== undefined ? { messageIds: [input.messageId] } : {}),
      ...(input.message !== undefined ? { inputs: [asHistoryMessage(input.message, taskId, input.contextId)] } : {}),
    }
    this.tasks.set(record.taskId, record)
    return record
  }

  get(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId)
  }

  list(): TaskRecord[] {
    return [...this.tasks.values()]
  }

  setState(taskId: string, state: TaskState, message?: { code: string; text: string }): TaskRecord {
    const current = this.tasks.get(taskId)
    if (current === undefined) throw new Error(`task ${taskId} not found`)
    const error = message !== undefined
      ? { code: message.code, message: message.text }
      : state === TaskState.FAILED ? current.error : undefined
    const next: TaskRecord = { ...current, state, updatedAt: now() }
    if (error !== undefined) (next as { error?: { code: string; message: string } }).error = error
    else delete (next as { error?: unknown }).error
    this.tasks.set(taskId, next)
    return next
  }

  appendArtifact(taskId: string, artifact: { artifactId: string; name?: string; parts: readonly Part[]; append?: boolean; lastChunk?: boolean }): TaskRecord {
    const current = this.tasks.get(taskId)
    if (current === undefined) throw new Error(`task ${taskId} not found`)
    const next: TaskRecord = {
      ...current,
      updatedAt: now(),
      artifacts: appendArtifactRecord(current.artifacts, artifact),
    }
    this.tasks.set(taskId, next)
    return next
  }

  async setContextSession(contextId: string, sessionId: string): Promise<void> {
    this.contexts.set(contextId, sessionId)
  }

  async getContextSession(contextId: string): Promise<string | undefined> {
    return this.contexts.get(contextId)
  }

  async close(): Promise<void> {}

  setParts(taskId: string, parts: readonly Part[]): TaskRecord {
    const current = this.tasks.get(taskId)
    if (current === undefined) throw new Error(`task ${taskId} not found`)
    const next: TaskRecord = { ...current, parts, updatedAt: now() }
    this.tasks.set(taskId, next)
    return next
  }

  appendMessageId(taskId: string, messageId: string): TaskRecord {
    const current = this.tasks.get(taskId)
    if (current === undefined) throw new Error(`task ${taskId} not found`)
    if (current.messageIds?.includes(messageId) === true) return current
    const next: TaskRecord = { ...current, messageIds: [...(current.messageIds ?? []), messageId], updatedAt: now() }
    this.tasks.set(taskId, next)
    return next
  }

  appendInput(taskId: string, message: Message): TaskRecord {
    const current = this.tasks.get(taskId)
    if (current === undefined) throw new Error(`task ${taskId} not found`)
    if (message.messageId.length > 0 && current.inputs?.some((item) => item.messageId === message.messageId) === true) return current
    const next: TaskRecord = {
      ...current,
      inputs: [...(current.inputs ?? seedInputs(current)), asHistoryMessage(message, taskId, current.contextId)],
      updatedAt: now(),
    }
    this.tasks.set(taskId, next)
    return next
  }

  setStatusText(taskId: string, text: string | undefined): TaskRecord {
    const current = this.tasks.get(taskId)
    if (current === undefined) throw new Error(`task ${taskId} not found`)
    const next: TaskRecord = { ...current, updatedAt: now() }
    if (text === undefined || text.length === 0) delete (next as { statusText?: string }).statusText
    else (next as { statusText?: string }).statusText = text
    this.tasks.set(taskId, next)
    return next
  }

  appendTrace(taskId: string, call: TraceCall): TaskRecord {
    const current = this.tasks.get(taskId)
    if (current === undefined) throw new Error(`task ${taskId} not found`)
    const next: TaskRecord = { ...current, trace: appendTrace(current.trace, call), updatedAt: now() }
    this.tasks.set(taskId, next)
    return next
  }
}

function appendArtifactRecord(
  artifacts: TaskRecord['artifacts'],
  artifact: { artifactId: string; name?: string; parts: readonly Part[]; append?: boolean },
): TaskRecord['artifacts'] {
  const existing = artifacts.find((a) => a.artifactId === artifact.artifactId)
  if (existing) {
    return artifacts.map((a) => (a.artifactId === artifact.artifactId
      ? { ...a, parts: artifact.append === false ? artifact.parts : [...a.parts, ...artifact.parts] }
      : a))
  }
  return [...artifacts, { artifactId: artifact.artifactId, ...(artifact.name !== undefined ? { name: artifact.name } : {}), parts: artifact.parts }]
}

/** Domain-backed TaskStore (persistent; the composition path). */
export class DomainTaskStore implements TaskStore {
  // The real `KvTable.put` queues on the domain's write chain: durability
  // first, then the in-memory table updates. TaskStore's synchronous readers
  // must see their own writes immediately, so this store keeps the live view
  // in memory, seeds it from the domain's opened tables (already loaded from
  // the medium), updates it before each queued write, and never reads the
  // table back for its own writes.
  private readonly records = new Map<string, TaskRecord>()
  private readonly bindings = new Map<string, string>()

  constructor(private readonly domain: A2aDomain) {
    for (const [key, raw] of domain.tasks.entries()) {
      if (!key.startsWith('task:')) continue
      const record = decodeRecord<TaskRecord>(raw)
      if (record !== undefined) this.records.set(record.taskId, record)
    }
    for (const [key, raw] of domain.contexts.entries()) {
      if (!key.startsWith('ctx:')) continue
      const binding = decodeRecord<ContextBinding>(raw)
      if (binding !== undefined) this.bindings.set(key.slice('ctx:'.length), binding.sessionId)
    }
  }

  create(input: { contextId: string; skill: string; parts: readonly Part[]; remotePeerId: string | null; serverId?: string; messageId?: string; message?: Message }): TaskRecord {
    const taskId = `a2a-${crypto.randomUUID()}`
    const record: TaskRecord = {
      taskId,
      contextId: input.contextId,
      skill: input.skill,
      state: TaskState.SUBMITTED,
      createdAt: now(),
      updatedAt: now(),
      sessionId: null,
      remotePeerId: input.remotePeerId,
      parts: input.parts,
      artifacts: [],
      executor: 'session',
      summary: null,
      ...(input.serverId !== undefined ? { serverId: input.serverId } : {}),
      ...(input.messageId !== undefined ? { messageIds: [input.messageId] } : {}),
      ...(input.message !== undefined ? { inputs: [asHistoryMessage(input.message, taskId, input.contextId)] } : {}),
    }
    this.records.set(record.taskId, record)
    // Persist eagerly; a failed write must fail the task, not silently lose it.
    void this.domain.tasks.put(recordKey(record.taskId), encodeRecord(record)).catch((err: unknown) => {
      throw new Error(`a2a: task persistence failed: ${String(err)}`)
    })
    return record
  }

  get(taskId: string): TaskRecord | undefined {
    return this.records.get(taskId)
  }

  list(): TaskRecord[] {
    return [...this.records.values()]
  }

  setState(taskId: string, state: TaskState, message?: { code: string; text: string }): TaskRecord {
    const current = this.records.get(taskId)
    if (current === undefined) throw new Error(`task ${taskId} not found`)
    const next: TaskRecord = withState(current, state, message, now())
    this.records.set(taskId, next)
    void this.domain.tasks.put(recordKey(taskId), encodeRecord(next)).catch((err: unknown) => {
      throw new Error(`a2a: task persistence failed: ${String(err)}`)
    })
    return next
  }

  appendArtifact(taskId: string, artifact: { artifactId: string; name?: string; parts: readonly Part[]; append?: boolean; lastChunk?: boolean }): TaskRecord {
    const current = this.records.get(taskId)
    if (current === undefined) throw new Error(`task ${taskId} not found`)
    const next: TaskRecord = { ...current, updatedAt: now(), artifacts: appendArtifactRecord(current.artifacts, artifact) }
    this.records.set(taskId, next)
    void this.domain.tasks.put(recordKey(taskId), encodeRecord(next)).catch((err: unknown) => {
      throw new Error(`a2a: task persistence failed: ${String(err)}`)
    })
    return next
  }

  async setContextSession(contextId: string, sessionId: string): Promise<void> {
    const binding: ContextBinding = { sessionId }
    this.bindings.set(contextId, sessionId)
    await this.domain.contexts.put(contextKey(contextId), encodeRecord(binding))
  }

  async getContextSession(contextId: string): Promise<string | undefined> {
    return this.bindings.get(contextId)
  }

  async close(): Promise<void> {}

  setParts(taskId: string, parts: readonly Part[]): TaskRecord {
    const current = this.records.get(taskId)
    if (current === undefined) throw new Error(`task ${taskId} not found`)
    const next: TaskRecord = { ...current, parts, updatedAt: now() }
    this.records.set(taskId, next)
    void this.domain.tasks.put(recordKey(taskId), encodeRecord(next)).catch((err: unknown) => {
      throw new Error(`a2a: task persistence failed: ${String(err)}`)
    })
    return next
  }

  appendMessageId(taskId: string, messageId: string): TaskRecord {
    const current = this.records.get(taskId)
    if (current === undefined) throw new Error(`task ${taskId} not found`)
    if (current.messageIds?.includes(messageId) === true) return current
    const next: TaskRecord = { ...current, messageIds: [...(current.messageIds ?? []), messageId], updatedAt: now() }
    this.records.set(taskId, next)
    void this.domain.tasks.put(recordKey(taskId), encodeRecord(next)).catch((err: unknown) => {
      throw new Error(`a2a: task persistence failed: ${String(err)}`)
    })
    return next
  }

  appendInput(taskId: string, message: Message): TaskRecord {
    const current = this.records.get(taskId)
    if (current === undefined) throw new Error(`task ${taskId} not found`)
    if (message.messageId.length > 0 && current.inputs?.some((item) => item.messageId === message.messageId) === true) return current
    const next: TaskRecord = {
      ...current,
      inputs: [...(current.inputs ?? seedInputs(current)), asHistoryMessage(message, taskId, current.contextId)],
      updatedAt: now(),
    }
    this.records.set(taskId, next)
    void this.domain.tasks.put(recordKey(taskId), encodeRecord(next)).catch((err: unknown) => {
      throw new Error(`a2a: task persistence failed: ${String(err)}`)
    })
    return next
  }

  setStatusText(taskId: string, text: string | undefined): TaskRecord {
    const current = this.records.get(taskId)
    if (current === undefined) throw new Error(`task ${taskId} not found`)
    const next: TaskRecord = { ...current, updatedAt: now() }
    if (text === undefined || text.length === 0) delete (next as { statusText?: string }).statusText
    else (next as { statusText?: string }).statusText = text
    this.records.set(taskId, next)
    void this.domain.tasks.put(recordKey(taskId), encodeRecord(next)).catch((err: unknown) => {
      throw new Error(`a2a: task persistence failed: ${String(err)}`)
    })
    return next
  }

  appendTrace(taskId: string, call: TraceCall): TaskRecord {
    const current = this.records.get(taskId)
    if (current === undefined) throw new Error(`task ${taskId} not found`)
    const next: TaskRecord = { ...current, trace: appendTrace(current.trace, call), updatedAt: now() }
    this.records.set(taskId, next)
    void this.domain.tasks.put(recordKey(taskId), encodeRecord(next)).catch((err: unknown) => {
      throw new Error(`a2a: task persistence failed: ${String(err)}`)
    })
    return next
  }
}

/**
 * One inbound instance's view of the shared task store. Every access is
 * filtered by the instance's `serverId`; a task belonging to another instance is
 * indistinguishable from a missing task (the A2A spec requires task-not-found,
 * not a permission leak). Context bindings are namespaced too, so two instances
 * can reuse the same client-chosen contextId without sharing a DSH session.
 */
export class ScopedTaskStore implements TaskStore {
  constructor(
    private readonly base: TaskStore,
    readonly serverId: string,
  ) {}

  create(input: { contextId: string; skill: string; parts: readonly Part[]; remotePeerId: string | null; serverId?: string; messageId?: string; message?: Message }): TaskRecord {
    return this.base.create({ ...input, serverId: this.serverId })
  }

  get(taskId: string): TaskRecord | undefined {
    const record = this.base.get(taskId)
    return record?.serverId === this.serverId ? record : undefined
  }

  list(): TaskRecord[] {
    return this.base.list().filter((record) => record.serverId === this.serverId)
  }

  setState(taskId: string, state: TaskState, message?: { code: string; text: string }): TaskRecord {
    this.require(taskId)
    return this.base.setState(taskId, state, message)
  }

  appendArtifact(taskId: string, artifact: { artifactId: string; name?: string; parts: readonly Part[]; append?: boolean; lastChunk?: boolean }): TaskRecord {
    this.require(taskId)
    return this.base.appendArtifact(taskId, artifact)
  }

  setParts(taskId: string, parts: readonly Part[]): TaskRecord {
    this.require(taskId)
    return this.base.setParts(taskId, parts)
  }

  appendMessageId(taskId: string, messageId: string): TaskRecord {
    this.require(taskId)
    return this.base.appendMessageId(taskId, messageId)
  }

  appendInput(taskId: string, message: Message): TaskRecord {
    this.require(taskId)
    return this.base.appendInput(taskId, message)
  }

  setStatusText(taskId: string, text: string | undefined): TaskRecord {
    this.require(taskId)
    return this.base.setStatusText(taskId, text)
  }

  appendTrace(taskId: string, call: TraceCall): TaskRecord {
    this.require(taskId)
    return this.base.appendTrace(taskId, call)
  }

  async setContextSession(contextId: string, sessionId: string): Promise<void> {
    await this.base.setContextSession(this.scopedContextId(contextId), sessionId)
  }

  async getContextSession(contextId: string): Promise<string | undefined> {
    return this.base.getContextSession(this.scopedContextId(contextId))
  }

  async close(): Promise<void> {
    // The shared store is owned by the plugin fiber, not one instance.
  }

  private scopedContextId(contextId: string): string {
    return `${this.serverId}:${contextId}`
  }

  private require(taskId: string): void {
    if (this.get(taskId) === undefined) throw new Error(`task ${taskId} not found`)
  }
}

function asHistoryMessage(message: Message, taskId: string, contextId: string): Message {
  return {
    ...message,
    contextId,
    taskId,
    role: message.role === Role.AGENT ? Role.AGENT : Role.USER,
  }
}

/** Seed the visible input list for a record created before `inputs` existed. */
function seedInputs(record: TaskRecord): Message[] {
  if (record.parts.length === 0) return []
  return [{
    messageId: record.messageIds?.at(-1) ?? `a2a-input-${record.taskId}`,
    contextId: record.contextId,
    taskId: record.taskId,
    role: Role.USER,
    parts: record.parts,
  }]
}

function withState(
  current: TaskRecord,
  state: TaskState,
  message: { code: string; text: string } | undefined,
  timestamp: string,
): TaskRecord {
  const next: TaskRecord = { ...current, state, updatedAt: timestamp }
  if (message !== undefined) {
    (next as { error?: { code: string; message: string } }).error = { code: message.code, message: message.text }
  } else if (state === TaskState.FAILED && current.error !== undefined) {
    (next as { error?: { code: string; message: string } }).error = current.error
  } else {
    delete (next as { error?: unknown }).error
  }
  return next
}