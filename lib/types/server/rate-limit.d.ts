/**
 * Small in-memory rate limiter for one inbound A2A instance. Sliding-window
 * counters keyed by request source (or a stable fallback) keep a public
 * endpoint from being flooded and are intentionally process-local: this plugin
 * has no distributed quota store.
 * @module dsh-a2a/server/rate-limit
 */
export interface RateLimitDecision {
    readonly ok: boolean;
    /** Milliseconds until the caller may retry; zero when allowed. */
    readonly retryAfterMs: number;
}
/** Sliding-window request limiter. */
export declare class SlidingWindowLimiter {
    private readonly limit;
    private readonly windowMs;
    private readonly hits;
    constructor(limit: number, windowMs: number);
    allow(key: string, now?: number): RateLimitDecision;
}
//# sourceMappingURL=rate-limit.d.ts.map