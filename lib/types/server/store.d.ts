/**
 * Durable task storage for the inbound half: one `a2a` domain over the routed
 * storage backend (the deployment picks the medium, normally SQLite). Records
 * are serialized JSON so the domain tables stay plain kv rows; the domain
 * SCHEMA_VERSION guards format evolution. A memory store keeps unit tests and
 * minimal embeddings free of a backend.
 * @module dsh-a2a/server/store
 */
import { type Domain, type DomainFacility, type KvTable } from '@deepseek-ai/dsh-storage-domain';
import { TaskState, type Message, type Part } from '../protocol.ts';
import { type TraceCall, type TraceSummary } from './trace.ts';
/** One durable inbound/outbound task record. */
export interface TaskRecord {
    readonly taskId: string;
    readonly contextId: string;
    readonly skill: string;
    readonly state: TaskState;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly sessionId: string | null;
    readonly remotePeerId: string | null;
    readonly parts: readonly Part[];
    readonly artifacts: readonly {
        readonly artifactId: string;
        readonly name?: string;
        readonly parts: readonly Part[];
    }[];
    readonly executor: 'session' | 'subagent';
    readonly summary: string | null;
    readonly error?: {
        readonly code: string;
        readonly message: string;
    };
    /** The inbound server instance this task arrived through. */
    readonly serverId?: string;
    /** Client message ids already accepted by this task (idempotency key). */
    readonly messageIds?: readonly string[];
    /** A2A-visible input messages in acceptance order (task-level history). */
    readonly inputs?: readonly Message[];
    /** Non-error status text, e.g. "completed without visible output". */
    readonly statusText?: string;
    /** Opt-in trace summary; absent when the extension was never activated. */
    readonly trace?: TraceSummary;
}
/** One durable context→session binding (inbound conversation ↔ DSH session). */
export interface ContextBinding {
    readonly sessionId: string;
}
/** One durable outbound agent record (client registry persistence). */
export interface OutboundAgentRecord {
    readonly id: string;
    readonly name: string;
    readonly agentCardUrl: string;
    readonly bearerTokenEnv?: string;
    readonly enabled: boolean;
    readonly timeoutMs: number;
    readonly lastCardAt: string | null;
    readonly disabledSkills?: readonly string[];
    readonly skillOverrides?: Readonly<Record<string, {
        readonly name?: string;
        readonly description?: string;
    }>>;
}
/** One durable inbound server instance. */
export interface InboundServerRecord {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly version: string;
    readonly endpointPath: string;
    /** Agent preset id composing inbound sessions; absent falls back to the deployment default. */
    readonly preset?: string;
    readonly authTokenEnv?: string;
    readonly enabled: boolean;
    /** Instance policy for the optional trace extension (global config is a hard gate). */
    readonly trace?: boolean;
    /**
     * Per-instance working directory for inbound agent sessions. Absent = the
     * deployment default (`<DSH_HOME>/a2a-sessions`). Applied when a session is
     * created, so changing it never rewrites the cwd of already-open contexts.
     */
    readonly workspace?: string;
    /** Per-instance model provider override; absent = the deployment default. */
    readonly provider?: string;
    /** Per-instance model id override; absent = the deployment default. */
    readonly model?: string;
    /**
     * Per-instance tool allow-list (global tool names). Present = the instance's
     * agent sessions see only these tools, which keeps chat presets from paying
     * for developer tool schemas in every request. Absent = no restriction.
     * Applied when a session is created; already-open contexts keep their mask.
     */
    readonly toolAllow?: readonly string[];
    /**
     * Per-instance advertised base URL written into the agent card (scheme, host
     * and optional port, never a path). Absent = the deployment `baseUrl` config.
     * Use it when a deployment (or one front door of it) must be reachable from a
     * different address than the loopback the server binds.
     */
    readonly baseUrl?: string;
}
/** One durable outbound server connection instance. */
export interface OutboundServerRecord {
    readonly id: string;
    readonly name: string;
    readonly agentCardUrl: string;
    readonly bearerTokenEnv?: string;
    /** Preset composing this DSH's local session when talking to the remote. */
    readonly preset?: string;
    readonly enabled: boolean;
    readonly timeoutMs: number;
    /** Skill ids excluded from model-tool registration. */
    readonly disabledSkills?: readonly string[];
    /** Per-skill name/description presentation overrides. */
    readonly skillOverrides?: Readonly<Record<string, {
        readonly name?: string;
        readonly description?: string;
    }>>;
    /** Last successful AgentCard read. */
    readonly lastCardAt?: string;
}
/** The `a2a` storage domain: JSON-encoded records, one table per record kind. */
export declare const a2aDomainSpec: {
    name: string;
    version: number;
    tables: {
        tasks: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, string>;
        contexts: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, string>;
        agents: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, string>;
        identity: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, string>;
        inbound_servers: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, string>;
        outbound_servers: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, string>;
    };
};
export type A2aDomainSpec = typeof a2aDomainSpec;
/**
 * Serialize/deserialize helpers for the domain tables. Plain JSON round-trip
 * with shape assertions; `decodeRecord` returns undefined on any mismatch.
 */
