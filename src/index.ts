/**
 * @hanphone/dsh-a2a — Cordis plugin entry.
 *
 * Mounts the A2A v1.0.1 dual-end plugin as a MULTI-INSTANCE composition: an
 * arbitrary set of inbound A2A servers (each a preset-bound session pool, its
 * own endpoint + AgentCard + creator-declared skills + auth) and an arbitrary
 * set of outbound A2A connections (each a remote URL + preset + timeout).
 * Instances are persisted in the `a2a` domain (`inbound_servers` /
 * `outbound_servers` tables) and created/edited/started/stopped entirely from
 * the GUI — the plugin `Config` is minimal and instance setup is not
 * patch-config driven. The protocol surface is aligned with the official A2A
 * v1.0.1 spec (see docs/reference/http-api.md).
 *
 * Optional services are probed rather than injected so a composition lacking
 * one half idles just that half; only the storage domain is required.
 *
 * Function-plugin export shape: named `name`/`inject`/`Config`/`apply`, no
 * default export (mixing forms makes the Loader drop the namespace).
 * @module dsh-a2a
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { openDomain, DomainTaskStore, type A2aDomain, type TaskStore } from './server/store.ts'
import type { ModelOptionView } from './service.ts'
import { probeService, type AgentPresetsLike, type AgentRegistryLike, type AttachmentsLike, type CredentialsLike, type SkillsLike } from './server/exec/agent-runtime.ts'
import { aggregateSessionViews, type SessionView } from './server/session-registry.ts'
import { A2aMetrics } from './server/metrics.ts'
import { isTerminal, Role } from './protocol.ts'
import type { SubagentsLike } from './server/exec/subagent.ts'
import { handleApiRequest } from './api.ts'
import { createUpdateChecker } from './update.ts'
import { A2AService, type A2AServiceImpl, type DeploymentSettingsView, type InboundCreateInput, type InboundServerView, type OutboundCreateInput, type OpResult, type PresetView, type SkillView, type TaskListPage, type TaskListQuery } from './service.ts'
import { buildA2aCommand } from './commands.ts'
import { InboundServerManager, DomainInboundStore, resolveAuthToken, validateBaseUrl, type InboundManagerHost, type WebServerLike as InboundWebServerLike } from './servers/inbound-manager.ts'
import { readDeploymentSettings, writeDeploymentSettings, type DeploymentSettingsRecord } from './server/settings.ts'
import { discoverBaseUrlCandidates } from './server/net.ts'
import { registerDefaultWorkspace, type WorkspaceCreatorLike, type WorkspaceRegistrationStatus } from './server/default-workspace.ts'
import { OutboundServerManager, DomainOutboundStore, type OutboundManagerHost, type OutboundServerView } from './servers/outbound-manager.ts'

export const name = 'a2a'

/** Structural slice of `ctx.workspaceRegistry` used to lift stale archive flags. */
interface WorkspaceRegistryLike {
  readonly archivedSessionIds?: readonly unknown[]
  unarchiveSession(sessionId: string): Promise<unknown>
}

/** Only the storage domain is required; the other halves are probed. */
export const inject = ['storageDomain'] as const

/** Minimal host-level config; per-instance setup happens in the GUI/domain. */
export interface A2AConfig {
  /** Advertised base URL for every inbound card; absent lets a default stand. */
  baseUrl?: string
  /** Subagent driver provider for the inbound subagent executors. */
  subagentProvider: string
  /** Default outbound connection timeout (ms). */
  defaultTimeoutMs: number
  /** Per-task inbound execution budget (ms); 0 disables it. */
  inboundTimeoutMs: number
  /** Sliding-window request cap per inbound source per minute; 0 disables it. */
  requestsPerMinute: number
  /** Maximum concurrent tasks per inbound instance; 0 disables it. */
  maxConcurrentTasks: number
  /** Maximum accepted inbound HTTP body in bytes. */
  maxBodyBytes: number
  /** Automatic outbound AgentCard refresh interval (ms); 0 disables it. */
  outboundRefreshMs: number
  /** Deployment gate/default for the optional inbound trace extension. */
  inboundTrace: boolean
}

