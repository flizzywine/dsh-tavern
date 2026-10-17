# Windows 安装入口

这里维护一键安装 EXE 的外层启动器。宿主固定为官方 DeepSeek Harness 0.2.1-rc.2（内置同版本 DSH），首次联网安装 Tavern，已有数据继续留在原位置。

## 构建

安装包 = 官方 DeepSeek Harness 0.2.1-rc.2 + 外层启动器（自动安装 Tavern）。推荐用 GitHub Actions 的 `Windows Setup` 工作流（`.github/workflows/windows-setup.yml`）构建：它下载上游 `deepseek-harness-0.2.1-rc.2-win-x64.exe` 和 7-Zip extra 包并按 SHA-256 校验，生成 payload、编译启动器、运行 `test.ps1`，并把 EXE 作为 Actions 产物上传。可在 Actions 页面手动触发。

本地构建需要 Windows x64、完整版 7-Zip（读取 NSIS 安装包）和系统自带的 .NET Framework C# 编译器：

```powershell
# 1) 由上游 Desktop Setup 生成 payload（-SevenZip 需完整版 7z.exe）
./packaging/windows/build-payload.ps1 `
  -DesktopSetup D:/build/deepseek-harness-0.2.1-rc.2-win-x64.exe `
  -SevenZip 'C:/Program Files/7-Zip/7z.exe' `
  -OutputPayload D:/build/inputs/online-payload.7z `
  -WorkDirectory D:/build/payload-work

# 2) 编译 Setup.exe（-SevenZip 为嵌入 EXE 的独立 7za.exe，取自 7-Zip extra 包 x64/7za.exe）
./packaging/windows/build.ps1 -Payload D:/build/inputs/online-payload.7z -SevenZip D:/build/inputs/7za.exe -Output D:/build/DSH-Tavern-Harness-0.2.1-rc.2-x64-Setup.exe
./packaging/windows/test.ps1 -Launcher D:/build/DSH-Tavern-Harness-0.2.1-rc.2-x64-Setup.exe -TestDirectory D:/build/new-test-directory
```

`build.ps1` 会把实际嵌入 payload 的 SHA-256 写入编译用的 `Launcher.cs` 副本（`PayloadSha256` 与 `Version` 前缀），无需手工同步哈希。payload 每次构建哈希都会变，因此新安装包总会使用新的运行时目录；`Launcher.cs` 中的值只是最近一次发布的默认值。

旧方式仍可用：从已发布的 Setup 中抽取 `online-payload.7z` 与 `7za.exe`（只适用于哈希 `a272f20b…` 的旧 payload）：

```powershell
./packaging/windows/extract-build-inputs.ps1 -Launcher D:/build/Setup.exe -Destination D:/build/inputs
```

`test.ps1` 会在独立目录真实解压 EXE、读写 Windows 快捷方式，并测试中文路径、下载包移走、旧数据保留、入口补建、断网重试入口和数据目录缺失。桌面、开始菜单写入被 `DSH_LAUNCHER_TEST_ROOT` 隔离到测试目录，不修改真实系统入口或注册表。传入的测试目录必须尚不存在。`--prepare-only` 仅准备运行时和入口；`--tavern-smoke` 联网完成安装后检查实际 Desktop Profile，并写入数据目录下的 `smoke-result.json`。

## 启动与兼容

