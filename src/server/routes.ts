/**
 * HTTP binding for the inbound server: registers the AgentCard route and the
 * JSON-RPC / SSE endpoint on a structural webServer (normally
 * `@deepseek-ai/dsh-host-webserver`), with runtime enable/disable.
 * @module dsh-a2a/server/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { A2AServer } from './a2a-server.ts'
import { PROTOCOL_VERSION } from '../protocol.ts'

/** Structural slice of `ctx.webServer` this module registers on. */
export interface WebServerLike {
  register(route: {
    readonly kind: 'exact' | 'prefix'
    readonly path: string
    handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>
  }): () => void
}

const DEFAULT_CARD_PATH = '/.well-known/agent-card.json'

/** Runtime-registered HTTP routes for one A2A server. */
export class A2aRoutes {
  private disposers: Array<() => void> = []
  private registered = false

  constructor(
    private readonly webServer: WebServerLike,
    private readonly server: A2AServer,
    /** AgentCard route path; default = the well-known A2A path. */
    private readonly cardPath: string = DEFAULT_CARD_PATH,
    /** Maximum accepted request body in bytes. */
    private readonly maxBodyBytes: number = 1_048_576,
  ) {}

  get active(): boolean {
    return this.registered
  }

  /** Register the AgentCard + endpoint routes (idempotent). */
  enable(): void {
    if (this.registered) return
    this.disposers.push(
      this.webServer.register({
        kind: 'exact',
        path: this.cardPath,
        handler: (req, res) => {
          // `auto` base URL mode derives the advertised origin per request, so
          // the card route must ask the server rather than reuse `.card`.
          res.writeHead(200, { 'content-type': 'application/json', 'a2a-version': PROTOCOL_VERSION })
          res.end(JSON.stringify(this.server.cardFor(toServerReq(req))))
        },
      }),
    )
    this.disposers.push(
      this.webServer.register({
        kind: 'prefix',
        path: endpointPathOf(this.server),
        handler: (req, res) => this.onRequest(req, res),
      }),
    )
    this.registered = true
  }

  /** Unregister the routes (idempotent). */
  disable(): void {
    for (const disposer of this.disposers.splice(0)) disposer()
    this.registered = false
  }

  dispose(): void {
    this.disable()
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0] ?? ''
    const streaming = (req.method === 'POST' && (req.headers.accept ?? '').includes('text/event-stream'))

    if (req.method === 'POST' && path === endpointPathOf(this.server)) {
      let body: string
      try {
        body = await readBody(req, this.maxBodyBytes)
      } catch (err) {
        const tooLarge = (err as { code?: string }).code === 'BODY_TOO_LARGE'
        res.writeHead(tooLarge ? 413 : 400, { 'content-type': 'text/plain' })
        res.end(tooLarge ? 'Payload Too Large' : 'Bad Request')
        return
      }
      if (streaming) {
        // Authorize and rate-limit BEFORE writing 200 so a 401/429 can still
        // carry a plain status. handleStream then skips its own preflight.
        const preflight = this.server.preflight(toServerReq(req))
        if (preflight !== undefined) {
          res.writeHead(preflight.status, { 'content-type': preflight.contentType, ...(preflight.headers ?? {}) })
          res.end(preflight.body)
          return
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
          'a2a-version': PROTOCOL_VERSION,
          ...this.server.responseHeaders(toServerReq(req)),
        })
        const outcome = await this.server.handleStream(toServerReq(req), body, (frame) => res.write(frame), { preflighted: true })
        if (outcome.status !== 200) {
          res.end()
          return
        }
        res.end()
        return
      }
      const out = await this.server.handle(toServerReq(req), body)
      res.writeHead(out.status, { 'content-type': out.contentType, ...(out.headers ?? {}) })
      res.end(out.body)
      return
    }

    // GET AgentCard at this instance's card path; anything else is the server's call.
    const out = await this.server.handle(toServerReq(req), path === this.cardPath ? '' : '')
    res.writeHead(out.status, { 'content-type': out.contentType, ...(out.headers ?? {}) })
    res.end(out.body)
  }
}

function endpointPathOf(server: A2AServer): string {
  const url = server.card.supportedInterfaces?.[0]?.url
  if (!url) return '/a2a'
  try {
    return new URL(url).pathname
  } catch {
    return '/a2a'
  }
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > maxBytes) {
        const error = new Error('request body too large') as Error & { code: string }
        error.code = 'BODY_TOO_LARGE'
        req.resume()
        reject(error)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.once('error', reject)
  })
}

function toServerReq(req: IncomingMessage): {
  readonly method?: string
  readonly url?: string
  readonly headers?: Record<string, string>
  readonly socket?: { readonly remoteAddress?: string; readonly remotePort?: number }
} {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers[key] = value
    else if (Array.isArray(value)) headers[key] = value.join(', ')
  }
  const method = req.method
  const url = req.url
  const socket = req.socket
  return {
    ...(method !== undefined ? { method } : {}),
    ...(url !== undefined ? { url } : {}),
    headers,
    ...(socket
      ? {
        socket: {
          ...(socket.remoteAddress !== undefined ? { remoteAddress: socket.remoteAddress } : {}),
          ...(socket.remotePort !== undefined ? { remotePort: socket.remotePort } : {}),
        },
      }
      : {}),
  }
}