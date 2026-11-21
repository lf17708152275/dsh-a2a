/**
 * Shared agent machinery for the inbound executors: one DSH agent session per
 * A2A context (create, or resume a persisted one), serialized turns, and
 * optional agent-preset composition so a spawned session actually carries
 * tools. Adapted from the createDshAgentExecutor pattern pioneered by
 * dsh-a2a (MIT).
 * @module dsh-a2a/server/exec/agent-runtime
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Part } from '../../protocol.ts';
import { type TraceCall } from '../trace.ts';
/** The slice of a live DSH `Agent` this runtime drives (structural mirror). */
export interface LiveAgent {
    readonly session: {
        readonly id?: string;
        deriveMessages(): readonly AgentMessage[];
    };
    send(message: AgentUserMessage, target: 'next-turn', wakeup: boolean): void;
    whenIdle(): Promise<void>;
    cancel(cause: string): void;
    /**
     * Agent-scoped context. Optional so minimal test doubles stay valid; when
     * present it carries the live assistant-stream and error notifications that
     * make token streaming and failure propagation observable.
     */
    readonly ctx?: AgentContextLike;
}
/** The slice of an agent-scoped Cordis context used for live notifications. */
export interface AgentContextLike {
    on(name: string, listener: (...args: unknown[]) => void): (() => void) | void;
}
/** One derived history message. */
export interface AgentMessage {
    readonly role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
    readonly content: readonly {
        readonly type: string;
        readonly text?: string;
    }[];
}
/** One text content block handed to the agent. */
export interface AgentTextBlock {
    readonly type: 'text';
    readonly text: string;
}
/** One durable image attachment block handed to the agent. */
export interface AgentImageBlock {
    readonly type: 'image';
    readonly attachment: unknown;
}
/** One durable file attachment block handed to the agent. */
export interface AgentFileBlock {
    readonly type: 'file';
    readonly attachment: unknown;
}
/** Content block accepted by the harness user-message codec. */
export type AgentContentBlock = AgentTextBlock | AgentImageBlock | AgentFileBlock;
/** One user message handed to the agent. */
export interface AgentUserMessage {
    readonly id: string;
    readonly role: 'user';
    readonly content: readonly AgentContentBlock[];
    readonly source: {
        readonly kind: 'a2a';
    };
}
/** One text delta observed on the live assistant stream. */
export type TurnStreamEvent = {
    readonly type: 'text-delta';
    readonly text: string;
};
/** Per-turn options: live observation only; the turn's result remains the return value. */
export interface RunTurnOptions {
    readonly onEvent?: (event: TurnStreamEvent) => void;
    /** Receives redacted tool lifecycle observations when trace is activated. */
    readonly onTrace?: (call: TraceCall) => void;
}
/** Structural slice of the attachment store used to admit A2A file parts. */
export interface AttachmentsLike {
    admitPromptContent(content: readonly AttachmentAdmissionPart[]): Promise<readonly AgentContentBlock[]>;
    admitEncodedFile(input: {
        readonly data: string;
        readonly name?: string;
    }): Promise<unknown>;
}
/** One prompt part before image/file admission. */
export type AttachmentAdmissionPart = {
    readonly type: 'text';
    readonly text: string;
} | {
    readonly type: 'image';
    readonly data: string;
    readonly mediaType: string;
    readonly name?: string;
} | {
    readonly type: 'file';
    readonly attachment: unknown;
};
/** Owned agent plus its capability disposer (structural mirror of AgentHandle). */
export interface AgentHandle {
    readonly agent: LiveAgent;
    dispose(): Promise<void>;
}
/** Structural slice of `ctx.agents` this runtime calls. */
export interface AgentRegistryLike {
    create(options: {
        readonly sessionId: string;
        readonly meta?: {
            readonly cwd?: string;
            readonly agentPreset?: string;
        };
        readonly agentOptions?: {
            readonly provider?: string;
            readonly model?: string;
            readonly maxTokens?: number;
        };
        readonly setup?: (agentCtx: unknown) => void | Promise<void>;
    }): Promise<AgentHandle>;
    resume(options: {
        readonly resumeSessionId: string;
        readonly agentOptions?: {
            readonly provider?: string;
            readonly model?: string;
            readonly maxTokens?: number;
        };
        readonly setup?: (agentCtx: unknown) => void | Promise<void>;
    }): Promise<AgentHandle>;
}
/** Structural slice of `ctx.agentPresets` (preset roster). */
export interface AgentPresetsLike {
    resolve(id?: string): Promise<{
        readonly id: string;
        readonly name?: string;
    }>;
    mount(agentCtx: unknown, id: string): Promise<unknown>;
    /** Standing scope key of a preset's mount (no agent required; undefined = default preset). */
    standingKeyFor?(id?: string): Promise<unknown>;
}
/** One skill-catalogue row as `ctx.skills.list()` returns it. */
export interface SkillRowLike {
    readonly name: string;
    readonly description?: string;
    readonly whenToUse?: string;
    readonly invocation?: {
        readonly modelInvocable?: boolean;
    };
}
/** Structural slice of `ctx.skills` (the skill registry). */
export interface SkillsLike {
    list(options: {
        readonly scope?: unknown;
    }): Promise<readonly SkillRowLike[]>;
}
/** Structural slice of `ctx.credentials` (env-var-name credential refs). */
export interface CredentialsLike {
    /** Resolve one env-var name to its current value (layered, per call). */
    resolve(ref: string): Promise<{
        readonly value: string;
    } | undefined>;
    /** Store/overwrite a value for an env-var name in the managed layer. */
    set(ref: string, value: string): Promise<void>;
    /** Clear a stored value for an env-var name. */
    unset(ref: string): Promise<void>;
}
/** Structural slice of the host `ToolRestriction` (global tool names only). */
export interface ToolRestrictionLike {
    readonly allow?: readonly string[];
    readonly deny?: readonly string[];
}
/** Structural slice of the host tool registry needed to mask one agent scope. */
export interface ToolMaskLike {
    restrict?(filter: ToolRestrictionLike): unknown;
}
/**
 * Apply a tool mask to one agent scope. The host resolves `restrict` against the
 * CALLING context, so the mask must be installed on the agent's own context.
 * @param agentCtx - the context DSH hands to the create/resume `setup` hook.
 * @param restriction - the allow/deny mask to install.
 * @returns true when a tool registry accepted the mask.
 */
