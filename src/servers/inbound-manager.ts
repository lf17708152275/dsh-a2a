/**
 * Inbound server manager: owns every inbound A2A server instance. Each
 * instance binds one concrete agent preset (its session pool is composed from
 * that preset) and serves its own endpoint and AgentCard route. Instances are
 * persisted in the `inbound_servers` domain table and assembled on boot; the
 * manager owns route registration and the full lifecycle
 * (add/enable/disable/update/remove) driven from the GUI and facade, and
 * disposes every instance's environment on teardown.
 *
 * Skill declaration is DERIVED, never typed: "the preset decides its skills;
 * everything is a plugin." An instance's AgentCard skills are the
 * model-invocable entries of its preset's skill directory — the preset's
 * standing scope key (`agentPresets.standingKeyFor`) plus
 * `ctx.skills.list({ scope })` — resolved automatically at add/update/boot
 * and cached on the live instance; the creator types no skill text. A missing
 * skills service or standing mount falls back to a built-in `chat` skill so
 * minimal compositions stay exercisable.
 * @module dsh-a2a/servers/inbound-manager
 */

import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { buildCard } from '../server/card.ts'
import { A2AServer } from '../server/a2a-server.ts'
import { A2aRoutes } from '../server/routes.ts'
import { ContextSessionPool, type AgentPresetsLike, type AgentRegistryLike, type AttachmentsLike, type CredentialsLike, type SkillsLike } from '../server/exec/agent-runtime.ts'
import { createSessionExecutor } from '../server/exec/session.ts'
import { createSubagentExecutor, type SubagentsLike } from '../server/exec/subagent.ts'
import { ExecutorSet } from '../server/executor.ts'
import { LiveInboundRegistry } from '../server/inbound-registry.ts'
import { ContextSessionRegistry } from '../server/session-registry.ts'
import { ScopedTaskStore, type TaskStore, type InboundServerRecord } from '../server/store.ts'
import type { A2aMetrics } from '../server/metrics.ts'
import type { AgentSkill } from '../protocol.ts'
import type { GateInput, GateResult } from '../server/a2a-server.ts'
import type { InboundTaskDecision } from '../events.ts'

/** Web-server slice the manager registers instance routes on. */
export interface WebServerLike {
  register(route: {
    readonly kind: 'exact' | 'prefix'
    readonly path: string
    handler(...args: unknown[]): unknown
  }): () => void
}

/** Host service slices one manager needs. */
export interface InboundManagerHost {
  readonly ctx: Context
  readonly webServer: WebServerLike
  readonly tasks: TaskStore
  readonly logger: { info(message: string): void; warn(message: string): void; error(message: string): void }
  readonly agents?: AgentRegistryLike
  readonly agentPresets?: AgentPresetsLike
  readonly skills?: SkillsLike
  readonly credentials?: CredentialsLike
  readonly subagents?: SubagentsLike
  readonly attachments?: AttachmentsLike
  readonly metrics?: A2aMetrics
  readonly sessionCwd: string
  /**
   * Advertised inbound base URL default: a concrete origin, `auto` (derived
   * per request), or a getter so a GUI setting can change it at runtime.
   */
  readonly defaultBaseUrl: string | (() => string)
  readonly subagentProvider: string
  /** Deployment hard gate/default for the optional trace extension. */
  readonly inboundTrace: boolean
  /** Per-task inbound execution budget (0 = disabled). */
  readonly taskTimeoutMs?: number
  /** Sliding-window request limit per inbound source (0 = disabled). */
  readonly requestsPerMinute?: number
  /** Maximum concurrent tasks per inbound instance (0 = disabled). */
  readonly maxConcurrentTasks?: number
  /** HTTP body cap for inbound A2A routes. */
  readonly maxBodyBytes?: number
  /** Deployment default preset id (from `agentPresets.defaultId`), when known. */
  readonly defaultPresetId?: string
  /** Resolve the deployment's default model options (may be undefined). */
  readonly resolveDefaultModel?: () => { readonly provider?: string; readonly model?: string } | undefined
  /**
   * Lift the host's archive flag for a session this instance is about to drive.
   * An archived session rejects every step (the host gate ends the turn
   * `blocked`), producing a reply with no visible output — inbound traffic is
   * explicit activity, so the session is revived instead.
   */
  readonly reviveArchivedSession?: (sessionId: string) => void | Promise<void>
  /** Allocate a fresh stable instance id. */
  readonly newId: () => string
}

