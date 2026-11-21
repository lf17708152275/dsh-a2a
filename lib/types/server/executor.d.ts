/**
 * Executor abstraction for inbound tasks: an executor turns one task into
 * output parts while reporting status and artifact updates. The registry is
 * INTERNAL (built by the plugin from config) — public registration was cut:
 * there is no external caller yet, so the seam stays an interface with two
 * built-in implementations (session, subagent).
 * @module dsh-a2a/server/executor
 */
import type { Part, TaskState } from '../protocol.ts';
import type { TraceCall } from './trace.ts';
/** One update from a running executor. */
export type A2aExecutorEvent = {
    readonly type: 'status';
    readonly state: TaskState;
    readonly message?: string;
} | {
    readonly type: 'artifact';
    readonly artifactId: string;
    readonly parts: readonly Part[];
    readonly name?: string;
    readonly append?: boolean;
    readonly lastChunk?: boolean;
} | {
    readonly type: 'trace';
    readonly call: TraceCall;
};
/** Input a task executor receives. */
export interface A2aExecutorInput {
    readonly taskId: string;
    readonly contextId: string;
    readonly skill: string;
    readonly parts: readonly Part[];
    readonly prompt: string;
    readonly signal: AbortSignal;
    /** True when this request activated the optional trace extension. */
    readonly trace?: boolean;
}
/** Output contract of one executor run. */
export interface A2aExecutorOutput {
    readonly parts: readonly Part[];
    /** false when the executor already streamed/wrote its result artifact. */
    readonly appendResult?: boolean;
    /** Leave the task interrupted instead of completing it (INPUT_REQUIRED/AUTH_REQUIRED). */
    readonly state?: TaskState.INPUT_REQUIRED | TaskState.AUTH_REQUIRED;
    /** Status text for an interrupted or completed-without-output task. */
    readonly statusMessage?: string;
}
/** One inbound task executor. */
export interface A2aExecutor {
    /** Stable kind name ('session' | 'subagent'). */
    readonly name: string;
    /**
     * Run one task. The executor reports progress through `opts.onEvent` and
     * must honor `opts.signal` (cancel = abort remaining work).
     */
    execute(input: A2aExecutorInput, opts: {
        readonly onEvent: (ev: A2aExecutorEvent) => void;
    }): Promise<A2aExecutorOutput>;
    /** Dispose resources owned by the executor (sessions, children). */
    disposeAll?(): Promise<void>;
}
/** Executor kind names configurable per skill. */
export type ExecutorKind = 'session' | 'subagent';
/**
 * Skill → executor resolution. The subagent executor is absent on
 * compositions without the subagent seam; resolving a skill bound to a
 * missing kind fails loudly with a readable message.
 */
export declare class ExecutorSet {
    private readonly bySkill;
    private readonly session;
    private readonly subagent;
    constructor(bySkill: Readonly<Record<string, ExecutorKind>>, session: A2aExecutor, subagent: A2aExecutor | undefined);
    resolve(skill: string): A2aExecutor;
    disposeAll(): Promise<void>;
}
//# sourceMappingURL=executor.d.ts.map