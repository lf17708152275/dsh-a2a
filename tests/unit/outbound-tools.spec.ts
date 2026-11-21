/**
 * Outbound result selection: a remote task's `result` artifact is the
 * model-facing output; other artifacts contribute text only, and diagnostic
 * metadata never leaks into the local tool result.
 * @module dsh-a2a/tests/unit/outbound-tools.spec
 */

import { describe, expect, it } from 'vitest'
import { Role, TaskState, type Task } from '../../src/protocol.ts'
import { taskOutputText } from '../../src/outbound/tools.ts'
import { TRACE_EXTENSION_URI } from '../../src/server/trace.ts'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'a2a-remote',
    contextId: 'ctx',
    status: { state: TaskState.COMPLETED, timestamp: '2026-01-01T00:00:00.000Z' },
    ...overrides,
  }
}

describe('taskOutputText', () => {
  it('prefers the result artifact and ignores tool-call data artifacts', () => {
    const value = taskOutputText(task({
      artifacts: [
        { artifactId: 'tool-call-1', parts: [{ data: { toolCallId: 'c1', argumentsDelta: '{"secret":"x"}' } }] },
        { artifactId: 'result', parts: [{ text: 'visible answer' }] },
      ],
    }))
    expect(value).toBe('visible answer')
    expect(value).not.toContain('secret')
  })

  it('falls back to text parts from arbitrary artifact ids, never data parts', () => {
    const value = taskOutputText(task({
      artifacts: [
        { artifactId: 'notes', parts: [{ text: 'note one' }] },
        { artifactId: 'params', parts: [{ data: { token: 'secret' } }] },
        { artifactId: 'notes-2', parts: [{ text: 'note two' }] },
      ],
    }))
    expect(value).toBe('note one\nnote two')
    expect(value).not.toContain('secret')
  })

  it('serializes data only when it is the designated result artifact', () => {
    const value = taskOutputText(task({
      artifacts: [{ artifactId: 'result', parts: [{ data: { answer: 42 } }] }],
    }))
    expect(value).toBe('{"answer":42}')
  })

  it('skips artifacts marked with the trace extension', () => {
    const value = taskOutputText(task({
      artifacts: [
        { artifactId: 'result', parts: [{ text: 'answer' }] },
        { artifactId: 'trace', metadata: { [TRACE_EXTENSION_URI]: { calls: [] } }, parts: [{ text: 'private trace' }] },
      ],
    }))
    expect(value).toBe('answer')
  })

  it('renders a failed task error from visible output only', () => {
    const value = taskOutputText(task({
      status: {
        state: TaskState.FAILED,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { messageId: 's', role: Role.AGENT, parts: [{ text: 'status detail' }] },
      },
      artifacts: [{ artifactId: 'result', parts: [{ text: 'result detail' }] }],
    }))
    expect(value).toBe('result detail')
  })

  it('concatenates streamed text fragments instead of one line per fragment', () => {
    // A peer that appends one part per delta (and never coalesces them) is the
    // wire shape this renders: joining with a newline printed one word per line.
    const fragments = ['链', '路', '自', '检', '通过'].map((text) => ({ text }))
    const value = taskOutputText(task({ artifacts: [{ artifactId: 'result', parts: fragments }] }))
    expect(value).toBe('链路自检通过')
    expect(value).not.toContain('\n')
  })

  it('keeps a structured result part on its own line after streamed text', () => {
    const value = taskOutputText(task({
      artifacts: [{ artifactId: 'result', parts: [{ text: '前面' }, { text: '的话' }, { data: { answer: 42 } }, { text: '尾巴' }] }],
    }))
    expect(value).toBe('前面的话{"answer":42}\n尾巴')
  })
})
