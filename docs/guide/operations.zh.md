---
name: 运维指南
description: 面板与 /a2a 命令参考、生命周期、配置、宿主服务、存储与访问控制
update-time: 2026-10-25
---

# 运维指南

[English](operations.md) · **中文**

本页是日常参考：控件在哪、每个字段做什么、实例跨重启怎么表现、存储与访问怎么配。
线上细节见 [HTTP API 参考](../reference/http-api.zh.md)。

## 控制面

三种控制面驱动同一个 facade，所以状态不会互相矛盾：

| 控制面 | 用途 |
|---|---|
| **设置 → A2A 连接** | 主 UI：创建、编辑、启停、删除；查看对端、会话与任务 |
| **`/a2a` 命令** | DSH 聊天会话里的文字备用路线 |
| **仅回环 `/a2a/api`** | 脚本、测试与集成；见 [HTTP API](../reference/http-api.zh.md#1-面板-api) |

面板每 3 秒自动刷新。

## 面板

### 版本与更新条

页签上方显示当前插件版本、Node 运行环境和一次更新检查的结果。检查同时查询 npm
registry 与 `package.json` 里的 GitHub 仓库，取较高版本，并如实报告：已是最新、
有新版本、或暂时查不到。查询失败绝不会显示成已是最新。结果缓存 6 小时；按钮会
强制刷新。

发现新版本时，面板会给出当前 profile 的两步更新命令（先 `remove` 再 `add`）和
复制按钮。检查是只读的：不安装、不重启、不改 profile。

入站卡片同时显示实例宣告的版本；出站卡片在连接后显示远端卡片的版本。

### 入站 Servers

每张卡片显示名称、端点路径、preset 徽章、鉴权状态、派生技能 chips 与实时卡片 URL。
操作：

| 操作 | 效果 |
|---|---|
| **启用 / 停用** | 注册或注销卡片与端点路由；记录与会话池保留 |
| **Card** | 查看当前 AgentCard JSON |
| **测试** | 用内置控制台发一条消息（同一门禁与任务生命周期，不走 HTTP 鉴权） |
| **编辑** | 修改名称、描述、版本、preset 或 token；重新派生技能并换装活实例 |
| **删除** | dispose 活实例并删除持久化记录 |
| **清除鉴权** | 仅已配置鉴权的实例出现；删除已存 token 并以匿名实例重建 |

创建/编辑表单有名称、版本、preset、工作空间(workspace)、provider、model、
Bearer Token 与描述。`workspace` 填已存在的绝对路径，可把该
实例的 agent 会话固定在某个本地项目目录；留空则插件会接管 `~/.dsh/a2a-sessions`
并注册成宿主工作区，让这些会话在宿主会话列表里可见；`provider`/`model` 单独指定该实例用的
模型。三者都可空，留空即继承部署默认。广告地址不再按实例配置：由入站标签页顶部的
**部署设置** 卡片统一管理（见下）。技能在创建后显示，
不需要手填。preset 选择器只列真实 roster，并预选部署默认；每个选项后面显示该预设会挂载
多少个插件，展开选择器下方的「能力」行还能看到具体插件清单（模块名 + 启用/关闭/条件
`conditional:<表达式>`），创建前就能确认这个端点的 A2A 会话到底带哪些插件。实例卡片上
也会显示同样的数量徽章。

入站标签页顶部的「**部署设置 · 广告地址**」可以在不改 profile 配置的情况下设置
部署级广告地址：*跟随插件配置*、*auto*（按每次请求的转发头自动推导）、
下拉里自动列出的本机网卡地址（所有非回环 IPv4 接口），或*自定义 URL*。
选择保存在插件自己的域里并立即生效（会重建存活实例，无需重启）。注意：如果反向代理改写了 `Host` 又没有转发原始值，
`auto` 会推导出代理内部的地址，此时请直接选局域网网卡地址。

测试控制台选择实例、技能、可选 `contextId` 与消息，结果以任务 JSON 展示。

### 出站 Servers

添加是两阶段流程：

1. 填远端 AgentCard URL（和可选 token），点 **导入**。
2. 核对读到的名称、版本、描述、端点与技能，调整本地名称、preset、超时，点 **连接**。

连接成功的卡片显示状态点、远端 AgentCard 版本、导入技能数、工具数，失败时显示
`lastError`。操作：

- **启用 / 停用**——为活跃连接注销或重新注册工具。插件启动时就处于停用状态的实例
  还没有活跃连接；保存一次编辑（或重启）才会建立连接。
- **刷新**——重读卡片并重注册工具。
- **编辑**——修改名称、preset、超时、token 与单技能启用状态；编辑不会改远端卡片
  URL（要换地址请删除后重新添加）。
- **删除**——dispose 连接并删除记录。

编辑表单可以禁用单个技能，并接受 JSON `skillOverrides`
（`{"chat": {"name": "...", "description": "..."}}`）。

token 经凭据服务单独存储；token 输入框留空会保留原值。入站表单有**清除鉴权**；
出站表单没有清除按钮——通过 `outbound.setAuth` 提交空 `token` 删除。

### 连接与任务

活动页顶部是指标与审计表（最近 20 条），下面是三张表：

- **入站对端**——谁在调用这个 DSH：来源、任务数/活跃数、流式指示、首次/最近时间、
  **关闭**。
- **入站会话**——每个 `(实例, contextId)` 一行：实例、preset、运行中/空闲、
  任务/活跃数、流式、首次/最近时间、**取消活跃**、**对话**、**关闭**。
- **任务**——每页 50 条（可按状态筛选，**加载更多**）：id、技能、来源实例、状态、
  **取消**。

语义：

- **取消活跃**中止该上下文所有非终态任务；会话保持打开。
- **关闭**额外释放该上下文的活跃会话句柄。它是资源释放，不是会话墓碑：同一上下文的
  下一个任务会重新打开新句柄。
- **被归档的会话**会在下一次入站任务时自动复活：宿主对已归档会话的每一步都会被门禁拒绝
  （turn 以 `blocked` 结束、没有任何助手文本），因此实例会在跑 turn 之前先清掉归档标记。
- 插件为新上下文创建的会话会**自动以它的 contextId 命名**（例如 `wx3-uf437c8af9814`），
  所以 DSH 的会话列表里能直接认出是哪个联系人；你自己改过的标题不会被覆盖。
- 对端上的**关闭**会取消它的活跃任务并移除 registry 记录，不删除任务记录。

## `/a2a` 命令

命令在 DSH 聊天会话里使用。列表与状态类输出 JSON。

| 命令 | 用途 |
|---|---|
| `/a2a status` | 整插件快照 |
| `/a2a presets` | Agent preset 名单 |
| `/a2a inbound list` | 入站实例 |
| `/a2a inbound create <name> [preset] [description]` | 创建入站实例 |
| `/a2a inbound remove <id>` | 删除 |
| `/a2a inbound enable\|disable <id>` | 启停路由 |
| `/a2a outbound list` | 出站实例 |
| `/a2a outbound create <agentCardUrl> [name] [preset]` | 创建出站连接 |
| `/a2a outbound remove <id>` | 删除 |
| `/a2a outbound enable\|disable <id>` | 启停 |
| `/a2a outbound refresh <id>` | 重读远端卡片 |
| `/a2a tasks` | 最近 50 条任务 |
| `/a2a task get <taskId>` | 单条任务 |
| `/a2a task cancel <taskId>` | 取消任务 |
| `/a2a sessions` | 按上下文的会话视图 |
| `/a2a session cancel <contextId>` | 取消该上下文的活跃任务 |
| `/a2a session close <contextId>` | 释放该上下文的活会话 |
| `/a2a peers` | 入站对端注册表 |
| `/a2a help` | 用法 |

参数以空白分隔。入站描述是可选 preset 之后的剩余单词；需要更丰富的字段时用面板或
HTTP API。

## 生命周期

- **创建**——持久化记录、派生技能、解析鉴权、组装运行时；启用时注册路由。
- **更新**——持久化 patch，重新派生技能（preset 可能变了）、重新解析鉴权，
  在保留启用状态的前提下替换活实例。
- **启用 / 停用**——注册或注销路由，并持久化启用标志。记录、技能、会话池保留；
  停用实例在启动时仍会组装，但不路由。
- **删除**——dispose 活实例并写入空 tombstone 行；重启后不会复活。
- **出站连接**——先保存记录，再读卡片、按启用技能注册工具并记录 `lastCardAt`。
- **出站刷新**——从卡片重建 registry 并重注册工具。**编辑**持久化 patch 并重建连接；
  若实例处于启用状态，还会用已存 token 重新连接。
- **重启**——重新组装持久化的入站/出站实例；启用的会恢复。活跃会话与流订阅不恢复。

## 配置

实例**不**在 `cordis.patch.yml` 里配置；它们存在于 `a2a` 域，由面板管理。插件
`Config` 只承载宿主级默认值，可经 profile 用户 patch 层
（`$DSH_HOME/profiles/<name>/cordis.patch.yml`）覆盖：

```yaml
- id: a2a
  config:
    baseUrl: http://127.0.0.1:3080   # 可选；省略时从 webServer 派生
    subagentProvider: in-process
    defaultTimeoutMs: 60000
    inboundTimeoutMs: 600000
    requestsPerMinute: 120
    maxConcurrentTasks: 32
    maxBodyBytes: 1048576
    outboundRefreshMs: 300000
    inboundTrace: false
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `baseUrl` | web server 端口，其次 `DSH_A2A_PORT`，最后 `3000` | 所有入站 AgentCard 的对外 base URL |
| `subagentProvider` | `in-process` | subagent 执行器的 provider 名 |
| `defaultTimeoutMs` | `60000` | 出站连接每次调用的默认超时 |
| `inboundTimeoutMs` | `600000` | 每个入站任务的执行预算；超时落 `FAILED`；`0` 关闭 |
| `requestsPerMinute` | `120` | 每个入站来源的滑动窗口限流；超限返回 HTTP 429；`0` 关闭 |
| `maxConcurrentTasks` | `32` | 每个入站实例的并发任务上限；超限任务可读地失败；`0` 关闭 |
| `maxBodyBytes` | `1048576` | 入站 A2A 请求体上限 |
| `outboundRefreshMs` | `300000` | 启用中的出站连接自动刷新 AgentCard 的间隔；`0` 关闭 |
| `inboundTrace` | `false` | 可选入站 trace 扩展的部署总开关/默认值；为 false 时任何实例都不能激活 |

入站会话工作目录是 `$DSH_HOME/a2a-sessions`（启动时创建）。`DSH_HOME` 默认
`~/.dsh`。

## 宿主服务

只有 `storageDomain` 是必需的。其余服务都是探测式可选；缺少某个只会让对应能力空闲，
不会让整个插件挂掉。

| 服务 | 使用方 | 缺失时的效果 |
|---|---|---|
| `storageDomain` | 两端 | 必需；插件不挂载 |
| `webServer` | 入站路由、面板 API | 入站端点/卡片与面板 API 空闲 |
| `agents` | 入站 session 执行器 | 入站任务走 `refuse` 执行器 |
| `attachments` | 入站图片/文件 part、宣告的输入模式 | 原始附件降级为占位文本；卡片只宣告文本 |
| `agentPresets` | preset 选择、技能派生 | 无法选择 preset；派生技能回退到 `chat` |
| `skills` | 技能派生 | 卡片回退到 `chat` |
| `credentials` | token 存储与解析 | GUI 写 token 失败；外部 export 的环境变量仍可用 |
| `subagents` | subagent 执行器 | subagent 执行器不接线 |
| `agentDefaultModel` | 入站会话的模型选项 | 会话使用 harness 默认值 |
| `tools` | 出站工具注册 | 出站连接能连上，但注册不了工具 |
| `commands` | `/a2a` | 聊天命令不注册 |

基础 `web` profile 已挂载全部。自定义组合应包含 `storageDomain`、`webServer`、
`agents`、`agentPresets`、`skills`、`tools` 与 `commands`；需要对应能力时再加
`attachments`、`credentials`、`subagents` 与 `agentDefaultModel`。

## 存储

持久状态在 `a2a` 存储域：

| 表 | 内容 |
|---|---|
| `tasks` | 任务记录，含来源实例 id |
| `contexts` | 上下文 id → 会话 id 绑定 |
| `agents` | 每个出站实例的 agent 记录（键 `out:<id>`） |
| `inbound_servers` | 入站实例记录（键 `in:<id>`） |
| `outbound_servers` | 出站实例记录（键 `out:<id>`） |

域默认走 profile 的 JSON 后端。只把 `a2a` 域路由到 SQLite：

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

运维注意：

- **一个 `DSH_HOME` 只允许一个写者。** 两个 DSH 进程共享 home 会写同一个 JSON 域；
  双实例测试请用独立 home 与端口。
- **任务与实例持久化。** 活跃会话、流订阅、对端注册表都在内存里，重启即清空。
- **任务记录会随 history 与 trace 增长。** 每条已接受输入都会为 `Task.history`
  保留；可选 trace 摘要最多 64 条观察。大附件与长续接会放大域记录体积，需相应规划
  保留与备份策略。
- **域里存的是 JSON 字符串。** 格式变化由域的 `version` 字段守护。升级前备份
  JSON/SQLite 文件。
- **会话日志**由 DSH 正常的 session persistence 写到 `$DSH_HOME/sessions/...`；
  插件的工作目录是 `$DSH_HOME/a2a-sessions`。

## 访问与安全

- **面板 API 在设计上仅回环。** `/a2a/api` 只接受 `127.0.0.1`、`::1`、
  `::ffff:127.0.0.1`；其他来源直接 `403`。把 web 应用放到反向代理后面，也不会让
  它可远程调用。
- **A2A 端点与 GUI 共用同一个 web server。** 若把该 server 暴露到网络，给每个入站
  实例配置 Bearer Token，并在代理层终止 TLS。插件不提供 TLS；请求、请求体与并发限制
  都是进程内的，不是分布式配额。
- **token 是凭据引用。** 面板经 `ctx.credentials.set` 把 token 写到
  `A2A_INBOUND_<ID>` 或 `A2A_OUTBOUND_<ID>`（大写，非字母数字替换为 `_`）。
  记录只存变量名，卡片只存方案，面板不回显值。解析发生在实例组装时（新增、更新、
  启动与 `setAuth`），先读凭据服务，再读进程环境。
- **入站鉴权。** 配置 token 后，每个请求都要带 `Authorization: Bearer <token>`，
  否则返回 `401` 与 `WWW-Authenticate: Bearer`。流式请求在写 `200` SSE 头之前鉴权。
- 每个入站实例用不同 token，避免一次泄露就拿到所有已发布 agent 的访问权。在面板里改
  token 会立即重建该实例；外部 export 的变量在下一次组装实例时生效。
- 没有 OAuth、mTLS 或按客户端凭据模型。
- **trace 是可选的、仅 metadata 的。** `inboundTrace: true` 是部署总开关；实例还要
  允许该扩展，调用方还要用 `A2A-Extensions` 请求。任何能读任务的调用方都能看到
  `Task.metadata` 里的有界摘要，所以只对可信对端开启。原始工具参数、工具结果和
  reasoning 永不包含；参数摘要会脱敏并截断。关闭部署总开关并重载后，所有卡片都会移除该扩展。

## 升级与卸载

```sh
dsh plugin --profile web add @hanphone/dsh-a2a@latest
```

安装后重启 `dsh web`。实例与任务在域里，升级后保留；活跃会话不保留。

```sh
dsh plugin --profile web remove @hanphone/dsh-a2a
```

卸载不会删除 `a2a` 域数据。只有确认要丢弃实例定义与任务历史时，才删除域行或存储文件。

换到另一个 harness 版本见 [Harness 兼容性](../harness-compatibility.zh.md)。
