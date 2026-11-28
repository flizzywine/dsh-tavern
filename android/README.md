# Android 安装与入口组件

当前 Android 推荐方案为原生版独立 APK（见 `android/native/`）。原基于 DSHA 容器的独立 APK 构建方案（`android/apk/`）已封存并停止维护。

此目录保留旧 DSHA 部署与应用内更新脚本及入口插件，仅用于已安装旧版本的应用内更新与历史兼容参考，不再作为用户安装入口，也不再主动维护。

APK 下载、安装、更新和旧数据导入步骤见 [Android 安装说明](https://github.com/flizzywine/dsh-tavern/wiki/Android-%E5%AE%89%E8%A3%85%E4%B8%8E%E6%9B%B4%E6%96%B0)。

这里保存 DSHA 部署使用的酒馆入口插件：

- `dsh-tavern-entry`：在 DSHA Web 启动后检查 3088，必要时自动拉起 Tavern，并每 60 秒复查一次；点击酒馆工作台后在应用内全屏打开窗口，不带工具栏，返回键关闭窗口。
- 内嵌窗口的本机代理由入口插件管理，自动处理酒馆认证；退出插件时关闭监听及连接。

入口插件来自社区提供的 `dsh-android-plugins.tar.gz`，依照随附 MIT License 合并；为适配本项目，修正了包入口、版本范围、端口、进程生命周期和安装方式。

DSHA 不自动安装 `dsh-pocket`；它与 Desktop 的插件选择独立。移动端界面由 Tavern Profile 的 `dsh-web-mobile` 提供，当前锁定 `2.4.1`；更新时会迁移 Tavern 管理的旧包名 `@dsh-external/dsh-mobile-nav`。旧的 `dsh-client-ui-mobile-adapt` 已移除，避免两个 UI 适配插件同时运行。

这些组件不进入桌面端、命令行版的默认依赖。旧部署脚本 `setup.sh` 曾负责下载或更新，再调用 `install.sh` 完成部署；不再提供给用户作为安装方式。

移动端插件仍依赖部分 DSH 前端结构。DSH 或 DSHA 更新后如出现布局异常，应先核对插件与当前前端版本的兼容性。

### 慢设备启动等待

Android 默认最多等待 120 秒，服务就绪后立即继续。可在运行安装、更新或启动命令前设置 `DSH_TAVERN_START_TIMEOUT=180` 调整等待上限（单位：秒）；命令行版默认同为 120 秒。

启动超时会先结束本次启动的进程，再返回失败。安装回滚若发现服务仍在运行或 PID 记录无法核实，会保留当前源码与旧版备份并报错，避免运行中的进程因源码被移走而出现模块缺失。此机制不跳过正常源码更新。
