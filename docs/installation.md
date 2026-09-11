# 安装、更新与数据备份

[返回项目首页](../README.md) · [在线使用文档](https://flizzywine.github.io/dsh-tavern/)


CLI 首次安装可选择：**默认目录 `~/.dsh-tavern/`、当前目录（回车默认）、其他完整路径**。下文默认路径均可替换为所选目录。程序放在其 `apps/dsh-tavern/` 下，运行时和数据分别存放；命令入口及包管理器缓存可能位于目录外。

设置 `DSH_TAVERN_CLI_HOME` 时直接使用指定位置；无交互终端时必须设置。更新沿用已安装位置，重新安装请在原安装根目录运行或指定该变量。已有安装失败后也可在原位置重试。

按使用环境选择安装方式：

| 安装方式 | DSH 运行时与版本策略 | 数据位置 |
| --- | --- | --- |
| 命令行版（Windows / macOS / Linux） | 使用独立的 DSH `0.1.2-rc.1`；版本匹配且可启动时直接复用，不要求预装 DSH，不复用或替换全局 DSH | 默认 `~/.dsh-tavern/`，与外部 DSH 数据分开 |
| DSH Desktop | 适配版本：**2.0.5**，复用宿主自带 DSH，要求内置 DSH 版本完全匹配 | Desktop 的 Tavern Profile 数据目录 |
| DSHA（Android，实验性支持） | 适配版本：**1.2.0-rc1.4**，复用宿主自带 DSH，要求内置 DSH 版本完全匹配 | DSHA 的 Tavern Profile 数据目录 |

命令行版与 Desktop / DSHA 不再共用一套数据。切换安装方式不会自动同步人物卡或对话；首次升级旧 CLI 时会复制旧 CLI 配置和游戏数据，保留原件，Desktop / DSHA 数据不会自动迁入。

Desktop / DSHA 安装器会检查宿主内置的 DSH 版本：与适配版本不一致时停止安装，并提示适配宿主版本；不会自动升级或降级宿主。若缺少必需依赖或接口，会明确报错。如遇兼容问题，请自行下载适配版本：[Desktop 历史版本](https://github.com/anywhere-labs/dsh-desktop/releases) · [DSHA 历史版本](https://github.com/DSH-APP/DSHA/releases)。

**首次安装、更新或重新安装，都运行下面对应的同一条命令。** 已安装时会覆盖更新程序文件，保留人物卡、对话、配置、自定义工具和 Skill，无需先卸载。重新安装前建议备份数据；如果使用了自定义数据或安装目录，请保持原配置。

### DSH Desktop 桌面版

适合不想单独配置运行环境和管理服务的用户，支持 Windows 和 macOS。

适配版本：**DSH Desktop 2.0.5**（内置 DSH `0.1.2-rc.1`），内置 DSH 版本必须匹配，否则停止安装。请自行打开 [历史版本下载页面](https://github.com/anywhere-labs/dsh-desktop/releases)，找到 **v2.0.5**，展开 **Assets**，下载适合自己系统的安装包；不要下载 Source code。

安装后，从系统托盘（macOS 菜单栏）打开 **Open DSH Terminal**，运行对应命令：

Windows：

```powershell
$env:DSH_TAVERN_HOST='desktop'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.ps1')); Invoke-Expression $tavernInstaller
```

macOS：

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.sh | DSH_TAVERN_HOST=desktop sh
```

安装完成后，重启 DSH Desktop，并从托盘的 **Profile** 菜单选择 **tavern**。Desktop 会自动管理启停和端口；更新 dsh-tavern 时，在 DSH Terminal 中重新运行上述安装命令即可。

旧版内置更新失败时，也直接运行上面的命令：它会获取最新安装器，绕过本地旧更新脚本。Windows 命令按 UTF-8 解码，避免中文乱码。若仍失败，请提供日志最前面的具体错误和文件路径。

### 命令行版

适合希望通过浏览器访问、自己管理服务的用户。需要 Node.js 22.19 或更高版本。无需预装 DSH。安装器使用固定版本的独立 DSH，不复用或修改全局安装；首次安装、指定版本变化、运行时缺失或启动检查失败时才重新下载。建议安装 Git：安装器会建立持久化稀疏缓存，首次只获取运行文件，后续只拉取变化内容，不下载 `docs/`、文档图片、`demo/`、`references/` 和测试文件；没有 Git 时自动回退到完整 ZIP。

#### Windows

打开 PowerShell，运行：

```powershell
$env:DSH_TAVERN_HOST='cli'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.ps1')); Invoke-Expression $tavernInstaller
```

#### macOS / Linux / WSL2

打开终端，运行：

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.sh | DSH_TAVERN_HOST=cli sh
```

安装程序会自动安装依赖、启动 dsh-tavern，并在首次安装时打开网页。关闭页面后，运行 `dsh-tavern open` 可重新打开；也可运行 `dsh-tavern status`，复制显示的完整访问地址（含鉴权 token，请勿分享）。不要只输入不带 token 的地址，以免出现鉴权提示。更新时优先使用 Git 增量同步；Git 不可用或同步失败时才下载完整 ZIP。

一键安装及更新、Android 安装默认通过 [npmmirror 国内镜像](https://npmmirror.com/) 下载 npm 依赖，不修改全局 npm 配置。如需使用其他源，在运行安装命令前设置 `DSH_TAVERN_NPM_REGISTRY`：PowerShell 使用 `$env:DSH_TAVERN_NPM_REGISTRY='https://registry.npmjs.org'`，macOS / Linux 使用 `export DSH_TAVERN_NPM_REGISTRY=https://registry.npmjs.org`。

首次使用时，在左侧栏底部打开 **设置 → 模型**，填写模型服务的 API 密钥。

长对话可在 **设置 → Tavern → 上下文压缩** 中选择每 N 轮或达到指定上下文占用比例时自动压缩，默认保持手动。自动压缩会等待剧情后台结算结束，再一起处理前后台；手动入口仍在 **更多 → 压缩上下文**。详见[上下文压缩说明](auto-compaction.md)。

命令行版的运行时、Profile、配置和游戏数据默认位于 `~/.dsh-tavern/`，与外部 DSH 分开。可通过 `DSH_TAVERN_CLI_HOME` 指定位置；安装后启动器会记住该路径。首次升级时会复制旧 CLI 的配置和游戏数据，保留原件；Desktop / DSHA 数据不会自动迁入。Node.js 仍使用系统安装的版本。

#### 手动安装

如果一键命令仍然无法使用：

1. 在 GitHub 项目页点击 **Code → Download ZIP**，或直接下载 [`main.zip`](https://github.com/flizzywine/dsh-tavern/archive/refs/heads/main.zip)；
2. 解压后进入 `dsh-tavern-main` 文件夹；
3. 在这个文件夹中打开 PowerShell（Windows）或终端（macOS / Linux），确认当前目录可以看到 `package.json`；
4. 如果尚未安装 `pnpm`，先运行 `npm install -g pnpm@11.25.0`，然后运行 `pnpm install --frozen-lockfile`。无需手动安装 DSH，下一步会下载独立版本。

5. 命令行版安装并启动：

```bash
pnpm run install:tavern
pnpm run start:tavern
```

然后使用终端显示的完整访问地址，或运行 `dsh-tavern open`。若当前终端尚未识别该命令，可在仓库目录运行 `node ./bin/dsh-tavern.mjs open`。

如果使用 DSH Desktop，请从托盘打开 **DSH Terminal**，在解压目录运行：

```bash
node ./bin/dsh-tavern.mjs install --host desktop
```

然后重启 Desktop，并切换到 **tavern** Profile。

### Android

> **Android 属于实验性支持，不保证一定可用。** 不同手机系统、DSHA 版本、网络和后台限制都可能导致安装或运行失败。

适配版本：**DSHA 1.2.0-rc1.4**（预览版，内置 DSH `0.1.2-rc.1`）。内置 DSH 版本必须匹配，否则停止安装。请自行打开 [DSHA 历史版本下载页面](https://github.com/DSH-APP/DSHA/releases)，找到 **v1.2.0-rc1.4**，展开 **Assets**，下载适合手机系统的 APK；不要下载 Source code。

借助 [DSHA](https://github.com/DSH-APP/DSHA)，可以尝试在 Android 手机上运行本项目。首次安装步骤：

1. 安装 DSHA，配置模型并成功启动一次；
2. 打开 DSHA 底部的 **终端**，把下面整条命令复制进去并回车。安装脚本会自行完成下载、配置、校验、启动和失败回滚：

```bash
node -e "fetch('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@69d74f5/android/setup.sh').then(async r=>{if(!r.ok)throw Error('HTTP '+r.status);require('fs').writeFileSync('/tmp/dsh-tavern-setup.sh',await r.text())}).then(()=>{const r=require('child_process').spawnSync('bash',['/tmp/dsh-tavern-setup.sh'],{stdio:'inherit'});process.exit(r.status??1)}).catch(e=>{console.error(e);process.exit(1)})"
```

3. 如果不会使用终端，也可以打开“创造模式”，完整复制下面这一整段话发给 Agent：

```text
请帮我安装 DSH Tavern。只需要原样执行下面这一条命令，等待它结束，然后把最后的结果告诉我；不要拆解步骤，也不要修改命令：

node -e "fetch('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@69d74f5/android/setup.sh').then(async r=>{if(!r.ok)throw Error('HTTP '+r.status);require('fs').writeFileSync('/tmp/dsh-tavern-setup.sh',await r.text())}).then(()=>{const r=require('child_process').spawnSync('bash',['/tmp/dsh-tavern-setup.sh'],{stdio:'inherit'});process.exit(r.status??1)}).catch(e=>{console.error(e);process.exit(1)})"
```

4. 看到“全部完成”后重启 DSHA，在底部 **启动** 页点 **启动**；显示“已就绪，可进入”后点 **进入**，再从侧栏打开 **酒馆工作台**。

酒馆工作台现在会在 DSHA 内嵌窗口中打开，顶部提供 **刷新、直接打开、关闭**。遇到白屏或连接问题时，可点 **直接打开** 使用原入口。

**以后打开酒馆：DSHA → 底部「启动」→「进入」→ 侧栏「酒馆工作台」。** 如果还没运行，先点「启动」并等到「已就绪，可进入」。这条路径自动处理认证，不需要手输地址或复制 token；使用期间保持 DSHA 运行。

**浏览器显示 `dsh web authentication required; reopen the URL printed by dsh web.`？** 这是浏览器缺少登录凭证，不代表安装失败。回到 DSHA，按上面的路径进入即可。不要直接输入 `http://127.0.0.1:3080` 或 `http://127.0.0.1:3088`，也不要把内置页面地址直接搬到另一个浏览器：它们不共享登录状态。

必须用外部浏览器时，从 DSHA「启动」页本次启动日志的「本机打开」取得**完整地址（包括 `?token=` 后的全部内容）**，在同一台安卓设备的浏览器打开，再点「酒馆工作台」。找不到完整地址或不方便复制时，使用上面的 DSHA 内置入口。详见 [浏览器认证与恢复步骤](android-install.md#浏览器提示需要认证怎么办)。

需要从手机 Download 目录导入人物卡时，请在 Android 系统设置中允许 DSHA **访问所有文件**；未授权时酒馆会给出提示，并保留系统文件选择器作为备选。

以后更新直接点击酒馆左侧栏底部的 **更新到最新版**。如果酒馆打不开，可在 DSHA 的 **酒馆工作台**入口点击 **更新/修复**。

详细排错见 [Android 安装说明](android-install.md)。

### 命令行版的启动、停止与更新

安装完成后，新开一个终端或 PowerShell。

启动：

```bash
dsh-tavern start
```

停止：

```bash
dsh-tavern stop
```

重启：

```bash
dsh-tavern restart
```

更新：

```bash
dsh-tavern update
```

命令行版的 `dsh-tavern update` 更新插件，并检查独立 DSH 的版本与启动状态；符合要求就直接复用，否则重新安装指定版本。全局 DSH 的升级不会改变这份运行时。Desktop / DSHA 更新只更新酒馆，保留宿主版本；兼容报错时请自行下载适配宿主版本。Desktop 版由 DSH Desktop 统一管理启停。

命令行版默认目录如下（Windows 的 `~` 对应 `%USERPROFILE%`，通常是 `C:\Users\你的用户名`）：

| 内容 | 默认目录 |
| --- | --- |
| 独立 DSH 程序 | `~/.dsh-tavern/runtime/` |
| 人物卡、游戏状态等数据 | `~/.dsh-tavern/profile-data/tavern/data/` |
| 原生会话记录 | `~/.dsh-tavern/profile-data/tavern/sessions/` |

备份游戏时建议复制整个 `~/.dsh-tavern/profile-data/tavern/`。更新或重装运行时不会删除这个目录。设置 `DSH_TAVERN_CLI_HOME` 后，上述路径均位于指定目录下；Desktop / DSHA 使用各自宿主的 Tavern Profile 数据目录。

需要强制重装独立 DSH 时，在本次安装或更新前设置 `DSH_TAVERN_REINSTALL_RUNTIME=1`，完成后取消设置：

```powershell
$env:DSH_TAVERN_REINSTALL_RUNTIME='1'
dsh-tavern update
Remove-Item Env:DSH_TAVERN_REINSTALL_RUNTIME
```

macOS / Linux：

```sh
DSH_TAVERN_REINSTALL_RUNTIME=1 dsh-tavern update
```

