/**
 * JSON-RPC 2.0 helpers and SSE framing for the A2A binding. Transport-agnostic:
 * the A2AServer consumes these, and the HTTP route layer only maps requests to
 * `handle` / `handleStream` and bytes back.
 * @module dsh-a2a/jsonrpc
 */
import { type JsonRpcError, type JsonRpcRequest, type JsonRpcSuccess } from './protocol.ts';
/** Parse a request body into a JSON-RPC request, or undefined on malformed input. */
export declare function parseRpc(body: string): JsonRpcRequest | undefined;
/** Build a JSON-RPC error response object. */
export declare function rpcError(id: string | number | null | undefined, code: number, message: string, data?: unknown): JsonRpcError;
/** Build a JSON-RPC success response object. */
export declare function rpcSuccess(id: string | number | null | undefined, result: unknown): JsonRpcSuccess;
/** Invalid-method error for the SSE path (no request id on the wire). */
export declare function methodNotFound(method: string): JsonRpcError;
/** One data frame of an SSE stream. */
export declare function sseData(payload: unknown): string;
/** One named event frame of an SSE stream (e.g. `event: error`). */
export declare function sseEvent(name: string, payload: unknown): string;
//# sourceMappingURL=jsonrpc.d.ts.map