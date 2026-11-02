---
name: HTTP API and A2A protocol
description: Loopback dashboard actions, inbound JSON-RPC endpoints, SSE streaming, task states, error codes, AgentCard and outbound tool contract
update-time: 2026-10-25
---

# HTTP API and A2A protocol

**English** · [中文](http-api.zh.md)

This is the wire-level reference. It covers two separate surfaces:

1. the **loopback dashboard API** the panel uses (`/a2a/api`);
2. the **A2A endpoints** published by inbound servers (`/a2a/<id>`).

A remote A2A client can call an inbound endpoint but cannot drive the dashboard.

## 1. Dashboard API

Base path: `/a2a/api`, mounted on the profile web server. It accepts only
loopback peers (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`); any other peer gets
`403`. The POST body limit is a fixed 1 MB, independent of the A2A
`maxBodyBytes` setting.

### 1.1 Read endpoints

| Method and path | Returns |
|---|---|
| `GET /a2a/api` | Snapshot: `{ version, inbounds, outbounds, tasks, taskTotal, taskNextOffset, peers, sessions, metrics }` |
| `GET /a2a/api/presets` | Agent-preset roster: `[{ id, name?, description?, isDefault? }]` |
| `GET /a2a/api/models` | Routable model catalogue: `[{ provider, id, name }]` (empty when the host exposes no LLM service) |
| `GET /a2a/api/update` | Plugin version and update-check answer; `?refresh=1` bypasses the cache |
| `GET /a2a/api/card?id=<inbound>` | One inbound AgentCard; `404` when unknown |
| `GET /a2a/api/task?id=<task>` | One task; `404` when unknown |
| `GET /a2a/api/session?contextId=<id>&serverId=<instance>` | Derived conversation messages of one live context session; `409` when the context is ambiguous without `serverId` |
| `GET /a2a/api/metrics` | Metrics snapshot |

`GET /a2a/api/session` is a loopback-only debugging view. It returns the raw
derived DSH messages, which may include reasoning blocks; it is not part of the
A2A wire protocol and no reasoning is exposed there.

`GET /a2a/api` accepts `taskLimit` (default 50), `taskOffset`, `taskState`,
`taskContextId` and `taskServerId` to page the task list.

`version` is the installed plugin version, served from the snapshot so the
dashboard can render it before any network call. `outbounds[].agentVersion` is
the remote card's advertised version when the connection is live. In
`inbounds[]`, `cardUrl` is the advertised endpoint URL (from
`supportedInterfaces`); the card JSON itself is at `cardPath`.

Snapshot example (values abbreviated):

```json
{
  "version": "0.5.1",
  "inbounds": [
    {
      "id": "e2e-b-ade6a7ad",
      "name": "b-server",
      "description": "B inbound",
      "version": "0.1.0",
      "endpointPath": "/a2a/e2e-b-ade6a7ad",
      "preset": "standard",
      "cardPath": "/a2a/e2e-b-ade6a7ad/agent-card.json",
      "cardUrl": "http://127.0.0.1:3081/a2a/e2e-b-ade6a7ad",
      "enabled": true,
      "trace": false,
      "skills": [{ "id": "chat", "name": "chat", "description": "..." }]
    }
  ],
  "outbounds": [
    {
      "id": "out-2c6d9dbd-cf6",
      "name": "b",
      "agentCardUrl": "http://127.0.0.1:3081/a2a/e2e-b-ade6a7ad/agent-card.json",
      "enabled": true,
      "timeoutMs": 60000,
      "state": "connected",
      "skillCount": 1,
      "toolCount": 1,
      "agentVersion": "1.0.0"
    }
  ],
  "tasks": [],
  "taskTotal": 0,
  "taskNextOffset": null,
  "peers": [],
  "sessions": [],
  "metrics": {}
}
```

`GET /a2a/api/update` returns:

```json
{
  "ok": true,
  "current": "0.5.1",
  "latest": "0.5.2",
  "hasUpdate": true,
  "ahead": false,
  "error": null,
  "source": "npm",
  "repoUrl": "https://github.com/HanphoneJan/dsh-a2a",
  "packageName": "@hanphone/dsh-a2a",
  "checkedAt": 1790000000000,
  "cached": false,
  "runtime": { "node": "24.20.0", "platform": "linux", "arch": "x64", "profile": "web" }
}
```

It queries the npm registry's `latest` tag and the `package.json` in the GitHub
repository named by the plugin manifest, then keeps the higher version. The
answer is cached for six hours; `?refresh=1` bypasses the cache. `runtime`
carries the Node version, platform/arch, and the active DSH profile when the
host exports `DSH_PROFILE`. When no source answers, the endpoint still returns
`200` with `ok: false`, `latest: null` and an `error`. The check is read-only.

### 1.2 Control actions

`POST /a2a/api` with a JSON body whose `action` is one of the following.

#### Inbound

| Action | Required fields | Optional fields |
|---|---|---|
| `inbound.create` | `name`, `description`, `version` | `endpointPath`, `preset`, `authTokenEnv`, `trace`, `enabled`, `workspace`, `provider`, `model`, `baseUrl` |
| `inbound.update` | `id` | `name`, `description`, `version`, `endpointPath`, `preset`, `authTokenEnv`, `trace`, `workspace`, `provider`, `model`, `baseUrl` |
| `inbound.remove` | `id` | — |
| `inbound.enable` / `inbound.disable` | `id` | — |
| `inbound.setAuth` | `id` | `token` (omit or empty to clear) |
| `inbound.sendTest` | `id`, `text` | `contextId`, `skill` |
| `inbound.close` | `id` (peer id) | — |

`workspace` pins one inbound instance to a local working directory: it must be
an absolute path to an existing directory, and it is used as the `cwd` for every
agent session the instance opens. Omitted (or empty) means "inherit the
deployment working directory". The value only applies when a session is
created — contexts that already exist keep the `cwd` they were opened with, so
switch the context id if you change it.

`provider` / `model` pin one inbound instance to a specific model selection,
overriding the deployment default for that instance only. Both fields are
optional and independent; omitted (or empty) values fall back to the
deployment default model. Passing an empty string on `inbound.update` clears a
previously stored override.

`baseUrl` overrides the base URL advertised in this instance's agent card
(for example `http://192.168.31.20` or `https://companion.example.com`). Use it
when the server binds loopback behind a reverse proxy or tunnel and external
clients must call back through another address. It must be an absolute
`http(s)` URL without a path; a trailing slash is trimmed. Omitted (or empty)
means "inherit the deployment `baseUrl` config". Only the advertised URL
changes — the routes keep being served by the host web server.

The special value `auto` derives the advertised origin from each request's
`X-Forwarded-Host` (or `Host`) and `X-Forwarded-Proto` headers, so the card
always advertises the address the client actually used. This survives DHCP
changes and multiple front-door hostnames without reconfiguring the instance;
when no host header is present the deployment `baseUrl` is the fallback.

`inbound.sendTest` runs the same gate and task lifecycle as the wire endpoint
but bypasses HTTP auth; it is only reachable on loopback.

#### Deployment settings

| Action | Required fields | Optional fields |
|---|---|---|
| `settings.update` | — | `baseUrl` |

`settings.update` stores the deployment-wide advertised base URL in the plugin's
own `a2a` domain (so it survives restarts without editing the profile config)
and immediately re-assembles every live inbound instance. `baseUrl` accepts
`auto` (derive the origin from each request, like the per-instance sentinel), an
absolute `http(s)` origin to pin it, or an empty/omitted value to clear the
override and inherit the loader `baseUrl` config again.

The current mode is mirrored in the `GET /a2a/api` snapshot under `settings`:
`mode` is `inherit` (loader config), `auto` (per request) or `custom` (pinned),
`baseUrl` is the stored override when there is one, `effectiveBaseUrl` is what
cards advertise right now, and `configBaseUrl` is the loader value when set.

#### Outbound

| Action | Required fields | Optional fields |
|---|---|---|
| `outbound.create` | `name`, `agentCardUrl` | `bearerTokenEnv`, `preset`, `enabled`, `timeoutMs`, `disabledSkills`, `skillOverrides` |
| `outbound.update` | `id` | `name`, `preset`, `timeoutMs`, `disabledSkills`, `skillOverrides` |
| `outbound.remove` | `id` | — |
| `outbound.enable` / `outbound.disable` | `id` | — |
| `outbound.refresh` | `id` | — |
| `outbound.setAuth` | `id` | `token` (omit or empty to clear) |
| `outbound.discover` | `agentCardUrl` | `token` |

`outbound.update` does not change `agentCardUrl`; remove and create a new
connection to point at another card.

#### Tasks and sessions

| Action | Required fields | Effect |
|---|---|---|
| `task.cancel` | `id` (task id) | Aborts and marks the task canceled |
| `session.cancel` | `id` (context id) | Cancels the context's active tasks; optional `serverId` scopes it |
| `session.close` | `id` (context id) | Cancels active tasks and releases the live session handle; optional `serverId` |

### 1.3 Responses and status codes

A successful control action returns `200` with:

```json
{ "ok": true, "message": "inbound server \"b-server\" created", "id": "b-server-..." }
```

`inbound.create` and `outbound.create` include `id`; `outbound.discover`
includes a `preview` object with the remote name, version, description,
endpoint and skills. A failed action returns `409` with
`{ ok: false, message, ... }`.

| Status | Meaning |
|---|---|
| `200` | Action or read succeeded |
| `400` | Body is not valid JSON |
| `403` | Caller is not loopback |
| `404` | The requested card or task does not exist |
| `405` | Method other than `GET`/`POST` |
| `409` | Action failed, or the session is ambiguous |
| `413` | Request body exceeded the dashboard cap |

### 1.4 Examples

Create an inbound instance:

```sh
curl -sS -X POST http://127.0.0.1:3080/a2a/api \
  -H 'content-type: application/json' \
  -d '{
    "action": "inbound.create",
    "name": "reports",
    "description": "Reporting agent",
    "version": "0.1.0",
    "preset": "standard",
    "enabled": true
  }'
```

Set its bearer token:

```sh
curl -sS -X POST http://127.0.0.1:3080/a2a/api \
  -H 'content-type: application/json' \
  -d '{ "action": "inbound.setAuth", "id": "reports-1a2b3c4d", "token": "s3cr3t" }'
```

Discover a remote card without creating a connection:

```sh
curl -sS -X POST http://127.0.0.1:3080/a2a/api \
  -H 'content-type: application/json' \
  -d '{ "action": "outbound.discover", "agentCardUrl": "https://remote.example/a2a/x/agent-card.json" }'
```

Create the connection:

```sh
curl -sS -X POST http://127.0.0.1:3080/a2a/api \
  -H 'content-type: application/json' \
  -d '{
    "action": "outbound.create",
    "name": "remote",
    "agentCardUrl": "https://remote.example/a2a/x/agent-card.json",
    "timeoutMs": 60000
  }'
```

## 2. A2A endpoints

An inbound instance publishes:

| Path | Method | Purpose |
|---|---|---|
| `/a2a/<id>/agent-card.json` | `GET` | AgentCard JSON |
| `/a2a/<id>` | `POST` | JSON-RPC endpoint |

The endpoint path is the instance's `endpointPath` (default `/a2a/<id>`), and
the card path is that path plus `/agent-card.json`. Disabling the instance
unregisters both routes.

### 2.1 Authentication

Without a token, no `Authorization` header is required. With a token, every
request must send:

```http
Authorization: Bearer <token>
```

A missing or wrong token gets `401` with `WWW-Authenticate: Bearer`. Streaming
requests are authorized before the `200` SSE headers, so a `401` is still a
clean HTTP status.

The token is resolved when the instance is assembled; the credential model is
in [Operations](../guide/operations.md#access-and-security).

### 2.2 Methods

The endpoint speaks the A2A `1.0.1` JSON-RPC binding. Method names are
PascalCase.

| Method | Parameters | Behavior |
|---|---|---|
| `SendMessage` | `message`, `configuration?` | Creates or continues a task and waits until terminal/interrupted; returns `{task}` |
| `SendStreamingMessage` | `message`, `configuration?` | Creates or continues a task and streams frames; requires `Accept: text/event-stream` |
| `GetTask` | `id`, `historyLength?` | Returns one task |
| `ListTasks` | `contextId`, `status`, `pageSize`, `pageToken`, `statusTimestampAfter`, `includeArtifacts`, `historyLength` | Filtered, cursor-paged tasks sorted by most recent update; response includes `totalSize` |
| `CancelTask` | `id` | Cancels a non-terminal task; terminal tasks return `TASK_CANCEL_NOT_ALLOWED` |
| `SubscribeToTask` | `id` | Streams a non-terminal task; terminal tasks are rejected with `UNSUPPORTED_OPERATION`; supports `Last-Event-ID` replay within the process |
| `GetExtendedAgentCard` | none | Returns the same AgentCard |

Unsupported methods return `METHOD_NOT_FOUND`. Push-notification configuration
methods return `PUSH_NOTIFICATION_NOT_SUPPORTED` (`-32003`) because the card
advertises `capabilities.pushNotifications: false`.

### 2.3 Message shape

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "optional-uuid",
      "contextId": "optional-uuid",
      "role": "ROLE_USER",
      "parts": [{ "text": "hello" }],
      "metadata": { "skill": "chat" }
    }
  }
}
```

- `parts` may be text, file or data parts. Text and data parts enter the DSH
  prompt as text. A raw image/file part (`raw` plus `mediaType`/`filename`) is
  admitted through the host attachment store when it is mounted; a URL-only
  file part remains text (the server does not fetch remote URLs). Without the
  attachment store, raw parts become placeholders.
- `metadata.skill` selects the advertised skill; it defaults to `chat` and is
  rejected by the gate when not in the advertised set.
- `contextId` is the conversation key. Reusing it reuses the live DSH session;
  omitting it generates a new context.
- `messageId` is an idempotency key: resending the same id returns the original
  task instead of running a second turn. `taskId` continues an existing
  non-terminal task; terminal tasks reject further messages, and a message to a
  still-running task is rejected with `UNSUPPORTED_OPERATION`.
- `configuration.returnImmediately: true` returns after starting the task;
  otherwise `SendMessage` blocks. `configuration.historyLength` trims the
  returned history in both `SendMessage` and `SendStreamingMessage`: `0` returns
  none, unset means no limit. `Task.history` is the task's A2A-visible input and
  output messages, not the internal DSH transcript.
- `configuration.acceptedOutputModes` accepts text modes only; a request that
  excludes text gets `CONTENT_TYPE_NOT_SUPPORTED`.
- Every request may carry `A2A-Version` (header or query parameter). A major or
  minor mismatch returns `VERSION_NOT_SUPPORTED` (`-32007`); responses carry
  `A2A-Version: 1.0`.

### 2.4 Streaming

Send with `Accept: text/event-stream`:

```sh
curl -N http://127.0.0.1:3080/a2a/<id> \
  -H 'content-type: application/json' \
  -H 'accept: text/event-stream' \
  -d '{
    "jsonrpc": "2.0",
    "id": "2",
    "method": "SendStreamingMessage",
    "params": { "message": { "role": "ROLE_USER", "parts": [{ "text": "hello" }] } }
  }'
