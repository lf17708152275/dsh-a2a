---
name: Operations
description: Panel and /a2a reference, lifecycle, configuration, host services, storage and access
update-time: 2026-10-25
---

# Operations

**English** · [中文](operations.zh.md)

This is the day-to-day reference: where the controls are, what each field does,
how instances behave across restarts, and how to configure storage and access.
Wire-level details live in the [HTTP API reference](../reference/http-api.md).

## Control surfaces

Three surfaces drive the same facade, so they cannot disagree about state:

| Surface | Use it for |
|---|---|
| **Settings → A2A 连接** | Primary UI: create, edit, enable, disable and delete; inspect peers, sessions and tasks |
| **`/a2a` command** | Text backup inside a DSH chat session |
| **Loopback `/a2a/api`** | Scripts, tests and integrations; see [HTTP API](../reference/http-api.md#1-dashboard-api) |

The panel refreshes every three seconds.

## The panel

### Version and update strip

Above the tabs the panel shows the installed plugin version, the Node
runtime, and the result of an update check. The check queries the npm registry
and the GitHub repository from `package.json`, keeps the higher version, and
reports one of: up to date, a newer version, or "could not check". A failed
lookup is never shown as up to date. The answer is cached for six hours; the
button forces a refresh.

When a newer version exists, the panel prints the two-step update command
(`remove`, then `add`) for the active profile with a copy button. Checking is
read-only: it does not install, restart or modify the profile.

Inbound cards also show the version the instance advertises, and outbound cards
show the remote card's version once connected.

### Inbound servers

Each card shows the name, endpoint path, preset badge, auth state, derived skill
chips and the live card URL. Actions:

| Action | Effect |
|---|---|
| **Enable / Disable** | Registers or unregisters the card and endpoint routes; the record and session pool stay |
| **Card** | Opens the current AgentCard JSON |
| **Test** | Sends a message through the built-in console (same gate and task lifecycle, no HTTP auth) |
| **Edit** | Changes name, description, version, preset or token; re-derives skills and swaps the live instance |
| **Delete** | Disposes the live instance and removes the persisted record |
| **Clear auth** | Appears on an authenticated instance; removes the stored token and rebuilds it anonymously |

The create/edit form has name, version, preset, workspace, advertised base URL,
provider, model, bearer token and description. `workspace` (absolute path to an
existing directory) pins that instance's agent sessions to a local project;
`provider` and `model` pin its model selection; the advertised base URL changes
the address written into this instance's agent card so external A2A clients call
back through a reachable host (type `auto` to derive it from each request's
forwarded host). All four are optional and inherit the deployment default when
left empty.
Skills are shown after creation; you do not type them. The preset picker lists
the real roster and preselects the deployment default.

At the top of the inbound tab, **Deployment settings · advertised URL** sets the
deployment-wide advertised base URL without editing the profile config: *follow
the plugin config*, *auto* (derive it from each request's forwarded host) or
one of the local origins discovered on this host (each non-internal IPv4
interface, listed in the dropdown), falling back to *custom URL* for anything
else. The choice is stored in the plugin's own domain and applied immediately
(live instances are re-assembled, no restart); per-instance overrides still win
over it. `auto` is only as good as the incoming `Host`/`X-Forwarded-Host`
header: behind a reverse proxy that rewrites `Host` (and does not forward the
original one), pick the LAN origin explicitly.

The test console selects an instance, a skill, an optional `contextId` and a
message, then shows the resulting task JSON.

### Outbound servers

Adding is a two-phase flow:

1. Enter the remote AgentCard URL (and optional token), click **Import**.
2. Review the discovered name, version, description, endpoint and skills,
   adjust the local name, preset and timeout, click **Connect**.

A connected card shows a state dot, the remote AgentCard version, the imported
skill count, the tool count and `lastError` when failed. Actions:

- **Enable / Disable** — deregisters or re-registers tools for a live
  connection. An instance that was disabled when the plugin booted has no live
  connection yet; save an edit (or restart) to build it.
- **Refresh** — re-reads the card and re-registers tools.
- **Edit** — changes name, preset, timeout, token and per-skill enablement; the
  remote card URL is not changed by an edit (remove and re-add for that).
- **Delete** — disposes the connection and removes the record.

The edit form can disable individual skills and accepts a JSON
`skillOverrides` object (`{"chat": {"name": "...", "description": "..."}}`).

A token is stored through the credentials service. Leaving the token field empty
keeps the existing one. The inbound form has **Clear auth**; the outbound form
has no clear button — send an empty `token` through `outbound.setAuth` to
remove it.

### Connections and tasks

The activity tab has counters and an audit table (last 20 entries), then three
tables:

- **Inbound peers** — who is calling this DSH: source, task and active counts,
  streaming indicator, first/last seen, **Close**.
- **Inbound sessions** — one row per `(instance, contextId)`: instance, preset,
  running or idle, task and active counts, streaming, first/last seen,
  **Cancel active**, **Conversation**, **Close**.
- **Tasks** — one page of 50 tasks (filterable by state, with **Load more**):
  id, skill, source instance, state, **Cancel**.

Semantics:

- **Cancel active** aborts every non-terminal task of the context; the session
  stays open.
- **Close** additionally releases the context's live session handle. It is a
  resource release, not a conversation tombstone: the next task on the same
  context opens a fresh handle.
- **Close** on a peer cancels its active tasks and drops its registry entry; it
  does not delete task records.

## `/a2a` command

The command is available in a DSH chat session. List and status verbs print
JSON.

| Command | Purpose |
|---|---|
| `/a2a status` | Whole-plugin snapshot |
| `/a2a presets` | Agent-preset roster |
| `/a2a inbound list` | Inbound instances |
| `/a2a inbound create <name> [preset] [description]` | Create an inbound instance |
| `/a2a inbound remove <id>` | Remove it |
| `/a2a inbound enable\|disable <id>` | Toggle its routes |
| `/a2a outbound list` | Outbound instances |
| `/a2a outbound create <agentCardUrl> [name] [preset]` | Create an outbound connection |
| `/a2a outbound remove <id>` | Remove it |
| `/a2a outbound enable\|disable <id>` | Toggle it |
| `/a2a outbound refresh <id>` | Re-read the remote card |
| `/a2a tasks` | Latest 50 tasks |
| `/a2a task get <taskId>` | One task |
| `/a2a task cancel <taskId>` | Cancel a task |
| `/a2a sessions` | Per-context session views |
| `/a2a session cancel <contextId>` | Cancel the context's active tasks |
| `/a2a session close <contextId>` | Release the context's live session |
| `/a2a peers` | Inbound peer registry |
| `/a2a help` | Usage text |

Arguments are whitespace-separated. The inbound description is the remaining
words after the optional preset; use the panel or HTTP API for richer fields.

## Lifecycle

- **Create** persists the record, derives skills, resolves auth, assembles the
  runtime and registers routes when enabled.
- **Update** persists the patch, re-derives skills (the preset may have
  changed), re-resolves auth and replaces the live instance while preserving
  the enabled state.
- **Enable / Disable** registers or unregisters routes and persists the enabled
  flag. The record, skills and session pool remain; disabled instances are
  assembled at boot but not routed.
- **Remove** disposes the live instance and writes an empty tombstone row; the
  instance does not reappear on restart.
- **Outbound connect** saves the record before the connect attempt, fetches the
  card, registers one tool per enabled skill and records `lastCardAt`.
- **Outbound refresh** rebuilds the registry from the card and re-registers
  tools. **Edit** persists the patch and rebuilds the connection; if it is
  enabled, it also reconnects with the stored token.
- **Restart** reassembles persisted inbound and outbound instances; enabled ones
  resume. Live sessions and stream subscriptions are not restored.

## Configuration

Instances are **not** configured in `cordis.patch.yml`; they live in the `a2a`
domain and are managed by the panel. The plugin `Config` carries host-level
defaults, set through the profile's user patch layer
(`$DSH_HOME/profiles/<name>/cordis.patch.yml`) to override them:

```yaml
- id: a2a
  config:
    baseUrl: http://127.0.0.1:3080   # optional; derived from webServer when omitted
    subagentProvider: in-process
    defaultTimeoutMs: 60000
    inboundTimeoutMs: 600000
    requestsPerMinute: 120
    maxConcurrentTasks: 32
    maxBodyBytes: 1048576
    outboundRefreshMs: 300000
    inboundTrace: false
```

| Field | Default | Meaning |
|---|---|---|
| `baseUrl` | web server port, then `DSH_A2A_PORT`, then `3000` | Advertised base URL for every inbound AgentCard |
| `subagentProvider` | `in-process` | Provider name for the subagent executor |
| `defaultTimeoutMs` | `60000` | Default per-call timeout for outbound connections |
| `inboundTimeoutMs` | `600000` | Per-task inbound execution budget; a timeout settles the task `FAILED`; `0` disables it |
| `requestsPerMinute` | `120` | Sliding-window request cap per inbound source; over-limit gets HTTP 429; `0` disables it |
| `maxConcurrentTasks` | `32` | Concurrent task cap per inbound instance; over-quota tasks fail readably; `0` disables it |
| `maxBodyBytes` | `1048576` | Maximum inbound A2A request body |
| `outboundRefreshMs` | `300000` | Automatic AgentCard refresh interval for enabled outbound connections; `0` disables it |
| `inboundTrace` | `false` | Deployment gate/default for the optional inbound trace extension; when false no instance can activate it |

The inbound session working directory is `$DSH_HOME/a2a-sessions` (created at
startup). `DSH_HOME` defaults to `~/.dsh`.

## Host services

Only `storageDomain` is required. Everything else is probed; a missing service
idles the affected capability instead of failing the plugin.

| Service | Used by | Effect when absent |
|---|---|---|
| `storageDomain` | both halves | Required; the plugin does not mount |
| `webServer` | inbound routes, dashboard API | Inbound endpoints/cards and the panel API are idle |
| `agents` | inbound session executor | Inbound tasks run a `refuse` executor |
| `attachments` | inbound image/file parts, advertised input modes | Raw attachments degrade to placeholders; the card advertises text only |
| `agentPresets` | preset selection, skill derivation | Preset selection is unavailable; derived skills fall back to `chat` |
| `skills` | skill derivation | The card falls back to `chat` |
| `credentials` | token storage and resolution | GUI token writes fail; externally exported env vars still work |
| `subagents` | subagent executor | The subagent executor is not wired |
| `agentDefaultModel` | model options for inbound sessions | Sessions use the harness default |
| `tools` | outbound tool registration | Outbound connections connect but register no tools |
| `commands` | `/a2a` | The chat command is not registered |

The base `web` profile mounts all of these. A custom composition should include
`storageDomain`, `webServer`, `agents`, `agentPresets`, `skills`, `tools` and
`commands`; add `attachments`, `credentials`, `subagents` and `agentDefaultModel`
for those capabilities.

## Storage

Durable state is the `a2a` storage domain:

| Table | Contents |
|---|---|
| `tasks` | Task records, including the source instance id |
| `contexts` | Context id → session id bindings |
| `agents` | Per-outbound-instance agent records (key `out:<id>`) |
| `inbound_servers` | Inbound instance records (key `in:<id>`) |
| `outbound_servers` | Outbound instance records (key `out:<id>`) |

The domain uses the profile's JSON backend by default. To route only `a2a` to
SQLite:

```yaml
- id: storage-domain
  config:
    backend: json
    routes:
      a2a: sqlite
- insert:
    - id: storage-sqlite
      name: '@deepseek-ai/dsh-storage-sqlite'
      config:
        path: /absolute/path/to/a2a.sqlite
```

Operational notes:

- **One writer per `DSH_HOME`.** Two DSH processes sharing a home write the same
  JSON domain; use separate homes and ports for two-instance tests.
- **Tasks and instances persist.** Live sessions, stream subscriptions and peer
  registries are in memory and reset on restart.
- **Task records grow with history and trace.** Each accepted input message is
  retained for `Task.history`; the optional trace summary keeps at most 64
  observations. Large attachments and long continuations therefore increase the
  domain record size; plan retention/backup accordingly.
- **The domain stores JSON strings.** Schema changes are guarded by the domain's
  `version` field. Back up the JSON/SQLite file before upgrades.
- **Session logs** are written under `$DSH_HOME/sessions/...` by the normal DSH
  session persistence; the plugin's working directory is
  `$DSH_HOME/a2a-sessions`.

## Access and security

- **The dashboard API is loopback-only by construction.** `/a2a/api` accepts
  only `127.0.0.1`, `::1` or `::ffff:127.0.0.1`; any other peer gets `403`.
  Putting the web app behind a reverse proxy does not make it remotely callable.
- **A2A endpoints ride the same web server as the GUI.** If you expose that
  server to a network, configure a bearer token on every inbound instance and
  terminate TLS at the proxy. The plugin adds no TLS; request, body and
  concurrency limits are process-local, not a distributed quota.
- **Tokens are credential references.** The panel writes each token through
  `ctx.credentials.set` under `A2A_INBOUND_<ID>` or `A2A_OUTBOUND_<ID>`
  (uppercased, non-alphanumerics replaced by `_`). The record keeps only the
  name; the card stores only the scheme, and the panel never echoes the value
  back. Resolution runs when an instance is assembled (add, update, boot and
  `setAuth`), reading the credentials service first and the process environment
  second.
- **Inbound auth.** With a token configured, every request needs
  `Authorization: Bearer <token>`, otherwise `401` with `WWW-Authenticate:
  Bearer`. Streaming requests are authorized before the `200` SSE headers.
- Use a distinct token per inbound instance so one leak does not grant access to
  every published agent. Changing a token in the panel rebuilds that instance
  immediately; an externally exported variable is read the next time the
  instance is assembled.
- There is no OAuth, mTLS or per-client credential model.
- **Trace is opt-in and metadata-only.** `inboundTrace: true` is a deployment
  gate; an instance must also allow the extension, and a caller must request it
  with `A2A-Extensions`. Any caller that can read the task can see the bounded
  summary in `Task.metadata`, so enable it only for trusted peers. Raw tool
  arguments, tool results and reasoning are never included; argument previews
  are redacted and truncated. Disable the deployment gate and reload to
  remove the extension from every card.

## Upgrade and uninstall

```sh
dsh plugin --profile web add @hanphone/dsh-a2a@latest
```

Restart `dsh web` after installing. Instances and tasks live in the domain and
survive the upgrade; live sessions do not.

```sh
dsh plugin --profile web remove @hanphone/dsh-a2a
```

Removing the plugin leaves the `a2a` domain data in place. Delete the domain rows
or the storage file only if you intend to discard instance definitions and task
history.

Moving to another harness release is covered in
[Harness compatibility](../harness-compatibility.md).
