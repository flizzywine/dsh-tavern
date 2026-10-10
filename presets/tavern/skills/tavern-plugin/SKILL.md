---
name: tavern-plugin
description: "编写或修改给 DSH Tavern 用的插件：文生图、文生视频、配音、插图显示、正文标记、插件按钮与面板，以及记忆、状态、世界演进这类参与提示词和后台结算的插件。用户要做这类插件时使用；普通人物卡、世界书和通用工具不使用。"
---

# Tavern 插件

Tavern 为第三方 DSH 插件开放了一套稳定的接口。插件只通过这个接口与 Tavern 交互，Tavern 更新后插件不需要改。

## 先读接口

动手前通过 `tavern_read_skill_reference` 读取 [插件接口](references/plugin-api.md)（name 为 `tavern-plugin`，path 为 `references/plugin-api.md`）。按要做的插件找写法时读取 [常见用法](references/plugin-recipes.md)（path 为 `references/plugin-recipes.md`）。需要起步代码时再读取 [示例插件](references/example-plugin.md)（path 为 `references/example-plugin.md`）。

## 硬性要求

- 只用接口文档列出的 `tavern`、`tavernUi` 服务和 DSH 自带服务（`llm`、`credentials`、`attachments`、`settings` 等）。
- 不修改 Tavern 程序目录里的任何文件，不打补丁，不读写 Tavern 数据目录、人物卡文件或会话文件。接口做不到的事，如实告诉用户做不到，不要绕过。
- 用 `ctx.tavern.方法名()` 的形式调用，不要把方法单独取出来。
- 密钥用 DSH 凭据服务保存，不写进代码、设置文件或日志。
- 生图等收费请求不要自动重试；失败时把媒体项标为 `failed` 并写明原因。

## 放在哪里

一个插件一个文件夹，放进用户数据目录的 `plugins/<名称>/`：`package.json` 声明宿主入口和（可选的）浏览器侧，宿主侧写 `index.mjs`，浏览器侧写 `client.js`。具体写法见接口文档「快速开始」和示例插件。不要放进 `tools/` 或 `tools.cordis.yml`，那里加载不了浏览器侧。

## 验证

写入后检查 `package.json` 能解析、宿主入口能被 Node 解析。新放进去的插件不用重启：宿主侧几秒内加载，浏览器侧刷新页面后出现；修改已加载的 `index.mjs` 要重启 DSH。在一局游戏里实际跑一轮，确认效果出现，再报告可用；跳过的原因写在 Tavern 日志里。
