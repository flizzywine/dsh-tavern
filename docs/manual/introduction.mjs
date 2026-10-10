// Commands mirror docs/installation.md; tests guard against drift.
export const installCommands = {
  desktopWindows: "$env:DSH_TAVERN_HOST='desktop'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.ps1')); Invoke-Expression $tavernInstaller",
  desktopMac: 'curl -fsSL https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.sh | DSH_TAVERN_HOST=desktop sh',
  cliWindows: "$env:DSH_TAVERN_HOST='cli'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.ps1')); Invoke-Expression $tavernInstaller",
  cliUnix: 'curl -fsSL https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.sh | DSH_TAVERN_HOST=cli sh',
  // Pin the bootstrap itself so jsDelivr cannot serve an older @main script.
  // The bootstrap still installs or updates the application from current main.
  android: 'node -e "fetch(\'https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@69d74f5/android/setup.sh\').then(async r=>{if(!r.ok)throw Error(\'HTTP \'+r.status);require(\'fs\').writeFileSync(\'/tmp/dsh-tavern-setup.sh\',await r.text())}).then(()=>{const r=require(\'child_process\').spawnSync(\'bash\',[\'/tmp/dsh-tavern-setup.sh\'],{stdio:\'inherit\'});process.exit(r.status??1)}).catch(e=>{console.error(e);process.exit(1)})"',
}
export const androidAgentPrompt = '请帮我安装 DSH Tavern。只需要原样执行下面这一条命令，等待它结束，然后把最后的结果告诉我；不要拆解步骤，也不要修改命令：\n\n' + installCommands.android
const code = (language, text) => '\n```' + language + '\n' + text + '\n```\n'

export const introduction = `
## DSH Tavern 是什么

DSH Tavern 是一个以文字为主的 AI 角色扮演与故事游玩工具，提供类似 SillyTavern 的文字游戏体验。导入一张人物卡，就可以进入它设定的世界，与角色对话、采取行动，让故事继续发展。

它运行在 DeepSeek Harness（简称 DSH）上：DSH 提供模型连接和运行环境，Tavern 提供人物卡、游玩界面、资源工作台和相关功能。名字里虽有 DeepSeek，但所有模型都能用，不限于 DeepSeek 模型。你现在看到的是使用文档，实际游戏需要安装后打开。

## 宣传视频

[DSH Tavern 3 分钟实机演示：兼容酒馆生态，更快、更稳、更鲜活](https://www.bilibili.com/video/BV1MHaU6NE7S/)

## 两种主要使用方式

| 模式 | 你在做什么 | 常见用法 |
| --- | --- | --- |
| 游玩模式 | 参与故事，与角色互动 | 自由输入行动、选择候选；也可以绑定小说或大纲，沿着剧本玩 |
| 卡片模式 | 与 Agent 讨论和修改资源 | 把卡中不喜欢的设定改掉，调整世界书和预设，或从剧本中提取新人物卡 |

两种模式可以独立使用。不需要先学会制卡才能玩，也不需要重做一张卡才能调整自己的体验。

## 打开后，界面大概是什么样

整体是“左侧找对话，中间阅读或操作，右侧看状态与资源”的布局。本页界面截图使用专门创作的公开样例，不包含私人对话或配置；点击图片可放大查看。

| 区域 | 游玩时 | 制作或修改内容时 |
| --- | --- | --- |
| 左侧栏 | 新建游戏，继续和整理已有故事 | 新建工作台，继续之前的资源讨论 |
| 中间主区域 | 阅读剧情、输入行动，选择候选或重写正文 | 告诉 Agent 修改要求，讨论方案，确认修改 |
| 右侧栏 | 查看 Guide、人物状态和剧本进度 | 查看人物卡库、世界书库、剧本库和预设库，编辑或引用资源 |

人物卡可能自带正文美化和状态栏，所以不同卡的展示细节会不同。主体始终是文字故事，插画是可选的高级能力。

## 界面截图

## 一次游玩是怎样的

1. 选一张喜欢的人物卡，预览并确认开场。
2. 阅读故事，输入自己的行动或对白；没想好时可以看看候选建议。
3. 发送行动，等待新的剧情与状态结果。
4. 继续下一轮；不满意时可以重写、回退，或添加持续生效的 Guide。

例如，你可以直接写“我先不回答，走到窗边看看街上的情况”，不必按固定选项行动。

## 可以带来什么内容

支持导入酒馆人物卡、世界书和预设，也可以导入小说、剧本或大纲。正则、MVU 和前端美化的具体支持范围，见[酒馆生态兼容](#compatibility)。

想改变内容时，进入[卡片模式](#cards)，告诉 Agent 哪些不喜欢、希望怎样调整，以及哪些需要保留。它也可以从素材中抽取人物与设定来制作新卡。

## 开始前需要准备什么

- 一台可运行 DSH 的设备，按[安装与启动](#a02)选择桌面版或命令行版。
- 一个可用的文字模型服务（任意模型均可，不限于 DeepSeek），准备服务地址、模型名称和所需的 API 密钥；模型调用可能产生费用。
- 一张想玩的 PNG / JSON 人物卡；也可以安装后再通过卡片模式制作。

不用先导入外部预设。用户画像、文生图和其他高级设置都可以先跳过，遇到需要时再查。

## 下一步

还没安装：先看[安装与启动](#a02)。已经装好：从[完成第一次游玩](#a04)开始，再按需要查阅四部分功能文档。
`

