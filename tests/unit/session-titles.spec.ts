import { describe, expect, it } from 'vitest'
import { defaultSessionTitle, nameNewSession, type SessionRenamerLike } from '../../src/server/session-titles.ts'

interface Call {
  readonly sessionId: string
  readonly title: string
}

function fakeController(fail = false): { readonly calls: Call[]; readonly controller: SessionRenamerLike } {
  const calls: Call[] = []
  return {
    calls,
    controller: {
      rename: async (request) => {
        calls.push({ sessionId: request.sessionId, title: request.title })
        if (fail) throw new Error('rename rejected')
        return { title: request.title, seq: 1 }
      },
    },
  }
}

describe('defaultSessionTitle', () => {
  it('uses the bound context id', () => {
    expect(defaultSessionTitle('wx3-f31891692', 'a2a-server-a5a058e1-wx3-f31891692')).toBe('wx3-f31891692')
  })

  it('trims the context id', () => {
    expect(defaultSessionTitle('  wx3-probe  ', 'a2a-x')).toBe('wx3-probe')
  })

  it('falls back to the session id for a blank context', () => {
    expect(defaultSessionTitle('   ', 'a2a-server-x')).toBe('a2a-server-x')
  })
})

describe('nameNewSession', () => {
  it('renames the session after its context id', async () => {
    const { calls, controller } = fakeController()
    await expect(nameNewSession(controller, 'a2a-server-x-wx3-a', 'wx3-a')).resolves.toBe(true)
    expect(calls).toEqual([{ sessionId: 'a2a-server-x-wx3-a', title: 'wx3-a' }])
  })

  it('stays silent without a host controller', async () => {
    await expect(nameNewSession(undefined, 'a2a-server-x', 'wx3-a')).resolves.toBe(false)
  })

  it('reports a rejected rename without throwing', async () => {
    const errors: unknown[] = []
    const { controller } = fakeController(true)
    await expect(nameNewSession(controller, 'a2a-server-x', 'wx3-a', { onError: (error) => errors.push(error) })).resolves.toBe(false)
    expect(errors).toHaveLength(1)
  })
})
