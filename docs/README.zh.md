---
name: 文档
description: @lf17708152275/dsh-a2a 手册——安装、概念、运维、HTTP API、排障、架构、兼容性与测试
update-time: 2026-11-18
---

# dsh-a2a 文档

[English](README.md) · **中文**

`@lf17708152275/dsh-a2a` 是 DeepSeek Harness 的 A2A v1.0.1 双端插件：入站 server
把 DSH agent 发布出去，出站连接把远端 A2A 技能变成模型工具。

手册描述插件 `0.5.5` 在 DeepSeek Harness `0.2.2-rc.3` 上的行为。

## 先读这些

| 文档 | 回答什么 |
|---|---|
| [快速开始](guide/getting-started.zh.md) | 安装、发布第一个入站 server、调用它、连接远端 agent |
| [核心概念](guide/concepts.zh.md) | 术语：实例、preset、技能、任务、上下文、执行器 |
| [运维指南](guide/operations.zh.md) | 面板与 `/a2a` 参考、配置、宿主服务、存储、访问控制 |
| [HTTP API 与协议](reference/http-api.zh.md) | 面板动作、JSON-RPC 方法、SSE、状态、错误码、AgentCard |
| [排障](guide/troubleshooting.zh.md) | 回复为空、401、连接失败、工具缺失怎么查 |

## 维护者参考

| 文档 | 读者 |
|---|---|
| [架构](architecture.zh.md) | 宿主半区、manager、存储与浏览器半区的组织方式 |
| [Harness 兼容性](harness-compatibility.zh.md) | 把插件迁移到另一个 DSH 版本 |
| [测试](testing.zh.md) | 测试分层、hermetic e2e，以及 stub 测试看不见什么 |
| [Trace 扩展](extensions/dsh-trace/v1.zh.md) | 可选的 `dsh-trace/v1` metadata 契约 |

完整的安装、接口、运维与架构文档在站点：[dsh-a2a 中文文档](https://docs.hanphone.cn/docs/项目/dsh-a2a.html)。

## 版本与事实来源

- 插件：`@lf17708152275/dsh-a2a` `0.5.5`
- 已核对：DeepSeek Harness `0.2.2-rc.3`；e2e 矩阵同时覆盖
  `0.2.2-rc.1`、`0.2.2-alpha.2`、`0.2.1-rc.3`、`0.2.1-rc.2`、
  `0.2.1-alpha.2` 与 `0.1.7-rc.2`
- 协议：A2A `1.0.1` 的 JSON-RPC 绑定；声明的协议版本为 `1.0`

文档与代码冲突时，以 `src/` 与 `tests/` 为准。每页都按上面的版本核对；发现不一致时，
请带上版本与你执行的命令提 issue。
