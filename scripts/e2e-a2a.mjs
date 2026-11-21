#!/usr/bin/env node
/**
 * Hermetic A2A end-to-end smoke test.
 *
 * Boots two real DeepSeek Harness instances against a scripted mock LLM
 * server — no provider key, no browser, no user Harness home — and exercises
 * the release artifact the way a deployment does:
 *
 *   1. inbound: create a server on B, fetch its AgentCard, POST `SendMessage`,
 *      assert the settled artifact is the mock model's reply;
 *   2. outbound registration: create an outbound connection on A to B and
 *      assert the remote skill became a model tool;
 *   3. outbound round trip: run A's model against a scripted tool call, let it
 *      invoke `a2a__b__chat`, and assert the final answer is B's mock reply.
 *
 * The mock model is `@deepseek-ai/dsh-llm-mock-server` from the sibling
 * harness checkout, so the whole run is deterministic and offline.
 *
 * Usage:
 *   node scripts/e2e-a2a.mjs
 *
 * Environment:
 *   DSH_A2A_HARNESS_DIR  sibling harness checkout (default `../deepseek-harness`)
 *   DSH_A2A_KEEP=1       keep temp homes, logs, and children on exit
 *
 * Exit code 0 means every assertion passed; anything else is a failure with a
 * `[e2e]` diagnostic naming the step and the captured child output.
 * @module dsh-a2a/scripts/e2e-a2a
 */

import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HARNESS = resolve(process.env.DSH_A2A_HARNESS_DIR ?? join(REPO, '..', 'deepseek-harness'))
const PLUGIN_DIR = REPO
const PLUGIN_LIB = join(REPO, 'lib', 'index.js')
const PKG_NAME = '@hanphone/dsh-a2a'
const TRACE_URI = 'https://github.com/hanphone/dsh-a2a/blob/main/docs/extensions/dsh-trace/v1.md'
const KEEP = process.env.DSH_A2A_KEEP === '1'

/** Child processes to tear down (process groups). */
const children = new Set()
/** Temp directories to remove on exit. */
const tempDirs = new Set()

function log(message) {
  process.stdout.write(`[e2e] ${message}\n`)
}

function fail(message, detail) {
  process.stderr.write(`[e2e] FAIL: ${message}\n`)
  if (detail !== undefined && detail !== '') process.stderr.write(`${detail}\n`)
  throw new Error(message)
}

/** One free loopback port chosen by the OS. */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : undefined
      server.close(() => {
        if (port === undefined) reject(new Error('could not allocate a free port'))
        else resolvePort(port)
      })
    })
  })
}

/**
 * Spawn a long-running child in its own process group and collect its output.
 * @returns the child plus helpers to wait for a line and stop the group.
 */
function spawnService(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? HARNESS,
    env: { ...process.env, ...options.env },
    detached: true,
    stdio: [options.stdin === 'pipe' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  })
  children.add(child)
  let out = ''
  let err = ''
  const waiters = []
  const onData = (chunk) => {
    const text = chunk.toString()
    out += text
    for (const waiter of [...waiters]) {
      const match = waiter.test(out)
      if (match !== undefined) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve(match)
      }
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', (chunk) => { err += chunk.toString() })
  child.on('exit', (code, signal) => {
    if (!KEEP && code !== 0 && signal === null) {
      process.stderr.write(`[e2e] ${name} exited early with code ${code}\n${out}\n${err}\n`)
    }
    for (const waiter of waiters.splice(0)) waiter.reject(new Error(`${name} exited before ${waiter.label}`))
  })
  return {
    child,
    name,
    output: () => ({ out, err }),
    /** Wait until the accumulated stdout matches, or the timeout elapses. */
    waitFor(label, test, timeoutMs = 120_000) {
      const existing = test(out)
      if (existing !== undefined) return Promise.resolve(existing)
      return new Promise((resolveWaiter, rejectWaiter) => {
        const waiter = {
          label,
          test,
          resolve: resolveWaiter,
          reject: rejectWaiter,
        }
        waiters.push(waiter)
        setTimeout(() => {
          const index = waiters.indexOf(waiter)
          if (index === -1) return
          waiters.splice(index, 1)
          rejectWaiter(new Error(`timed out after ${timeoutMs}ms waiting for ${label}\n${out}\n${err}`))
        }, timeoutMs).unref()
      })
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
      await new Promise((resolveStop) => {
        const timer = setTimeout(() => {
          try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ }
          resolveStop()
        }, 5000)
        child.once('exit', () => { clearTimeout(timer); resolveStop() })
      })
      children.delete(child)
    },
  }
}

/** Start one mock LLM server and wait for its ready record. */
async function startMockLlm(label, port, args) {
  const service = spawnService(`mock-llm-${label}`, 'pnpm', [
    'run', 'mock:llm',
    '--port', String(port),
    '--api-key', 'mock-key',
    ...args,
  ])
  await service.waitFor(`${label} mock server ready`, (out) =>
    out.split('\n').find((line) => {
      try { return JSON.parse(line).type === 'ready' } catch { return false }
    }),
  )
  return service
}

