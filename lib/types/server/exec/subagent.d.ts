/**
 * The `subagent` executor: one inbound task is delegated to a named one-shot
 * subagent under the context's parent session. The child runs with the
 * composition's own tools and the delegation boundary; its output becomes the
 * task's artifact. The subagent seam must be mounted, else the skill binding
 * fails loudly at resolution time.
 * @module dsh-a2a/server/exec/subagent
 */
import type { A2aExecutor } from '../executor.ts';
import { ContextSessionPool, type AgentContentBlock } from './agent-runtime.ts';
/** Structural slice of `ctx.subagents` this executor calls. */
export interface SubagentsLike {
    start(name: string, request: {
        readonly label?: string;
        readonly prompt: readonly AgentContentBlock[];
        readonly parent: unknown;
        readonly signal: AbortSignal;
    }): Promise<{
        readonly result: Promise<{
            readonly output: readonly {
                readonly type: string;
                readonly text?: string;
            }[];
        }>;
        dispose(): Promise<void>;
    }>;
}
export interface SubagentExecutorOptions {
    readonly pool: ContextSessionPool;
    readonly subagents: SubagentsLike;
    /** Provider name (e.g. 'in-process'); configurable per deployment. */
    readonly provider: string;
}
/** Build a subagent executor delegating inbound tasks to one-shot children. */
export declare function createSubagentExecutor(opts: SubagentExecutorOptions): A2aExecutor;
//# sourceMappingURL=subagent.d.ts.map