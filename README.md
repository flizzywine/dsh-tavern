# dsh-tavern

**基于 DeepSeek Harness（DSH）的文字游戏 Agent，支持导入 SillyTavern 人物卡。**

选一张卡自由游玩，或绑定小说、剧本和大纲，让故事沿主线推进。也可以与 Agent 对话，从素材制作新卡，修改人物设定和世界书。

[使用文档](https://flizzywine.github.io/dsh-tavern/) · [入门指南](https://flizzywine.github.io/dsh-tavern/#a02) · [宣传视频](https://www.bilibili.com/video/BV1NAeq6iELC/) · [安装与排错](https://flizzywine.github.io/dsh-tavern/#a02) · [Discord 交流](https://discord.com/channels/1134557553011998840/1538577327028445194)

![dsh-tavern：左侧会话、中间游玩、右侧人物状态](docs/images/readme/overview.png)

## 可以做什么

- **自由游玩或跟随剧本**：自由输入，也可选择独立生成的行动候选；支持添加持续指导、带意见重写和回退。误回退后，可在「更多」中点击「撤销回退」恢复最近一次回退的正文和状态；开始新生成或编辑后，恢复点会失效。
- **对话式制作人物卡**：管理人物卡、世界书、预设和剧本，导入时保留原版，讨论确认后修改工作版。
- **使用酒馆人物卡**：支持 PNG / JSON 卡、正则美化、HTML 展示、MVU 后台变量更新和已适配的小手机；第三方脚本的兼容范围取决于具体接口。
- **为剧情配图**：手动生成场景插画，支持带意见重画和查看不同版本；需单独配置生图服务。

导入人物卡即可开始，默认使用内置预设。更多功能、界面截图和公开样例见[功能指南](https://flizzywine.github.io/dsh-tavern/#index)。

## 产品特色

- **兼容酒馆生态**：支持人物卡、预设、世界书、酒馆助手、MVU、正则等，大部分酒馆助手脚本可直接使用；具体兼容情况取决于脚本所用接口。
- **无需折腾预设**：导入人物卡即可游玩，默认使用内置预设；通过人物卡或 Guide 调整文风和剧情要求。
- **正文专注讲故事**：候选项和后台状态维护分开处理，减少正文的格式负担；剧本模式可借助原文引导叙事风格，减少模板化表达。
- **速度超快**：一轮交互大约 10 秒，无需超长等待。
- **缓存命中率超高**：95% 以上的缓存命中率。
- **按需读取上下文**：只读取当前需要的资料，减少无效 Token 消耗。
- **长程记忆**：内置记忆检索工具，帮助在长程游玩中维持记忆一致性。
- **人物卡美化与 MVU**：支持正则美化和 HTML 展示，由后台 Agent 更新 MVU 变量，右侧持续展示状态栏。
- **小手机与正文并排**：在人物卡应用中打开已适配的小手机，边读剧情边查看角色聊天。
- **剧情场景插画**：按当前剧情手动生图，支持带意见重画、版本切换和大图查看；默认关闭，需单独配置生图服务。
- **多平台使用**：支持 Windows、macOS、Linux；Windows 和 macOS 可使用 Desktop，Android 可直接安装独立 APK。
- **自由扩展插件**：可自行编写、安装和组合 DSH 插件，更新时保留用户添加的插件与配置。

## 界面展示

### 自由游玩：选择行动，也可以自由输入

正文与候选项分开生成，右侧可查看持续指导和人物姿势。

![自由游玩的独立候选项、Guide 与人物姿势](docs/images/readme/free-play-candidates.png)

### 剧本游玩：沿主线推进，保留行动自由

右侧展示剧本进度与本轮参考片段，不必一次塞入整部小说。

![剧本模式的正文、剧情进度与召回片段](docs/images/readme/script-mode.png)

### 对话式改卡：边讨论，边修改人物设定

与 Agent 讨论修改内容，同时查看人物卡字段、世界书和绑定剧本。

![通过对话讨论并编辑人物卡字段](docs/images/readme/card-editor.png)

### MVU：人物状态随剧情变化

后台更新变量，右侧状态栏持续显示，正文下方可查看本轮更新结果。

![MVU 人物卡的变量更新结果与右侧酒馆状态栏](docs/images/readme/mvu-status-panel.png)

### 小手机：角色聊天与正文并排展示

![正文与右侧小手机聊天界面](docs/images/readme/phone-panel.png)

### 场景插画：让剧情有画面

插画显示在对应正文下方，点击可查看大图。

![公开灯塔案例的场景插画与完整产品界面](docs/images/readme/scene-image-product.png)

## 安装与更新

### Windows 一键安装

**[下载 Windows 安装 EXE](https://github.com/flizzywine/dsh-tavern/releases/download/v2.2/DSH-Tavern-Desktop-2.0.13-x64-Setup3.exe)**（Windows x64，修复运行目录移动时的访问拒绝）

下载后双击运行，保持联网，按提示完成安装；以后从桌面「DSH Tavern」快捷方式打开。无需另装 Node.js 或 DSH Desktop。

### Android 一键安装

**[下载 Android APK](https://github.com/flizzywine/dsh-tavern/releases/download/v2.1/dsh-tavern-android-release.apk)**（Android 11 及以上、ARM64）

安装后打开「DSH Tavern」，点击启动，首次保持联网并等待自动安装完成，再进入酒馆；无需输入命令或另装 DSHA。

### 借助 DSH Desktop（Windows / macOS）

安装 **[DSH Desktop 2.0.13](https://github.com/anywhere-labs/dsh-desktop/releases/tag/v2.0.13)**，在 **设置 → 通用设置 → 打开 DSH 终端**中运行对应命令，重启后选择 **tavern** Profile。

### 借助 DSHA（Android）

安装适配版本的 **[DSHA](https://github.com/DSH-APP/DSHA/releases)**，在 DSHA 中按指南安装并启动 Tavern。

命令、截图和详细步骤见[桌面安装指南](https://flizzywine.github.io/dsh-tavern/#a02)及 [DSHA 安装指南](https://flizzywine.github.io/dsh-tavern/#a03)。

### 命令行（Windows / macOS / Linux）

需要 **Node.js 22.19+**，无需预装 DSH。选择本机系统运行：

Windows PowerShell：

```powershell
$env:DSH_TAVERN_HOST='cli'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.ps1')); Invoke-Expression $tavernInstaller
```

macOS / Linux / WSL2：

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.sh | DSH_TAVERN_HOST=cli sh
```

安装后自动打开网页；以后用 `dsh-tavern open` 打开，`dsh-tavern update` 更新。

Pocket 手机访问仅在 Desktop 版提供，CLI 安装和升级会移除 Pocket 及其开关。详见 [Pocket 手机访问](docs/pocket-access.md)。

**上述安装方式的更新：**在酒馆中点击「更新到最新版」，完成后按提示重启。更新保留人物卡、聊天和设置，不同安装方式的数据各自独立。宿主适配 DSH **0.1.5-rc.2**，请按文档使用对应版本。

### 已有 DSH：标准插件安装（试验）

已有适配版本 DSH 的用户，可将 Tavern 安装到独立 Profile。GitHub 安装命令及版本要求见[标准插件安装指南](https://flizzywine.github.io/dsh-tavern/#plugin-installation)。

[完整安装、更新与排错指南](https://flizzywine.github.io/dsh-tavern/#a02)包含安装目录、启动入口、DSHA 安装、手机远程访问和常见故障处理。

### 手机远程访问

酒馆运行在电脑或服务器上，也可以用手机浏览器远程游玩：

- **电脑运行、手机扫码连接**：[dsh-pocket](https://github.com/shaobeichen/dsh-pocket)，Desktop 安装时自动配置，可从 **设置 → 手机访问** 选择局域网或公网访问。
- **服务器部署、账号密码登录**：[dsh-webui-auth](https://github.com/Yuuz12/dsh-webui-auth)，为远程 WebUI 添加登录认证；需自行配置可访问的服务器地址，插件不提供内网穿透。

详细配置见[安装指南中的「手机远程访问」](https://flizzywine.github.io/dsh-tavern/#a02)。

## 开始游玩

1. 在 **设置 → 模型** 中配置模型服务和 API 密钥。
2. 导入人物卡，选择人物卡开始游玩；也可以进入卡片工作台制作新卡。

[完整使用指南](https://flizzywine.github.io/dsh-tavern/)提供详细操作、截图和样例下载，文档网站本身不是在线游戏服务。

## 交流与反馈

欢迎到 [Discord 讨论频道](https://discord.com/channels/1134557553011998840/1538577327028445194)交流使用经验、分享人物卡或反馈问题。需要具备类脑社区成员资格才能进入。

反馈故障时，可从对话顶部的“日志”下载执行记录；分享前请检查其中的对话和附件隐私。

## 贡献者与致谢

感谢 [@huajiao1998（meng）](https://github.com/huajiao1998) 持续提交详细的问题报告、复现步骤、性能分析和修复建议，并协助验证改进，帮助完善长会话、后台任务和界面稳定性。

## 用户反馈

[![用户反馈：游玩五六百层后，仍能记起开局物品的来历](docs/images/readme/testimonials/long-chat-memory.jpg)](docs/images/readme/testimonials/long-chat-memory.jpg)

[![用户反馈：使用本地 27B 模型，体验非常良好](docs/images/readme/testimonials/local-27b.webp)](docs/images/readme/testimonials/local-27b.webp)

[![用户分享缓存命中率与几十轮游玩的实际花费](docs/images/readme/testimonials/cache-and-cost.webp)](docs/images/readme/testimonials/cache-and-cost.webp)

[![关于默认预设、回复速度与 Guide 剧情引导的反馈](docs/images/readme/testimonials/default-preset-and-guide.jpg)](docs/images/readme/testimonials/default-preset-and-guide.jpg)

[![关于使用体验的反馈](docs/images/readme/testimonials/ease-of-use.webp)](docs/images/readme/testimonials/ease-of-use.webp)

[![关于记忆系统的反馈](docs/images/readme/testimonials/memory-feedback.webp)](docs/images/readme/testimonials/memory-feedback.webp)

[![用户聊天反馈](docs/images/readme/testimonials/chat-feedback.webp)](docs/images/readme/testimonials/chat-feedback.webp)

[![关于文笔的反馈](docs/images/readme/testimonials/writing-feedback.webp)](docs/images/readme/testimonials/writing-feedback.webp)

[![社区用户对插件的反馈](docs/images/readme/testimonials/plugin-feedback.webp)](docs/images/readme/testimonials/plugin-feedback.webp)

[![用户反馈：会主动推进剧情，引入新角色和新事件](docs/images/readme/testimonials/proactive-story.webp)](docs/images/readme/testimonials/proactive-story.webp)

[![用户对整体使用体验的评价与稳定版适配的询问](docs/images/readme/testimonials/overall-experience.webp)](docs/images/readme/testimonials/overall-experience.webp)

[![用户反馈：缓存命中率高](docs/images/readme/testimonials/cache-hit-feedback.webp)](docs/images/readme/testimonials/cache-hit-feedback.webp)

[![用户反馈：MVU 体验不错，喜欢按要求重新生成文本的功能](docs/images/readme/testimonials/mvu-and-rewrite.webp)](docs/images/readme/testimonials/mvu-and-rewrite.webp)

[![用户反馈：回复速度快，十几秒即可收到回复](docs/images/readme/testimonials/reply-speed.webp)](docs/images/readme/testimonials/reply-speed.webp)

[![用户反馈：特别好用，游玩体验更好](docs/images/readme/testimonials/play-experience.png)](docs/images/readme/testimonials/play-experience.png)

[![用户反馈：Agent 写作的输出质量更高](docs/images/readme/testimonials/agent-writing-quality.png)](docs/images/readme/testimonials/agent-writing-quality.png)

[![用户反馈：修改角色卡像给游戏装 MOD，改卡本身也很有趣](docs/images/readme/testimonials/character-card-editing.jpg)](docs/images/readme/testimonials/character-card-editing.jpg)

[![用户反馈：世界书和角色卡调整方便，与 DSH 语音阅读插件兼容良好](docs/images/readme/testimonials/setup-and-plugin-compatibility.jpg)](docs/images/readme/testimonials/setup-and-plugin-compatibility.jpg)

[![用户反馈：AI 修改内容方便，变量更新稳定，轻前端游玩体验不错](docs/images/readme/testimonials/ai-editing-and-variable-stability.jpg)](docs/images/readme/testimonials/ai-editing-and-variable-stability.jpg)

[![用户反馈：长局 184 轮仍保持 99% 缓存命中与 272 tok/s](docs/images/readme/testimonials/long-session-cache-hit.png)](docs/images/readme/testimonials/long-session-cache-hit.png)

[![用户反馈：同样预设下比酒馆更有活人感，速度也更快](docs/images/readme/testimonials/more-alive-and-faster.jpg)](docs/images/readme/testimonials/more-alive-and-faster.jpg)