export declare function applyToolRestriction(agentCtx: unknown, restriction: ToolRestrictionLike): boolean;
/** Runtime options shared by the executors. */
export interface AgentRuntimeOptions {
    /** Absolute cwd frozen into each spawned session's durable header. */
    readonly cwd: string;
    /** Optional per-task model resolution (reads the deployment default). */
    readonly resolveAgentOptions?: () => {
        readonly provider?: string;
        readonly model?: string;
        readonly maxTokens?: number;
    } | undefined;
    /** Preset roster; when present every spawned session joins the default preset. */
    readonly agentPresets?: AgentPresetsLike;
    /** When set, every spawned session joins THIS preset id instead of the deployment default. */
    readonly presetId?: () => string | undefined;
    /** Attachment store used to turn A2A raw file/image parts into durable references. */
    readonly attachments?: AttachmentsLike;
    /** Stable namespace mixed into the derived session id (inbound server id). */
    readonly sessionNamespace?: string;
    /** Once-per-context hook after the first prompt lands (cosmetic naming). */
    readonly onSessionOpened?: (info: {
        readonly sessionId: string;
        readonly contextId: string;
        readonly firstPrompt: string;
    }) => void | Promise<void>;
    /**
     * Global-tool mask for each spawned agent scope. `allow` keeps only the named
     * tools visible (their schemas leave the request context), `deny` removes the
     * named ones; undefined = the deployment's full tool surface.
     */
    readonly toolRestriction?: () => ToolRestrictionLike | undefined;
    /**
     * Lift a stale archive flag before the first turn of an opened session.
     * DSH's archived-session gate rejects every proposed step, so an archived
     * session completes a turn with no assistant text at all; an inbound task is
     * explicit activity, so the host revives the session instead of failing.
     */
    readonly reviveArchivedSession?: (sessionId: string) => void | Promise<void>;
}
/** An error raised when a turn is canceled by its caller. */
export declare class AgentTurnCanceled extends Error {
    constructor();
}
/**
 * Per-context session pool: one live DSH agent per A2A contextId, created or
 * resumed through the registry, turns serialized per context, every session
 * disposeable on teardown.
 */
export declare class ContextSessionPool {
    private readonly agents;
    private readonly opts;
    private readonly handles;
    private readonly openings;
    /** Per-context promise chain: a turn waits for the previous turn to settle. */
    private readonly tails;
    constructor(agents: AgentRegistryLike, opts: AgentRuntimeOptions);
    /** Session id derived from the A2A context id and instance namespace (stable across restarts). */
    static sessionIdFor(contextId: string, namespace?: string): string;
    /** Get or open the live agent for a context; errors propagate. */
    agentFor(contextId: string): Promise<{
        readonly agent: LiveAgent;
        readonly sessionId: string;
        readonly justOpened: boolean;
    }>;
    /** Open (or resume) the live handle with a per-context single-flight guard. */
    private openHandle;
    private openHandleUncached;
    /** True while this pool holds a live handle for the context. */
    has(contextId: string): boolean;
    /** The live context's derived conversation, or an empty list when not open. */
    messages(contextId: string): readonly AgentMessage[];
    /**
     * Convert A2A parts into durable prompt content. Text and data parts become
     * text; raw image/file parts are admitted through the attachment store so the
     * DSH session receives real attachments rather than URL placeholders.
     */
    contentBlocks(parts: readonly Part[]): Promise<AgentContentBlock[]>;
    /**
     * Dispose ONE context's session (the caller aborts its active tasks first).
     * Removes the handle and its serialization tail, disposes the handle, and
     * lets a non-cooperative in-flight turn drain in the background. Returns
     * whether a handle was held.
     *
     * Close is an in-memory resource release, NOT a conversation tombstone: the
     * A2A protocol has no "closed context" notion, so the next task on the same
     * contextId simply re-opens a fresh handle through `agentFor` (and the host
     * agent runtime may or may not resume persisted history — host behavior).
     */
    disposeContext(contextId: string): Promise<boolean>;
    /**
     * Run one turn on a context's session, serialized behind the previous turn.
     * The return value is this turn's assistant text, not the agent's global last
     * assistant message; errors and cancellations are surfaced to the caller.
     */
    runTurn(contextId: string, prompt: string | readonly Part[], signal: AbortSignal, options?: RunTurnOptions): Promise<string>;
    private runTurnExclusive;
    /** Dispose every live per-context session (called on plugin unload). */
    disposeAll(): Promise<void>;
}
/**
 * Probe for a readable service method via the reflection layer WITHOUT taking
 * an inject dependency (optional services). Returns undefined when the service
 * is absent or the method missing.
 */
export declare function probeService(ctx: Context, name: string, method: string): unknown;
//# sourceMappingURL=agent-runtime.d.ts.map