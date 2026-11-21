---
name: 测试
description: 测试分层、命令、hermetic e2e 流程、可视化测试与 CI
update-time: 2026-11-18
---

# 测试

[English](testing.md) · **中文**

插件可以通过所有 stub 测试，却仍然对真实 harness 不可用。下面的分层就是为了让宿主
契约变化在发布前让测试失败。每层覆盖什么、为什么 stub 不够，是本页的重点。

## 分层

| 层 | 位置 | 抓什么 | 需要已构建的 harness 产物 |
|---|---|---|---|
| 镜像检查 | `tests/types/mirrors.typecheck.ts` | 结构化镜像与真实 `@deepseek-ai/dsh-*` 类型漂移 | 是（`lib/types`） |
| 单元 / 组合 | `tests/unit`、`tests/composition` | 协议帧、路由、存储、registry、stub 宿主服务上的 `apply()` 接线 | 否 |
| 真实持久化集成 | `tests/integration/persistence.spec.ts` | 持久会话编解码、agent 循环契约、inbox 来源 | 是（JSONL addon） |
| Profile e2e | `scripts/e2e-a2a.mjs` | 已发布产物对两个真实 harness 实例：manifest/挂载、路由、发现、JSON-RPC、工具注册、模型 → 工具 → 远端 agent、trace 卡片/header 激活 | 是（宿主 + 插件） |

可见性相关的覆盖在 `tests/unit/agent-runtime.spec.ts`（reasoning 回退与工具 trace
生命周期）、`tests/unit/a2a-server.spec.ts`（history、空输出、扩展激活）和
`tests/unit/outbound-tools.spec.ts`（出站结果选取）与
`tests/unit/subagent.spec.ts`（subagent reasoning 过滤）。

## 命令

```sh
pnpm typecheck        # 宿主（tsc -b）+ 客户端 + 镜像检查
pnpm test             # vitest run：单元 + 组合 + 集成（199 项）
pnpm test:integration # 只跑真实持久化套件
pnpm build            # tsc + tsdown + 浏览器 bundle -> lib/
pnpm test:e2e         # 双实例 A2A hermetic 冒烟（需要已构建插件）
pnpm test:all         # typecheck + test + build + test:e2e
```

`pnpm test:e2e` 需要：

- 已构建的插件（`pnpm build`）；缺 `lib/index.js` 会快速失败并给出明确消息；
- 同级 `../deepseek-harness` checkout（可用 `DSH_A2A_HARNESS_DIR` 覆盖），且宿主
  产物已构建（`pnpm install && pnpm run build`）；
- 其他什么都不用：模型用 harness 自带的 mock LLM server。

`DSH_A2A_KEEP=1` 会保留两个临时 home、日志与子进程，便于调试。

## e2e 流程

`scripts/e2e-a2a.mjs` 是 hermetic 且确定性的：

1. 两个临时 Harness home（`a` 与 `b`）各有一个 `web` profile（`a` 还有
   `headless`），bundle 列表直接挂载已构建插件；不用 registry，也不用用户 home。
2. 每个 home 启动脚本化 mock LLM server（`@deepseek-ai/dsh-llm-mock-server`），
   `dsh web` 通过 `DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY` 指向它。
3. **入站：** 在 B 上创建入站 server，读取 AgentCard，POST `SendMessage`，断言
   artifact 是 mock 的文本。
4. **出站：** 在 A 上创建到 B 的出站连接，断言状态为 `connected` 且至少有一个工具。
5. **往返：** 停掉 A 的 web 实例，用 A 的 `headless` profile 跑一个被脚本化成调用
   `a2a__b__chat` 的 mock，断言 stdout 是 B 的回复。任务通过 runner 的 stdin 写入，
   而不是命令行参数：profile 先挂载、runner 后读取，出站连接因此能在第一次模型请求
   之前注册好工具（见 [Harness 兼容性](harness-compatibility.zh.md) 的冷启动限制）。
6. 拆除两个 home 与所有子进程。

## 可视化测试

`pnpm visual:a2a` 启动同样的 hermetic 组合，并在打印出的回环 URL 上提供一个交互式
面板。它展示两个实例、任务时间线、对端与会话，并有两个按钮：

- **Inbound** 直接向 B 的端点发 `SendMessage`。
- **Outbound** 让 A 的 headless 模型执行脚本化工具调用，调用 `a2a__b__chat`，
  经 A2A 到达 B。

组合与 e2e 相同，只是可交互；用于演示和人工检查，不是 CI 门禁。`Ctrl+C` 会拆除所有
子进程与临时 home。

## 新增测试

- **行为变更** → 一个少了它就会失败的单元或组合测试。
- **新的宿主契约面**（运行时服务、消息形状、存储字段）→ 有结构化镜像就扩展镜像检查；
  只能端到端观察的，补真实持久化或 e2e 断言。
- **新的 e2e 步骤** → 加到 `scripts/e2e-a2a.mjs`，并保持离线：默认运行只允许 mock
  LLM server 作为模型。

## CI

`.github/workflows/ci.yml` 在每次 push 与 pull request 跑 `check`（类型检查、单元、
组合、真实持久化测试），以及针对 `dsh-v0.2.2-rc.3` 的 `e2e-pinned`。夜间定时与手动
触发会跑 e2e 矩阵，覆盖支持的 harness 版本（`0.2.2-rc.3`、`0.2.2-rc.1`、`0.2.2-alpha.2`、
`0.2.1-rc.3`、`0.2.1-rc.2`、`0.2.1-alpha.2`、`0.1.7-rc.2`）。

放宽 `peerDependencies` 的同一次改动里同步放宽矩阵，并把结果记到
[Harness 兼容性](harness-compatibility.zh.md)。
