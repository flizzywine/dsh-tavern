# DSH 0.2.1 官方 Desktop 适配记录

核验日期：2026-10-17。分支：`0.2.1版本`。Tavern 版本仍为 2.7.0；宿主适配版本为 `0.2.1-rc.2`。

## 宿主与安装入口

[官方 DeepSeek Harness 下载页](https://deepseek.com/harness/)提供 Windows / macOS 桌面版。本分支的 Desktop 安装改用官方宿主，不再依赖社区 DSH Desktop 的终端与 Profile 切换器。

- 官方宿主固定使用 `profiles/desktop`。首次升级合并原 `profiles/tavern` 的自定义插件与用户补丁，当前 desktop 设置后应用；旧配置保留。旧二次启动插件 dsh-tavern-launcher 不再启用。
- 酒馆的数据、正文与 DSH 会话继续使用 `profile-data/tavern/`，不因配置名称改变而另建空存档。
- 系统终端安装会发现官方应用，使用其 Electron Node 模式、内置 pnpm 与 DSH。自定义程序位置可用 `DSH_DESKTOP_APP_EXECUTABLE` 指定。
- 官方 CLI 禁止启动或 dump 保留的 desktop 配置。安装验证直接调用宿主 `loadProfileDirectory` / `composeEntries`，并拒绝把跳过插件的配置记为安装成功。
- 一键包在构建目录展开官方 ASAR，加入 Tavern 启动入口，保留独立数据目录、安装失败重试、快捷方式和旧进程归属判断。此发行包的宿主由 Tavern Setup 更新，不使用上游独立应用更新器；普通官方应用不受影响。
- CLI 继续使用独立 DSH；Android 路线没有改成桌面宿主。

Windows 官方输入来自[固定版本下载](https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.2-win-x64.exe)，并与[官方 Windows 更新源](https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml)的 SHA-512 校验一致。工作流固定 SHA-256：`72e4a8579f11b5428dd0a1506532777924adba7ecaacc710a7e429085796537f`。

## 插件核验

| 插件 | 处理 |
| --- | --- |
| dsh-mnemon | 0.5.29 → 0.5.31，使用上游的 DSH 0.2.1 适配 |
| dsh-pocket | 2.11.0 → 2.12.0，并重新生成酒馆手机服务入口补丁 |
| dsh-better-sidebar | 保持 0.28.0，核验时已是当前版本 |
| dsh-web-mobile | 保持 3.1.0，仅 Android 使用 |
| Mnemon source-runtime / source-documents | 保持 0.5.14 / 0.5.10 |
| Dream Skin | 保留项目内置 9.23.0；上游已有 10.16.0，本次未替换主题实现 |
| Image Gen | 保留项目定制 0.3.0-flizzywine.1；不直接用上游 0.9.1 覆盖定制功能 |

版本来源为各包的 npm registry 元数据。依赖冻结安装已通过，Mnemon/Pocket 相关 23 项测试通过。以上保留项不等同于宣称其上游没有新版。

## 已执行验证与边界

- 本机已安装的官方 macOS `DeepSeek Harness.app`：内置 DSH 0.2.1-rc.2、pnpm 11.28.5。
- 临时 DSH_HOME 中完成实际安装与官方配置校验：7 个插件包、198 个配置条目。
- 通过官方 `dsh-desktop-host` 启动临时安装，收到 ready；完成浏览器令牌交换后页面 HTTP 200；正常关闭。未改用户实际 DSH_HOME。
- 官方 Windows 输入完成下载校验与构建用 ASAR 展开；此项在 macOS 执行，只证明包布局和展开逻辑，不代表 Windows 可执行程序已运行。
- 安装、配置、用户插件、更新器与文档相关 70 项测试通过；追加旧启动器迁移用例后，配置测试 15 项通过。额外生命周期/下载相关测试 5 项通过，4 项 Windows 专属测试在 macOS 跳过。
- 安装器内嵌模块、Shell 语法、工作流 YAML、客户端与插件生成物检查通过。
- Windows 工作流已配置中文路径、安装失败重试、旧/新宿主进程归属、运行时发布、冷/热 pnpm 安装和当前提交的在线安装验证。尚未执行 Windows CI，尚未生成或发布新 EXE；文档已撤下旧社区宿主安装包的推广入口。

存档统一升级和五份失败存档修复见本分支此前的独立提交；本次宿主切换不直接改写用户存档。
