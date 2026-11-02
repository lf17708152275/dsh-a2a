/**
 * ContextSessionPool unit tests: live-handle existence, per-context dispose
 * (the "close session" primitive), and the once-per-open callback the plugin
 * uses to persist the contextId → sessionId binding.
 * @module dsh-a2a/tests/unit/agent-runtime.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { ContextSessionPool, type AgentRegistryLike, type LiveAgent } from '../../src/server/exec/agent-runtime.ts'

/** One captured inbound message handed to a fake agent. */
interface SentMessage {
  readonly source: { readonly kind: string }
}

/** Minimal fake registry whose handles record create counts and dispose calls. */
function fakeAgents() {
  const created = new Map<string, number>()
  const disposed: string[] = []
  const sent: SentMessage[] = []
  const create = vi.fn(async (opts: { readonly sessionId: string }) => {
    created.set(opts.sessionId, (created.get(opts.sessionId) ?? 0) + 1)
    const agent: LiveAgent = {
      session: { deriveMessages: () => [] },
      send: vi.fn((message: SentMessage) => { sent.push(message) }),
      whenIdle: vi.fn(async () => {}),
      cancel: vi.fn(),
    }
    return {
      agent,
      dispose: vi.fn(async () => {
        disposed.push(opts.sessionId)
      }),
    }
  })
  return { create, created, disposed, sent }
}

function poolWith(opts: { onSessionOpened?: (info: { readonly sessionId: string; readonly contextId: string; readonly firstPrompt: string }) => void | Promise<void> } = {}) {
  const agents = fakeAgents()
  const pool = new ContextSessionPool(agents as unknown as AgentRegistryLike, {
    cwd: '/tmp',
    ...(opts.onSessionOpened !== undefined ? { onSessionOpened: opts.onSessionOpened } : {}),
  })
  return { agents, pool }
}

