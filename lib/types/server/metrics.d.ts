/**
 * Structured observability for the A2A plugin: process-local counters plus a
 * bounded audit ring. Metrics answer "how many / how long / how many failed";
 * audit answers "who called what and what happened". Both are exposed through
 * the dashboard API and `ctx.a2a`; they are intentionally not a metrics backend
 * or a durable audit log.
 * @module dsh-a2a/server/metrics
 */
import { TaskState } from '../protocol.ts';
/** One bounded audit entry. */
export interface AuditEvent {
    readonly at: string;
    readonly kind: string;
    readonly serverId?: string;
    readonly taskId?: string;
    readonly method?: string;
    readonly source?: string;
    readonly detail?: string;
}
/** Per-instance counters. */
export interface ServerMetrics {
    requests: number;
    authFailures: number;
    tasksCreated: number;
    tasksCompleted: number;
    tasksFailed: number;
    tasksCanceled: number;
    tasksInterrupted: number;
    taskDurationMs: number;
    outboundCalls: number;
    outboundErrors: number;
    outboundDurationMs: number;
}
/** Whole-plugin metric snapshot. */
export interface MetricsSnapshot {
    readonly startedAt: string;
    readonly uptimeMs: number;
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
    readonly byServer: Readonly<Record<string, ServerMetrics>>;
    readonly audit: readonly AuditEvent[];
}
/** Process-local metrics and audit collector. */
export declare class A2aMetrics {
    private readonly startedAt;
    private readonly servers;
    private readonly auditRing;
    private readonly maxAudit;
    private totalRequests;
    private totalAuthFailures;
    private totalTasks;
    private totalCompleted;
    private totalFailed;
    private totalCanceled;
    private totalInterrupted;
    private totalTaskDuration;
    private maxTaskDuration;
    private totalOutboundCalls;
    private totalOutboundErrors;
    private totalOutboundDuration;
    constructor(maxAudit?: number);
    private server;
    recordRequest(serverId: string | undefined, method: string, source?: string): void;
    recordAuthFailure(serverId: string | undefined, method: string, source?: string): void;
    recordTaskCreated(serverId: string | undefined, taskId: string): void;
    recordTaskSettled(serverId: string | undefined, taskId: string, state: TaskState, durationMs: number): void;
    recordOutbound(serverId: string | undefined, skill: string, ok: boolean, durationMs: number, error?: string): void;
    recordAudit(event: Omit<AuditEvent, 'at'>): void;
    snapshot(): MetricsSnapshot;
}
//# sourceMappingURL=metrics.d.ts.map