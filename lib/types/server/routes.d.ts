/**
 * HTTP binding for the inbound server: registers the AgentCard route and the
 * JSON-RPC / SSE endpoint on a structural webServer (normally
 * `@deepseek-ai/dsh-host-webserver`), with runtime enable/disable.
 * @module dsh-a2a/server/routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { A2AServer } from './a2a-server.ts';
/** Structural slice of `ctx.webServer` this module registers on. */
export interface WebServerLike {
    register(route: {
        readonly kind: 'exact' | 'prefix';
        readonly path: string;
        handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
    }): () => void;
}
/** Runtime-registered HTTP routes for one A2A server. */
export declare class A2aRoutes {
    private readonly webServer;
    private readonly server;
    /** AgentCard route path; default = the well-known A2A path. */
    private readonly cardPath;
    /** Maximum accepted request body in bytes. */
    private readonly maxBodyBytes;
    private disposers;
    private registered;
    constructor(webServer: WebServerLike, server: A2AServer, 
    /** AgentCard route path; default = the well-known A2A path. */
    cardPath?: string, 
    /** Maximum accepted request body in bytes. */
    maxBodyBytes?: number);
    get active(): boolean;
    /** Register the AgentCard + endpoint routes (idempotent). */
    enable(): void;
    /** Unregister the routes (idempotent). */
    disable(): void;
    dispose(): void;
    private onRequest;
}
//# sourceMappingURL=routes.d.ts.map