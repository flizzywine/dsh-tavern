# dsh-tavern

**基于 DeepSeek Harness（DSH）制作的 SillyTavern 类文字游戏 Agent。**

它可以直接导入酒馆人物卡，也可以从小说、剧本和人物素材中制作新卡。选一张卡后，你既可以自由游玩，也可以绑定一份剧本，让故事沿着既定主线长期推进。

SillyTavern 采用提示词工程的思路：每轮动态拼接一个超大上下文，囊括系统规则、内容偏好、对话历史、人物卡、世界书、脚本与变量等信息，再要求模型一口气完成正文生成、历史与设定遵循、格式控制甚至代码生成等复杂任务。

这会带来两个问题：一是动态插入不断改变上下文前缀，提示词缓存难以充分复用，增加费用和等待时间；二是多个复杂目标互相争夺模型注意力，任务越多，越容易出现失忆、掉格式、人物状态矛盾和明显的 AI 味。

dsh-tavern 改用 Agent 架构。前台主 Agent 专注正文生成，后台 Agent 分步处理候选项、状态总结和世界书召回等小任务，再由程序把结果合并为完整体验。主 Agent 与后台 Agent 各自维护前缀稳定，从而提高缓存利用率、降低费用与等待时间；拆分后的每次生成只解决一个明确问题，也能显著提升输出质量。

![dsh-tavern 整体界面：左侧会话、中间游玩、右侧酒馆状态](docs/images/readme/overview.png)

## 产品功能

### 1. 游玩模式

#### 自由游玩

自由游玩不受固定剧情限制，故事会根据人物卡、世界书和当前对话自然发展。

正文与候选项分开生成。正文只负责讲好故事，候选项则提供多种人物行动和场景变化，不会混入正文。玩家可以直接选择、修改候选，也可以完全自由输入。

自由游玩还支持：

- 独立总结人物姿势，保持人物位置、动作和状态前后一致；
- 注入 Guide，为当前会话添加持续生效的剧情或写作要求；
- 输入意见，重新生成候选项；
- 输入意见，重新生成正文；
- 回退当前回合。

#### 剧本游玩

剧本模式可以为人物卡绑定小说、剧本或故事大纲，让剧本作为故事主线持续牵引剧情。

每一轮只参考当前剧情附近的剧本内容，不会一次性把整份剧本塞给模型。系统会记录当前剧情进度，并根据后续情节推荐更贴近主线的行动。

同时玩家保留偏离剧本的自由。

### 2. 卡片模式

卡片模式用于制作、理解和维护人物卡、素材与剧本。

你可以像聊天一样，让 Agent 先阅读人物卡，分析其中的问题，讨论不同修改方案。只有在你确认之后，Agent 才会把修改写入人物卡。

卡片模式支持：

- 导入和导出 SillyTavern PNG / JSON 人物卡；
- 导入、查看和编辑独立世界书或人物卡内置世界书；
- 为人物卡绑定或解绑世界书；
- 通过对话分析、讨论和修改人物卡；
- 从素材中提炼新人物卡；
- 管理人物卡使用的素材和绑定剧本；
- 查看、修改、替换素材与剧本，使其符合自己的故事构想。

人物卡负责“角色是谁”，素材负责“创作依据是什么”，剧本负责“故事往哪里走”。三者彼此独立，又可以在同一个卡片工作流程中组合使用。

### 3. 产品特色

#### 无需导入预设

直接导入人物卡，即可开始游玩

#### 多平台支持

