# DSH 0.1.2-alpha.1 / DSH Desktop 2.0.4 兼容性调研

日期：2026-08-30

## 结论

最新 DSH Desktop 2.0.4 使用 DSH `0.1.2-alpha.1`。当前 dsh-tavern 无法在这个组合上可靠安装，存在两个已经由官方源码和包清单确认的硬断点：

1. dsh-tavern 会把 `@deepseek-ai/dsh-tools` 和 `@deepseek-ai/dsh-subagent` 强制对齐到宿主 DSH 版本；但 `0.1.2-alpha.1` 没有发布到 npm，安装时会直接得到 404。
2. Tavern Web 客户端仍直接注入 `@deepseek-ai/dsh-client-runtime`；这个单体包已经在 alpha 中删除，拆成了多个客户端模块。

因此，安装失败不是用户环境偶发故障，也不应靠清缓存解决。需要适配，但不必放弃旧版兼容：`0.1.1-rc.2` 和 `0.1.2-alpha.1` 可以由同一版 dsh-tavern 同时支持，前提是把宿主内部包依赖收口到 Host Adapter，并按宿主能力选择实现。

## 调研基线

| 项目 | 版本 / 提交 | 说明 |
| --- | --- | --- |
| dsh-tavern | `main` / `4f5e545b5dbeb292f7e4610f5873e94eae38061c` | 本次对比基线 |
| DSH | [`dsh-v0.1.1-rc.2`](https://github.com/deepseek-ai/deepseek-harness/tree/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e) / `b150a551…` | 旧版基线 |
| DSH | [`dsh-v0.1.2-alpha.1`](https://github.com/deepseek-ai/deepseek-harness/tree/cd5ef8148158c3a752a658978873241fdf8e2bbc) / `cd5ef814…` | 最新 alpha |
| DSH Desktop | [`v2.0.4`](https://github.com/anywhere-labs/dsh-desktop/releases/tag/v2.0.4) / `d29bf7a9…` | 使用 DSH `0.1.2-alpha.1`；社区维护的 Desktop 项目 |

DSH 的 [alpha 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.1)明确列出：旧 `ApiProxy` 已移除并迁移到 `@Remote`、会话 UI 大规模拆分、应用统一由 Profile 启动、Web UI 增加一次性令牌认证，以及 Code Mode 改名为 PTC Mode。DSH Desktop 2.0.4 的发布说明也明确提醒，上游破坏性更新可能导致大量插件暂时不可用。

## 当前安装失败的确定链路

### 1. 安装器请求了不存在的 alpha npm 包

dsh-tavern 当前在 [`bin/dsh-tavern.mjs`](../../bin/dsh-tavern.mjs) 中读取宿主 DSH 版本，然后用 `pnpm.overrides` 把下面两个插件依赖强制锁成相同版本：

- `@deepseek-ai/dsh-subagent`
- `@deepseek-ai/dsh-tools`

这两个依赖由 [`tavern-plugin/package.json`](../../tavern-plugin/package.json) 直接声明。宿主为 `0.1.2-alpha.1` 时，安装器会请求同版本 npm 包。

截至 2026-08-30，npm 官方注册表中 `@deepseek-ai/dsh`、`@deepseek-ai/dsh-tools` 和 `@deepseek-ai/dsh-subagent` 的最高公开版本仍是 `0.1.1-rc.2`；请求两个辅助包的 `0.1.2-alpha.1` 均返回 `E404`。DSH 的 GitHub alpha Release 也没有提供可供插件安装器使用的 release asset。

DSH Desktop 2.0.4 之所以能运行 alpha，是因为其官方源码清单把 alpha 包写成随 Desktop 自带的本地 tarball，例如 [`package.json`](https://github.com/anywhere-labs/dsh-desktop/blob/d29bf7a965fc68bf09750bc329905ecb17afe48b/package.json#L22-L36) 中的 `file:vendor/dsh-runtime/0.1.2-alpha.1/*.tgz`，而不是从 npm 下载；`dsh-subagent` 也采用同一方式（[清单位置](https://github.com/anywhere-labs/dsh-desktop/blob/d29bf7a965fc68bf09750bc329905ecb17afe48b/package.json#L122-L125)）。

所以，“Desktop 已经带着 alpha 正常运行”并不意味着第三方插件可以按 alpha 版本号从 npm 安装其内部包。

### 2. 直接注入的客户端包在 alpha 中已经删除

[`tavern-plugin/package.json`](../../tavern-plugin/package.json) 当前声明：

```json
{
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-runtime"]
    }
  }
}
```

`@deepseek-ai/dsh-client-runtime` 在 `0.1.1-rc.2` 存在，但 `packages/client/runtime` 已在 `0.1.2-alpha.1` 中整体删除。alpha 将它拆成 Session、Workspace、Renderer、连接和远程调用等多个模块。

不过，`@deepseek-ai/dsh-client-ui-conversation` 在两个版本中都存在，而且它正好承担稳定入口的作用：

- [rc.2 清单](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/package.json#L32-L44) 会传递注入旧 `dsh-client-runtime` 等单体服务。
- [alpha 清单](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/client/ui-conversation/package.json#L32-L44) 会传递注入拆分后的新服务。

因此，用 `dsh-client-ui-conversation` 替代 Tavern 对旧 `dsh-client-runtime` 的直接依赖，是同时覆盖新旧宿主的首选方向。仍需分别启动两个版本做运行验证。

## 其他接口变化与风险

### Host 服务大体仍在，但部分调用入口已经改变

Tavern 客户端实际请求的 `slots`、`sessions`、`workspaces`、`layout`、`conversation`、`remote` 等能力，在 alpha 的拆分模块中大多仍能找到提供者，不需要整体重写业务。不过，以下现有调用已经确认不能原样工作：

- Workspace 连接：rc.2 使用 `workspaces.connectWorkspace(workspaceId)`；alpha 已把它移动到 `uiWorkspace.connectWorkspace(workspaceId)`。
- Workspace 标识：现有代码读取 `recentWorkspaceId` 或 `items[0].id`；alpha 的快照条目使用 `items[0].workspaceId`。
- 预设切换：现有代码调用 `connection.api.agentPresets.select({ sessionId, agentPreset })`；alpha 删除 ApiProxy，改为 `remote.agentPresets.select(sessionId, agentPreset)`。
- 预设状态：现有代码切换后调用 `sessions.noteAgentPreset(...)`；alpha 已没有这个方法，状态由新的远程调用结果和会话流更新。

这些差异适合由客户端 Host Adapter 做能力检测，而不是让游玩 UI 到处判断 DSH 版本。

### Agent Preset 目录应改用正式配置

Tavern 当前直接修改 `agentPresets.resolvedRoots`，把自己的预设目录插入宿主内部数组。alpha 已正式支持 `agent-presets.config.roots`，并在发布说明中修复了 Profile 配置的 Agent Preset 目录丢失问题。

因此 alpha Adapter 应使用公开的 `roots` 配置；只有 rc.2 确实需要时才保留旧的运行时注入。否则即使安装成功，也可能继续受到宿主内部字段变化影响。

### `defineTool` 仍存在，但不应继续由插件安装宿主内部副本

Tavern 服务端目前从 `@deepseek-ai/dsh-tools` 导入 `defineTool`，并向宿主 Tool Registry 注册工具。`defineTool` 在 rc.2 与 alpha 中都还存在，因此工具定义语义不是眼前的破坏点。

真正的风险是插件为了取得一个宿主辅助函数，又安装一套与宿主同名的 DSH 包。alpha 未发布 npm 包已经让这条路径失效；即便以后发布，也容易形成 Host 与插件各加载一份 Cordis/服务类型的情况。更稳妥的边界是：Tavern 自己保存普通 ToolDefinition 数据，由 Host Adapter 把它交给宿主 Registry，而不是让插件复制宿主内部运行时。

### Subagent descriptor 已发生持久格式升级

Tavern 后台 Agent 通过 [`background-agent-runner.js`](../../tavern-plugin/lib/background-agent-runner.js) 调用 `snapshotSubagentDescriptor`。这个函数虽然两个版本都有，但描述符版本已经从 rc.2 的 [`2`](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/subagent/subagent/src/descriptor.ts#L47) 升为 alpha 的 [`3`](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/subagent/subagent/src/descriptor.ts#L48)。

因此不能简单把 rc.2 的 helper 复制进 Tavern 后永久使用。需要由 Host Adapter 根据宿主版本或能力选择 descriptor 生成方式，并把版本差异限制在一个很小的模块内。

### Profile 的加载规则变得更明确，但不会自动修好 Tavern

alpha 的 [Profile 加载源码](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/boot/app-boot/src/profile.ts#L568-L592) 会在 `$DSH_HOME/profiles/node_modules` 建立与宿主安装闭包一致的模块回退，并允许 Profile 本地 bundle 依赖加入其中。这有利于 Profile 复用宿主包。

但 Tavern 插件当前由源码路径链接，并从自身模块直接导入 `dsh-tools` / `dsh-subagent`。在不同平台、打包方式和 Node realpath 规则下，不能只凭 Profile fallback 就断言这些导入一定解析到正确的宿主副本。应通过 Host Adapter 消除这项隐式假设，而不是依赖路径巧合。

### 预设和 Node 版本不是当前主因

- Tavern 预设引用的 `dsh-persona`、`dsh-fs-local`、字符串替换工具、Skill 文件系统、上下文压缩等包在 alpha 源码中仍存在。
- alpha 官方根清单要求 Node `^22.19.0 || >=24.0.0`（[来源](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/package.json#L7-L10)），与 dsh-tavern 当前安装提示一致。

它们仍需端到端验证，但不是已观察安装失败的第一原因。

## 建议适配方案

### P0：先恢复可安装和可启动

1. 安装器不要再把 Tavern 插件内部的 `dsh-tools` / `dsh-subagent` 强制覆盖为宿主版本。alpha 对应包不在 npm，这条策略已经不可持续。
2. 将客户端入口从已删除的 `@deepseek-ai/dsh-client-runtime` 改为跨版本存在的 `@deepseek-ai/dsh-client-ui-conversation`。
3. 安装时明确识别宿主版本：至少区分 `0.1.1-rc.2` 和 `0.1.2-alpha.1`，遇到未验证版本给出可操作的错误，而不是继续安装后报模糊的 Profile 挂载错误。
4. 不要在 alpha 中安装 rc.2 的 `dsh-tools` / `dsh-subagent` 充数；这可能把两代 Cordis 服务和描述符混入同一进程，重现重复 provider 或持久格式错误。

### P1：把宿主差异收口到 Host Adapter

1. 工具注册：Tavern 保留普通 JSON Schema 工具定义；Host Adapter 负责注册到 `ctx.get("tools")`，尽量去掉对 `defineTool` 包的运行时导入。
2. 后台 Agent：Host Adapter 负责构造/快照 subagent descriptor，按宿主能力选择 descriptor v2 或 v3。
3. 客户端启动：Host Adapter 只暴露 Tavern 需要的 `sessions`、`workspaces`、`conversation`、`remote` 等宿主能力；业务模块不认识具体 DSH 客户端包名。
4. 客户端操作：在 Adapter 内归一化 Workspace ID、Workspace 连接和 Agent Preset 切换；alpha 不再调用已删除的 `noteAgentPreset`。
5. 预设目录：alpha 使用公开的 `agent-presets.config.roots`，旧版仅在需要时保留 `resolvedRoots` 兼容路径。
6. 启动诊断：记录宿主版本、选中的 Adapter、所需服务是否存在，以便真正的不兼容能直接定位。

这符合项目既定边界：Tavern 业务与脚本运行模块不应了解宿主替换细节，版本差异只由桥接层承担。

### P2：再验证 alpha 的新能力

`ApiProxy -> @Remote`、一次性 Web Token 和 PTC 命名变化，不一定都会触及 Tavern 的现有路径。应先恢复启动，再针对真实调用边界做验证；不要因为发布说明出现这些名词就提前大改所有网络和会话代码。

## 是否能兼容旧用户

可以，建议采用“宿主能力检测 + 双 Adapter”，而不是把最低版本直接抬到 alpha：

| 用户环境 | 行为 |
| --- | --- |
| DSH `0.1.1-rc.2` / 旧 Desktop | 继续选择 rc.2 Adapter；客户端稳定入口的传递依赖会装载旧 runtime |
| DSH `0.1.2-alpha.1` / Desktop 2.0.4 | 选择 alpha Adapter；客户端稳定入口会装载拆分服务；descriptor 使用 v3 |
| 未验证版本 | 阻止危险的半安装，显示宿主版本和支持范围 |

对旧用户不应有 Tavern 数据迁移：人物卡、世界书、会话等数据仍位于 Tavern 自己的 Profile 数据目录。宿主从 rc.2 升级到 alpha 后，应重新执行一次 dsh-tavern 安装/更新，使 Profile 依赖和锁文件按新宿主重建，并保留更新前备份以便回滚。alpha 是预发布版本，不建议对所有旧用户强制升级。

## 必须通过的验证矩阵

每个版本都要覆盖“全新安装”和“已有 Tavern Profile 升级”两条路径：

1. DSH `0.1.1-rc.2` / 对应旧 Desktop。
2. DSH `0.1.2-alpha.1` / DSH Desktop 2.0.4。

验证项：

- 依赖安装和 `--dump-config`。
- Tavern Profile 启动、停止、重启。
- Web 客户端加载，无缺失服务和重复 Cordis provider。
- 新建、恢复普通游玩和兼容模式会话。
- Tavern 工具注册、读取和写入。
- 后台候选项 / subagent 启动和恢复。
- Tavern 预设挂载与模式切换。
- 旧 Profile 数据完整，升级失败可回滚。

只有构建或 `pnpm test` 通过不能证明兼容；这次变更集中在 Profile、模块解析和宿主服务装载，必须分别启动真实宿主验证。

## 官方来源

- DeepSeek DSH [`dsh-v0.1.2-alpha.1` Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.1)
- DeepSeek DSH [`dsh-v0.1.2-alpha.1` 源码](https://github.com/deepseek-ai/deepseek-harness/tree/cd5ef8148158c3a752a658978873241fdf8e2bbc)
- DeepSeek DSH [`dsh-v0.1.1-rc.2` 源码](https://github.com/deepseek-ai/deepseek-harness/tree/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)
- DSH Desktop [`v2.0.4` Release](https://github.com/anywhere-labs/dsh-desktop/releases/tag/v2.0.4)
- DSH Desktop [`v2.0.4` 包清单](https://github.com/anywhere-labs/dsh-desktop/blob/d29bf7a965fc68bf09750bc329905ecb17afe48b/package.json)
- npm 官方注册表：`@deepseek-ai/dsh`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-subagent`，查询时间 2026-08-30
