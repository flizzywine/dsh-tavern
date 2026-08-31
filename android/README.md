# Android 可选组件

这里保存 DSHA 部署使用的酒馆入口插件：

- `dsh-tavern-entry`：在 DSHA Web 启动后检查 3088，必要时自动拉起 Tavern，并每 60 秒复查一次。

入口插件来自社区提供的 `dsh-android-plugins.tar.gz`，依照随附 MIT License 合并；为适配本项目，修正了包入口、版本范围、端口、进程生命周期和安装方式。

移动端界面由 Tavern Profile 的 `dsh-web-mobile` 提供，当前锁定 `2.3.0`；更新时会迁移 Tavern 管理的旧包名 `@dsh-external/dsh-mobile-nav`。旧的 `dsh-client-ui-mobile-adapt` 已移除，避免两个 UI 适配插件同时运行。

这些组件不进入桌面端、命令行版的默认依赖。用户只运行 [`setup.sh`](./setup.sh)；它负责首次下载或安全更新，再调用内部的 [`install.sh`](./install.sh) 完成 Android 部署。

移动端插件仍依赖部分 DSH 前端结构。DSH 或 DSHA 更新后如出现布局异常，应先核对插件与当前前端版本的兼容性。
