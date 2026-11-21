/**
 * The `a2a/*` event domain and the `ctx.a2a` service key. P0 ships exactly one
 * event — `a2a/inbound-task`, the policy seam — so the governance story has a
 * real built-in consumer (skill gate + audit) and third-party plugins can hang
 * approval-style policy on inbound tasks. Further events are deferred until a
 * consumer exists (see design §4).
 * @module dsh-a2a/events
 */

import type { Part } from './protocol.ts'

/** The mutable policy decision for one inbound task, before execution. */
export interface InboundTaskDecision {
  readonly contextId: string
  readonly skill: string
  readonly parts: readonly Part[]
  /** Request source identity (auth hash or null) for audit. */
  readonly remotePeerId: string | null
  /** Set by a policy listener to defer the task for human approval (P1). */
  requiresApproval?: boolean
  /** Set by a policy listener to veto the task outright. */
  rejected?: { readonly reason: string }
}

/** The facade other plugins read as `ctx.a2a`. */
export interface A2AServiceLike {
  status(): unknown
  presets(): Promise<Array<{ id: string; name?: string; description?: string }>>
  listInboundServers(): unknown
  createInboundServer(input: unknown): Promise<{ readonly ok: boolean; readonly message: string }>
  removeInboundServer(id: string): Promise<{ readonly ok: boolean; readonly message: string }>
  setInboundServerEnabled(id: string, enabled: boolean): Promise<{ readonly ok: boolean; readonly message: string }>
  updateInboundServer(id: string, patch: unknown): Promise<{ readonly ok: boolean; readonly message: string }>
  setInboundAuth(id: string, token: string | undefined): Promise<{ readonly ok: boolean; readonly message: string }>
  agentCard(id: string): unknown
  sendTestMessage(id: string, input: { readonly text: string; readonly contextId?: string; readonly skill?: string }): Promise<unknown>
  listOutboundServers(): unknown
  createOutboundServer(input: unknown): Promise<{ readonly ok: boolean; readonly message: string }>
  removeOutboundServer(id: string): Promise<{ readonly ok: boolean; readonly message: string }>
  setOutboundServerEnabled(id: string, enabled: boolean): Promise<{ readonly ok: boolean; readonly message: string }>
  refreshOutboundServer(id: string): Promise<{ readonly ok: boolean; readonly message: string }>
  setOutboundAuth(id: string, token: string | undefined): Promise<{ readonly ok: boolean; readonly message: string }>
  discoverOutbound(url: string, bearerToken?: string): Promise<{ readonly ok: boolean; readonly message: string; readonly preview?: unknown }>
  updateOutboundServer(id: string, patch: unknown): Promise<{ readonly ok: boolean; readonly message: string }>
  getTask(taskId: string): unknown
  listTasks(query?: unknown): unknown
  cancelTask(taskId: string): Promise<{ readonly ok: boolean; readonly message: string }>
  listSessions(): unknown
  cancelSessionTasks(contextId: string, serverId?: string): Promise<{ readonly ok: boolean; readonly message: string }>
  closeSession(contextId: string, serverId?: string): Promise<{ readonly ok: boolean; readonly message: string }>
  sessionMessages(contextId: string, serverId?: string): readonly unknown[]
  metrics(): unknown
  inbounds(): unknown
  closeInbound(peerId: string): Promise<{ readonly ok: boolean; readonly message: string }>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The A2A service facade, provided while the plugin is mounted. */
    a2a: A2AServiceLike
  }

  interface Events {
    /**
     * Policy seam for one inbound task, dispatched as a waterfall before the
     * task starts. Listeners mutate the decision (attach `requiresApproval`,
     * set `rejected`) and MUST call `next()` to delegate; returning without
     * `next()` short-circuits and the returned value is final. Harness 0.2.2-rc.1
     * (cordis 4.1.0) made the continuation a thunk that takes no arguments, so
     * listeners pass their changes by mutating `decision`.
     * @mode waterfall
     * @param decision — the mutable task decision.
     * @param next - delegate the (possibly mutated) decision downstream.
     * @returns the final decision after all listeners.
     */
    'a2a/inbound-task'(this: unknown, decision: InboundTaskDecision, next: () => Promise<InboundTaskDecision> | InboundTaskDecision): Promise<InboundTaskDecision>
  }
}