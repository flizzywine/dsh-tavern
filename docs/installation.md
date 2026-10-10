# 安装、更新与数据备份

## Android 一键 APK（Android 11+ / ARM64）

[下载 DSH Tavern Android APK](https://github.com/flizzywine/dsh-tavern/releases/download/v2.1/dsh-tavern-android-release.apk) · [下载 SHA-256 校验文件](https://github.com/flizzywine/dsh-tavern/releases/download/v2.1/dsh-tavern-android-release.apk.sha256)

1. 下载 APK，按 Android 提示允许当前浏览器或文件管理器安装应用，然后安装。
2. 打开「DSH Tavern」，点击启动；首次保持联网并等待运行环境与酒馆安装完成，无需另装 DSHA，也无需输入命令。
3. 启动完成后点击进入，在酒馆设置中配置文字模型，再导入人物卡。
4. 以后直接打开此应用并启动、进入；更新酒馆后返回应用的启动页重启。

这是在线安装包，首次启动需要下载最新版酒馆；请保持应用运行。初始化失败时保留错误日志，再点击启动重试。安装日志位于容器内 /root/.dsh/logs/tavern-install.log。

独立 APK 与原版 DSHA 可以同时安装，数据各自独立，不会自动迁移旧聊天。覆盖升级请安装本项目同签名的新 APK；不要为了更新先卸载应用，以免删除应用数据。

本包要求 Android 11 及以上、ARM64。其他系统版本可参考下方 DSHA 方案。

[返回项目首页](../README.md) · [在线使用文档](https://flizzywine.github.io/dsh-tavern/)

### Windows 一键安装版

下载首页提供的 `DSH-Tavern-Desktop-2.0.13-x64-Setup7.exe`（SHA-256：`ad40b98a3b0a306c5a41df7108c80f56ab6b938cf3a47e01712c0e693a825d1b`），双击后选择安装文件夹，再点击「安装并启动」。首次需要联网下载兼容的最新版酒馆；无需另外安装 Node.js 或 DSH Desktop。若遇到「安装或更新失败」、「对路径 DSH Desktop.exe 的访问被拒绝」或「对路径 preparing-…\\app 的访问被拒绝」，请改用上述修复版并先关闭已打开的酒馆。

- **以后启动：** 双击桌面或开始菜单中的「DSH Tavern」。也可以在安装目录双击 `DSH Tavern.exe`；不要直接运行 `runtime-…` 里的 `DSH Desktop.exe`，内部程序需要外层启动器提供正确的数据路径。
- **安装位置：** 首次可自选，默认 `%LOCALAPPDATA%\DSH-Tavern`。新安装的程序、运行文件和数据放在所选目录下；数据位于 `data` 子目录。完成提示和目录中的 `如何启动.txt` 列出实际位置。
- **下载包：** 安装器会在所选目录保存固定启动入口，安装完成后可以删除下载的 `Setup.exe`，不会影响快捷方式。
- **旧版修复：** 新安装器会识别旧便携版的 `%LOCALAPPDATA%\DSH-Tavern-Portable`、历史 `D:\Workspace\.DSH-Tavern` 和更早的 `%LOCALAPPDATA%\DSH-Tavern`。点击「修复并启动」会关闭所选安装的旧进程、联网更新运行时和 Tavern 插件，并补建入口、取消旧安装文件夹的隐藏属性。请先保存当前操作；人物卡、聊天和设置保留，不自动搬动数据。
- **断网或失败：** 已建立的桌面、开始菜单入口仍可用于重试。错误窗口显示文件位置，安装目录的 `launcher-error.txt` 记录启动问题，数据目录的 `first-install.log` 记录首次联网安装问题。
- **重装与备份：** 再次运行安装包会沿用已记录的位置。新安装备份整个 `data` 目录；旧版请按完成提示中的实际数据位置备份。不要只移动 `runtime-…` 或修改 `launcher-settings.xml` 来迁移数据，现有依赖可能包含绝对路径。原安装位置失效时，安装器会提供「使用原目录」「重新安装」和「取消」。需要保留数据时，连接原磁盘或选择原安装文件夹；确认已卸载并希望重新开始时，点击「重新安装」并选择位置，无需手动清理注册表。重新安装不会删除旧文件，也不能恢复已删除的数据。

Windows Desktop 安装和更新使用 Desktop 自带的 pnpm 与 Node（即 Desktop 程序本身），不再另外下载 Node；旧版留下的 `tools/desktop-package-manager` 目录不再使用，可以删除。安装器会自动使用 Windows 系统代理（PAC 自动配置除外）。若旧版一直卡在“正在更新”，先关闭旧更新任务，再使用新版安装器修复入口；普通 Desktop 从 DSH 终端重新运行本文安装命令。命令行版继续使用独立 Node，macOS/Linux 不应用这项 Windows 修复。

Desktop 固定为 **2.0.13**；以后在酒馆界面更新插件。仅 Desktop 安装和更新内置 **`dsh-pocket 2.10.6`**（固定版本），并移除冲突的 `dsh-web-mobile`；手机扫码入口在 **设置 → 手机访问**，无需自行安装插件。CLI 不安装 Pocket，升级时会移除旧版 Pocket。Android / DSHA 不安装 Pocket，继续使用 `dsh-web-mobile`。切换到下面的 CLI 安装方式不会自动同步这份数据。

### 用 DSH 命令安装 Tavern（试验）

适用于已经安装 **DSH 0.1.5-rc.2、Node.js 22.19+、pnpm**、准备新建独立 `tavern` Profile 的用户：

需要 Git，在终端运行：

```bash
dsh plugin --profile tavern add github:flizzywine/dsh-tavern
dsh --profile tavern
```

第一条命令由 DSH 创建 Profile、安装完整运行包并启用酒馆；第二条启动网页。酒馆使用当前 DSH，不会另装或升级宿主。运行包包含 Web 配置、侧栏、人物卡功能、预设和 Skill，无需自行构建。启动时检查 DSH 适配版本。

数据位于当前 `DSH_HOME` 下的 `profile-data/tavern/`；未设置 `DSH_HOME` 时通常为 `~/.dsh/profile-data/tavern/`。程序由 Profile 的包管理器维护。更新时先关闭酒馆，重新运行第一条安装命令，再启动。页面中的「查看更新命令」提供同一条命令，不使用原来的源码更新器。

当前先支持普通 DSH CLI 的新安装。不要往专用安装器已经管理的 `tavern` Profile 直接叠装；原 CLI、Desktop、Android 安装继续使用各自原有方式。这条路线不会迁移旧 CLI 的独立数据，也不附带 Desktop 的 Pocket 手机访问配置或宿主字体文件修改。侧栏终端复用宿主提供的 `node-pty`；宿主缺少此依赖时，终端会显示修复提示，酒馆仍可使用。

### 命令行及宿主内安装

CLI 首次安装可选择：**默认目录 `~/.dsh-tavern/`、当前目录（回车默认）、其他完整路径**。下文默认路径均可替换为所选目录。程序放在其 `apps/dsh-tavern/` 下，运行时和数据分别存放；命令入口及包管理器缓存可能位于目录外。

设置 `DSH_TAVERN_CLI_HOME` 时直接使用指定位置；无交互终端时必须设置。更新沿用已安装位置，重新安装请在原安装根目录运行或指定该变量。已有安装失败后也可在原位置重试。

按使用环境选择安装方式：

| 安装方式 | DSH 运行时与版本策略 | 数据位置 |
| --- | --- | --- |
| 命令行版（Windows / macOS / Linux） | 使用独立的 DSH `0.1.5-rc.2`；版本匹配且可启动时直接复用，不要求预装 DSH，不复用或替换全局 DSH | 默认 `~/.dsh-tavern/`，与外部 DSH 数据分开 |
| DSH Desktop | 适配版本：**2.0.13**（内置 DSH `0.1.5-rc.2`），复用宿主自带 DSH，要求内置 DSH 版本完全匹配 | Desktop 的 Tavern Profile 数据目录 |
| DSHA（Android） | 适配版本：**0.1.5-rc2**（内置 DSH `0.1.5-rc.2`），复用宿主自带 DSH，要求内置 DSH 版本完全匹配 | DSHA 的 Tavern Profile 数据目录 |

命令行版与 Desktop / DSHA 不再共用一套数据。切换安装方式不会自动同步人物卡或对话；首次升级旧 CLI 时会复制旧 CLI 配置和游戏数据，保留原件，Desktop / DSHA 数据不会自动迁入。

Desktop / DSHA 安装器会检查宿主内置的 DSH 版本：与适配版本不一致时停止安装，并提示适配宿主版本；不会自动升级或降级宿主。若缺少必需依赖或接口，会明确报错。如遇兼容问题，请自行下载适配版本：[Desktop 历史版本](https://github.com/anywhere-labs/dsh-desktop/releases) · [DSHA 历史版本](https://github.com/DSH-APP/DSHA/releases)。

**首次安装、更新或重新安装，都运行下面对应的同一条命令。** 已安装时会覆盖更新程序文件，保留人物卡、对话、配置、自定义工具和 Skill，无需先卸载。重新安装前建议备份数据；如果使用了自定义数据或安装目录，请保持原配置。

### DSH Desktop 桌面版

适合不想单独配置运行环境和管理服务的用户，支持 Windows 和 macOS。

适配版本：**DSH Desktop 2.0.13**（内置 DSH `0.1.5-rc.2`），内置 DSH 版本必须匹配，否则停止安装。请自行打开 [历史版本下载页面](https://github.com/anywhere-labs/dsh-desktop/releases)，找到 **v2.0.13**，展开 **Assets**，下载适合自己系统的安装包；不要下载 Source code。

安装后，进入 DSH Desktop **设置 → 通用设置**，点击窗口顶部的 **打开 DSH 终端**，在弹出的终端窗口运行对应系统的命令。Windows 使用 PowerShell，macOS 使用下面的终端命令；代码框上方的语言标签不用输入。

Windows：

```powershell
$env:DSH_TAVERN_HOST='desktop'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.ps1')); Invoke-Expression $tavernInstaller
```

macOS：

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.sh | DSH_TAVERN_HOST=desktop sh
```

安装完成后，重启 DSH Desktop，进入 **设置 → 桌面设置**，在右侧 **Profile** 列表点击 **tavern**，旁边显示 **当前** 即为选中。Desktop 会自动管理启停和端口；更新 dsh-tavern 时，在 DSH Terminal 中重新运行上述安装命令即可。

旧版内置更新失败时，也直接运行上面的命令：它会获取安装器，绕过本地旧更新脚本（CDN 缓存可能延迟刷新）。Windows 命令按 UTF-8 解码，避免中文乱码。

Windows 安装失败时，请提供终端显示的 `update-diagnostics.jsonl` 文件，默认位于 `%USERPROFILE%\.dsh\profile-data\tavern\data\`；自定义 `DSH_HOME` 时以终端显示的位置为准。日志记录实际安装路径、失败步骤、退出码和脱敏后的错误输出。包管理环境首次下载失败会尝试三次；文件缺失会直接显示缺失路径。依赖安装期间会实时显示输出。若提示日志写入失败，请保留终端中的具体错误。

### 命令行版

适合希望通过浏览器访问、自己管理服务的用户。需要 Node.js 22.19 或更高版本。无需预装 DSH。安装器使用固定版本的独立 DSH，不复用或修改全局安装；首次安装、指定版本变化、运行时缺失或启动检查失败时才重新下载。建议安装 Git：安装器会建立持久化稀疏缓存，首次只获取运行文件，后续只拉取变化内容，不下载 `docs/`、文档图片、`examples/`、`references/` 和测试文件；没有 Git 时自动回退到完整 ZIP。

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

如果使用 DSH Desktop，请从 **设置 → 通用设置 → 打开 DSH 终端**，在解压目录运行：

```bash
node ./bin/dsh-tavern.mjs install --host desktop
```

然后重启 Desktop，并切换到 **tavern** Profile。

### Android

> 不同手机系统、DSHA 版本、网络和后台限制都可能导致安装或运行失败。

v2.1 要求宿主 DSH `0.1.5-rc.2`。请安装 **[DSHA v0.1.5-rc2](https://github.com/DSH-APP/DSHA/releases/tag/v0.1.5-rc2)**（内置这个版本）。Android 11 及以上用标准包 `dsha-0.1.5-rc2.apk`，更早的系统用兼容包 `dsha-0.1.5-rc2low.apk`。旧的 DSHA 1.2.0-rc1.4 内置的不是这个版本，安装会停止。历史包见 [DSHA 历史版本下载页面](https://github.com/DSH-APP/DSHA/releases)。

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

点击 **酒馆工作台** 后，酒馆会直接在 DSHA 内打开，无需另外安装窗口插件或手动填写地址。顶部的 **刷新** 用来重新加载页面，**直接打开** 切换到原酒馆页面，**关闭** 返回 DSHA 主界面。

**以后打开酒馆：DSHA → 底部「启动」→「进入」→ 侧栏「酒馆工作台」。** 如果还没运行，先点「启动」并等到「已就绪，可进入」。这条路径自动处理认证，不需要手输地址或复制 token；使用期间保持 DSHA 运行。

**浏览器显示 `dsh web authentication required; reopen the URL printed by dsh web.`？** 这是浏览器缺少登录凭证，不代表安装失败。回到 DSHA，按上面的路径进入即可。不要直接输入 `http://127.0.0.1:3080` 或 `http://127.0.0.1:3088`，也不要把内置页面地址直接搬到另一个浏览器：它们不共享登录状态。

必须用外部浏览器时，从 DSHA「启动」页本次启动日志的「本机打开」取得**完整地址（包括 `?token=` 后的全部内容）**，在同一台安卓设备的浏览器打开，再点「酒馆工作台」。找不到完整地址或不方便复制时，使用上面的 DSHA 内置入口。详见 [浏览器认证与恢复步骤](android-install.md#浏览器提示需要认证怎么办)。

需要从手机 Download 目录导入人物卡时，请在 Android 系统设置中允许 DSHA **访问所有文件**；未授权时酒馆会给出提示，并保留系统文件选择器作为备选。

以后更新直接点击酒馆左侧栏底部的 **更新到最新版**。如果酒馆打不开，可在 DSHA 的 **酒馆工作台**入口点击 **更新/修复**。更新完成后，在 DSHA 底部 **启动** 页点 **重启**，再进入酒馆，让新版入口生效；老用户无需卸载重装。

窗口白屏时先点顶部 **刷新**，仍不正常可点 **直接打开**；两个入口都打不开时，返回 DSHA 主界面确认服务运行，再尝试 **更新/修复**。

详细排错见 [Android 安装说明](android-install.md)。

### 命令行版的启动、停止与更新

安装完成后，新开一个 PowerShell / 终端即可使用下列命令。Windows、macOS、Linux / WSL2 的 `dsh-tavern` 命令写法相同。**每次只复制你要执行的那条，不要把整张表依次执行。**

| 命令 | 用途 | 什么时候用 |
| --- | --- | --- |
| `dsh-tavern start` | 启动酒馆后台服务 | 开机后，或服务已经停止时 |
| `dsh-tavern open` | 在浏览器中打开当前酒馆 | 服务已启动，但网页关掉了或没有自动打开时 |
| `dsh-tavern status` | 查看服务状态及可用的访问地址 | 确认是否正在运行，或排查网页打不开时 |
| `dsh-tavern stop` | 停止酒馆后台服务 | 暂时不用、备份数据或准备覆盖重装时 |
| `dsh-tavern restart` | 先停止，再启动酒馆服务 | 更新后需要手动重启，或按排错提示重启时 |
| `dsh-tavern update` | 在原安装位置更新酒馆 | 想通过终端更新时 |
| `dsh-tavern install` | 使用当前本地程序安装或修复 Tavern Profile、依赖及所需运行时 | 手动部署或修复本地安装配置时 |
| `dsh-tavern --help` | 显示命令帮助 | 忘记有哪些命令时 |

不带参数运行 `dsh-tavern` 等同于 `dsh-tavern status`。帮助命令也可以写成 `dsh-tavern help` 或 `dsh-tavern -h`。

**启动服务：**

```bash
dsh-tavern start
```

**打开网页：** 只负责打开页面，不会自动启动尚未运行的服务。若提示尚未就绪，先运行上面的启动命令。

```bash
dsh-tavern open
```

**查看运行状态和访问地址：** 地址可能包含鉴权 token，请勿公开分享。

```bash
dsh-tavern status
```

**停止服务：** 停止后网页无法继续生成，已有聊天和人物卡仍保留。先等当前生成结束并保存编辑内容。

```bash
dsh-tavern stop
```

**重启服务：** 如果浏览器没有恢复连接，完成后再运行 `dsh-tavern open`。

```bash
dsh-tavern restart
```

**更新酒馆：** 更新沿用已安装目录，保留数据。完整覆盖重装步骤见[更新与重新安装](https://flizzywine.github.io/dsh-tavern/#a02--section-9)。

```bash
dsh-tavern update
```

**安装或修复本地配置：** 此命令使用已经下载到本地的程序，不负责获取最新版酒馆源码。第一次安装请使用上面的完整安装命令；要更新程序，请用 `update`，或按覆盖重装步骤重新执行完整安装命令。

```bash
dsh-tavern install --host cli
```

在命令行版环境中，`dsh-tavern install` 默认使用 CLI 宿主；这里显式写出 `--host cli` 便于确认安装目标。`--host desktop` 和 `--host android` 用于对应宿主内安装，命令行版用户无需切换。

**查看帮助：**

```bash
dsh-tavern --help
```

**常见操作顺序：** 开机后先 `start` 再 `open`；只关闭了浏览器，直接 `open`；打不开先看 `status`；更新用 `update`；需要停止服务用 `stop`。关闭终端或浏览器不等于停止后台服务。

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