/** Effective per-instance working directory: record override, else deployment default. */
export function resolveInstanceCwd(record: Pick<InboundServerRecord, 'workspace'>, deploymentCwd: string): string {
  return record.workspace ?? deploymentCwd
}

/** One live inbound instance's runtime handle. */
export interface LiveInboundServer {
  readonly id: string
  readonly name: string
  readonly record: InboundServerRecord
  /** Effective preset id (record's or the deployment default). */
  readonly preset: string | undefined
  /** Derived skill declarations (cached at assemble time). */
  readonly skills: readonly AgentSkill[]
  readonly card: ReturnType<typeof buildCard>
  readonly server: A2AServer
  readonly routes: A2aRoutes
  readonly inbound: LiveInboundRegistry
  readonly executors: ExecutorSet
  /** Live per-context session observation (SSE streaming per task). */
  readonly sessions: ContextSessionRegistry
  /** Preset-bound per-context session pool; absent = no agent loop mounted. */
  readonly sessionPool?: ContextSessionPool
  readonly endpointPath: string
  readonly cardPath: string
  /** Effective trace policy after the deployment gate. */
  readonly traceEnabled: boolean
  dispose(): void
}

/** Creator input for a new (or updated) inbound instance. */
export interface InboundCreateInput {
  readonly name: string
  readonly description: string
  readonly version: string
  readonly endpointPath?: string
  /** Preset id; absent = the deployment default preset. */
  readonly preset?: string
  readonly authTokenEnv?: string
  /** Allow the optional trace extension on this instance (default from config). */
  readonly trace?: boolean
  readonly enabled?: boolean
  /**
   * Absolute working directory for this instance's agent sessions. Absent (or
   * blank) = the deployment default. Only affects sessions created afterwards.
   */
  readonly workspace?: string
  /** Model provider override for this instance; absent = deployment default. */
  readonly provider?: string
  /** Model id override for this instance; absent = deployment default. */
  readonly model?: string
  /**
   * Advertised base URL for this instance's agent card (e.g.
   * `https://companion.example.com`). Absent (or blank) = the deployment
   * `baseUrl` config. Only the advertised URL changes; the routes are still
   * served by the host web server.
   */
  readonly baseUrl?: string
}

/** Validate an optional per-instance workspace override (absolute + existing dir). */
export function validateWorkspace(raw: string | undefined): { readonly ok: true; readonly value?: string } | { readonly ok: false; readonly message: string } {
  if (raw === undefined) return { ok: true }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: true }
  if (!isAbsolute(trimmed)) return { ok: false, message: `workspace must be an absolute path: ${trimmed}` }
  try {
    if (!statSync(trimmed).isDirectory()) {
      return { ok: false, message: `workspace is not a directory: ${trimmed}` }
    }
  } catch {
    return { ok: false, message: `workspace does not exist: ${trimmed}` }
  }
  return { ok: true, value: trimmed }
}

/**
 * Validate an optional per-instance advertised base URL. The value must be an
 * absolute `http(s)` URL; a trailing slash is trimmed so card URLs join paths
 * consistently. Blank = inherit the deployment base URL.
 */