export declare function encodeRecord(value: unknown): string;
export declare function decodeRecord<T>(raw: string): T | undefined;
/**
 * Open the `a2a` domain on the mounted storage-domain facility and expose
 * its tables. The caller owns the returned handle and closes it on teardown.
 */
export declare function openDomain(domain: DomainFacility): Promise<A2aDomain>;
/** A2a domain facade: typed JSON tables over the routed backend. */
export declare class A2aDomain {
    readonly handle: Domain<A2aDomainSpec>;
    constructor(handle: Domain<A2aDomainSpec>);
    get tasks(): KvTable<string, string>;
    get contexts(): KvTable<string, string>;
    get agents(): KvTable<string, string>;
    get identity(): KvTable<string, string>;
    get inbound_servers(): KvTable<string, string>;
    get outbound_servers(): KvTable<string, string>;
    close(): Promise<void>;
}
/** Task-store contract shared by the domain-backed and memory stores. */
export interface TaskStore {
    create(input: {
        contextId: string;
        skill: string;
        parts: readonly Part[];
        remotePeerId: string | null;
        serverId?: string;
        messageId?: string;
        message?: Message;
    }): TaskRecord;
    get(taskId: string): TaskRecord | undefined;
    list(): TaskRecord[];
    setState(taskId: string, state: TaskState, message?: {
        code: string;
        text: string;
    }): TaskRecord;
    appendArtifact(taskId: string, artifact: {
        artifactId: string;
        name?: string;
        parts: readonly Part[];
        append?: boolean;
        lastChunk?: boolean;
    }): TaskRecord;
    /** Replace the task's current input parts (a continuation message). */
    setParts(taskId: string, parts: readonly Part[]): TaskRecord;
    /** Append one accepted A2A-visible input message (task history). */
    appendInput(taskId: string, message: Message): TaskRecord;
    /** Remember one accepted client message id for idempotent retries. */
    appendMessageId(taskId: string, messageId: string): TaskRecord;
    /** Set or clear the non-error status text shown in `status.message`. */
    setStatusText(taskId: string, text: string | undefined): TaskRecord;
    /** Append one bounded trace observation. */
    appendTrace(taskId: string, call: TraceCall): TaskRecord;
    setContextSession(contextId: string, sessionId: string): Promise<void>;
    getContextSession(contextId: string): Promise<string | undefined>;
    close(): Promise<void>;
}
/** In-memory TaskStore (unit tests, minimal embeddings). */
export declare class MemoryTaskStore implements TaskStore {
    private tasks;
    private contexts;
    create(input: {
        contextId: string;
        skill: string;
        parts: readonly Part[];
        remotePeerId: string | null;
        serverId?: string;
        messageId?: string;
        message?: Message;
    }): TaskRecord;
    get(taskId: string): TaskRecord | undefined;
    list(): TaskRecord[];
    setState(taskId: string, state: TaskState, message?: {
        code: string;
        text: string;
    }): TaskRecord;
    appendArtifact(taskId: string, artifact: {
        artifactId: string;
        name?: string;
        parts: readonly Part[];
        append?: boolean;
        lastChunk?: boolean;
    }): TaskRecord;
    setContextSession(contextId: string, sessionId: string): Promise<void>;
    getContextSession(contextId: string): Promise<string | undefined>;
    close(): Promise<void>;
    setParts(taskId: string, parts: readonly Part[]): TaskRecord;
    appendMessageId(taskId: string, messageId: string): TaskRecord;
    appendInput(taskId: string, message: Message): TaskRecord;
    setStatusText(taskId: string, text: string | undefined): TaskRecord;
    appendTrace(taskId: string, call: TraceCall): TaskRecord;
}
/** Domain-backed TaskStore (persistent; the composition path). */
export declare class DomainTaskStore implements TaskStore {
    private readonly domain;
    private readonly records;
    private readonly bindings;
    constructor(domain: A2aDomain);
    create(input: {
        contextId: string;
        skill: string;
        parts: readonly Part[];
        remotePeerId: string | null;
        serverId?: string;
        messageId?: string;
        message?: Message;
    }): TaskRecord;
    get(taskId: string): TaskRecord | undefined;
    list(): TaskRecord[];
    setState(taskId: string, state: TaskState, message?: {
        code: string;
        text: string;
    }): TaskRecord;
    appendArtifact(taskId: string, artifact: {
        artifactId: string;
        name?: string;
        parts: readonly Part[];
        append?: boolean;
        lastChunk?: boolean;
    }): TaskRecord;
    setContextSession(contextId: string, sessionId: string): Promise<void>;
    getContextSession(contextId: string): Promise<string | undefined>;
    close(): Promise<void>;
    setParts(taskId: string, parts: readonly Part[]): TaskRecord;
    appendMessageId(taskId: string, messageId: string): TaskRecord;
    appendInput(taskId: string, message: Message): TaskRecord;
    setStatusText(taskId: string, text: string | undefined): TaskRecord;
    appendTrace(taskId: string, call: TraceCall): TaskRecord;
}
/**
 * One inbound instance's view of the shared task store. Every access is
 * filtered by the instance's `serverId`; a task belonging to another instance is
 * indistinguishable from a missing task (the A2A spec requires task-not-found,
 * not a permission leak). Context bindings are namespaced too, so two instances
 * can reuse the same client-chosen contextId without sharing a DSH session.
 */
