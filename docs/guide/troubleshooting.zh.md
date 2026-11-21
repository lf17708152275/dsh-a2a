---
name: 排障
description: 诊断空回复、401、卡片不可达、出站连接失败、工具缺失、版本拒绝与存储冲突
update-time: 2026-11-18
---

# 排障

[English](troubleshooting.md) · **中文**

按顺序排查，每一步都缩小一层范围：

1. **插件挂上了吗？** `/a2a status` 能返回快照。
2. **实例存在且启用了吗？** `/a2a inbound list` / `outbound list`。
3. **卡片可达吗？** `curl <cardUrl>`。
4. **协议可达吗？** 发一条极短的 `SendMessage`。
5. **任务状态？** `/a2a tasks`、`/a2a task get <id>`。
6. **日志？** DSH 宿主日志；对话本身看 `$DSH_HOME/sessions`。
7. **版本不匹配？** 见 §7。

## 任务完成但没有可见回复

`TASK_STATE_COMPLETED` 任务的状态消息是
`The agent completed without visible output.`，表示这一轮正常结束，但没有产生可见的
assistant 文本（例如只调用了工具）。这不是失败；它没有 `result` artifact，也绝不会
回退到 reasoning。读取任务与状态消息：

```text
/a2a task get <taskId>
```

如果预期有文本，逐项排查：

1. 在 **连接与任务 → 入站会话** 找到该 `contextId`，看它是运行中还是空闲。
2. 检查该 preset 的模型 provider：未鉴权或配错的 provider 会产出空的 assistant
   消息。用同一个 preset 开一个普通 DSH 会话验证。
3. 查宿主日志里的 `a2a` 警告，以及
   `$DSH_HOME/sessions/...` 下 `a2a-<实例 id>-<contextId>` 的会话日志。

真正的 provider 或执行器错误仍会落为 `TASK_STATE_FAILED`，状态消息携带错误。

如果任务是 `TASK_STATE_CANCELED`，是调用方或面板取消了它；在同一上下文发新任务即可
重新打开会话。

## 入站请求返回 401

实例配置了 Bearer Token，而请求不匹配。

- 发送 `Authorization: Bearer <token>`。
- token 在实例组装时读取（新增、更新、启动、`setAuth`），先凭据服务、再进程环境。
  检查托管变量名：
  - 入站：`A2A_INBOUND_<ID>`（大写，非字母数字替换为 `_`）；
  - 出站：`A2A_OUTBOUND_<ID>`。
- 入站卡片会显示是否配置了鉴权。用**编辑**设置新 token，或用**清除鉴权**移除。
- 流式请求在 `200` 之前鉴权；`401` 是干净状态，不是流坏了。

## AgentCard 返回 404 或连接被拒

- 实例可能**被停用**：`/a2a inbound list` 与面板会显示启用状态。启用后重试。
- 使用面板给出的**每实例**卡片路径（`/a2a/<id>/agent-card.json`）。实例不使用
  `/.well-known/agent-card.json`。
- 确认 web server 确实在调用地址上监听：
  ```sh
  curl -v http://127.0.0.1:3080/a2a/<id>/agent-card.json
  ```
- 如果 URL 走公网或反向代理，确认代理转发 `/a2a/` 前缀，并保留 web 应用期望的
  `Host` 头。

## 出站连接状态为 `failed`

面板会显示 `lastError`；常见原因：

| 症状 | 检查 |
|---|---|
| `HTTP 401` | 远端要求 token；编辑连接并设置 |
| `HTTP 404` | 卡片 URL 错；使用远端完整的每实例卡片路径 |
| `invalid agent card` | URL 返回 HTML 或非卡片 JSON；核对 content-type 与形状 |
| `advertises no JSON-RPC interface` | 卡片没有可用的 interface URL |
| timeout | 调大连接的 `timeoutMs`，或检查网络可达性 |
| TLS/DNS 错误 | 检查远端证书/主机名与本机网络 |

