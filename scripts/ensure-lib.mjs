#!/usr/bin/env node
/**
 * Guarantee that a packed or git-installed copy carries the build artifacts.
 *
 * `lib/` is gitignored, but `package.json` points `main`/`exports` at
 * `lib/index.js` and `lib/client.js`. A publish from a source checkout that
 * never ran the build, or an install from the git URL, therefore resolves to
 * files that do not exist. npm/pnpm run `prepare` on git installs and `prepack`
 * before packing, so both hooks call this script: it builds only when the
 * artifact plane is missing or older than `src/`, which keeps the second hook in
 * the same publish a no-op.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const artifacts = ['lib/index.js', 'lib/client.js'].map((rel) => join(root, rel))

/** Newest mtime under a directory tree, or 0 when the directory is absent. */
function newestMtime(dir) {
  if (!existsSync(dir)) return 0
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    const mtime = entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs
    if (mtime > newest) newest = mtime
  }
  return newest
}

const missing = artifacts.filter((path) => !existsSync(path))
const sourceMtime = newestMtime(join(root, 'src'))
const artifactMtime = missing.length === 0 ? Math.min(...artifacts.map((path) => statSync(path).mtimeMs)) : 0

if (missing.length === 0 && sourceMtime <= artifactMtime) {
  console.log('[ensure-lib] lib/ is up to date; skipping build')
  process.exit(0)
}

console.log(
  missing.length > 0
    ? `[ensure-lib] missing ${missing.map((path) => path.slice(root.length + 1)).join(', ')}; building`
    : '[ensure-lib] src/ is newer than lib/; building',
)

// `tsc -b` trusts a surviving tsbuildinfo and can no-op while lib/ is gone,
// which leaves tsdown without entry points. Drop the incremental cache so the
// build below is a real one (see the known traps in
// docs/harness-compatibility.md).
rmSync(join(root, 'node_modules/.cache/dsh-a2a'), { recursive: true, force: true })
rmSync(join(root, 'tsconfig.client.tsbuildinfo'), { force: true })

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit' })

if (result.error) {
  console.error(`[ensure-lib] could not run \`npm run build\`: ${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) {
  console.error(`[ensure-lib] build failed with exit code ${result.status ?? 'unknown'}`)
  process.exit(result.status ?? 1)
}

const stillMissing = artifacts.filter((path) => !existsSync(path))
if (stillMissing.length > 0) {
  console.error(`[ensure-lib] build finished but ${stillMissing.map((path) => path.slice(root.length + 1)).join(', ')} is still missing`)
  process.exit(1)
}

console.log('[ensure-lib] lib/ rebuilt')