- `DSH Tavern.exe` 是持久启动入口；快捷方式和 Electron relaunch 都指向它。下载目录里的安装包不参与后续启动。
- `launcher-settings.xml` 记录真实数据目录；当前用户的 `HKCU\Software\DSH-Tavern\InstallRoot` 仅记录程序根目录。运行已安装入口时优先使用入口旁的配置。
- 识别旧版 `%LOCALAPPDATA%\DSH-Tavern-Portable`、`D:\Workspace\.DSH-Tavern` 和 `%LOCALAPPDATA%\DSH-Tavern`。旧数据不移动、不复制、不按新目录重置。已记录的程序目录失效时，提供选择原目录、重新安装或取消；明确选择重新安装后才进入安装位置选择，不自动清除注册表或删除旧文件。配置中已记录的数据目录缺失仍阻止启动，避免误建空白数据。
- 首次运行显示安装目录选择；旧版修复固定原位置，明确告知不迁移。每次启动会补建快捷方式。
- 官方宿主的 app.asar 由 prepare-official-runtime.cjs 在构建临时目录展开；正式安装仍通过 payload 哈希隔离不同运行时，避免修改正在运行的旧版文件。
- `setup2` 使用随安装包嵌入的 `setup-upgrade.mjs` 和 PowerShell 安装器，从 `main` 安装或更新 Tavern。旧 payload 中的实验性 `online-install.mjs` 不再作为安装入口。
- `setup3` 取消准备完成后的整目录移动，并内置包含 `patches/` 的新版安装清单。安装包嵌入的补丁、安装脚本或包管理辅助文件变化时都须提升运行时后缀，避免复用旧目录中的过期脚本。
- `setup7` 给 Tavern 独立的 Windows AppUserModelID（`ai.deepseek.dsh.tavern`），运行时与 `DSH Tavern` 快捷方式一致；此前沿用原版 DSH Desktop 的 ID，任务栏会把两者合并，点用户自己的 DSH Desktop 固定图标会切到正在运行的 Tavern。
- `setup8` 对应 Tavern v2.6：结束旧酒馆进程被拒绝（进程正在退出或以管理员身份运行）时不再中断安装（#192）；嵌入的安装脚本切换目录前先离开安装目录，界面更新不再报 EBUSY。
- `setup6` 对应 Tavern v2.5，重新嵌入当前安装脚本，包含安装任务管理、中断回滚和非 ASCII 路径修复；使用新的运行时后缀，避免复用旧版嵌入脚本。
- `setup5` 随包嵌入共享下载模块 `bin/download.cjs`（写到运行时 `resources/download.cjs`）：下载按“30 秒无数据”判定失败，并把 Windows 系统代理转换为 `HTTP(S)_PROXY` 供 Node、curl、git、pnpm 使用。
- 显式运行安装包时，即使已有 Tavern 也会执行更新。升级先关闭所选安装根目录下的 Desktop 进程（先请求关闭，等待十秒后结束残留托盘进程），不操作其他安装；安装页面提醒用户先保存操作。
- 数据目录中的 `.launcher-upgrade-ready` 只在成功后记录当前启动器版本。安装失败清除旧标记，下一次可重试；正常使用已成功升级的安装入口无需联网。新启动器首次运行也会执行一次升级，以补齐旧 Profile 的宿主依赖。
- 旧 runtime 保留用于回退；不自动清理用户历史运行时和数据。新版首次准备需要额外磁盘空间。

发布时先上传新的 `Setup.exe` 附件并核对哈希，再发布 README 新链接。保留旧 `Portable.exe` / Setup，避免覆盖旧地址和丢失可复核的构建输入。

重装回归：运行 `./packaging/windows/test-reinstall.ps1 -TestDirectory D:/build/reinstall-test`。测试副本仅替换注册表读取，使用实际安装选择流程和窗体验证旧目录缺失时取消、重新安装及恢复原数据路径，不修改用户注册表。

运行时直接在独立的 `runtime-<版本>-<随机编号>` 最终目录中解压与打补丁，不再移动包含运行文件的目录，也不依赖文件占用重试。全部准备成功后才写入内容为完整版本号的 `ready`；启动器在准备互斥锁内选择已完成目录，兼容原来的 `runtime-<版本>`。中断目录、截断标记和缺少主程序的目录不会被选中，重试使用新目录；失败目录尽力清理，清理失败不掩盖原始异常。已完成运行时不覆盖、不重新打补丁。

