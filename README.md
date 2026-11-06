<p align="center">

> **当前版本适配 DSH 0.2.x**（官方 DeepSeek Harness、DSH NEXT、独立命令行及 Android），安装见[快速开始](#快速开始)。
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/docs/assets/brand/dsh-tavern-lockup-on-dark.svg">
    <img src="docs/assets/brand/dsh-tavern-lockup.svg" width="360" alt="DSH 酒馆">
  </picture>
</p>

# DSH Tavern

**基于 DSH（DeepSeek Harness）的 Agent 酒馆。兼容 SillyTavern 生态，人物卡导入就能玩。**

[产品网站](https://flizzywine.github.io/dsh-tavern/) · [安装](#快速开始) · [Wiki 文档](https://github.com/flizzywine/dsh-tavern/wiki) · [Discord](https://discord.gg/hYAEjKnpra)

[![观看 3 分钟实机演示：兼容酒馆生态，更快、更稳、更鲜活](docs/images/readme/promo-video.jpg)](https://www.bilibili.com/video/BV1MHaU6NE7S/)

## 快速开始

> npm 上的 `dsh-profile-tavern` 已弃用。请按下方对应平台的方式安装。

官方 DeepSeek Harness 使用桌面安装器，社区版 DSH NEXT 支持独立 Profile 和 Git 插件分发。

当前版本适配 **DSH 0.2.x**（0.2.0-rc.2 起）。安装前建议备份 `.dsh` 目录。

### Windows

1. 安装 [DeepSeek Harness](https://deepseek.com/harness/) 0.2.1-rc.2 或更新的 0.2.x，打开一次后从托盘退出。
2. 打开 PowerShell，粘贴下面这行并按回车执行：

   ```powershell
   $env:DSH_TAVERN_HOST='desktop'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@runtime-archive-main/install.ps1')); Invoke-Expression $tavernInstaller
   ```

3. 重新打开 DeepSeek Harness，即进入酒馆。

### DSH NEXT（插件市场）

插件名为 `dsh-tavern-bundle`。发布后，在 Next 创建基于 Web 的独立 `tavern` Profile，并切到该 Profile。在「插件 → 发现 → 索引来源」添加 [DSH Tavern 市场源](https://raw.githubusercontent.com/flizzywine/dsh-tavern/plugin-market-next/index.json)，搜索 **DSH Tavern** 安装。安装器若提示 `sharp` 构建授权，确认后重试。切换 Profile 和更新均由 Next 管理。

也可在 Next 配套的 DSH 终端执行。首次安装时初始化 Web Profile，把第二条命令中的提交 SHA 换成市场索引里对应版本的值。升级时用新版本的 SHA 重跑第二条。

```powershell
dsh --profile tavern --from-default-profile web --dump-config
dsh plugin --profile tavern add "git+https://github.com/flizzywine/dsh-tavern.git#<提交 SHA>" --allow-build=sharp
```

从下方的源码安装方式迁移时，先退出 `tavern`，移除旧 Profile 中的酒馆组件，再安装聚合插件。两套组件同时启用会重复挂载。人物卡和会话仍使用同一 DSH 数据目录下的 `profile-data/tavern`。

维护者在 GitHub Actions 手动运行 **Publish DSH NEXT plugin**，为每次发布指定一个尚未使用的版本号。工作流将插件和市场索引发布到 `plugin-market-next` 分支，市场索引保留每个版本对应的 Git 提交。Next 的「社区市场」目前按 npm 包名安装，Git 版走「发现」的索引来源。若要进 `dshmarket` 的默认目录，发布后按 [目录投稿规则](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) 提交收录。

### DSH NEXT（Windows 源码安装）

先完整退出桌面应用。在酒馆仓库根目录运行以下命令，将程序路径换成本机的 Next 安装位置。

```powershell
$env:DSH_TAVERN_NEXT_EXECUTABLE = 'D:\DSH NEXT\DSH NEXT.exe'
pnpm install --frozen-lockfile
node bin/dsh-tavern.mjs install --host next
```

打开 Next 后，在「设置 → 桌面设置 → Profile」选择 `tavern`。安装使用真实的 `profiles/tavern` 目录，切换由 Next 管理。若 Next 使用了自定义数据目录，安装前把 `DSH_HOME` 设成 Next 显示的目录。

如果之前用官方版桥接进了酒馆，先在官方版切回原版 DSH，再退出并安装 Next 版。在同一数据目录恢复官方桥接时，重新运行官方版安装器。Next 版从源码更新后，重新执行上面的安装命令。

### Android

- **独立 APK**（Android 11+ / ARM64）：[下载 APK](https://github.com/flizzywine/dsh-tavern/releases/download/v3.1/dsh-tavern-android-release.apk)，按引导部署，后续在应用内更新。可与旧版 APK、原版 DSHA 并存；旧包数据需导出再导入。[安装说明 →](https://github.com/flizzywine/dsh-tavern/wiki/Android-%E5%AE%89%E8%A3%85%E4%B8%8E%E6%9B%B4%E6%96%B0)
- **Termux**：占用更低，适合追求性能或自行管理运行环境的用户。

**Termux**：不想装 APK、或想自己掌控运行环境，用一条命令装命令行版：

```sh
curl -fsSL https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/scripts/termux/termux-tavern.sh -o ~/termux-tavern.sh && bash ~/termux-tavern.sh
```

始终取 `main` 的最新版；这条命令会完成安装并进入酒馆：脚本会装 Ubuntu 容器、Node、酒馆与移动版布局，启动后打开浏览器。两种方式在手机上的差异、以及 Termux 版的注意事项见 [Termux 一节](https://github.com/flizzywine/dsh-tavern/wiki/Android-%E5%AE%89%E8%A3%85%E4%B8%8E%E6%9B%B4%E6%96%B0#termux在手机里跑命令行版)。

### macOS

1. 安装 [DeepSeek Harness](https://deepseek.com/harness/) 0.2.1-rc.2 或更新的 0.2.x，打开一次后退出（⌘Q）。
2. 打开「终端」，粘贴下面这行并按回车执行：

   ```sh
   curl -fsSL 'https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@runtime-archive-main/install.sh' -o /tmp/dsh-tavern-install.sh && DSH_TAVERN_HOST=desktop sh /tmp/dsh-tavern-install.sh
   ```

3. 重新打开 DeepSeek Harness，即进入酒馆。

### 命令行版（Windows / macOS / Linux，用浏览器玩）

需要 [Node.js 22.19+](https://nodejs.org/) 和 pnpm。自带独立 DSH，默认安装到 `~/.dsh-tavern`，与已有桌面版或全局 DSH 互不影响。

Windows（PowerShell）：

```powershell
$env:DSH_TAVERN_HOST='cli'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@runtime-archive-main/install.ps1')); Invoke-Expression $tavernInstaller
```

macOS / Linux：

```sh
curl -fsSL 'https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@runtime-archive-main/install.sh' -o /tmp/dsh-tavern-install.sh && DSH_TAVERN_HOST=cli sh /tmp/dsh-tavern-install.sh
```

装好后用 `dsh-tavern start` 启动，按显示的地址在浏览器打开；`dsh-tavern stop` / `status` / `update` 停止、查看、更新。

局域网 / VPN 绑定与安全要求见[命令行远程访问文档](https://github.com/flizzywine/dsh-tavern/wiki/命令行版：局域网与VPN访问)。

### 手机远程访问

酒馆跑在电脑或服务器上，用手机浏览器也能玩。[详细说明 →](https://github.com/flizzywine/dsh-tavern/wiki/%E5%AE%89%E8%A3%85%E4%B8%8E%E5%90%AF%E5%8A%A8#user-content-a02--section-2)

- **电脑运行、手机扫码**：安装 [dsh-pocket](https://github.com/shaobeichen/dsh-pocket)，在 **设置 → 手机访问** 选择局域网或公网，扫码即可。
- **服务器部署、账号登录**：安装 [dsh-webui-auth](https://github.com/Yuuz12/dsh-webui-auth)，为远程网页加上登录认证。

### 开始游玩

在 **设置 → 模型** 填入模型服务和 API 密钥（任意模型都可以，本地模型也行），导入人物卡就能开局。[图文教程 →](https://github.com/flizzywine/dsh-tavern/wiki/%E5%AE%89%E8%A3%85%E4%B8%8E%E5%90%AF%E5%8A%A8#user-content-a02--section-5)

## 交流与反馈

欢迎交流使用经验、分享人物卡或反馈问题：

- **[Discord](https://discord.gg/hYAEjKnpra)**：DSH Tavern 交流频道，任何人都可以加入。

除 Discord 外，本项目没有官方的 QQ 群、微信群或其他群聊。

反馈故障时，可从对话顶部的“日志”下载执行记录；分享前请检查其中的对话和附件隐私。

## 参与贡献

开发同步：`pnpm sync:desktop`；相关测试：`node bin/test-tavern.mjs tests/<相关>.test.mjs`。配置与注意事项见[本机开发与测试](https://github.com/flizzywine/dsh-tavern/wiki/本机开发与测试)。

DSH 升级检查：`node bin/check-dsh-upgrade.mjs --candidate "<桌面程序或独立 dsh-app-boot 入口>" --output "<本地报告.json>"`；省略 candidate 时使用当前测试宿主。加 `--baseline "<旧宿主入口>"` 可对比两个运行时的包版本、导出声明、入口与类型声明 SHA-256，以及各项契约结果。工具只读取已有安装，在项目临时目录中运行受控测试，不安装或切换正式宿主；候选检查允许超出安装支持范围，通过不等于完整应用验收，也不会修改支持版本策略。报告可能含本机路径与失败日志，仅留本地。

`config/dsh-contracts.json` 集中记录宿主行为、适配位置和相关测试。必需用例失败、跳过、缺少结果或必需包不可用，检查均失败；明确列出的可选能力跳过会单独显示，不代表已验证该能力。`node bin/check-dsh-upgrade.mjs --check-dependencies` 检查维护源码中的 DSH 包引用；新增引用位置需审阅并更新 `config/dsh-dependency-baseline.json`，该清单不覆盖动态拼接名称、私有字段访问或生成/vendor 代码。

`DSH compatibility checks` 在 PR 和 main 源码变更时自动检查依赖位置及检查器测试。真实宿主契约通过手动触发运行：需要配有 Node.js、PowerShell 7 和隔离 DSH 安装的专用 self-hosted runner（标签 `dsh-compatibility`），启用 `run_host` 并填写该 runner 上的 candidate/baseline 路径；不自动安装新版，不在 PR 上执行 self-hosted 任务。运行报告作为 artifact 保留 7 天。

欢迎各种 PR：完善文档、写小白教程、给配置项改名、折叠复杂设置，或改进其他使用体验。当前功能繁多，特别欢迎简化、合并和删除功能的意见。

Issue 只用于 Bug 反馈。大功能或行为调整请先到 [Discord 交流群](https://discord.gg/hYAEjKnpra) 讨论，确定方案后再提交 PR。

使用教程在 [Wiki](https://github.com/flizzywine/dsh-tavern/wiki) 维护；功能参数与规则引用 [Skill 参考文件](https://github.com/flizzywine/dsh-tavern/wiki/Skill-参考文档)，避免重复维护。
