---
name: 快速开始
description: 安装插件、发布一个入站 A2A server、调用它，并把远端 A2A agent 接入为模型工具
update-time: 2026-11-18
---

# 快速开始

[English](getting-started.md) · **中文**

本页从一个全新安装走到两个可用方向：远端 A2A 客户端调用这个 DSH，以及这个 DSH
调用远端 agent。表单逐字段说明见[运维指南](operations.zh.md#面板)，完整报文格式
见 [HTTP API 参考](../reference/http-api.zh.md)。

## 开始之前

需要 DeepSeek Harness `0.2.2-rc.3`（已核对版本；其他受支持的 0.2.x 仍在兼容矩阵中）和运行中的 web 应用，
默认地址为 `http://127.0.0.1:3080/`。基础 `web` profile 已挂载插件用到的全部服务；
自定义组合见[宿主服务](operations.zh.md#宿主服务)。

## 安装与验证

本 fork 从自己的仓库安装：

```sh
dsh plugin --profile web add github:lf17708152275/dsh-a2a
```

npm 上的 `@hanphone/dsh-a2a` 是上游发布，只写它装到的是不含本 fork 提交的上游代码。仓库里
已经提交了构建好的 `lib/` 产物，git 安装直接把产物装进去：没有构建钩子要跑，也不需要
harness checkout。从源码重建才需要：`pnpm build` 通过 project references 把
`@deepseek-ai/*` 解析到同级 checkout（`../deepseek-harness`，见[安装](../../README.zh.md#安装)）。

在 harness checkout 内可用它的启动器：

```sh
cd deepseek-harness
pnpm dsh plugin --profile web add github:lf17708152275/dsh-a2a
```

重启 web 应用（`dsh web` 或 `pnpm dsh web`）。刷新页面不够：浏览器端 bundle 在宿主
启动时才被扫描。

验证插件已挂载：

```text
/a2a status
```

命令返回含 `inbounds` 与 `outbounds` 的 JSON 快照。同一份快照也在
`GET http://127.0.0.1:3080/a2a/api`。

## 发布一个入站 server

打开 **设置 → A2A 连接 → 入站 Servers**，填写创建表单（名称、版本、preset、可选
Bearer Token、描述）并提交。实例会立即启用并发布：

```text
http://127.0.0.1:3080/a2a/<id>
http://127.0.0.1:3080/a2a/<id>/agent-card.json
```

不需要填写技能。卡片宣告所选 preset 技能目录中模型可调的条目；解析不到时回退到
内置 `chat` 技能。

读取卡片：

```sh
curl -sS http://127.0.0.1:3080/a2a/<id>/agent-card.json
```

返回 A2A `AgentCard`，含 `name`、`version`、`supportedInterfaces`、
`capabilities` 与 `skills`。配置了 Bearer Token 的实例还会声明 `bearer` 方案；
token 明文永远不会出现在卡片里。

发送任务：

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

`SendMessage` 阻塞到任务落定。成功响应的任务处于 `TASK_STATE_COMPLETED`；
可见回复是 `result` artifact。工具调用、工具结果与 reasoning 不是 artifact。
复用同一个 `contextId` 可继续同一段对话；复用同一个 `messageId` 可幂等重试。

要接收进度而不是阻塞等待，用 `SendStreamingMessage` 带
`Accept: text/event-stream` 与 `curl -N`；已创建的任务改用 `SubscribeToTask`。
方法表与帧格式见[HTTP API：A2A 端点](../reference/http-api.zh.md#2-a2a-端点)。

如果实例配置了 token，每次调用都要加：

```sh
-H 'authorization: Bearer <token>'
```

## 连接一个远端 agent

需要远端 agent 的 AgentCard URL；若远端要求鉴权，还要 token。

在 **设置 → A2A 连接 → 出站 Servers**：

1. 粘贴 AgentCard URL（和 token），点 **导入**。
2. 核对读到的名称、版本、描述、端点与技能。
3. 确认本地名称、preset、超时，点 **连接**。

连接成功的卡片显示状态、导入技能数与已注册工具数。每个启用的远端技能变成一个模型工具：

```text
a2a__<连接名>__<技能 id>
```

连接名 `weather`、远端技能 `chat` 对应工具 `a2a__weather__chat`。参数为：

```json
{
  "prompt": "要发给远端 agent 的任务或指令",
  "taskId": "可选：续接一个被中断的远端任务"
}
```

让模型使用它：

```text
用 a2a__weather__chat 工具，prompt 为 "Reply with exactly OK"，原样显示结果。
```

远端任务失败会抛出带远端消息的工具错误；`INPUT_REQUIRED` 与 `AUTH_REQUIRED`
以文本返回并带上远端 `taskId`，模型可以用该 id 继续。

## 检查两个方向

```text
/a2a inbound list
/a2a outbound list
/a2a tasks
/a2a sessions
```

面板的 **连接与任务** 页把同样的数据展示为对端、会话、任务三张表，带取消与关闭操作。

接下来：[核心概念](concepts.zh.md)解释实例、preset 与会话的关系；
[运维指南](operations.zh.md)讲面板与配置；[排障](troubleshooting.zh.md)处理
空回复、401 与连接失败。
