---
name: tavern-plugin
description: "编写或修改给 DSH Tavern 用的插件：文生图、文生视频、配音、插图显示、正文标记、插件按钮与面板，以及记忆、状态、世界演进这类参与提示词和后台结算的插件。用户要做这类插件时使用；普通人物卡、世界书和通用工具不使用。"
---

# Tavern 插件

插件只通过 Tavern 开放的接口与 Tavern 交互，Tavern 更新后插件不需要改。

## 先读文档

用 `tavern_read_skill_reference`（name 为 `tavern-plugin`）读取 `references/` 下的文件：

- `plugin-api.md`：接口总览与快速开始，动手前必读；再按需要读分页 `plugin-api-game.md`、`plugin-api-prompt.md`、`plugin-api-data.md`、`plugin-api-cards.md`、`plugin-api-ui.md`。
- `plugin-recipes.md`：按要做的插件找写法。
- `plugin-tasks.md`：插件的后台任务要接在 Tavern 的任务后面、或在成员上跑时读（任务表、`job`、`member`、`needs`）。
- `example-plugin.md`：起步代码。
- `plugin-publishing.md`：用户要把插件分享出去时读。
- `interface-skin.md`：用户只想换外观时读；皮肤是一个 .css 文件，不是插件。

## 硬性要求

- 只用接口文档列出的 `tavern`、`tavernUi` 服务和 DSH 自带服务（`llm`、`credentials`、`attachments` 等），用 `ctx.tavern.方法名()` 的形式调用。
- 要接管官方 MVU 结算时，先读 `plugin-api-game.md` 的 v4 provider 合约；仅卡内插件可注册，按 `apiVersion` 与 `capabilities.mvuSettlementProvider` 检查能力，不用 `setVariables` 快照冒充 MVU 结算。
- 除了插件自己的文件夹，不读写 Tavern 程序目录和数据目录，不打补丁。接口做不到的，如实告诉用户，建议到 Tavern 仓库提接口需求。
- 插件设置用 `savePluginData` 存，密钥用 `credentials`，都不写进插件文件夹（更新插件会整体替换它）。
- 生图等收费请求不要自动重试；失败时把媒体项标为 `failed` 并写明原因。

## 放在哪里

一个插件一个文件夹，放进数据目录的 `plugins/<名称>/`（写法见接口总览「快速开始」）。不要放进 `tools/` 或 `tools.cordis.yml`。

## 验证

新放进去的插件不用重启：宿主侧几秒内加载，浏览器侧刷新页面后出现；改了已加载的 `index.mjs` 要重启 DSH。在一局游戏里实际跑一轮，确认效果出现再报告可用。没加载时，请用户看 设置 → DSH Tavern → 插件 里的状态和原因。
