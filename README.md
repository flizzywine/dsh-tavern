<p align="center">

> **桌面版支持官方 DeepSeek Harness 0.2.x**。Windows、macOS、命令行版和 Android 的安装见[快速开始](#快速开始)。
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

### 桌面版（Windows / macOS）

先安装官方 [DeepSeek Harness](https://deepseek.com/harness/) **0.2.1-rc.2 或更新的 0.2.x**，打开并完成初始设置。然后完全退出：Windows 从托盘退出，macOS 按 ⌘Q。

**1. 安装酒馆启动器**

在对应平台的终端粘贴一行。命令只安装启动器插件，使用 DSH 自带的运行环境。

Windows（PowerShell）：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/install.ps1'))) -LauncherOnly
```

macOS（终端）：

```sh
installer=$(curl -fsSL https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/install.sh) && sh -c "$installer" dsh-tavern-install --launcher-only
```

**2. 从启动器安装酒馆**

重新打开 DeepSeek Harness，进入 **设置 → 酒馆启动器**，点 **安装酒馆** 并确认。安装完成后点 **确认重启并应用**，DSH 会重新打开并进入酒馆。酒馆使用独立配置，原版 DSH 配置会保留。安装失败时可在启动器里复制诊断日志。

**以后更新：** 在酒馆里打开 **设置 → 酒馆启动器 → 酒馆版本与更新**，点 **检查更新**；发现新版时点 **更新酒馆**，等安装完成后重启。旧版如果还没有这张卡片，从游玩侧栏更新一次即可。切回原版 DSH、查看数据目录、迁移和卸载也在启动器里。

### Android

- **独立 APK**（Android 11+ / ARM64）：[下载 APK](https://github.com/flizzywine/dsh-tavern/releases/download/v3.1/dsh-tavern-android-release.apk)，按引导部署，后续在应用内更新。可与旧版 APK、原版 DSHA 并存；旧包数据需导出再导入。[安装说明 →](https://github.com/flizzywine/dsh-tavern/wiki/Android-%E5%AE%89%E8%A3%85%E4%B8%8E%E6%9B%B4%E6%96%B0)
- **Termux**：占用更低，适合追求性能或自行管理运行环境的用户。

**Termux**：不想装 APK、或想自己掌控运行环境，用一条命令装命令行版：

```sh
curl -fsSL https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/scripts/termux/termux-tavern.sh -o ~/termux-tavern.sh && bash ~/termux-tavern.sh
```

始终取 `main` 的最新版；这条命令会完成安装并进入酒馆：脚本会装 Ubuntu 容器、Node、酒馆与移动版布局，启动后打开浏览器。两种方式在手机上的差异、以及 Termux 版的注意事项见 [Termux 一节](https://github.com/flizzywine/dsh-tavern/wiki/Android-%E5%AE%89%E8%A3%85%E4%B8%8E%E6%9B%B4%E6%96%B0#termux在手机里跑命令行版)。

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