/** Loader-validated config schema (defaults applied by the Loader). */
export const Config: z<A2AConfig> = z.object({
  baseUrl: z.string(),
  subagentProvider: z.string().default('in-process'),
  defaultTimeoutMs: z.number().default(60_000),
  inboundTimeoutMs: z.number().default(600_000),
  requestsPerMinute: z.number().default(120),
  maxConcurrentTasks: z.number().default(32),
  maxBodyBytes: z.number().default(1_048_576),
  outboundRefreshMs: z.number().default(300_000),
  inboundTrace: z.boolean().default(false),
})

export function apply(ctx: Context, config: A2AConfig) {
  const logger = ctx.logger('a2a')
  const subagentProvider = config.subagentProvider
  const inboundCwd = inboundSessionCwd()
  // One checker per plugin instance: the dashboard version strip and the
  // explicit update check share its six-hour cache, while snapshot traffic
  // never reaches the network.
  const updateChecker = createUpdateChecker({ packageRoot: pluginPackageRoot() })

  ctx.inject(['storageDomain'], (ctx) => {
    ctx.effect(async () => {
      const domain = await openDomain(ctx.storageDomain)
      const store = new DomainTaskStore(domain)

      // Probe the optional host services each half uses.
      const webServer = probeService(ctx, 'webServer', 'register') as InboundWebServerLike | undefined
      const tools = probeService(ctx, 'tools', 'register') as
        | ({ get(name: string): unknown } & { register(def: unknown): (() => void) | void })
        | undefined
      const agents = probeService(ctx, 'agents', 'create') as AgentRegistryLike | undefined
      const agentPresets = probeService(ctx, 'agentPresets', 'list') as
        | (AgentPresetsLike & { list(): Promise<Array<{ id: string; name?: string; description?: string }>>; readonly defaultId?: string })
        | undefined
      const skills = probeService(ctx, 'skills', 'list') as SkillsLike | undefined
      const credentials = probeService(ctx, 'credentials', 'resolve') as CredentialsLike | undefined
      const subagents = probeService(ctx, 'subagents', 'start') as SubagentsLike | undefined
      const attachments = probeService(ctx, 'attachments', 'admitPromptContent') as AttachmentsLike | undefined
      const metrics = new A2aMetrics()
      const commandsRef = probeService(ctx, 'commands', 'register') as
        | { register(def: { name: string; description: string; handler(...args: unknown[]): unknown }): () => void }
        | undefined

      const loopbackBaseUrl = (): string => `http://127.0.0.1:${webServerPort(webServer) ?? process.env['DSH_A2A_PORT'] ?? '3000'}`
      // A host that archived one of our sessions (session-list cleanup) rejects
      // every step it is woken for, so the turn ends `blocked` with no assistant
      // text. Probe lazily: the registry may mount after this plugin.
      const reviveArchivedSession = async (sessionId: string): Promise<void> => {
        const registry = probeService(ctx, 'workspaceRegistry', 'unarchiveSession') as WorkspaceRegistryLike | undefined
        if (registry === undefined) return
        const archived = registry.archivedSessionIds ?? []
        if (!archived.some((id) => String(id) === sessionId)) return
        await registry.unarchiveSession(sessionId)
        logger.info(`[a2a] revived archived session ${sessionId}`)
      }
      // Inbounds without their own workspace run in `inboundCwd`; the host
      // only lists sessions whose cwd is a registered workspace, so own that
      // directory. Idempotent — the host reuses an existing record — hence it
      // runs once per start and again whenever an inbound is saved blank.
      const ensureInboundWorkspace = (): Promise<WorkspaceRegistrationStatus> =>
        registerDefaultWorkspace(
          probeService(ctx, 'workspaceRegistry', 'create') as WorkspaceCreatorLike | undefined,
          inboundCwd,
          {
            onRegistered: (dir) => logger.info(`[a2a] default inbound workspace registered: ${dir}`),
            onError: (dir, error) => logger.warn(`[a2a] default inbound workspace registration failed for ${dir}: ${(error as Error).message}`),
          },
        )
      // GUI-editable deployment overrides live in the `a2a` domain and win over
      // the loader config; an absent value inherits the config, then loopback.
      let deploymentSettings = readDeploymentSettings(domain)
      const effectiveBaseUrl = (): string => deploymentSettings?.baseUrl ?? config.baseUrl ?? loopbackBaseUrl()

      // ── inbound manager ───────────────────────────────────────────────
      const inboundHost: InboundManagerHost = {
        ctx,
        webServer: webServer ?? { register: noopRegister },
        tasks: store,
        logger,
        ...(agents !== undefined ? { agents } : {}),
        ...(agentPresets !== undefined ? { agentPresets } : {}),
        ...(skills !== undefined ? { skills } : {}),
        ...(credentials !== undefined ? { credentials } : {}),
        ...(subagents !== undefined ? { subagents } : {}),
        ...(attachments !== undefined ? { attachments } : {}),
        metrics,
        taskTimeoutMs: config.inboundTimeoutMs,
        requestsPerMinute: config.requestsPerMinute,
        maxConcurrentTasks: config.maxConcurrentTasks,
        maxBodyBytes: config.maxBodyBytes,
        ...(agentPresets?.defaultId !== undefined ? { defaultPresetId: agentPresets.defaultId } : {}),
        resolveDefaultModel: () => resolveDefaultModel(ctx),
        reviveArchivedSession,
        sessionCwd: inboundCwd,
        defaultBaseUrl: effectiveBaseUrl,
        subagentProvider,
        inboundTrace: config.inboundTrace,
        newId: () => crypto.randomUUID().slice(0, 8),
      }
      const inboundManager = new InboundServerManager(inboundHost, new DomainInboundStore(domain.inbound_servers))
      await inboundManager.boot()
      // The workspace registry may mount after this plugin, so a single
      // startup probe can miss it: retry briefly, and let every
      // blank-workspace inbound save retry as well.
      let workspaceRegTimer: ReturnType<typeof setTimeout> | undefined
      let workspaceRegAttempts = 0
      const attemptWorkspaceRegistration = async (): Promise<void> => {
        workspaceRegAttempts += 1
        const status = await ensureInboundWorkspace()
        // A host rejection is already logged and will not fix itself.
        if (status !== 'unavailable') return
        if (workspaceRegAttempts >= WORKSPACE_REGISTRATION_ATTEMPTS) {
          logger.warn('[a2a] workspace registry stayed unavailable; default inbound sessions are not listed')
          return
        }
        workspaceRegTimer = setTimeout(() => void attemptWorkspaceRegistration(), 500)
      }
      void attemptWorkspaceRegistration()

      // ── outbound manager ──────────────────────────────────────────────
      const outboundHost: OutboundManagerHost = {
        registrar: { register: (def) => tools?.register(def) },
        tokenOf: async (env) => (env ? await resolveAuthToken(credentials, env) : undefined),
        ...(credentials !== undefined ? { credentials } : {}),
        onError: (message) => logger.warn(message),
        defaultTimeoutMs: config.defaultTimeoutMs,
        refreshIntervalMs: config.outboundRefreshMs,
        metrics,
      }
      const outboundManager = new OutboundServerManager(
        outboundHost,
        domain.agents,
        new DomainOutboundStore(domain.outbound_servers),
        () => `out-${crypto.randomUUID().slice(0, 12)}`,
      )
      outboundManager.boot()

      // ── service facade + commands + GUI API ───────────────────────────
      const impl: A2AServiceImpl = makeFacade({
        domain,
        store,
        inboundManager,
        outboundManager,
        agentPresets,
        metrics,
        logger: logger.info.bind(logger),
        listModels: () => listAvailableModels(ctx),
        modelDiagnostics: async () => (await probeModelCatalogue(ctx)).diagnostics,
        defaultBaseUrl: effectiveBaseUrl,
        ...(config.baseUrl !== undefined ? { configBaseUrl: config.baseUrl } : {}),
        deploymentSettings: () => deploymentSettings,
        ensureInboundWorkspace,
        updateDeploymentSettings: async (patch) => {
          const current: DeploymentSettingsRecord = deploymentSettings ?? {}
          const raw = patch.baseUrl ?? ''
          let next: DeploymentSettingsRecord
          if (raw.trim().length === 0) {
            // Blank clears the override so the loader config applies again.
            const { baseUrl: _cleared, ...rest } = current
            next = rest
          } else {
            const checked = validateBaseUrl(raw)
            if (!checked.ok) return { ok: false, message: checked.message }
            next = { ...current, ...(checked.value !== undefined ? { baseUrl: checked.value } : {}) }
          }
          try {
            await writeDeploymentSettings(domain, next)
          } catch (err) {
            return { ok: false, message: `failed to persist settings: ${String(err)}` }
          }
          deploymentSettings = next
          // Re-assemble every live instance so a mode switch takes effect now.
          for (const live of inboundManager.list()) await inboundManager.update(live.id, {})
          return { ok: true, message: `advertised base URL: ${next.baseUrl ?? 'inherit (plugin config)'}` }
        },
      })
      new A2AService(ctx, impl)

      if (commandsRef !== undefined) {
        ctx.effect(() => commandsRef.register(buildA2aCommand(impl) as never), 'a2a: command')
      }

      if (webServer !== undefined) {
        ctx.effect(() => webServer.register({
          kind: 'prefix',
          path: '/a2a/api',
          handler: (req: unknown, res: unknown) => handleApiRequest(req as never, res as never, impl, updateChecker),
        }), 'a2a: dashboard api')
      } else {
        logger.warn('a2a: webServer not mounted; GUI dashboard API idle')
      }

      return async () => {
        if (workspaceRegTimer !== undefined) clearTimeout(workspaceRegTimer)
        inboundManager.disposeAll()
        await outboundManager.disposeAll()
        await domain.close()
      }
    }, 'a2a: multi-instance composition')
  })
}