export const installation = `
## 先选一种安装方式

**只需完成其中一种安装方式，然后配置文字模型，就可以开始玩。** 已经装好酒馆的用户，可直接看[日常启动](#a02--section-8)、[更新与重新安装](#a02--section-9)或[安装排错](#a02--section-11)。

| 你的情况 | 选择哪一种 | 需要输入命令吗 |
| --- | --- | --- |
| Windows x64，想下载后直接安装 | [A．Windows 一键安装](#a02--section-2) | 不需要 |
| Windows / macOS，想借助 DSH Desktop 使用，或已经安装了 Desktop | [B．DSH Desktop 安装](#a02--section-3) | 在 Desktop 打开的终端里运行一条命令 |
| 想用浏览器访问，并自己管理服务；或使用 Linux / WSL2 | [C．命令行版](#a02--section-4) | 需要，先准备 Node.js |
| Android 11 及以上、ARM64，想直接装酒馆应用 | [D．Android 独立 APK](#a02--section-5) | 不需要 |
| Android，已经在使用 DSHA，或需要尝试兼容包 | [E．通过 DSHA 安装](#a02--section-6) | 在 DSHA 中执行安装命令 |
| 已有适配版本的 DSH，准备新建 Tavern Profile | [用 DSH 命令安装 Tavern（试验）](#plugin-installation) | 需要 |

**Windows 不知道怎么选，就选 A；想按你已有的 DSH Desktop 来安装，就选 B。** A 已包含 Desktop，不用再做一遍 B。

安装前保持联网，并预留下载和安装的时间。先装好程序即可，模型密钥和人物卡可以稍后准备。不同安装方式的数据各自独立，切换方式不会自动带走原来的聊天、人物卡和设置；桌面版与命令行版不要同时运行。

## A．Windows 一键安装（仅 Windows x64）

适合希望直接安装、以后双击快捷方式打开的用户。安装包会准备 DSH Desktop 2.0.13 和兼容的最新版酒馆，无需另装 Node.js 或 DSH Desktop。

### 第 1 步：下载安装包

[下载 Windows 一键在线安装 EXE](https://github.com/flizzywine/dsh-tavern/releases/download/v2.5/DSH-Tavern-Desktop-2.0.13-x64-Setup7.exe)

下载的文件名是 \`DSH-Tavern-Desktop-2.0.13-x64-Setup7.exe\`。这是在线安装器，安装时仍需要联网。

### 第 2 步：安装并等待完成

1. 双击下载的 EXE。
2. 选择安装文件夹，例如 \`D:\\Apps\\DSH-Tavern\`，记住这个位置。
3. 点击 **安装并启动**，等待下载和安装完成，不要在过程中关闭窗口。
4. 安装完成后会创建桌面和开始菜单中的 **DSH Tavern** 快捷方式。

完成提示和安装目录里的 \`如何启动.txt\` 会列出实际程序及数据位置。新安装的数据位于所选安装目录的 \`data\` 子目录。

### 第 3 步：打开酒馆

如果没有自动打开，双击桌面的 **DSH Tavern**。看到酒馆界面后，继续[配置模型并开始第一局](#a02--section-7)，不用再执行下面其他方式的安装命令。

以后也从这个快捷方式打开。下载的安装包可以删除；不要删除安装文件夹。不要直接运行内部 \`runtime-…\` 文件夹里的 \`DSH Desktop.exe\`。

## B．DSH Desktop 安装（Windows / macOS）

按以下顺序操作：**先安装 DSH Desktop，再在它提供的终端中安装 Tavern，最后切换到 Tavern 界面。** 如果你已经通过上面的 Windows 一键安装包装好了，就跳过本节。

### 第 1 步：安装适配的 Desktop 版本

1. 打开 [DSH Desktop v2.0.13 下载页](https://github.com/anywhere-labs/dsh-desktop/releases/tag/v2.0.13)。
2. 展开页面中的 **Assets**，下载适合自己 Windows / macOS 系统和处理器的安装包，不要下载 **Source code**。
3. 安装并打开 DSH Desktop。已经安装的用户，先确认版本是 **2.0.13**。

本项目当前要求 Desktop 内置的 DSH 为 **{{dshVersion}}**，对应的 Desktop 版本是 **2.0.13**。其他版本不一定兼容，安装器检测到不匹配会停止。请使用这里指定的适配版本，不要因为提示有新版就先升级 Desktop。

### 第 2 步：从 Desktop 打开 DSH 终端

在 DSH Desktop 中进入 **设置 → 通用设置**，点击设置窗口顶部的 **打开 DSH 终端**，会出现一个可以输入命令的窗口。

**下一步的命令就粘贴在这个窗口里，不是发到 DSH 的聊天输入框里。** 请从 Desktop 的入口打开，以便使用它提供的运行环境。

下面的操作位置截图来自旧版 Desktop，供辨认入口；实际安装请使用上面指定的 **2.0.13**。

截图：打开终端

### 第 3 步：只运行自己系统对应的命令

点击代码框右上角的 **复制**，把整条命令粘贴到刚打开的终端，按 **回车**，等待安装结束。命令很长，网页上可能需要横向滚动才能看全，使用复制按钮即可取得完整内容。

**Windows 用户：运行下面这条 PowerShell 命令。** 代码框上方的 \`powershell\` 只是语言标签，不用输入。如果窗口中是 \`PS C:\\…>\` 一类提示符，说明已经在 PowerShell 中；如果打开的是 cmd，可先输入 \`powershell\` 并回车，再粘贴安装命令。

` + code('powershell', installCommands.desktopWindows) + `

**macOS 用户：运行下面这条命令。** Windows 用户跳过这条。

` + code('bash', installCommands.desktopMac) + `

这里的命令会下载并执行本项目的安装脚本。请保留终端窗口，等到脚本报告安装完成；如果显示错误，先看[安装排错](#a02--section-11)，不要接着尝试其他安装方式的命令。

### 第 4 步：重启 Desktop，选择 tavern

1. 安装完成后，退出并重新打开 DSH Desktop。
2. 进入 **设置 → 桌面设置**。
3. 在右侧 **Profile** 列表中点击 **tavern**。Profile 可以理解为一套运行配置；旁边显示 **当前**，表示已经选中。
4. 返回主界面，确认显示酒馆界面。

截图：选择配置

看到酒馆界面，就完成了安装。接下来去[配置模型并开始第一局](#a02--section-7)。这一方式由 Desktop 管理启动和停止，不需要运行 \`dsh-tavern start\`。

## C．命令行版（Windows / macOS / Linux / WSL2）

适合希望自己启动、停止服务，并通过浏览器使用酒馆的用户。使用 Desktop 的用户可以跳过本节。

### 第 1 步：准备 Node.js 和终端

先安装 **Node.js 22.19 或更高版本**，安装后重新打开终端。Windows 从开始菜单打开 **PowerShell**；macOS / Linux 打开系统终端；WSL2 用户在 WSL2 终端中操作。

运行下面的命令检查版本。如果提示找不到命令，先完成 Node.js 安装再继续。

\`\`\`bash
node --version
\`\`\`

无需预装 DSH：安装器会准备独立的固定版本 DSH {{dshVersion}}，不会复用或修改全局 DSH。Git 是可选的，有 Git 时便于增量更新，没有时会使用 ZIP 下载。

### 第 2 步：运行本系统的安装命令

**Windows PowerShell：**

` + code('powershell', installCommands.cliWindows) + `

**macOS / Linux / WSL2：**

` + code('bash', installCommands.cliUnix) + `

点击对应代码框的 **复制**，粘贴到终端并回车。Windows 只执行 Windows 命令，其他系统只执行下面那条。

### 第 3 步：选择安装目录

首次安装时会询问目录，按提示输入选项并回车：

| 选项 | 安装到哪里 | 怎么选 |
| --- | --- | --- |
| 1 | 用户目录下的 \`.dsh-tavern\` 文件夹 | 不确定时选这一项，方便以后找回 |
| 2 | 当前目录（直接回车选这一项） | 确认终端当前所在文件夹就是你想安装的位置时使用 |
| 3 | 你指定的其他完整路径 | 希望放在其他磁盘或专用文件夹时使用 |

请记住所选目录。程序、独立运行时和游戏数据存入这里；命令入口及包管理器缓存可能位于目录外。Node.js 仍使用系统安装的版本。

### 第 4 步：打开酒馆网页

等待安装器完成依赖安装并启动酒馆，首次安装会尝试打开浏览器。没有自动打开时，新开一个终端，再运行：

\`\`\`bash
dsh-tavern open
\`\`\`

仍打不开时，查看服务状态与访问地址：

\`\`\`bash
dsh-tavern status
\`\`\`

使用输出中的**完整访问地址**，其中可能带有鉴权 token，不要分享给别人。看到酒馆界面后，继续[配置模型并开始第一局](#a02--section-7)。

### 命令行版命令一览

安装完成后，新开一个 PowerShell / 终端即可使用下列命令。Windows、macOS、Linux / WSL2 的 \`dsh-tavern\` 命令写法相同。**每次只复制你要执行的那条，不要把整张表依次执行。**

| 命令 | 用途 | 什么时候用 |
| --- | --- | --- |
| \`dsh-tavern start\` | 启动酒馆后台服务 | 开机后，或服务已经停止时 |
| \`dsh-tavern open\` | 在浏览器中打开当前酒馆 | 服务已启动，但网页关掉了或没有自动打开时 |
| \`dsh-tavern status\` | 查看服务状态及可用的访问地址 | 确认是否正在运行，或排查网页打不开时 |
| \`dsh-tavern stop\` | 停止酒馆后台服务 | 暂时不用、备份数据或准备覆盖重装时 |
| \`dsh-tavern restart\` | 先停止，再启动酒馆服务 | 更新后需要手动重启，或按排错提示重启时 |
| \`dsh-tavern update\` | 在原安装位置更新酒馆 | 想通过终端更新时 |
| \`dsh-tavern install\` | 使用当前本地程序安装或修复 Tavern Profile、依赖及所需运行时 | 手动部署或修复本地安装配置时 |
| \`dsh-tavern --help\` | 显示命令帮助 | 忘记有哪些命令时 |

不带参数运行 \`dsh-tavern\` 等同于 \`dsh-tavern status\`。帮助命令也可以写成 \`dsh-tavern help\` 或 \`dsh-tavern -h\`。

**启动服务：**

\`\`\`bash
dsh-tavern start
\`\`\`

**打开网页：** 只负责打开页面，不会自动启动尚未运行的服务。若提示尚未就绪，先运行上面的启动命令。

\`\`\`bash
dsh-tavern open
\`\`\`

**查看运行状态和访问地址：** 地址可能包含鉴权 token，请勿公开分享。

\`\`\`bash
dsh-tavern status
\`\`\`

**停止服务：** 停止后网页无法继续生成，已有聊天和人物卡仍保留。先等当前生成结束并保存编辑内容。

\`\`\`bash
dsh-tavern stop
\`\`\`

**重启服务：** 如果浏览器没有恢复连接，完成后再运行 \`dsh-tavern open\`。

\`\`\`bash
dsh-tavern restart
\`\`\`

**更新酒馆：** 更新沿用已安装目录，保留数据。完整覆盖重装步骤见[更新与重新安装](#a02--section-9)。

\`\`\`bash
dsh-tavern update
\`\`\`

**安装或修复本地配置：** 此命令使用已经下载到本地的程序，不负责获取最新版酒馆源码。第一次安装请使用本节前面的完整安装命令；要更新程序，请用 \`update\`，或按覆盖重装步骤重新执行完整安装命令。

\`\`\`bash
dsh-tavern install --host cli
\`\`\`

在命令行版环境中，\`dsh-tavern install\` 默认使用 CLI 宿主；这里显式写出 \`--host cli\` 便于确认安装目标。\`--host desktop\` 和 \`--host android\` 用于对应宿主内安装，命令行版用户无需切换。

**查看帮助：**

\`\`\`bash
dsh-tavern --help
\`\`\`

**常见操作顺序：** 开机后先 \`start\` 再 \`open\`；只关闭了浏览器，直接 \`open\`；打不开先看 \`status\`；更新用 \`update\`；需要停止服务用 \`stop\`。关闭终端或浏览器不等于停止后台服务。

## D．Android 独立 APK（Android 11+ / ARM64）

适合想直接安装酒馆应用的用户，无需另装 DSHA，也无需输入安装命令。此包要求 Android 11 及以上、ARM64。

### 第 1 步：下载并安装 APK

[下载 DSH Tavern Android APK](https://github.com/flizzywine/dsh-tavern/releases/download/v2.1/dsh-tavern-android-release.apk)

下载后打开 APK，按照 Android 提示，允许当前浏览器或文件管理器安装应用，然后完成安装。

### 第 2 步：首次启动并等待安装

打开 **DSH Tavern** 应用，点击 **启动**，保持联网并等待运行环境和酒馆下载、安装完成。期间保持应用运行。

这是在线安装包，装好 APK 并不代表酒馆已下载完成。初始化失败时先保留错误日志，再点击启动重试。

### 第 3 步：进入酒馆

启动完成后点击 **进入**，看到酒馆界面后，继续[配置模型并开始第一局](#a02--section-7)。以后直接打开此应用，按“启动 → 进入”操作。

独立 APK 与原版 DSHA 的数据各自独立，不会自动迁移旧聊天。更新 APK 时安装本项目同签名的新包进行覆盖升级，不要先卸载，以免删除应用数据。

## E．Android：通过 DSHA 安装

适合已经使用 DSHA，或需要尝试兼容包的用户。已安装上面的独立 APK 并能正常使用，就无需再做本节。

### 第 1 步：安装适配的 DSHA

下载 **[DSHA v0.1.5-rc2](https://github.com/DSH-APP/DSHA/releases/tag/v0.1.5-rc2)**，它内置本项目要求的 DSH {{dshVersion}}。Android 11 及以上使用标准包 \`dsha-0.1.5-rc2.apk\`，更早的系统可尝试兼容包 \`dsha-0.1.5-rc2low.apk\`。

安装后打开 DSHA，配置模型并成功启动一次。旧的 DSHA 1.2.0-rc1.4 内置版本不符合要求，不能直接用于这次安装。

### 第 2 步：安装酒馆，以下两种操作选一种

**直接使用终端：** 打开 DSHA 底部的 **终端**，复制下面整条命令，粘贴并回车，等待脚本结束。

` + code('bash', installCommands.android) + `

**不会使用终端：** 打开 DSHA 的 **创造模式**，把下面这一整段话复制给 Agent，让它执行，等待返回结果。已经执行过上一条命令的用户无需再做一次。

` + code('text', androidAgentPrompt) + `

### 第 3 步：重启并打开酒馆工作台

1. 看到 **全部完成** 后，重启 DSHA。
2. 在底部 **启动** 页点击 **启动**。
3. 等待显示 **已就绪，可进入**，点击 **进入**。
4. 从侧栏打开 **酒馆工作台**。

酒馆会在 DSHA 内打开，这个入口会自动处理认证，无需自己填写端口或复制 token。看到界面后，继续[配置模型并开始第一局](#a02--section-7)。

从手机 Download 目录导入人物卡前，请在 Android 系统设置中允许 DSHA **访问所有文件**；也可以尝试系统文件选择器。使用期间请允许 DSHA 后台运行，避免省电策略中断服务。

## 配置模型并开始第一局

**能打开酒馆界面表示安装完成；要让角色回复，还需要配置可用的文字模型。** 五种安装方式都从这里继续。

1. 准备模型服务提供的 **API 密钥、服务地址、模型名称**。模型调用可能产生费用。DSH 可以接入所有模型，不限于 DeepSeek，用哪家服务或本地模型都可以。
2. 在酒馆左侧栏底部打开 **设置 → 模型**，按服务方要求填写并选择文字模型。具体操作见[配置文字模型](#a03)。
3. 导入一张 PNG / JSON 人物卡，选择新建游玩。
4. 预览开场，按需设置玩家称呼，发送第一条行动。

看到新生成的剧情正文，就完成了第一次游玩。详细步骤见[第一次游玩](#a04)。外部预设、用户画像、文生图等功能可以之后再配置。

## 关机后如何重新打开

日常启动不用重新安装。根据你当初选择的方式操作：

| 安装方式 | 以后从哪里打开 |
| --- | --- |
| A．Windows 一键安装 | 双击桌面或开始菜单中的 **DSH Tavern** |
| B．DSH Desktop | 打开 **DSH Desktop**，确认 **设置 → 桌面设置 → Profile** 中选中 **tavern** |
| C．命令行版 | 打开终端，依次运行下面的启动和打开命令 |
| D．Android 独立 APK | 打开 **DSH Tavern** 应用，点击 **启动 → 进入** |
| E．DSHA | 打开 **DSHA → 启动**，等待就绪后点 **进入 → 酒馆工作台** |

**以下命令只供 C．命令行版使用。** 启动服务并打开网页：

\`\`\`bash
dsh-tavern start
dsh-tavern open
\`\`\`

需要停止服务时运行 \`dsh-tavern stop\`，需要重启时运行 \`dsh-tavern restart\`。关闭浏览器页面不等于停止服务，电脑关机则会结束本机服务。

## 更新与重新安装

**日常更新直接点酒馆里的更新按钮。更新失败、长期卡住，或想重新执行完整安装流程时，再做“整体重新安装（覆盖更新）”。**

> **整体重新安装不会覆盖数据，只替换程序。**重新运行原来的安装包或安装命令即可，人物卡、聊天和设置都会保留，不用先删除或卸载。

| 你想做什么 | 用哪种办法 | 会不会清空数据 |
| --- | --- | --- |
| 正常获取新版酒馆 | 在界面中检查并进行更新 | 正常更新保留数据 |
| 修复旧安装、重新安装最新版酒馆程序 | 在原位置重新运行安装包或安装命令 | 按原目录覆盖安装会保留数据，操作前仍建议备份 |
| 删除所有数据、从零开始 | 卸载并清除数据 | 会丢失数据，本页的更新步骤不需要这样做 |

这里的“整体重新安装”指**重新执行安装流程，更新酒馆程序并重新安装所需依赖**。它会保留游戏数据和适配的宿主版本；健康的运行环境可能被复用，不保证把每个文件都重新下载。不要为了“更彻底”先删除数据文件夹、清除 Android 应用数据或卸载应用。

### 更新前：先保存、确认原安装、备份数据

1. 等当前生成或修改操作完成，保存正在编辑的内容。
2. 确认原来用的是 A、B、C、D、E 中哪一种，继续用同一种更新。尤其不要把 Desktop 版换成命令行版来“更新”。
3. 按[数据备份](#n07)保存重要人物卡和聊天。Windows 一键版可在关闭酒馆后复制整个安装目录中的 \`data\` 文件夹到另一个位置；命令行版可停止服务后备份原安装根目录中的 \`profile-data/tavern\`。
4. 保持联网。如果之前已经有更新任务在运行，先等待其结束；确认卡住时关闭旧任务，再开始一次修复，不要同时运行多个安装器。

### 方法一：直接点击更新按钮（日常使用）

1. 打开酒馆，展开左侧栏，找到底部显示 **DSH Tavern 版本号和构建号** 的更新区域。
2. 点击 **检查更新**。发现新构建后，点击 **进行更新**；旧版界面可能直接显示 **更新到最新版**。
3. 等待下载和安装。期间可能短暂断开连接，不要连续点击更新或立即关闭宿主。
4. 根据完成提示重启或刷新，具体见下表。

| 安装方式 | 更新完成后 |
| --- | --- |
| A．Windows 一键安装 | 退出酒馆及其 Desktop 进程，再从 **DSH Tavern** 快捷方式打开 |
| B．DSH Desktop | 退出并重新打开 Desktop，确认当前 Profile 为 **tavern** |
| C．命令行版 | 按提示刷新网页；若提示自动重启失败，在终端运行 \`dsh-tavern restart\`，再 \`dsh-tavern open\` |
| D．Android 独立 APK | 返回应用的启动页，重启后再进入酒馆 |
| E．DSHA | 返回 DSHA 底部 **启动** 页，点击 **重启**，再进入 **酒馆工作台** |

看到 **未发现更新构建** 就表示检查时没有发现更新，无需重装。命令行版也可以直接在终端运行 \`dsh-tavern update\`，它会沿用已安装位置。

检查更新会依次使用 GitHub API 与 jsDelivr，任一可达即可完成检查；只有 GitHub 不可达时，结果会附带提示，因为 jsDelivr 可能有数小时缓存延迟。两者都不可达时，可用环境变量把查询地址改到可访问的镜像，重启酒馆后生效：

| 环境变量 | 默认地址 | 用途 |
| --- | --- | --- |
| \`DSH_TAVERN_COMMIT_URL\` | api.github.com 的 main 最新提交 | 判断最新构建 |
| \`DSH_TAVERN_CDN_METADATA_URL\` | jsDelivr 上的 \`dsh-tavern-runtime.json\` | GitHub 不可达时的备用清单 |
| \`DSH_TAVERN_VERSION_URL\` | raw.githubusercontent.com 的 \`package.json\` | 仅用于显示版本号，失败不影响检查 |

### 方法二 A：Windows 一键版整体重新安装（覆盖更新）

1. 保存操作、备份数据，关闭已打开的酒馆。
2. 从 [Windows 一键安装](#a02--section-2)重新下载本页提供的修复版 EXE，双击运行。
3. 确认安装器识别的是**原来的安装文件夹**，按界面提示修复并启动。旧便携版会显示 **修复并启动**。不要另选空文件夹来代替原安装。
4. 等待安装器准备运行文件、联网更新酒馆并补建启动入口。它会关闭所选安装的旧进程，请勿在安装过程中继续游玩。
5. 完成后，从桌面或开始菜单的 **DSH Tavern** 打开，确认原聊天和人物卡仍在。

如果提示原目录不可用，先连接原磁盘或选择 **使用原目录**。只有明确要建立一份新安装时才选择 **重新安装** 并指定新位置；新位置不会自动获得旧数据。

### 方法二 B：DSH Desktop 版整体重新安装（覆盖更新）

**最直接的办法：重新执行第一次安装酒馆时的那条命令。无需先卸载 Desktop，也无需删除 tavern Profile。**

1. 保存操作并备份重要数据，确认 Desktop 仍为 **2.0.13**。
2. 打开 **DSH Desktop → 设置 → 通用设置 → 打开 DSH 终端**。
3. 复制下面自己系统对应的整条命令，粘贴到这个终端，按回车。以下命令与首次安装相同，会获取安装脚本并在原宿主中覆盖更新酒馆。

**Windows PowerShell：**

` + code('powershell', installCommands.desktopWindows) + `

**macOS：**

` + code('bash', installCommands.desktopMac) + `

**命令执行后，继续完成以下操作：**

1. 等待终端报告安装完成。如果显示错误，先保留错误日志，不要删除原数据再试。
2. 退出并重新打开 Desktop，在 **设置 → 桌面设置 → Profile** 中选中 **tavern**。
3. 打开原聊天，确认人物卡、聊天和设置仍在，再检查更新区域的结果。

这会重新安装酒馆程序及依赖，**不会重装或升级 Desktop 本身**。如果 Desktop 应用已经损坏、连设置都打不开，应先备份其数据，再修复安装指定的 Desktop 2.0.13，随后执行上述步骤。

### 方法二 C：命令行版整体重新安装（覆盖更新）

1. 保存操作，在终端运行 \`dsh-tavern stop\` 停止服务，然后备份数据。
2. 找到**原安装根目录**，也就是包含 \`apps\`、\`runtime\`、\`profile-data\` 的那一层，不是 \`apps/dsh-tavern\` 源码文件夹。
3. 在这个根目录打开 PowerShell / 终端，再运行 [C．命令行版](#a02--section-4)中对应系统的安装命令。安装器会重新获取酒馆程序、安装依赖并检查独立 DSH 运行时。
4. 如果再次询问安装目录，确认选择原位置。也可以在运行安装命令前设置 \`DSH_TAVERN_CLI_HOME\`，明确指定原安装根目录。
5. 安装完成后新开终端，运行 \`dsh-tavern status\` 查看服务状态，再运行 \`dsh-tavern open\`。若服务未运行，先执行 \`dsh-tavern start\`。

**如何明确指定原目录：** 下面仅是写法示例，必须把示例路径换成你自己的原安装根目录，不能直接照抄。设置后，在同一个终端中运行 C 的安装命令。

Windows PowerShell 示例：

\`\`\`powershell
$env:DSH_TAVERN_CLI_HOME='D:\\Apps\\DSH-Tavern-CLI'
\`\`\`

macOS / Linux / WSL2 示例（仅当你原来确实装在这个默认位置时使用）：

\`\`\`bash
export DSH_TAVERN_CLI_HOME="$HOME/.dsh-tavern"
\`\`\`

**只有独立 DSH 运行时也需要强制重装时，才做下面这一步。** 普通覆盖安装会复用健康的固定版本运行时；这不是漏更新。如果怀疑运行时损坏，可在同一个终端中、执行安装命令前再设置：

Windows PowerShell：

\`\`\`powershell
$env:DSH_TAVERN_REINSTALL_RUNTIME='1'
\`\`\`

macOS / Linux / WSL2：

\`\`\`bash
export DSH_TAVERN_REINSTALL_RUNTIME=1
\`\`\`

然后运行 C 中的安装命令。完成后关闭这个终端，避免临时设置影响下次操作。此选项只适用于命令行版，重新安装的仍是本项目固定的 DSH {{dshVersion}}，不是升级到其他版本。

### 方法二 D：Android 独立 APK 更新与修复

**酒馆程序和 APK 应用是两层，覆盖安装 APK 不等于强制重新安装酒馆。**

1. 日常更新酒馆，使用上面的方法一，完成后回到应用启动页重启。
2. 要更新或修复 APK 应用本身，从 [D．Android 独立 APK](#a02--section-5)下载本项目的安装包，在现有应用上覆盖安装。必须使用同签名安装包，不要先卸载，也不要点击系统设置中的“清除数据”。
3. 打开应用，点击启动、进入，确认原聊天和人物卡仍在。

首次安装未完成的应用，会在再次启动时重试初始化。已完成初始化的应用可能复用现有酒馆文件，不能把“重新装了一次 APK”当成酒馆程序一定已重装。如果酒馆打不开或更新仍失败，保留启动日志，按本页 Android 排错处理；不要通过卸载来强迫它重新初始化。

### 方法二 E：DSHA 版整体重新安装（覆盖更新）

1. 保存操作并备份重要数据，保留现有 DSHA 和它的数据，确认宿主是适配的 **v0.1.5-rc2**。
2. 酒馆打不开时，先尝试 **酒馆工作台 → 更新/修复**。
3. 要重新执行完整安装流程，打开 **DSHA 底部 → 终端**，运行下面与首次安装相同的命令，等待它完成下载、配置和校验。不要切换到独立 APK 来更新这份 DSHA 数据。

` + code('bash', installCommands.android) + `

**命令执行完成后：** 回到 DSHA 的 **启动** 页点击 **重启**，等待就绪后点击 **进入 → 酒馆工作台**，确认原聊天与人物卡仍在。

### 怎样确认更新完成

重新打开酒馆后，在左侧栏底部检查当前版本和构建号，再点击 **检查更新**。版本号可能不变而构建号变化，所以不要只看大版本号。能打开原聊天、人物卡仍在，且更新检查没有报错、没有发现更新构建，就完成了这次更新。

如果打开后数据像全新安装，先检查是不是选错了 Profile、安装目录或应用，不要立刻认定数据已删除，也不要马上覆盖或清理旧目录。

### 为什么不能随意升级 Desktop / DSHA

当前适配的 DSH 是 **{{dshVersion}}**。Desktop / DSHA 的更新可能改变内置 DSH，导致酒馆不兼容；请等本项目明确适配后再升级。酒馆更新与宿主升级是两件事，安装器不会自动替你升级或降级 Desktop / DSHA。命令行版使用自己的固定 DSH 运行时。

## 可选：用手机访问电脑上的酒馆

**这里是“电脑运行，手机访问”，和在 Android 手机上安装应用是两种用法。** 先完成电脑端安装，再按需配置；安装电脑端酒馆不需要先做本节。

Desktop 安装和更新会自动配置 [dsh-pocket](https://github.com/shaobeichen/dsh-pocket)。重启后，在 **设置 → 手机访问** 中选择局域网或公网访问，手机扫码连接。CLI 不提供 Pocket 手机访问，升级时会移除旧版 Pocket。使用时电脑及酒馆服务需要保持运行；选择局域网时，手机和电脑应在同一局域网。

自行部署服务器的用户可参考 [dsh-webui-auth](https://github.com/Yuuz12/dsh-webui-auth)，为已经能访问的 WebUI 添加账号密码认证。它不提供内网穿透，服务器地址、监听和端口需要自行配置。参考插件教程时，请保留本项目适配的 DSH {{dshVersion}}，不要照抄升级 DSH 的步骤。

## 安装失败时

先确认自己正在做的是 A、B、C、D、E 中哪一种，停在了哪一步。保留**最前面的具体错误、文件路径和前后日志**，不要只截最后一句“失败”。反馈时附上系统版本、安装方式和错误截图，隐藏模型密钥、鉴权链接和私人剧情。

### Windows 一键安装：安装失败、访问被拒绝或更新一直转圈

重新下载 A 中的修复版安装包，先保存操作、关闭已打开的酒馆，再按原安装位置修复。不要继续使用旧版 \`Setup.exe\`。重新运行安装包会关闭所选安装的旧进程，并联网更新酒馆。

启动错误可查看安装目录的 \`launcher-error.txt\`；首次联网安装问题可查看数据目录的 \`first-install.log\`。详细说明见 [Windows 安装与启动入口](https://github.com/flizzywine/dsh-tavern/blob/main/docs/installation.md#windows-一键安装版)。

### Windows 旧便携版找不到入口，或原安装目录不可用

旧便携版用户运行 A 中的新安装包，选择 **修复并启动**，可在原位置补建入口并保留数据，无需重新导入人物卡。

提示 **已记录的安装目录暂时不可用** 时，如果要保留旧数据，先连接原磁盘或选择 **使用原目录**。确认旧安装已卸载、希望重新开始时，选择 **重新安装** 并指定位置，无需手动清理注册表。重新安装不能恢复已经删除的数据。

### Desktop：命令报错、版本不匹配，或重启后没有酒馆

确认 Desktop 是 **2.0.13**，且命令是在 **设置 → 通用设置 → 打开 DSH 终端** 中执行的。Windows 使用 B 中的 PowerShell 命令，不要使用 C 中的命令行版命令。

如果提示找不到 Node.js，先确认使用的是 Desktop 打开的 DSH 终端。若安装成功但仍是普通 DSH 界面，在 **设置 → 桌面设置 → Profile** 中选择 **tavern**；没有这个选项时，回看终端中的安装错误。

普通 Desktop 内置更新失败或一直停在更新中，可从 DSH 终端重新执行 B 中的命令，完成后重启。仍失败时保留完整错误，不要反复换安装方式。

### 命令行版：命令无法识别或网页打不开

\`node\` 无法识别：安装 Node.js 后重新打开 PowerShell / 终端，再运行 \`node --version\`。\`dsh-tavern\` 无法识别：先新开终端重试，仍失败时检查安装是否真正完成。

网页打不开：运行 \`dsh-tavern status\` 查看状态；服务未运行时先 \`dsh-tavern start\`，再 \`dsh-tavern open\`。不要只输入不含鉴权信息的端口地址。

### Android：初始化失败、白屏或提示需要认证

独立 APK 初始化失败时保留错误日志，再点击启动重试。安装日志位于容器内 \`/root/.dsh/logs/tavern-install.log\`。

DSHA 窗口白屏时先点顶部 **刷新**，仍不正常可点 **直接打开**；两个入口都打不开时，返回 DSHA 确认服务运行，再尝试 **更新/修复**。

浏览器显示 \`dsh web authentication required; reopen the URL printed by dsh web.\`，表示缺少登录凭证，不代表安装失败。回到 **DSHA → 启动 → 进入 → 酒馆工作台** 即可，不必重装。

必须用外部浏览器时，从 DSHA 本次启动日志的 **本机打开** 复制完整地址，包括 \`?token=\` 后的全部内容，在同一台 Android 设备的浏览器打开，再进入酒馆工作台。MuMu 用户在模拟器里的浏览器操作。详见 [Android 认证排错](https://github.com/flizzywine/dsh-tavern/blob/main/docs/android-install.md#浏览器提示需要认证怎么办)。

### 能打开酒馆，但发送后没有回复

这时先检查[文字模型配置](#a03)和服务返回的错误。能进入界面但不能生成，不等于安装失败，无需先重装。

更多问题见[常见问题](#n08)与[排错日志](#n04)。需要手动安装或查找高级目录配置时，参考[完整安装说明](https://github.com/flizzywine/dsh-tavern/blob/main/docs/installation.md)。

安装包校验：[Android APK SHA-256 文件](https://github.com/flizzywine/dsh-tavern/releases/download/v2.1/dsh-tavern-android-release.apk.sha256)。Windows EXE SHA-256：\`a21e2ea4bc7bb8d1154b6d133c3bd6c6ca139006c74140527925104731d02951\`。
`