运行时发布回归：运行 `./packaging/windows/test-runtime-publish.ps1 -TestDirectory D:/build/publish-test`，验证持续文件占用下无需等待即可完成发布、中断恢复、旧目录兼容和标记写入失败保护。完整安装包回归：`./packaging/windows/test-runtime-lock.ps1 -Launcher D:/build/Setup.exe -TestDirectory D:/build/lock-test`，在真实解压期间持续锁定 EXE，直到准备及下一次启动入口均完成；同一测试可以复现旧安装包的 `Directory.Move / 0x80070005` 失败。此设计消除了整目录移动的共享锁故障，不绕过文件读取/写入/执行权限或安全软件明确拦截。

Windows 包管理使用官方 Electron Node 模式运行内置 pnpm，入口由共享 bootstrap 准备；不再调用社区版的 installDesktopPnpmRuntime。

真实入口回归：`node packaging/windows/test-package-manager.mjs <解压后的运行时目录> <新的测试目录>`，验证 Desktop 自带 pnpm 在 Electron 下的依赖安装退出和失败退出码。

升级回归：`test-upgrade.ps1 -Launcher <安装包> -Runtime <准备后的运行时> -TestDirectory <空测试目录>` 检查旧插件不被跳过、失败重试、离线启动及进程关闭范围。`test-online-upgrade.ps1 -InstallDirectory <仅经过 prepare-only 的独立测试安装目录>` 执行联网覆盖安装，检查版本、数据哨兵和 Desktop smoke；不要对用户安装执行该测试。

安装器、直接安装命令及联网回归默认使用国内 npm 镜像 `https://registry.npmmirror.com`。需要其他源时设置 `DSH_TAVERN_NPM_REGISTRY`；联网回归也支持 `-Registry <URL>`，结束后恢复调用者的环境设置，不修改系统全局 npm 配置。

### setup4 更新进度

更新窗口实时显示下载源、当前处理步骤、文件计数、依赖包计数、已用时间和距上次状态变化的时间。60 秒无变化时提示查看日志，不据此断言断网或失败；本地解压、配置也可能没有连续输出。窗口提供「查看更新日志」。有明确网络错误时显示重试或切换来源。

jsDelivr 备用下载最多 6 路并发，已安装文件经 SHA-256 校验一致后直接复用。单文件请求 30 秒超时，最多尝试 2 次；失败再走压缩包回退。压缩包每次 120 秒超时、最多 3 次；Git 使用连续 30 秒低于 1 KiB/s 的传输限制；依赖下载每次 30 秒超时、最多重试 2 次。首次下载 Windows 更新运行环境保留每次 120 秒限制，并显示已下载 MB。上述都是单请求或传输限制，不是整个更新的时间上限。

不能用一个固定总时长判断所有更新是否正常；缓存、首次安装、网络和磁盘会改变耗时。排查时优先提供当前阶段、是否有计数变化及诊断日志。无需因单纯等待而删除或重装用户数据。

此界面随启动器嵌入分发，必须重新构建并发布 Setup EXE；仅更新酒馆代码无法改变旧 EXE 的窗口。源码回归和 Mono C# 编译不代替 Windows 实际安装验收。

## 官方宿主布局与升级

构建时仅在临时目录展开官方 app.asar，保留官方 main.js，并加入酒馆入口；不改用户已安装的官方应用。共享的 official-desktop-runtime.cjs 使用官方 Electron Node 模式与 resources/runtime 中的 pnpm。打包宿主由新版 Tavern Setup 更新，构建会移除上游 app-update.yml，避免独立上游更新器替换此发行包。

官方使用 profiles/desktop。旧 profiles/tavern 的用户插件与补丁在安装事务中合并，旧配置保留；数据继续位于原 DSH_HOME/profile-data/tavern。安装失败仍可从固定入口重试。正常启动不会联网重装。官方程序名为 DeepSeek Harness.exe；升级关闭进程时兼容旧 DSH Desktop.exe，但只处理所选安装目录内的进程。

Windows 工作流验证真实 payload、中文路径命令、冷/热 pnpm 安装和当前提交的联网安装。macOS 的成功验证不能替代 Windows 实机/CI结果。