interface FacadeHost {
  readonly domain: A2aDomain
  readonly store: TaskStore
  readonly inboundManager: InboundServerManager
  readonly outboundManager: OutboundServerManager
  readonly metrics: A2aMetrics
  readonly agentPresets?: (AgentPresetsLike & { list(): Promise<Array<{ id: string; name?: string; description?: string }>>; readonly defaultId?: string }) | undefined
  readonly logger: (message: string) => void
  /** Model catalogue of the deployment (empty when the host has no LLM service). */
  readonly listModels?: (() => Promise<ModelOptionView[]>) | undefined
  /** Diagnostics for the catalogue probe, surfaced by `?debug=1`. */
  readonly modelDiagnostics?: (() => Promise<Record<string, unknown>>) | undefined
  /** Deployment advertised base URL; `auto` means request-derived per instance. */
  readonly defaultBaseUrl?: string | (() => string) | undefined
  /** Loader-level `baseUrl` config, shown as the inherit target in the GUI. */
  readonly configBaseUrl?: string | undefined
  /** GUI-editable deployment overrides (a getter so edits show immediately). */
  readonly deploymentSettings?: (() => DeploymentSettingsRecord | undefined) | undefined
  /** Persist new deployment settings and re-assemble live instances. */
  readonly updateDeploymentSettings?: ((patch: { readonly baseUrl?: string }) => Promise<OpResult>) | undefined
  /** Own the default inbound session directory as a host workspace. */
  readonly ensureInboundWorkspace?: (() => Promise<WorkspaceRegistrationStatus>) | undefined
}

