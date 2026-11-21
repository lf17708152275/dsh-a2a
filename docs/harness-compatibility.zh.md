---
name: Harness 兼容性
description: 耦合面、迁移到另一个 DeepSeek Harness 版本的流程、当前状态与已知陷阱
update-time: 2026-11-18
---

# Harness 兼容性

[English](harness-compatibility.md) · **中文**

插件针对同级的 DeepSeek Harness checkout 构建，而不是针对已发布包。harness 的某个
版本可能改变构建布局、manifest 契约或运行时 API 假设，所以本页是这套耦合的维护流程。
组件设计见[架构](architecture.zh.md)。

## 什么时候跑这个流程

- 同级 `../deepseek-harness` checkout 换到新 tag 或 `origin/master`。
- harness 以 `incompatible-version` 拒绝加载插件。
- 发布 dsh-a2a 之前：说明它对哪个 harness 版本做过验证。

## 耦合面

| 面 | 位置 | harness 改动会造成什么 |
|---|---|---|
| 依赖版本 | `package.json` 的 `peerDependencies` | DSH peer 范围不再覆盖运行时，预检拒绝插件 |
| 构建布局 | `tsconfig.json`、`tsconfig.client.json`、`tsconfig.types.json` 的 `references` | 被引用的包拆分、改名或不再是 composite；`tsc -b` 在读源码前就失败 |
| 挂载与 manifest 契约 | `cordis.patch.yml`、`dsh.bundle.patch`、`dsh.client.inject`、`scripts/build-client.mjs` | `- insert:` patch 形式、客户端注入列表或 `window.__ModuleLoader__.load({ id, factory })` 契约变化 |
| 运行时 API | `ctx.a2a`、`ctx.slots.inject('settings.section', …)`、存储 `KvTable`、commands、preset/skill/subagent 数据 | 被消费的服务签名或数据结构移动 |
| 会话事件流 | `src/server/exec/agent-runtime.ts` 对 `session/event` 的 `tool/call` / `tool/result` 监听 | trace 观察丢失 call id、错误标志或事件时序；只有真实 harness 证据能抓到 |

四者按检查成本排序：版本与构建布局失败得早且响；运行时 API 由消费方类型检查、真实
持久化套件与 e2e 冒烟覆盖。

## 流程

### 1. 确认 harness 版本

harness 没有 changelog；版本就是根 `package.json` 的 `version`，发布 tag 是
`dsh-v<semver>`。

```sh
cd ../deepseek-harness
grep -m1 '"version"' package.json
git status -sb && git log --oneline -3
git fetch origin --tags --prune
git ls-remote --tags origin | grep -v '\^{}' | awk -F/ '{print $NF}' | sort -V | tail -10
```

`git ls-remote` 反映上游状态，与本地已 fetch 的内容无关；只看本地 tag 列表可能落后
好几个发布线。

### 2. 刷新 harness 构建产物

harness 的 `lib/` 输出被 gitignore，且会跨版本切换保留，所以陈旧的产物 plane 会让
插件对上一个版本做类型检查。切换版本还可能留下没有 manifest 的包目录，被宿主
workspace glob 扫到。

```sh
pnpm install --frozen-lockfile
pnpm run clean
pnpm run build
```

### 3. Diff 耦合面

```sh
cd ../deepseek-harness
git diff <from> <to> -- vendor/cordis vendor/schemastery | head -40
git diff <from> <to> -- packages/client/ui-settings packages/storage packages/interaction | head -40
git diff <from> <to> -- tsconfig.base.json tsconfig.base.client.json tsconfig.client.json tsconfig.host.json
```

### 4. 对新 checkout 验证

```sh
cd ../dsh-a2a
pnpm typecheck   # 宿主 + 客户端 + 镜像检查
pnpm test        # 单元 + 组合 + 真实持久化
pnpm build       # tsc + tsdown + scripts/build-client.mjs
pnpm test:e2e    # 对已构建产物跑双实例 A2A hermetic 冒烟
```

