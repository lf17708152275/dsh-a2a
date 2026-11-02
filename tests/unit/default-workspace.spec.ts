/**
 * Default inbound workspace registration: the plugin owns
 * `~/.dsh/a2a-sessions` so the host lists sessions that have no explicit
 * per-inbound workspace.
 *
 * Regression shape: dropping the registration (or letting a host rejection
 * propagate) makes these assertions fail.
 * @module dsh-a2a/tests/unit/default-workspace.spec
 */

import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_INBOUND_WORKSPACE_TITLE,
  adoptSessions,
  registerDefaultWorkspace,
  type WorkspaceAttachLike,
  type WorkspaceCreatorLike,
} from '../../src/server/default-workspace.ts'

/** Registry stub recording every create() call. */
function fakeRegistry(result: unknown = { id: 'ws-default' }): {
  registry: WorkspaceCreatorLike
  calls: Array<{ path: string; title?: string }>
} {
  const calls: Array<{ path: string; title?: string }> = []
  const registry: WorkspaceCreatorLike = {
    create: async (path: string, title?: string) => {
      calls.push(title === undefined ? { path } : { path, title })
      return result
    },
  }
  return { registry, calls }
}

describe('default inbound workspace registration', () => {
  it('creates the workspace with the directory and the default title', async () => {
    const { registry, calls } = fakeRegistry()
    const registered: string[] = []
    const ok = await registerDefaultWorkspace(registry, '/home/u/.dsh/a2a-sessions', {
      onRegistered: (path) => registered.push(path),
    })
    expect(ok).toBe('registered')
    expect(calls).toEqual([{ path: '/home/u/.dsh/a2a-sessions', title: DEFAULT_INBOUND_WORKSPACE_TITLE }])
    expect(registered).toEqual(['/home/u/.dsh/a2a-sessions'])
  })

  it('honours an explicit title', async () => {
    const { registry, calls } = fakeRegistry()
    await registerDefaultWorkspace(registry, '/tmp/sessions', { title: 'Team Sessions' })
    expect(calls).toEqual([{ path: '/tmp/sessions', title: 'Team Sessions' }])
  })

  it('treats a reused record as a success', async () => {
    const { registry } = fakeRegistry(undefined)
    await expect(registerDefaultWorkspace(registry, '/tmp/sessions')).resolves.toBe('registered')
  })

  it('does nothing without a workspace registry', async () => {
    const onRegistered = vi.fn()
    const onError = vi.fn()
    const ok = await registerDefaultWorkspace(undefined, '/tmp/sessions', { onRegistered, onError })
    expect(ok).toBe('unavailable')
    expect(onRegistered).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports a rejection and never throws', async () => {
    const failure = new Error('workspace does not exist')
    const onRegistered = vi.fn()
    const errors: unknown[] = []
    const registry: WorkspaceCreatorLike = {
      create: async () => {
        throw failure
      },
    }
    const ok = await registerDefaultWorkspace(registry, '/missing/dir', {
      onRegistered,
      onError: (_path, error) => errors.push(error),
    })
    expect(ok).toBe('failed')
    expect(onRegistered).not.toHaveBeenCalled()
    expect(errors).toEqual([failure])
  })
})

/** Workspace stub that records attachments and rejects listed ids. */
function fakeWorkspace(initial: readonly string[] = [], rejected: readonly string[] = []): {
  workspace: WorkspaceAttachLike
  attached: string[]
  rejectedSet: Set<string>
} {
  const attached: string[] = []
  const accounted = [...initial]
  const rejectedSet = new Set(rejected)
  const workspace: WorkspaceAttachLike = {
    get sessionIds() {
      return accounted
    },
    attachSession: async (sessionId: string) => {
      if (rejectedSet.has(sessionId)) throw new Error(`session '${sessionId}' belongs elsewhere`)
      attached.push(sessionId)
      accounted.push(sessionId)
    },
  }
  return { workspace, attached, rejectedSet }
}

describe('default workspace session adoption', () => {
  it('attaches sessions the workspace does not account yet', async () => {
    const { workspace, attached } = fakeWorkspace(['old-1'])
    const adopted = await adoptSessions(workspace, ['s-1', 's-2'])
    expect(adopted).toBe(2)
    expect(attached).toEqual(['s-1', 's-2'])
  })

  it('skips sessions already accounted and duplicate candidates', async () => {
    const { workspace, attached } = fakeWorkspace(['s-1'])
    const adopted = await adoptSessions(workspace, ['s-1', 's-2', 's-2'])
    expect(adopted).toBe(1)
    expect(attached).toEqual(['s-2'])
  })

  it('keeps going past a session that belongs to another workspace', async () => {
    const { workspace, attached } = fakeWorkspace([], ['foreign'])
    const errors: string[] = []
    const adopted = await adoptSessions(workspace, ['foreign', 'mine'], {
      onError: (sessionId) => errors.push(sessionId),
    })
    expect(adopted).toBe(1)
    expect(attached).toEqual(['mine'])
    expect(errors).toEqual(['foreign'])
  })

  it('is a no-op without a workspace', async () => {
    await expect(adoptSessions(undefined, ['s-1'])).resolves.toBe(0)
  })
})
