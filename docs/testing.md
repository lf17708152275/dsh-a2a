---
name: Testing
description: Test layers, commands, the hermetic e2e flow, the visual harness and CI
update-time: 2026-11-18
---

# Testing

**English** · [中文](testing.zh.md)

A plugin can pass every stub test and still be broken against the real harness.
The layers below exist so a host-contract change fails a test before it reaches
a release. What each layer covers, and why stubs are not enough, is the point of
this page.

## Layers

| Layer | Lives in | Catches | Needs built harness artifacts |
|---|---|---|---|
| Mirror check | `tests/types/mirrors.typecheck.ts` | Structural mirrors drifting from real `@deepseek-ai/dsh-*` types | yes (`lib/types`) |
| Unit / composition | `tests/unit`, `tests/composition` | Protocol framing, routes, stores, registries, `apply()` wiring over stub host services | no |
| Real-persistence integration | `tests/integration/persistence.spec.ts` | Durable session codec, agent-loop contract, inbox sources | yes (JSONL addon) |
| Profile e2e | `scripts/e2e-a2a.mjs` | A released artifact against two real harness instances: manifest/mount, routes, discovery, JSON-RPC, tool registration, model → tool → remote agent, trace card/header activation | yes (host + plugin) |

Visibility-specific coverage lives in `tests/unit/agent-runtime.spec.ts` (reasoning
fallback and tool trace lifecycle), `tests/unit/a2a-server.spec.ts` (history,
empty output, extension activation), `tests/unit/outbound-tools.spec.ts`
(outbound result selection) and `tests/unit/subagent.spec.ts` (subagent reasoning
filter).

## Commands

```sh
pnpm typecheck        # host (tsc -b) + client + mirror check
pnpm test             # vitest run: unit + composition + integration (199 tests)
pnpm test:integration # only the real-persistence suite
pnpm build            # tsc + tsdown + browser bundle -> lib/
pnpm test:e2e         # hermetic two-instance A2A smoke (needs a built plugin)
pnpm test:all         # typecheck + test + build + test:e2e
```

`pnpm test:e2e` needs:

- a built plugin (`pnpm build`); it fails fast with a clear message if
  `lib/index.js` is missing;
- a sibling `../deepseek-harness` checkout (`DSH_A2A_HARNESS_DIR` overrides)
  whose host artifacts are built (`pnpm install && pnpm run build`);
- nothing else: the model is the harness's own mock LLM server.

`DSH_A2A_KEEP=1` keeps the two temp homes, logs and child processes for
debugging.

## The e2e flow

`scripts/e2e-a2a.mjs` is hermetic and deterministic:

1. Two temp Harness homes (`a` and `b`) get a `web` profile (and `headless` for
   `a`) whose bundle list mounts the built plugin directly; no registry, no user
   home.
2. Each home starts a scripted mock LLM server
   (`@deepseek-ai/dsh-llm-mock-server`), and `dsh web` is pointed at it with
   `DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY`.
3. **Inbound:** create an inbound server on B, fetch its AgentCard, POST
   `SendMessage`, assert the artifact is the mock's text.
4. **Outbound:** create an outbound connection on A to B and assert it reports
   `connected` with at least one tool.
5. **Round trip:** stop A's web instance, run A's `headless` profile against a
   mock scripted to call `a2a__b__chat`, and assert stdout is B's reply. The
   task is written to the runner's stdin rather than passed on the command
   line: the profile mounts before the runner reads it, so the outbound
   reconnect has registered its tools before the first model request (see the
   cold-start limitation in [Harness compatibility](harness-compatibility.md)).
6. Tear down both homes and every child process.

## Visual test

`pnpm visual:a2a` boots the same hermetic pair and serves an interactive
dashboard at a printed loopback URL. It shows the two instances, the task
timeline, peers and sessions, with two buttons:

- **Inbound** sends a `SendMessage` straight to B's endpoint.
- **Outbound** runs A's headless model against a scripted tool call, which
  invokes `a2a__b__chat` and reaches B over A2A.

It is the same composition as the e2e, just interactive; it is for demos and
manual inspection, not a CI gate. `Ctrl+C` tears down every child and temp home.

## Adding a test

- **Behavior change** → a unit or composition test that fails without it.
- **New host contract surface** (a runtime service, a message shape, a storage
  field) → extend the mirror check if it has a structural mirror, and add a
  real-persistence or e2e assertion if it is only observable end to end.
- **New e2e step** → add it to `scripts/e2e-a2a.mjs` and keep it offline: the
  mock LLM server is the only model allowed in the default run.

## CI

`.github/workflows/ci.yml` runs `check` (typecheck, unit, composition and
real-persistence tests) on every push and pull request, and `e2e-pinned`
against `dsh-v0.2.2-rc.3`. The nightly schedule and manual dispatch run the e2e
matrix over the supported harness versions (`0.2.2-rc.3`, `0.2.2-rc.1`, `0.2.2-alpha.2`,
`0.2.1-rc.3`, `0.2.1-rc.2`, `0.2.1-alpha.2`, `0.1.7-rc.2`).

Widen the matrix in the same change that widens `peerDependencies`, and record
the result in [Harness compatibility](harness-compatibility.md).
