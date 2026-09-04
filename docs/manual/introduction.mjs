// Commands mirror README installation instructions; tests guard against drift.
export const installCommands = {
  desktopWindows: "$env:DSH_TAVERN_HOST='desktop'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.ps1')); Invoke-Expression $tavernInstaller",
  desktopMac: 'curl -fsSL https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.sh | DSH_TAVERN_HOST=desktop sh',
  cliWindows: "$env:DSH_TAVERN_HOST='cli'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.ps1')); Invoke-Expression $tavernInstaller",
  cliUnix: 'curl -fsSL https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.sh | DSH_TAVERN_HOST=cli sh',
  android: '请运行这条命令安装 DSH Tavern，完成后告诉我结果：curl -fsSL https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/android/setup.sh | bash',
}
const code = (language, text) => '\n```' + language + '\n' + text + '\n```\n'

export const introduction = `
## DSH Tavern 是什么

DSH Tavern 是一个以文字为主的 AI 角色扮演与故事游玩工具，提供类似 SillyTavern 的文字游戏体验。导入一张人物卡，就可以进入它设定的世界，与角色对话、采取行动，让故事继续发展。

它运行在 DeepSeek Harness（简称 DSH）上：DSH 提供模型连接和运行环境，Tavern 提供人物卡、游玩界面、资源工作台和相关功能。你现在看到的是使用文档，实际游戏需要安装后打开。

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
| 右侧栏 | 查看剧情指导、人物状态和剧本进度 | 查看人物卡库、世界书库、剧本库和预设库，编辑或引用资源 |

人物卡可能自带正文美化和状态栏，所以不同卡的展示细节会不同。主体始终是文字故事，插画是可选的高级能力。

## 界面截图

## 一次游玩是怎样的

1. 选一张喜欢的人物卡，预览并确认开场。
2. 阅读故事，输入自己的行动或对白；没想好时可以看看候选建议。
3. 发送行动，等待新的剧情与状态结果。
4. 继续下一轮；不满意时可以重写、回退，或添加持续剧情指导。

例如，你可以直接写“我先不回答，走到窗边看看街上的情况”，不必按固定选项行动。

## 可以带来什么内容

支持导入酒馆人物卡、世界书和预设，也可以导入小说、剧本或大纲。正则、MVU 和前端美化的具体支持范围，见[酒馆生态兼容](#compatibility)。

想改变内容时，进入[卡片模式](#cards)，告诉 Agent 哪些不喜欢、希望怎样调整，以及哪些需要保留。它也可以从素材中抽取人物与设定来制作新卡。

## 开始前需要准备什么

- 一台可运行 DSH 的设备，按[安装与启动](#a02)选择桌面版或命令行版。
- 一个可用的文字模型服务，准备服务地址、模型名称和所需的 API 密钥；模型调用可能产生费用。
- 一张想玩的 PNG / JSON 人物卡；也可以安装后再通过卡片模式制作。

不用先导入外部预设。用户画像、文生图和其他高级设置都可以先跳过，遇到需要时再查。

## 下一步

还没安装：先看[安装与启动](#a02)。已经装好：从[完成第一次游玩](#a04)开始，再按需要查阅四部分功能文档。
`