兼容性变更不能只拿 `pnpm test` 当证据：它跑的是 stub 宿主服务，看不见持久化编解码
或 manifest/挂载漂移。镜像检查与 e2e 冒烟才能；见[测试](testing.zh.md)。

如果删掉 `lib/` 后干净重建却 no-op，是因为 TypeScript 构建缓存还在：先清
`node_modules/.cache/dsh-a2a/`，否则 `tsc -b` 信任陈旧 tsbuildinfo，tsdown 随后
找不到入口。

### 5. 优先改元数据

先修项目引用、peer 范围或版本号。必须改源码时，同一次改动里加或调整行为测试。

### 6. 验证 peer 预检

DSH 0.1.7 起会在导入前按运行版本评估插件的 `@deepseek-ai/dsh` 与
`@deepseek-ai/dsh-*` peer。预发布版本参与范围匹配，`workspace:^`/`~`/`*` 指向
运行版本。拒绝时携带 `incompatible-version` 码与不满足的范围；插件管理器会在 pnpm
执行前拒绝 registry 安装。

预检忽略 `@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery`。只有
`@deepseek-ai/dsh-commands` 与 `@deepseek-ai/dsh-storage-domain` 参与。保持这两个
范围对每个测试过的 harness 版本都真实。另外两个不被评估，但声明的范围仍必须接纳宿主
vendored 的副本，包括宿主线 vendored 的精确预发布版本。

要绕过真实不匹配，给精确豁免，而不是不诚实地放宽范围：

```sh
dsh plugin allow-version <pkg@version> --dsh-version <runtime> --accept-risk
dsh plugin version-exemptions
dsh plugin revoke-version <pkg@version> --dsh-version <runtime>
```

### 7. 记录、提交、打包、发布

在同一次提交里 bump `package.json` 的 `version`，在提交消息里写明验证过的 harness
版本，并打出 tarball：

```sh
pnpm pack --pack-destination <dir>
```

本 fork 从仓库安装，不发布到 npm：npmjs 上的 `@hanphone/dsh-a2a` 是上游发布，
把 fork 发布到那个名字下不在范围内（若真要打包发布，`publishConfig.access: public`
仍然有效）。那里的
`403` 是 npm 凭据问题，不是包问题。没有明确要求不发布。

`lib/` 已提交进 git：两个 bundle 与 `.d.ts` 类型面随代码发布，所以
`dsh plugin add github:…` 在没有 harness checkout 的机器上也能装（tsc 的 JavaScript
中间产物仍然忽略）。`prepare` 与 `prepack` 都会调用 `scripts/ensure-lib.mjs`：存在同级
`../deepseek-harness` 时，`lib/` 缺失或比 `src/` 旧就重新构建；没有该 checkout 时直接
使用已提交的产物，并在 `src/` 比产物新时告警——这正是「改了源码忘了重建就提交」的特征。
脚本在构建前还会清掉 TypeScript 增量缓存——残留的 tsbuildinfo 会让 `tsc -b` 空转，而
`lib/` 已经不在。

发布前检查打包产物：

```sh
tar tzf dsh-a2a-<version>.tgz | grep -E '^package/lib/(index|client)\.js$'
```

## 当前状态

`0.5.5` 已对 harness `0.2.2-rc.3` 验证：`pnpm typecheck`（宿主 + 客户端 + 镜像
检查）零错误、`pnpm test`（199/199）、`pnpm test:integration`（6/6）、`pnpm build`
产出 `lib/index.js` 与 `lib/client.js`、`pnpm test:e2e` 在两个真实实例间跑通入站与
出站往返，并验证可选 trace 扩展的卡片宣告与 header 回显。`0.2.2-rc.1` 至
`0.2.2-rc.3` vendor 了 cordis `4.1.0` 与 schemastery `3.19.0`，cordis peer 范围
因此放宽到 `>=4.0.2 <4.2`；它们的 waterfall 把续延改成无参 thunk：`next()` 不再
接收参数，`a2a/inbound-task` 监听者通过就地修改 decision 传递改动，插件的末端回调
改为闭包。
`0.2.2-alpha.2` 把工具执行器改成显式的组合条目，并把
`defineContentToolFixture` 移到 `@deepseek-ai/dsh-tool-testkit`；集成测试的 harness
现在挂载 `@deepseek-ai/dsh-tool-executor-native`，fixture 从 testkit 导入。
`0.2.2-alpha.2`、`0.2.1-rc.3` 与 `0.2.1-rc.2` 仍在矩阵中；`0.2.1-alpha.2` 与
`0.1.7-rc.2` 由定时矩阵覆盖。

