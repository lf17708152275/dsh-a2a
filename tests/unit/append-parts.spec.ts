/**
 * Appended-artifact coalescing: a streaming peer sends one small text fragment
 * per A2A `append` update, so folding them must rebuild the original answer
 * instead of leaving one word per part (which any part-separating consumer —
 * our own tool output joins parts with a newline — renders one line per word).
 * @module dsh-a2a/tests/unit/append-parts.spec
 */

import { describe, expect, it } from 'vitest'
import { appendParts } from '../../src/outbound/calls.ts'

describe('appendParts', () => {
  it('folds streamed text fragments into one text part', () => {
    const deltas = ['链路', '自检', '通过', ' —— ', '已收到']
    let parts: ReturnType<typeof appendParts> = []
    for (const text of deltas) parts = appendParts(parts, [{ text }])
    expect(parts).toHaveLength(1)
    expect(parts[0]).toEqual({ text: '链路自检通过 —— 已收到' })
  })

  it('keeps a non-text part as its own boundary', () => {
    const parts = appendParts([{ text: 'abc' }], [{ data: { x: 1 } }, { text: 'def' }])
    expect(parts).toHaveLength(3)
    expect(parts[0]).toEqual({ text: 'abc' })
    expect(parts[1]).toEqual({ data: { x: 1 } })
    expect(parts[2]).toEqual({ text: 'def' })
  })

  it('starts a fresh list from an empty artifact', () => {
    expect(appendParts([], [{ text: 'hello' }])).toEqual([{ text: 'hello' }])
  })
})
