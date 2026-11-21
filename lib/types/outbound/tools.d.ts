/**
 * Outbound half: register one remote agent's skills as model-facing tools on
 * `ctx.tools`. Tool names are `a2a__<agent>__<skill>` normalized to the DSH
 * function-name contract (≤64 chars, collision hash), mirroring the naming
 * rule of dsh-mcp-client. An agent advertising zero skills registers nothing.
 * Each tool propagates the caller's abort signal, streams the remote turn when
 * the remote supports it, and exposes an optional taskId so an interrupted
 * remote task can be continued.
 * @module dsh-a2a/outbound/tools
 */
import { type Part, type Task } from '../protocol.ts';
import { type A2AClient } from './calls.ts';
import type { A2aMetrics } from '../server/metrics.ts';
/** Structural slice of `ctx.tools` used for registration. */
export interface ToolRegistrar {
    register(definition: unknown): (() => void) | void;
}
/** Optional per-skill presentation overrides. */
export interface SkillOverride {
    readonly name?: string;
    readonly description?: string;
}
export interface AgentToolsOptions {
    readonly agentName: string;
    readonly client: A2AClient;
    /** Tool prefix; default 'a2a'. */
    readonly toolPrefix?: string;
    /**
     * Resolve the remote conversation contextId for one calling local agent
     * (stable per caller, so multi-turn tool use is one remote conversation).
     */
    readonly contextFor: (agentId: string | undefined) => string;
    /** Skill ids that must not be registered as tools. */
    readonly disabledSkills?: readonly string[];
    /** Per-skill name/description overrides. */
    readonly skillOverrides?: Readonly<Record<string, SkillOverride>>;
    /** Stable outbound instance id for metrics/audit. */
    readonly serverId?: string;
    readonly metrics?: A2aMetrics;
}
export interface RegisteredTool {
    readonly name: string;
    dispose(): void;
}
/** Register one tool per advertised skill; empty skills register nothing. */
export declare function registerAgentTools(registrar: ToolRegistrar, opts: AgentToolsOptions): RegisteredTool[];
/**
 * Select model-facing output from a remote task. The designated `result`
 * artifact wins (structured `data` parts there are a legitimate result); any
 * other artifact contributes text parts only, so tool-call or diagnostic data
 * can never be spliced into the local tool result.
 */
export declare function taskOutputText(task: Task): string;
export type { Part };
//# sourceMappingURL=tools.d.ts.map