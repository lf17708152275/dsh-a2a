/**
 * The `ctx.a2a` service facade: the thin read/control surface commands, the
 * GUI API, and other plugins use. Registered as a Cordis Service so the key
 * disappears with the plugin fiber.
 * @module dsh-a2a/service
 */

import type { BaseUrlCandidate } from './server/net.ts'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionView } from './server/session-registry.ts'

export type { SessionView }

/** A result with a user-facing message. */
export interface OpResult {
  readonly ok: boolean
  readonly message: string
}

/** One plugin row of the preset an inbound session will mount. */
export interface PresetPluginView {
  /** Row id inside the preset declaration, when it has one. */
  readonly entryId: string | null
  /** Plugin/module name, e.g. `@deepseek-ai/dsh-persona`. */
  readonly module: string
  /** `false` = declared but disabled, `'conditional'` = `!!js` condition. */
  readonly enabled: boolean | 'conditional'
  /** The `!!js` condition source for conditional rows. */
  readonly condition?: string
  /** Display name of the module (falls back to its short name). */
  readonly label?: string
  /** One-line explanation of what the plugin does. */
  readonly hint?: string
}

/** Agent-preset roster row shown in the instance pickers. */
export interface PresetView {
  readonly id: string
  readonly name?: string
  readonly description?: string
  /** Whether this preset is the deployment default when none is named. */
  readonly isDefault?: boolean
  /** Whether the host reports this preset as broken (failed to compose). */
  readonly broken?: boolean
  /** Plugins a session started from this preset carries, in declaration order. */
  readonly plugins?: readonly PresetPluginView[]
}

/** A skill declaration as the GUI reads it. */
export interface SkillView {
  readonly id: string
  readonly name: string
  readonly description?: string
}

/** One selectable model: provider plus model id, for the dashboard picker. */
export interface ModelOptionView {
  readonly provider: string
  readonly id: string
  readonly name: string
}

/** One entry of the deployment's global tool catalogue. */
export interface ToolOptionView {
  readonly name: string
  readonly description?: string
}

/**
 * Deployment-wide settings as the dashboard sees them. `mode` is the effective
 * source of the advertised base URL: `inherit` (loader config), `auto`
 * (derived per request) or `custom` (a pinned URL stored in the GUI).
 */
export interface DeploymentSettingsView {
  readonly mode: 'inherit' | 'auto' | 'custom'
  /** Stored override (`auto` or an origin); absent when inheriting. */
  readonly baseUrl?: string
  /** Origin/`auto` actually in use right now. */
  readonly effectiveBaseUrl: string
  /** Loader-level `baseUrl` config, when the deployment sets one. */
  readonly configBaseUrl?: string
  /** Origins discovered on this host (pick-list entries for the dashboard). */
  readonly candidates: readonly BaseUrlCandidate[]
}

/** One inbound server instance, as the GUI/facade reads it. */
export interface InboundServerView {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version: string
  readonly endpointPath: string
  /** Effective preset id (the record's, else the deployment default). */
  readonly preset?: string
  /** Explicit preset override; absent = the instance follows the deployment default. */
  readonly presetOverride?: string
  readonly authTokenEnv?: string
  readonly cardPath: string
  readonly cardUrl?: string
  readonly enabled: boolean
  /** Effective trace-extension policy for this instance. */
  readonly trace: boolean
  /** Per-instance working directory override; absent = deployment default. */
  readonly workspace?: string
  /** Per-instance model provider override; absent = deployment default. */
  readonly provider?: string
  /** Per-instance model id override; absent = deployment default. */
  readonly model?: string
  /** Tool allow-list pinned to the instance; absent = the full tool surface. */
  readonly toolAllow?: readonly string[]
  /** Per-instance advertised base URL; absent = the deployment baseUrl config. */
  readonly baseUrl?: string
  readonly skills: readonly SkillView[]
}

/** One outbound server instance, as the GUI/facade reads it. */
export interface OutboundServerView {
  readonly id: string
  readonly name: string
  readonly agentCardUrl: string
  readonly preset?: string
  readonly enabled: boolean
  readonly timeoutMs: number
  readonly state: 'connected' | 'disconnected' | 'failed'
  readonly skillCount: number
  readonly toolCount: number
  readonly skills: readonly OutboundSkillView[]
  /** The remote AgentCard's advertised version (absent when unknown). */
  readonly agentVersion?: string
  readonly lastError?: string
  readonly lastCardAt?: string
}

/** Creator input for an inbound server instance. */
export interface InboundCreateInput {
  readonly name: string
  readonly description: string
  readonly version: string
  readonly endpointPath?: string
  /** Preset id; absent = the deployment default. Skills derive from it. */
  readonly preset?: string
  readonly authTokenEnv?: string
  /** Allow the optional trace extension on this instance. */
  readonly trace?: boolean
  readonly enabled?: boolean
  /** Absolute directory this instance's agent sessions start in; absent = the deployment default. */
  readonly workspace?: string
  /** Model provider override for this instance; absent = the deployment default. */
  readonly provider?: string
  /** Model id override for this instance; absent = the deployment default. */
  readonly model?: string
  /** Tool allow-list for this instance's sessions; absent = full tool surface. */
  readonly toolAllow?: readonly string[]
  /** Advertised base URL for this instance's agent card; absent = the deployment default. */
  readonly baseUrl?: string
}