`0.2.2-rc.2` 把 harness 自身的 `zod` 从 `4.4.3` 升到 `4.6.6`，本插件不跟随。它让
`dependencies.zod` 留在 `~4.4.3` 线上，并把 schema 唯一一次进入宿主的地方——
`src/server/store.ts` 里交给 `domainTable()` 的 `a2aDomainSpec`——按宿主签名
（`Parameters<typeof domainTable<string, V>>[0]`）声明，而不是按自己那份 zod。
宿主用 `parse` 校验记录，运行时契约与 patch 版本无关；真实持久化与 e2e 套件会在
运行中的宿主上走这条路径。这样源码对矩阵里的每一代 harness 都能构建，而不是只对
zod patch 号刚好一致的那一代。将来若要在边界上使用更新的 zod 类型特性，必须重新
审视这处断言。

## 已知陷阱

- **`tsc -b` 看起来成功但 `lib/` 是空的。** 陈旧的 tsbuildinfo；清
  `node_modules/.cache/dsh-a2a/`。
- **客户端类型检查读到旧声明。** harness 的 `lib/types` 被 gitignore，且会跨
  checkout reset 保留；切换版本后重建被引用的包。
- **没有 manifest 的 harness 包残留。** 重建前在 harness 跑 `pnpm run clean`；
  否则 tsdown 的 `packages/*/*` glob 会打包遗留的 `lib/types` 输出，以
  `MISSING_EXPORT` 失败。
- **两份 zod。** 宿主用自己那份 zod 给存储 API 标注类型，因此来自另一份副本的
  schema 即使同为 `4.x` 也不可赋值。把这个边界按宿主签名声明
  （`src/server/store.ts` 的 `a2aDomainSpec`），不要把 `dependencies.zod` 钉到宿主的
  patch 号——那会把构建绑死在单一代 harness 上。
- **每次跑脚本前 `ERR_PNPM_NO_MATCHING_VERSION`。** harness peer 在其真实范围内没有
  registry 版本。pnpm 11+ 从 `pnpm-workspace.yaml` 读 `autoInstallPeers: false` 与
  `verifyDepsBeforeRun: false`；只写 `.npmrc` 不够。
- **solution 引用导致 TS6306。** 暴露 solution `tsconfig.json` 的 harness 包必须
  经它的 `tsconfig.client.json`（或 `tsconfig.host.json`）叶子引用。
- **测试里导入 harness 源码报 Vite `SyntaxError`。** harness 源码使用标准 TypeScript
  装饰器；`vitest.config.ts` 安装了 harness 的 `standardDecoratorPlugin`。
- **spec 导入没有命中 harness 的 paths 映射。** Vite 8 原生
  `resolve.tsconfigPaths` 只对 tsconfig include 的文件应用 `paths`。
  `tests/tsconfig.json` 继承构建配置并 include 了 specs。

## 已知限制

- 没有测过正式版；已验证过的 harness 版本全是预发布。
- 插件通过 `../deepseek-harness` 按路径耦合 harness 包。换到别的相对路径需要更新
  `tsconfig*.json` 的引用。
- **冷启动时的工具注册。** 出站工具在重连的 AgentCard 抓取完成后才出现，而 profile
  挂载不会等待这次抓取。任务已经放在命令行上（或 stdin 已关闭）的一次性 headless
  运行，可能在工具注册前就发出第一次模型请求；harness 会用 `tool-addition`
  developer 消息在会话中途宣告新增工具，模型可以重试，但第一次调用会以
  `unknown tool` 失败。e2e 之所以在 profile 挂载后才把任务写进 stdin，正是这个原因。