export declare class ScopedTaskStore implements TaskStore {
    private readonly base;
    readonly serverId: string;
    constructor(base: TaskStore, serverId: string);
    create(input: {
        contextId: string;
        skill: string;
        parts: readonly Part[];
        remotePeerId: string | null;
        serverId?: string;
        messageId?: string;
        message?: Message;
    }): TaskRecord;
    get(taskId: string): TaskRecord | undefined;
    list(): TaskRecord[];
    setState(taskId: string, state: TaskState, message?: {
        code: string;
        text: string;
    }): TaskRecord;
    appendArtifact(taskId: string, artifact: {
        artifactId: string;
        name?: string;
        parts: readonly Part[];
        append?: boolean;
        lastChunk?: boolean;
    }): TaskRecord;
    setParts(taskId: string, parts: readonly Part[]): TaskRecord;
    appendMessageId(taskId: string, messageId: string): TaskRecord;
    appendInput(taskId: string, message: Message): TaskRecord;
    setStatusText(taskId: string, text: string | undefined): TaskRecord;
    appendTrace(taskId: string, call: TraceCall): TaskRecord;
    setContextSession(contextId: string, sessionId: string): Promise<void>;
    getContextSession(contextId: string): Promise<string | undefined>;
    close(): Promise<void>;
    private scopedContextId;
    private require;
}
//# sourceMappingURL=store.d.ts.map