```

Each SSE event is a JSON-RPC result envelope. Status and artifact frames carry
an `id:` line for replay; the initial and final task snapshots do not.

```text
id: 7
data: {"jsonrpc":"2.0","id":2,"result":{"artifactUpdate":{...}}}
```

The first event is the current `task`; subsequent frames are `statusUpdate` and
`artifactUpdate`. Artifact chunks carry `append: true` when they extend an
artifact and replace it otherwise. Errors use the JSON-RPC error envelope
(`data: {"jsonrpc":"2.0","id":...,"error":{...}}`).

`SubscribeToTask` uses the same transport, starts with the current task, and
streams until the task settles (terminal or interrupted). A terminal task is
rejected with `UNSUPPORTED_OPERATION`. With `Last-Event-ID` the server sends the
current snapshot and replays only non-artifact frames, so append chunks are not
applied twice.

#### 2.4.1 What the stream contains

The default `session` executor projects live assistant text deltas as
`artifactUpdate` chunks under the `result` artifact (`lastChunk: false`) and
closes it with `lastChunk: true`. Tool activity is **not** an artifact. The
stream shape is:

- an initial `task` with the current state, task id and available history;
- zero or more `artifactUpdate` frames carrying visible assistant text;
- zero or more `statusUpdate` frames, optionally carrying trace metadata when
  the optional extension is active;
- the final `task` with the complete artifact set and settled history.

Reasoning deltas are never projected. Tool results are never projected. The
settled task is the source of truth.

Only text/plain output is advertised and produced by default. A turn that ends
without visible text settles `TASK_STATE_COMPLETED` with no `result` artifact
and a status message explaining that there was no visible output; it is not a
failure and it does not fall back to reasoning.

#### 2.4.2 Trace extension (opt-in)

`AgentCard.capabilities.extensions` may advertise the optional `dsh-trace/v1`
extension. It is **off** unless the instance policy allows it and the client
activates it with the standard request header:

```http
A2A-Extensions: https://github.com/hanphone/dsh-a2a/blob/main/docs/extensions/dsh-trace/v1.md
```

The response echoes the activated URI in `A2A-Extensions`. Trace data lives only
in `TaskStatusUpdateEvent.metadata` (live) and `Task.metadata` (bounded durable
summary); it never enters an artifact or history. It contains the tool name,
phase, status, duration and a redacted argument preview — never raw arguments,
tool results or reasoning. Clients that do not request the extension see no
change.

#### 2.4.3 Disconnect and reconnect

A client disconnect does **not** cancel the task. The executor runs to
completion and persists the task; the SSE subscription is only delivery.

- Capture the `taskId` from the first `task` frame. On reconnect, call `GetTask`
  to poll or `SubscribeToTask` to stream from the current status.
- Status and artifact frames carry an SSE `id:`. Reconnect with
  `SubscribeToTask` and `Last-Event-ID: <id>`: the server sends the current
  task, then replays status frames only. The log keeps 200 frames per task and
  is process-local.
- If the connection drops before a `SendMessage` response, retry with the same
  `messageId` (idempotent) or find the task with `ListTasks`. To continue an
  interrupted task, resend with its `taskId`.
- Reusing `contextId` continues the conversation; task resumption and
  conversation continuity are separate.
- A process restart keeps tasks and context bindings but not live sessions or
  SSE subscriptions. A task that was `TASK_STATE_WORKING` when the process died
  has no crash recovery and can remain stale in that state.

### 2.5 Task states

| State | Terminal? | Meaning |
|---|---|---|
| `TASK_STATE_SUBMITTED` | No | Task recorded, not started |
| `TASK_STATE_WORKING` | No | Executor running |
| `TASK_STATE_INPUT_REQUIRED` | No (interrupted) | Agent needs more input |
| `TASK_STATE_AUTH_REQUIRED` | No (interrupted) | Agent needs authentication |
| `TASK_STATE_COMPLETED` | Yes | Finished; may carry artifacts, or no artifact when there was no visible output |
| `TASK_STATE_FAILED` | Yes | Execution failed; the status message carries the error |
| `TASK_STATE_CANCELED` | Yes | Canceled by the caller or the session panel |
| `TASK_STATE_REJECTED` | Yes | Rejected before execution |

The inbound path produces `SUBMITTED`, `WORKING`, `COMPLETED`, `FAILED`,
`CANCELED`, `INPUT_REQUIRED` and `AUTH_REQUIRED`. `REJECTED` is part of the
vocabulary, but a gate rejection happens before the task is created, so no task
is recorded in that state.

### 2.6 Error codes

| Code | Name |
|---|---|
| `-32700` | `PARSE_ERROR` |
| `-32600` | `INVALID_REQUEST` |
| `-32601` | `METHOD_NOT_FOUND` |
| `-32602` | `INVALID_PARAMS` |
| `-32603` | `INTERNAL_ERROR` |
| `-32001` | `TASK_NOT_FOUND` |
| `-32002` | `TASK_CANCEL_NOT_ALLOWED` |
| `-32003` | `PUSH_NOTIFICATION_NOT_SUPPORTED` |
| `-32004` | `UNSUPPORTED_OPERATION` |
| `-32005` | `CONTENT_TYPE_NOT_SUPPORTED` |
| `-32006` | `STREAMING_NOT_SUPPORTED` |
| `-32007` | `VERSION_NOT_SUPPORTED` |
| `-32008` | `INVALID_AGENT_RESPONSE` |
| `-32040` | `UNAUTHORIZED` (HTTP 401 mapping) |

The implementation emits `INVALID_REQUEST`, `INVALID_PARAMS`,
`METHOD_NOT_FOUND`, `INTERNAL_ERROR`, `TASK_NOT_FOUND`,
`TASK_CANCEL_NOT_ALLOWED`, `PUSH_NOTIFICATION_NOT_SUPPORTED`,
`UNSUPPORTED_OPERATION`, `CONTENT_TYPE_NOT_SUPPORTED`, `VERSION_NOT_SUPPORTED`,
the `401` mapping, and `-32000` for rate-limit refusals and streaming gate
rejections. A non-streaming gate rejection uses `INVALID_PARAMS`; concurrency
and timeout failures settle the task `FAILED` instead of returning an RPC error.
`PARSE_ERROR`, `STREAMING_NOT_SUPPORTED` and `INVALID_AGENT_RESPONSE` are part
of the protocol table but are not emitted by the inbound dispatcher.

### 2.7 AgentCard

```json
{
  "name": "reports",
  "description": "Reporting agent",
  "version": "0.1.0",
  "provider": { "url": "https://deepseek.com", "organization": "DeepSeek" },
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "extendedAgentCard": true,
    "stateTransitionHistory": false,
    "extensions": [
      {
        "uri": "https://github.com/hanphone/dsh-a2a/blob/main/docs/extensions/dsh-trace/v1.md",
        "description": "Optional tool-call trace metadata.",
        "required": false
      }
    ]
  },
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "skills": [{ "id": "chat", "name": "chat", "description": "..." }],
  "supportedInterfaces": [
    {
      "url": "http://127.0.0.1:3080/a2a/<id>",
      "protocolBinding": "JSONRPC",
      "protocolVersion": "1.0"
    }
  ]
}
```

When the `attachments` service is mounted, `defaultInputModes` also advertises
the image types and `application/octet-stream`. With a bearer token the card
adds a `bearer` security scheme and requirement; it never carries the token
value.

The trace extension appears in `capabilities.extensions` only when the instance
policy allows it. It is optional (`required: false`), so generic clients can
ignore it.

## 3. Outbound tool contract

Each enabled remote skill becomes a model tool:

```text
a2a__<connection-name>__<skill-id>
```

Names are normalized to `[A-Za-z0-9_-]` and truncated to 64 characters; a
collision gets a short hash suffix. The argument schema is:

```json
{
  "prompt": "The task or instruction to send to the remote agent.",
  "taskId": "Optional. Continue an interrupted remote task."
}
```

`prompt` is required. The tool sends an A2A message with a stable per-caller
`contextId`, streams the remote turn when the card advertises streaming,
propagates the caller's abort (sending `CancelTask` once the task id is known),
and retries transient transport/5xx failures.

A `TASK_STATE_FAILED` task throws a tool error with the remote message.
Interrupted states are returned as text that includes the remote task id:

```text
[remote agent TASK_STATE_INPUT_REQUIRED task=<id>] <message>
```

so the model can call again with `taskId`. The tool renders the designated
`result` artifact when present; otherwise it takes **text parts only** from the
remaining non-diagnostic artifacts. Data parts from tool-call or trace artifacts
are never concatenated into the model-facing result. An empty result renders as
`(remote agent returned no output)`.

## 4. Current limits

These are intentional or known at `0.5.1`:

- `SendMessage` blocks by default; `configuration.returnImmediately: true`
  returns after starting the task. History is the task's A2A-visible input and
  output messages, not a full DSH turn-by-turn transcript.
- The trace extension is opt-in, metadata-only and bounded (64 observations per
  task, 200-character redacted argument preview). It is unavailable on the
  `subagent` executor's child tools.
- `acceptedOutputModes` accepts text modes only; a request that excludes text
  gets `CONTENT_TYPE_NOT_SUPPORTED`.
- Push notifications are not implemented; the push-config methods return
  `PUSH_NOTIFICATION_NOT_SUPPORTED` (`-32003`).
- Only the JSON-RPC binding is implemented (no gRPC or HTTP+JSON).
- No OAuth, mTLS or per-client credentials. Rate limiting is process-local,
  per source, and configurable; there is no distributed quota or billing.
- SSE event logs are in memory: `Last-Event-ID` recovery works across a
  reconnect to the same process, not across a restart.
- The outbound `preset` is persisted metadata; no local hand-off session is
  composed from it, and tools call the remote directly.
- The `subagent` executor exists but is not selected by the default skill map.
- A task that was `TASK_STATE_WORKING` when the process died has no crash
  recovery.
