/**
 * Outbound server manager: owns every outbound A2A connection instance. Each
 * instance is one connected remote — its own AgentCard URL, auth env, timeout,
 * creator-declared name, and an optional agent-preset binding. Each live
 * instance is one `OutboundAgentRegistry` with an isolated per-instance agent
 * store; enabled instances map their remote skills to `a2a__<name>__<skill>`
 * model tools. The manager owns the full lifecycle (add/enable/disable/remove/
 * refresh) driven from the GUI and facade, persists each instance in the
 * `outbound_servers` domain table, and disposes every connection on teardown.
 *
 * The `preset` field names the agent preset this DSH would compose its local
 * hand-off session with when driving that remote. P0 connects skills to tools
 * and manages the connection; the hand-off session composition behind `preset`
 * is a documented extension point (the outbound tools currently call the
 * remote directly) and the value is persisted metadata surfaced to the GUI.
 * @module dsh-a2a/servers/outbound-manager
 */
import { OutboundAgentRegistry, type AgentStore, type OutboundSkillView } from '../outbound/registry.ts';
import type { CredentialsLike } from '../server/exec/agent-runtime.ts';
import type { OutboundAgentRecord, OutboundServerRecord } from '../server/store.ts';
import type { SkillOverride } from '../outbound/tools.ts';
import type { A2aMetrics } from '../server/metrics.ts';
/** Tool-registrar slice (structural `ctx.tools.register`). */
export interface ToolRegistrar {
    register(def: unknown): (() => void) | void;
}
/** Host slices one manager needs. */
export interface OutboundManagerHost {
    readonly registrar: ToolRegistrar;
    /** Resolve a bearer token from an env-var name (layered); may be async. */
    readonly tokenOf: (env: string | undefined) => Promise<string | undefined> | string | undefined;
    readonly credentials?: CredentialsLike;
    readonly onError: (message: string) => void;
    readonly defaultTimeoutMs: number;
    /** Automatic AgentCard refresh interval (ms); 0 disables it. */
    readonly refreshIntervalMs?: number;
    readonly metrics?: A2aMetrics;
}
export interface OpResult {
    readonly ok: boolean;
    readonly message: string;
}
/** One outbound instance as the GUI/facade reads it. */
export interface OutboundServerView {
    readonly id: string;
    readonly name: string;
    readonly agentCardUrl: string;
    readonly preset?: string;
    readonly enabled: boolean;
    readonly timeoutMs: number;
    readonly state: 'connected' | 'disconnected' | 'failed';
    readonly skillCount: number;
    readonly toolCount: number;
    readonly skills: readonly OutboundSkillView[];
    /** The remote AgentCard's advertised version (absent when unknown). */
    readonly agentVersion?: string;
    readonly lastError?: string;
    readonly lastCardAt?: string;
}
/** An `AgentStore` bound to one outbound server instance's agents-table key. */
export declare class ServerAgentStore implements AgentStore {
    private readonly table;
    private readonly key;
    constructor(table: {
        get(key: string): string | undefined;
        put(key: string, value: string): Promise<void>;
    }, key: string);
    list(): OutboundAgentRecord[];
    save(records: readonly OutboundAgentRecord[]): Promise<void>;
}
/** Persisted-instance store over the outbound_servers table. */
export declare class DomainOutboundStore {
    private readonly table;
    private static KEY;
    constructor(table: {
        get(key: string): string | undefined;
        put(key: string, value: string): Promise<void>;
        entries?(): IterableIterator<[string, string]>;
    });
    list(): OutboundServerRecord[];
    get(id: string): OutboundServerRecord | undefined;
    save(record: OutboundServerRecord): Promise<void>;
    remove(id: string): Promise<void>;
}
/** Creator input for a new outbound instance (id optional; manager allocates). */
export interface OutboundCreateInput {
    readonly id?: string;
    readonly name: string;
    readonly agentCardUrl: string;
    readonly bearerTokenEnv?: string;
    readonly preset?: string;
    readonly enabled?: boolean;
    readonly timeoutMs?: number;
    readonly disabledSkills?: readonly string[];
    readonly skillOverrides?: Readonly<Record<string, SkillOverride>>;
}
/** Discovered remote card preview (two-phase add). */
export interface OutboundDiscoverPreview {
    readonly name: string;
    readonly version?: string;
    readonly description?: string;
    readonly endpoint: string;
    readonly skills: readonly {
        readonly id: string;
        readonly name: string;
        readonly description?: string;
    }[];
}
/** The managed env-var name backing one outbound instance's auth token. */
export declare function outboundAuthEnv(id: string): string;
/** Manages the live set of outbound connection instances. */
export declare class OutboundServerManager {
    private readonly host;
    /** Persistence sink for each instance's agent records (the `agents` table). */
    private readonly agentSink;
    /** Persisted OutboundServerRecord store (the `outbound_servers` table). */
    private readonly records;
    /** Allocate a fresh stable instance id. */
    private readonly newId;
    private readonly registries;
    private readonly timers;
    constructor(host: OutboundManagerHost, 
    /** Persistence sink for each instance's agent records (the `agents` table). */
    agentSink: {
        get(key: string): string | undefined;
        put(key: string, value: string): Promise<void>;
    }, 
    /** Persisted OutboundServerRecord store (the `outbound_servers` table). */
    records: DomainOutboundStore, 
    /** Allocate a fresh stable instance id. */
    newId: () => string);
    /** The host default connection timeout (what a minimal record falls back to). */
    get defaultTimeoutMs(): number;
    private agentKeyFor;
    private makeRegistry;
    /** Record → registry spec for connecting one instance. */
    private toSpec;
    /** Boot every persisted enabled instance as a connected registry. */
    boot(): void;
    /** One view per live instance (enriched from its registry / record). */
    list(): readonly OutboundServerView[];
    get(id: string): OutboundServerRegistryHandle | undefined;
    private viewFor;
    /** Create, persist, and connect a new outbound instance. */
    add(input: OutboundCreateInput): Promise<OpResult & {
        readonly id?: string;
    }>;
    setEnabled(id: string, enabled: boolean): Promise<OpResult>;
    /** Read a remote AgentCard for the two-phase add preview (no state change). */
    discover(agentCardUrl: string, bearerToken?: string): Promise<OpResult & {
        readonly preview?: OutboundDiscoverPreview;
    }>;
    /** Edit a live instance's name/preset/timeout (persist + rebuild if connected). */
    update(id: string, patch: {
        readonly name?: string;
        readonly preset?: string;
        readonly timeoutMs?: number;
        readonly disabledSkills?: readonly string[];
        readonly skillOverrides?: Readonly<Record<string, SkillOverride>>;
    }): Promise<OpResult>;
    remove(id: string): Promise<OpResult>;
    refresh(id: string): Promise<OpResult>;
    /**
     * Set (or clear) an outbound instance's bearer token: written to the
     * credentials service under this instance's managed env-var name, the record
     * stores only that name, and the connection is rebuilt so the new token
     * takes effect.
     */
    setAuth(id: string, token: string | undefined): Promise<OpResult>;
    /** Start/refresh the automatic card-refresh timer for one instance. */
    private schedule;
    private clearTimer;
    disposeAll(): Promise<void>;
}
/** Handle to one live outbound connection (registry + derived view). */
export interface OutboundServerRegistryHandle {
    readonly id: string;
    readonly registry: OutboundAgentRegistry;
}
//# sourceMappingURL=outbound-manager.d.ts.map