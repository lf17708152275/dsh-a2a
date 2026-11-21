/**
 * Real-runtime integration: drive the inbound `ContextSessionPool` over a real
 * Cordis context with the production agent loop plus JSONL session
 * persistence, and a scripted mock LLM adapter.
 *
 * The stub-service unit and composition suites cannot catch host-contract
 * drift in the durable session codec: `session.append` accepts any non-empty
 * `source.kind` in memory, and only the JSONL v4 encoder refuses the retired
 * shared `plugin` wrapper. When it refused, the write failed in the handle's
 * background flush, the driver error was contained by the agent loop, and
 * every inbound task settled with `(no reply)` while all stub tests stayed
 * green. These tests therefore assert the reply AND the persisted log after
 * teardown, which is where the refusal becomes observable.
 *
 * The composition mirrors the harness's own persistent test harness:
 * prerequisites, then the JSONL backend, then the loop; the A2A plugin's
 * session pool is the only thing under test.
 * @module dsh-a2a/tests/integration/persistence.spec
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import LlmRuntime, { LlmAdapter, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { ContextSessionPool } from '../../src/server/exec/agent-runtime.ts'

/** One completed text response, in the adapter's stream vocabulary. */
function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** One assistant tool call, followed by the model's finish reason. */
function toolCallResponse(id: string, name: string, args: Record<string, unknown>): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** Scripted adapter: each model call consumes the next response. */
class ScriptedAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []

  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptedAdapter: script exhausted')
    for (const chunk of entry) yield chunk
  }
}

interface Harness {
  readonly ctx: Context
  readonly pool: ContextSessionPool
  readonly adapter: ScriptedAdapter
  readonly root: string
}

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Mount a real persistent agent composition plus the A2A session pool over it. */
async function poolHarness(script: StreamChunk[][]): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-a2a-integration-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  // 0.2.2-alpha.2 requires an explicit executor in the composition; the
  // native executor is what the shipped profiles mount.
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  // The backend mounts BEFORE the loop so root teardown unwinds the loop
  // first: live agents drain their writers into still-open handles.
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const pool = new ContextSessionPool(ctx.agents, {
    cwd: root,
    resolveAgentOptions: () => ({ provider: 'mock', model: 'mock' }),
  })
  return { ctx, pool, adapter, root }
}

/** Every file under a directory, recursively. */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(path))
    else out.push(path)
  }
  return out
}

/** The physical session log written for one session id. */
async function sessionLog(root: string, sessionId: string): Promise<string> {
  const files = await walk(root)
  const match = files.find((file) => file.endsWith(`/${sessionId}/session.v4.jsonl`))
  if (match === undefined) throw new Error(`no persisted session log for ${sessionId}; files: ${files.join(', ')}`)
  return match
}

describe('ContextSessionPool over real session persistence', () => {
  it('runs a turn to a reply without the durable codec refusing the message source', async () => {
    const { pool, adapter } = await poolHarness([textResponse('OK')])
    const reply = await pool.runTurn('ctx-1', 'Reply with exactly OK', new AbortController().signal)
    expect(reply).toBe('OK')
    expect(adapter.requests).toHaveLength(1)
  })

  it('persists the inbound user message with the producer-owned a2a source kind', async () => {
    const { ctx, pool, root } = await poolHarness([textResponse('OK')])
    await pool.runTurn('ctx-1', 'Reply with exactly OK', new AbortController().signal)
    // Teardown drains the session handle's background flush; the v4 codec is
    // where a non-producer source kind is refused, so the log is the assertion.
    await ctx.fiber.dispose()

    const log = await sessionLog(root, 'a2a-ctx-1')
    const rows = (await readFile(log, 'utf8'))
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string; data?: unknown })

    expect(rows[0]).toMatchObject({ type: 'session', version: 4 })
    const userMessages = rows.filter((row) => row.type === 'user/message')
    const inbound = userMessages.find((row) => {
      const data = row.data as { content?: readonly { type?: string; text?: string }[] }
      return data.content?.some((block) => block.text === 'Reply with exactly OK') === true
    })
    expect(inbound).toBeDefined()
    expect((inbound?.data as { source?: { kind?: string } }).source?.kind).toBe('a2a')
    expect((inbound?.data as { source?: { kind?: string } }).source?.kind).not.toBe('plugin')
  })

  it('reopens the same context as a live handle and runs a second turn', async () => {
    const { pool, adapter } = await poolHarness([textResponse('one'), textResponse('two')])
    expect(await pool.runTurn('ctx-1', 'first', new AbortController().signal)).toBe('one')
    expect(await pool.runTurn('ctx-1', 'second', new AbortController().signal)).toBe('two')
    expect(adapter.requests).toHaveLength(2)
  })

  it('rejects the turn when the provider fails instead of returning stale text', async () => {
    // One successful turn establishes assistant history; the next provider call
    // fails. The old implementation returned that stale assistant text and the
    // A2A task settled COMPLETED.
    const { pool } = await poolHarness([textResponse('first reply')])
    expect(await pool.runTurn('ctx-error', 'first', new AbortController().signal)).toBe('first reply')
    await expect(pool.runTurn('ctx-error', 'second', new AbortController().signal)).rejects.toThrow()
  })

  it('projects real assistant stream deltas to the turn callback', async () => {
    const { pool } = await poolHarness([textResponse('OK')])
    const deltas: string[] = []
    const reply = await pool.runTurn('ctx-live-stream', 'stream please', new AbortController().signal, {
      onEvent: (event) => { if (event.type === 'text-delta') deltas.push(event.text) },
    })
    expect(reply).toBe('OK')
    expect(deltas.join('')).toBe('OK')
  })

  it('observes a real tool/call and tool/result lifecycle for trace', async () => {
    const { ctx, pool } = await poolHarness([
      toolCallResponse('call-1', 'echo', { value: 'hi', token: 'super-secret' }),
      textResponse('done'),
    ])
    ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: 'echo one value',
      parameters: {
        value: { type: 'string', required: true },
        token: { type: 'string' },
      },
      async execute(args) {
        return [{ type: 'text', text: `echo:${String(args.value)}` }]
      },
    }))
    const calls: Array<{ phase: string; tool: string; status: string; durationMs?: number; argsPreview?: string }> = []
    const reply = await pool.runTurn('ctx-real-trace', 'use the tool', new AbortController().signal, {
      onTrace: (call) => { calls.push(call) },
    })
    expect(reply).toBe('done')
    expect(calls.map((call) => [call.phase, call.tool, call.status])).toEqual([
      ['start', 'echo', 'running'],
      ['end', 'echo', 'ok'],
    ])
    expect(calls[0]?.argsPreview).toContain('hi')
    expect(calls[0]?.argsPreview).toContain('[redacted]')
    expect(calls[0]?.argsPreview).not.toContain('super-secret')
    expect(calls[1]?.durationMs).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(calls)).not.toContain('echo:hi')
  })
})
