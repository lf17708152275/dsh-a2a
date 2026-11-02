/**
 * Preset capability projection: turn a preset roster plus the host's
 * composition inventory into the "what plugins does an A2A session actually
 * carry" list the dashboard shows next to the preset picker.
 *
 * The DSH agent-preset registry keeps the authoritative plugin rows; this
 * module is a pure mapping so it can be unit-tested without a host.
 * @module dsh-a2a/server/preset-capabilities
 */

/** One plugin row of a composed agent preset. */
export interface PresetPluginView {
  /** Row id inside the preset declaration, when it has one. */
  readonly entryId: string | null
  /** Plugin/module name, e.g. `@deepseek-ai/dsh-persona`. */
  readonly module: string
  /** `false` = declared but disabled, `'conditional'` = `!!js` condition. */
  readonly enabled: boolean | 'conditional'
  /** The `!!js` condition source for conditional rows. */
  readonly condition?: string
}

/** A preset row as the registry lists it. */
export interface PresetRosterRowLike {
  readonly id: string
  readonly name?: string
  readonly description?: string
}

/** A composition row as `compositionInventory()` reports it. */
export interface CompositionRowLike {
  readonly entryId: string | null
  readonly moduleName: string
  readonly enabled: boolean | 'conditional'
  readonly condition?: string
}

/** A preset composition as `compositionInventory()` reports it. */
export interface CompositionLike {
  readonly id: string
  readonly broken?: boolean
  readonly rows?: readonly CompositionRowLike[]
}

/** Capability data for one preset. */
export interface PresetCapabilities {
  readonly plugins: readonly PresetPluginView[]
  readonly broken?: boolean
}

/**
 * Map roster rows to their composed plugin rows.
 * Presets without a composition entry get an empty list (not an error): the
 * dashboard still lists them, it just cannot say what they carry.
 * @param rows - the preset roster.
 * @param compositions - the host composition inventory, or undefined.
 * @returns capabilities keyed by preset id.
 */
export function presetCapabilities(
  rows: readonly PresetRosterRowLike[],
  compositions: readonly CompositionLike[] | undefined,
): Map<string, PresetCapabilities> {
  const byId = new Map<string, CompositionLike>()
  for (const composition of compositions ?? []) byId.set(composition.id, composition)
  const result = new Map<string, PresetCapabilities>()
  for (const row of rows) {
    const composition = byId.get(row.id)
    if (composition === undefined) {
      result.set(row.id, { plugins: [] })
      continue
    }
    const plugins = (composition.rows ?? []).map((plugin): PresetPluginView => ({
      entryId: plugin.entryId,
      module: plugin.moduleName,
      enabled: plugin.enabled,
      ...(plugin.condition !== undefined ? { condition: plugin.condition } : {}),
    }))
    result.set(row.id, {
      plugins,
      ...(composition.broken === true ? { broken: true } : {}),
    })
  }
  return result
}

/**
 * Count the plugins a session started from this preset would mount.
 * Conditional (`!!js`) rows count because they are not declared disabled;
 * only `false` rows are known not to mount.
 */
export function mountedPluginCount(capabilities: PresetCapabilities | undefined): number {
  if (capabilities === undefined) return 0
  return capabilities.plugins.filter((plugin) => plugin.enabled !== false).length
}