describe('ContextSessionPool session lifecycle', () => {
  it('has() tracks a live handle and disposeContext releases it', async () => {
    const { agents, pool } = poolWith()
    expect(pool.has('ctx-1')).toBe(false)
    await pool.agentFor('ctx-1')
    expect(pool.has('ctx-1')).toBe(true)
    expect(await pool.disposeContext('ctx-1')).toBe(true)
    expect(pool.has('ctx-1')).toBe(false)
    expect(agents.disposed).toEqual(['a2a-ctx-1'])
  })

  it('disposeContext is a no-op for an unknown context', async () => {
    const { pool } = poolWith()
    expect(await pool.disposeContext('ctx-missing')).toBe(false)
    expect(pool.has('ctx-missing')).toBe(false)
  })

  it('re-opens a NEW handle for the same context after close (never refused)', async () => {
    const { agents, pool } = poolWith()
    await pool.agentFor('ctx-1')
    await pool.disposeContext('ctx-1')
    await pool.agentFor('ctx-1')
    // One create per open: close is a resource release, not a tombstone.
    expect(agents.created.get('a2a-ctx-1')).toBe(2)
  })

  it('sends inbound turns with a producer-owned source kind (not the retired plugin wrapper)', async () => {
    const { agents, pool } = poolWith()
    await pool.runTurn('ctx-1', 'hello', new AbortController().signal)
    expect(agents.sent).toHaveLength(1)
    expect(agents.sent[0]?.source.kind).toBe('a2a')
  })

  it('fires onSessionOpened exactly once per freshly opened context (binding hook)', async () => {
    const opened: Array<{ sessionId: string; contextId: string; firstPrompt: string }> = []
    const { pool } = poolWith({ onSessionOpened: (info) => { opened.push(info) } })
    // First turn opens the session ⇒ fires once.
    await pool.runTurn('ctx-1', 'hello', new AbortController().signal)
    // Second turn reuses the live handle ⇒ no callback.
    await pool.runTurn('ctx-1', 'hello-again', new AbortController().signal)
    expect(opened).toEqual([
      { sessionId: 'a2a-ctx-1', contextId: 'ctx-1', firstPrompt: 'hello' },
    ])
    // Reopened after close fires the hook again; same derived session id.
    await pool.disposeContext('ctx-1')
    await pool.runTurn('ctx-1', 'after-close', new AbortController().signal)
    expect(opened).toEqual([
      { sessionId: 'a2a-ctx-1', contextId: 'ctx-1', firstPrompt: 'hello' },
      { sessionId: 'a2a-ctx-1', contextId: 'ctx-1', firstPrompt: 'after-close' },
    ])
  })

  it('revives the session once per open before its first turn', async () => {
    const revived: string[] = []
    const agents = fakeAgents()
    const pool = new ContextSessionPool(agents as unknown as AgentRegistryLike, {
      cwd: '/tmp',
      reviveArchivedSession: (sessionId) => { revived.push(sessionId) },
    })
    await pool.runTurn('ctx-arch', 'hello', new AbortController().signal)
    // A live handle is not re-opened, so the revival happens exactly once.
    await pool.runTurn('ctx-arch', 'again', new AbortController().signal)
    expect(revived).toEqual(['a2a-ctx-arch'])
  })

  it('a failing revival never fails the turn', async () => {
    const agents = fakeAgents()
    const pool = new ContextSessionPool(agents as unknown as AgentRegistryLike, {
      cwd: '/tmp',
      reviveArchivedSession: async () => { throw new Error('registry unavailable') },
    })
    await expect(pool.runTurn('ctx-arch', 'hello', new AbortController().signal)).resolves.toBe('')
    expect(agents.sent).toHaveLength(1)
  })
})
describe('ContextSessionPool concurrency and content', () => {
  it('opens one session for concurrent agentFor calls', async () => {
    const { agents, pool } = poolWith()
    await Promise.all([pool.agentFor('ctx-race'), pool.agentFor('ctx-race'), pool.agentFor('ctx-race')])
    expect(agents.created.get('a2a-ctx-race')).toBe(1)
  })

  it('serializes concurrent turns and returns each turn its own reply', async () => {
    const history: Array<{ role: 'user' | 'assistant'; content: Array<{ type: string; text?: string }> }> = []
    const queue: string[] = []
    let running: Promise<void> | undefined
    const drain = async (): Promise<void> => {
      while (queue.length > 0) {
        const prompt = queue.shift()!
        await new Promise((r) => setTimeout(r, 10))
        history.push({ role: 'assistant', content: [{ type: 'text', text: `reply:${prompt}` }] })
      }
      running = undefined
    }
    const agent: LiveAgent = {
      session: { deriveMessages: () => history },
      send: (message) => {
        const text = message.content.map((b) => b.text).join('')
        history.push({ role: 'user', content: [{ type: 'text', text }] })
        queue.push(text)
        if (running === undefined) running = drain()
      },
      whenIdle: async () => { await running },
      cancel: () => {},
    }
    const create = vi.fn(async () => ({ agent, dispose: async () => {} }))
    const pool = new ContextSessionPool({ create } as unknown as AgentRegistryLike, { cwd: '/tmp' })
    const [one, two] = await Promise.all([
      pool.runTurn('ctx-queue', 'one', new AbortController().signal),
      pool.runTurn('ctx-queue', 'two', new AbortController().signal),
    ])
    expect(one).toBe('reply:one')
    expect(two).toBe('reply:two')
  })

  it('projects live assistant text deltas through the turn callback', async () => {
    const listener: { current?: (payload: unknown) => void } = {}
    const agent: LiveAgent = {
      session: { deriveMessages: () => [{ role: 'assistant', content: [{ type: 'text', text: 'hello' }] }] },
      send: () => {
        listener.current?.({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'he' } } })
        listener.current?.({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'llo' } } })
      },
      whenIdle: async () => {},
      cancel: () => {},
      ctx: {
        on: (_name, handler) => {
          listener.current = handler
          return () => { listener.current = undefined }
        },
      },
    }
    const create = vi.fn(async () => ({ agent, dispose: async () => {} }))
    const pool = new ContextSessionPool({ create } as unknown as AgentRegistryLike, { cwd: '/tmp' })
    const deltas: string[] = []
    await pool.runTurn('ctx-stream', 'hello', new AbortController().signal, {
      onEvent: (event) => { if (event.type === 'text-delta') deltas.push(event.text) },
    })
    expect(deltas).toEqual(['he', 'llo'])
  })

  it('admits raw image/file parts through the attachment store', async () => {
    const agent: LiveAgent = {
      session: { deriveMessages: () => [{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }] },
      send: () => {},
      whenIdle: async () => {},
      cancel: () => {},
    }
    let admitted: unknown
    const create = vi.fn(async () => ({ agent, dispose: async () => {} }))
    const pool = new ContextSessionPool({ create } as unknown as AgentRegistryLike, {
      cwd: '/tmp',
      attachments: {
        admitPromptContent: async (parts) => {
          admitted = parts
          return parts.map((part) => part.type === 'text'
            ? { type: 'text' as const, text: part.text }
            : part.type === 'image'
              ? { type: 'image' as const, attachment: { id: 'img' } }
              : { type: 'file' as const, attachment: part.attachment })
        },
        admitEncodedFile: async () => ({ id: 'file' }),
      },
    })
    await pool.runTurn('ctx-media', [
      { text: 'see attached' },
      { raw: 'aGVsbG8=', mediaType: 'image/png', filename: 'x.png' },
      { raw: 'aGk=', filename: 'a.txt' },
    ], new AbortController().signal)
    expect(admitted).toEqual([
      { type: 'text', text: 'see attached' },
      { type: 'image', data: 'aGVsbG8=', mediaType: 'image/png', name: 'x.png' },
      { type: 'file', attachment: { id: 'file' } },
    ])
  })
})