/** Facade closure over the two managers (commands and `ctx.a2a` consumers). */
function makeFacade(host: FacadeHost): A2AServiceImpl {
  /** Current deployment default base URL (`auto` or a concrete origin). */
  const hostBaseUrl = (): string | undefined => {
    const source = host.defaultBaseUrl
    if (source === undefined) return undefined
    return typeof source === 'function' ? source() : source
  }

  const inboundView = (id: string): InboundServerView | undefined => {
    const live = host.inboundManager.get(id)
    if (live === undefined) return undefined
    const r = live.record
    const effectiveBaseUrl = r.baseUrl ?? hostBaseUrl()
    const autoBaseUrl = effectiveBaseUrl === 'auto'
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      version: r.version,
      endpointPath: live.endpointPath,
      // Effective preset: the record's, else the deployment default.
      ...(live.preset !== undefined ? { preset: live.preset } : {}),
      ...(r.authTokenEnv !== undefined ? { authTokenEnv: r.authTokenEnv } : {}),
      cardPath: live.cardPath,
      ...(!autoBaseUrl && live.card.supportedInterfaces?.[0]?.url !== undefined ? { cardUrl: live.card.supportedInterfaces[0].url } : {}),
      enabled: live.routes.active,
      trace: live.traceEnabled,
      ...(r.workspace !== undefined ? { workspace: r.workspace } : {}),
      ...(r.provider !== undefined ? { provider: r.provider } : {}),
      ...(r.model !== undefined ? { model: r.model } : {}),
      ...(effectiveBaseUrl !== undefined ? { baseUrl: effectiveBaseUrl } : {}),
      skills: live.skills.map((s): SkillView => ({ id: s.id, name: s.name, ...(s.description != null ? { description: s.description } : {}) })),
    }
  }

  // Cancel every non-terminal task of one context through whichever instance
  // owns the shared task store (abort is idempotent per task record). When a
  // serverId is supplied, the action is scoped to that instance.
  const cancelContextTasks = (contextId: string, serverId?: string): number => {
    let canceled = 0
    for (const task of host.store.list()) {
      if (task.contextId !== contextId || isTerminal(task.state)) continue
      if (serverId !== undefined && task.serverId !== serverId) continue
      for (const live of host.inboundManager.list()) {
        if (live.server.abort(task.taskId)) {
          canceled += 1
          break
        }
      }
    }
    return canceled
  }

  // Aggregate the session layer: live observations (streaming, pool handles)
  // folded over the shared task store, grouped by (serverId, contextId).
  const sessionViews = (): SessionView[] => aggregateSessionViews(host.store.list(), host.inboundManager.list())

  const audit = (kind: string, detail: string, serverId?: string): void => {
    host.metrics.recordAudit({ kind, detail, ...(serverId !== undefined ? { serverId } : {}) })
  }

  const taskPage = (query: TaskListQuery = {}): TaskListPage => {
    const filtered = host.store.list()
      .filter((task) => query.serverId === undefined || task.serverId === query.serverId)
      .filter((task) => query.contextId === undefined || task.contextId === query.contextId)
      .filter((task) => query.state === undefined || task.state === query.state)
      .sort((a, b) => (a.updatedAt === b.updatedAt ? (a.taskId < b.taskId ? 1 : -1) : (a.updatedAt < b.updatedAt ? 1 : -1)))
    const limit = Math.max(1, Math.min(200, Math.floor(query.limit ?? 50)))
    const offset = Math.max(0, Math.floor(query.offset ?? 0))
    const tasks = filtered.slice(offset, offset + limit)
    return {
      tasks,
      total: filtered.length,
      nextOffset: offset + tasks.length < filtered.length ? offset + tasks.length : null,
    }
  }

  return {
    status(): unknown {
      return {
        inbounds: host.inboundManager.list().map((live) => inboundView(live.id)).filter((v): v is InboundServerView => v !== undefined),
        outbounds: host.outboundManager.list(),
        tasks: host.store.list().length,
        sessions: sessionViews(),
      }
    },
    async models(): Promise<ModelOptionView[]> {
      try {
        return (await host.listModels?.()) ?? []
      } catch {
        return []
      }
    },
    async modelDiagnostics(): Promise<Record<string, unknown>> {
      try {
        return (await host.modelDiagnostics?.()) ?? { reason: 'no diagnostics hook' }
      } catch (err) {
        return { reason: `diagnostics threw: ${(err as Error).message}` }
      }
    },
    settings(): DeploymentSettingsView {
      const storedBaseUrl = host.deploymentSettings?.()?.baseUrl
      const mode: DeploymentSettingsView['mode'] = storedBaseUrl === 'auto' ? 'auto' : storedBaseUrl !== undefined ? 'custom' : 'inherit'
      return {
        mode,
        ...(storedBaseUrl !== undefined ? { baseUrl: storedBaseUrl } : {}),
        effectiveBaseUrl: hostBaseUrl() ?? '',
        ...(host.configBaseUrl !== undefined ? { configBaseUrl: host.configBaseUrl } : {}),
        candidates: discoverBaseUrlCandidates(),
      }
    },
    async updateSettings(patch: { readonly baseUrl?: string }): Promise<OpResult> {
      const apply = host.updateDeploymentSettings
      if (apply === undefined) return { ok: false, message: 'deployment settings are not editable in this composition' }
      return apply(patch)
    },
    async presets(): Promise<PresetView[]> {
      if (host.agentPresets === undefined) return []
      const defaultId = host.agentPresets.defaultId
      try {
        return (await host.agentPresets.list()).map((p) => ({
          id: p.id,
          ...(p.name !== undefined ? { name: p.name } : {}),
          ...(p.description !== undefined ? { description: p.description } : {}),
          ...(defaultId !== undefined && p.id === defaultId ? { isDefault: true } : {}),
        }))
      } catch {
        return []
      }
    },
    // ── inbound ─────────────────────────────────────────────────────────
    listInboundServers(): InboundServerView[] {
      return host.inboundManager.list().map((live) => inboundView(live.id)).filter((v): v is InboundServerView => v !== undefined)
    },
    async createInboundServer(input: InboundCreateInput): Promise<OpResult> {
      // A blank workspace means "the deployment default"; make that default
      // visible in the host session list before the first session lands in it.
      if (input.workspace === undefined || input.workspace.trim().length === 0) await host.ensureInboundWorkspace?.()
      const result = await host.inboundManager.add({
        name: input.name,
        description: input.description,
        version: input.version,
        ...(input.endpointPath !== undefined ? { endpointPath: input.endpointPath } : {}),
        ...(input.preset !== undefined ? { preset: input.preset } : {}),
        ...(input.authTokenEnv !== undefined ? { authTokenEnv: input.authTokenEnv } : {}),
        ...(input.trace !== undefined ? { trace: input.trace } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.workspace !== undefined ? { workspace: input.workspace } : {}),
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      })
      host.logger(`[a2a] inbound created: ${result.message}`)
      audit('inbound.create', result.message, result.id)
      return result
    },
    async removeInboundServer(id: string): Promise<OpResult> {
      const result = await host.inboundManager.remove(id)
      audit('inbound.remove', result.message, id)
      return result
    },
    async setInboundServerEnabled(id: string, enabled: boolean): Promise<OpResult> {
      const result = host.inboundManager.setEnabled(id, enabled)
      audit('inbound.enable', result.message, id)
      return result
    },
    async updateInboundServer(id: string, patch: { name?: string; description?: string; version?: string; endpointPath?: string; preset?: string; authTokenEnv?: string; trace?: boolean; workspace?: string; provider?: string; model?: string; baseUrl?: string }): Promise<OpResult> {
      // Clearing the override returns the endpoint to the deployment default;
      // re-own it so its sessions stay listed.
      if (patch.workspace !== undefined && patch.workspace.trim().length === 0) await host.ensureInboundWorkspace?.()
      const result = await host.inboundManager.update(id, patch)
      audit('inbound.update', result.message, id)
      return result
    },
    async setInboundAuth(id: string, token: string | undefined): Promise<OpResult> {
      const result = await host.inboundManager.setAuth(id, token)
      audit('inbound.setAuth', result.message, id)
      return result
    },
    agentCard(id: string): unknown {
      return host.inboundManager.get(id)?.card
    },
    async sendTestMessage(id: string, input: { readonly text: string; readonly contextId?: string; readonly skill?: string }): Promise<unknown> {
      const live = host.inboundManager.get(id)
      if (live === undefined) throw new Error(`inbound server ${id} not found`)
      const message = {
        messageId: crypto.randomUUID(),
        role: Role.USER,
        ...(input.contextId !== undefined ? { contextId: input.contextId } : {}),
        parts: [{ text: input.text }],
        ...(input.skill !== undefined ? { metadata: { skill: input.skill } } : {}),
      }
      return live.server.sendTest(message)
    },
    // ── outbound ────────────────────────────────────────────────────────
    listOutboundServers(): OutboundServerView[] {
      return [...host.outboundManager.list()]
    },
    async createOutboundServer(input: OutboundCreateInput): Promise<OpResult> {
      const result = await host.outboundManager.add({
        ...(input.id !== undefined ? { id: input.id } : {}),
        name: input.name,
        agentCardUrl: input.agentCardUrl,
        ...(input.bearerTokenEnv !== undefined ? { bearerTokenEnv: input.bearerTokenEnv } : {}),
        ...(input.preset !== undefined ? { preset: input.preset } : {}),
        enabled: input.enabled ?? true,
        timeoutMs: input.timeoutMs ?? host.outboundManager.defaultTimeoutMs,
        ...(input.disabledSkills !== undefined ? { disabledSkills: input.disabledSkills } : {}),
        ...(input.skillOverrides !== undefined ? { skillOverrides: input.skillOverrides } : {}),
      })
      audit('outbound.create', result.message, result.id)
      return result
    },
    async removeOutboundServer(id: string): Promise<OpResult> {
      const result = await host.outboundManager.remove(id)
      audit('outbound.remove', result.message, id)
      return result
    },
    async setOutboundServerEnabled(id: string, enabled: boolean): Promise<OpResult> {
      const result = await host.outboundManager.setEnabled(id, enabled)
      audit('outbound.enable', result.message, id)
      return result
    },
    async refreshOutboundServer(id: string): Promise<OpResult> {
      const result = await host.outboundManager.refresh(id)
      audit('outbound.refresh', result.message, id)
      return result
    },
    async setOutboundAuth(id: string, token: string | undefined): Promise<OpResult> {
      const result = await host.outboundManager.setAuth(id, token)
      audit('outbound.setAuth', result.message, id)
      return result
    },
    async discoverOutbound(url: string, bearerToken?: string): Promise<OpResult & { readonly preview?: unknown }> {
      return host.outboundManager.discover(url, bearerToken)
    },
    async updateOutboundServer(id: string, patch: { readonly name?: string; readonly preset?: string; readonly timeoutMs?: number; readonly disabledSkills?: readonly string[]; readonly skillOverrides?: Readonly<Record<string, { readonly name?: string; readonly description?: string }>> }): Promise<OpResult> {
      const result = await host.outboundManager.update(id, patch)
      audit('outbound.update', result.message, id)
      return result
    },
    // ── tasks ───────────────────────────────────────────────────────────
    getTask(taskId: string): unknown {
      return host.store.get(taskId)
    },
    listTasks(query?: TaskListQuery): TaskListPage {
      return taskPage(query)
    },
    async cancelTask(taskId: string): Promise<OpResult> {
      const live = host.inboundManager.list().find((l) => l.server.abort(taskId))
      return { ok: live !== undefined, message: live !== undefined ? `task ${taskId} canceled` : `task ${taskId} not found or already terminal` }
    },
    // ── inbound sessions (per contextId) ────────────────────────────────
    listSessions(): SessionView[] {
      return sessionViews()
    },
    async cancelSessionTasks(contextId: string, serverId?: string): Promise<OpResult> {
      const canceled = cancelContextTasks(contextId, serverId)
      return {
        ok: true,
        message: canceled > 0
          ? `session ${contextId}: canceled ${canceled} active task(s)`
          : `session ${contextId}: no active tasks`,
      }
    },
    async closeSession(contextId: string, serverId?: string): Promise<OpResult> {
      const canceled = cancelContextTasks(contextId, serverId)
      // Dispose every live handle for the context across instances; the next
      // task on the same contextId re-opens a fresh handle (never refused —
      // A2A has no closed-context concept, see session-registry docs).
      let closed = 0
      for (const live of host.inboundManager.list()) {
        if (serverId !== undefined && live.id !== serverId) continue
        if (live.sessionPool !== undefined && live.sessionPool.has(contextId)) {
          await live.sessionPool.disposeContext(contextId)
          closed += 1
        }
      }
      const parts: string[] = [
        ...(canceled > 0 ? [`canceled ${canceled} active task(s)`] : []),
        ...(closed > 0 ? [`closed ${closed} live session(s)`] : []),
      ]
      return {
        ok: true,
        message: parts.length > 0 ? `session ${contextId}: ${parts.join('; ')}` : `session ${contextId}: no active tasks or live sessions`,
      }
    },
    sessionMessages(contextId: string, serverId?: string): readonly unknown[] {
      const matches = host.inboundManager.list().filter((live) =>
        (serverId === undefined || live.id === serverId) && live.sessionPool?.has(contextId) === true)
      if (matches.length > 1) throw new Error(`session ${contextId} is ambiguous; specify serverId`)
      return matches[0]?.sessionPool?.messages(contextId) ?? []
    },
    metrics(): unknown {
      return host.metrics.snapshot()
    },
    // ── inbound peers (aggregated across instances) ─────────────────────
    inbounds(): unknown {
      return host.inboundManager.list().flatMap((live) => live.inbound.list())
    },
    async closeInbound(peerId: string): Promise<OpResult> {
      for (const live of host.inboundManager.list()) {
        const peers = live.inbound.activeTasksOf(peerId)
        for (const taskId of peers) live.server.abort(taskId)
        const result = live.inbound.closePeer(peerId)
        if (result) return { ok: true, message: `inbound peer ${peerId} closed` }
      }
      return { ok: false, message: `inbound peer ${peerId} not found` }
    },
  }
}