export const installation = `
## 选择安装方式

| 方式 | 适合谁 | 支持平台 |
| --- | --- | --- |
| DSH Desktop 桌面版 | 希望由桌面程序管理运行环境、启停和端口 | Windows x64、macOS |
| 命令行版 | 希望通过浏览器访问、自己管理服务 | Windows、macOS、Linux / WSL2 |
| Android 实验版 | 愿意自行排错的手机用户 | 通过 DSHA 尝试安装，不保证一定可用 |

桌面版与命令行版选择一种即可，不要同时运行。下方命令会下载并执行本项目安装脚本，请在确认项目来源可信后运行；网页本身不会自动执行安装。

本版适配 DSH {{dshVersion}}。安装器不会强制替换已安装的其他 DSH 版本；版本不一致时请留意兼容性提示。

## 方式一：桌面版

1. 先安装 [DSH Desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) 2.0.2 或更高版本。
2. 启动后，从系统托盘或 macOS 菜单栏打开 **Open DSH Terminal**。
3. 在这个终端里，运行你所用平台的命令。

### Windows
` + code('powershell', installCommands.desktopWindows) + `
### macOS
` + code('bash', installCommands.desktopMac) + `
安装完成后，重启 DSH Desktop，从托盘的 **Profile** 菜单选择 **tavern**。看到酒馆界面后，继续下方的“配置模型并开始第一局”。桌面版由 DSH Desktop 管理启停，不需要另外启动命令行服务。

## 方式二：命令行版

先准备 Node.js 22.19 或更高版本。建议安装 Git，便于增量更新；没有 Git 时安装器会回退到 ZIP 下载。未安装 DSH 时，安装器会安装本版适配版本；已有 DSH 则保留原版本。

### Windows PowerShell
` + code('powershell', installCommands.cliWindows) + `
### macOS / Linux / WSL2 终端
` + code('bash', installCommands.cliUnix) + `
安装器会安装依赖、启动酒馆，并在首次安装时打开网页。如果关闭了页面，可以重新打开：
` + code('bash', 'dsh-tavern open') + `
也可以运行以下命令查看服务状态与访问地址：
` + code('bash', 'dsh-tavern status') + `
请使用显示的完整访问地址；它可能包含鉴权 token，不要分享给别人。这里只打开浏览器页面，不是重新安装。

## 配置模型并开始第一局

1. 在左侧栏底部打开 **设置 → 模型**。
2. 按服务要求填写 API 密钥、服务地址并选择文字模型。
3. 导入 PNG / JSON 人物卡，选择新建游玩。
4. 预览开场、按需设置玩家称呼，然后发送第一条行动。

能够看到新生成的正文，就完成了首次游玩。不需要同时配置外部预设、用户画像或文生图。详细步骤见[配置文字模型](#a03)和[第一次游玩](#a04)。

## 关机后如何重新打开

桌面版：重新启动 DSH Desktop，确认当前 Profile 是 tavern。

命令行版：先启动服务，再打开页面。
` + code('bash', 'dsh-tavern start\ndsh-tavern open') + `
需要停止或重启时，分别使用以下命令：
` + code('bash', 'dsh-tavern stop\ndsh-tavern restart') + `
关闭浏览器页面不等于停止服务；电脑关机则会结束本机服务。这里说的是游戏服务，和本地文档预览地址 127.0.0.1:4173 不同。

## 更新与重新安装

首次安装、更新或重新安装，都可以运行上面对应宿主、对应平台的安装命令。一般无需先卸载；安装器更新程序文件，保留人物卡、对话、配置、自定义工具和 Skill。

重新安装前仍建议[备份数据](#n07)。如果使用自定义安装或数据目录，请保持原配置。

命令行版也可使用：
` + code('bash', 'dsh-tavern update') + `
这个命令更新 Tavern，不是升级 DSH 本体。桌面版在 DSH Terminal 中重新运行桌面安装命令，完成后重启 Desktop。若内置更新失败，也可用对应安装命令更新安装器和程序。

## Android：通过 DSHA 安装

**Android 属于实验性支持，不保证一定可用。** 不同手机系统、DSHA 版本、网络和后台限制都可能导致安装或运行失败。

1. 安装 [DSHA](https://github.com/qiannianhuanxiang/DSHA)，配置模型并成功启动一次。
2. 打开“创造模式”，把下面这句话发给 AI。
` + code('text', installCommands.android) + `
3. 安装完成后重启 DSHA，在侧栏打开“酒馆工作台”。

以后可使用“更新到最新版”；打不开时尝试 DSHA 酒馆工作台入口中的“更新/修复”。使用时请允许 DSHA 后台运行，避免系统省电策略中断服务。

## 安装失败时

- 先保留最前面的具体错误与文件路径，不要只截取最后一句“失败”。
- 无法打开网页：检查服务是否运行，并使用含鉴权信息的完整地址。
- 能打开但不能生成：先检查模型服务配置和服务返回的错误。
- 一键命令仍无法使用：查看[手动安装说明](https://github.com/flizzywine/dsh-tavern#手动安装)。

更多说明见[常见问题](#n08)与[排错日志](#n04)。不要公开模型密钥、鉴权链接或私人剧情。
`
