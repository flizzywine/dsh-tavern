# DSH 0.2.1 官方桌面测试版

这是面向测试用户的预发布版本，使用 `0.2.1版本` 分支。原有安装方式仍保留在 [README 快速开始](README.md#快速开始)，本页仅提供额外的测试版安装方法。

## 支持范围

- 宿主仅支持**官方 DeepSeek Harness 0.2.1-rc.2**，从[官网下载](https://deepseek.com/harness/)。安装器会核对内置 DSH 版本，不匹配时停止安装。
- macOS（Apple 芯片）和 Windows（64 位）官方桌面；macOS 已本机验证，Windows 安装流程待测试用户验证。
- 暂不支持社区 DSH Desktop、DSHA、Android APK、Linux 或独立命令行宿主。下面的命令只是把酒馆安装到官方桌面。
- 本轮不发布一键 EXE 安装包，不要使用原有 EXE 安装这个测试版。

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

## 从旧命令行版或自定义目录继承数据

默认社区桌面版与官方桌面都使用同一个 `.dsh` 主目录时，无需跨目录复制。旧命令行版通常使用 `~/.dsh-tavern`；自定义安装请选择**包含 `profiles`、`profile-data` 的旧 DSH 主目录**，不是 `apps/dsh-tavern` 程序目录，也不是单独的 `data` 子目录。

先执行旧酒馆的 `dsh-tavern stop`，并完整退出官方桌面。把以下示例中的旧目录替换为实际路径，再运行安装。即使测试版已安装，也可以用同样命令补做数据继承。

### macOS

```sh
curl -fsSL 'https://raw.githubusercontent.com/flizzywine/dsh-tavern/0.2.1%E7%89%88%E6%9C%AC/install.sh' -o /tmp/dsh-tavern-testing-install.sh && DSH_TAVERN_IMPORT_HOME="$HOME/.dsh-tavern" DSH_TAVERN_HOST=desktop sh /tmp/dsh-tavern-testing-install.sh
```

自定义目录示例：将 `"$HOME/.dsh-tavern"` 改成 `"/Volumes/Games/旧酒馆"`。

### Windows PowerShell

```powershell
$env:DSH_TAVERN_IMPORT_HOME=Join-Path $HOME '.dsh-tavern'
$env:DSH_TAVERN_HOST='desktop'
try {
  $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://raw.githubusercontent.com/flizzywine/dsh-tavern/0.2.1%E7%89%88%E6%9C%AC/install.ps1'))
  Invoke-Expression $tavernInstaller
} finally { Remove-Item Env:DSH_TAVERN_IMPORT_HOME -ErrorAction SilentlyContinue }
```

自定义目录示例：将第一行改成 `$env:DSH_TAVERN_IMPORT_HOME='D:\Games\旧酒馆'`。`DSH_TAVERN_IMPORT_HOME` 指旧目录，**不要把 `DSH_HOME` 改成旧目录**；目标仍为官方桌面的 `.dsh`。

### 继承哪些内容，如何保护数据

- 复制酒馆数据、原生会话日志、人物卡、正文及历史版本、变量、附件、用户工具和 Skill、预设，以及旧模型/账号配置。旧版保存在程序旁 `data` 或配置指定 `dataRoot` 的酒馆数据也会收集。
- 旧目录只读保留，不复制旧 Node.js、宿主运行时或 `node_modules`。第三方插件的外部绝对路径仍需保持可访问，跨机器时需单独重新安装。
- 写入前，对双方数据做备份并逐文件校验 SHA-256。备份位于目标 `.dsh/backups/tavern-home-import/`，安装日志会显示具体路径；里面有 `source`、`target` 和迁移记录。备份含账号配置，请妥善保管。
- **模型和账号配置采用选定旧目录的内容**，原目标配置保存在 `target` 备份。目标现有的不冲突存档继续保留；同名但内容不同的存档、附件或预设会停止迁移，双方备份都保留，不自动混合故事历史。
- 遇到冲突，请根据日志和双方备份确认要保留的版本，或先在原酒馆导出后通过酒馆的导入功能处理；不要直接覆盖冲突文件。符号链接或特殊文件也会停止迁移，需先整理为普通文件。
- 迁移失败时回滚已替换的数据；进程中断后再次执行同一命令会先恢复中断记录，并保留中断时的文件。相同旧目录迁移成功后再次执行不会覆盖测试版的新进度。
- 数据继承完成后打开旧存档，再在“酒馆状态”执行格式迁移。目录继承与存档格式迁移是两个步骤。

## 更新与迁移

- 测试版的“检查更新”只跟随 `0.2.1版本` 分支；也可以再次执行本页安装命令。原有版本仍跟随 `main`，不会自动切到测试版。
- 打开旧存档，在“酒馆状态”中点击“迁移存档”，等待完成。迁移保留正文、变量、分支及历史版本；完成后迁移入口自动隐藏。
- 回到原有版本时，使用测试前的备份或导出存档，并安装原有版本对应宿主。不要让旧宿主直接读取迁移后的数据目录。

## 测试反馈

请在 [Issues](https://github.com/flizzywine/dsh-tavern/issues) 提交，标题注明“0.2.1 测试版”，附上系统、官方桌面版本、酒馆提交号、复现步骤和错误截图。优先验证：安装与更新、旧存档迁移、正文及历史版本、MVU 状态栏、候选项和后台结算。

适配工作基于 [PR #216](https://github.com/flizzywine/dsh-tavern/pull/216)。这个测试分支与 `main` 独立推进，暂未包含主线的全部新功能。
