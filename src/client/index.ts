/**
 * A2A settings dashboard — browser half.
 *
 * Registers one `settings.section` ("A2A 连接") managing the multi-instance
 * A2A composition across three tabs: inbound server instances (create/edit,
 * each with its own agent preset — skills derive automatically — and an
 * optional bearer token), outbound server connections (two-phase
 * discover→connect, auth, preset, timeout), and connection/session/task
 * activity (per-context session monitoring with cancel/close).
 *
 * Styling lives in dashboard.css.ts, built entirely on the product's
 * `--dsw-alias-*` design tokens with `@container` responsiveness. All data and
 * controls sit behind the host's loopback-only `/a2a/api` route; this half is
 * a thin read/write client with no protocol knowledge.
 * @module dsh-a2a/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement, useEffect, useRef, useState, type ReactElement } from 'react'
import { injectDashboardStyles } from './dashboard.css.ts'
import { updateCommandFor, updateStatusText, updateToneOf, type UpdateInfo } from './update-status.ts'

/** Services this plugin needs from the client runtime. */
export const inject = ['slots']

const NS = 'a2a'

export function apply(ctx: ClientContext): void {
  ctx.effect(() => injectDashboardStyles(), `${NS}: dashboard styles`)
  // settings.section is declared at runtime by ui-settings-general; slots.inject
  // defers registration until that declaration exists and follows its lifetime.
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    {
      name: 'settings.section',
      id: 'a2a',
      order: 90,
      label: () => 'A2A 连接',
      inject: () => ({}),
    },
    A2aSection,
  ))
}

/** Wire types — mirror the host's src/api.ts + src/service.ts views. */
export interface SkillView {
  readonly id: string
  readonly name: string
  readonly description?: string
}

export interface InboundServerView {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version: string
  readonly endpointPath: string
  readonly preset?: string
  readonly presetOverride?: string
  readonly authTokenEnv?: string
  readonly cardPath: string
  readonly cardUrl?: string
  readonly enabled: boolean
  readonly trace: boolean
  readonly workspace?: string
  readonly provider?: string
  readonly model?: string
  readonly baseUrl?: string
  readonly skills: readonly SkillView[]
}

export interface OutboundSkillView {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly enabled: boolean
}

export interface OutboundServerView {
  readonly id: string
  readonly name: string
  readonly agentCardUrl: string
  readonly preset?: string
  readonly enabled: boolean
  readonly timeoutMs: number
  readonly state: string
  readonly skillCount: number
  readonly toolCount: number
  readonly skills: readonly OutboundSkillView[]
  /** The remote AgentCard's advertised version (absent when unknown). */
  readonly agentVersion?: string
  readonly lastError?: string
  readonly lastCardAt?: string
}

export interface PresetView {
  readonly id: string
  readonly name?: string
  readonly description?: string
  /** Whether this preset is the deployment default when none is named. */
  readonly isDefault?: boolean
}

export interface ApiSnapshot {
  /** Installed plugin version (also present when the update check has not run). */
  readonly version: string
  readonly inbounds: readonly InboundServerView[]
  readonly outbounds: readonly OutboundServerView[]
  readonly tasks: readonly TaskView[]
  readonly taskTotal: number
  readonly taskNextOffset: number | null
  readonly peers: readonly InboundPeerView[]
  readonly sessions: readonly SessionView[]
  readonly metrics: MetricsSnapshot
  /** Deployment-wide settings (advertised base URL mode/override). */
  readonly settings?: DeploymentSettingsView
}

/** Advertised base URL mode as the dashboard sees it. */
export interface DeploymentSettingsView {
  readonly mode: 'inherit' | 'auto' | 'custom'
  readonly baseUrl?: string
  readonly effectiveBaseUrl: string
  readonly configBaseUrl?: string
  /** Origins discovered on the host; the pick list offers them as-is. */
  readonly candidates?: ReadonlyArray<{ readonly value: string; readonly label: string }>
}

export interface MetricsSnapshot {
  readonly requests: number
  readonly authFailures: number
  readonly tasks: {
    readonly created: number
    readonly completed: number
    readonly failed: number
    readonly canceled: number
    readonly interrupted: number
    readonly avgDurationMs: number
    readonly maxDurationMs: number
  }
  readonly outbound: {
    readonly calls: number
    readonly errors: number
    readonly avgDurationMs: number
  }
  readonly audit: readonly AuditEvent[]
}

export interface AuditEvent {
  readonly at: string
  readonly kind: string
  readonly serverId?: string
  readonly taskId?: string
  readonly method?: string
  readonly source?: string
  readonly detail?: string
}

/** The host's update-check answer is exported by `./update-status.ts`. */
export type { UpdateInfo } from './update-status.ts'

interface DiscoverPreview {
  readonly name: string
  readonly version?: string
  readonly description?: string
  readonly endpoint: string
  readonly skills: readonly SkillView[]
}

interface InboundPeerView {
  readonly id: string
  readonly label: string
  readonly source?: string | null
  readonly firstSeen?: string
  readonly lastSeen?: string
  readonly taskCount: number
  readonly activeTaskIds: readonly string[]
  readonly streaming: boolean
}

interface TaskView {
  readonly id: string
  readonly contextId?: string
  readonly serverId?: string
  readonly status?: { readonly state: string; readonly message?: { readonly parts?: readonly { readonly text?: string }[] } }
  readonly artifacts?: readonly { readonly artifactId?: string; readonly name?: string; readonly parts?: readonly unknown[] }[]
  readonly error?: { readonly code: string; readonly message: string }
  readonly metadata?: { readonly skill?: string; readonly serverId?: string }
}

/** One aggregated inbound session row (mirrors the host SessionView). */
interface SessionView {
  readonly contextId: string
  readonly sessionId: string
  readonly serverId?: string
  readonly serverName?: string
  readonly preset?: string
  readonly status: string
  readonly taskCount: number
  readonly activeCount: number
  readonly firstSeen: string
  readonly lastSeen: string
  readonly streaming: boolean
  readonly live: boolean
}

