/**
 * A2A settings dashboard — browser half.
 *
 * Registers one `settings.section` ("A2A 连接") managing the multi-instance
 * A2A composition across three tabs: inbound server instances (create/edit,
 * each with its own agent preset — skills derive automatically — and an
 * optional bearer token), outbound server connections (two-phase
 * discover→connect, auth, preset, timeout), and connection/session/task
 * activity (per-context session monitoring with cancel/close).
 *
 * Styling lives in dashboard.css.ts, built entirely on the product's
 * `--dsw-alias-*` design tokens with `@container` responsiveness. All data and
 * controls sit behind the host's loopback-only `/a2a/api` route; this half is
 * a thin read/write client with no protocol knowledge.
 * @module dsh-a2a/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type ReactElement } from 'react';
import { type TaskRecordView } from './task-row.ts';
/** Services this plugin needs from the client runtime. */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
/** Wire types — mirror the host's src/api.ts + src/service.ts views. */
export interface SkillView {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
}
export interface InboundServerView {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly version: string;
    readonly endpointPath: string;
    readonly preset?: string;
    readonly presetOverride?: string;
    readonly authTokenEnv?: string;
    readonly cardPath: string;
    readonly cardUrl?: string;
    readonly enabled: boolean;
    readonly trace: boolean;
    readonly workspace?: string;
    readonly provider?: string;
    readonly model?: string;
    readonly toolAllow?: readonly string[];
    readonly baseUrl?: string;
    readonly skills: readonly SkillView[];
}
export interface OutboundSkillView {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly enabled: boolean;
}
export interface OutboundServerView {
    readonly id: string;
    readonly name: string;
    readonly agentCardUrl: string;
    readonly preset?: string;
    readonly enabled: boolean;
    readonly timeoutMs: number;
    readonly state: string;
    readonly skillCount: number;
    readonly toolCount: number;
    readonly skills: readonly OutboundSkillView[];
    /** The remote AgentCard's advertised version (absent when unknown). */
    readonly agentVersion?: string;
    readonly lastError?: string;
    readonly lastCardAt?: string;
}
/** One plugin row of the preset an inbound session will mount. */
export interface PresetPluginView {
    readonly entryId: string | null;
    readonly module: string;
    readonly enabled: boolean | 'conditional';
    readonly condition?: string;
    /** Display name of the module (falls back to its short name). */
    readonly label?: string;
    /** One-line explanation of what the plugin does. */
    readonly hint?: string;
}
export interface PresetView {
    readonly id: string;
    readonly name?: string;
    readonly description?: string;
    /** Whether this preset is the deployment default when none is named. */
    readonly isDefault?: boolean;
    /** The host could not compose this preset. */
    readonly broken?: boolean;
    /** Plugins a session started from this preset carries, in declaration order. */
    readonly plugins?: readonly PresetPluginView[];
}
export interface ApiSnapshot {
    /** Installed plugin version (also present when the update check has not run). */
    readonly version: string;
    readonly inbounds: readonly InboundServerView[];
    readonly outbounds: readonly OutboundServerView[];
    readonly tasks: readonly TaskRecordView[];
    readonly taskTotal: number;
    readonly taskNextOffset: number | null;
    readonly peers: readonly InboundPeerView[];
    readonly sessions: readonly SessionView[];
    readonly metrics: MetricsSnapshot;
    /** Deployment-wide settings (advertised base URL mode/override). */
    readonly settings?: DeploymentSettingsView;
}
/** Advertised base URL mode as the dashboard sees it. */
export interface DeploymentSettingsView {
    readonly mode: 'inherit' | 'auto' | 'custom';
    readonly baseUrl?: string;
    readonly effectiveBaseUrl: string;
    readonly configBaseUrl?: string;
    /** Origins discovered on the host; the pick list offers them as-is. */
    readonly candidates?: ReadonlyArray<{
        readonly value: string;
        readonly label: string;
    }>;
}
export interface MetricsSnapshot {
    readonly requests: number;
    readonly authFailures: number;
    readonly tasks: {
        readonly created: number;
        readonly completed: number;
        readonly failed: number;
        readonly canceled: number;
        readonly interrupted: number;
        readonly avgDurationMs: number;
        readonly maxDurationMs: number;
    };
    readonly outbound: {
        readonly calls: number;
        readonly errors: number;
        readonly avgDurationMs: number;
    };
    readonly audit: readonly AuditEvent[];
}
export interface AuditEvent {
    readonly at: string;
    readonly kind: string;
    readonly serverId?: string;
    readonly taskId?: string;
    readonly method?: string;
    readonly source?: string;
    readonly detail?: string;
}
/** The host's update-check answer is exported by `./update-status.ts`. */
export type { UpdateInfo } from './update-status.ts';
interface InboundPeerView {
    readonly id: string;
    readonly label: string;
    readonly source?: string | null;
    readonly firstSeen?: string;
    readonly lastSeen?: string;
    readonly taskCount: number;
    readonly activeTaskIds: readonly string[];
    readonly streaming: boolean;
}
/** One aggregated inbound session row (mirrors the host SessionView). */
interface SessionView {
    readonly contextId: string;
    readonly sessionId: string;
    readonly serverId?: string;
    readonly serverName?: string;
    readonly preset?: string;
    readonly status: string;
    readonly taskCount: number;
    readonly activeCount: number;
    readonly firstSeen: string;
    readonly lastSeen: string;
    readonly streaming: boolean;
    readonly live: boolean;
}
export interface ToolOption {
    readonly name: string;
    readonly description?: string;
}
/** How many plugins a session started from this preset mounts. */
export declare function mountedPluginCount(preset: PresetView | undefined): number;
/** Human label for one plugin row. */
export declare function pluginLabel(plugin: PresetPluginView): string;
/** Hover text for one plugin chip: friendly hint, module, condition. */
export declare function pluginTitle(plugin: PresetPluginView): string;
type SectionProps = PropsRuntime<'settings.section'>;
export declare function A2aSection(_props: SectionProps): ReactElement;
//# sourceMappingURL=index.d.ts.map