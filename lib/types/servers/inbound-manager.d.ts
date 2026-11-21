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
import type { Context } from '@deepseek-ai/cordis';
import { buildCard } from '../server/card.ts';
import { A2AServer } from '../server/a2a-server.ts';
import { A2aRoutes } from '../server/routes.ts';
import { ContextSessionPool, type AgentPresetsLike, type AgentRegistryLike, type AttachmentsLike, type CredentialsLike, type SkillsLike } from '../server/exec/agent-runtime.ts';
import { type SubagentsLike } from '../server/exec/subagent.ts';
import { ExecutorSet } from '../server/executor.ts';
import { LiveInboundRegistry } from '../server/inbound-registry.ts';
import { ContextSessionRegistry } from '../server/session-registry.ts';
import { type TaskStore, type InboundServerRecord } from '../server/store.ts';
import type { A2aMetrics } from '../server/metrics.ts';
import type { AgentSkill } from '../protocol.ts';
/** Web-server slice the manager registers instance routes on. */
export interface WebServerLike {
    register(route: {
        readonly kind: 'exact' | 'prefix';
        readonly path: string;
        handler(...args: unknown[]): unknown;
    }): () => void;
}
/** Host service slices one manager needs. */
export interface InboundManagerHost {
    readonly ctx: Context;
    readonly webServer: WebServerLike;
    readonly tasks: TaskStore;
    readonly logger: {
        info(message: string): void;
        warn(message: string): void;
        error(message: string): void;
    };
    readonly agents?: AgentRegistryLike;
    readonly agentPresets?: AgentPresetsLike;
    readonly skills?: SkillsLike;
    readonly credentials?: CredentialsLike;
    readonly subagents?: SubagentsLike;
    readonly attachments?: AttachmentsLike;
    readonly metrics?: A2aMetrics;
    readonly sessionCwd: string;
    /**
     * Advertised inbound base URL default: a concrete origin, `auto` (derived
     * per request), or a getter so a GUI setting can change it at runtime.
     */
    readonly defaultBaseUrl: string | (() => string);
    readonly subagentProvider: string;
    /** Deployment hard gate/default for the optional trace extension. */
    readonly inboundTrace: boolean;
    /** Per-task inbound execution budget (0 = disabled). */
    readonly taskTimeoutMs?: number;
    /** Sliding-window request limit per inbound source (0 = disabled). */
    readonly requestsPerMinute?: number;
    /** Maximum concurrent tasks per inbound instance (0 = disabled). */
    readonly maxConcurrentTasks?: number;
    /** HTTP body cap for inbound A2A routes. */
    readonly maxBodyBytes?: number;
    /** Deployment default preset id (from `agentPresets.defaultId`), when known. */
    readonly defaultPresetId?: string;
    /** Resolve the deployment's default model options (may be undefined). */
    readonly resolveDefaultModel?: () => {
        readonly provider?: string;
        readonly model?: string;
    } | undefined;
    /**
     * Lift the host's archive flag for a session this instance is about to drive.
     * An archived session rejects every step (the host gate ends the turn
     * `blocked`), producing a reply with no visible output — inbound traffic is
     * explicit activity, so the session is revived instead.
     */
    readonly reviveArchivedSession?: (sessionId: string) => void | Promise<void>;
    /**
     * Called once per opened session with its resolved `cwd`, best effort. The
     * plugin uses it to account the session under the host workspace that owns
     * that directory, so inbound conversations show up in the host session list.
     */
    readonly onSessionOpened?: (info: {
        readonly serverId: string;
        readonly contextId: string;
        readonly sessionId: string;
        readonly cwd: string;
    }) => void | Promise<void>;
    /** Allocate a fresh stable instance id. */
    readonly newId: () => string;
}
/** Effective per-instance working directory: record override, else deployment default. */
export declare function resolveInstanceCwd(record: Pick<InboundServerRecord, 'workspace'>, deploymentCwd: string): string;
/** One live inbound instance's runtime handle. */
export interface LiveInboundServer {
    readonly id: string;
    readonly name: string;
    readonly record: InboundServerRecord;
    /** Effective preset id (record's or the deployment default). */
    readonly preset: string | undefined;
    /** Derived skill declarations (cached at assemble time). */
    readonly skills: readonly AgentSkill[];
    readonly card: ReturnType<typeof buildCard>;
    readonly server: A2AServer;
    readonly routes: A2aRoutes;
    readonly inbound: LiveInboundRegistry;
    readonly executors: ExecutorSet;
    /** Live per-context session observation (SSE streaming per task). */
    readonly sessions: ContextSessionRegistry;
    /** Preset-bound per-context session pool; absent = no agent loop mounted. */
    readonly sessionPool?: ContextSessionPool;
    readonly endpointPath: string;
    readonly cardPath: string;
    /** Effective trace policy after the deployment gate. */
    readonly traceEnabled: boolean;
    dispose(): void;
}
/** Creator input for a new (or updated) inbound instance. */
export interface InboundCreateInput {
    readonly name: string;
    readonly description: string;
    readonly version: string;
    readonly endpointPath?: string;
    /** Preset id; absent = the deployment default preset. */
    readonly preset?: string;
    readonly authTokenEnv?: string;
    /** Allow the optional trace extension on this instance (default from config). */
    readonly trace?: boolean;
    readonly enabled?: boolean;
    /**
     * Absolute working directory for this instance's agent sessions. Absent (or
     * blank) = the deployment default. Only affects sessions created afterwards.
     */
    readonly workspace?: string;
    /** Model provider override for this instance; absent = deployment default. */
    readonly provider?: string;
    /** Model id override for this instance; absent = deployment default. */
    readonly model?: string;
    /**
     * Tool allow-list for this instance's sessions (global tool names). Absent or
     * empty = every tool the deployment mounts stays visible.
     */
    readonly toolAllow?: readonly string[];
    /**
     * Advertised base URL for this instance's agent card (e.g.
     * `https://companion.example.com`). Absent (or blank) = the deployment
     * `baseUrl` config. Only the advertised URL changes; the routes are still
     * served by the host web server.
     */
    readonly baseUrl?: string;
}
/** Validate an optional per-instance workspace override (absolute + existing dir). */
export declare function validateWorkspace(raw: string | undefined): {
    readonly ok: true;
    readonly value?: string;
} | {
    readonly ok: false;
    readonly message: string;
};
/**
 * Validate an optional per-instance advertised base URL. The value must be an
 * absolute `http(s)` URL; a trailing slash is trimmed so card URLs join paths
 * consistently. Blank = inherit the deployment base URL.
 */