describe('ContextSessionPool visibility and trace', () => {
  it('never falls back to reasoning when a turn has no visible text', async () => {
    const agent: LiveAgent = {
      session: {
        deriveMessages: () => [{
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'private chain of thought' },
            { type: 'tool-call', text: undefined },
          ],
        }],
      },
      send: () => {},
      whenIdle: async () => {},
      cancel: () => {},
    }
    const create = vi.fn(async () => ({ agent, dispose: async () => {} }))
    const pool = new ContextSessionPool({ create } as unknown as AgentRegistryLike, { cwd: '/tmp' })
    expect(await pool.runTurn('ctx-hidden', 'hi', new AbortController().signal)).toBe('')
  })

  it('observes redacted tool start/end lifecycle through session events', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const agent: LiveAgent = {
      session: {
        id: 'a2a-ctx-trace',
        deriveMessages: () => [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }],
      },
      send: () => {
        const notify = listeners.get('session/event')
        notify?.({ id: 'a2a-ctx-trace' }, {
          type: 'tool/call',
          time: 1_000,
          data: { callId: 'c1', name: 'read_file', arguments: '{"path":"a.txt","token":"super-secret"}' },
        })
        notify?.({ id: 'a2a-ctx-trace' }, {
          type: 'tool/result',
          time: 1_250,
          data: { message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'secret file body' }] } },
        })
      },
      whenIdle: async () => {},
      cancel: () => {},
      ctx: {
        on: (name, handler) => {
          listeners.set(name, handler)
          return () => { listeners.delete(name) }
        },
      },
    }
    const create = vi.fn(async () => ({ agent, dispose: async () => {} }))
    const pool = new ContextSessionPool({ create } as unknown as AgentRegistryLike, { cwd: '/tmp' })
    const calls: Array<{ phase: string; tool: string; status: string; durationMs?: number; argsPreview?: string }> = []
    await pool.runTurn('ctx-trace', 'hi', new AbortController().signal, {
      onTrace: (call) => { calls.push(call) },
    })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ phase: 'start', tool: 'read_file', status: 'running' })
    expect(calls[0]?.argsPreview).toContain('a.txt')
    expect(calls[0]?.argsPreview).not.toContain('super-secret')
    expect(calls[0]?.argsPreview).toContain('[redacted]')
    expect(calls[1]).toMatchObject({ phase: 'end', tool: 'read_file', status: 'ok', durationMs: 250 })
    expect(JSON.stringify(calls)).not.toContain('secret file body')
  })
})
