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
  readonly label: string
  readonly hint?: string
}

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
  /** Display name of the module (falls back to its short name). */
  readonly label?: string
  /** One-line explanation of what the plugin does. */
  readonly hint?: string
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

/** Friendly names for the plugin modules the dashboard commonly sees. */
const PLUGIN_DESCRIPTORS: Readonly<Record<string, PluginDescriptor>> = {
  '@deepseek-ai/dsh-persona': { label: '人格提示词', hint: '系统提示词里的人设部分（卡片的正文就挂在这里）' },
  '@deepseek-ai/dsh-agent-instructions': { label: '项目指令', hint: 'AGENTS.md 等项目说明注入' },
  '@deepseek-ai/dsh-time-context': { label: '时间上下文', hint: '把当前时间告诉模型' },
  '@deepseek-ai/dsh-tool-bash': { label: '终端命令', hint: '执行 shell 命令' },
  '@deepseek-ai/dsh-tool-pwsh': { label: 'PowerShell', hint: 'Windows 下的命令执行' },
  '@deepseek-ai/dsh-tool-fs': { label: '文件读写', hint: '读/写/改文件' },
  '@deepseek-ai/dsh-tool-fs-search': { label: '文件搜索', hint: '按内容或文件名搜索' },
  '@deepseek-ai/dsh-tool-jobs': { label: '后台任务', hint: '管理长跑进程' },
  '@deepseek-ai/dsh-tool-schedule': { label: '定时提醒', hint: '设定时任务' },
  '@deepseek-ai/dsh-skill-filesystem': { label: '文件技能', hint: '把文件系统能力暴露成 skill' },
  '@deepseek-ai/dsh-tool-skill': { label: '技能调用', hint: '按需加载技能' },
  '@deepseek-ai/dsh-command-goal': { label: '目标命令', hint: '/goal 命令' },
  '@deepseek-ai/dsh-tool-goal': { label: '目标工具', hint: '跨轮次目标管理' },
  '@deepseek-ai/dsh-plan-mode': { label: '计划模式', hint: '先出方案再动手' },
  '@deepseek-ai/dsh-compaction-basic': { label: '上下文压缩', hint: '长了自动压缩历史' },
  '@deepseek-ai/dsh-compaction-tool-result-pruner': { label: '工具结果裁剪', hint: '缩短过长的工具输出' },
  '@deepseek-ai/dsh-tool-subagent': { label: '子代理', hint: '派发子任务' },
  '@deepseek-ai/dsh-tool-subagent-control': { label: '子代理管理', hint: '查看/控制子代理' },
  '@deepseek-ai/dsh-tool-web-search': { label: '联网搜索', hint: '搜索网页' },
  '@deepseek-ai/dsh-tool-web-fetch': { label: '网页读取', hint: '抓取网页正文' },
  'dsh-nekowhale-stickers': { label: '表情包', hint: '搜索/发送贴纸与表情包' },
  'cordis:group': { label: '插件分组', hint: '一组插件的容器' },
}

/** Short module name without the `@deepseek-ai/` scope. */
export function shortModuleName(module: string): string {
  return module.replace(/^@[^/]+\//, '')
}

/** Friendly label + hint for a plugin module; unknown modules keep their short name. */
export function describePlugin(module: string): PluginDescriptor {
  return PLUGIN_DESCRIPTORS[module] ?? { label: shortModuleName(module) }
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
    const plugins = (composition.rows ?? []).map((plugin): PresetPluginView => {
      const descriptor = describePlugin(plugin.moduleName)
      return {
        entryId: plugin.entryId,
        module: plugin.moduleName,
        enabled: plugin.enabled,
        ...(plugin.condition !== undefined ? { condition: plugin.condition } : {}),
        label: descriptor.label,
        ...(descriptor.hint !== undefined ? { hint: descriptor.hint } : {}),
      }
    })
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
