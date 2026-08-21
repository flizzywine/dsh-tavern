# dsh-tavern

**基于 DeepSeek Harness（DSH）制作的 SillyTavern 类文字游戏 Agent。**

它可以直接导入酒馆人物卡，也可以从小说、剧本和人物素材中制作新卡。选一张卡后，你既可以自由游玩，也可以绑定一份剧本，让故事沿着既定主线长期推进。

它复用 DSH 的会话、模型、工具和上下文能力，把人物卡游玩、候选项、设定编辑、世界书与剧本推进整合成一套完整体验。背后的产品取舍见[产品设计原则](docs/product-design.md)。

![dsh-tavern 游戏游玩界面：正文、输入区与右侧剧情状态](docs/images/demo/09-script-mode.png)

右侧工作台使用开源项目 [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 作为底座。酒馆状态会作为独立 Tab 加入工作台；工作台是否展开由用户控制，并按会话记忆，不再由 Tavern 强制展开。

## 候选项独立生成

dsh-tavern 把正文与候选项拆成独立调用：

1. 第一轮只生成故事正文；
2. 你需要灵感时，再单独点击“生成候选项”；
3. 候选项以固定结构显示在独立面板，不会写进正文；
4. 选中后只是填入输入框，你仍然可以修改，也可以完全自由行动。

正文由前台 Agent 生成；候选项和人物姿势结算由同一个持续存在的后台 Agent 负责。后台 Agent 会记住此前的剧情理解、状态结算与剧本查询，不必为两个后台工作反复从零研究；你可以从候选框或顶部子代理入口查看完整轨迹。上下文增长与压缩直接复用 DSH 原生会话机制。

### 自由游玩：四种人物行动 + 一个场景变化

没有绑定剧本时，故事只根据人物卡、世界书和当前会话自由发展。每次生成五个候选：四个人物行动，一个场景变化。

“场景变化”是特意保留的一类候选。AI 很容易停留在同一个房间、同一段对话里反复叙事，不知道什么时候该转场，时间一长就会产生明显的叙事疲劳。剧本模式可以跟着剧本切换场景；自由游玩没有现成结构，更需要主动提供换地点、换时间或进入下一阶段的可能。

![自由游玩模式生成五个候选项](docs/images/demo/00-free-candidates.png)

候选不合心意，不必接受，也不必重写正文。点击“重新生成候选项”，直接告诉 Agent 你想往哪里走：

![填写意见重新生成自由游玩候选项](docs/images/demo/00a-free-candidate-guidance.png)

它会保留已经写好的正文，只重新生成一组符合意见的候选。

![按照用户意见重新生成后的自由游玩候选项](docs/images/demo/00b-free-rerolled-candidates.png)

## 独立总结人物姿势，避免连续性错乱

正文完成后，后台 Agent 会执行一次状态结算，把人物此刻的位置、动作和姿势整理成一句状态，保存到会话并注入下一轮。它不要求前台正文顺手附带总结，因此和候选项一样，不存在掉格式或模型忘记总结的问题。

右侧状态栏会显示“姿势已同步”和最新人物姿势。重新生成正文时会重新结算，回退本轮时也会一起恢复，避免人物忽然换位置、重复动作或姿势前后矛盾。

![正文完成后独立总结并同步人物姿势](docs/images/demo/10-guide-posture.png)

## 直接导入 SillyTavern 人物卡

已有酒馆人物卡不需要重新制作。dsh-tavern 可以直接导入常见的 SillyTavern PNG / JSON 卡片，保留主要字段、备选开场和世界书；编辑完成后，也可以重新导出为兼容 JSON。

![导入 SillyTavern 人物卡并从卡片库开始游玩](docs/images/demo/01-card-import.png)

## 像聊天一样编辑人物卡

卡片模式把人物设定修改变成一段可以审查的 Agent 对话：先分析问题、比较方案，只有你明确确认后才写入字段。右侧人物卡侧栏始终同步显示当前内容，也可以直接手动编辑并保存。

![通过对话分析人物卡但不修改字段，右侧同步显示人物卡](docs/images/demo/02a-card-analysis-sidebar.png)

![通过对话比较两种修改方案，右侧同步显示人物卡](docs/images/demo/02b-card-proposals-sidebar.png)

![确认方案后写入人物卡字段，右侧实时显示修改结果](docs/images/demo/02c-card-confirmation-sidebar.png)

## 剧本模式：让故事真正沿着主线往下走

自由游玩擅长即兴，但长篇故事最容易遇到的问题，是模型逐渐忘记主线、重复场景，或者一直停留在眼前的对话里。

dsh-tavern 可以给人物卡绑定一份独立小说、剧本或故事大纲。绑定以后，新会话进入剧本模式：Agent 会根据当前剧情读取相关剧本片段，判断故事进行到哪里，并沿着后续冲突、转折和场景继续推进。

|      | 自由游玩模式          | 剧本模式            |
| ---- | --------------- | --------------- |
| 故事方向 | 根据人物卡和当前对话自由发展  | 参考绑定剧本的主线与后续情节  |
| 候选项  | 四个人物行动 + 一个场景变化 | 一个最贴合主线的推荐行动    |
| 剧情进度 | 没有固定终点          | 记录剧本游标与已读取片段    |
| 适合   | 即兴互动、日常陪伴、开放故事  | 小说改编、长篇剧情、明确故事线 |

### 人物卡与剧本独立管理

同一张人物卡可以绑定、替换或解绑剧本。人物设定留在卡里，故事路线留在剧本里，不需要把整本小说硬塞进人物卡提示词。

切换到 **卡片模式**，点击人物卡右侧的 **绑定剧本**，选择 `.txt` 或 `.md` 文件即可；绑定后用这张卡新开游玩，会自动进入剧本模式。

![在卡片模式中为人物卡绑定或替换剧本](docs/images/demo/11-script-binding.jpg)

公开案例可以直接绑定 [`the-missing-silver-bell-caravan.md`](demo/scripts/the-missing-silver-bell-caravan.md)，从银铃商队失踪开始，沿六幕悬疑主线推进。

### 看得见的剧情进度

剧本会被分段读取。右侧显示当前游标、已经召回的片段、当前参考内容和接下来的剧情，你可以直接看见故事走到哪里。

![剧本正文与右侧剧情进度、召回片段和后续预览](docs/images/demo/09-script-mode.png)

### 剧本模式只推荐一个主线行动

自由游玩给五种可能，剧本模式只给一个更有剧情意义的推荐。它会承接正文结尾，并把故事带向剧本中的下一处关键场面，而不是把主线稀释成五条互不相干的岔路。

![剧本模式只给出一个主线推荐](docs/images/demo/05-script-candidate.png)

剧本提供方向，Agent 负责动作、对白、情绪与现场细节。你仍然可以自由输入、偏离推荐、重新生成候选、重写正文或回退本轮；剧本是故事骨架，不是不可违背的选项菜单。

## 从原始素材制作人物卡

手里只有小说片段、人物设定、世界背景或故事创意，也可以直接开始。

一次选择多份素材，再告诉 Agent 谁是玩家、准备提炼谁。它会通读素材，区分人物信息与世界背景，确认人物关系，然后逐步整理出：

![同时选择人物素材与世界背景](docs/images/demo/03a-source-selection.png)

- 角色描述与性格；
- 场景设定与开场白；
- 对话示例；
- 系统提示词与持续指令；
- 标签、备选开场与世界书。

抽取过程本身也是一场 Agent 对话。你可以要求它先分析、补充遗漏、重新组织某个字段，再确认生成，不必接受一次性完成但充满误解的卡片。

![通过 Agent 对话从素材提炼人物卡，右侧同步显示素材与玩家身份](docs/images/demo/03-source-extraction.png)

仓库里的完整演示使用：

- 人物素材：[`01-avra-character.md`](demo/sources/01-avra-character.md)；
- 世界素材：[`02-blackwheat-town.md`](demo/sources/02-blackwheat-town.md)；
- 玩家身份：受雇调查银铃商队失踪事件的旅行者；
- 生成结果：[`avra-complete.json`](demo/cards/avra-complete.json)。

## 正文不满意，只重写正文

候选项可以单独重新生成，正文也一样。点击“重新生成正文”，直接写下希望保留什么、删掉什么，或者怎样调整人物反应、环境描写与对白长度。Agent 只替换当前正文，不会要求你重走前面的剧情；生成完成后还会重新结算人物姿势。

![带着具体意见重新生成并替换当前正文](docs/images/demo/08-regenerate-body-guidance.png)

## 其他功能

| 功能        | 能做什么                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------ |
| 直接导入酒馆人物卡 | 导入常见的 SillyTavern PNG / JSON 卡，保留主要字段、备选开场和世界书；可用 [`avra-before.json`](demo/cards/avra-before.json) 测试 |
| 导出人物卡     | 将编辑完成的人物卡重新导出为 JSON                                                                                    |
| 带意见重写正文   | 指定保留内容、删减方向、人物反应或对白长度，只替换当前正文                                                                          |
| 世界书       | 保存地点、组织、道具和人物关系，并按剧情关键词读取相关条目                                                                          |
| Guide     | 给当前会话添加持续写作要求，同时影响正文和候选，不污染人物卡                                                                         |
| 回退本轮      | 一起撤销最近的用户输入、正文、人物姿势和剧本进度                                                                               |
| 历史会话      | 保存、重命名并继续自由故事、剧本故事、设定对话和素材抽取                                                                           |
| 自由输入      | 候选永远只是建议，最终行动始终由玩家决定                                                                                   |

目前公开演示主要使用 **DeepSeek-V4-Flash High** 测试。

## 公开演示案例

仓库附带原创案例 **《金麦穗酒馆：失踪的银铃商队》**：

- 修改前、对话修改结果与完整世界书版三张人物卡；
- 两份用于制作人物卡的原始素材；
- 一份六幕奇幻悬疑剧本；
- 一套覆盖所有功能的产品演示脚本。

从 [`demo/README.md`](demo/README.md) 查看案例文件，或按照 [`product-demo.md`](demo/walkthrough/product-demo.md) 完整体验。

## 开始使用

### Windows（PowerShell）

需要 Node.js 22.19 或更高版本。打开 PowerShell，复制下面一行并回车：

```powershell
irm https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/install.ps1 | iex
```

脚本会自动下载最新版、补齐 pnpm，并把 DSH 升级到 `0.1.0-rc.8` 或更高版本，再安装 Tavern、启动服务并打开 <http://127.0.0.1:3081>。Windows 原生环境下，卡片模式使用 DSH rc.8 的持久 PowerShell 工具；不要求 Bash。无需 Git，也不需要手动进入项目目录。

如果提示没有 Node.js，按照自动打开的官网安装后，再重新执行上面这一行。若不希望使用原生 Windows，也可以在 WSL2 的 Ubuntu 终端中按照下面的 macOS / Linux 方法安装。

### macOS / Linux / WSL2

需要 Node.js 22.19 或更高版本。打开终端，复制下面一行并回车：

```bash
curl -fsSL https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/install.sh | sh
```

脚本会完成下载、安装和启动，不需要 Git 或 `lsof`。

### Android（第三方项目，仅作推荐）

如希望在安卓设备上运行 DSH，可以关注第三方项目 [DSHA](https://github.com/qiannianhuanxiang/DSHA)。它提供无需 Termux、无需 ROOT 的安卓 DSH 运行环境，并通过内嵌 WebView 使用 Web UI。

本项目作者没有安卓手机，尚未实际验证 dsh-tavern 能否在 DSHA 中正确安装和运行，因此这里只作推荐，不代表官方支持，也不保证兼容性。具体安装方式、设备要求和问题反馈请以 DSHA 项目说明为准。

首次打开后，点击左侧栏底部的 **设置 → 模型**，填写模型提供方的 API 密钥；之后可以在输入框下方随时切换当前对话使用的模型。

<details>
<summary><strong>国内网络失败时：手动下载与安装</strong></summary>

如果一键命令无法访问 `raw.githubusercontent.com`：

1. 在 GitHub 项目页点击 **Code → Download ZIP**，或直接下载 [`main.zip`](https://github.com/flizzywine/dsh-tavern/archive/refs/heads/main.zip)；
2. 解压后进入 `dsh-tavern-main` 文件夹；
3. 在这个文件夹中打开 PowerShell（Windows）或终端（macOS / Linux），确认当前目录可以看到 `package.json`；
4. 依次运行：

```bash
npm install -g pnpm @deepseek-ai/dsh
pnpm run install:tavern
pnpm run start:tavern
```

然后打开 <http://127.0.0.1:3081>。安装后请保留解压出的文件夹，不要随意移动；人物卡、会话、剧本和素材都保存在其中的 `data/` 目录。

如果出现 `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`，说明终端开错了目录。进入能够看到 `package.json` 的 `dsh-tavern-main` 文件夹后重新运行即可。

</details>

<details>
<summary><strong>开发者：通过 Git 安装</strong></summary>

```bash
git clone https://github.com/flizzywine/dsh-tavern.git
cd dsh-tavern
pnpm run install:tavern
```

一键安装版固定保存在用户目录的 `.dsh/apps/dsh-tavern`，重复执行安装命令会覆盖程序文件，但保留 `data/` 下的人物卡、会话、剧本、素材和设置。

</details>

<details>
<summary><strong>启动、停止与日志</strong></summary>

```bash
dsh-tavern status
dsh-tavern restart
dsh-tavern stop
dsh-tavern start
dsh-tavern update
```

在仓库目录中也可以使用以下跨平台命令：

```bash
pnpm run status:tavern
pnpm run restart:tavern
pnpm run stop:tavern
pnpm run start:tavern
```

需要查看前台输出时，可以运行：

```bash
dsh --profile tavern
```

日志位于用户目录下的 `.dsh/logs/tavern.log`。代码更新并重启后，如果页面仍显示旧界面，macOS 请使用 `Cmd + Shift + R`，Windows / Linux 请使用 `Ctrl + Shift + R` 强制刷新。

</details>

<details>
<summary><strong>本地数据与当前边界</strong></summary>

人物卡、会话、剧本和素材保存在仓库的 `data/` 下，并已被 `.gitignore` 排除。

人物卡、素材和剧本都是普通文件：可编辑工作版放在 `data/resources/cards|materials|scripts/`，不可变原版放在对应的 `data/originals/` 目录。相对路径就是资源身份，不再生成内部资源 ID。旧数据升级后会迁移为普通文件，旧 ID 结构归档到 `data/legacy-id-storage/`；用户明确点击删除整个资源时，工作版和原版会一并删除。

右侧“资源库”用于导入、重命名人物卡、素材和剧本，并把它们 `@` 到当前卡片对话；素材和剧本名称可直接用原生查看器打开工作版。“人物卡库”用于搜索、导入和管理人物卡，并在详情页编辑基本信息、绑定剧本和世界书。通用“文件”入口同时保留，三者职责分开。

新建卡片对话时提供“修改人物卡”“从素材新建人物卡”“空白开始”三个入口。它们使用完全相同的卡片 Agent、工具和系统提示词；前两个入口只会额外把对应任务提示词放入输入草稿，不会自动发送，也不会形成不同模式。剧本绑定是人物卡详情页中的纯手动操作，不启动 Agent 对话。

- 备选开场白可以导入、编辑和导出，但新会话目前固定使用主开场白；
- 世界书高级属性会保留，目前界面主要编辑触发词和内容；
- dsh-tavern 依赖 DSH 的模型配置和运行环境。

</details>

## 项目文档

- [文档索引](docs/README.md)
- [产品设计原则](docs/product-design.md)
- [架构与领域语言](docs/architecture.md)

---
