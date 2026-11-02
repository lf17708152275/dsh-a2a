---
name: HTTP API 与 A2A 协议
description: 回环面板动作、入站 JSON-RPC 端点、SSE 流式、任务状态、错误码、AgentCard 与出站工具契约
update-time: 2026-10-25
---

# HTTP API 与 A2A 协议

[English](http-api.md) · **中文**

本页是线上参考，覆盖两个互相独立的界面：

1. 面板使用的**仅回环面板 API**（`/a2a/api`）；
2. 入站 server 发布的 **A2A 端点**（`/a2a/<id>`）。

远端 A2A 客户端能调用入站端点，但驱动不了面板。

## 1. 面板 API

基础路径 `/a2a/api`，挂在 profile 的 web server 上。只接受回环来源
（`127.0.0.1`、`::1`、`::ffff:127.0.0.1`），其他来源返回 `403`。POST 请求体上限
固定为 1 MB，与 A2A 的 `maxBodyBytes` 配置无关。

### 1.1 读端点

| 方法与路径 | 返回 |
|---|---|
| `GET /a2a/api` | 快照：`{ version, inbounds, outbounds, tasks, taskTotal, taskNextOffset, peers, sessions, metrics }` |
| `GET /a2a/api/presets` | Agent preset 名单 + 每个预设会挂载的插件：`[{ id, name?, description?, isDefault?, broken?, plugins?: [{ entryId, module, label?, hint?, enabled, condition? }] }]` |
| `GET /a2a/api/models` | 可路由模型清单：`[{ provider, id, name }]`（宿主没有 LLM 服务时返回空数组） |
| `GET /a2a/api/update` | 插件版本与更新检查结果；`?refresh=1` 跳过缓存 |
| `GET /a2a/api/card?id=<inbound>` | 一个入站 AgentCard；未知 id 返回 `404` |
| `GET /a2a/api/task?id=<task>` | 一条任务；未知 id 返回 `404` |
| `GET /a2a/api/session?contextId=<id>&serverId=<instance>` | 某个活跃上下文会话的派生对话消息；不带 `serverId` 且上下文有歧义时返回 `409` |
| `GET /a2a/api/metrics` | 指标快照 |

`GET /a2a/api/presets` 回答"A2A 会话实际会带哪些插件"：`plugins` 是该预设按声明顺序
组合出来的插件行；`label`/`hint` 是常见模块的中文名与一句说明（`module` 原始名始终保留）；`enabled` 为 `true`/`false`，`!!js` 条件行为 `'conditional'` 并附带
`condition` 源码；`broken` 表示宿主没能组合出该预设。宿主无法枚举组合时该数组为空，
预设选择仍然可用。

`GET /a2a/api/session` 是仅回环的调试视图。它返回原始派生 DSH 消息，可能包含
reasoning block；它不是 A2A 线协议的一部分，也不会通过 A2A 暴露 reasoning。

`GET /a2a/api` 接受 `taskLimit`（默认 50）、`taskOffset`、`taskState`、
`taskContextId`、`taskServerId` 来分页任务列表。

`version` 是已安装的插件版本，随快照返回，让面板在任何网络调用之前就能显示。
`outbounds[].agentVersion` 是连接存活时远端卡片宣告的版本。`inbounds[]` 里的
`cardUrl` 是宣告的端点 URL（来自 `supportedInterfaces`），卡片 JSON 本身在
`cardPath`。

快照示例（值有省略）：

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

`GET /a2a/api/update` 返回：

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

它查询 npm registry 的 `latest` 标签与插件 manifest 中 GitHub 仓库的
`package.json`，取较高版本。结果缓存 6 小时；`?refresh=1` 跳过缓存。`runtime`
带 Node 版本、平台/架构，以及宿主导出 `DSH_PROFILE` 时的当前 profile。所有源都
失败时，端点仍返回 `200`，但 `ok: false`、`latest: null` 并带 `error`。检查是只读的。

