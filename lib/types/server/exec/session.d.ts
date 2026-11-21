/**
 * The `session` executor: one inbound task is one turn on the context's DSH
 * agent session; reply text becomes the task's output part. Live assistant
 * text deltas are projected as `result` artifact chunks so
 * SendStreamingMessage carries real progress before the terminal task. Tool
 * lifecycle is exposed only through the opt-in trace metadata channel; it is
 * never modelled as an artifact.
 * @module dsh-a2a/server/exec/session
 */
import type { A2aExecutor } from '../executor.ts';
import { ContextSessionPool } from './agent-runtime.ts';
/** Build the session executor over a context session pool. */
export declare function createSessionExecutor(pool: ContextSessionPool): A2aExecutor;
//# sourceMappingURL=session.d.ts.map