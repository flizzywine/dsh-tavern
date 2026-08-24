# Android 可选组件

这里保存 DSHA 部署使用的两个可选 DSH 插件：

- `dsh-tavern-entry`：在 DSHA Web 启动后检查 3088，必要时自动拉起 Tavern，并每 60 秒复查一次。
- `dsh-client-ui-mobile-adapt`：仅在窄屏下调整 DSH 与 Tavern 的界面布局。

两个插件均来自社区提供的 `dsh-android-plugins.tar.gz`，依照随附 MIT License 合并；为适配本项目，修正了包入口、版本范围、端口、进程生命周期和安装方式。

这些组件不进入桌面端、命令行版的默认依赖。用户只运行 [`setup.sh`](./setup.sh)；它负责首次下载或安全更新，再调用内部的 [`install.sh`](./install.sh) 完成 Android 部署。

手机适配目前仍依赖部分 DSH 前端类名。DSH 或 DSHA 更新后如出现布局异常，应先核对插件与当前前端版本的兼容性。
