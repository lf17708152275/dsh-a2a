/**
 * Outbound agent registry: the persisted list of connected remote agents,
 * their connection state, and the tool-registration disposers for each live
 * connection. Loaded at boot, mutations persist through the agent store.
 * @module dsh-a2a/client/registry
 */
import { type SkillOverride, type ToolRegistrar } from './tools.ts';
import type { A2aMetrics } from '../server/metrics.ts';
import { type OutboundAgentRecord } from '../server/store.ts';
/** User-supplied agent spec (from config or the /a2a command). */
export interface OutboundAgentSpec {
    readonly name: string;
    readonly agentCardUrl: string;
    readonly bearerTokenEnv?: string;
    readonly enabled?: boolean;
    readonly timeoutMs?: number;
    readonly disabledSkills?: readonly string[];
    readonly skillOverrides?: Readonly<Record<string, SkillOverride>>;
}
export interface OutboundSkillView {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly enabled: boolean;
}
export interface OutboundAgentView {
    readonly id: string;
    readonly name: string;
    readonly agentCardUrl: string;
    readonly enabled: boolean;
    readonly state: 'connected' | 'disconnected' | 'failed';
    readonly skillCount: number;
    readonly toolCount: number;
    readonly skills: readonly OutboundSkillView[];
    /** The remote AgentCard's advertised version (absent when unknown). */
    readonly agentVersion?: string;
    readonly lastError?: string;
}
/** Durable store for the registry records. */
export interface AgentStore {
    list(): OutboundAgentRecord[];
    save(records: readonly OutboundAgentRecord[]): Promise<void>;
}
/** In-memory agent store (tests and minimal embeddings). */
export declare class MemoryAgentStore implements AgentStore {
    private records;
    constructor(initial?: readonly OutboundAgentRecord[]);
    list(): OutboundAgentRecord[];
    save(records: readonly OutboundAgentRecord[]): Promise<void>;
}
/** Domain-backed agent store: one JSON array under the `agents` table key. */
export declare class DomainAgentStore implements AgentStore {
    private readonly table;
    private static readonly KEY;
    constructor(table: {
        get(key: string): string | undefined;
        put(key: string, value: string): Promise<void>;
    });
    list(): OutboundAgentRecord[];
    save(records: readonly OutboundAgentRecord[]): Promise<void>;
}
export interface RegistryOptions {
    readonly registrar: ToolRegistrar;
    readonly store: AgentStore;
    readonly toolPrefix?: string;
    readonly defaultTimeoutMs?: number;
    /** Resolve a bearer token from an env-var name (layered); undefined when unset. */
    readonly tokenOf: (env: string | undefined) => Promise<string | undefined> | string | undefined;
    readonly onError?: (message: string) => void;
    readonly serverId?: string;
    readonly metrics?: A2aMetrics;
}
/** A list of remote agents, each with live tool registrations when enabled. */
export declare class OutboundAgentRegistry {
    private readonly opts;
    private readonly live;
    private readonly views;
    private seedRecords;
    constructor(opts: RegistryOptions);
    /** Load persisted records and connect every enabled agent (background). */
    loadAll(): void;
    /**
     * Seed configured agents that the persisted store does not know yet. The
     * store is the runtime state: an existing record (enabled or disabled,
     * present or removed) keeps its state — a disabled agent stays
     * disconnected and a removed one is not resurrected. Only specs with a name
     * absent from the store (and not already live this boot) connect and
     * persist.
     * @param specs - declared agents from the profile config.
     */
    seed(specs: readonly OutboundAgentSpec[]): Promise<void>;
    list(): OutboundAgentView[];
    /** Add and connect an agent, persisting the record on success. */
    add(spec: OutboundAgentSpec): Promise<{
        ok: boolean;
        message: string;
    }>;
    remove(id: string): Promise<{
        ok: boolean;
        message: string;
    }>;
    setEnabled(id: string, enabled: boolean): Promise<{
        ok: boolean;
        message: string;
    }>;
    refresh(id: string): Promise<{
        ok: boolean;
        message: string;
    }>;
    disposeAll(): Promise<void>;
    private connectRecord;
    private findRecord;
    private persist;
    private persistAll;
}
//# sourceMappingURL=registry.d.ts.map