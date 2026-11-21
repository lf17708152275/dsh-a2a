/**
 * GUI control API for the A2A settings dashboard: one `GET /a2a/api`
 * snapshot plus `POST /a2a/api` control actions (inbound/outbound server
 * CRUD + enable/disable, task view/cancel, test console, session conversation)
 * and focused GET endpoints for an AgentCard, one task, one conversation, and
 * metrics. The browser half talks only to this route; it carries no protocol
 * knowledge. Loopback-only by default so the dashboard cannot be driven from
 * the wire.
 *
 * The route body is bound to the same `A2AServiceImpl` facade the `/a2a`
 * command surface uses, so GUI actions and commands cannot disagree.
 * @module dsh-a2a/api
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { A2AServiceImpl } from './service.ts';
import type { UpdateChecker } from './update.ts';
/** Control actions the dashboard can issue. */
export type ApiAction = {
    readonly action: 'inbound.create';
    readonly name: string;
    readonly description: string;
    readonly version: string;
    readonly endpointPath?: string;
    readonly preset?: string;
    readonly authTokenEnv?: string;
    readonly trace?: boolean;
    readonly enabled?: boolean;
    readonly workspace?: string;
    readonly provider?: string;
    readonly model?: string;
    readonly toolAllow?: readonly string[];
    readonly baseUrl?: string;
} | {
    readonly action: 'inbound.remove' | 'inbound.enable' | 'inbound.disable' | 'inbound.update';
    readonly id: string;
    readonly name?: string;
    readonly description?: string;
    readonly version?: string;
    readonly endpointPath?: string;
    readonly preset?: string;
    readonly authTokenEnv?: string;
    readonly trace?: boolean;
    readonly workspace?: string;
    readonly provider?: string;
    readonly model?: string;
    readonly toolAllow?: readonly string[];
    readonly baseUrl?: string;
} | {
    readonly action: 'inbound.setAuth';
    readonly id: string;
    readonly token?: string;
} | {
    readonly action: 'inbound.sendTest';
    readonly id: string;
    readonly text: string;
    readonly contextId?: string;
    readonly skill?: string;
} | {
    readonly action: 'outbound.create';
    readonly name: string;
    readonly agentCardUrl: string;
    readonly bearerTokenEnv?: string;
    readonly preset?: string;
    readonly enabled?: boolean;
    readonly timeoutMs?: number;
    readonly disabledSkills?: readonly string[];
    readonly skillOverrides?: Readonly<Record<string, {
        readonly name?: string;
        readonly description?: string;
    }>>;
} | {
    readonly action: 'outbound.remove' | 'outbound.enable' | 'outbound.disable' | 'outbound.refresh';
    readonly id: string;
} | {
    readonly action: 'outbound.setAuth';
    readonly id: string;
    readonly token?: string;
} | {
    readonly action: 'outbound.discover';
    readonly agentCardUrl: string;
    readonly token?: string;
} | {
    readonly action: 'outbound.update';
    readonly id: string;
    readonly name?: string;
    readonly preset?: string;
    readonly timeoutMs?: number;
    readonly disabledSkills?: readonly string[];
    readonly skillOverrides?: Readonly<Record<string, {
        readonly name?: string;
        readonly description?: string;
    }>>;
} | {
    readonly action: 'task.cancel';
    readonly id: string;
} | {
    readonly action: 'inbound.close';
    readonly id: string;
} | {
    readonly action: 'session.cancel' | 'session.close';
    readonly id: string;
    readonly serverId?: string;
} | {
    readonly action: 'settings.update';
    readonly baseUrl?: string;
};
/** One snapshot of the whole plugin for the dashboard. */
export interface ApiSnapshot {
    /** Installed plugin version, shown without waiting for an update check. */
    readonly version: string;
    readonly inbounds: readonly unknown[];
    readonly outbounds: readonly unknown[];
    readonly tasks: readonly unknown[];
    readonly taskTotal: number;
    readonly taskNextOffset: number | null;
    readonly peers: readonly unknown[];
    readonly sessions: readonly unknown[];
    readonly metrics: unknown;
    /** Deployment-wide settings (advertised base URL mode/override). */
    readonly settings: unknown;
}
/** Handle one dashboard API request against the service facade. */
export declare function handleApiRequest(req: IncomingMessage, res: ServerResponse, impl: A2AServiceImpl, update?: UpdateChecker): Promise<void>;
//# sourceMappingURL=api.d.ts.map