### 1.2 控制动作

`POST /a2a/api`，JSON body 的 `action` 为下列之一。

#### 入站

| 动作 | 必填字段 | 可选字段 |
|---|---|---|
| `inbound.create` | `name`、`description`、`version` | `endpointPath`、`preset`、`authTokenEnv`、`trace`、`enabled`、`workspace`、`provider`、`model`、`baseUrl` |
| `inbound.update` | `id` | `name`、`description`、`version`、`endpointPath`、`preset`、`authTokenEnv`、`trace`、`workspace`、`provider`、`model`、`baseUrl` |
| `inbound.remove` | `id` | — |
| `inbound.enable` / `inbound.disable` | `id` | — |
| `inbound.setAuth` | `id` | `token`（省略或空串即清除） |
| `inbound.sendTest` | `id`、`text` | `contextId`、`skill` |
| `inbound.close` | `id`（对端 id） | — |

`workspace` 把单个入站实例固定到本地某个工作目录：必须是已存在的绝对路径，
该实例打开的所有 agent 会话都以它为 `cwd`。省略或留空表示继承部署级工作目录，
此时插件会把 `<DSH_HOME 或 ~/.dsh>/a2a-sessions` 注册成宿主工作区，让宿主
会话列表能列出这些会话（插件每次启动注册一次，之后每次留空保存也会再注册一次）。
该值只在**创建会话时**生效——已存在的 context 仍留在当初的 `cwd`，要换目录需换
context id。

`provider` / `model` 为单个入站实例固定模型选择，只覆盖该实例而不影响部署默认。
两字段相互独立，省略或留空即回落到部署默认模型；在 `inbound.update` 里传空串
可清除此前保存的覆盖值。

`baseUrl` 是**接口级**的实例广告地址覆盖（例如 `http://192.168.31.20`）。必须是
**不含路径**的绝对 `http(s)` URL，末尾斜杠会被去掉；省略或留空表示继承部署级
`baseUrl` 配置。它只改广告地址，实际路由仍由宿主 web server 提供。

插件页面已不再暴露这个实例级字段：广告地址是部署级配置，统一放在**部署设置**
卡片里（见下方 `settings.update`）。接口仍接受该字段，方便已有的自动化脚本与
历史记录继续工作。

特殊值 `auto` 会按每次请求的 `X-Forwarded-Host`（或 `Host`）与
`X-Forwarded-Proto` 头推导广告地址 —— 客户端用什么地址访问，卡片就广告什么地址。
IP 变动、多入口域名都不必重新配置；请求里没有 Host 头时回落到部署级 `baseUrl`。

`inbound.sendTest` 走与线上端点相同的门禁和任务生命周期，但不走 HTTP 鉴权；
它只能从回环调用。

#### 部署设置

| Action | 必填 | 可选 |
|---|---|---|
| `settings.update` | — | `baseUrl` |

`settings.update` 把部署级广告地址存进插件自己的 `a2a` 域（重启后仍在，不必改
profile 配置），并立即重建所有存活入站实例。`baseUrl` 接受 `auto`（按每次请求
推导回连地址，与实例级哨兵值同义）、绝对 `http(s)` 源（固定广告地址），或空值/
省略（清除覆盖，重新继承 loader 的 `baseUrl` 配置）。

当前模式也会出现在 `GET /a2a/api` 快照的 `settings` 字段里：`mode` 为
`inherit`（跟随插件配置）、`auto`（按请求推导）或 `custom`（固定 URL），
`baseUrl` 是已存的覆盖值（如有），`effectiveBaseUrl` 是此刻卡片广告的地址，
`configBaseUrl` 是 loader 配置值（如有），`candidates` 列出本机所有非回环 IPv4
网卡地址（`http://<ipv4>`），方便 dashboard 做成下拉选项而不必手输。

#### 出站

