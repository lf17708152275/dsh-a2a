/**
 * Preset capability projection: turn a preset roster plus the host's
 * composition inventory into the "what plugins does an A2A session actually
 * carry" list the dashboard shows next to the preset picker.
 *
 * The DSH agent-preset registry keeps the authoritative plugin rows; this
 * module is a pure mapping so it can be unit-tested without a host.
 * @module dsh-a2a/server/preset-capabilities
 */
/** A localised name plus one-line explanation for a known plugin module. */
export interface PluginDescriptor {
    readonly label: string;
    readonly hint?: string;
}
/** One plugin row of a composed agent preset. */
export interface PresetPluginView {
    /** Row id inside the preset declaration, when it has one. */
    readonly entryId: string | null;
    /** Plugin/module name, e.g. `@deepseek-ai/dsh-persona`. */
    readonly module: string;
    /** `false` = declared but disabled, `'conditional'` = `!!js` condition. */
    readonly enabled: boolean | 'conditional';
    /** The `!!js` condition source for conditional rows. */
    readonly condition?: string;
    /** Display name of the module (falls back to its short name). */
    readonly label?: string;
    /** One-line explanation of what the plugin does. */
    readonly hint?: string;
}
/** A preset row as the registry lists it. */
export interface PresetRosterRowLike {
    readonly id: string;
    readonly name?: string;
    readonly description?: string;
}
/** A composition row as `compositionInventory()` reports it. */
export interface CompositionRowLike {
    readonly entryId: string | null;
    readonly moduleName: string;
    readonly enabled: boolean | 'conditional';
    readonly condition?: string;
}
/** A preset composition as `compositionInventory()` reports it. */
export interface CompositionLike {
    readonly id: string;
    readonly broken?: boolean;
    readonly rows?: readonly CompositionRowLike[];
}
/** One module row from `inspectCompositions()`. */
export interface InspectionModuleLike {
    readonly moduleName: string;
}
/** A preset inspection row as `inspectCompositions()` reports it. */
export interface InspectionLike {
    readonly id: string;
    readonly modules?: readonly InspectionModuleLike[];
}
/** Capability data for one preset. */
export interface PresetCapabilities {
    readonly plugins: readonly PresetPluginView[];
    readonly broken?: boolean;
    /** Where the rows came from: the inventory is richer than an inspection. */
    readonly source?: 'inventory' | 'inspection';
}
/** Short module name without the `@deepseek-ai/` scope. */
export declare function shortModuleName(module: string): string;
/** Friendly label + hint for a plugin module; unknown modules keep their short name. */
export declare function describePlugin(module: string): PluginDescriptor;
/**
 * Map roster rows to their composed plugin rows.
 * Presets without a composition entry get an empty list (not an error): the
 * dashboard still lists them, it just cannot say what they carry.
 * @param rows - the preset roster.
 * @param compositions - the host composition inventory, or undefined.
 * @returns capabilities keyed by preset id.
 */
export declare function presetCapabilities(rows: readonly PresetRosterRowLike[], compositions: readonly CompositionLike[] | undefined): Map<string, PresetCapabilities>;
/**
 * Fallback capability projection from `inspectCompositions()`.
 * The inspection reports module names but not per-row enablement, so every row
 * is reported as enabled; it is only used when the host cannot return a full
 * composition inventory.
 * @param rows - the preset roster.
 * @param inspections - host inspections, or undefined.
 * @returns capabilities keyed by preset id with `source: 'inspection'`.
 */
export declare function capabilitiesFromInspections(rows: readonly PresetRosterRowLike[], inspections: readonly InspectionLike[] | undefined): Map<string, PresetCapabilities>;
/**
 * Count the plugins a session started from this preset would mount.
 * Conditional (`!!js`) rows count because they are not declared disabled;
 * only `false` rows are known not to mount.
 */
export declare function mountedPluginCount(capabilities: PresetCapabilities | undefined): number;
//# sourceMappingURL=preset-capabilities.d.ts.map