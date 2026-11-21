---
name: Troubleshooting
description: Diagnose empty replies, 401s, unreachable cards, failed outbound connections, missing tools, version refusals and storage conflicts
update-time: 2026-11-18
---

# Troubleshooting

**English** · [中文](troubleshooting.zh.md)

Work through these in order; each step narrows the layer:

1. **Plugin mounted?** `/a2a status` returns a snapshot.
2. **Instance exists and is enabled?** `/a2a inbound list` / `outbound list`.
3. **Card reachable?** `curl <cardUrl>`.
4. **Protocol reachable?** `SendMessage` with a tiny prompt.
5. **Task state?** `/a2a tasks`, `/a2a task get <id>`.
6. **Logs?** The DSH host log and, for the conversation, `$DSH_HOME/sessions`.
7. **Version mismatch?** See §7.

## A task completes without a visible reply

A `TASK_STATE_COMPLETED` task with the status message
`The agent completed without visible output.` means the turn ended normally but
produced no visible assistant text (for example, it only called tools). This is
not a failure, it has no `result` artifact, and it never falls back to
reasoning. Read the task and its status message:

```text
/a2a task get <taskId>
```

If you expected text, check:

1. In **连接与任务 → 入站会话**, find the `contextId` and whether it is running
   or idle.
2. The preset's model provider: an unauthenticated or misconfigured provider can
   produce an empty assistant message. Verify the same preset in a normal DSH
   session.
3. `a2a` warnings in the host log and `$DSH_HOME/sessions/...` for the
   `a2a-<instanceId>-<contextId>` session.

A genuine provider or executor error still settles `TASK_STATE_FAILED`; its
status message carries the error.

If the task is `TASK_STATE_CANCELED`, the caller or the panel canceled it; start
a new task on the same context to reopen the session.

## An inbound request returns 401

The instance has a bearer token and the request does not match it.

- Send `Authorization: Bearer <token>`.
- The token is read when the instance is assembled (add, update, boot,
  `setAuth`), from the credentials service then the process environment. Check
  the managed name:
  - inbound: `A2A_INBOUND_<ID>` (uppercased, non-alphanumerics replaced by `_`);
  - outbound: `A2A_OUTBOUND_<ID>`.
- The inbound card shows whether auth is configured. Use **Edit** to set a new
  token or **Clear auth** to remove it.
- Streaming requests are authorized before the `200`; a `401` is a clean status,
  not a broken stream.

## The AgentCard returns 404 or the connection is refused

- The instance may be **disabled**: `/a2a inbound list` and the panel show the
  enabled state. Enable it and retry.
- Use the **per-instance** card path printed by the panel
  (`/a2a/<id>/agent-card.json`). The well-known
  `/.well-known/agent-card.json` is not used for instances.
- Confirm the web server is listening on the address you are calling:
  ```sh
  curl -v http://127.0.0.1:3080/a2a/<id>/agent-card.json
  ```
- If the URL uses a public or reverse-proxy host, confirm the proxy forwards the
  `/a2a/` prefix and preserves the `Host` header the web app expects.

## An outbound connection is `failed`

The panel shows `lastError`; common causes:

| Symptom | Check |
|---|---|
| `HTTP 401` | The remote requires a token; edit the connection and set it |
| `HTTP 404` | Wrong card URL; use the remote's full per-instance card path |
| `invalid agent card` | The URL returns HTML or non-card JSON; verify content type and shape |
| `advertises no JSON-RPC interface` | The card has no usable interface URL |
| timeout | Raise the connection's `timeoutMs` or check network reachability |
| TLS/DNS error | Check the remote certificate/hostname and local network |

After fixing, click **Refresh** (or call `outbound.refresh`). A failed record is
kept so you can edit it; deleting and re-adding is not required.

## A remote skill is missing or the model does not call the tool

- Confirm the connection is `connected` with `skillCount > 0` and
  `toolCount > 0`. A card with zero skills registers zero tools by design.
- Tool names are `a2a__<connection-name>__<skill-id>`, normalized to
  `[A-Za-z0-9_-]` and truncated to 64 characters. If the remote name has spaces
  or punctuation, inspect the registered name in the model's tool list.
- The argument is an object with `prompt` (required) and optional `taskId`, not a
  bare string.
- A renamed connection changes the tool prefix. Refresh or re-edit after
  renaming.
- The connection's **Edit** form can disable individual skills; check that the
  skill is enabled.
- If the connection was disabled when the plugin started, enabling it only
  marks the record; save an edit (or restart) to build the connection.

## A tool call returns a remote error

The remote task settled failed or interrupted. Read the returned text:

- `Remote agent task failed: ...` — the remote reported `TASK_STATE_FAILED`.
- `[remote agent TASK_STATE_INPUT_REQUIRED task=<id>] ...` — the remote needs
  more input; call again with that `taskId` and a follow-up prompt.
- `[remote agent TASK_STATE_AUTH_REQUIRED task=<id>] ...` — update the
  connection token.
- `(remote agent returned no output)` — the remote completed with no artifacts.

## The plugin is not loaded: `incompatible-version`

DSH 0.1.7+ checks the plugin's `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*`
peer ranges before importing it. A refusal means the running harness is outside
the declared ranges.

- Upgrade the plugin and/or the harness to a supported pair.
- Check the exact ranges in `package.json` and the record in
  [Harness compatibility](../harness-compatibility.md).
- `dsh plugin allow-version ... --accept-risk` is an explicit, exact-version
  exemption for an emergency; it is not a substitute for testing.
- Do not widen peer ranges without running the compatibility procedure.

## Two DSH processes fight over storage

The `a2a` domain is a single store rooted at `DSH_HOME` (JSON by default). Two
processes sharing a home write the same domain and can overwrite each other's
instances and tasks. Run one writer per `DSH_HOME`; use separate homes and ports
for two-instance tests.

## Streaming behaves oddly

- Streaming requires `Accept: text/event-stream` on the `POST`. Without it, the
  server handles the request as non-streaming JSON-RPC.
- Only `SendStreamingMessage` and `SubscribeToTask` are valid on the streaming
  path; other methods return a method-not-found frame.
- `SendMessage` is handled only on the non-streaming path. Choose
  `SendStreamingMessage` or `SubscribeToTask` when you want SSE; sending
  `SendMessage` with `Accept: text/event-stream` returns a method-not-found
  frame. Frames are `data:` lines, so use `curl -N`.
- A disconnect does not cancel the task; reconnect with `SubscribeToTask` and
  `Last-Event-ID` for status replay. See
  [HTTP API: streaming](../reference/http-api.md#24-streaming).

## What to include in a bug report

- Plugin version (`0.5.5`), harness version and OS.
- The exact command or panel action.
- The task JSON (`/a2a task get <id>`) and the AgentCard.
- Whether the inbound instance has auth, and whether the request carried the
  header (never paste the token).
- The relevant host log lines and, if the session is the suspect, the
  `a2a-<instanceId>-<contextId>` session log path.
- For outbound, the remote card URL shape (redact the host if needed) and the
  `lastError` text.

The layers that guard these paths are described in [Testing](../testing.md).
If you contribute a fix, add the failing assertion to the layer that can see it:
mirror check for a type contract, real-persistence integration for a durable
shape, or the e2e smoke for a released-artifact path.