| 动作 | 必填字段 | 可选字段 |
|---|---|---|
| `outbound.create` | `name`、`agentCardUrl` | `bearerTokenEnv`、`preset`、`enabled`、`timeoutMs`、`disabledSkills`、`skillOverrides` |
| `outbound.update` | `id` | `name`、`preset`、`timeoutMs`、`disabledSkills`、`skillOverrides` |
| `outbound.remove` | `id` | — |
| `outbound.enable` / `outbound.disable` | `id` | — |
| `outbound.refresh` | `id` | — |
| `outbound.setAuth` | `id` | `token`（省略或空串即清除） |
| `outbound.discover` | `agentCardUrl` | `token` |

`outbound.update` 不改 `agentCardUrl`；要换卡片地址请删除后重新创建连接。

#### 任务与会话

| 动作 | 必填字段 | 效果 |
|---|---|---|
| `task.cancel` | `id`（任务 id） | 中止任务并标记为 canceled |
| `session.cancel` | `id`（上下文 id） | 取消该上下文的活跃任务；可选 `serverId` 限定实例 |
| `session.close` | `id`（上下文 id） | 取消活跃任务并释放活跃会话句柄；可选 `serverId` |

### 1.3 响应与状态码

成功的控制动作返回 `200`：

```json
{ "ok": true, "message": "inbound server \"b-server\" created", "id": "b-server-..." }
```

`inbound.create` 与 `outbound.create` 带 `id`；`outbound.discover` 带
`preview` 对象，含远端名称、版本、描述、端点与技能。失败的动作返回 `409` 与
`{ ok: false, message, ... }`。

| 状态 | 含义 |
|---|---|
| `200` | 动作或读取成功 |
| `400` | body 不是合法 JSON |
| `403` | 调用方不是回环 |
| `404` | 请求的卡片或任务不存在 |
| `405` | 方法不是 `GET`/`POST` |
| `409` | 动作失败，或会话有歧义 |
| `413` | 请求体超过面板上限 |

### 1.4 示例

创建入站实例：

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

设置它的 Bearer Token：

```sh
curl -sS -X POST http://127.0.0.1:3080/a2a/api \
  -H 'content-type: application/json' \
  -d '{ "action": "inbound.setAuth", "id": "reports-1a2b3c4d", "token": "s3cr3t" }'
```

只读取远端卡片、不创建连接：

```sh
curl -sS -X POST http://127.0.0.1:3080/a2a/api \
  -H 'content-type: application/json' \
  -d '{ "action": "outbound.discover", "agentCardUrl": "https://remote.example/a2a/x/agent-card.json" }'
```

创建连接：

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

## 2. A2A 端点

一个入站实例发布：

| 路径 | 方法 | 用途 |
|---|---|---|
| `/a2a/<id>/agent-card.json` | `GET` | AgentCard JSON |
| `/a2a/<id>` | `POST` | JSON-RPC 端点 |

端点路径就是实例的 `endpointPath`（默认 `/a2a/<id>`），卡片路径是该路径加
`/agent-card.json`。停用实例会注销两条路由。

### 2.1 鉴权

没有 token 时不需要 `Authorization` 头。配置 token 后，每个请求都要带：

```http
Authorization: Bearer <token>
```

缺失或错误返回 `401` 与 `WWW-Authenticate: Bearer`。流式请求在写 `200` SSE 头
之前鉴权，所以 `401` 仍是干净的 HTTP 状态。