async function fetchSnapshot(query: { readonly taskLimit?: number; readonly taskOffset?: number; readonly taskState?: string } = {}): Promise<ApiSnapshot> {
  const params = new URLSearchParams()
  if (query.taskLimit !== undefined) params.set('taskLimit', String(query.taskLimit))
  if (query.taskOffset !== undefined) params.set('taskOffset', String(query.taskOffset))
  if (query.taskState !== undefined && query.taskState.length > 0) params.set('taskState', query.taskState)
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  const res = await fetch(`/a2a/api${suffix}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`snapshot HTTP ${res.status}`)
  return (await res.json()) as ApiSnapshot
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(path, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.json()
}

async function fetchPresets(): Promise<PresetView[]> {
  const res = await fetch('/a2a/api/presets', { headers: { accept: 'application/json' } })
  if (!res.ok) return []
  return (await res.json()) as PresetView[]
}

/** One routable model as reported by the host's model catalogue. */
interface ModelOption {
  readonly provider: string
  readonly id: string
  readonly name: string
}

async function fetchModels(): Promise<ModelOption[]> {
  try {
    const res = await fetch('/a2a/api/models', { headers: { accept: 'application/json' } })
    if (!res.ok) return []
    const rows = (await res.json()) as unknown
    if (!Array.isArray(rows)) return []
    return rows.filter((r): r is ModelOption => {
      const row = r as { provider?: unknown; id?: unknown; name?: unknown }
      return typeof row.provider === 'string' && typeof row.id === 'string'
    })
  } catch {
    return []
  }
}

/** Dropdown value for "provider/id", or '' when the instance inherits the default. */
function modelKey(provider: string | undefined, model: string | undefined): string {
  if (provider === undefined || provider === '') return ''
  if (model === undefined || model === '') return ''
  return `${provider}/${model}`
}

function splitModelKey(key: string): { provider: string; model: string } {
  const at = key.indexOf('/')
  if (at <= 0) return { provider: '', model: '' }
  return { provider: key.slice(0, at), model: key.slice(at + 1) }
}

async function fetchUpdate(force = false): Promise<UpdateInfo> {
  const res = await fetch(`/a2a/api/update${force ? '?refresh=1' : ''}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as UpdateInfo
}

async function postControl(payload: Record<string, unknown>): Promise<{ readonly ok: boolean; readonly message: string; readonly preview?: unknown; readonly task?: unknown }> {
  const res = await fetch('/a2a/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return (await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }))) as { ok: boolean; message: string; preview?: unknown; task?: unknown }
}

function dotState(state: string): string {
  if (state === 'connected') return 'connected'
  if (state === 'reconnecting' || state === 'disabled') return 'disabled'
  if (state === 'failed') return 'failed'
  return 'connected'
}

function presetLabel(presets: readonly PresetView[], id: string | undefined): string {
  if (id === undefined) return '—'
  return presets.find((p) => p.id === id)?.name ?? id
}

type SectionProps = PropsRuntime<'settings.section'>

export function A2aSection(_props: SectionProps): ReactElement {
  const [snap, setSnap] = useState<ApiSnapshot | undefined>(undefined)
  const [presets, setPresets] = useState<readonly PresetView[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | undefined>(undefined)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateError, setUpdateError] = useState<string | undefined>(undefined)
  const [tab, setTab] = useState<'inbound' | 'outbound' | 'activity'>('inbound')
  const [taskFilter, setTaskFilter] = useState('')
  const [taskLimit, setTaskLimit] = useState(50)
  const [selectedTask, setSelectedTask] = useState<unknown>(undefined)
  const [cardView, setCardView] = useState<unknown>(undefined)
  const [conversation, setConversation] = useState<unknown>(undefined)
  const [conversationKey, setConversationKey] = useState('')
  const [testInbound, setTestInbound] = useState('')
  const [testContext, setTestContext] = useState('')
  const [testSkill, setTestSkill] = useState('chat')
  const [testText, setTestText] = useState('')
  const [testResult, setTestResult] = useState<unknown>(undefined)

  // Inbound create/edit form.
  const [editingIn, setEditingIn] = useState<string | null>(null)
  const [inName, setInName] = useState('')
  const [inDesc, setInDesc] = useState('')
  const [inVersion, setInVersion] = useState('1.0.0')
  const [inPreset, setInPreset] = useState('')
  const [inToken, setInToken] = useState('')
  const [inClearAuth, setInClearAuth] = useState(false)
  const [inTrace, setInTrace] = useState(false)
  // Per-instance workspace + model overrides (blank = inherit deployment default).
  const [inWorkspace, setInWorkspace] = useState('')
  const [models, setModels] = useState<readonly ModelOption[]>([])
  const [inModelKey, setInModelKey] = useState('')
  // Advertised base URL override (blank = the deployment baseUrl config).
  const [inBaseUrl, setInBaseUrl] = useState('')

  // Deployment settings card: advertised base URL mode (inherit / auto / pick / custom).
  const [baseMode, setBaseMode] = useState<'inherit' | 'auto' | 'custom'>('inherit')
  const [baseDraft, setBaseDraft] = useState('')
  const [baseCandidates, setBaseCandidates] = useState<ReadonlyArray<{ readonly value: string; readonly label: string }>>([])
  const baseInit = useRef(false)

  // Outbound add/edit form (two-phase).
  const [editingOut, setEditingOut] = useState<string | null>(null)
  const [outName, setOutName] = useState('')
  const [outUrl, setOutUrl] = useState('')
  const [outPreset, setOutPreset] = useState('')
  const [outTimeout, setOutTimeout] = useState('60000')
  const [outToken, setOutToken] = useState('')
  const [discovered, setDiscovered] = useState<DiscoverPreview | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [outDisabledSkills, setOutDisabledSkills] = useState<string[]>([])
  const [outSkillOverrides, setOutSkillOverrides] = useState('{}')

  useEffect(() => {
    let alive = true
    const tick = async (): Promise<void> => {
      try {
        const [next, presetRows, modelRows] = await Promise.all([
          fetchSnapshot({ taskLimit, ...(taskFilter !== '' ? { taskState: taskFilter } : {}) }),
          fetchPresets(),
          fetchModels(),
        ])
        if (alive) {
          setSnap(next)
          setPresets(presetRows)
          setModels(modelRows)
          // Default an unset preset picker to the deployment default (if any).
          const def = presetRows.find((p) => p.isDefault)?.id
          setInPreset((current) => current === '' && def !== undefined ? def : current)
          setOutPreset((current) => current === '' && def !== undefined ? def : current)
          setTestInbound((current) => current === '' ? (next.inbounds[0]?.id ?? '') : current)
          setTestSkill((current) => current === '' ? (next.inbounds[0]?.skills[0]?.id ?? 'chat') : current)
          // Seed the deployment settings form once; after that the user owns it.
          const settings = next.settings
          if (!baseInit.current && settings !== undefined) {
            baseInit.current = true
            setBaseMode(settings.mode)
            setBaseDraft(settings.mode === 'custom' ? (settings.baseUrl ?? '') : '')
            setBaseCandidates(settings.candidates ?? [])
          }
          setError(undefined)
        }
      } catch (err) {
        if (alive) setError((err as Error).message)
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [taskFilter, taskLimit])

  // The version strip asks once on mount; the host caches the answer for six
  // hours and only an explicit click (refresh=1) reaches the network again.
  useEffect(() => {
    let alive = true
    fetchUpdate()
      .then((info) => { if (alive) setUpdate(info) })
      .catch((err: unknown) => { if (alive) setUpdateError((err as Error).message) })
    return () => { alive = false }
  }, [])

  const checkUpdate = async (): Promise<void> => {
    if (updateBusy) return
    setUpdateBusy(true)
    setUpdateError(undefined)
    try {
      setUpdate(await fetchUpdate(true))
    } catch (err) {
      setUpdateError((err as Error).message)
    } finally {
      setUpdateBusy(false)
    }
  }

  /** Persist the deployment advertised-base-URL mode; blank inherits config. */
  const saveBaseSettings = async (): Promise<void> => {
    const value = baseMode === 'inherit' ? '' : baseMode === 'auto' ? 'auto' : baseDraft.trim()
    if (baseMode === 'custom' && value === '') {
      setError('自定义模式需要一个绝对 URL（如 http://192.168.31.20）')
      return
    }
    const result = await control({ action: 'settings.update', baseUrl: value })
    if (result.ok) {
      setBaseDraft(baseMode === 'custom' ? value : '')
      // Re-sync from the next snapshot so the form shows the effective value.
      baseInit.current = false
    }
  }

  const control = async (payload: Record<string, unknown>): Promise<{ ok: boolean; message: string; preview?: unknown; task?: unknown }> => {
    setBusy(true)
    try {
      const result = await postControl(payload)
      if (!result.ok) setError(result.message)
      else setNotice(result.message)
      setSnap(await fetchSnapshot({ taskLimit, ...(taskFilter !== '' ? { taskState: taskFilter } : {}) }))
      return result
    } catch (err) {
      setError((err as Error).message)
      return { ok: false, message: (err as Error).message }
    } finally {
      setBusy(false)
    }
  }

  const openTask = async (id: string): Promise<void> => {
    try {
      setSelectedTask(await fetchJson(`/a2a/api/task?id=${encodeURIComponent(id)}`))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const openCard = async (id: string): Promise<void> => {
    try {
      setCardView(await fetchJson(`/a2a/api/card?id=${encodeURIComponent(id)}`))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const openConversation = async (contextId: string, serverId?: string): Promise<void> => {
    try {
      const query = new URLSearchParams({ contextId })
      if (serverId !== undefined) query.set('serverId', serverId)
      setConversation(await fetchJson(`/a2a/api/session?${query.toString()}`))
      setConversationKey(`${serverId ?? ''}/${contextId}`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const submitTest = async (): Promise<void> => {
    if (testInbound === '' || testText.trim() === '') return
    const result = await control({
      action: 'inbound.sendTest',
      id: testInbound,
      text: testText.trim(),
      ...(testContext.trim() !== '' ? { contextId: testContext.trim() } : {}),
      ...(testSkill.trim() !== '' ? { skill: testSkill.trim() } : {}),
    })
    if (result.ok) setTestResult(result.task)
  }

  const toggleOutboundSkill = (id: string): void => {
    setOutDisabledSkills((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  const beginCreateInbound = (): void => {
    setEditingIn(null)
    setInName('')
    setInDesc('')
    setInVersion('1.0.0')
    setInPreset('')
    setInToken('')
    setInClearAuth(false)
    setInTrace(false)
    setInWorkspace('')
    setInModelKey('')
    setInBaseUrl('')
  }

  const beginEditInbound = (v: InboundServerView): void => {
    setEditingIn(v.id)
    setInName(v.name)
    setInDesc(v.description)
    setInVersion(v.version)
    setInPreset(v.presetOverride ?? '')
    setInToken('')
    setInClearAuth(false)
    setInTrace(v.trace)
    setInWorkspace(v.workspace ?? '')
    setInModelKey(modelKey(v.provider, v.model))
    setInBaseUrl(v.baseUrl ?? '')
  }

  const submitInbound = async (): Promise<void> => {
    if (!inName.trim() || busy) return
    const base = {
      name: inName.trim(),
      description: inDesc.trim() || 'An A2A inbound server',
      version: inVersion.trim() || '1.0.0',
      preset: inPreset.trim(),
      trace: inTrace,
      // Blank clears the override (update) / inherits the default (create).
      workspace: inWorkspace.trim(),
      provider: splitModelKey(inModelKey).provider,
      model: splitModelKey(inModelKey).model,
      baseUrl: inBaseUrl.trim(),
    }
    const done = editingIn === null
      ? await control({ action: 'inbound.create', ...base })
      : await control({ action: 'inbound.update', id: editingIn, ...base })
    if (!done.ok) return
    // The id-echoed create response carries `id`, but the generic control
    // result drops it; resolve the target from the fresh snapshot.
    let targetId = editingIn
    if (targetId === null) {
      const fresh = await fetchSnapshot()
      const newest = fresh.inbounds[0]
      targetId = newest?.id ?? null
    }
    if (targetId === null) return
    if (inToken.trim().length > 0) await control({ action: 'inbound.setAuth', id: targetId, token: inToken.trim() })
    else if (inClearAuth) await control({ action: 'inbound.setAuth', id: targetId })
    beginCreateInbound()
  }

  const doDiscover = async (): Promise<void> => {
    if (!outUrl.trim() || discovering) return
    setDiscovering(true)
    setDiscovered(null)
    try {
      const result = await postControl({ action: 'outbound.discover', agentCardUrl: outUrl.trim(), ...(outToken.trim() !== '' ? { token: outToken.trim() } : {}) })
      if (result.ok && result.preview !== undefined) {
        const preview = result.preview as DiscoverPreview
        setDiscovered(preview)
        setOutName((v) => v || preview.name)
        setError(undefined)
      } else {
        setError(result.message)
      }
    } finally {
      setDiscovering(false)
    }
  }

  const submitOutbound = async (): Promise<void> => {
    if (!outName.trim() || !outUrl.trim() || busy) return
    const timeout = Number.parseInt(outTimeout, 10)
    const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : undefined
    let skillOverrides: Record<string, { name?: string; description?: string }> = {}
    try {
      if (outSkillOverrides.trim() !== '') skillOverrides = JSON.parse(outSkillOverrides) as Record<string, { name?: string; description?: string }>
    } catch {
      setError('skillOverrides must be valid JSON')
      return
    }
    if (editingOut !== null) {
      const updated = await control({
        action: 'outbound.update',
        id: editingOut,
        ...(outName.trim() !== '' ? { name: outName.trim() } : {}),
        ...(outPreset !== '' ? { preset: outPreset } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        disabledSkills: outDisabledSkills,
        ...(Object.keys(skillOverrides).length > 0 ? { skillOverrides } : {}),
      })
      if (!updated.ok) return
      if (outToken.trim().length > 0) await control({ action: 'outbound.setAuth', id: editingOut, token: outToken.trim() })
      resetOutboundForm()
      return
    }
    const created = await control({
      action: 'outbound.create',
      name: outName.trim(),
      agentCardUrl: outUrl.trim(),
      ...(outPreset !== '' ? { preset: outPreset } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      disabledSkills: outDisabledSkills,
      ...(Object.keys(skillOverrides).length > 0 ? { skillOverrides } : {}),
    })
    if (!created.ok) return
    const fresh = await fetchSnapshot()
    const newest = fresh.outbounds[0]
    if (newest !== undefined && outToken.trim().length > 0) {
      await control({ action: 'outbound.setAuth', id: newest.id, token: outToken.trim() })
    }
    resetOutboundForm()
  }

  const beginEditOutbound = (v: OutboundServerView): void => {
    setEditingOut(v.id)
    setOutName(v.name)
    setOutUrl(v.agentCardUrl)
    setOutPreset(v.preset ?? presets.find((p) => p.isDefault)?.id ?? '')
    setOutTimeout(String(v.timeoutMs))
    setOutToken('')
    setDiscovered(null)
    setOutDisabledSkills(v.skills.filter((skill) => !skill.enabled).map((skill) => skill.id))
    setOutSkillOverrides('{}')
  }

  const resetOutboundForm = (): void => {
    setEditingOut(null)
    setOutName('')
    setOutUrl('')
    setOutPreset(presets.find((p) => p.isDefault)?.id ?? '')
    setOutTimeout('60000')
    setOutToken('')
    setDiscovered(null)
    setOutDisabledSkills([])
    setOutSkillOverrides('{}')
  }

  const inbounds = snap?.inbounds ?? []
  const outbounds = snap?.outbounds ?? []
  const peers = (snap?.peers ?? []) as readonly InboundPeerView[]
  const tasks = (snap?.tasks ?? []) as readonly TaskView[]
  const sessions = (snap?.sessions ?? []) as readonly SessionView[]
  const metrics = snap?.metrics
  const editingOutbound = outbounds.find((v) => v.id === editingOut)

  const h = (text: string, count?: number): ReactElement => createElement(
    'div', { className: 'dsh-a2a-h3' },
    text,
    count !== undefined ? createElement('span', { className: 'dsh-a2a-count' }, String(count)) : null,
  )
  const empty = (text: string): ReactElement => createElement('div', { className: 'dsh-a2a-empty' }, text)

  const pluginVersion = update?.current || snap?.version || ''
  const updateStatus = updateStatusText(update, updateError)
  const updateTone = updateToneOf(update, updateError)
  const runtime = update?.runtime
  const profile = runtime?.profile ?? 'web'
  const updateCommand = updateCommandFor(profile)
  const copyUpdateCommand = (): void => {
    if (navigator.clipboard === undefined) {
      setNotice('复制不了，请手动选中命令')
      return
    }
    navigator.clipboard.writeText(updateCommand)
      .then(() => setNotice('更新命令已复制'))
      .catch(() => setNotice('复制不了，请手动选中命令'))
  }

  return createElement(
    'div',
    { className: 'dsh-a2a-root' },
    createElement(
      'div',
      { className: 'dsh-a2a-section' },
      createElement('p', { className: 'dsh-a2a-intro' }, '管理本 DSH 的 A2A 连接：入站 server 把 DSH 作为 Agent 发布（每个绑定一个 agent preset，技能自动派生）；出站 server 连接并调用远程 A2A Agent。'),
      // ── version / update strip ───────────────────────────────────────
      createElement('div', { className: 'dsh-a2a-verbar' },
        createElement('div', { className: 'dsh-a2a-verbar-main' },
          createElement('span', { className: 'dsh-a2a-verbar-name' }, 'dsh-a2a'),
          createElement('span', { className: 'dsh-a2a-verbar-version dsh-a2a-mono' }, pluginVersion !== '' ? `v${pluginVersion}` : 'v—'),
          createElement('span', { className: 'dsh-a2a-verbar-status', 'data-tone': updateTone }, updateStatus),
        ),
        createElement('div', { className: 'dsh-a2a-verbar-side' },
          runtime !== undefined
            ? createElement('span', { className: 'dsh-a2a-verbar-runtime' }, `Node ${runtime.node} · ${runtime.platform}/${runtime.arch}`)
            : null,
          createElement('button', { className: 'dsh-a2a-btn', type: 'button', disabled: updateBusy, onClick: () => { void checkUpdate() } }, updateBusy ? '检查中…' : '检查更新'),
        ),
      ),
      update !== undefined && update.hasUpdate
        ? createElement('div', { className: 'dsh-a2a-update-detail' },
            createElement('div', { className: 'dsh-a2a-hint' }, `发现新版本 v${update.latest ?? ''}（当前 v${update.current}，来源 ${update.source ?? '未知'}）。先卸旧版再装新版；直接安装可能拿到缓存里的旧副本。命令使用当前 profile（${profile}），装完重启一次 DSH。`),
            createElement('pre', { className: 'dsh-a2a-command dsh-a2a-mono' }, updateCommand),
            createElement('div', { className: 'dsh-a2a-btn-row' },
              createElement('button', { className: 'dsh-a2a-btn', type: 'button', onClick: copyUpdateCommand }, '复制命令'),
              update.repoUrl !== null
                ? createElement('a', { className: 'dsh-a2a-link', href: update.repoUrl, target: '_blank', rel: 'noreferrer' }, '打开仓库')
                : null,
            ),
          )
        : null,
      error !== undefined ? createElement('div', { className: 'dsh-a2a-notice dsh-a2a-error' }, `加载失败：${error}`) : null,
      notice !== undefined ? createElement('div', { className: 'dsh-a2a-notice' }, notice) : null,
      // ── tabs ─────────────────────────────────────────────────────────
      createElement('div', { className: 'dsh-a2a-tabs' },
        createElement('button', { className: 'dsh-a2a-tab', 'data-active': String(tab === 'inbound'), onClick: () => setTab('inbound') }, `入站 Servers（${inbounds.length}）`),
        createElement('button', { className: 'dsh-a2a-tab', 'data-active': String(tab === 'outbound'), onClick: () => setTab('outbound') }, `出站 Servers（${outbounds.length}）`),
        createElement('button', { className: 'dsh-a2a-tab', 'data-active': String(tab === 'activity'), onClick: () => setTab('activity') }, `连接与任务（${peers.length} 连接 · ${sessions.length} 会话）`),
      ),

      // ══ tab: inbound servers ══════════════════════════════════════════
      tab === 'inbound'
        ? createElement('div', { className: 'dsh-a2a-stack' },
            // Deployment-wide advertised base URL (Agent Card回连地址).
            createElement('div', { className: 'dsh-a2a-card' },
              h('部署设置 · 广告地址'),
              createElement('div', { className: 'dsh-a2a-card-sub' },
                `当前生效：${snap?.settings?.effectiveBaseUrl ?? '—'}`,
                snap?.settings?.configBaseUrl !== undefined ? ` · 插件配置：${snap.settings.configBaseUrl}` : '',
              ),
              createElement('div', { className: 'dsh-a2a-btn-row' },
                createElement('select', {
                  className: 'dsh-a2a-input',
                  value: baseMode === 'custom'
                    ? (baseCandidates.some((c) => c.value === baseDraft) ? `pick:${baseDraft}` : 'custom')
                    : baseMode,
                  // `pick:` marks a discovered local origin (kept as a custom
                  // override, so the stored value stays an explicit URL).
                  onChange: (e: { target: { value: string } }) => {
                    const next = e.target.value
                    if (next.startsWith('pick:')) {
                      setBaseMode('custom')
                      setBaseDraft(next.slice('pick:'.length))
                      return
                    }
                    setBaseMode(next as 'inherit' | 'auto' | 'custom')
                    if (next !== 'custom') setBaseDraft('')
                  },
                },
                  createElement('option', { value: 'inherit', key: 'inherit' }, '跟随插件配置'),
                  createElement('option', { value: 'auto', key: 'auto' }, 'auto（按请求 Host 推导）'),
                  ...baseCandidates.map((c) => createElement('option', { value: `pick:${c.value}`, key: c.value }, c.label)),
                  createElement('option', { value: 'custom', key: 'custom' }, '自定义 URL…'),
                ),
                baseMode === 'custom'
                  ? createElement('input', {
                    className: 'dsh-a2a-input',
                    value: baseDraft,
                    placeholder: 'http://192.168.31.20',
                    onChange: (e: { target: { value: string } }) => setBaseDraft(e.target.value),
                  })
                  : null,
                createElement('button', { className: 'dsh-a2a-btn', disabled: busy, onClick: () => { void saveBaseSettings() } }, '保存'),
              ),
              createElement('div', { className: 'dsh-a2a-card-sub' }, '广告地址写进 Agent Card，外部 A2A 客户端靠它回连（不含路径）。下拉可选本机网卡地址、auto（按请求 Host 推导）或自定义；auto 在会改写 Host 的反向代理后面会失准，此时直接选网卡地址。'),
            ),
            createElement('div', { className: 'dsh-a2a-crew' },
              h('入站 Servers', inbounds.length),
              inbounds.length === 0
                ? empty('还没有入站 server。创建一个即可对外发布 A2A 端点。')
                : createElement('div', { className: 'dsh-a2a-card-list' },
                    ...inbounds.map((v) =>
                      createElement('div', { className: 'dsh-a2a-card', key: v.id },
                        createElement('div', { className: 'dsh-a2a-card-head' },
                          createElement('span', { 'data-state': v.enabled ? 'connected' : 'disabled', className: 'dsh-a2a-dot' }),
                          createElement('span', { className: 'dsh-a2a-card-name' }, v.name),
                          createElement('span', { className: 'dsh-a2a-badge', title: v.presetOverride === undefined ? '跟随部署默认预设' : `预设 ${v.presetOverride}` }, v.presetOverride === undefined ? `默认·${presetLabel(presets, v.preset)}` : presetLabel(presets, v.preset)),
                          createElement('span', { className: 'dsh-a2a-badge dsh-a2a-mono' }, `v${v.version}`),
                          ...(v.trace ? [createElement('span', { className: 'dsh-a2a-badge', key: 'trace' }, 'trace')] : []),
                          ...(v.model !== undefined || v.provider !== undefined
                            ? [createElement('span', { className: 'dsh-a2a-badge dsh-a2a-mono', key: 'model' }, [v.provider, v.model].filter((x): x is string => x !== undefined && x.length > 0).join('/'))]
                            : []),
                          ...(v.workspace !== undefined ? [createElement('span', { className: 'dsh-a2a-badge dsh-a2a-mono', key: 'ws', title: v.workspace }, 'cwd')] : []),
                          ...(v.baseUrl !== undefined ? [createElement('span', { className: 'dsh-a2a-badge dsh-a2a-mono', key: 'base', title: v.baseUrl === 'auto' ? '按请求自动推导广告地址' : v.baseUrl }, v.baseUrl === 'auto' ? 'base:auto' : 'base')] : []),
                          createElement('span', { className: 'dsh-a2a-auth' }, v.authTokenEnv !== undefined ? '· 已配置鉴权' : '· 匿名'),
                        ),
                        createElement('div', { className: 'dsh-a2a-card-sub dsh-a2a-mono' }, `${v.endpointPath} · ${v.cardUrl ?? v.cardPath}`),
                        v.workspace !== undefined
                          ? createElement('div', { className: 'dsh-a2a-card-sub dsh-a2a-mono' }, `cwd: ${v.workspace}`)
                          : null,
                        v.skills.length > 0
                          ? createElement('div', null, ...v.skills.map((s) => createElement('span', { className: 'dsh-a2a-skill', key: s.id, title: s.description ?? '' }, s.name)))
                          : null,
                        createElement('div', { className: 'dsh-a2a-btn-row' },
                          createElement('button', { className: 'dsh-a2a-btn', disabled: busy, onClick: () => { void control({ action: v.enabled ? 'inbound.disable' : 'inbound.enable', id: v.id }) } }, v.enabled ? '停用' : '启用'),
                          createElement('button', { className: 'dsh-a2a-btn', disabled: busy, onClick: () => { void openCard(v.id) } }, 'Card'),
                          createElement('button', { className: 'dsh-a2a-btn', disabled: busy, onClick: () => { setTestInbound(v.id); setTestSkill(v.skills[0]?.id ?? 'chat'); setTestResult(undefined) } }, '测试'),
                          createElement('button', { className: 'dsh-a2a-btn', disabled: busy, onClick: () => beginEditInbound(v) }, '编辑'),
                          createElement('button', { className: 'dsh-a2a-btn', disabled: busy, onClick: () => { void control({ action: 'inbound.remove', id: v.id }); if (editingIn === v.id) beginCreateInbound() } }, '删除'),
                        ),
                      ),
                    ),
                  ),
            ),
            createElement('div', { className: 'dsh-a2a-card' },
              h(editingIn !== null ? '编辑入站 Server' : '新建入站 Server'),
              createElement('form', { className: 'dsh-a2a-form', onSubmit: (ev: { preventDefault(): void }) => { ev.preventDefault(); void submitInbound() } },
                createElement('input', { className: 'dsh-a2a-input', value: inName, placeholder: '名称', onChange: (e: { target: { value: string } }) => setInName(e.target.value) }),
                createElement('input', { className: 'dsh-a2a-input', value: inVersion, placeholder: '版本', style: { width: '76px' }, onChange: (e: { target: { value: string } }) => setInVersion(e.target.value) }),
                createElement('select', { className: 'dsh-a2a-select', value: inPreset, onChange: (e: { target: { value: string } }) => setInPreset(e.target.value), title: '绑定这个端点使用的 Agent 预设；选「默认」= 跟随部署默认预设' },
                  createElement('option', { value: '', key: '__default__' }, '（默认：跟随部署）'),
                  ...presets.map((p) => createElement('option', { value: p.id, key: p.id, title: p.description ?? p.id }, p.name ?? p.id)),
                ),
                createElement('input', {
                  className: 'dsh-a2a-input',
                  value: inWorkspace,
                  placeholder: editingIn !== null ? '工作空间绝对路径（留空 = 恢复默认 ~/.dsh/a2a-sessions）' : '工作空间绝对路径（可选，留空 = 默认 ~/.dsh/a2a-sessions）',
                  style: { flex: 1, minWidth: '280px' },
                  onChange: (e: { target: { value: string } }) => setInWorkspace(e.target.value),
                }),
                createElement('input', {
                  className: 'dsh-a2a-input',
                  value: inBaseUrl,
                  placeholder: editingIn !== null ? '广告地址（auto / URL，留空 = 恢复部署默认）' : '广告地址（auto = 按请求自动，或 http://192.168.31.20）',
                  title: '写进 Agent Card 的对外基地址：auto = 按请求 Host 自动推导；或填 http(s)://host[:port]（不含路径）',
                  style: { flex: 1, minWidth: '280px' },
                  onChange: (e: { target: { value: string } }) => setInBaseUrl(e.target.value),
                }),
                createElement('select', {
                  className: 'dsh-a2a-select',
                  value: inModelKey,
                  title: '该入站实例使用的模型（留空 = 继承部署默认）',
                  style: { width: '260px' },
                  onChange: (e: { target: { value: string } }) => setInModelKey(e.target.value),
                },
                  createElement('option', { value: '', key: '' }, '模型：继承部署默认'),
                  ...models.map((m) => createElement('option', {
                    value: modelKey(m.provider, m.id),
                    key: modelKey(m.provider, m.id),
                    title: `${m.provider} / ${m.id}`,
                  }, `${m.name}（${m.provider}/${m.id}）`)),
                  ...(inModelKey !== '' && !models.some((m) => modelKey(m.provider, m.id) === inModelKey)
                    ? [createElement('option', { value: inModelKey, key: `custom:${inModelKey}` }, `已配置：${inModelKey}`)]
                    : []),
                ),
                createElement('input', { className: 'dsh-a2a-input', type: 'password', value: inToken, placeholder: editingIn !== null ? 'Bearer Token（留空不改，填写则更新）' : 'Bearer Token（可选）', onChange: (e: { target: { value: string } }) => setInToken(e.target.value) }),
                createElement('label', { className: 'dsh-a2a-hint' },
                  createElement('input', { type: 'checkbox', checked: inTrace, onChange: (e: { target: { checked: boolean } }) => setInTrace(e.target.checked) }),
                  ' 允许 trace 扩展（工具名/脱敏摘要，默认关闭）',
                ),
                createElement('button', { className: 'dsh-a2a-btn dsh-a2a-btn-primary', type: 'submit', disabled: busy || !inName.trim() }, editingIn !== null ? '保存修改' : '创建 Server'),
                editingIn !== null ? createElement('button', { className: 'dsh-a2a-btn', type: 'button', disabled: busy, onClick: () => beginCreateInbound() }, '取消') : null,
              ),
              editingIn !== null && (snap?.inbounds.find((x) => x.id === editingIn)?.authTokenEnv) !== undefined
                ? createElement('div', { className: 'dsh-a2a-form' },
                    createElement('label', { className: 'dsh-a2a-hint' }, '已配置鉴权。'),
                    createElement('button', { className: 'dsh-a2a-btn', type: 'button', disabled: busy, onClick: () => { setInClearAuth(true); void submitInbound() } }, '清除鉴权'),
                  )
                : null,
              createElement('div', { className: 'dsh-a2a-form' },
                createElement('input', { className: 'dsh-a2a-input', value: inDesc, placeholder: '描述', style: { flex: 1, minWidth: '220px' }, onChange: (e: { target: { value: string } }) => setInDesc(e.target.value) }),
              ),
              createElement('div', { className: 'dsh-a2a-hint' }, '技能由所绑 preset 自动派生（一切皆插件）；Bearer Token 可留空（匿名）。'),
            ),
            createElement('div', { className: 'dsh-a2a-card' },
              h('内置测试控制台', undefined),
              createElement('div', { className: 'dsh-a2a-form' },
                createElement('select', {
                  className: 'dsh-a2a-select',
                  value: testInbound,
                  onChange: (e: { target: { value: string } }) => {
                    setTestInbound(e.target.value)
                    const inbound = inbounds.find((v) => v.id === e.target.value)
                    setTestSkill(inbound?.skills[0]?.id ?? 'chat')
                  },
                }, ...inbounds.map((v) => createElement('option', { value: v.id, key: v.id }, v.name))),
                createElement('input', { className: 'dsh-a2a-input', value: testSkill, placeholder: 'skill', style: { width: '120px' }, onChange: (e: { target: { value: string } }) => setTestSkill(e.target.value) }),
                createElement('input', { className: 'dsh-a2a-input', value: testContext, placeholder: 'contextId（可选）', style: { width: '180px' }, onChange: (e: { target: { value: string } }) => setTestContext(e.target.value) }),
                createElement('input', { className: 'dsh-a2a-input', value: testText, placeholder: '发送一条测试消息', style: { flex: 1, minWidth: '220px' }, onChange: (e: { target: { value: string } }) => setTestText(e.target.value) }),
                createElement('button', { className: 'dsh-a2a-btn dsh-a2a-btn-primary', type: 'button', disabled: busy || testInbound === '' || testText.trim() === '', onClick: () => { void submitTest() } }, '发送'),
              ),
              testResult !== undefined
                ? createElement('pre', { className: 'dsh-a2a-detail' }, JSON.stringify(testResult, null, 2))
                : null,
            ),
            cardView !== undefined
              ? createElement('div', { className: 'dsh-a2a-card' },
                  h('AgentCard JSON'),
                  createElement('pre', { className: 'dsh-a2a-detail' }, JSON.stringify(cardView, null, 2)),
                  createElement('div', { className: 'dsh-a2a-btn-row' },
                    createElement('button', { className: 'dsh-a2a-btn', type: 'button', onClick: () => setCardView(undefined) }, '关闭'),
                  ),
                )
              : null,
          )
        : null,

      // ══ tab: outbound servers ═════════════════════════════════════════
      tab === 'outbound'
        ? createElement('div', { className: 'dsh-a2a-stack' },
            createElement('div', { className: 'dsh-a2a-crew' },
              h('出站 Servers', outbounds.length),
              outbounds.length === 0
                ? empty('还没有出站 server。添加一个远端 A2A 连接即可把其技能注册为模型工具。')
                : createElement('div', { className: 'dsh-a2a-card-list' },
                    ...outbounds.map((v) =>
                      createElement('div', { className: 'dsh-a2a-card', key: v.id },
                        createElement('div', { className: 'dsh-a2a-card-head' },
                          createElement('span', { 'data-state': dotState(v.state), className: 'dsh-a2a-dot' }),
                          createElement('span', { className: 'dsh-a2a-card-name' }, v.name),
                          createElement('span', { className: 'dsh-a2a-badge' }, presetLabel(presets, v.preset)),
                          v.agentVersion !== undefined
                            ? createElement('span', { className: 'dsh-a2a-badge dsh-a2a-mono' }, `v${v.agentVersion}`)
                            : null,
                          createElement('span', { className: 'dsh-a2a-auth' }, `· ${v.state} · 工具 ${v.toolCount}/${v.skillCount}`),
                        ),
                        createElement('div', { className: 'dsh-a2a-card-sub dsh-a2a-mono' }, v.agentCardUrl),
                        v.lastError !== undefined ? createElement('div', { className: 'dsh-a2a-notice dsh-a2a-error' }, v.lastError) : null,
                        createElement('div', { className: 'dsh-a2a-btn-row' },
                          createElement('button', { className: 'dsh-a2a-btn', disabled: busy, onClick: () => { void control({ action: v.enabled ? 'outbound.disable' : 'outbound.enable', id: v.id }) } }, v.enabled ? '停用' : '启用'),
                          createElement('button', { className: 'dsh-a2a-btn', disabled: busy, onClick: () => { void control({ action: 'outbound.refresh', id: v.id }) } }, '刷新'),
                          createElement('button', { className: 'dsh-a2a-btn', disabled: busy, onClick: () => beginEditOutbound(v) }, '编辑'),
                          createElement('button', { className: 'dsh-a2a-btn', disabled: busy, onClick: () => { void control({ action: 'outbound.remove', id: v.id }); if (editingOut === v.id) resetOutboundForm() } }, '删除'),
                        ),
                      ),
                    ),
                  ),
            ),
            createElement('div', { className: 'dsh-a2a-card' },
              h(editingOut !== null ? '编辑出站 Server' : '添加出站 Server'),
              createElement('form', { className: 'dsh-a2a-form', onSubmit: (ev: { preventDefault(): void }) => { ev.preventDefault(); void doDiscover() } },
                createElement('input', { className: 'dsh-a2a-input', value: outName, placeholder: '名称', onChange: (e: { target: { value: string } }) => setOutName(e.target.value) }),
                createElement('input', { className: 'dsh-a2a-input', value: outUrl, placeholder: '远端 AgentCard URL', style: { flex: 1, minWidth: '220px' }, onChange: (e: { target: { value: string } }) => { setOutUrl(e.target.value); setDiscovered(null) } }),
                createElement('input', { className: 'dsh-a2a-input', type: 'password', value: outToken, placeholder: 'Bearer Token（可选）', onChange: (e: { target: { value: string } }) => setOutToken(e.target.value) }),
                createElement('select', { className: 'dsh-a2a-select', value: outPreset, onChange: (e: { target: { value: string } }) => setOutPreset(e.target.value) },
                  ...presets.map((p) => createElement('option', { value: p.id, key: p.id, title: p.description ?? p.id }, p.name ?? p.id)),
                ),
                createElement('input', { className: 'dsh-a2a-input', value: outTimeout, placeholder: '超时 ms', style: { width: '90px' }, onChange: (e: { target: { value: string } }) => setOutTimeout(e.target.value) }),
                editingOutbound !== undefined
                  ? createElement('div', { className: 'dsh-a2a-skill-list' },
                      createElement('div', { className: 'dsh-a2a-skill-list-title' }, '技能（勾选启用）'),
                      ...editingOutbound.skills.map((skill) => createElement('label', { key: skill.id, className: 'dsh-a2a-skill-toggle' },
                        createElement('input', {
                          type: 'checkbox',
                          checked: !outDisabledSkills.includes(skill.id),
                          onChange: () => toggleOutboundSkill(skill.id),
                        }),
                        ` ${skill.name}${skill.description !== undefined ? ` — ${skill.description}` : ''}`,
                      )),
                      createElement('input', {
                        className: 'dsh-a2a-input',
                        value: outSkillOverrides,
                        placeholder: 'per-skill 覆盖 JSON，如 {"chat":{"description":"..."}}',
                        onChange: (e: { target: { value: string } }) => setOutSkillOverrides(e.target.value),
                      }),
                    )
                  : null,
                editingOut === null
                  ? createElement('button', { className: 'dsh-a2a-btn', type: 'submit', disabled: busy || discovering || !outUrl.trim() }, discovering ? '读取中…' : '导入')
                  : null,
                createElement('button', { className: 'dsh-a2a-btn dsh-a2a-btn-primary', type: 'button', disabled: busy || (editingOut === null && discovered === null) || !outName.trim() || !outUrl.trim(), onClick: () => { void submitOutbound() } },
                  editingOut !== null ? '保存修改' : '连接'),
                editingOut !== null ? createElement('button', { className: 'dsh-a2a-btn', type: 'button', disabled: busy, onClick: () => resetOutboundForm() }, '取消') : null,
              ),
              discovered !== null
                ? createElement('div', { className: 'dsh-a2a-preview' },
                    createElement('div', { className: 'dsh-a2a-preview-head' },
                      createElement('span', { 'data-state': 'connected', className: 'dsh-a2a-dot' }),
                      createElement('span', { className: 'dsh-a2a-preview-name' }, discovered.name),
                      discovered.version !== undefined ? createElement('span', { className: 'dsh-a2a-preview-meta dsh-a2a-mono' }, `v${discovered.version}`) : null,
                    ),
                    discovered.description !== undefined ? createElement('div', { className: 'dsh-a2a-preview-desc' }, discovered.description) : null,
                    discovered.skills.length > 0
                      ? createElement('div', { className: 'dsh-a2a-skill-list' },
                          createElement('div', { className: 'dsh-a2a-skill-list-title' }, `Skills（${discovered.skills.length}）`),
                          ...discovered.skills.map((s) => createElement('div', { key: s.id }, `• ${s.name}${s.description !== undefined ? ` — ${s.description}` : ''}`)),
                        )
                      : null,
                    createElement('div', { className: 'dsh-a2a-preview-meta dsh-a2a-mono' }, `端点 ${discovered.endpoint}`),
                    createElement('div', { className: 'dsh-a2a-btn-row' },
                      createElement('button', { className: 'dsh-a2a-btn dsh-a2a-btn-primary', disabled: busy || !outName.trim(), onClick: () => { void submitOutbound() } }, '连接'),
                      createElement('button', { className: 'dsh-a2a-btn', disabled: busy, onClick: () => { setDiscovered(null); setOutUrl('') } }, '取消'),
                    ),
                  )
                : createElement('div', { className: 'dsh-a2a-hint' }, editingOut === null ? '输入远端 AgentCard URL 并点击「导入」，将读取其名称、描述、技能与端点；确认后建立连接。' : '保存将应用名称/Preset/超时与 Token 修改，并重建连接。'),
            ),
          )
        : null,

      // ══ tab: activity (inbound peers + tasks) ═════════════════════════
      tab === 'activity'
        ? createElement('div', { className: 'dsh-a2a-stack' },
            createElement('div', { className: 'dsh-a2a-crew' },
              h('指标'),
              metrics !== undefined
                ? createElement('div', { className: 'dsh-a2a-metrics' },
                    createElement('span', null, `请求 ${metrics.requests} · 鉴权失败 ${metrics.authFailures}`),
                    createElement('span', null, `任务 ${metrics.tasks.created}（完成 ${metrics.tasks.completed} / 失败 ${metrics.tasks.failed} / 取消 ${metrics.tasks.canceled} / 中断 ${metrics.tasks.interrupted}）`),
                    createElement('span', null, `平均 ${metrics.tasks.avgDurationMs}ms · 最长 ${metrics.tasks.maxDurationMs}ms`),
                    createElement('span', null, `出站 ${metrics.outbound.calls}（错误 ${metrics.outbound.errors}，平均 ${metrics.outbound.avgDurationMs}ms）`),
                  )
                : empty('暂无指标。'),
              metrics !== undefined && metrics.audit.length > 0
                ? createElement('div', { className: 'dsh-a2a-table-wrap' },
                    createElement('table', { className: 'dsh-a2a-table' },
                      createElement('thead', null, createElement('tr', null,
                        createElement('th', null, '时间'),
                        createElement('th', null, '事件'),
                        createElement('th', null, '实例 / 任务'),
                        createElement('th', null, '详情'),
                      )),
                      createElement('tbody', null,
                        ...metrics.audit.slice(-20).reverse().map((event, index) => createElement('tr', { key: `${event.at}-${index}` },
                          createElement('td', null, event.at),
                          createElement('td', null, event.kind),
                          createElement('td', null, event.serverId ?? event.taskId ?? '-'),
                          createElement('td', null, event.detail ?? event.method ?? event.source ?? '-'),
                        )),
                      ),
                    ),
                  )
                : null,
            ),
            createElement('div', { className: 'dsh-a2a-crew' }, h('入站连接（谁在调用本服务）', peers.length),
              peers.length === 0
                ? empty('暂无入站连接。其他 A2A 客户端调用本 DSH 的端点后会显示在这里。')
                : createElement('div', { className: 'dsh-a2a-table-wrap' },
                    createElement('table', { className: 'dsh-a2a-table' },
                      createElement('thead', null, createElement('tr', null,
                        createElement('th', null, '来源'),
                        createElement('th', null, '任务'),
                        createElement('th', null, '流式'),
                        createElement('th', null, '首次 / 最近'),
                        createElement('th', null, '操作'),
                      )),
                      createElement('tbody', null,
                        ...peers.map((p) => createElement('tr', { key: p.id },
                          createElement('td', null, p.source ?? p.label),
                          createElement('td', null, `${p.taskCount}（活跃 ${p.activeTaskIds.length}）`),
                          createElement('td', null, p.streaming ? '●' : '—'),
                          createElement('td', null, createElement('span', { className: 'dsh-a2a-card-sub' }, `${p.firstSeen ?? ''} / ${p.lastSeen ?? ''}`)),
                          createElement('td', null, createElement('button', { className: 'dsh-a2a-btn', disabled: busy, onClick: () => { void control({ action: 'inbound.close', id: p.id }) } }, '关闭')),
                        )),
                      ),
                    ),
                  ),
            ),
            createElement('div', { className: 'dsh-a2a-crew' },
              h('入站会话（按 contextId）', sessions.length),
              sessions.length === 0
                ? empty('暂无会话。其他 A2A 客户端带 contextId 调用本服务后，这里会出现一条会话记录。')
                : createElement('div', { className: 'dsh-a2a-table-wrap' },
                    createElement('table', { className: 'dsh-a2a-table' },
                      createElement('thead', null, createElement('tr', null,
                        createElement('th', null, '会话'),
                        createElement('th', null, '实例'),
                        createElement('th', null, 'Preset'),
                        createElement('th', null, '状态'),
                        createElement('th', null, '任务'),
                        createElement('th', null, '流式'),
                        createElement('th', null, '首次 / 最近'),
                        createElement('th', null, '操作'),
                      )),
                      createElement('tbody', null,
                        ...sessions.map((s) => createElement('tr', { key: `${s.serverId ?? ''}/${s.contextId}` },
                          createElement('td', null, createElement('span', { className: 'dsh-a2a-card-sub dsh-a2a-mono' }, s.contextId)),
                          createElement('td', null, s.serverName ?? s.serverId ?? '-'),
                          createElement('td', null, s.preset ?? '-'),
                          createElement('td', null,
                            createElement('span', { 'data-state': s.status === 'running' ? 'connected' : undefined, className: 'dsh-a2a-dot' }),
                            ` ${s.status === 'running' ? '运行中' : '空闲'}`,
                          ),
                          createElement('td', null, `${s.taskCount}（活跃 ${s.activeCount}）`),
                          createElement('td', null, s.streaming ? '●' : '—'),
                          createElement('td', null, createElement('span', { className: 'dsh-a2a-card-sub' }, `${s.firstSeen} / ${s.lastSeen}`)),
                          createElement('td', null,
                            createElement('button', { className: 'dsh-a2a-btn', disabled: busy || s.activeCount === 0, onClick: () => { void control({ action: 'session.cancel', id: s.contextId, ...(s.serverId !== undefined ? { serverId: s.serverId } : {}) }) } }, '取消活跃'),
                            createElement('button', { className: 'dsh-a2a-btn', disabled: busy, onClick: () => { void openConversation(s.contextId, s.serverId) } }, '对话'),
                            createElement('button', { className: 'dsh-a2a-btn', disabled: busy, onClick: () => { void control({ action: 'session.close', id: s.contextId, ...(s.serverId !== undefined ? { serverId: s.serverId } : {}) }) } }, '关闭'),
                          ),
                        )),
                      ),
                    ),
                  ),
            ),
            conversation !== undefined
              ? createElement('div', { className: 'dsh-a2a-crew' },
                  h(`会话对话（${conversationKey}）`),
                  createElement('pre', { className: 'dsh-a2a-detail' }, JSON.stringify(conversation, null, 2)),
                )
              : null,
            createElement('div', { className: 'dsh-a2a-crew' },
              h('任务', tasks.length),
              createElement('div', { className: 'dsh-a2a-form' },
                createElement('select', {
                  className: 'dsh-a2a-select',
                  value: taskFilter,
                  onChange: (e: { target: { value: string } }) => { setTaskFilter(e.target.value); setTaskLimit(50) },
                },
                  createElement('option', { value: '' }, '全部状态'),
                  createElement('option', { value: 'TASK_STATE_WORKING' }, 'WORKING'),
                  createElement('option', { value: 'TASK_STATE_COMPLETED' }, 'COMPLETED'),
                  createElement('option', { value: 'TASK_STATE_FAILED' }, 'FAILED'),
                  createElement('option', { value: 'TASK_STATE_CANCELED' }, 'CANCELED'),
                  createElement('option', { value: 'TASK_STATE_INPUT_REQUIRED' }, 'INPUT_REQUIRED'),
                  createElement('option', { value: 'TASK_STATE_AUTH_REQUIRED' }, 'AUTH_REQUIRED'),
                ),
                createElement('span', { className: 'dsh-a2a-hint' }, `共 ${snap?.taskTotal ?? tasks.length} 条，显示 ${tasks.length}`),
                snap?.taskNextOffset !== null && snap?.taskNextOffset !== undefined
                  ? createElement('button', { className: 'dsh-a2a-btn', type: 'button', onClick: () => setTaskLimit((current) => current + 50) }, '加载更多')
                  : null,
              ),
              tasks.length === 0
                ? empty('暂无任务。')
                : createElement('div', { className: 'dsh-a2a-table-wrap' },
                    createElement('table', { className: 'dsh-a2a-table' },
                      createElement('thead', null, createElement('tr', null,
                        createElement('th', null, 'ID'),
                        createElement('th', null, '技能'),
                        createElement('th', null, '来源'),
                        createElement('th', null, '状态'),
                        createElement('th', null, '操作'),
                      )),
                      createElement('tbody', null,
                        ...tasks.map((t) => createElement('tr', { key: t.id },
                          createElement('td', null, createElement('button', { className: 'dsh-a2a-link dsh-a2a-mono', type: 'button', onClick: () => { void openTask(t.id) } }, t.id)),
                          createElement('td', null, t.metadata?.skill ?? '-'),
                          createElement('td', null, t.metadata?.serverId ?? t.serverId ?? '-'),
                          createElement('td', null, t.status?.state ?? '-'),
                          createElement('td', null, createElement('button', { className: 'dsh-a2a-btn', disabled: busy, onClick: () => { void control({ action: 'task.cancel', id: t.id }) } }, '取消')),
                        )),
                      ),
                    ),
                  ),
              selectedTask !== undefined
                ? createElement('pre', { className: 'dsh-a2a-detail' }, JSON.stringify(selectedTask, null, 2))
                : null,
            ),
          )
        : null,

      createElement('div', { className: 'dsh-a2a-footer' }, '每 3 秒自动刷新。'),
    ),
  )
}