/** Creator input for an outbound server instance. */
export interface OutboundCreateInput {
  readonly id?: string
  readonly name: string
  readonly agentCardUrl: string
  readonly bearerTokenEnv?: string
  readonly preset?: string
  readonly enabled?: boolean
  readonly timeoutMs?: number
  readonly disabledSkills?: readonly string[]
  readonly skillOverrides?: Readonly<Record<string, { readonly name?: string; readonly description?: string }>>
}

/** One outbound skill row shown in the per-skill controls. */
export interface OutboundSkillView {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly enabled: boolean
}

/** One page of task records for the dashboard. */
export interface TaskListQuery {
  readonly limit?: number
  readonly offset?: number
  readonly state?: string
  readonly contextId?: string
  readonly serverId?: string
}

export interface TaskListPage {
  readonly tasks: readonly unknown[]
  readonly total: number
  readonly nextOffset: number | null
}

/** The implementation the facade delegates to (owned by the plugin assembly). */
export interface A2AServiceImpl {
  status(): unknown
  /** Agent-preset roster for the GUI pickers. */
  presets(): Promise<PresetView[]>
  /** Model catalogue the deployment can route to (empty when unknown). */
  models(): Promise<ModelOptionView[]>
  /** Global tools a per-inbound allow-list can reference (empty when unknown). */
  tools(): Promise<ToolOptionView[]>
  /** Why the catalogue looks the way it does; for support/debugging. */
  modelDiagnostics(): Promise<Record<string, unknown>>
  /** Deployment-wide advertised base URL settings (GUI-editable). */
  settings(): DeploymentSettingsView
  /** Persist deployment settings; a blank `baseUrl` clears the override. */
  updateSettings(patch: { readonly baseUrl?: string }): Promise<OpResult>
  // ── inbound server instances ────────────────────────────────────────
  listInboundServers(): InboundServerView[]
  createInboundServer(input: InboundCreateInput): Promise<OpResult>
  removeInboundServer(id: string): Promise<OpResult>
  setInboundServerEnabled(id: string, enabled: boolean): Promise<OpResult>
  updateInboundServer(id: string, patch: { name?: string; description?: string; version?: string; endpointPath?: string; preset?: string; authTokenEnv?: string; trace?: boolean; workspace?: string; provider?: string; model?: string; toolAllow?: readonly string[]; baseUrl?: string }): Promise<OpResult>
  /** Set (or clear, when token is undefined) an inbound instance's bearer token. */
  setInboundAuth(id: string, token: string | undefined): Promise<OpResult>
  /** Read an inbound instance's current AgentCard (dashboard viewer). */
  agentCard(id: string): unknown
  /** Send one loopback test message through an inbound instance. */
  sendTestMessage(id: string, input: { readonly text: string; readonly contextId?: string; readonly skill?: string }): Promise<unknown>
  // ── outbound server instances ───────────────────────────────────────
  listOutboundServers(): OutboundServerView[]
  createOutboundServer(input: OutboundCreateInput): Promise<OpResult>
  removeOutboundServer(id: string): Promise<OpResult>
  setOutboundServerEnabled(id: string, enabled: boolean): Promise<OpResult>
  refreshOutboundServer(id: string): Promise<OpResult>
  /** Set (or clear, when token is undefined) an outbound instance's bearer token. */
  setOutboundAuth(id: string, token: string | undefined): Promise<OpResult>
  /** Read a remote AgentCard for the two-phase add preview (no state change). */
  discoverOutbound(url: string, bearerToken?: string): Promise<OpResult & { readonly preview?: unknown }>
  /** Edit an outbound instance's name/preset/timeout/skill selection. */
  updateOutboundServer(id: string, patch: { readonly name?: string; readonly preset?: string; readonly timeoutMs?: number; readonly disabledSkills?: readonly string[]; readonly skillOverrides?: Readonly<Record<string, { readonly name?: string; readonly description?: string }>> }): Promise<OpResult>
  // ── tasks ───────────────────────────────────────────────────────────
  getTask(taskId: string): unknown
  listTasks(query?: TaskListQuery): TaskListPage
  cancelTask(taskId: string): Promise<OpResult>
  // ── inbound sessions (per contextId) ────────────────────────────────
  /** Aggregate session views (live observations + task-store derivation). */
  listSessions(): SessionView[]
  /** Cancel every non-terminal task of one context (session stays open). */
  cancelSessionTasks(contextId: string, serverId?: string): Promise<OpResult>
  /**
   * Cancel the context's active tasks, dispose its live session handle(s) and
   * drop them from the pools. The next task on the same contextId re-opens a
   * fresh handle (close is a resource release, not a conversation tombstone).
   */
  closeSession(contextId: string, serverId?: string): Promise<OpResult>
  /** Derived conversation messages for one live context session. */
  sessionMessages(contextId: string, serverId?: string): readonly unknown[]
  // ── observability ───────────────────────────────────────────────────
  metrics(): unknown
  // ── inbound peer monitoring (per instance) ──────────────────────────
  inbounds(): unknown
  closeInbound(peerId: string): Promise<OpResult>
}

