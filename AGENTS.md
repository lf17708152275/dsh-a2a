# AGENTS.md — dsh-a2a

Standing orders for agents working in this repository. Read
[architecture](docs/architecture.md) before changing `src/`. The version-move
procedure is in [harness compatibility](docs/harness-compatibility.md).

## What this repository is

`@hanphone/dsh-a2a` is an independent, open-source Agent2Agent (A2A) v1.0.1
dual-end plugin for DeepSeek Harness. It mounts as one Cordis row (`a2a`) and
publishes multiple inbound servers plus multiple outbound connections. Instances
are created and managed from the GUI and persisted in the `a2a` domain, not in
`cordis.patch.yml`.

The plugin resolves `@deepseek-ai/*` through project references into a **sibling
harness checkout** at `../deepseek-harness`, not from `node_modules`. A missing
or stale checkout is the most common cause of a confusing typecheck failure.

## Commands

```sh
pnpm typecheck        # host (tsc -b) + client + mirror check
pnpm test             # vitest run (unit + composition + integration)
pnpm test:integration # only the real-persistence suite
pnpm build            # tsc + tsdown -> lib/index.js + lib/client.js
pnpm test:e2e         # hermetic two-instance A2A smoke (build first)
pnpm test:all         # typecheck + test + build + test:e2e
pnpm pack --pack-destination <dir>
```

What each test layer covers is in [testing](docs/testing.md). The short rule:
**stub tests can be green while the plugin is broken against the real harness**,
so a host-contract change needs mirror, real-persistence or e2e evidence.

A clean rebuild after deleting `lib/` can no-op if the TypeScript build cache
survives: clear `node_modules/.cache/dsh-a2a/` before rebuilding.

## Layout

The host half is `src/servers/` (managers) plus `src/server/` (store, card,
A2A server, routes, executors, registries, metrics) and `src/outbound/`
(client, registry, tools). The browser half is `src/client/`. The facade and
command are `src/service.ts` and `src/commands.ts`. The module-level map is in
[architecture](docs/architecture.md#module-map).

## Harness coupling

Four surfaces couple the plugin to a harness version: peer ranges, TypeScript
project references, the patch/client bundle contract, and runtime APIs. The
inspection order, commands and evidence requirements are in
[harness compatibility](docs/harness-compatibility.md).

DSH 0.1.7+ preflights the plugin's `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*`
peers and rejects ranges that do not cover the running version. Keep those ranges
truthful for every tested harness version.

## Rules

- **Evidence before claims.** A compatibility change ships with
  `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:e2e` results
  against the named harness version. Report the commands actually run.
- **Never change `src/` without a passing typecheck and test suite.** Behavior
  changes also need a test that fails without them. A host-contract change needs
  mirror, real-persistence or e2e evidence, not only a stub test.
- **Keep the plugin additive.** Prefer new opt-in config over changed defaults;
  it runs inside someone else's profile composition.
- **The codebase is written in English.** Public docs are an EN/ZH pair; update
  both sides together and keep the `**English** · [中文](…)` switcher.
- **`@hanphone/dsh-a2a` is the published identity.** `scripts/build-client.mjs`
  and `cordis.patch.yml` read it; renaming it is a breaking release.
- **Version bumps are deliberate.** Bump `package.json` `version` in the same
  commit as the compatibility adaptation, and state the verified harness version
  in the message.
- **Secrets stay out of the tree.** `.npmrc` and `~/.git-credentials` hold
  registry tokens; never print, copy into source or commit them.
- **Install from this fork, not from npm.** The plugin's install source is
  `github:lf17708152275/dsh-a2a`; the npm package `@hanphone/dsh-a2a` is the
  upstream release. `package.json` `repository`, the install/upgrade commands in
  the docs, and the panel's update hint all name the fork — keep them naming it
  when merging upstream. The npm name stays the published identity (previous
  rule); only the install spec moves.
- **Do not push or publish without an explicit request.**

Keep each rule self-contained and link the owning document instead of repeating
its procedure. Add a rule only after it has bitten twice.