/** Locate the host `llm` service through reflection or a plain property read. */
function probeLlm(ctx: Context): { llm: unknown; via: 'reflect' | 'property' | 'none' } {
  const svc = probeService(ctx, 'llm', 'listProviders') ?? probeService(ctx, 'llm', 'listModels')
  if (svc !== undefined) return { llm: svc, via: 'reflect' }
  const direct = (ctx as unknown as { llm?: unknown }).llm
  if (direct !== undefined && direct !== null) return { llm: direct, via: 'property' }
  return { llm: undefined, via: 'none' }
}

interface CatalogueProbe {
  readonly rows: ModelOptionView[]
  readonly diagnostics: Record<string, unknown>
}

/** Enumerate the models the deployment can actually route to (best effort). */
async function probeModelCatalogue(ctx: Context): Promise<CatalogueProbe> {
  const { llm, via } = probeLlm(ctx)
  const diagnostics: Record<string, unknown> = { service: via }
  if (llm === undefined || llm === null) {
    return { rows: [], diagnostics: { ...diagnostics, reason: 'llm service not found on ctx' } }
  }
  const svc = llm as {
    listProviders?(): Promise<readonly unknown[]> | readonly unknown[]
    listModels?(provider: string): Promise<readonly { provider: string; id: string; name: string }[]>
  }
  diagnostics.listProviders = typeof svc.listProviders === 'function'
  diagnostics.listModels = typeof svc.listModels === 'function'
  if (typeof svc.listModels !== 'function') {
    return { rows: [], diagnostics: { ...diagnostics, reason: 'llm service has no listModels()' } }
  }
  let providers: readonly unknown[] = []
  try {
    providers = (await svc.listProviders?.()) ?? []
  } catch (err) {
    return { rows: [], diagnostics: { ...diagnostics, reason: `listProviders threw: ${(err as Error).message}` } }
  }
  diagnostics.providers = providers.map((raw) => providerIdOf(raw) ?? `?${JSON.stringify(raw)}`)
  const rows: ModelOptionView[] = []
  const failures: string[] = []
  for (const raw of providers) {
    const provider = providerIdOf(raw)
    if (provider === undefined) continue
    try {
      for (const model of await svc.listModels(provider)) {
        rows.push({ provider: model.provider, id: model.id, name: model.name })
      }
    } catch (err) {
      failures.push(`${provider}: ${(err as Error).message}`)
    }
  }
  if (failures.length > 0) diagnostics.failures = failures
  diagnostics.rows = rows.length
  return { rows, diagnostics }
}