/** The service other plugins read as `ctx.a2a`. */
export class A2AService extends Service {
  constructor(
    ctx: Context,
    private readonly impl: A2AServiceImpl,
  ) {
    super(ctx, 'a2a')
  }

  status(): unknown {
    return this.impl.status()
  }

  async models(): Promise<ModelOptionView[]> {
    return this.impl.models()
  }

  async tools(): Promise<ToolOptionView[]> {
    return this.impl.tools()
  }

  async modelDiagnostics(): Promise<Record<string, unknown>> {
    return this.impl.modelDiagnostics()
  }

  settings(): DeploymentSettingsView {
    return this.impl.settings()
  }

  async updateSettings(patch: { readonly baseUrl?: string }): Promise<OpResult> {
    return this.impl.updateSettings(patch)
  }

  async presets(): Promise<PresetView[]> {
    return this.impl.presets()
  }

  listInboundServers(): InboundServerView[] {
    return this.impl.listInboundServers()
  }

  async createInboundServer(input: InboundCreateInput): Promise<OpResult> {
    return this.impl.createInboundServer(input)
  }

  async removeInboundServer(id: string): Promise<OpResult> {
    return this.impl.removeInboundServer(id)
  }

  async setInboundServerEnabled(id: string, enabled: boolean): Promise<OpResult> {
    return this.impl.setInboundServerEnabled(id, enabled)
  }

  async updateInboundServer(id: string, patch: { name?: string; description?: string; version?: string; endpointPath?: string; preset?: string; authTokenEnv?: string; trace?: boolean; workspace?: string; provider?: string; model?: string; toolAllow?: readonly string[]; baseUrl?: string }): Promise<OpResult> {
    return this.impl.updateInboundServer(id, patch)
  }

  async setInboundAuth(id: string, token: string | undefined): Promise<OpResult> {
    return this.impl.setInboundAuth(id, token)
  }

  agentCard(id: string): unknown {
    return this.impl.agentCard(id)
  }

  async sendTestMessage(id: string, input: { readonly text: string; readonly contextId?: string; readonly skill?: string }): Promise<unknown> {
    return this.impl.sendTestMessage(id, input)
  }

  listOutboundServers(): OutboundServerView[] {
    return this.impl.listOutboundServers()
  }

  async createOutboundServer(input: OutboundCreateInput): Promise<OpResult> {
    return this.impl.createOutboundServer(input)
  }

  async removeOutboundServer(id: string): Promise<OpResult> {
    return this.impl.removeOutboundServer(id)
  }

  async setOutboundServerEnabled(id: string, enabled: boolean): Promise<OpResult> {
    return this.impl.setOutboundServerEnabled(id, enabled)
  }

  async refreshOutboundServer(id: string): Promise<OpResult> {
    return this.impl.refreshOutboundServer(id)
  }

  async setOutboundAuth(id: string, token: string | undefined): Promise<OpResult> {
    return this.impl.setOutboundAuth(id, token)
  }

  async discoverOutbound(url: string, bearerToken?: string): Promise<OpResult & { readonly preview?: unknown }> {
    return this.impl.discoverOutbound(url, bearerToken)
  }

  async updateOutboundServer(id: string, patch: { readonly name?: string; readonly preset?: string; readonly timeoutMs?: number; readonly disabledSkills?: readonly string[]; readonly skillOverrides?: Readonly<Record<string, { readonly name?: string; readonly description?: string }>> }): Promise<OpResult> {
    return this.impl.updateOutboundServer(id, patch)
  }

  getTask(taskId: string): unknown {
    return this.impl.getTask(taskId)
  }

  listTasks(query?: TaskListQuery): TaskListPage {
    return this.impl.listTasks(query)
  }

  async cancelTask(taskId: string): Promise<OpResult> {
    return this.impl.cancelTask(taskId)
  }

  listSessions(): SessionView[] {
    return this.impl.listSessions()
  }

  async cancelSessionTasks(contextId: string, serverId?: string): Promise<OpResult> {
    return this.impl.cancelSessionTasks(contextId, serverId)
  }

  async closeSession(contextId: string, serverId?: string): Promise<OpResult> {
    return this.impl.closeSession(contextId, serverId)
  }

  sessionMessages(contextId: string, serverId?: string): readonly unknown[] {
    return this.impl.sessionMessages(contextId, serverId)
  }

  metrics(): unknown {
    return this.impl.metrics()
  }

  inbounds(): unknown {
    return this.impl.inbounds()
  }

  async closeInbound(peerId: string): Promise<OpResult> {
    return this.impl.closeInbound(peerId)
  }
}
