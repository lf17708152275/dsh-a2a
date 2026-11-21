#!/usr/bin/env node
/**
 * Interactive visual A2A test.
 *
 * Boots two real DeepSeek Harness instances against scripted mock LLM servers
 * (no provider key), connects A's outbound tool to B's inbound server, and
 * serves a live dashboard that shows the two panels, the task timeline, and
 * two runnable scenarios:
 *
 *   - inbound: curl-style `SendMessage` straight to B's endpoint
 *   - outbound: A's model calls `a2a__b__chat`, which calls B over A2A
 *
 * Open the printed dashboard URL in a browser to watch it. Ctrl+C tears
 * everything down.
 *
 * Usage:
 *   node scripts/visual-a2a-test.mjs
 *
 * Environment:
 *   DSH_A2A_HARNESS_DIR  sibling harness checkout (default `../deepseek-harness`)
 *   DSH_A2A_KEEP=1       keep temp homes and children on exit
 * @module dsh-a2a/scripts/visual-a2a-test
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HARNESS = resolve(process.env.DSH_A2A_HARNESS_DIR ?? join(REPO, '..', 'deepseek-harness'))
const PLUGIN_LIB = join(REPO, 'lib', 'index.js')
const PKG_NAME = '@lf17708152275/dsh-a2a'
const KEEP = process.env.DSH_A2A_KEEP === '1'

const children = new Set()
const tempDirs = new Set()
const log = []
let meta = { inboundId: null, inboundPath: null, outboundId: null, outboundName: 'b' }
let root = null

function note(text) {
  const entry = { time: new Date().toISOString().slice(11, 19), text }
  log.push(entry)
  if (log.length > 120) log.shift()
  process.stdout.write(`[visual] ${entry.time} ${text}\n`)
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : undefined
      server.close(() => (port === undefined ? reject(new Error('no free port')) : resolvePort(port)))
    })
  })
}

function spawnService(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? HARNESS,
    env: { ...process.env, ...options.env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.add(child)
  let out = ''
  let err = ''
  const waiters = []
  child.stdout.on('data', (chunk) => {
    out += chunk.toString()
    for (const waiter of [...waiters]) {
      const match = waiter.test(out)
      if (match !== undefined) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve(match)
      }
    }
  })
  child.stderr.on('data', (chunk) => { err += chunk.toString() })
  child.on('exit', (code, signal) => {
    for (const waiter of waiters.splice(0)) waiter.reject(new Error(`${name} exited before ${waiter.label}`))
    if (!KEEP && code !== 0 && signal === null) process.stderr.write(`[visual] ${name} exited ${code}\n${out}\n${err}\n`)
  })
  return {
    child,
    name,
    output: () => ({ out, err }),
    waitFor(label, test, timeoutMs = 120_000) {
      const existing = test(out)
      if (existing !== undefined) return Promise.resolve(existing)
      return new Promise((resolveWaiter, rejectWaiter) => {
        const waiter = { label, test, resolve: resolveWaiter, reject: rejectWaiter }
        waiters.push(waiter)
        setTimeout(() => {
          const index = waiters.indexOf(waiter)
          if (index === -1) return
          waiters.splice(index, 1)
          rejectWaiter(new Error(`timeout waiting for ${label}\n${out}\n${err}`))
        }, timeoutMs).unref()
      })
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* gone */ }
      await new Promise((resolveStop) => {
        const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ } resolveStop() }, 4000)
        child.once('exit', () => { clearTimeout(timer); resolveStop() })
      })
      children.delete(child)
    },
  }
}

async function startMockLlm(label, port, args) {
  const service = spawnService(`mock-${label}`, 'pnpm', ['run', 'mock:llm', '--port', String(port), '--api-key', 'mock-key', ...args])
  await service.waitFor(`${label} mock ready`, (out) => out.split('\n').find((line) => {
    try { return JSON.parse(line).type === 'ready' } catch { return false }
  }))
  return service
}

