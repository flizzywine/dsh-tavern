---
name: tavern-plugin
description: "编写或修改 DSH Tavern 插件：媒体、正文标记、按钮与面板，以及参与提示词、记忆、状态和后台结算的插件。普通人物卡使用改卡 Skill，通用工具使用 advanced-capabilities。"
---

# Tavern 插件

用 `tavern_read_skill_reference`（name 为 `tavern-plugin`）先读接口总览 `plugin-api.md`，再按功能读 `plugin-api-game.md`（游戏与轮次）、`plugin-api-prompt.md`（提示词与结算）、`plugin-api-data.md`（媒体与数据）、`plugin-api-cards.md`（卡片与资源）、`plugin-api-ui.md`（浏览器界面）。只使用公开接口：宿主 `tavern`、浏览器 `tavernUi` 与 DSH 服务。`plugin-recipes.md`（常见用法）和 `example-plugin.md`（示例）提供起步代码；插件的后台任务要接在 Tavern 的任务后面或在成员上运行时读 `plugin-tasks.md`（`job`、`member`、`needs`）；用户要求分享插件时读 `plugin-publishing.md`，交付前用插件面板实际安装一次。用户只想换外观时读 `interface-skin.md`：皮肤是一个 .css 文件，不是插件。

## 实现边界

- 用 `ctx.tavern.方法名()` 调用，服务靠调用上下文识别插件所有者。媒体和异步结果绑定接口给出的 gameId、turn、textVersion，不自行推测版本或将过期结果改绑到新轮次。
- 插件只用已公开接口，不修改 Tavern 程序、人物卡或会话文件，也不绕过接口访问 Tavern 数据目录。接口缺少能力时报告具体缺口，建议向上游提交接口需求。
- 设置用 `savePluginData` 保存，密钥用 DSH credentials；两者都不存进会被更新整体替换的插件目录，密钥也不进入代码、普通设置或日志。收费生成失败后报告失败媒体项和原因，不自动重试。
- 开场与插件加载前的旧轮次不会补发结算通知；需要读取时使用公开读接口，不自动生成或付费。插件数据和媒体不随官方游戏存档导出，不承诺完整往返。

## 安装与验证

一个插件放在持久数据目录 `plugins/<名称>/`，`package.json` 声明宿主入口 `index.mjs` 和可选浏览器入口 `client.js`，按示例使用受保护的入口。不再写入 `tools/` 或 `tools.cordis.yml`，那里不能加载浏览器侧。

检查 package JSON、Node 语法与入口路径。新目录插件的宿主侧会在几秒内加载，浏览器侧刷新后出现；修改已加载的宿主代码需要完整重启 DSH。只保存文件不能声称已加载；在设置 → DSH Tavern → 插件检查状态与跳过原因，并核对日志，实际验证相应界面、通知或版本切换后再报告可用。付费调用、重启或真实游戏写入必须在当次授权范围内。

接管官方 MVU 结算前，阅读 `references/plugin-api-game.md` 的 v4 provider 合同：仅卡内插件可注册，检查 `apiVersion >= 4` 和 `capabilities.mvuSettlementProvider === 1`；返回操作交由官方事务提交，不用变量快照写入冒充结算。