/** Start one DSH web instance on the given home/port and return its tokenized URL. */
async function startDshWeb(label, home, port, mockPort) {
  const service = spawnService(`dsh-web-${label}`, 'pnpm', ['dsh', 'web', '--no-open', '--port', String(port)], {
    env: {
      DSH_HOME: home,
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
      DEEPSEEK_API_KEY: 'mock-key',
    },
  })
  const url = await service.waitFor(`${label} web URL`, (out) => {
    const match = /dsh web: (http:\/\/[^\s]+)/.exec(out)
    return match?.[1]
  })
  return { service, url }
}

/** One DSH home with a profile whose bundle list mounts the built plugin. */
async function writeHomeProfile(home, profile, bundles) {
  const dir = join(home, 'profiles', profile)
  await mkdir(join(dir, 'node_modules', '@hanphone'), { recursive: true })
  await writeFile(join(dir, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${profile}`,
    private: true,
    dsh: { profile: { bundles, patchReload: 'startup' } },
  }, null, 2)}\n`)
  const link = join(dir, 'node_modules', '@hanphone', 'dsh-a2a')
  if (!existsSync(link)) await symlink(PLUGIN_DIR, link, 'dir')
}

/** POST one A2A dashboard control action and return the parsed reply. */
async function control(base, action) {
  const response = await fetch(new URL('/a2a/api', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(action),
  })
  if (!response.ok) throw new Error(`control ${action.action} failed: HTTP ${response.status} ${await response.text()}`)
  return response.json()
}

/** The whole dashboard snapshot. */
async function snapshot(base) {
  const response = await fetch(new URL('/a2a/api', base))
  if (!response.ok) throw new Error(`snapshot failed: HTTP ${response.status}`)
  return response.json()
}

/** Send one inbound message and return the settled task plus visible result text. */
async function sendMessage(base, endpointPath, text, options = {}) {
  const response = await fetch(new URL(endpointPath, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'e2e',
      method: 'SendMessage',
      params: { message: { role: 'user', parts: [{ text }], metadata: { skill: 'chat' } } },
    }),
  })
  const payload = await response.json()
  if (payload.error !== undefined) throw new Error(`SendMessage error: ${JSON.stringify(payload.error)}`)
  if (payload.result?.task === undefined) throw new Error(`SendMessage result is not the spec {task} envelope: ${JSON.stringify(payload.result)}`)
  const task = payload.result.task
  const state = task?.status?.state
  if (state !== 'TASK_STATE_COMPLETED') throw new Error(`task did not complete: ${state}`)
  const artifacts = task?.artifacts ?? []
  if (artifacts.some((artifact) => String(artifact.artifactId ?? '').startsWith('tool-call-'))) {
    throw new Error(`default task leaked a tool-call artifact: ${JSON.stringify(artifacts)}`)
  }
  const result = artifacts
    .filter((artifact) => artifact.artifactId === 'result')
    .flatMap((artifact) => artifact.parts ?? [])
  if (result.some((part) => part.data !== undefined)) {
    throw new Error(`default result artifact contains a data part: ${JSON.stringify(result)}`)
  }
  const textOut = result.map((part) => part.text ?? '').join('').trim()
  return { task, text: textOut, headers: response.headers }
}

