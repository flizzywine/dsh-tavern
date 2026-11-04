# DSH Tavern Image

给 DSH Tavern 用的剧情配图插件。它读取已经完成的正文，挑选适合画成插图的场景，再交给你配置的生图服务生成，按剧情位置插回消息里。

可以用本地 ComfyUI、SD WebUI / Forge，也可以接 NovelAI、OpenAI Images、Gemini 等渠道，或新增自定义 API 渠道并选择 AtlasCloud 等协议使用在线服务。人物资料、画风、提示词规则和图片记录在同一个面板里管理，适合给长篇角色扮演和故事配图。

## 插件的长处

- **图片跟着正文走。** 配图可以插在对应句子后面，并与这版正文绑定。切换回复版本时，显示的是对应版本的图，方便重写和回看剧情。
- **少画没有必要的图。** 智能选图允许规划模型跳过没有独立画面的回合。想给某轮补图时，手动生图仍然可用。
- **人物资料可以反复使用。** 外貌和服装集中维护，按当前卡片筛选角色；长篇中明确发生的永久外貌变化可以另存历史，减少前后提示词不一致。
- **参考图与文字可以配合使用。** 支持参考图的内置渠道和自定义 API 渠道可按本张出场角色和所穿服装上传参考图；有图的对象以图约束固定外观，缺图的对象仍用文字，不把整个人物库发送出去。
- **提示词格式与规则分别维护。** 标签、自然语言、混合、结构化自然语言各有独立世界书；结构化模式默认中文分节，也可修改其规则。
- **写故事和画图可以用不同的模型。** 正文模型负责剧情，规划模型负责画什么、插在哪里、怎么写提示词，生图渠道负责出图。三者可以分别选择。
- **本地和在线服务都能用。** ComfyUI 可以直接选模型，也可以导入自己的工作流；换到在线渠道后，人物库、画风和正文配图流程仍可使用。

这些功能主要解决配图位置、资料维护和操作流程的问题。角色一致性和最终画质仍受生图模型、提示词、种子、LoRA 等因素影响，人物库不能保证每张图都完全一样。

## 安装与第一次出图

需要已经能使用的 DSH Tavern，以及本地生图服务或在线平台的 API 地址和密钥。

### Windows 安装

安装器默认使用 `%USERPROFILE%\.dsh` 下的 `tavern` Profile；可通过 `-Profile` 指定另一个**已经存在**的 Profile。安装器只安装插件源码，不运行仓库脚本；它调用 DSH 官方 CLI 的 `plugin add`，附带 `--ignore-scripts`，由 DSH 将 `dsh-tavern-image` 依赖、`node_modules` 链接和 bundle 一起登记。若目标目录或 Profile 中已有 canonical 注册，或 Profile 仍登记旧包名 `dsh-tavern-comfy`，安装器会停止，不覆盖已有内容或制造双重加载；更新已安装插件请用插件自己的更新页，旧注册迁移见下文。

