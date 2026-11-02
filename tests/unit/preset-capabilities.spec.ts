import { describe, expect, it } from 'vitest'
import { mountedPluginCount, presetCapabilities, type CompositionLike } from '../../src/server/preset-capabilities.ts'

const roster = [
  { id: 'card-01', name: '奶糖妹妹' },
  { id: 'standard', name: 'Standard' },
  { id: 'broken-one', name: 'Broken' },
]

const compositions: CompositionLike[] = [
  {
    id: 'card-01',
    rows: [
      { entryId: 'persona', moduleName: '@deepseek-ai/dsh-persona', enabled: true },
      { entryId: 'bash', moduleName: '@deepseek-ai/dsh-tool-bash', enabled: true },
      { entryId: 'off', moduleName: '@deepseek-ai/dsh-tool-search', enabled: false },
    ],
  },
  {
    id: 'standard',
    rows: [{ entryId: null, moduleName: '@deepseek-ai/dsh-persona', enabled: 'conditional', condition: '!!js ctx.has(...)' }],
  },
  { id: 'broken-one', broken: true, rows: [] },
]

describe('presetCapabilities', () => {
  it('maps composition rows onto roster rows in declaration order', () => {
    const capabilities = presetCapabilities(roster, compositions)
    const card = capabilities.get('card-01')
    expect(card?.plugins.map((plugin) => plugin.module)).toEqual([
      '@deepseek-ai/dsh-persona',
      '@deepseek-ai/dsh-tool-bash',
      '@deepseek-ai/dsh-tool-search',
    ])
    expect(card?.plugins[2]?.enabled).toBe(false)
    expect(card?.plugins[0]?.entryId).toBe('persona')
  })

  it('keeps conditional rows and their expression', () => {
    const capabilities = presetCapabilities(roster, compositions)
    const standard = capabilities.get('standard')
    expect(standard?.plugins).toEqual([
      { entryId: null, module: '@deepseek-ai/dsh-persona', enabled: 'conditional', condition: '!!js ctx.has(...)' },
    ])
  })

  it('reports presets the host could not compose as broken', () => {
    const capabilities = presetCapabilities(roster, compositions)
    expect(capabilities.get('broken-one')?.broken).toBe(true)
    expect(capabilities.get('broken-one')?.plugins).toEqual([])
  })

  it('falls back to an empty plugin list when no inventory is available', () => {
    for (const compositionsInput of [undefined, [] as CompositionLike[]]) {
      const capabilities = presetCapabilities(roster, compositionsInput)
      expect(capabilities.get('card-01')?.plugins).toEqual([])
      expect(capabilities.get('standard')?.plugins).toEqual([])
    }
  })

  it('keeps roster entries that have no composition entry', () => {
    const capabilities = presetCapabilities([{ id: 'unknown' }], compositions)
    expect(capabilities.get('unknown')).toEqual({ plugins: [] })
  })
})

describe('mountedPluginCount', () => {
  it('counts only rows that will really mount', () => {
    const capabilities = presetCapabilities(roster, compositions)
    expect(mountedPluginCount(capabilities.get('card-01'))).toBe(2)
    expect(mountedPluginCount(capabilities.get('standard'))).toBe(1)
    expect(mountedPluginCount(capabilities.get('broken-one'))).toBe(0)
    expect(mountedPluginCount(undefined)).toBe(0)
  })
})