async function main() {
  if (!existsSync(PLUGIN_LIB)) {
    fail(`built plugin not found at ${PLUGIN_LIB}`, 'run `pnpm build` in dsh-a2a before the e2e smoke')
  }
  if (!existsSync(join(HARNESS, 'package.json'))) {
    fail(`harness checkout not found at ${HARNESS}`, 'set DSH_A2A_HARNESS_DIR to the deepseek-harness checkout')
  }

  const root = await mkdtemp(join(tmpdir(), 'dsh-a2a-e2e-'))
  tempDirs.add(root)
  log(`workspace ${root}`)

  const homeA = join(root, 'a')
  const homeB = join(root, 'b')
  await writeHomeProfile(homeA, 'web', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', PKG_NAME])
  await writeHomeProfile(homeA, 'headless', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', PKG_NAME])
  await writeHomeProfile(homeB, 'web', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', PKG_NAME])
  // Deployment gate for the optional trace extension; the instance below also
  // opts in. Without this the instance flag can never activate it.
  await writeFile(join(homeB, 'profiles', 'web', 'cordis.patch.yml'), '- id: a2a\n  config:\n    inboundTrace: true\n')

  const portMockB = await freePort()
  const portMockA = await freePort()
  const portWebB = await freePort()
  const portWebA = await freePort()
  const baseB = `http://127.0.0.1:${portWebB}/`
  const baseA = `http://127.0.0.1:${portWebA}/`

  const mockB = await startMockLlm('b', portMockB, ['--sequence', 'success', '--success-text', 'OK', '--repeat-last'])
  const mockA = await startMockLlm('a', portMockA, [
    '--sequence', 'tool_call_success,success',
    '--tool-name', 'a2a__b__chat',
    '--tool-arguments', JSON.stringify({ prompt: 'Reply with exactly OK' }),
    '--success-text', 'OK',
    '--repeat-last',
  ])

  const webB = await startDshWeb('b', homeB, portWebB, portMockB)
  const webA = await startDshWeb('a', homeA, portWebA, portMockA)

  // ---- 1. inbound over the real HTTP surface ------------------------------
  const created = await control(baseB, {
    action: 'inbound.create',
    name: 'e2e-b',
    description: 'e2e inbound',
    version: '0.1.0',
    preset: 'standard',
    trace: true,
    enabled: true,
  })
  if (!created.ok) fail('inbound.create failed', JSON.stringify(created))
  const inbound = (await snapshot(baseB)).inbounds[0]
  const cardResponse = await fetch(new URL(inbound.cardPath, baseB))
  if (!cardResponse.ok) fail(`AgentCard fetch failed: HTTP ${cardResponse.status}`)
  const card = await cardResponse.json()
  if (!Array.isArray(card.skills) || card.skills.length === 0) fail('AgentCard advertises no skills', JSON.stringify(card))
  if (!card.capabilities?.extensions?.some((extension) => extension.uri === TRACE_URI)) {
    fail('AgentCard does not advertise the enabled trace extension', JSON.stringify(card.capabilities))
  }
  const inboundReply = await sendMessage(baseB, inbound.endpointPath, 'Reply with exactly OK', {
    headers: { 'a2a-extensions': TRACE_URI },
  })
  if (inboundReply.text !== 'OK') fail(`inbound reply was ${JSON.stringify(inboundReply.text)}, expected "OK"`)
  if (inboundReply.headers.get('a2a-extensions') !== TRACE_URI) {
    fail(`trace activation was not acknowledged: ${inboundReply.headers.get('a2a-extensions')}`)
  }
  log('inbound: AgentCard + SendMessage -> OK; trace extension advertised and acknowledged')

  // ---- 2. outbound registration ------------------------------------------
  const connected = await control(baseA, {
    action: 'outbound.create',
    name: 'b',
    agentCardUrl: new URL(inbound.cardPath, baseB).href,
    enabled: true,
  })
  if (!connected.ok) fail('outbound.create failed', JSON.stringify(connected))
  const outbound = (await snapshot(baseA)).outbounds.find((entry) => entry.name === 'b')
  if (outbound?.state !== 'connected') fail(`outbound not connected: ${JSON.stringify(outbound)}`)
  if (outbound.toolCount < 1) fail(`outbound registered ${outbound.toolCount} tools, expected at least 1`)
  log(`outbound: connected, ${outbound.skillCount} skill(s), ${outbound.toolCount} tool(s)`)

  // Stop A's web instance before the one-shot headless run so the two
  // processes never write the same a2a domain concurrently.
  await webA.service.stop()

  // ---- 3. model -> tool -> remote agent round trip ------------------------
  const headless = spawnService('dsh-headless-a', 'pnpm', ['dsh', 'headless', '-'], {
    env: {
      DSH_HOME: homeA,
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${portMockA}/v1`,
      DEEPSEEK_API_KEY: 'mock-key',
    },
    stdin: 'pipe',
  })
  // The profile mounts before the runner reads its task, so a task on stdin
  // lets the outbound reconnect register its tools before the first model
  // request. A task passed on the command line is spliced at mount time and
  // can predate those tools (the harness then announces them mid-session).
  await new Promise((resolve) => setTimeout(resolve, 2500))
  headless.child.stdin.write('Call the tool a2a__b__chat with prompt "Reply with exactly OK", then output the tool result verbatim.')
  headless.child.stdin.end()
  const exit = await new Promise((resolveExit) => {
    headless.child.once('exit', (code) => resolveExit(code))
  })
  const { out, err } = headless.output()
  if (exit !== 0) fail(`headless outbound run exited ${exit}`, `${out}\n${err}`)
  if (!out.includes('OK')) fail(`headless outbound output did not contain OK`, out)

  const remoteTask = (await snapshot(baseB)).tasks.find((task) => String(task.contextId).startsWith('a2a-out-'))
  if (remoteTask === undefined) fail('remote instance recorded no outbound-context task')
  if (remoteTask.state !== 'TASK_STATE_COMPLETED') fail(`remote task is ${remoteTask.state}`)
  if ((remoteTask.artifacts ?? []).some((artifact) => String(artifact.artifactId ?? '').startsWith('tool-call-'))) {
    fail('remote task leaked a tool-call artifact', JSON.stringify(remoteTask.artifacts))
  }
  log('outbound: model -> a2a__b__chat -> remote agent -> OK')

  log('all e2e checks passed')
}

/** Tear down every child process and temp directory. */
async function cleanup() {
  for (const child of [...children]) {
    try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
  }
  if (KEEP) return
  await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true }).catch(() => {})
}

try {
  await main()
  await cleanup()
  process.exit(0)
} catch (error) {
  if (KEEP) {
    process.stderr.write(`[e2e] keeping workspace: ${[...tempDirs].join(', ')}\n`)
  }
  await cleanup()
  if (error instanceof Error && !error.message.startsWith('timed out') && !error.message.includes('FAIL')) {
    process.stderr.write(`[e2e] ${error.stack ?? error.message}\n`)
  }
  process.exit(1)
}