export declare function validateBaseUrl(raw: string | undefined): {
    readonly ok: true;
    readonly value?: string;
} | {
    readonly ok: false;
    readonly message: string;
};
/** Per-instance advertised base URL, or the deployment default. */
export declare function resolveInstanceBaseUrl(record: Pick<InboundServerRecord, 'baseUrl'>, deploymentBaseUrl: string): string;
/** Resolve the host's base-URL source (a getter lets the GUI retune it). */
export declare function deploymentBaseUrlOf(host: Pick<InboundManagerHost, 'defaultBaseUrl'>): string;
/**
 * Derive the externally visible origin from a request (`auto` advertised base
 * URL mode): `X-Forwarded-Host`/`Host` for the authority, `X-Forwarded-Proto`
 * for the scheme. Returns undefined when the request carries no usable host.
 */
export declare function deriveBaseUrlFromRequest(req: {
    readonly headers?: Record<string, string>;
}): string | undefined;
/** Trim an optional text override; blank collapses to undefined. */
export declare function trimOptional(raw: string | undefined): string | undefined;
/** Validate an optional per-instance tool allow-list. */
export declare function validateToolAllow(raw: readonly string[] | undefined): {
    readonly ok: true;
    readonly value?: readonly string[];
} | {
    readonly ok: false;
    readonly message: string;
};
/** Per-instance tool restriction, or undefined when the instance keeps every tool. */
export declare function buildToolRestriction(record: InboundServerRecord): {
    readonly allow: readonly string[];
} | undefined;
/** Per-instance model override, or undefined when the instance inherits the default. */
export declare function buildModelOverride(record: InboundServerRecord): {
    readonly provider?: string;
    readonly model?: string;
} | undefined;
export interface OpResult {
    readonly ok: boolean;
    readonly message: string;
}
/** Built-in fallback skill when no skills service / standing mount exists. */
export declare function chatFallbackSkills(): readonly AgentSkill[];
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
export declare function derivePresetSkills(agentPresets: AgentPresetsLike | undefined, skills: SkillsLike | undefined, preset: string | undefined): Promise<readonly AgentSkill[]>;
/** The managed env-var name backing one inbound instance's auth token. */
export declare function inboundAuthEnv(id: string): string;
/**
 * Resolve one inbound instance's bearer token: the credentials service first
 * (per-call layered read; the GUI writes here), then the process environment
 * (external `export` of the same name keeps working).
 */
export declare function resolveAuthToken(credentials: CredentialsLike | undefined, envName: string | undefined): Promise<string | undefined>;
/** Persisted-instance store over the inbound_servers table. */
export declare class DomainInboundStore {
    private readonly table;
    private static KEY;
    constructor(table: {
        get(key: string): string | undefined;
        put(key: string, value: string): Promise<void>;
        entries?(): IterableIterator<[string, string]>;
        keys?(): IterableIterator<string>;
    });
    list(): InboundServerRecord[];
    get(id: string): InboundServerRecord | undefined;
    save(record: InboundServerRecord): Promise<void>;
    remove(id: string): Promise<void>;
}
/** Manages the live set of inbound server instances. */
export declare class InboundServerManager {
    private readonly host;
    private readonly store;
    private readonly live;
    constructor(host: InboundManagerHost, store: DomainInboundStore);
    /** Assemble every persisted instance (skills derived per preset). */
    boot(): Promise<void>;
    list(): readonly LiveInboundServer[];
    get(id: string): LiveInboundServer | undefined;
    /** Create, persist, and assemble a new inbound instance. */
    add(input: InboundCreateInput): Promise<OpResult & {
        readonly id?: string;
    }>;
    /** Persist, rebuild (re-deriving skills), and apply a patch onto a live instance. */
    update(id: string, patch: Partial<Pick<InboundServerRecord, 'name' | 'description' | 'version' | 'endpointPath' | 'preset' | 'authTokenEnv' | 'trace' | 'workspace' | 'provider' | 'model' | 'toolAllow' | 'baseUrl'>>): Promise<OpResult>;
    /**
     * Set (or clear) an inbound instance's bearer token. The value is written to
     * the credentials service under this instance's managed env-var name; the
     * record stores only that name and the live instance is rebuilt.
     */
    setAuth(id: string, token: string | undefined): Promise<OpResult>;
    /** Enable/disable an instance's routes. */
    setEnabled(id: string, enabled: boolean): OpResult;
    /** Remove, dispose, and unpersist an instance. */
    remove(id: string): Promise<OpResult>;
    /** Dispose every instance. */
    disposeAll(): void;
    private newId;
}
export type { AgentSkill };
//# sourceMappingURL=inbound-manager.d.ts.map