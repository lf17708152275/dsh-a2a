/**
 * Session titles for inbound A2A contexts.
 *
 * The dashboard lists DSH sessions by title, and a fresh inbound session has no
 * title until the user renames it by hand. The bridge already knows the stable
 * context id it bound the session to (`wx3-...`), so surfacing that id as the
 * title makes the session list readable without any extra bookkeeping.
 *
 * Renaming is cosmetic: it never fails a task.
 * @module dsh-a2a/server/session-titles
 */

/** The slice of the host session controller used for naming. */
export interface SessionRenamerLike {
  rename(request: { readonly sessionId: string; readonly title: string }): Promise<unknown>
}

/** Title shown for one inbound context before anyone renames it. */
export function defaultSessionTitle(contextId: string, sessionId: string): string {
  const context = contextId.trim()
  if (context.length > 0) return context
  return sessionId.trim()
}

/**
 * Name a freshly opened inbound session after the context it is bound to.
 *
 * @param controller - host session controller, if the deployment exposes one.
 * @param sessionId - DSH session id created for the context.
 * @param contextId - A2A context id (the value the bridge binds to a contact).
 * @param options.onError - notified when the host rejects the rename.
 * @returns true when the rename was applied.
 */
export async function nameNewSession(
  controller: SessionRenamerLike | undefined,
  sessionId: string,
  contextId: string,
  options: { readonly onError?: (error: unknown) => void } = {},
): Promise<boolean> {
  if (controller === undefined) return false
  const title = defaultSessionTitle(contextId, sessionId)
  if (title.length === 0) return false
  try {
    await controller.rename({ sessionId, title })
    return true
  } catch (error) {
    options.onError?.(error)
    return false
  }
}
