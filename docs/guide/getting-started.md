---
name: Getting started
description: Install the plugin, publish an inbound A2A server, call it, and connect a remote A2A agent as a model tool
update-time: 2026-11-18
---

# Getting started

**English** · [中文](getting-started.zh.md)

This walkthrough takes a fresh install to two working directions: an A2A client
calling this DSH, and this DSH calling a remote agent. Field-level details for
the forms are in [Operations](operations.md#the-panel); the full wire format
is in the [HTTP API reference](../reference/http-api.md).

## Before you start

You need DeepSeek Harness `0.2.2-rc.3` (the verified version; other supported
0.2.x releases remain in the compatibility matrix) and a running web app,
normally at `http://127.0.0.1:3080/`. The base `web` profile mounts every service
the plugin uses; for a custom composition see
[host services](operations.md#host-services).

## Install and verify

```sh
dsh plugin --profile web add @hanphone/dsh-a2a
```

From a harness checkout, use its launcher:

```sh
cd deepseek-harness
pnpm dsh plugin --profile web add @hanphone/dsh-a2a
```

Restart the web app (`dsh web`, or `pnpm dsh web`). A page refresh is not
enough: the browser bundle is scanned when the host starts.

Verify the plugin is mounted:

```text
/a2a status
```

The command returns a JSON snapshot with `inbounds` and `outbounds`. The same
snapshot is at `GET http://127.0.0.1:3080/a2a/api`.

## Publish an inbound server

Open **Settings → A2A 连接 → 入站 Servers**, fill the create form (name, version,
preset, optional bearer token, description) and submit. The instance is enabled
and publishes:

```text
http://127.0.0.1:3080/a2a/<id>
http://127.0.0.1:3080/a2a/<id>/agent-card.json
```

You do not type skills. The card advertises the model-invocable entries of the
selected preset's skill directory; if that cannot be resolved, it falls back to
the built-in `chat` skill.

Read the card:

```sh
curl -sS http://127.0.0.1:3080/a2a/<id>/agent-card.json
```

The response is an A2A `AgentCard` with `name`, `version`,
`supportedInterfaces`, `capabilities` and `skills`. A bearer-protected server
also declares the `bearer` scheme; the token value is never in the card.

Send a task:

```sh
curl -sS http://127.0.0.1:3080/a2a/<id> \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "SendMessage",
    "params": {
      "message": {
        "role": "ROLE_USER",
        "parts": [{ "text": "Reply with exactly OK" }],
        "metadata": { "skill": "chat" }
      }
    }
  }'
```

`SendMessage` blocks until the task settles. A successful response carries a
task in `TASK_STATE_COMPLETED`; the visible reply is the `result` artifact.
Tool calls, tool results and reasoning are not artifacts. Reuse the same
`contextId` to continue one conversation; reuse the same `messageId` to retry
idempotently.

To receive progress instead of waiting, send `SendStreamingMessage` with
`Accept: text/event-stream` and `curl -N`; for an already created task, use
`SubscribeToTask`. The method table and frame vocabulary are in
[HTTP API: A2A endpoints](../reference/http-api.md#2-a2a-endpoints).

If the instance has a bearer token, add this header to every call:

```sh
-H 'authorization: Bearer <token>'
```

## Connect a remote agent

You need the remote agent's AgentCard URL, plus a token if the remote requires
one.

In **Settings → A2A 连接 → 出站 Servers**:

1. Paste the AgentCard URL (and token) and click **Import**.
2. Review the discovered name, version, description, endpoint and skills.
3. Confirm the local name, preset and timeout, then click **Connect**.

A connected card shows its state, imported skill count and registered tool
count. Each enabled remote skill becomes a model tool:

```text
a2a__<connection-name>__<skill-id>
```

For a connection named `weather` and a remote skill `chat`, the tool is
`a2a__weather__chat`. Its arguments are:

```json
{
  "prompt": "the task or instruction to send to the remote agent",
  "taskId": "optional: continue an interrupted remote task"
}
```

Ask the model to use it:

```text
Use the a2a__weather__chat tool with prompt "Reply with exactly OK" and show
the result verbatim.
```

A failed remote task raises a tool error with the remote message;
`INPUT_REQUIRED` and `AUTH_REQUIRED` are returned as text that includes the
remote `taskId`, so the model can continue with that id.

## Check both directions

```text
/a2a inbound list
/a2a outbound list
/a2a tasks
/a2a sessions
```

The panel's **连接与任务** tab shows the same data as tables of peers, sessions
and tasks, with cancel and close actions.

Next: [Concepts](concepts.md) explains what the instances, presets and sessions
mean; [Operations](operations.md) covers the panel and configuration;
[Troubleshooting](troubleshooting.md) covers empty replies, 401s and failed
connections.
