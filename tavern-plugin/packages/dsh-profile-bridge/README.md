# 官方桌面 Profile 桥接（Tavern 兼容版）

基于 [2NF/dsh-profile-bridge](https://github.com/2NF/dsh-profile-bridge) 的 MIT 版本 0.2.0，来源提交 `6917177806fcff7d9def83a881c47f8936a70278`；保留原作者 LICENSE。

官方桌面仍从 `profiles/desktop` 启动，通过目录链接使用 `profiles/tavern`。这不是官方原生 profile 选择器；配置是独立目录，会话、凭据等仍遵循 DSH 的共享数据规则。

两边都安装此插件后，在设置 → 配置档案选择目标，然后在两分钟内正常退出应用。助手等待 GUI 和宿主全部退出再切换；重新打开应用即可。原版 desktop 保存为 `desktop.fresh-*`，可从此设置页还原。

兼容修正：不再修改目标 YAML；不强杀进程；无备份不删除入口；失败恢复原入口；并发请求被 pending 锁拒绝。异常终止遗留的 `profile-bridge/pending` 需先确认助手已退出，再人工检查记录，避免自动抢占未完成操作。

## 使用与验证范围

2026-10-17 已在 macOS 官方桌面 0.2.1-rc.2 验证 `tavern → 原版 desktop → tavern` 往返：两边设置页都能打开“配置档案”，正常退出后切换，重新启动后正确加载。Windows 目录 junction 逻辑暂未实机验证。

- 返回原版：设置 → 配置档案 → 还原为独立 profile，正常退出后重新打开。
- 返回酒馆：原版设置 → 配置档案 → 选择 tavern → 使用它，正常退出后重新打开。
- 宿主名称可能仍显示 desktop；“链接到 tavern”才表示实际读取独立 tavern 目录。
- 切换前结束生成任务，不要同时从命令行启动相关 profile。切换只改变配置目录入口，不复制或迁移存档；各配置的数据位置由其自身设置决定。
- 保留 `desktop.fresh-*`，它是还原原版配置所必需的目录；完整备份应同时包含 profiles、profile-data 及其他自定义数据目录。

测试版桌面安装器自动准备独立 tavern、安装两边的切换入口，并在验证成功后建立目录链接。安装和更新始终写入 tavern，保留原版配置。

此功能已纳入测试版桌面安装流程。不要直接将原版插件覆盖到此兼容版上；安装与备份说明见仓库 README-0.2.1-rc.2.md。