修复后点**刷新**（或调用 `outbound.refresh`）。失败记录会保留以便编辑，不必删除重建。

## 远端技能缺失，或模型不调用工具

- 确认连接是 `connected` 且 `skillCount > 0`、`toolCount > 0`。零技能的卡片按设计
  注册零个工具。
- 工具名是 `a2a__<连接名>__<技能 id>`，规范化为 `[A-Za-z0-9_-]` 并截断到 64
  个字符。远端名称含空格或标点时，到模型的工具列表里看实际注册名。
- 参数是一个对象，`prompt` 必填，`taskId` 可选，不是裸字符串。
- 改连接名会改变工具前缀；改名后刷新或重新编辑。
- 连接的**编辑**表单可以禁用单个技能；确认该技能是启用的。
- 如果连接在插件启动时就处于停用状态，启用它只会标记记录；保存一次编辑（或重启）
  才会建立连接。

## 工具调用返回远端错误

远端任务落定为失败或中断。看返回文本：

- `Remote agent task failed: ...`——远端报告 `TASK_STATE_FAILED`。
- `[remote agent TASK_STATE_INPUT_REQUIRED task=<id>] ...`——远端需要更多输入；
  带该 `taskId` 和后续 prompt 再调一次。
- `[remote agent TASK_STATE_AUTH_REQUIRED task=<id>] ...`——更新连接 token。
- `(remote agent returned no output)`——远端完成但没有 artifacts。

## 插件没加载：`incompatible-version`

DSH 0.1.7+ 在导入插件前检查它的 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`
peer 范围。拒绝表示运行中的 harness 不在声明范围内。

- 把插件和/或 harness 升到受支持的组合。
- 查 `package.json` 的精确范围，以及
  [Harness 兼容性](../harness-compatibility.zh.md)里的记录。
- `dsh plugin allow-version ... --accept-risk` 是应急用的精确版本豁免，不能替代测试。
- 没有跑兼容性流程，不要放宽 peer 范围。

## 两个 DSH 进程争抢存储

`a2a` 域是根在 `DSH_HOME` 的单一存储（默认 JSON）。两个进程共享 home 会写同一个域，
可能互相覆盖实例与任务。一个 `DSH_HOME` 只跑一个写者；双实例测试请用独立 home 与端口。

## 流式行为异常

- 流式要求 `POST` 带 `Accept: text/event-stream`。不带时按非流式 JSON-RPC 处理。
- 流式路径只接受 `SendStreamingMessage` 与 `SubscribeToTask`；其他方法返回
  method-not-found 帧。
- `SendMessage` 只在非流式路径处理。要 SSE 就选 `SendStreamingMessage` 或
  `SubscribeToTask`；带 `Accept: text/event-stream` 发 `SendMessage` 会得到
  method-not-found 帧。帧是 `data:` 行，所以用 `curl -N`。
- 断线不会取消任务；用 `SubscribeToTask` 加 `Last-Event-ID` 重连回放状态。见
  [HTTP API：流式](../reference/http-api.zh.md#24-流式)。

## 提 issue 时带上什么

- 插件版本（`0.5.5`）、harness 版本与操作系统。
- 确切的命令或面板操作。
- 任务 JSON（`/a2a task get <id>`）与 AgentCard。
- 入站实例是否配置鉴权，请求是否带了头（不要贴 token）。
- 相关宿主日志；若怀疑会话，附上
  `a2a-<实例 id>-<contextId>` 的会话日志路径。
- 出站问题附远端卡片 URL 的形状（必要时抹掉主机名）与 `lastError` 文本。

这些路径的自动化防线见[测试](../testing.zh.md)。如果你在修 bug，把失败的断言加到
能看见它的那一层：类型契约进镜像检查，持久化形状进真实持久化集成，发布产物路径进
e2e 冒烟。
