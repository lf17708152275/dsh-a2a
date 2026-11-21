# dsh-a2a

Agent2Agent（A2A）v1.0.1 双端插件，用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — [English](README.md) · **中文**

`@hanphone/dsh-a2a` 把 DeepSeek Harness 的 agent 通过 A2A 发布出去，也把远端
A2A agent 接入 DSH 变成模型工具。两个方向都是多实例，且完全在设置面板里管理：
实例存于 `a2a` 存储域，不写在配置文件里。

## 提供什么

- **入站 server。** 每个实例有自己的端点（`/a2a/<id>`）、AgentCard、preset
  绑定、鉴权 token 和启用开关。技能来自所绑 preset 技能目录中模型可调的条目，
  不需要手工填写技能表单。
- **出站连接。** 每个连接有自己的远端卡片 URL、token、超时和可选 preset。
  每个启用的远端技能注册为模型工具 `a2a__<连接名>__<技能>`。
- **A2A 1.0.1 JSON-RPC 协议面。** `SendMessage`、`SendStreamingMessage`、
  `GetTask`、`ListTasks`、`CancelTask`、`SubscribeToTask`、
  `GetExtendedAgentCard`，包含 SSE 补发帧以及官方任务状态与错误码。
- **持久任务。** 任务与上下文→会话绑定跨重启保留；活跃会话和 SSE 订阅不保留。
- **两种执行器。** `session` 在按上下文复用的 DSH 会话上跑一轮；`subagent`
  在挂载了 agent 循环与 `ctx.subagents` 时委托给子 agent。
- **可治理、可观测。** 入站任务经过 `a2a/inbound-task` waterfall；面板展示对端、
  会话、任务、计数与审计环。
- **凭据而非明文。** 面板经 harness 凭据服务写入 token，实例记录只保留生成的
  环境变量名。
- **版本与更新检查。** 面板显示插件版本、Node 运行环境和各卡片版本，并可向
  npm/GitHub 查询是否有新版本。

## 安装

本 fork 从自己的仓库安装。npm 上的 `@hanphone/dsh-a2a` 是上游发布，不包含本 fork 的提交，
只写 npm 包名的安装会静默落到上游代码：

```sh
dsh plugin --profile web add github:lf17708152275/dsh-a2a
```

任意 profile 名均可。简写等价于 `git+https://github.com/lf17708152275/dsh-a2a.git`；pnpm
克隆后运行仓库的 `prepare` 钩子构建 `lib/`。该构建通过 TypeScript project references
解析 `@deepseek-ai/*`，需要**同级的 harness checkout（`../deepseek-harness`）**，因此 git
安装需要一台具备它的开发机。

没有该 checkout 时，安装别处构建好的产物：

```sh
pnpm install && pnpm build
npm pack
dsh plugin --profile <name> add <path-to>/hanphone-dsh-a2a-<version>.tgz
```

安装后重启 web 应用；浏览器端 bundle 在宿主启动时扫描。

## 快速开始

1. 重启 DSH，打开 **设置 → A2A 连接**。
2. 创建入站 server：填名称、选 preset，可选填 Bearer Token。端点与卡片即时生效。
3. 添加出站连接：粘贴远端 AgentCard URL，点 **导入**，核对技能后点 **连接**。

两个方向的完整步骤和 `curl` 示例见[快速开始](docs/guide/getting-started.zh.md)；
精确报文见 [HTTP API 参考](docs/reference/http-api.zh.md)。

## 文档

| 文档 | 回答什么 |
|---|---|
| [快速开始](docs/guide/getting-started.zh.md) | 怎么安装、发布一个 agent、调用远端 agent？ |
| [核心概念](docs/guide/concepts.zh.md) | 实例、preset、技能、任务、上下文、执行器分别是什么？ |
| [运维指南](docs/guide/operations.zh.md) | 面板与 `/a2a` 命令怎么用？存储和访问怎么配？ |
| [HTTP API](docs/reference/http-api.zh.md) | 面板 API 暴露什么？线上协议长什么样？ |
| [排障](docs/guide/troubleshooting.zh.md) | 回复为空、连接失败、工具缺失时怎么查？ |
| [架构](docs/architecture.zh.md) | 宿主半区、manager、存储与浏览器半区如何组成？ |
| [Harness 兼容性](docs/harness-compatibility.zh.md) | 换 DSH 版本时要做哪些事？ |
| [测试](docs/testing.zh.md) | 哪一层测试能抓住哪类问题？ |
| [中文文档（站点）](https://docs.hanphone.cn/docs/项目/dsh-a2a.html) | 安装、接口、运维与架构，含图 |

手册描述 `0.5.5` 在 DeepSeek Harness `0.2.2-rc.3` 上的行为；版本范围与验证记录见
[Harness 兼容性](docs/harness-compatibility.zh.md)。

## 开发

插件通过 TypeScript 项目引用对同级 harness checkout 做类型检查，因此需要已构建的
`../deepseek-harness`。

```sh
pnpm typecheck   # 宿主 + 客户端 + 编译期镜像检查
pnpm test        # 单元 + 组合 + 真实持久化测试
pnpm build       # lib/index.js（宿主）+ lib/client.js（浏览器）
pnpm test:e2e    # 对已构建产物跑双实例 A2A 冒烟
pnpm test:all    # 以上全部
```

测试分层与各自的盲区见[测试](docs/testing.zh.md)。

## 许可证

MIT