已发布的离线安装包可从 [GitHub 发布页](https://github.com/weixinlll/dsh-tavern-image/releases)下载。解压后双击 `Install-DshTavernImage.cmd`，安装器直接使用包内源码，不必再从 GitHub 下载。发布页也提供独立源码包和 SHA-256 校验文件。请核对发布版本；需要最新的 2.5.3 修复时，可用下方的源码 ZIP 安装方式。

也可以在 GitHub 仓库页选择 **Code → Download ZIP**，解压后双击 `scripts\Install-DshTavernImage.cmd`（同目录有 `install-plugin.ps1`）。浏览器下载 [GitHub Archive ZIP](https://github.com/weixinlll/dsh-tavern-image/archive/refs/heads/master.zip) 或 [codeload ZIP](https://codeload.github.com/weixinlll/dsh-tavern-image/zip/refs/heads/master) 后，可以在 PowerShell 中指定文件：

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\install-plugin.ps1" -SourceArchive "$env:USERPROFILE\Downloads\dsh-tavern-image-master.zip"
~~~

ZIP 顶层即使多套几层目录也能识别。

### 一键包 / 改版 DSH 的安装位置

有些一键包或改版把 DSH 数据放在别处，而且**根目录下面直接就是 `profiles` 文件夹**（没有 `.dsh` 这一层），例如 `D:\dsh\profiles\tavern`。安装器会自己找：

- 依次尝试：`-DshHome`（别名 `-Root`）→ 环境变量 `DSH_HOME` → `%USERPROFILE%\.dsh`、`%USERPROFILE%\dsh`、`%LOCALAPPDATA%\dsh`、`%APPDATA%\dsh` → 各固定磁盘根下的 `.dsh` / `dsh` / `DSH` / `dsh-tavern`
- 找不到时会把**找过的位置全部列出来**，并给出可直接复制的命令；安装开始时会打印最终选定的数据目录
- 手动指定时下面三种层级任选，都能自动识别成同一个数据目录：

~~~powershell
# 三种写法等价
powershell -NoProfile -ExecutionPolicy Bypass -File ".\install-plugin.ps1" -DshHome "D:\dsh"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\install-plugin.ps1" -Root "D:\dsh\profiles"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\install-plugin.ps1" -Root "D:\dsh\profiles\tavern"
# 指定另一个已存在的 Profile
powershell -NoProfile -ExecutionPolicy Bypass -File ".\install-plugin.ps1" -DshHome "D:\dsh" -Profile other
~~~

如果那个环境不用标准 DSH CLI 管理插件，加 `-NoRegister`：安装器只把源码放进 `profile-data\<profile>\data\tools\dsh-tavern-image`，不再调用官方 CLI，由你按该环境自己的方式启用（登记 link、加进插件清单等），然后完整重启 DSH。

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\install-plugin.ps1" -DshHome "D:\dsh" -NoRegister
~~~
安装器只复制插件包白名单，不复制 Git 历史、测试、`config.json`、`definitions.json`、世界书、缓存、任务记录或用户工作流。若已解压仓库，也可以传入 `-SourceDirectory`，安装器仍会逐个筛选允许的包文件。

有网络时，不带来源参数会先试官方 codeload，再试 GitHub Archive：

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\install-plugin.ps1"
~~~

若下载失败，可先用浏览器下载 ZIP 再传入 `-SourceArchive`；也可以克隆源码到单独的临时目录并用 `-SourceDirectory` 安装：

~~~powershell
git clone https://github.com/weixinlll/dsh-tavern-image.git "$env:TEMP\dsh-tavern-image-source"
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\dsh-tavern-image-source\scripts\install-plugin.ps1" -SourceDirectory "$env:TEMP\dsh-tavern-image-source" -Profile tavern
~~~

运行 `scripts\Package-DshTavernImage.ps1` 可生成可离线携带的 ZIP；解压后双击其中的 `Install-DshTavernImage.cmd`。插件 **设置 → 配图 → 插件更新**页的“本机安装包”入口也可导出源码 ZIP，拷贝到目标电脑后用 `-SourceArchive` 安装。这个入口用于下载和转移安装包；当前 DSH Desktop 的插件清单页没有经验证的 GitHub URL/ZIP 安装输入框，不要在该页粘贴仓库网址。

安装器会显示插件版本和 ZIP 的 SHA-256，发布页也提供 `SHA256SUMS.txt`，下载后可以比对文件是否完整。安装后完整退出并重新打开 DSH Desktop，刷新网页不能替代宿主重启。

### 旧版目录迁移

已有旧包名 `dsh-tavern-comfy` 的安装不要再并排装一份。先完整退出 DSH（包括托盘进程）并备份整个插件目录。若旧目录仍叫 `dsh-tavern-comfy`，仅在确认 `tools` 下没有另一份 `dsh-tavern-image` 后改名为 `dsh-tavern-image`；不要覆盖或合并两个目录。Profile 的旧依赖由 DSH 官方 CLI 移除，不能手工编辑 bundle 列表：

~~~powershell
$plugin = Join-Path $env:USERPROFILE '.dsh\profile-data\tavern\data\tools\dsh-tavern-image'
$source = 'C:\path\to\dsh-tavern-image-candidate'
$backup = Join-Path $env:USERPROFILE 'dsh-tavern-image-backup-before-canonical-migration'
if (-not (Test-Path -LiteralPath $plugin -PathType Container)) { throw "找不到旧插件目录：$plugin" }
if (Test-Path -LiteralPath $backup) { throw "备份目录已存在，请先检查：$backup" }
if (-not (Test-Path -LiteralPath (Join-Path $source 'package.json') -PathType Leaf)) { throw "候选源码目录无效：$source" }
Copy-Item -LiteralPath $plugin -Destination $backup -Recurse

$dshCli = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
if (Test-Path -LiteralPath $dshCli) {
  & $dshCli plugin --profile tavern remove dsh-tavern-comfy
} else {
  $dshCli = Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js'
  if (-not (Test-Path -LiteralPath $dshCli -PathType Leaf)) { throw '找不到 DSH 官方 CLI；请先定位正确的 CLI 路径。' }
  $env:PATH = "$env:USERPROFILE\.dsh\runtime;$env:PATH"
  node $dshCli plugin --profile tavern remove dsh-tavern-comfy
}
if ($LASTEXITCODE -ne 0) { throw 'DSH 官方 CLI 未能移除旧包登记；停止迁移并保留备份。' }

$codeFiles = @(
  'package.json', 'client.js', 'cordis.patch.yml', 'console.html', 'design-rules.md',
  'LICENSE', 'README.md', '世界书-通用生图规则.json', '世界书-角色与服装库.json',
  'scripts/install-plugin.ps1', 'scripts/Install-DshTavernImage.cmd', 'scripts/Package-DshTavernImage.ps1'
)
foreach ($file in $codeFiles) {
  Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $plugin $file) -Force
}
robocopy (Join-Path $source 'lib') (Join-Path $plugin 'lib') /E
if ($LASTEXITCODE -ge 8) { throw '复制插件代码失败；保留备份并停止迁移。' }

if ([IO.Path]::GetExtension($dshCli) -eq '.cmd') {
  & $dshCli plugin --profile tavern add "link:$($plugin.Replace('\', '/'))" --ignore-scripts
} else {
  node $dshCli plugin --profile tavern add "link:$($plugin.Replace('\', '/'))" --ignore-scripts
}
if ($LASTEXITCODE -ne 0) { throw 'DSH 官方 CLI 未能登记新包；保留备份并修复 CLI 后再继续。' }
~~~

把 `$source` 改成 2.9.1 候选仓库目录。上述复制只替换程序、两个只读 seed 和发行文件，保留原目录中的 `config.json`、`definitions.json`、`worldbook-outfits.json`、`workflows`、缓存及历史数据；整份备份在确认迁移成功前不要删除。若旧目录叫 `dsh-tavern-comfy`，先安全改名后再运行本步骤。其他 Profile 请把命令中的 `tavern` 改成对应名称。确认 CLI 成功后检查 Profile 只登记 `dsh-tavern-image`，再完整启动 DSH。安装器遇到旧登记时会停止并给出官方 `plugin remove` 指引；它不会替你编辑 Profile 或覆盖现有插件目录。若官方 CLI/pnpm 操作失败，保留备份并先修复官方包管理器，不要手改 bundle 或用裸 `pnpm add` 冒充完成注册。

**1.2.0 及更早版本**若通过 Git 安装，可先检查 `git status` 和分支、备份本地改动并退出 DSH，再把旧远端改到官方仓库并快进更新。出现本地改动或冲突时停止，不要强制覆盖。更新后按上面步骤改名并重新登记 link。配置、人物资料和历史记录留在原目录；若新旧目录都存在，先核实备份，不要合并或覆盖。

### 配置生图服务

打开 **设置 → 配图 → 生图规划**，选择提供商，填写地址、模型和鉴权信息并保存。

- **ComfyUI**：填写服务地址，默认是 `http://127.0.0.1:8188`。有鉴权时选择 Bearer 或 Basic，再测试连接；导入 API 格式工作流并设为默认。
- **在线平台**：新增渠道，填写平台提供的 API 根地址、模型名和 API Key。中转服务需要选择它实际支持的协议。
- **SD WebUI / Forge**：服务端需要开启 API，地址要能从运行 DSH 的设备访问。

“测试连接”不会提交生图任务。部分平台没有合适的只读探测接口，会显示“已配置”；这表示配置已填好，实际出图还需要确认模型权限、额度和服务端支持情况。

### 配置规划模型

在「配图规则」里选择规划模型。留空时跟随 Tavern 配置的后台模型，也可以单独指定渠道、模型和推理等级。

保存后，先用消息下方的「生图」按钮测试一轮，确认提示词、人物和图片位置是否合适，再使用每轮自动规划。使用参考图设计角色时，还需要配置支持视觉的看图模型。

## 自动配图与生成速度

后台配图由 **每轮自动规划配图（前台只写正文）** 控制。它在 Tavern 的轮次结算事件到达后启动，读取正文和可用的角色资料，生成图片计划，再把图片挂到对应句子后面。

开启 **智能决定是否配图** 后，“一轮几张”是图片数量上限，规划模型可以少画，也可以整轮跳过。例如只有简短对话、整理信息或过渡内容的回合，可以不生成图片。判断是否合适仍由规划模型完成，手动生图可以绕过自动跳过决定。

生成任务在后台运行，结算通知不需要等模型和图片全部完成。多张图各自完成后显示，较慢的一张不会挡住已经完成的图片。外部渠道默认同时生成 2 张，可以调整为 1–4 张；ComfyUI 的实际执行速度和顺序由它自己的队列决定。

智能选图先输出一次明确的配图决定和原因；需要记录角色变化时，先完成角色更新块。决定配图后，每张完整提示词通过校验就提交，模型继续规划后面的图片。第一张出图不需要等待整份规划结束。

规划决定不能在提交后撤回。后续输出出现矛盾或中断时，会停止尚未提交的图片并报告错误，保留已提交的任务。模型决定跳过时不会提交图片。重复提示词、缺少正文锚点或没有闭合的画面块也不会提交。

多张图按重要性输出，用不同景别、动作或叙事用途表现正文；人物外貌、服装和地点跟随各画面对应的剧情时点。具体构图由模型决定，插件会拦截提示词完全相同的重复任务。

当前 Tavern 的公开事件是在轮次结算后触发。插件能减少规划和出图之间的等待，但不能把启动时机提前到正文生成中，也不会加速 Tavern 本身的结算。

正文下方的「生图」按钮可能比结算事件更早出现。此时手动点击会等待官方正文接口可读；如果后台自动配图也已开启，这次等待会合并到同一份任务，避免重复提交。按钮出现并不代表后台已提供正文数据，插件目前没有实现按钮出现时自动点击。

同一版正文的自动处理会复用已有计划，避免重复事件再次收费。更换渠道或世界书规则会用于后续新轮次；需要重新处理当前轮时，使用手动生图。

### 自动规划和正文标记有什么区别

ComfyUI 能提供采样步数时，正文插图卡和舞台会显示当前进度，直到图片可用才显示完成。通过代理连不上进度通道时，图片仍会照常生成，界面显示等待状态。只返回排队状态的渠道也显示等待状态。

插件还保留了另一种方式：让前台模型在正文里输出 `image###提示词###` 标记，再按标记生成图片。

| 方式 | 控制项 | 用途 |
|---|---|---|
| 后台规划 | 每轮自动规划配图 | 正文完成后，另一次模型调用负责选场景、位置和提示词 |
| 正文标记 | 自动生图 / 生图数量 | 前台模型在正文中写出生图标记；使用时需关闭智能选图并开启自动生图 |
| 手动生成 | 消息下方的生图按钮 | 指定某轮重新规划配图，不受自动规划开关和自动跳过限制 |

后台规划默认开启，正文标记默认关闭。只想手动生图时，可以关闭后台自动规划；若也不需要自动记录角色外貌历史，可以同时关闭角色自动更新，避免结算后继续调用规划模型记录外貌。

「换装时参考本卡服装库」默认关闭。启用后，当前人物卡的配图服装会以简短提示随正文请求发送，方便剧情写到换装时沿用配图中的颜色和款式。优先列出本轮点名的服装，最多 12 套、1200 字。玩家指定的衣服和已经写明的剧情优先。尚未读到当前人物卡时，这一轮跳过服装提示。

## 生图渠道

支持 `imageModels: 1` / `imageLibrary: 1` 的 Tavern 还能把本插件的已配置模型、人物与服装提供给其他插件复用。模型可以按保存的渠道选择，人物按卡片绑定筛选；通用服装与角色服装都有独立 ID。接口读取当前资料，编辑仍走本插件原有的保存和备份流程。接口定义与示例见 [Tavern 媒体与数据接口](https://github.com/flizzywine/dsh-tavern/blob/main/presets/tavern/skills/tavern-plugin/references/plugin-api-data.md)。

| 提供商 | 接入方式 |
|---|---|
| ComfyUI | API 格式工作流，支持 Bearer / Basic 鉴权 |
| NovelAI / 同协议第三方 | NovelAI 生图协议 |
| OpenAI / Images 兼容中转 | Images 接口，可处理 Base64 和图片 URL 返回 |
| Google Gemini 原生 | 原生 `generateContent` 图片响应 |
| Banana / Gemini 聊天兼容中转 | `chat/completions` 中的图片内容或链接 |
| Grok Images | xAI 图片接口 |
| Seedream / 火山方舟 | Ark 图片接口 |
| 百炼 Qwen-Image | DashScope 图片接口 |
| SD WebUI / Forge | `sdapi/v1/txt2img` |
| 自定义 API | 选择 OpenAI Images、Gemini、Gemini Chat、AtlasCloud 原生异步接口、Seedream、Grok、Qwen、SD WebUI 或 NovelAI 协议 |

同一个提供商可以配置多条渠道，分别保存名称、地址、模型和鉴权；自定义 API 渠道可选择受支持的协议，包括 AtlasCloud。可以在自己的服务和不同中转之间切换，无需把原配置删掉再重新填写。复制渠道后，需要给副本填写自己的密钥。

维护接入代码时，协议请求留在 `lib/image-providers.js`，能力判断留在 `lib/image-provider-capabilities.js`，渠道配置留在 `lib/image-channels.js`；对外模型与人物、服装投影集中在 `lib/image-catalog.js`。新增平台兼容已有协议时，优先配置自定义渠道；新增协议时再实现适配器。适配器不负责写剧情、保存人物或渲染界面。

设置页运行任务时通过轻量 `/runtime` 读取进度，完成后同步完整状态；隐藏页面暂停轮询，慢请求不会重叠。这减少世界书、人物库和诊断信息的重复传输，不改变模型服务本身的生成耗时。

这里接的是平台 API，网页登录账号不能代替 API Key。第三方服务只有在兼容相应协议时才能使用；单有网址和密钥，并不代表所有平台都能接入。

渠道密钥在设置界面中不回显。留空保存会保留原密钥，明确清除后再保存才会删除。下载服务返回的图片链接时，不会把 API Key 发送给图片服务器。

生图请求遇到网络错误时不会自动重发。如果服务端已接收任务但响应丢失，先查看任务记录，再决定是否手动重试，避免重复创建付费任务。

### 自定义渠道使用 AtlasCloud 协议

在 **设置 → 配图 → 生图规划** 中新增「自定义 API」渠道，将「API 协议」设为 **AtlasCloud**，填写 API 根地址与 Atlas Cloud API Key 后点“保存并测试连接”。这使用 AtlasCloud 原生接口，无需另行安装 MCP。

- 默认 API 根地址：`https://api.atlascloud.ai/api/v1`；默认文生图模型：`black-forest-labs/flux-schnell`。模型栏可填写自定义 ID，连接测试后提供当前公开目录中的文生图模型建议。
- **尺寸参数格式**默认 `size`，将规划尺寸或手填的 `1024x1536` 转成 Atlas 所用的 `1024*1536`。Nano Banana 等模型应改选 `aspect_ratio`；也可选“不发送尺寸参数”，使用模型默认值。不同模型的尺寸、比例枚举不通用，更换模型时请核对平台文档（例如 Seedream 需要其支持的尺寸）。
- 为兼容不同模型，负面提示词以 `Avoid:` 描述合入提示词，不会通发原生 `negative_prompt`、`seed` 或采样参数。
- 测试只读取已鉴权的任务历史与公开模型目录，不创建付费任务；查询正常不代表所有模型均有权限或额度。没有任务历史读取权限时会显示测试失败，但不能据此断定没有生成权限。
- 提交后自动轮询任务并下载图片；网络中断或重启后，已有任务号可继续只读查询，不会自动重新提交。取消仅停止本地等待，平台任务可能仍继续生成。

接口依据：[Atlas MCP](https://github.com/AtlasCloudAI/mcp-server)、[Predictions API](https://www.atlascloud.ai/docs/en/predictions.md)、[Flux Schnell 模型参数](https://static.atlascloud.ai/model/schema/black-forest-labs-flux-schnell.json)。参考图模式先上传本张选用的图片，再将返回的图片地址按顺序交给生成接口；不使用调用者提供的远程图片 URL 或本机路径。

### 参考图模式：从人物与服装生成新的剧情画面

参考图模式用于生成新的场景，不是在已有成图上修改。支持参考图的内置渠道和自定义渠道均可使用；自定义渠道选择 OpenAI、Gemini、Gemini Chat、AtlasCloud、Seedream、Grok、Qwen 或 SD WebUI 协议时可启用参考图，NovelAI 协议不支持。最终能力也取决于模型本身。选择参考图模式不会自动换渠道或模型 ID，也不会静默降级。

默认生图模式为文生图；仅保存角色或服装参考图不会自动启用参考图模式；即使全局默认参考图，单张图片仍可明确选择文生图并忽略已保存的参考图。

1. 选择支持参考图的渠道并填写准备使用的模型 ID。不同协议和模型的参考图能力、张数与参数限制可能不同，插件不维护模型允许名单，也不替你改成另一个型号。
2. 在人物库中上传参考图并保存。角色自己的服装可以另存一张「角色×服装设定图」。生成选择这套服装时，优先使用合图约束该角色和服装，省去分别上传两张图。普通角色图、单独服装图及通用服装图仍按原用途使用。支持 PNG、JPEG、WebP，单张最多 32 MiB。
3. 在配图设置中把「默认生图模式」切换为参考图；单张图片的重绘界面可以覆盖本次模式，不改变全局选择。
4. 生成后可查看实际提交的提示词、参考图编号与对象对应、平台错误。无需给规划模型开启视觉能力：规划读取正文和文字清单，参考图本身上传给所选生图渠道。

**按对象选择，不按整个图库发送。** 每张图只使用该画面实际出现的角色及其当刻服装；同一对象不重复添加，但不同对象恰好使用同一张图片时仍保留各自编号与绑定。有图用图、缺图用文字；如果整张图没有任何可用参考图，会暂停并提示。全部选中的参考图按顺序提交，不自动裁掉超限图片；上传或模型校验失败时展示错误，不丢弃失败图片后悄悄提交剩余部分。

**角色图与服装图职责不同。** 角色图用于面部、发型和体态，不继承其中的衣服、姿势、表情或背景；服装图用于服饰设计，不继承模特身份。动作、场景，以及剧情明确的换装、湿衣、破损、脱衣或外观变化优先，不能照搬参考场景。已有图的对象不再机械堆叠完整固定外貌词，缺图对象继续使用文字；一致性模板会自动加入，用户可以补充要求。

**重绘默认保留当时的输入。** 每张图片保存参考图、对象对应和一致性文本快照。替换人物库图片不会覆盖旧图片文件，重试或重绘默认沿用旧快照；只有明确选择使用最新人物库参考图时才重新取当前资料。不要手动清理仍被历史任务使用的参考图文件。

本轮参考图功能仅面向本机使用，**不提供参考图及其历史快照文件的导入导出或跨设备迁移**。现有文本导出、世界书导出和源码安装包都不会自动携带这些图片；复制文本或配置不等于备份参考图。请自行保留原图，必要时在停用插件后备份整个实际插件数据目录。

## 人物库与角色设计

人物库用来保存角色的稳定外貌和服装。规划模型知道正文中出现了谁，插件再把对应资料补到绘图提示词里；同一个人物不用每轮从零写描述。

外貌按角色特征、正背面、上下半身及常规 / 裸露版本分块保存。出图时根据视角和画面选择可见部分，减少近景里塞进全身细节、背面图仍强调正脸等冲突。服装可以保存多套，也可以使用通用服装资料。

角色较多时，界面用搜索和下拉框选择当前角色，一次只展开一个编辑区。支持按中文名和触发名筛选、收起编辑、复制角色，以及批量修改外貌字段、说明、启用状态和卡片绑定。

批量修改会先留在编辑区，检查后点击 **保存人物库**。切换角色会保留当前编辑草稿；后台刷新和异步设计返回时，会尽量保留期间的手动修改。复制角色会生成独立编号，修改副本不会改动原角色。

角色可以绑定卡片，未绑定的角色可供所有卡片使用。不同故事里有同名角色时，绑定卡片有助于减少误用资料。

设计角色可以使用文字需求、当前卡片上下文或参考图，也能让模型改进已有角色。参考图需要看图模型支持视觉；识别结果仍需检查，尤其是服装、发色、背面等图中看不清的部分。

## 角色随剧情变化与历史

人物库保存你维护的基础设定，角色历史保存某条剧情线中发生的外貌变化。两份数据分开，剧情更新不会直接改写全局人物库。

例如正文明确写出角色永久留疤、剪短头发或失明，插件可以为人物库里已知的角色记录这次变化，并在后续配图中使用。衣着、姿势和临时状态不会作为永久外貌变化写入。

历史按剧情线、轮次和正文版本保存。回退或切换正文版本时，插件读取宿主提供的对应快照；在「角色历史」面板可以查看变化，并把某个字段恢复到变化前。恢复会写入一条新的记录，不会把已有记录直接删掉。

这项功能需要 **Tavern 插件接口 v2**。接口 v1 下角色历史不可用，其他配图功能仍按宿主可用接口工作。历史记录有容量上限，异常或不完整输出会提示并沿用已有快照，不能当作无限容量的剧情档案。

## 提示词与画风预设

设置页的「画风」一节提供画风预设和提示词预设：

- **画风预设**保存画师串、固定风格词和负面词，可以调整放在提示词前面还是后面。
- **提示词预设**给规划和出图提供构图、光线、材质、色彩与画面重点的指导。内置杂志人像、电影叙事、动漫角色、东方幻想和氛围场景，也可以自己新增。

提示词表达可选择自动、标签、自然语言、混合或**结构化自然语言**。自动模式会按生图渠道选择实际表达方式：例如 NovelAI 更适合标签，OpenAI Images、Gemini 等渠道使用自然语言描述；「自动」不是第五套独立规则。

结构化自然语言在文生图与参考图模式下都可使用。默认按「人物与表情、服装、动作、环境、镜头与光线、风格、约束」用中文分节，**不包含“画面任务”**，没有内容的分节可以省略。分节标题、顺序与内容可通过对应世界书调整，参考图编号绑定和必要一致性约束仍由插件维护。格式改变并不保证画质更好，可根据自己使用的模型比较效果。

结构化参考图模式由插件统一生成一次参考图用途和编号说明，只生成本张实际用到的身份图／服装图规则。有身份图的人物，规划正文只写姓名和当前可见状态，不再用“年轻男性”等年龄、性别或固定外貌概括重新定义身份；明确的剧情外观变化和用户一致性补充仍保留。没有身份图（包括只有服装图）的人物仍使用文字资料。内部人物和服装 ID 保留在任务元数据中，不再通过伪造外貌字段追加到绘图文本。

规划规则要求单张定格在同一个动作阶段，明确视线落点、支撑关系与主导表情；只用有依据的衣着和陈设，核对遮挡、窗扇与光路，不为补齐栏目新增道具或重设画风。约束仅针对本张明确对象，通用优先级和未发生的状态示例不进入画面正文；插件追加的参考说明也不再固定罗列湿衣、破损等情节。以上通过规划指导实现，不对模型输出或手动提示词做关键词删除，以免误删真实变化。默认世界书升级到 v3，仅自动更新内容与旧版 v1／v2 默认条目完全一致的规则，并保存备份；用户修改、禁用、删除的条目和清空的分组不会被自动恢复。用户自定义分节与不同人物各自的重复特征不会被全局去重。旧任务的参考图快照仍可用于重画，不会自动换成最新人物库图片。

预设在现有规划调用中使用，不会为应用预设再额外调用一次模型。正面指导和负面约束分开保存，切换渠道时也可以继续使用自己整理的风格资料。

想保持一个故事的整体画风，可以固定一套预设；要改变某张图的镜头或气氛，则在这张图的提示词里单独修改。

## 工作流导入与可视化编辑

工作流模式适合继续使用你在 ComfyUI 中调好的流程。导入的必须是 **API 格式 JSON**，普通的画布工作流 JSON 不能直接作为生成请求使用。

插件会识别正负提示词、尺寸、采样参数、底模和 LoRA 等绑定。可以保存多份工作流，设定默认流程，按不同画风切换；识别不符合预期时，可以在编辑区调整绑定。

可视化编辑支持查看节点和连线、缩放和平移、拖动节点，在右侧修改已有节点的文字、数字和开关输入。保存时会备份旧文件，并保存节点位置；同一文件已被其他操作修改时，会提示重新打开，避免覆盖。

连线是只读的，增删节点或重新连线仍需在 ComfyUI 中完成后重新导入。自动绑定的提示词、随机种子和尺寸等输入，在出图时会由当前生成设置替换。

工作流库的试跑使用所选工作流，不会把试跑请求发给另一个渠道。

## 查看图片与重画

| 操作 | 效果 |
|---|---|
| 点击图片 | 在 DSH 内打开大图查看器 |
| 右键或长按图片 | 打开提示词和重画操作 |
| 查看器左右按钮或方向键 | 在图片之间翻页 |
| 滚轮、拖动 | 缩放和平移查看细节 |
| 编辑正负提示词后重画 | 新图成功后在原位置替换，旧图文件留在历史图中 |
| 取消这张图 | 停止等待指定任务，其他图片继续生成 |
| 重试这张图 | 只重试已确认失败的一张，不重新规划整轮 |
| 重画时选择渠道 | 这次使用所选渠道，不改全局生图设置 |
| 重画时选择生图模式 | 本次选择文生图或参考图；参考图模式要求当前渠道协议支持，不自动换渠道或模型 |
| 使用最新人物库参考图 | 明确更新本次参考图快照；不勾选时默认保留旧任务当时的输入 |
| 查看实际输入 | 查看实际提交提示词、参考图编号与对象对应，以及平台返回的错误 |
| 历史图面板 | 查看图片记录、打开大图或批量删除 |

提示词检查区将原始规划记录、可编辑重画草稿与最终提交文本分开。新结构化任务另记录人物／服装资料补充和参考图绑定层；旧任务缺少记录时明确标注回退，不从最终文本反推来源。参考图按上传顺序显示序号、用途和归属，内部 ID 放在折叠调试详情中。

也可以让后台模型按要求改写这张图的提示词，再用修改结果重画。图片概括由 Tavern 显示一处，插件保留替代文本，避免正文下重复出现同一说明。

正文中的单张重画通过 Tavern 的媒体接口更新原位置。新图成功前保留旧图，失败只显示该任务的错误；任务记录保存在服务端。历史图查看器的重画版本链仍保存在当前浏览器中，清理浏览器数据或换设备后不会自动同步。

再次点击某轮的「生图」会重新规划并替换这轮原来的配图。新图全部成功时清理旧配图；部分失败时保留没有被成功替换的旧图。历史图片文件仍留在历史图中。

每张图分别显示排队、生成、完成、失败或状态待确认。取消已提交任务只能停止本地等待，平台仍可能继续生成；插件不会为了取消一张图去中断 ComfyUI 的整个队列。请求超时或响应丢失时不自动重发。已知的 ComfyUI、百炼异步任务会查询原编号；查不到可靠结果时，请先到平台确认用量和任务。

## 世界书与图片格式

「世界书」页管理发给规划模型的配图规则，例如场景选择、镜头、角色资料使用和输出格式。标签、自然语言、混合、结构化自然语言**各有独立世界书**，每种格式仍分为「生图规则」和「角色与服装库」两组。编辑时先选择格式，只修改该格式的条目；规划使用当前实际生效格式的规则，不混用其他格式。

首次迁移会保存旧世界书快照及备份，并给标签、自然语言、混合各复制一份独立副本，保留原条目的适用性设置；结构化格式使用新写的中文专用规则。迁移不会覆盖已经存在的分格式世界书，旧文件也会保留。人物库与参考图共用，不随格式复制。

可以为选中的格式导入世界书 JSON，也可以粘贴 JSON 或纯文本，逐条编辑和启用；未启用的条目不会进入配图规则。导入导出规则不会携带角色或服装参考图。

每条规则可以选择常驻或关键词触发，并限制适用的生图渠道。常驻规则每轮携带；关键词规则只在本轮正文命中任一关键词时携带。没有填写关键词的触发条目不会注入。渠道全部不勾选时适用所有渠道，旧条目默认保留常驻行为。

人物的详细资料优先提供给本轮正文提到的角色，其他人物只留姓名索引。没有可靠匹配到姓名时会回退到全部可用角色，避免只用代词的正文遗漏人物。世界书页可以展开上次规划的条目、纳入或排除原因、角色和输入字符统计。

固定规则、输出协议和画风要求放在请求前部，动态条目、人物资料和本轮任务放在后部，方便支持上下文缓存的平台复用固定内容。请求仍通过 DSH 的模型接口发送；是否命中缓存取决于平台，字符统计不代表 token 数或实际费用，也不是模型的永久记忆。

导出会先尝试复制 JSON；剪贴板不可用时改为下载文件，并保留可手动复制的文本。

NovelAI 原生协议支持分角色提示词；启用世界书第 **11 条「分角色提示词（NovelAI）」** 后，规划模型会分别输出场景和角色块。种子规则文件已包含该条。已有用户的 `worldbook.json` 不会被升级覆盖，因此需要在「世界书」页手动添加第 11 条，或重新导入种子规则后启用；其他生图渠道会把角色提示词合并回单条提示词。

世界书页分别显示「正在编辑」和「实际生图」格式，切换编辑对象不会改变提示词格式；可通过页面入口前往画风设置调整实际格式。结构化默认规则 v2 为生图规则 6 条、角色与服装规则 2 条，补充单张定格、多人关系、镜头可见性、空间光线及中文示例。未修改的旧内置条目会在备份后安全升级；只有整组仍与旧默认一致时才自动补入新增条目。个人编辑、禁用和删除不会自动恢复。需要主动采用新规则时，可预览当前／新版差异，显式勾选并确认；预览后发生编辑会拒绝覆盖，需重新预览。

默认配图规则用于首次初始化及可确认的未修改内置条目升级，已保存的个人规则不会随插件升级重置。导入的其他引擎宏和包装语法会做清理；只导入适合绘图规划的内容更容易检查结果。

需要减少图片体积时，可以开启 **PNG 转 JPEG**，质量可设为 50–100。透明区域会按所选背景色铺底。已经是 JPEG 或其他格式的图片不会重复转换；转换失败或超过限制时保留原图并给出说明。默认保持原始格式。

## 数据、更新与 DSH 接口

插件使用 Tavern 的公开接口处理轮次通知、正文附件、图片显示和消息动作，不需要修改 Tavern 的源码。宿主升级不会覆盖一份额外的源码补丁；如果公开接口本身发生不兼容变化，插件仍需要适配。

图片随正文版本显示，自动规划也会检查版本是否仍有效；正文改写或删除后，不会继续把旧任务的结果挂到新正文上。

主要本地数据如下，均在插件文件夹内：

| 文件或目录 | 内容 |
|---|---|
| `config.json` | 渠道、模型和插件设置（API Key 和鉴权密码存在 DSH 凭据服务里，见[凭据存储](docs/release-and-platform.md#凭据存储)） |
| `definitions.json` | 人物、服装、场景和物件资料 |
| `worldbook.json`、`worldbook-outfits.json` | 迁移前的个人规则，保留用于初始化与备份 |
| `format-worldbooks/<格式>/` | 每种格式独立的生图规则与角色／服装规则；其父目录另有迁移快照 |
| `reference-images/` | 按内容哈希保存的不可变角色／服装参考图，供当前资料及旧任务快照使用 |
| `jobs-store.json`、`plans-store.json` | 图片作业、规划记录及参考图输入快照的元数据 |
| `cache/`、`backups/` | 图片缓存与文件备份，含旧世界书迁移备份 |
| `workflows/*.json` | 自己导入的工作流 |

这些是用户运行数据，不属于发行代码。Tavern 内置安装与升级不会复制或覆盖参考图、独立世界书目录；插件源码下载白名单也不包含它们。Git 自动更新发现远端改动涉及这两个目录时会停止，Release 更新只接受静态代码白名单。不要把运行数据提交进源码仓库或混入自己制作的发行包。

参考图及历史快照文件当前不支持应用内导入导出。需要完整本机备份时，应在停用插件后保留整个实际插件数据目录，不仅是配置 JSON；分享规则可使用对应格式的世界书导出，分享工作流前也要检查内容。换电脑后仅导入文字资料无法恢复参考图文件。

提示词和生图请求会发送给所选服务；使用参考图模式时，所选图片上传到当前生图渠道。规划模型只读取文字资料与图片清单，不看这些参考图；另行使用「看图设计角色」功能时，图片才会发送给所选看图模型。后台规划（包括开启的角色历史更新）和生图服务均可能产生费用，具体额度与数据处理方式以你的服务商说明为准。

在设置页底部的「插件版本与更新」里先检查，再安装已检查到的版本。Git 安装要求官方来源、`master` 分支和无本地代码改动；提交分叉、目录冲突或远端改动涉及用户数据路径时会停止。无 Git 元数据的安装可通过官方 Release 源码包更新，下载包须通过 SHA-256、包名、版本、宿主兼容性及文件白名单检查；检查未通过时不要强制覆盖。更新后完整重启 DSH。

## 常见问题

| 情况 | 先检查什么 |
|---|---|
| 自动配图没有生成图片 | 自动规划是否开启；智能选图是否决定跳过；规划模型与生图渠道是否可用 |
| 手动生图也失败 | 查看任务错误；确认 API 地址、鉴权、模型权限，或 ComfyUI 工作流配置 |
| 参考图模式暂停、没有出图 | 当前渠道协议是否支持参考图；本张是否至少有一份可用角色或服装参考图；对象 ID 和当刻服装是否正确 |
| 平台拒绝参考图请求 | 查看实际提交图片及平台错误；核对当前模型是否接受多图、图片数量和尺寸，不会自动换模型或删图重发 |
| 更换人物库图片后，旧图重绘仍使用旧图 | 默认保留原任务快照；需要时明确选择使用最新人物库参考图 |
| 切换提示词格式后规则不同 | 各格式有独立世界书；在世界书页选择实际使用的格式后编辑 |
| 图片插在正文末尾 | 规划模型选出的挂载句是否逐字存在于正文；锚点匹配失败会回退到末尾 |
| ComfyUI 连不上 | 运行 DSH 的设备是否能访问这个地址；端口和鉴权是否正确 |
| 同一角色外貌不稳定 | 检查人物名称、触发名、卡片绑定和外貌资料；生图模型自身也会影响一致性 |
| 角色历史不可用或没有新记录 | 当前 Tavern 是否提供插件接口 v2，以及角色自动更新是否开启 |
| 在线渠道显示“已配置”，但出图失败 | 这不是成功出图结果；检查额度、模型名和中转服务的协议支持 |
| 更新按钮不可用 | 检查是否 Git 安装、是否在 master、有无代码修改或重复目录 |

只想少画几张，可以降低数量上限、开启智能选图，或改用手动生成。出图速度主要取决于模型、分辨率、显卡和远端队列，插件不会为了提速绕过服务端的执行规则。

## 卡片工作台生图

内置配图插件 3.9.0 起，卡片工作台提供 `gen_image`、`read_character`、`read_outfit`、`read_image_config`、`find_prompt` 五个工具。设置中的「启用工作台生图」独立控制这组工具；它们只在卡片模式出现。人物、服装、画风、渠道和 ComfyUI 工作流与剧情配图共用，修改后立即生效。

3.10.1 修复工作台对话图片地址与画廊混入问题。`gen_image` 返回完整 HTTP(S) 图片地址和可原样使用的 `markdown`，从宿主 Web 服务读取当次端口；没有可用地址时在提交生图前停止。图片读取支持对话跨来源嵌入，管理接口仍保留同源限制。设置 → 配图 → 画廊中，游玩画廊只显示游玩来源，卡片图片在「卡片画廊」查看；共用队列不会把两边的图片混排。任务历史仍保留所有记录，`GET /history?source=play|card` 可按来源读取；旧工作台记录继续识别，图片不删除、不重新生成。

卡片画廊删除遇到文件占用时会保留失败项供重试；批量清空只移除真正删除成功的记录，不把仍在磁盘上的图片误报为空。

`read_image_config` 返回已保存渠道、精确 ID、实际提示词格式及参考图/种子能力，不联网探测。`gen_image` 的 `channel` 可临时指定任一已保存渠道，或填 `comfyui` 使用现有本地工作流，不改变默认设置。现有 NovelAI（含聊天中转）、OpenAI、Gemini 原生及聊天兼容、Grok、Seedream、Qwen、AtlasCloud、SD WebUI/Forge、自定义协议均复用同一份渠道适配器。标签模型使用标签；自然语言模型可使用中文或英文句子；结构化模式保留分节。

参考图用 `generation_mode: reference` 和 `subjects: [{characterId, outfitId}]`，精确 ID 从查询工具取得，角色×服装成套图沿用共用引擎的优先级。多人物可传 `characters: [{prompt, centers, uc}]`，NovelAI 使用原生分角色输入，其他渠道由引擎合成。接口不支持的参考图、种子或采样器会在提交前报错；只传该渠道实际支持的参数。

工作台沿用现有任务记录、在线渠道并发限制、取消和平台任务恢复。一次生成 1–4 张，后续失败时会返回已生成图片。遇到不确定任务先到配图记录查询，不自动重复生成。卡片画廊按出图会话归属展示，保留最近 500 张并提供删除入口；它与剧情配图记录分别展示。

卡片世界书首次从 `card-worldbook.default.json` 初始化，以 `card-worldbook.json` 为准，规则索引按需生成且只在内容变化时写入。保存携带读取时的 `revision`，冲突保留草稿；跨分册编辑可一并保存。工作台规则不会注入普通剧情提示词。更新保留卡片世界书、开关、生成规则投影和用户工作流，下载源码包仅包含默认规则及静态 Skill。旧 `/dsh-tavern-gen/api` 地址继续可用，配置与人物库写入统一经过现有保存流程。

## 其他插件按需复用

3.10.0 将生图能力与完整插件入口分开。其他插件使用用户已保存的模型、人物和服装时，优先通过 Tavern 服务查询，不读取本插件的私有 JSON，也不用复制设置页。

| 需要的能力 | Tavern 接口 |
| --- | --- |
| 读取可用模型 | `listImageModels({ gameId })` |
| 只查人物 | `listImageCharacters({ gameId, query, limit })` |
| 只查服装 | `listImageOutfits({ gameId, characterId, query, limit })` |
| 按用户选择的模型出一张图 | `generateImage({ gameId, providerId, modelId, prompt, width, height, references, signal })` |

在 `ctx.inject(['tavern'], scoped => { ... })` 中取得 `scoped.tavern`；以上调用放在用户操作或工具执行中。`gameId` 是当前游玩会话 ID，卡片插件仍受自己的卡片范围约束。模型列表中的 `providerId`、`modelId` 应原样传回；选中的模型被删除时应重新选择，不能悄悄切到另一个收费渠道。目录查询只读本地资料，不探测平台、不启动出图。人物和服装目录是分页的只读投影，修改记录继续使用带版本检查的共用人物接口。

如果插件需要自己管理配置和数据，可以直接引用以下独立入口：

| 包入口 | 用途与边界 |
| --- | --- |
| `dsh-tavern-image/channels` | 渠道元数据、协议能力、配置规范化及脱敏；可在浏览器使用 |
| `dsh-tavern-image/generation` | `createImageGenerator(getConfig)`：在线渠道适配器，真正出图时才加载网络实现 |
| `dsh-tavern-image/library` | `createImageLibrary(getDefinitions)`：从调用方持有的数据生成只读人物、服装目录 |
| `dsh-tavern-image/prompts` | 提示词格式选择与组合；可在浏览器使用 |
| `dsh-tavern-image/providers` | 服务端底层协议调用、平台任务恢复及连接测试 |
| `dsh-tavern-image/client/transport` | 自定义前端复用 JSON 请求、只读重试与取消；不加载 React 和默认界面 |

例如，一个只提供在线出图能力、没有设置页和图库的服务：

~~~js
import { createImageGenerator } from 'dsh-tavern-image/generation'

export function createDrawingFeature(getConfig) {
  const images = createImageGenerator(getConfig)
  return {
    models: () => images.models(),
    draw: input => images.generate(input),
  }
}
~~~

`getConfig()` 返回调用方自己的 `imageBackend/activeImageChannel/imageChannels/maxImageBytes`，渠道可先用 `normalizeChannels` 规范化。`draw` 接受 `prompt/modelId/references/width/height/background/quality/signal`，返回 `{ data: Uint8Array, mediaType }`。出图前快照选中渠道，不修改全局默认；模型目录不读取凭据。`generation` 和 `library` 附带 TypeScript 类型定义，旧 `stageImageProvider/imageLibraryProvider` 名称继续兼容。

独立适配器不登记工具、剧情钩子、HTTP 路由、图库或后台定时器，也不替调用方管理配置、并发、图片持久化和付费任务状态。ComfyUI 的工作流、排队与恢复继续由完整插件的任务引擎管理。需要现成队列和任务记录时复用运行中的插件；自己调用底层适配器时应保留取消信号和 `requestMayHaveSucceeded`，不自动重试结果不确定的付费请求。

### 前后端维护边界

浏览器源码在 `src/client/`：`main.js` 负责宿主注册，`media.js` 负责图片与提示词编辑，`settings-fields.js/settings.js` 负责设置，`card-worldbook.js/card-gallery.js` 负责工作台。`lib/client/transport.js` 只处理请求与取消；协议和参考图能力与后端共用 `lib/image-provider-capabilities.js`。前端通过 HTTP 交换数据，不直接引用服务端配置、凭据、文件存储或任务实现。

服务端 `lib/http/routes.js` 只注册路由，模型目录与出图适配在 `lib/model-provider.js`，人物/服装投影在 `lib/library-provider.js`，剧情任务与持久化仍由 `lib/index.js` 组装。原 HTTP 地址、旧包入口和 Tavern 接口保持兼容。

修改前端后运行 `node bin/build-image-client.mjs`，提交生成的 `client.js`；`pnpm build:client` 和 `pnpm check:client` 也会构建或检查它。运行时仍只加载这一份浏览器文件，不增加模块请求；源码分片不进入运行安装包。错误源码或过期产物会在检查时失败，生成前先验证语法。

## 共用人物记录

Tavern 内置配图插件 3.8.0 支持素材库「人物 → 生图 → 配图人物库」直接编辑同一条人物记录。可新建记录或选择已有记录，编辑名字、别名、分视角外貌、当前服装，并把素材包设定图写入配图参考图。多个人物库并存时需要选择来源。

共用接口通过 `registerImageLibrary` 注册 `schemaVersion: 4` 与 `getCharacter/patchCharacter/createCharacter/putReferenceImage`。读取返回 `{version: 4, character}`。修改带上完整的 `expected` 人物快照，`traits` 按字段合并，`outfits` 按 ID 合并；未修改的字段与未列出的服装保留。允许编辑名字、别名、一致性文字、外貌、服装及参考图，不能修改人物卡绑定等插件专有字段。

关联存为 `figurePackId + figureId`，人物图存为 `referenceImage`，穿指定服装的成套图存为服装的 `characterOutfitImage`。成套图优先于角色图与独立服装图；使用本地模型或 LoRA 时仍可不上传成套图。

所有编辑、导入和重载共用保存队列，磁盘写入成功后才更新内存。人物库整页保存须原样携带 `GET /state` 返回的 `definitions.revision`；旧页面、旧脚本缺少版本或资料已改变时返回 HTTP 409 与 `REVISION_CONFLICT`，不会覆盖新内容。界面保留当前草稿，提供「重新载入最新人物库」；放弃未保存修改前会确认。外部脚本也应重新读取、由用户核对修改后再提交。素材库生图只在准备生成时读取已关联人物的正面外貌与服装文字，普通剧情和进度轮询不增加此查询。

## 兼容与许可

当前本地体验候选为 **2.9.1**（未发布）。插件清单声明的 DSH 兼容范围为 `>=0.1.0-rc.8 <0.3.0`，覆盖 DSH 0.1.5 与 0.2.x（含 DeepSeek Harness 0.2.1-rc.2 / Tavern 3.0）；角色历史另外需要 Tavern 插件接口 v2。

在 DSH 0.2.1-rc.2 + Tavern 3.0.0 上核对过：插件 bundle 正常加载（宿主加载器返回 0 个被跳过的包），本插件调用的 14 个 Tavern 接口（`attach`、`update`、`remove`、`list`、`getTurn`、`readTurnData`、`saveTurnData`、`promptSection`、`onTurnSettled`、`onGameRemoved`、`onTimelineChanged`、`getCardContext`、`backgroundModel`、`apiVersion`）在 Tavern 3.0 中全部保留，3.0 相对 2.7 的接口变化是纯新增（例如 `versionSignal`）。

新包名、浏览器模块加载键、bundle 名称和插件 ID 统一为 `dsh-tavern-image`。旧包名 `dsh-tavern-comfy` 仅用于兼容读取和迁移现有 Profile 注册。

界面与功能设计参考了 [st-chatu8](https://github.com/damoshen123/st-chatu8/tree/50f0d200caea17c448e80432f1b54d65ed8ce9cd) 和 [柏宝绘](https://github.com/baibai-git/ST-BaiBai-Image)。

采用 [MIT 许可证](LICENSE)。随包使用的图片编解码库说明见 [第三方声明](lib/vendor/NOTICE.md)。