export function validateBaseUrl(raw: string | undefined): { readonly ok: true; readonly value?: string } | { readonly ok: false; readonly message: string } {
  const trimmed = trimOptional(raw)
  if (trimmed === undefined) return { ok: true }
  // `auto` derives the advertised origin from each request's forwarded host.
  if (trimmed.toLowerCase() === 'auto') return { ok: true, value: 'auto' }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, message: `baseUrl must be an absolute URL: ${trimmed}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, message: `baseUrl must use http or https: ${trimmed}` }
  }
  return { ok: true, value: trimmed.replace(/\/$/, '') }
}

/** Per-instance advertised base URL, or the deployment default. */
export function resolveInstanceBaseUrl(record: Pick<InboundServerRecord, 'baseUrl'>, deploymentBaseUrl: string): string {
  return record.baseUrl ?? deploymentBaseUrl
}

/** Resolve the host's base-URL source (a getter lets the GUI retune it). */
export function deploymentBaseUrlOf(host: Pick<InboundManagerHost, 'defaultBaseUrl'>): string {
  return typeof host.defaultBaseUrl === 'function' ? host.defaultBaseUrl() : host.defaultBaseUrl
}

/** Case-insensitive header lookup on the structural request shape. */
function requestHeader(req: { readonly headers?: Record<string, string> }, name: string): string | undefined {
  const headers = req.headers
  if (headers === undefined) return undefined
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && typeof value === 'string') return value
  }
  return undefined
}

/**
 * Derive the externally visible origin from a request (`auto` advertised base
 * URL mode): `X-Forwarded-Host`/`Host` for the authority, `X-Forwarded-Proto`
 * for the scheme. Returns undefined when the request carries no usable host.
 */
export function deriveBaseUrlFromRequest(req: { readonly headers?: Record<string, string> }): string | undefined {
  const rawHost = requestHeader(req, 'x-forwarded-host') ?? requestHeader(req, 'host')
  const host = rawHost?.split(',')[0]?.trim()
  if (host === undefined || host.length === 0) return undefined
  const rawProto = requestHeader(req, 'x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  const scheme = rawProto === 'https' ? 'https' : 'http'
  return `${scheme}://${host}`
}