function providerIdOf(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw
  const row = raw as { id?: unknown; provider?: unknown }
  if (typeof row.id === 'string') return row.id
  if (typeof row.provider === 'string') return row.provider
  return undefined
}

async function listAvailableModels(ctx: Context): Promise<ModelOptionView[]> {
  try {
    return (await probeModelCatalogue(ctx)).rows
  } catch {
    return []
  }
}

function resolveDefaultModel(ctx: Context): { provider?: string; model?: string } | undefined {
  const service = probeService(ctx, 'agentDefaultModel', 'currentSelection') as
    | { currentSelection(): { provider?: string; model?: string } }
    | undefined
  return service?.currentSelection()
}

/** Absolute stable cwd for inbound per-context sessions (never profile root). */
function inboundSessionCwd(): string {
  const home = join(homedir(), '.dsh')
  const dshHome = process.env['DSH_HOME'] ?? home
  const dir = join(dshHome, 'a2a-sessions')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // cwd fallback below stays valid
  }
  return dir
}

/** Startup retry budget for the default workspace registration (500ms each). */
const WORKSPACE_REGISTRATION_ATTEMPTS = 40

function noopRegister(): () => void {
  return () => {}
}

/** The plugin package root in source and bundled layouts (src/ or lib/ → root). */
function pluginPackageRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url))
}

/** The listening port of a mounted webServer (undefined when unavailable). */
function webServerPort(webServer: InboundWebServerLike | undefined): string | undefined {
  const candidate = webServer as { port?: number | (() => number) } | undefined
  if (candidate === undefined) return undefined
  const value = typeof candidate.port === 'function' ? (candidate as { port(): number }).port() : candidate.port
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined
}

export type { OpResult }
export { A2AServer } from './server/a2a-server.ts'
export { A2AClient, A2AError } from './outbound/calls.ts'
export { A2AService } from './service.ts'
