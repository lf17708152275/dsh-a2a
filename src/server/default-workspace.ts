/**
 * Registration of the default inbound session directory as a host workspace.
 *
 * Inbound sessions created without an explicit `workspace` run in
 * `~/.dsh/a2a-sessions` (see `inboundSessionCwd`). The host only lists
 * sessions whose cwd belongs to a registered workspace, so without this
 * registration the sessions an operator just created stay invisible in the
 * host session list. The host's `workspaceRegistry.create` is idempotent: it
 * canonicalizes the path, returns an existing record unchanged, and rejects
 * only a relative, missing, or non-directory path — so the call can run once
 * per plugin start and again whenever an inbound is saved with no workspace.
 * @module dsh-a2a/server/default-workspace
 */

/** Structural slice of `ctx.workspaceRegistry` used to own a directory. */
export interface WorkspaceCreatorLike {
  create(path: string, title?: string): Promise<unknown>
}

/**
 * Structural slice of one workspace entity: sessions already accounted (for
 * the idempotent skip) and the validated attach.
 */
export interface WorkspaceAttachLike {
  readonly sessionIds?: readonly string[]
  attachSession(sessionId: string): Promise<void>
}

/** Display title used when the default inbound workspace is first created. */
export const DEFAULT_INBOUND_WORKSPACE_TITLE = 'A2A Sessions'

/** Outcome of one registration attempt. */
export type WorkspaceRegistrationStatus =
  /** The host now holds the directory (new record or an existing one). */
  | 'registered'
  /** No workspace registry in this composition; nothing to do. */
  | 'unavailable'
  /** The host rejected the directory; the cause was reported to `onError`. */
  | 'failed'

/** Observers around one registration attempt; both are optional. */
export interface RegisterDefaultWorkspaceOptions {
  /** Display title for a newly created record (defaults to the module title). */
  readonly title?: string
  /** Called after the host accepted the directory (new or existing record). */
  readonly onRegistered?: (path: string) => void
  /** Called when the host rejected the directory; the failure never propagates. */
  readonly onError?: (path: string, error: unknown) => void
}

/**
 * Ensure `directory` is a registered host workspace.
 *
 * A composition without the workspace registry is left untouched: the plugin
 * keeps working, sessions just stay outside the host session list. A
 * registration failure is reported through `onError` and swallowed so a
 * missing workspace record can never fail plugin startup or an inbound save.
 * @param registry - the probed workspace registry, or undefined when absent.
 * @param directory - absolute directory the default inbound sessions run in.
 * @param options - optional title and observers.
 * @returns `registered`, `unavailable`, or `failed` (see the status type).
 */
export async function registerDefaultWorkspace(
  registry: WorkspaceCreatorLike | undefined,
  directory: string,
  options: RegisterDefaultWorkspaceOptions = {},
): Promise<WorkspaceRegistrationStatus> {
  if (registry === undefined) return 'unavailable'
  try {
    await registry.create(directory, options.title ?? DEFAULT_INBOUND_WORKSPACE_TITLE)
    options.onRegistered?.(directory)
    return 'registered'
  } catch (error) {
    options.onError?.(directory, error)
    return 'failed'
  }
}

/**
 * Account existing sessions under a workspace.
 *
 * The host only attaches a session when it is opened *through* that workspace;
 * sessions the plugin opened by `cwd` (every inbound context) therefore stay
 * unaccounted and invisible in the host session list, even once the directory
 * itself is registered. Attach is validated against the stored header cwd, so
 * a session belonging to another workspace rejects — a mismatch is skipped,
 * never fatal, and the count reports only the adoptions that happened.
 * @param workspace - the resolved workspace entity, or undefined when absent.
 * @param sessionIds - candidate session ids (duplicates and unknowns are fine).
 * @param options - optional failure observer.
 * @returns how many sessions the workspace newly accounted.
 */
export async function adoptSessions(
  workspace: WorkspaceAttachLike | undefined,
  sessionIds: readonly string[],
  options: { readonly onError?: (sessionId: string, error: unknown) => void } = {},
): Promise<number> {
  if (workspace === undefined) return 0
  const accounted = new Set(workspace.sessionIds ?? [])
  const seen = new Set<string>()
  let adopted = 0
  for (const sessionId of sessionIds) {
    if (seen.has(sessionId) || accounted.has(sessionId)) continue
    seen.add(sessionId)
    try {
      await workspace.attachSession(sessionId)
      adopted += 1
    } catch (error) {
      options.onError?.(sessionId, error)
    }
  }
  return adopted
}