token 在实例组装时解析；凭据模型见[运维指南](../guide/operations.zh.md#访问与安全)。

### 2.2 方法

端点使用 A2A `1.0.1` 的 JSON-RPC 绑定，方法名为 PascalCase。

| 方法 | 参数 | 行为 |
|---|---|---|
| `SendMessage` | `message`、`configuration?` | 创建或续接任务，等待到终态/中断；返回 `{task}` |
| `SendStreamingMessage` | `message`、`configuration?` | 创建或续接任务并流式推送；要求 `Accept: text/event-stream` |
| `GetTask` | `id`、`historyLength?` | 返回一条任务 |
| `ListTasks` | `contextId`、`status`、`pageSize`、`pageToken`、`statusTimestampAfter`、`includeArtifacts`、`historyLength` | 过滤、游标分页，按最近更新排序；响应含 `totalSize` |
| `CancelTask` | `id` | 取消非终态任务；终态任务返回 `TASK_CANCEL_NOT_ALLOWED` |
| `SubscribeToTask` | `id` | 流式订阅非终态任务；终态任务以 `UNSUPPORTED_OPERATION` 拒绝；支持进程内 `Last-Event-ID` 回放 |
| `GetExtendedAgentCard` | 无 | 返回同一份 AgentCard |

未知方法返回 `METHOD_NOT_FOUND`。push notification 配置方法返回
`PUSH_NOTIFICATION_NOT_SUPPORTED`（`-32003`），因为卡片宣告
`capabilities.pushNotifications: false`。

### 2.3 消息形状

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

- `parts` 可以是文本、文件或数据 part。文本与数据 part 作为文本进入 DSH prompt。
  带 `raw` 与 `mediaType`/`filename` 的原始图片/文件 part，在挂载了宿主附件存储时
  经它落成真实附件；只有 URL 的文件 part 仍是文本（服务端不抓取远程 URL）。
  没有附件存储时，原始 part 变成占位文本。
- `metadata.skill` 选择宣告的技能，默认为 `chat`；不在宣告集合内会被门禁拒绝。
- `contextId` 是对话键。复用它就复用活跃 DSH 会话；省略则生成新上下文。
- `messageId` 是幂等键：重发同一个 id 返回原任务，不再跑一轮。`taskId` 续接一个
  非终态任务；终态任务拒绝后续消息，仍在运行的任务以 `UNSUPPORTED_OPERATION` 拒绝。
- `configuration.returnImmediately: true` 在启动任务后立即返回；否则 `SendMessage`
  阻塞。`configuration.historyLength` 同时裁剪 `SendMessage` 与
  `SendStreamingMessage` 返回的历史：`0` 不返回，未设置表示不限制。
  `Task.history` 是该任务的 A2A 可见输入/输出消息，不是 DSH 内部 transcript。
- `configuration.acceptedOutputModes` 只接受文本模式；排除文本的请求得到
  `CONTENT_TYPE_NOT_SUPPORTED`。
- 每个请求都可带 `A2A-Version`（头或查询参数）。主/次版本不匹配返回
  `VERSION_NOT_SUPPORTED`（`-32007`）；响应带 `A2A-Version: 1.0`。

### 2.4 流式

带 `Accept: text/event-stream` 发送：

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

每个 SSE 事件是一个 JSON-RPC result 信封。status 与 artifact 帧带可回放的 `id:` 行；
首尾两个 task 快照不带。

```text
id: 7
data: {"jsonrpc":"2.0","id":2,"result":{"artifactUpdate":{...}}}
```

首个事件是当前 `task`；后续帧是 `statusUpdate` 与 `artifactUpdate`。artifact 分片
在扩展已有 artifact 时带 `append: true`，否则替换它。错误使用 JSON-RPC error 信封
（`data: {"jsonrpc":"2.0","id":...,"error":{...}}`）。

`SubscribeToTask` 使用同一传输，先发当前任务，再流到任务落定（终态或中断）。终态任务
以 `UNSUPPORTED_OPERATION` 拒绝。带 `Last-Event-ID` 时，服务端先发当前快照，然后只回放
非 artifact 帧，避免分片被追加两次。

#### 2.4.1 流里有什么

默认 `session` 执行器把实时 assistant 文本增量投影成 `result` artifact 下的
`artifactUpdate` 分片（`lastChunk: false`），最后以 `lastChunk: true` 收尾。
工具活动**不是** artifact。流的形状是：

- 一个初始 `task`，带当前状态、任务 id 与可用历史；
- 零个或多个只携带可见 assistant 文本的 `artifactUpdate` 帧；
- 零个或多个 `statusUpdate` 帧；激活可选扩展时可携带 trace metadata；
- 一个带完整 artifact 集合与落定历史的最终 `task`。

推理增量永不投影。工具结果永不投影。落定后的任务才是事实来源。

默认只宣告并产生 text/plain 输出。没有可见文本的一轮以 `TASK_STATE_COMPLETED`
结束，不产生 `result` artifact，并用状态消息说明“无可见输出”；它不是失败，
也不会回退到 reasoning。

#### 2.4.2 trace 扩展（可选）

`AgentCard.capabilities.extensions` 可以宣告可选的 `dsh-trace/v1` 扩展。只有实例
策略允许、且客户端用标准请求头激活时才生效：

```http
A2A-Extensions: https://github.com/hanphone/dsh-a2a/blob/main/docs/extensions/dsh-trace/v1.md
```

响应在 `A2A-Extensions` 中回显已激活的 URI。trace 数据只放在
`TaskStatusUpdateEvent.metadata`（实时）与 `Task.metadata`（有界持久摘要），
永远不会进入 artifact 或 history。它包含工具名、阶段、状态、耗时和脱敏后的参数
摘要，绝不包含原始参数、工具结果或 reasoning。未请求扩展的客户端看不到任何变化。

#### 2.4.3 断线与重连

客户端断线**不会**取消任务。执行器跑完并持久化任务，SSE 订阅只负责投递。

- 从首帧 `task` 记下 `taskId`。重连时用 `GetTask` 轮询，或用 `SubscribeToTask`
  从当前状态继续流。
- status 与 artifact 帧都带 SSE `id:`。用 `SubscribeToTask` 加
  `Last-Event-ID: <id>` 重连：服务端先发当前任务，然后只回放 status 帧。日志每任务
  保留 200 帧，且只在进程内。
- 如果 `SendMessage` 响应前断线，用同一 `messageId` 重试（幂等），或用 `ListTasks`
  找任务。续接被中断的任务，重发时带它的 `taskId`。
- 复用 `contextId` 续接对话；任务续接与对话连续性是两个独立概念。
- 进程重启保留任务与上下文绑定，但不保留活跃会话或 SSE 订阅。进程死亡时处于
  `TASK_STATE_WORKING` 的任务没有崩溃恢复，可能一直停在该状态。

### 2.5 任务状态

| 状态 | 终态？ | 含义 |
|---|---|---|
| `TASK_STATE_SUBMITTED` | 否 | 任务已记录，未开始 |
| `TASK_STATE_WORKING` | 否 | 执行器运行中 |
| `TASK_STATE_INPUT_REQUIRED` | 否（中断） | agent 需要更多输入 |
| `TASK_STATE_AUTH_REQUIRED` | 否（中断） | agent 需要鉴权 |
| `TASK_STATE_COMPLETED` | 是 | 完成；可能有 artifacts，也可能因无可见输出而没有 artifact |
| `TASK_STATE_FAILED` | 是 | 执行失败；状态消息带错误 |
| `TASK_STATE_CANCELED` | 是 | 被调用方或会话面板取消 |
| `TASK_STATE_REJECTED` | 是 | 执行前被拒绝 |

入站路径会产生 `SUBMITTED`、`WORKING`、`COMPLETED`、`FAILED`、`CANCELED`、
`INPUT_REQUIRED` 与 `AUTH_REQUIRED`。`REJECTED` 属于状态词表，但门禁拒绝发生在
任务创建之前，因此不会留下该状态的任务。

### 2.6 错误码

| 码 | 名称 |
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
| `-32040` | `UNAUTHORIZED`（HTTP 401 映射） |

实现会发出 `INVALID_REQUEST`、`INVALID_PARAMS`、`METHOD_NOT_FOUND`、
`INTERNAL_ERROR`、`TASK_NOT_FOUND`、`TASK_CANCEL_NOT_ALLOWED`、
`PUSH_NOTIFICATION_NOT_SUPPORTED`、`UNSUPPORTED_OPERATION`、
`CONTENT_TYPE_NOT_SUPPORTED`、`VERSION_NOT_SUPPORTED`、`401` 映射，以及限流拒绝和
流式路径技能门禁拒绝所用的 `-32000`。非流式路径的技能门禁拒绝用
`INVALID_PARAMS`；并发与超时失败把任务落为 `FAILED`，不返回 RPC 错误。
`PARSE_ERROR`、`STREAMING_NOT_SUPPORTED`、`INVALID_AGENT_RESPONSE` 在协议表里，
但入站 dispatcher 不发它们。

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
        "description": "可选工具调用 trace metadata。",
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

挂载 `attachments` 服务时，`defaultInputModes` 还会宣告图片类型与
`application/octet-stream`。配置 Bearer Token 时，卡片增加 `bearer` 安全方案与要求；
它绝不含 token 值。

只有实例策略允许 trace 时，`capabilities.extensions` 才出现该扩展。它是可选的
（`required: false`），通用客户端可以忽略。

## 3. 出站工具契约

每个启用的远端技能变成一个模型工具：

```text
a2a__<连接名>__<技能 id>
```

名称规范化为 `[A-Za-z0-9_-]` 并截断到 64 个字符；冲突时加短哈希后缀。参数 schema：

```json
{
  "prompt": "要发给远端 agent 的任务或指令。",
  "taskId": "可选。续接一个被中断的远端任务。"
}
```

`prompt` 必填。工具用稳定的 per-caller `contextId` 发送 A2A 消息；远端卡片宣告
流式时走流式；传播调用方 abort（任务 id 已知后发 `CancelTask`）；对瞬时传输/5xx
失败重试。

`TASK_STATE_FAILED` 任务抛出带远端消息的工具错误。中断状态以文本返回并带远端任务 id：

```text
[remote agent TASK_STATE_INPUT_REQUIRED task=<id>] <message>
```

模型可以用该 id 再次调用。工具优先渲染指定的 `result` artifact；没有时只取其余
非诊断 artifact 的 **文本 part**。工具调用或 trace artifact 的 data part 绝不会被
拼进模型可见结果。空结果渲染为 `(remote agent returned no output)`。

## 4. 当前限制

以下行为在 `0.5.1` 是有意为之或已知的：

- `SendMessage` 默认阻塞；`configuration.returnImmediately: true` 在启动任务后返回。
  历史是该任务的 A2A 可见输入/输出消息，不是完整的 DSH 逐轮 transcript。
- trace 扩展是可选的、仅 metadata、并且有界（每任务 64 条观察，参数摘要最多 200
  字符且脱敏）。`subagent` 执行器的子工具不提供 trace。
- `acceptedOutputModes` 只接受文本模式；排除文本的请求得到
  `CONTENT_TYPE_NOT_SUPPORTED`。
- 没有实现 push notification；push 配置方法返回
  `PUSH_NOTIFICATION_NOT_SUPPORTED`（`-32003`）。
- 只实现 JSON-RPC 绑定（没有 gRPC 或 HTTP+JSON）。
- 没有 OAuth、mTLS 或按客户端凭据。限流是进程内、按来源、可配置的；没有分布式配额
  或计费。
- SSE 事件日志在内存里：`Last-Event-ID` 只能恢复到同一进程的重连，跨重启不行。
- 出站 `preset` 是持久化元数据；不会从它组装本地衔接会话，工具直接调用远端。
- `subagent` 执行器存在，但默认技能表不会选中它。
- 进程死亡时处于 `TASK_STATE_WORKING` 的任务没有崩溃恢复。
