# DSH 0.2.1 官方桌面测试版

这是面向测试用户的预发布版本，使用 `0.2.1版本` 分支。普通用户请继续使用[稳定版](https://github.com/flizzywine/dsh-tavern/releases/latest)。

| 渠道 | 用途 | 安装入口 |
| --- | --- | --- |
| 稳定版 | 日常游玩，沿用原来的宿主及平台支持 | [稳定版下载与说明](https://github.com/flizzywine/dsh-tavern/releases/latest) |
| 测试版 | 测试 DSH 0.2.1-rc.2 适配和存档迁移 | 本页下方的官方桌面安装命令 |

## 支持范围

- 宿主仅支持**官方 DeepSeek Harness 0.2.1-rc.2**，从[官网下载](https://deepseek.com/harness/)。安装器会核对内置 DSH 版本，不匹配时停止安装。
- macOS（Apple 芯片）和 Windows（64 位）官方桌面；macOS 已本机验证，Windows 安装流程待测试用户验证。
- 暂不支持社区 DSH Desktop、DSHA、Android APK、Linux 或独立命令行宿主。下面的命令只是把酒馆安装到官方桌面。
- 本轮不发布一键 EXE 安装包，不要使用稳定版 EXE 安装这个测试版。

## 安装前

1. 完整退出官方桌面和旧酒馆，确保没有正在生成的内容。
2. 备份原来的 `.dsh` 数据目录（默认位于用户主目录），或从旧酒馆导出重要存档。测试版会使用现有酒馆数据，不是隔离的第二套存档。
3. 安装并首次启动官方 DeepSeek Harness 0.2.1-rc.2，然后完整退出。后续命令无需额外安装 Node.js，使用官方桌面内置运行环境。

## macOS 安装

打开系统“终端”，粘贴执行：

```sh
curl -fsSL 'https://raw.githubusercontent.com/flizzywine/dsh-tavern/0.2.1%E7%89%88%E6%9C%AC/install.sh' -o /tmp/dsh-tavern-testing-install.sh && DSH_TAVERN_HOST=desktop sh /tmp/dsh-tavern-testing-install.sh
```

## Windows 安装

打开 PowerShell，粘贴执行（支持 Windows PowerShell 5.1）：

```powershell
$env:DSH_TAVERN_HOST='desktop'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://raw.githubusercontent.com/flizzywine/dsh-tavern/0.2.1%E7%89%88%E6%9C%AC/install.ps1')); Invoke-Expression $tavernInstaller
```

看到安装成功后，重新打开官方 DeepSeek Harness，即可进入酒馆。侧栏版本处显示“测试版 · DSH 0.2.1”。

## 更新与迁移

- 测试版的“检查更新”只跟随 `0.2.1版本` 分支；也可以再次执行本页安装命令。稳定版仍跟随 `main`，不会自动切到测试版。
- 打开旧存档，在“酒馆状态”中点击“迁移存档”，等待完成。迁移保留正文、变量、分支及历史版本；完成后迁移入口自动隐藏。
- 回到稳定版时，使用测试前的备份或导出存档，并安装稳定版对应宿主。不要让旧宿主直接读取迁移后的数据目录。

## 测试反馈

请在 [Issues](https://github.com/flizzywine/dsh-tavern/issues) 提交，标题注明“0.2.1 测试版”，附上系统、官方桌面版本、酒馆提交号、复现步骤和错误截图。优先验证：安装与更新、旧存档迁移、正文及历史版本、MVU 状态栏、候选项和后台结算。

适配工作基于 [PR #216](https://github.com/flizzywine/dsh-tavern/pull/216)。这个测试分支与 `main` 独立推进，暂未包含主线的全部新功能。
