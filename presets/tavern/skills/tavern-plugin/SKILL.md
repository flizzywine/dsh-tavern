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

只有宿主侧代码时，按「高级能力」Skill 的约定把代码放进用户数据目录的 `tools/<名称>/`，在 `tools.cordis.yml` 里追加加载条目。需要浏览器侧界面时，做成 DSH 插件包。两种方式都要完整重启 DSH 后才会加载。

## 验证

写入后检查模块能被 Node 解析、加载条目指向正确。重启前只能说「已保存，重启后生效」；重启后在一局游戏里实际跑一轮，确认媒体出现在正文里，再报告可用。