dsh-tavern 支持 Windows、macOS、Linux 和 Android。Windows 与 macOS 可使用 DSH Desktop 客户端，也可以通过命令行运行；Linux 使用命令行运行；Android 可借助 [DSHA](https://github.com/qiannianhuanxiang/DSHA) 实验性部署，目前不保证稳定可用。

#### 速度快、消耗低

dsh-tavern 只在需要时注入必要上下文，并把不同任务拆成短而明确的调用，减少无效的 Token 消耗和等待时间。

使用 DeepSeek V4 Flash 测试时，一轮交互平均等待时间约为 15 秒。

#### 文本质量高，AI味少

dsh-tavern 使用尽可能少而精的提示词，把流程和状态交给程序管理，把文字创作留给模型。

减少不必要的格式要求、禁用词和提示词堆叠，保护并激发模型的文字创造力，剧本模式通过剧本文字引导，可以改变模型的文本输出分布，极大压制AI味。

### 界面展示

#### 自由游玩：正文与候选项分开生成

候选项独立展示人物行动与场景变化；右侧可同时查看 Guide 和人物姿势。

![自由游玩的独立候选项、Guide 与人物姿势](docs/images/readme/free-play-candidates.png)

#### 带意见重新生成正文

不满意当前正文时，可以补充指导意见后重新生成并替换。

![输入指导意见重新生成正文](docs/images/readme/rewrite-body.png)

#### 剧本游玩：围绕主线持续推进

右侧展示当前剧本进度、召回片段与人物姿势，正文仍保留玩家自由行动的空间。

![剧本模式的正文、剧情进度与召回片段](docs/images/readme/script-mode.png)

#### 卡片工作台

可以修改现有人物卡、从资料新建人物卡、修改资料，或空白开始。右侧提供“人物卡库”“世界书库”“预设库”和“资料库”：人物卡与世界书可以独立管理和绑定；预设库目前仅用于实验性阅读；素材和剧本放在资料库。

![卡片工作台与右侧资料库](docs/images/readme/card-workbench.png)

#### 对话式编辑人物卡

在中间与 Agent 讨论修改内容，同时在右侧查看并编辑人物卡字段、世界书与绑定剧本。

![通过对话讨论并编辑人物卡字段](docs/images/readme/card-editor.png)

## 安装与启动

提供桌面版和命令行版两种安装方式。两者使用同一套 Tavern Profile 和数据，请勿同时运行。

### DSH Desktop 桌面版（推荐）

适合不想单独配置运行环境和管理服务的用户。请先安装 [DSH Desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) **2.0.2 或更高版本**（支持 Windows x64 和 macOS，暂不支持 Linux）。

安装后，从系统托盘（macOS 菜单栏）打开 **Open DSH Terminal**，运行对应命令：

Windows：

```powershell
$env:DSH_TAVERN_HOST='desktop'; irm https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/install.ps1 | iex
```

macOS：

```bash
curl -fsSL https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/install.sh | DSH_TAVERN_HOST=desktop sh
```

安装完成后，重启 DSH Desktop，并从托盘的 **Profile** 菜单选择 **tavern**。Desktop 会自动管理启停和端口；更新 dsh-tavern 时，在 DSH Terminal 中重新运行上述安装命令即可。

### 命令行版

适合希望通过浏览器访问、自己管理服务的用户。需要 Node.js 22.19 或更高版本。

#### Windows

打开 PowerShell，运行：

```powershell
irm https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/install.ps1 | iex
```

#### macOS / Linux / WSL2

打开终端，运行：

```bash
curl -fsSL https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/install.sh | sh
```

安装程序会自动安装依赖、启动 dsh-tavern，并打开 <http://127.0.0.1:3081>。

首次使用时，在左侧栏底部打开 **设置 → 模型**，填写模型服务的 API 密钥。

#### 手动安装

如果一键命令无法访问 `raw.githubusercontent.com`：

1. 在 GitHub 项目页点击 **Code → Download ZIP**，或直接下载 [`main.zip`](https://github.com/flizzywine/dsh-tavern/archive/refs/heads/main.zip)；
2. 解压后进入 `dsh-tavern-main` 文件夹；
3. 在这个文件夹中打开 PowerShell（Windows）或终端（macOS / Linux），确认当前目录可以看到 `package.json`；
4. 如果尚未安装 `pnpm` 或 DSH，先运行：

```bash
npm install -g pnpm @deepseek-ai/dsh
```

5. 命令行版安装并启动：

```bash
pnpm run install:tavern
pnpm run start:tavern
```

然后打开 <http://127.0.0.1:3081>。

如果使用 DSH Desktop，请从托盘打开 **DSH Terminal**，在解压目录运行：

```bash
node ./bin/dsh-tavern.mjs install --host desktop
```

然后重启 Desktop，并切换到 **tavern** Profile。

### Android（实验性，不保证可用）

借助 [DSHA](https://github.com/qiannianhuanxiang/DSHA)，可以在 Android 手机上实验性运行本项目。首次安装只需要：

1. 安装 DSHA，配置模型并成功启动一次；
2. 打开“创造模式”，把下面一句话发给 AI：

```text
请运行这条命令安装 DSH Tavern，完成后告诉我结果：curl -fsSL https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/android/setup.sh | bash
```

3. 安装完成后重启 DSHA，点击侧栏里的 **酒馆工作台**。

以后更新直接点击酒馆左侧栏底部的 **更新到最新版**。如果酒馆打不开，可在 DSHA 的 **酒馆工作台**入口点击 **更新/修复**。

详细排错见 [Android 安装说明](docs/android-install.md)。

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

dsh-tavern 是运行在 DSH 上的插件项目，不包含 DSH 本体。DSH 本体可以按其自身方式正常更新，通常不会影响本项目的使用，除非 DSH 进行了不兼容的破坏性更新。更新 DSH 本体不需要运行 `dsh-tavern update`；这个命令只用于更新 dsh-tavern 的插件内容。Desktop 版不使用这些启停命令，由 DSH Desktop 统一管理。

用户数据统一保存在 DSH 的 Tavern Profile 数据目录中。

# 