export const pluginInstallation = `
## 适用条件

已安装 **DSH 0.1.5-rc.2、Node.js 22.19+、pnpm**，准备新建独立的 \`tavern\` Profile。当前先支持普通 DSH CLI 的新安装。

已通过专用安装器安装的 CLI、Desktop 或 Android 酒馆，请继续使用各自原有的更新方式，不要向同一个 Profile 叠装。其他安装方式见[安装与启动](#a02)。

## 从 GitHub 安装

需要 Git。在终端运行：

` + code('bash', 'dsh plugin --profile tavern add github:flizzywine/dsh-tavern') + `

DSH 会创建 Profile、安装完整运行包并启用酒馆。运行包包含 Web 配置、侧栏、人物卡功能、预设和 Skill，无需自行构建。酒馆使用当前 DSH，启动时检查适配版本，不会另装或升级宿主。

## 启动与更新

安装完成后运行：

` + code('bash', 'dsh --profile tavern') + `

打开酒馆网页，看到 Tavern 界面后，继续[配置文字模型](#a03)并[开始第一局](#a04)。

更新时先关闭酒馆，重新运行上述 GitHub 安装命令，再启动。页面中的“查看更新命令”提供对应命令，这种安装方式不使用专用安装器的源码更新器。

## 数据位置与使用边界

数据位于当前 \`DSH_HOME\` 下的 \`profile-data/tavern/\`；未设置 \`DSH_HOME\` 时通常为 \`~/.dsh/profile-data/tavern/\`。程序由 Profile 的包管理器维护。

这条路线不会迁移旧 CLI 的独立数据，也不附带 Desktop 的 Pocket 手机访问配置或宿主字体文件修改。侧栏终端复用宿主提供的 \`node-pty\`；宿主缺少此依赖时，终端会显示修复提示，酒馆仍可使用。
`

export const appearance = `
## 选择皮肤

CLI、Desktop 和 Android 酒馆均自带 [Dream Skin](https://github.com/RevolutionLA/dsh-dream-skin)（内置适配版本 9.23.0），无需另装。

1. 打开 **设置 → Theme / 外观**。
2. 选择“酒馆 · 暖陶土”浅色或深色，也可以选择其他皮肤。
3. 返回酒馆查看效果，按钮、面板、边框和正文强调色会随当前主题切换。

## 背景与壁纸

首次默认无背景图片；切换部分皮肤时会应用对应渐变，也可以自行设置或清空壁纸。已有皮肤、强调色和壁纸设置保留。

## 旧版如何使用

通过酒馆原有更新入口升级并重启后即可使用，无需重装 Desktop 或 APK。更新步骤见[安装与更新](#a02)。
`