async function startDshWeb(label, home, port, mockPort) {
  const service = spawnService(`web-${label}`, 'pnpm', ['dsh', 'web', '--no-open', '--port', String(port)], {
    env: { DSH_HOME: home, DEEPSEEK_BASE_URL: `http://127.0.0.1:${mockPort}/v1`, DEEPSEEK_API_KEY: 'mock-key' },
  })
  const url = await service.waitFor(`${label} web url`, (out) => /dsh web: (http:\/\/[^\s]+)/.exec(out)?.[1])
  return { service, url }
}

async function writeHomeProfile(home, profile, bundles) {
  const dir = join(home, 'profiles', profile)
  await mkdir(join(dir, 'node_modules', '@hanphone'), { recursive: true })
  await writeFile(join(dir, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${profile}`,
    private: true,
    dsh: { profile: { bundles, patchReload: 'startup' } },
  }, null, 2)}\n`)
  const link = join(dir, 'node_modules', '@hanphone', 'dsh-a2a')
  if (!existsSync(link)) await symlink(REPO, link, 'dir')
}

async function control(base, action) {
  const response = await fetch(new URL('/a2a/api', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(action),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${action.action} failed: HTTP ${response.status} ${JSON.stringify(payload)}`)
  return payload
}

async function snapshot(base) {
  const response = await fetch(new URL('/a2a/api', base))
  if (!response.ok) throw new Error(`snapshot failed: HTTP ${response.status}`)
  return response.json()
}

async function sendInbound(base, path, text) {
  const response = await fetch(new URL(path, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'visual',
      method: 'SendMessage',
      params: { message: { role: 'ROLE_USER', parts: [{ text }], metadata: { skill: 'chat' } } },
    }),
  })
  return response.json()
}

async function setup() {
  if (!existsSync(PLUGIN_LIB)) throw new Error(`built plugin not found at ${PLUGIN_LIB}; run pnpm build first`)
  root = await mkdtemp(join(tmpdir(), 'dsh-a2a-visual-'))
  tempDirs.add(root)
  const homeA = join(root, 'a')
  const homeB = join(root, 'b')
  for (const [home, profiles] of [
    [homeA, [['web', true], ['headless', false]]],
    [homeB, [['web', true]]],
  ]) {
    for (const [profile, isWeb] of profiles) {
      await writeHomeProfile(home, profile, isWeb
        ? ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', PKG_NAME]
        : ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', PKG_NAME])
    }
  }

  const mockB = await freePort()
  const mockA = await freePort()
  const portB = await freePort()
  const portA = await freePort()
  const baseB = `http://127.0.0.1:${portB}/`
  const baseA = `http://127.0.0.1:${portA}/`

  await startMockLlm('b', mockB, ['--sequence', 'success', '--success-text', 'OK', '--repeat-last'])
  await startMockLlm('a', mockA, [
    '--sequence', 'tool_call_success,success',
    '--tool-name', 'a2a__b__chat',
    '--tool-arguments', JSON.stringify({ prompt: 'Reply with exactly OK' }),
    '--success-text', 'OK',
    '--repeat-last',
  ])
  await startDshWeb('b', homeB, portB, mockB)
  await startDshWeb('a', homeA, portA, mockA)
  note(`instances up: A=${baseA} B=${baseB}`)

  const createdInbound = await control(baseB, {
    action: 'inbound.create', name: 'visual-b', description: 'visual inbound', version: '0.1.0', preset: 'standard', enabled: true,
  })
  const inbound = (await snapshot(baseB)).inbounds[0]
  meta.inboundId = createdInbound.id ?? inbound.id
  meta.inboundPath = inbound.endpointPath

  const connected = await control(baseA, {
    action: 'outbound.create', name: 'b', agentCardUrl: new URL(inbound.cardPath, baseB).href, enabled: true,
  })
  const outbound = (await snapshot(baseA)).outbounds.find((entry) => entry.name === 'b')
  meta.outboundId = connected.id ?? outbound?.id ?? null
  note(`inbound ${meta.inboundId} on B; outbound ${meta.outboundId} on A (tools=${outbound?.toolCount ?? 0})`)

  // A separate copy of A's home drives the headless model round trip, so it
  // never writes the a2a domain while A's web instance is live.
  const homeHeadless = join(root, 'a-headless')
  await cp(homeA, homeHeadless, { recursive: true })
  return { baseA, baseB, homeHeadless, mockA }
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>A2A 实时可视化测试</title>
<style>
  :root { color-scheme: light dark; --bg:#0f1115; --card:#171a21; --line:#272c36; --fg:#e6e9ef; --muted:#98a2b3; --ok:#3fb950; --run:#d29922; --err:#f85149; --accent:#4493f8; }
  @media (prefers-color-scheme: light) { :root { --bg:#f6f7f9; --card:#fff; --line:#e3e6ea; --fg:#1f2328; --muted:#6b7280; --accent:#0969da; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  header { padding:16px 20px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:12px; }
  header h1 { font-size:16px; margin:0; }
  header .pill { font-size:12px; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:2px 10px; }
  main { padding:16px 20px 40px; max-width:1180px; margin:0 auto; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  @media (max-width:820px) { .grid { grid-template-columns:1fr; } }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .card h2 { font-size:14px; margin:0 0 10px; display:flex; align-items:center; gap:8px; }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--muted); display:inline-block; }
  .dot.ok { background:var(--ok); } .dot.run { background:var(--run); } .dot.err { background:var(--err); }
  table { width:100%; border-collapse:collapse; font-size:12.5px; }
  th,td { text-align:left; padding:5px 6px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:500; }
  code,.mono { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; }
  .flow { display:flex; align-items:center; gap:12px; margin:16px 0; }
  .node { border:1px solid var(--line); border-radius:10px; padding:10px 14px; background:var(--card); min-width:150px; }
  .node b { font-size:13px; } .node span { display:block; color:var(--muted); font-size:12px; }
  .arrow { flex:1; height:2px; background:var(--line); position:relative; }
  .arrow::after { content:""; position:absolute; right:-1px; top:-4px; border:5px solid transparent; border-left-color:var(--line); }
  .pulse { position:absolute; top:-4px; left:0; width:10px; height:10px; border-radius:50%; background:var(--accent); opacity:0; }
  .flow.running .pulse { opacity:1; animation:travel 1.1s linear infinite; }
  @keyframes travel { from { left:0; } to { left:calc(100% - 10px); } }
  .actions { display:flex; gap:10px; flex-wrap:wrap; margin:4px 0 16px; }
  button { background:var(--accent); color:#fff; border:0; border-radius:8px; padding:9px 14px; font-size:13px; cursor:pointer; }
  button.secondary { background:transparent; color:var(--fg); border:1px solid var(--line); }
  button:disabled { opacity:.45; cursor:default; }
  .log { max-height:260px; overflow:auto; background:color-mix(in srgb, var(--fg) 4%, transparent); border-radius:8px; padding:10px 12px; }
  .log div { white-space:pre-wrap; }
  .muted { color:var(--muted); }
  .kpis { display:flex; gap:18px; margin:10px 0 0; color:var(--muted); font-size:12.5px; }
</style></head>
<body>
<header>
  <h1>A2A 实时可视化测试</h1>
  <span class="pill" id="clock">--</span>
  <span class="pill">A = 客户端 · B = 服务端</span>
</header>
<main>
  <div class="flow" id="flow">
    <div class="node"><b>A · DSH 客户端</b><span id="aState">--</span></div>
    <div class="arrow"><span class="pulse"></span></div>
    <div class="node"><b>a2a__b__chat</b><span>模型工具 → A2AClient</span></div>
    <div class="arrow"><span class="pulse"></span></div>
    <div class="node"><b>B · DSH 服务端</b><span id="bState">--</span></div>
  </div>
  <div class="actions">
    <button id="runInbound">运行入站任务（SendMessage → B）</button>
    <button id="runOutbound" class="secondary">运行出站往返（A 模型 → 工具 → B）</button>
  </div>
  <div class="grid">
    <div class="card"><h2><span class="dot" id="aDot"></span>A · 出站连接</h2><div id="aCard" class="mono muted">加载中…</div><div class="kpis" id="aKpis"></div></div>
    <div class="card"><h2><span class="dot" id="bDot"></span>B · 入站 Server</h2><div id="bCard" class="mono muted">加载中…</div><div class="kpis" id="bKpis"></div></div>
    <div class="card"><h2>B · 任务</h2><div id="bTasks" class="muted">暂无</div></div>
    <div class="card"><h2>B · 会话与对端</h2><div id="bSessions" class="muted">暂无</div></div>
  </div>
  <div class="card" style="margin-top:16px"><h2>事件日志</h2><div class="log" id="log"></div></div>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let busy = false;
  function setBusy(next) { busy = next; $('runInbound').disabled = next; $('runOutbound').disabled = next; $('flow').classList.toggle('running', next); }
  async function refresh() {
    try {
      const state = await (await fetch('/api/state')).json();
      $('clock').textContent = new Date().toLocaleTimeString();
      const a = state.a, b = state.b;
      const aOut = (a.outbounds ?? []).find((o) => o.name === 'b') ?? a.outbounds?.[0];
      const bIn = (b.inbounds ?? [])[0];
      $('aState').textContent = aOut ? ('outbound ' + aOut.state + ' · ' + aOut.toolCount + ' tools') : 'no outbound';
      $('bState').textContent = bIn ? ('inbound ' + (bIn.enabled ? 'enabled' : 'disabled')) : 'no inbound';
      $('aDot').className = 'dot ' + (aOut?.state === 'connected' ? 'ok' : aOut?.state === 'failed' ? 'err' : '');
      $('bDot').className = 'dot ' + (bIn?.enabled ? 'ok' : '');
      $('aCard').innerHTML = aOut
        ? '<div>URL: ' + esc(aOut.agentCardUrl) + '</div><div>skills ' + aOut.skillCount + ' · tools ' + aOut.toolCount + (aOut.lastError ? ' · error ' + esc(aOut.lastError) : '') + '</div>'
        : '未创建';
      $('bCard').innerHTML = bIn
        ? '<div>端点: ' + esc(bIn.endpointPath) + '</div><div>preset: ' + esc(bIn.preset ?? '-') + ' · skills: ' + (bIn.skills ?? []).map((s) => esc(s.name)).join(', ') + '</div><div>' + esc(bIn.cardUrl ?? '') + '</div>'
        : '未创建';
      $('aKpis').textContent = 'tasks ' + (a.tasks?.length ?? 0) + ' · sessions ' + (a.sessions?.length ?? 0);
      $('bKpis').textContent = 'tasks ' + (b.tasks?.length ?? 0) + ' · sessions ' + (b.sessions?.length ?? 0) + ' · peers ' + (b.peers?.length ?? 0);
      const tasks = (b.tasks ?? []).slice(-8).reverse();
      $('bTasks').innerHTML = tasks.length ? '<table><thead><tr><th>任务</th><th>技能</th><th>状态</th><th>结果</th></tr></thead><tbody>' +
        tasks.map((t) => '<tr><td class="mono">' + esc(t.taskId) + '</td><td>' + esc(t.skill) + '</td><td>' + esc(t.state) + '</td><td>' + esc((t.artifacts?.[0]?.parts ?? []).map((p) => p.text).join('')) + '</td></tr>').join('') + '</tbody></table>' : '暂无';
      const sessions = b.sessions ?? [];
      const peers = b.peers ?? [];
      $('bSessions').innerHTML = (sessions.length || peers.length)
        ? '<div class="muted">sessions</div>' + sessions.map((s) => '<div class="mono">' + esc(s.contextId) + ' · ' + esc(s.status) + ' · tasks ' + s.taskCount + '</div>').join('') +
          (peers.length ? '<div class="muted" style="margin-top:6px">peers</div>' + peers.map((p) => '<div class="mono">' + esc(p.source ?? p.label ?? p.id) + ' · tasks ' + p.taskCount + '</div>').join('') : '')
        : '暂无';
      $('log').innerHTML = (state.log ?? []).slice().reverse().map((e) => '<div><span class="muted">' + esc(e.time) + '</span> ' + esc(e.text) + '</div>').join('');
    } catch (error) {
      $('clock').textContent = '连接失败: ' + error.message;
    }
  }
  async function run(kind) {
    setBusy(true);
    try {
      const response = await fetch('/api/' + kind, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? response.statusText);
      refresh();
    } catch (error) {
      alert('运行失败: ' + error.message);
    } finally {
      setBusy(false);
      refresh();
    }
  }
  $('runInbound').onclick = () => run('inbound');
  $('runOutbound').onclick = () => run('outbound');
  refresh();
  setInterval(refresh, 1000);
</script>
</body></html>`
}

async function main() {
  const { baseA, baseB, homeHeadless, mockA } = await setup()

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(dashboardHtml())
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const [a, b] = await Promise.all([snapshot(baseA).catch(() => ({})), snapshot(baseB).catch(() => ({}))])
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ a, b, meta, log }))
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/inbound') {
        note('inbound: SendMessage -> B')
        const result = await sendInbound(baseB, meta.inboundPath, 'Reply with exactly OK')
        const task = result.result?.task ?? result.result
        const state = task?.status?.state
        const text = (task?.artifacts ?? []).flatMap((a) => a.parts ?? []).map((p) => p.text).join('')
        note(`inbound: ${state} -> ${JSON.stringify(text)}`)
        res.writeHead(result.error ? 502 : 200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(result.error ? { error: result.error.message } : { state, text }))
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/outbound') {
        note('outbound: A headless model -> a2a__b__chat -> B')
        const headless = spawnService('headless-a', 'pnpm', [
          'dsh', 'headless',
          'Call the tool a2a__b__chat with prompt "Reply with exactly OK", then output the tool result verbatim.',
        ], {
          env: { DSH_HOME: homeHeadless, DEEPSEEK_BASE_URL: `http://127.0.0.1:${mockA}/v1`, DEEPSEEK_API_KEY: 'mock-key' },
        })
        const code = await new Promise((resolveExit) => headless.child.once('exit', resolveExit))
        const { out } = headless.output()
        note(`outbound: headless exited ${code}, stdout=${JSON.stringify(out.trim())}`)
        res.writeHead(code === 0 ? 200 : 502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ code, stdout: out.trim() }))
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
    } catch (error) {
      note(`error: ${error.message}`)
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: error.message }))
    }
  })
  const dashPort = await freePort()
  await new Promise((resolveListen) => server.listen(dashPort, '127.0.0.1', resolveListen))
  process.stdout.write(`\n[visual] dashboard: http://127.0.0.1:${dashPort}/\n`)
  process.stdout.write(`[visual] A web: ${baseA}   B web: ${baseB}\n\n`)

  const shutdown = async () => {
    server.close()
    for (const child of [...children]) {
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* gone */ }
    }
    if (!KEEP) {
      await new Promise((r) => setTimeout(r, 500))
      for (const dir of tempDirs) await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown() })
  process.on('SIGTERM', () => { void shutdown() })
}

main().catch((error) => {
  process.stderr.write(`[visual] FAIL ${error.stack ?? error.message}\n`)
  for (const child of [...children]) { try { process.kill(-child.pid, 'SIGTERM') } catch { /* gone */ } }
  process.exit(1)
})