/** Trim an optional text override; blank collapses to undefined. */
export function trimOptional(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Per-instance model override, or undefined when the instance inherits the default. */
export function buildModelOverride(record: InboundServerRecord): { readonly provider?: string; readonly model?: string } | undefined {
  const provider = trimOptional(record.provider)
  const model = trimOptional(record.model)
  if (provider === undefined && model === undefined) return undefined
  return {
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
  }
}

export interface OpResult {
  readonly ok: boolean
  readonly message: string
}

function refuseExecutor(reason: string) {
  return {
    name: 'refuse',
    async execute(): Promise<{ parts: { text: string }[] }> {
      throw new Error(`a2a: ${reason}; refusing inbound task`)
    },
  }
}

/** Built-in fallback skill when no skills service / standing mount exists. */
export function chatFallbackSkills(): readonly AgentSkill[] {
  return [{ id: 'chat', name: 'chat', description: 'Conversational assistance over a DSH agent session.', tags: ['chat'] }]
}

/**
 * Derive an instance's AgentCard skills from its preset's skill directory.
 *
 * `agentPresets.standingKeyFor(preset)` yields the preset's standing scope
 * key (no agent required); `ctx.skills.list({ scope })` returns the catalogue
 * that preset agent actually sees (its layer + the deployment global). Only
 * model-invocable entries are advertised, mapped to `AgentSkill` (id = name,
 * name = name). Any missing service, failed mount, or empty catalogue falls
 * back to the built-in `chat` skill.
 *
 * @param agentPresets - the preset roster, or undefined.
 * @param skills - the skill registry, or undefined.
 * @param preset - the instance's preset id; undefined = deployment default.
 */
export async function derivePresetSkills(
  agentPresets: AgentPresetsLike | undefined,
  skills: SkillsLike | undefined,
  preset: string | undefined,
): Promise<readonly AgentSkill[]> {
  if (agentPresets?.standingKeyFor === undefined || skills === undefined) return chatFallbackSkills()
  try {
    const scope = await agentPresets.standingKeyFor(preset)
    const rows = await skills.list({ scope })
    const advertised: AgentSkill[] = rows
      .filter((row) => row.invocation?.modelInvocable !== false)
      .map((row) => ({
        id: row.name,
        name: row.name,
        ...(row.description !== undefined && row.description.length > 0 ? { description: row.description } : {}),
      }))
    return advertised.length > 0 ? advertised : chatFallbackSkills()
  } catch {
    return chatFallbackSkills()
  }
}

/** The managed env-var name backing one inbound instance's auth token. */
export function inboundAuthEnv(id: string): string {
  return `A2A_INBOUND_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
}

/**
 * Resolve one inbound instance's bearer token: the credentials service first
 * (per-call layered read; the GUI writes here), then the process environment
 * (external `export` of the same name keeps working).
 */
export async function resolveAuthToken(
  credentials: CredentialsLike | undefined,
  envName: string | undefined,
): Promise<string | undefined> {
  if (envName === undefined) return undefined
  try {
    const stored = await credentials?.resolve(envName)
    if (stored !== undefined && stored.value.length > 0) return stored.value
  } catch {
    // fall through to the process environment
  }
  const direct = process.env[envName]
  return direct !== undefined && direct.length > 0 ? direct : undefined
}

/** Assemble one live instance (skills and auth token already resolved). */
function assemble(record: InboundServerRecord, skills: readonly AgentSkill[], authToken: string | undefined, host: InboundManagerHost): LiveInboundServer {
  const endpointPath = record.endpointPath
  const cardPath = `${endpointPath.replace(/\/$/, '')}/agent-card.json`
  const preset = record.preset ?? host.defaultPresetId
  const traceEnabled = host.inboundTrace && (record.trace ?? host.inboundTrace)
  // Per-instance workspace/model overrides (additive: absent = deployment default).
  const sessionCwd = resolveInstanceCwd(record, host.sessionCwd)
  const modelOverride = buildModelOverride(record)
  const tasks = new ScopedTaskStore(host.tasks, record.id)
  const cardOptions = {
    endpointPath,
    name: record.name,
    description: record.description,
    version: record.version,
    skills,
    trace: traceEnabled,
    ...(authToken !== undefined ? { authToken } : {}),
    ...(host.attachments !== undefined
      ? { inputModes: ['text/plain', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/octet-stream'] as const }
      : {}),
  }
  // `auto` (per instance or as the deployment default) advertises whatever
  // origin the client reached us through (proxy headers). The static card
  // still needs a concrete origin for the facade snapshot, so it falls back to
  // the loopback default the host reports.
  const deploymentBaseUrl = deploymentBaseUrlOf(host)
  const configuredBaseUrl = resolveInstanceBaseUrl(record, deploymentBaseUrl)
  const autoBaseUrl = configuredBaseUrl === 'auto'
  // Concrete origin for the static card when the effective mode is `auto`:
  // the deployment default if it is concrete, else a loopback placeholder (the
  // served card is rebuilt per request, so this only feeds facade snapshots).
  const staticAutoFallback = deploymentBaseUrl === 'auto' ? 'http://127.0.0.1' : deploymentBaseUrl
  const card = buildCard({ ...cardOptions, baseUrl: autoBaseUrl ? staticAutoFallback : configuredBaseUrl })

  // One preset-bound session pool per instance. The instance id is part of the
  // derived session id so two instances cannot share a DSH session just
  // because a client reused the same contextId.
  const sessions = new ContextSessionRegistry()
  const sessionPool = host.agents
    ? new ContextSessionPool(host.agents, {
      cwd: sessionCwd,
      sessionNamespace: record.id,
      ...(host.agentPresets !== undefined ? { agentPresets: host.agentPresets } : {}),
      ...(preset !== undefined ? { presetId: () => preset } : {}),
      ...(host.attachments !== undefined ? { attachments: host.attachments } : {}),
      // `?.()` yields `{ provider?, model? } | undefined`, matching the
      // AgentRuntimeOptions.resolveAgentOptions signature under
      // exactOptionalPropertyTypes.
      resolveAgentOptions: () => modelOverride ?? host.resolveDefaultModel?.(),
      // First open of a context's session: persist the contextId → sessionId
      // binding so the durable store agrees with the pool. The scoped store
      // namespaces the binding by inbound instance. The write is memory-first
      // (write-chain visible); a durability failure must not fail the task
      // that just opened the session — log and continue.
      onSessionOpened: (info) => tasks.setContextSession(info.contextId, info.sessionId)
        .catch((err: unknown) => {
          host.logger.error(`[a2a:${record.id}] context binding persist failed: ${String(err)}`)
        }),
      ...(host.reviveArchivedSession !== undefined ? { reviveArchivedSession: host.reviveArchivedSession } : {}),
    })
    : undefined
  const sessionExecutor = sessionPool ? createSessionExecutor(sessionPool) : refuseExecutor('no agent loop mounted')
  const subagentExecutor = sessionPool !== undefined && host.subagents !== undefined
    ? createSubagentExecutor({ pool: sessionPool, subagents: host.subagents, provider: host.subagentProvider })
    : undefined
  const executors = new ExecutorSet({ chat: 'session' }, sessionExecutor, subagentExecutor)

  const inbound = new LiveInboundRegistry()
  const skillIds = new Set(skills.map((s) => s.id))
  const gate = async (input: GateInput): Promise<GateResult> => {
    if (!skillIds.has(input.skill)) {
      return { ok: false, reason: `unknown skill "${input.skill}"` }
    }
    const decision: InboundTaskDecision = {
      contextId: input.contextId,
      skill: input.skill,
      parts: input.parts,
      remotePeerId: input.remotePeerId,
    }
    const decided = await host.ctx.waterfall('a2a/inbound-task', decision, async (d) => d)
    host.logger.info(`[a2a:${record.id}] inbound skill=${decided.skill} rejected=${decided.rejected?.reason ?? 'no'}`)
    if (decided.rejected !== undefined) return { ok: false, reason: decided.rejected.reason }
    return { ok: true }
  }

  const server = new A2AServer({
    card,
    ...(autoBaseUrl
      ? { cardForRequest: (req) => buildCard({ ...cardOptions, baseUrl: deriveBaseUrlFromRequest(req) ?? staticAutoFallback }) }
      : {}),
    store: tasks,
    executors,
    ...(authToken !== undefined ? { authToken } : {}),
    cardPath,
    gate,
    traceEnabled,
    // Stamp this instance onto its task records (session views attribute
    // contexts to the inbound instance they arrived through).
    serverId: record.id,
    ...(host.metrics !== undefined ? { metrics: host.metrics } : {}),
    ...(host.taskTimeoutMs !== undefined ? { taskTimeoutMs: host.taskTimeoutMs } : {}),
    ...(host.requestsPerMinute !== undefined ? { requestsPerMinute: host.requestsPerMinute } : {}),
    ...(host.maxConcurrentTasks !== undefined ? { maxConcurrentTasks: host.maxConcurrentTasks } : {}),
    onInbound: (facts) => inbound.note({
      method: facts.method,
      ...(facts.source !== undefined ? { source: facts.source } : {}),
      taskIds: facts.taskIds,
      streaming: facts.streaming,
    }),
    onTaskSettled: (taskId) => {
      host.logger.info(`[a2a:${record.id}] task settled ${taskId}`)
      inbound.settle(taskId)
    },
    // Feed the per-instance session registry so the session view's
    // "streaming" column reflects live SSE subscriptions per task.
    onStreamOpen: ({ taskId }) => sessions.noteStreamOpen(taskId),
    onStreamClose: (taskId) => sessions.noteStreamClose(taskId),
  })
  const routes = new A2aRoutes(host.webServer, server, cardPath, host.maxBodyBytes ?? 1_048_576)

  return {
    id: record.id,
    name: record.name,
    record,
    preset,
    skills,
    card,
    server,
    routes,
    inbound,
    sessions,
    ...(sessionPool !== undefined ? { sessionPool } : {}),
    executors,
    endpointPath,
    cardPath,
    traceEnabled,
    dispose: () => {
      routes.dispose()
      sessions.clear()
      void executors.disposeAll().catch(() => {})
    },
  }
}

/** Persisted-instance store over the inbound_servers table. */
export class DomainInboundStore {
  private static KEY(id: string): string {
    return `in:${id}`
  }

  constructor(private readonly table: {
    get(key: string): string | undefined
    put(key: string, value: string): Promise<void>
    entries?(): IterableIterator<[string, string]>
    keys?(): IterableIterator<string>
  }) {}

  list(): InboundServerRecord[] {
    const out: InboundServerRecord[] = []
    const entries = this.table.entries
    if (entries === undefined) return out
    // Call through the table (method `this` stays bound); the real KvTable's
    // `entries()` reads instance state.
    for (const [key, raw] of entries.call(this.table)) {
      if (!key.startsWith('in:')) continue
      const parsed = safeParse(raw)
      if (parsed !== undefined) out.push(parsed)
    }
    return out
  }

  get(id: string): InboundServerRecord | undefined {
    const raw = this.table.get(DomainInboundStore.KEY(id))
    return raw === undefined ? undefined : safeParse(raw)
  }

  async save(record: InboundServerRecord): Promise<void> {
    await this.table.put(DomainInboundStore.KEY(record.id), JSON.stringify(record))
  }

  async remove(id: string): Promise<void> {
    await this.table.put(DomainInboundStore.KEY(id), '')
  }
}

function safeParse(raw: string): InboundServerRecord | undefined {
  try {
    const parsed = JSON.parse(raw) as InboundServerRecord
    if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string') return undefined
    return parsed
  } catch {
    return undefined
  }
}

/** Manages the live set of inbound server instances. */
export class InboundServerManager {
  private readonly live = new Map<string, LiveInboundServer>()

  constructor(
    private readonly host: InboundManagerHost,
    private readonly store: DomainInboundStore,
  ) {}

  /** Assemble every persisted instance (skills derived per preset). */
  async boot(): Promise<void> {
    for (const record of this.store.list()) {
      try {
        const skills = await derivePresetSkills(this.host.agentPresets, this.host.skills, record.preset ?? this.host.defaultPresetId)
        const token = await resolveAuthToken(this.host.credentials, record.authTokenEnv)
        const live = assemble(record, skills, token, this.host)
        this.live.set(record.id, live)
        if (record.enabled) live.routes.enable()
      } catch (err) {
        this.host.logger.error(`[a2a:${record.id}] failed to assemble: ${String((err as Error).message)}`)
      }
    }
  }

  list(): readonly LiveInboundServer[] {
    return [...this.live.values()]
  }

  get(id: string): LiveInboundServer | undefined {
    return this.live.get(id)
  }

  /** Create, persist, and assemble a new inbound instance. */
  async add(input: InboundCreateInput): Promise<OpResult & { readonly id?: string }> {
    const id = this.newId(input.name)
    if (this.live.has(id)) return { ok: false, message: `inbound server ${id} already exists` }
    const workspace = validateWorkspace(input.workspace)
    if (!workspace.ok) return { ok: false, message: workspace.message }
    const advertisedBaseUrl = validateBaseUrl(input.baseUrl)
    if (!advertisedBaseUrl.ok) return { ok: false, message: advertisedBaseUrl.message }
    const provider = trimOptional(input.provider)
    const model = trimOptional(input.model)
    const preset = input.preset ?? this.host.defaultPresetId
    const record: InboundServerRecord = {
      id,
      name: input.name,
      description: input.description,
      version: input.version,
      endpointPath: input.endpointPath ?? `/a2a/${id}`,
      ...(preset !== undefined ? { preset } : {}),
      ...(input.authTokenEnv !== undefined ? { authTokenEnv: input.authTokenEnv } : {}),
      ...(input.trace !== undefined ? { trace: input.trace } : {}),
      ...(workspace.value !== undefined ? { workspace: workspace.value } : {}),
      ...(provider !== undefined ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(advertisedBaseUrl.value !== undefined ? { baseUrl: advertisedBaseUrl.value } : {}),
      enabled: input.enabled ?? true,
    }
    try {
      const skills = await derivePresetSkills(this.host.agentPresets, this.host.skills, preset)
      const token = await resolveAuthToken(this.host.credentials, record.authTokenEnv)
      const live = assemble(record, skills, token, this.host)
      await this.store.save(record)
      this.live.set(id, live)
      if (record.enabled) live.routes.enable()
      return { ok: true, message: `inbound server "${record.name}" created`, id }
    } catch (err) {
      return { ok: false, message: `failed to create inbound server: ${String((err as Error).message)}` }
    }
  }

  /** Persist, rebuild (re-deriving skills), and apply a patch onto a live instance. */
  async update(id: string, patch: Partial<Pick<InboundServerRecord, 'name' | 'description' | 'version' | 'endpointPath' | 'preset' | 'authTokenEnv' | 'trace' | 'workspace' | 'provider' | 'model' | 'baseUrl'>>): Promise<OpResult> {
    const live = this.live.get(id)
    const stored = this.store.get(id)
    if (live === undefined || stored === undefined) return { ok: false, message: `inbound server ${id} not found` }
    if (patch.workspace !== undefined) {
      const workspace = validateWorkspace(patch.workspace)
      if (!workspace.ok) return { ok: false, message: workspace.message }
    }
    if (patch.baseUrl !== undefined) {
      const baseUrl = validateBaseUrl(patch.baseUrl)
      if (!baseUrl.ok) return { ok: false, message: baseUrl.message }
    }
    // Overrides are additive and clearable: an explicit blank string removes the
    // override so the instance falls back to the deployment default again.
    const { workspace: _dropWs, provider: _dropProv, model: _dropModel, baseUrl: _dropBase, ...base } = stored
    const nextWorkspace = patch.workspace !== undefined ? trimOptional(patch.workspace) : stored.workspace
    const nextProvider = patch.provider !== undefined ? trimOptional(patch.provider) : stored.provider
    const nextModel = patch.model !== undefined ? trimOptional(patch.model) : stored.model
    const nextBaseUrl = patch.baseUrl !== undefined ? trimOptional(patch.baseUrl)?.replace(/\/$/, '') : stored.baseUrl
    const next: InboundServerRecord = {
      ...base,
      name: patch.name ?? stored.name,
      description: patch.description ?? stored.description,
      version: patch.version ?? stored.version,
      endpointPath: patch.endpointPath ?? stored.endpointPath,
      ...(patch.preset !== undefined ? { preset: patch.preset } : {}),
      ...(patch.authTokenEnv !== undefined ? { authTokenEnv: patch.authTokenEnv } : {}),
      ...(patch.trace !== undefined ? { trace: patch.trace } : {}),
      ...(nextWorkspace !== undefined ? { workspace: nextWorkspace } : {}),
      ...(nextProvider !== undefined ? { provider: nextProvider } : {}),
      ...(nextModel !== undefined ? { model: nextModel } : {}),
      ...(nextBaseUrl !== undefined ? { baseUrl: nextBaseUrl } : {}),
      enabled: stored.enabled,
    }
    try {
      await this.store.save(next)
      const skills = await derivePresetSkills(this.host.agentPresets, this.host.skills, next.preset ?? this.host.defaultPresetId)
      const token = await resolveAuthToken(this.host.credentials, next.authTokenEnv)
      const replaced = assemble(next, skills, token, this.host)
      // Preserve the route registration state while swapping runtime halves.
      const wasEnabled = live.routes.active
      live.dispose()
      this.live.set(id, replaced)
      if (wasEnabled || next.enabled) replaced.routes.enable()
      return { ok: true, message: `inbound server ${id} updated` }
    } catch (err) {
      return { ok: false, message: `failed to update inbound server: ${String((err as Error).message)}` }
    }
  }

  /**
   * Set (or clear) an inbound instance's bearer token. The value is written to
   * the credentials service under this instance's managed env-var name; the
   * record stores only that name and the live instance is rebuilt.
   */
  async setAuth(id: string, token: string | undefined): Promise<OpResult> {
    const live = this.live.get(id)
    const stored = this.store.get(id)
    if (live === undefined || stored === undefined) return { ok: false, message: `inbound server ${id} not found` }
    const credentials = this.host.credentials
    const envName = inboundAuthEnv(id)
    try {
      if (token === undefined || token.length === 0) {
        if (credentials !== undefined) await credentials.unset(envName)
        const { authTokenEnv: _dropped, ...rest } = stored
        await this.store.save(rest)
        const skills = await derivePresetSkills(this.host.agentPresets, this.host.skills, rest.preset ?? this.host.defaultPresetId)
        const replaced = assemble(rest, skills, undefined, this.host)
        const wasEnabled = live.routes.active
        live.dispose()
        this.live.set(id, replaced)
        if (wasEnabled || rest.enabled) replaced.routes.enable()
        return { ok: true, message: `inbound server ${id} auth cleared` }
      }
      if (credentials === undefined) {
        return { ok: false, message: 'credentials service not mounted; cannot store the token (set the env var externally instead)' }
      }
      await credentials.set(envName, token)
      const next: InboundServerRecord = { ...stored, authTokenEnv: envName }
      await this.store.save(next)
      const skills = await derivePresetSkills(this.host.agentPresets, this.host.skills, next.preset ?? this.host.defaultPresetId)
      const replaced = assemble(next, skills, token, this.host)
      const wasEnabled = live.routes.active
      live.dispose()
      this.live.set(id, replaced)
      if (wasEnabled || next.enabled) replaced.routes.enable()
      return { ok: true, message: `inbound server ${id} auth set (${envName})` }
    } catch (err) {
      return { ok: false, message: `failed to set inbound auth: ${String((err as Error).message)}` }
    }
  }

  /** Enable/disable an instance's routes. */
  setEnabled(id: string, enabled: boolean): OpResult {
    const live = this.live.get(id)
    if (live === undefined) return { ok: false, message: `inbound server ${id} not found` }
    if (enabled) live.routes.enable()
    else live.routes.disable()
    const stored = this.store.get(id)
    if (stored !== undefined) {
      void this.store.save({ ...stored, enabled }).catch(() => {})
    }
    return { ok: true, message: `inbound server ${id} ${enabled ? 'enabled' : 'disabled'}` }
  }

  /** Remove, dispose, and unpersist an instance. */
  async remove(id: string): Promise<OpResult> {
    const live = this.live.get(id)
    if (live === undefined) return { ok: false, message: `inbound server ${id} not found` }
    live.dispose()
    this.live.delete(id)
    await this.store.remove(id)
    return { ok: true, message: `inbound server ${id} removed` }
  }

  /** Dispose every instance. */
  disposeAll(): void {
    for (const live of this.live.values()) live.dispose()
    this.live.clear()
  }

  private newId(seed: string): string {
    const slug = seed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'server'
    return `${slug}-${this.host.newId()}`
  }
}

export type { AgentSkill }