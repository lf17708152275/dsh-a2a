# dsh-a2a

Agent2Agent (A2A) v1.0.1 dual-end plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — **English** · [中文](README.zh.md)

`@hanphone/dsh-a2a` publishes DeepSeek Harness agents over A2A and brings
remote A2A agents into DSH as model tools. Both directions are multi-instance
and are managed entirely from the Settings UI: instances live in the `a2a`
storage domain, not in a config file.

## What you get

- **Inbound servers.** Each instance has its own endpoint
  (`/a2a/<id>`), AgentCard, preset binding, auth token and enabled flag. Its
  skills are the model-invocable entries of that preset's skill directory, so
  there is no skill form to fill in.
- **Outbound connections.** Each connection has its own remote card URL, token,
  timeout and optional preset. Every enabled remote skill becomes a model tool
  named `a2a__<connection>__<skill>`.
- **A2A 1.0.1 JSON-RPC surface.** `SendMessage`, `SendStreamingMessage`,
  `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask` and
  `GetExtendedAgentCard`, including SSE catch-up and the official task-state
  and error vocabularies.
- **Durable tasks.** Tasks and context→session bindings survive restarts. Live
  sessions and SSE subscriptions do not.
- **Two executors.** `session` runs one turn on a per-context DSH session;
  `subagent` delegates to `ctx.subagents` when the agent loop and that service
  are mounted.
- **Governed and observable.** Inbound tasks pass through the
  `a2a/inbound-task` waterfall, and the dashboard shows peers, sessions, tasks,
  counters and an audit ring.
- **Credentials, not secrets in records.** The UI writes tokens through the
  harness credentials service; records keep only the generated environment
  variable name.
- **Version and update check.** The panel shows the installed version, the Node
  runtime and each card's version, and can check npm/GitHub for a newer release.

## Install

```sh
dsh plugin --profile web add @hanphone/dsh-a2a
```

Any profile name works. For a local tarball:

```sh
pnpm build
npm pack
dsh plugin --profile <name> add <path-to>/hanphone-dsh-a2a-<version>.tgz
```

Restart the web app after installing; the browser bundle is scanned at host
startup.

## Quick start

1. Restart DSH and open **Settings → A2A 连接**.
2. Create an inbound server: pick a name, a preset and optionally a bearer
   token. The endpoint and card are live immediately. Each preset option shows
   how many plugins it mounts, and expanding **capabilities** lists them (with
   friendly names); the same chips appear on the instance card, so you always
   know what an A2A session from that endpoint can do.
3. Add an outbound connection: paste a remote AgentCard URL, click **Import**,
   review the discovered skills, then **Connect**.

The [getting-started guide](docs/guide/getting-started.md) walks through both
directions with `curl` examples. The exact payloads are in the
[HTTP API reference](docs/reference/http-api.md).

## Documentation

| Document | Answers |
|---|---|
| [Getting started](docs/guide/getting-started.md) | How do I install it, publish an agent and call a remote one? |
| [Concepts](docs/guide/concepts.md) | What are instances, presets, skills, tasks, contexts and executors? |
| [Operations](docs/guide/operations.md) | How do the panel and `/a2a` command work, and how do I configure storage and access? |
| [HTTP API](docs/reference/http-api.md) | What does the dashboard API expose, and what is the wire protocol? |
| [Troubleshooting](docs/guide/troubleshooting.md) | Why is a reply empty, a connection failed or a tool missing? |
| [Architecture](docs/architecture.md) | How are the host half, managers, stores and browser half put together? |
| [Harness compatibility](docs/harness-compatibility.md) | How do I move the plugin to another DSH release? |
| [Testing](docs/testing.md) | Which test layer catches which breakage? |

The manual describes `0.5.1` against DeepSeek Harness `0.2.1-rc.3`; ranges and
the verification record are in
[harness compatibility](docs/harness-compatibility.md).

## Development

The plugin typechecks against a sibling harness checkout through TypeScript
project references, so a built `../deepseek-harness` is required.

```sh
pnpm typecheck   # host + client + compile-time mirror check
pnpm test        # unit + composition + real-persistence tests
pnpm build       # lib/index.js (host) + lib/client.js (browser)
pnpm test:e2e    # two-instance A2A smoke against the built artifact
pnpm test:all    # all of the above
```

Testing layers and their limits are described in [Testing](docs/testing.md).

## License

MIT
