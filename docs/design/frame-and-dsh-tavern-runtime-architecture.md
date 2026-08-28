# Frame 与 dsh-tavern Runtime 架构

> 状态：目标架构与当前实现映射。本文定义长期模块关系，不把尚未落地的接口写成完成状态。

## 一句话结论

dsh-tavern 不应成为另一个“每轮重建完整提示词”的 SillyTavern。它应当把酒馆资源解释为本轮需要交给 Agent 的输入，构造 `ForegroundFrame` 或 `BackgroundTaskFrame`，追加到持续存在的 DSH Session；后续思考、工具调用、压缩和模型请求仍由 DSH 管理。

```text
酒馆生态资源
    ↓
Tavern Compatibility Runtime
    ↓ 兼容语义与任务意图
dsh-tavern Runtime
    ├── FrameBuilder
    ├── Turn Orchestrator
    ├── Background Dispatcher
    ├── Story Timeline
    └── Turn Composer / Presentation Runtime
    ↓
DSH Runtime
    ├── 前台 Agent Session
    └── 常驻后台 Agent Session
```

## 两条根本差异

### 上下文生命周期不同

SillyTavern 把聊天记录当作每次请求的素材。每轮都重新读取人物卡、预设、世界书和历史消息，按注入位置组装完整模型请求。

```text
每一轮：资源 + 全部历史 → 重新编译完整 Context → 模型
```

dsh-tavern 的原生运行模型是持续 Session。宿主只为新一轮构造输入 Frame 并追加；已经发生的对话、工具调用和模型轨迹由 DSH Session 保存、投影和压缩。

```text
持续 Session + 本轮 Frame → Agent 自主完成本轮轨迹
```

Frame 不是完整 Context，也不是一次模型请求。它只是一次 Agent 工作的初始化上下文包。

### Agent 拓扑不同

酒馆人物卡通常围绕一个前台模型设计：正文、状态、格式标签和 UI 数据可能在同一次输出中完成。额外模型是插件追加的能力，不是统一的一等后台 Session。

dsh-tavern 则明确区分：

- **前台 Agent**：生成用户阅读的故事正文；
- **后台 Agent**：执行变量更新、状态结算、候选生成等语义任务；
- **Harness**：校验、提交、回退、组合和渲染结果。

两项差异合起来，可以概括为：

```text
SillyTavern = 全量请求编译器 + 单 Agent 输出协议
dsh-tavern  = 增量 Frame 编译器 + 前后台 Agent Runtime
```

## 三层 Runtime

### Tavern Compatibility Runtime

兼容 Runtime 负责理解酒馆生态，不负责管理 DSH Session。它解释：

- 人物卡、开场白和示例对话；
- 预设、Prompt Order、宏和 EJS；
- 世界书选择、排序和注入语义；
- 发送正则、输出正则和显示正则；
- MVU 初始化、变量补丁、消息与 Swipe 状态；
- Tavern Helper 的脚本、事件和额外模型请求；
- HTML、状态栏、CG 和其他展示资源。

它的产物不是“永远重新拼接好的完整 Context”，而应优先是可供宿主消费的兼容语义：本轮需要挂载什么、何时触发什么任务、输出后如何结算、界面如何投影。

### dsh-tavern Runtime

dsh-tavern Runtime 是酒馆语义与 DSH Harness 之间的适配器，也是整个文字游戏的领域 Runtime。它负责：

- 接收玩家输入和兼容 Runtime 产生的意图；
- 构造前台与后台 Frame；
- 把 Frame 追加到正确的 Agent Session；
- 维护对话、分支、revision、checkpoint 和后台 operation；
- 拒绝迟到、重复或属于旧分支的后台结果；
- 结算 MVU、正则、Helper 事件和消息状态；
- 组合正文、结构化状态和 UI attachment；
- 将确定性的显示结果交给浏览器渲染。

`DSH Adapter` 不需要成为独立的顶层 Runtime。它可以作为 dsh-tavern Runtime 内部的适配器存在，把领域 Frame 和 operation 映射到 DSH 生命周期、Session、工具与模型调用。物理上合并，逻辑 seam 仍然保留。

### DSH Runtime

DSH 负责通用 Agent Harness：

- Session 与追加式事件轨迹；
- 多轮模型调用与工具调用；
- 模型选择、流式、重试和取消；
- 上下文 Surface、压缩和恢复；
- Agent 创建、恢复、空闲等待与持久化。

DSH 不需要理解人物卡、世界书、MVU 或正则。dsh-tavern 把这些领域语义投影成 Agent 可以消费的 Frame，剩余执行交给 DSH。

## Frame 模型

架构上使用一个公共抽象和两种专用 Frame：

```text
AgentInputFrame
├── ForegroundFrame
└── BackgroundTaskFrame
```

公共部分用于关联权威剧情，而不是堆放所有业务字段：

```text
AgentInputFrame {
  frameId
  chatId
  branchId
  basedOnRevision
  source
}
```

其中 `source` 只用于诊断、追踪和重放，例如人物卡版本、世界书 revision、MVU 消息楼层和预设快照。它不应成为 Agent 必须理解的提示词正文。

### ForegroundFrame

`ForegroundFrame` 表示玩家开始新一轮，只追加到前台 Session：

```text
ForegroundFrame {
  ...AgentInputFrame
  kind: "foreground"
  userInput
  cardContext
  activeWorldbook
  currentStateProjection
  scriptReference
  guide
  writingRules
}
```

它回答的是：**前台 Agent 这一轮需要知道什么，才能把故事演好？**

一轮通常只有一个 `ForegroundFrame`。它不包含随后发生的模型思考、工具调用、工具结果和最终回复；这些属于 DSH Session 的本轮轨迹。

### BackgroundTaskFrame

`BackgroundTaskFrame` 表示系统需要完成一项后台语义任务，只追加到后台 Session：

```text
BackgroundTaskFrame {
  ...AgentInputFrame
  kind: "background-task"
  taskType
  trigger
  foregroundOutput
  authoritativeState
  taskRules
  outputContract
}
```

它回答的是：**后台 Agent 基于哪一轮事实，需要完成哪项任务，并按什么契约返回？**

一轮可以产生零个或多个后台 Frame，例如：

```text
ForegroundFrame
  → 前台正文
  → BackgroundTaskFrame(MVU 额外模型解析)
  → BackgroundTaskFrame(状态结算)
  → BackgroundTaskFrame(候选生成)
```

后台任务可以重试或延迟完成，但必须绑定触发它的 `{branchId, basedOnRevision}`。Harness 只有在依据仍然有效时才允许提交结果。

## FrameBuilder 是核心深模块

`FrameBuilder` 是 dsh-tavern 最关键的输入 seam。调用方只告诉它本轮发生了什么；人物卡、世界书、状态、剧本、Guide、预设和兼容资源如何选择、去重和投影，都隐藏在实现内部。

它至少提供两个逻辑能力：

```text
buildForegroundFrame(turnInput) → ForegroundFrame
buildBackgroundTaskFrame(taskInput) → BackgroundTaskFrame
```

这里描述的是模块接口，不要求最终代码必须使用这两个函数名。判断模块是否足够深的标准是：删除 `FrameBuilder` 后，复杂的资源选择、生命周期和投影规则会不会重新散落到多个调用方。

FrameBuilder 不负责：

- 保存或压缩 Agent 历史；
- 执行模型与工具循环；
- 提交权威状态；
- 渲染 HTML；
- 为精确兼容模式伪造整个 DSH Session。

## 一轮原生游玩的运行链路

```text
1. 用户提交输入
2. Turn Orchestrator 在 Story Timeline 建立正文 operation
3. FrameBuilder 构造 ForegroundFrame
4. dsh-tavern Runtime 把 Frame append 到前台 DSH Session
5. 前台 Agent 自主进行模型调用、思考和工具调用
6. 前台最终正文完成
7. Turn Composer 取得原始输出并执行确定性输出投影
8. Runtime 根据卡片能力触发零个或多个 BackgroundTaskFrame
9. 常驻后台 Agent 依次完成后台任务
10. Harness 校验结果并提交新的剧情 revision、变量和候选项
11. Presentation Runtime 根据权威状态渲染 UI
```

“一轮输入”与“一次模型调用”不是同一个概念。一个 Frame 可以在 DSH 内触发多次模型调用和工具调用，Frame 不需要也不应该记录这些后续步骤。

## 兼容模式的两条路径

### Frame 兼容路径

能够自然拆分的酒馆资源先由兼容 Runtime 解释，再进入 Frame：

```text
酒馆资源
  → 兼容语义
  → ForegroundFrame / BackgroundTaskFrame
  → DSH Session
```

MVU 的“额外模型解析”是最清晰的后台 seam。dsh-tavern 可以拦截这次模型调用，将原提示词、正文、变量和输出要求包装成 `BackgroundTaskFrame`，交给常驻后台 Agent；MVU 仍负责原有补丁解析、变量提交和事件语义。

### 精确请求兼容路径

部分旧卡依赖 SillyTavern 的完整 Prompt Order、历史重排、注入深度和单 Agent 输出协议。为了验证或运行这类资源，可以保留隔离的精确兼容路径：

```text
固定酒馆资源 + 历史
  → 按 SillyTavern 语义重建完整请求
  → 临时投影到本次 provider request
```

这条路径是兼容出口，不是 dsh-tavern 的内部会话模型。完整酒馆请求不得写成前台 Session 的新权威历史，也不能迫使普通游玩放弃追加式 Frame 架构。

### 纯正则卡

纯正则卡通常要求同一个前台模型同时输出正文、状态块和 UI 标记，没有天然后台调用 seam。未经迁移时继续走单 Agent 兼容协议。未来若要拆分，需要“改卡 Skill”离线生成前台契约、后台契约、状态 Schema 和 UI Adapter，不能在运行时仅凭正则猜测。

## 前后台结果如何组合

后台 Agent 不直接操作浏览器，也不应默认生成整段 HTML。推荐结果模型是：

```text
前台 Agent → bodyText
后台 Agent → stateActions / variables / candidates / viewData
Harness     → 校验并提交权威状态
Turn Composer → Message + UI attachments
前端 UI Adapter → HTML
```

正文可以先显示，后台结果完成后更新状态栏；需要原子体验的卡也可以等待指定后台任务完成后统一提交。无论采用哪种策略，UI 都是权威状态的投影，不能反向成为剧情事实来源。

## 权威状态与 Session 的关系

Story Timeline 保存正文、变量、候选、分支和 revision，是游戏事实的权威来源。前后台 DSH Session 是持续的执行轨迹与模型 Surface，不是唯一数据库。

```text
Story Timeline：什么已经成为事实
DSH Session：Agent 看到了什么、做过什么
Frame：这次新增什么工作上下文
```

回退或 Swipe 时，Runtime 先恢复权威 checkpoint，再把对应 Agent Surface 投影到一致位置。迟到的后台结果因 `branchId/revision` 不匹配而被拒绝。

## 当前实现映射

| 架构概念 | 当前实现 | 状态 |
| --- | --- | --- |
| 前台持续 Session | DSH 宿主 Session | 已有 |
| 前台 Frame 雏形 | `Turn Orchestrator.prepare` 与 `agent/pre-step` 注入的本轮快照 | 已有行为，尚未形成正式结构化类型 |
| 后台持续 Session | `Background Agent Runner` | 已有；同一聊天的候选与状态结算共用 |
| 后台 Frame 雏形 | `backgroundPrompt` 组合权威状态、最近剧情和任务协议 | 已有文本协议，尚未形成正式结构化类型 |
| Story Timeline | `Story Timeline`、checkpoint、operation、participant | 已有 |
| 精确酒馆请求路径 | `compileCompatibilityTurn` 与临时 provider request 投影 | 已有，属于隔离兼容模式 |
| MVU 前台结算 | `Tavern MVU Runtime.settleResponse` | 已有；当前解析前台输出中的 MVU 协议 |
| MVU 额外模型后台路由 | 额外模型调用 → `BackgroundTaskFrame` | TODO |
| 前后台 Frame 类型与统一 FrameBuilder | 正式领域模型和接口 | TODO |
| 后台固定工具集 | 常驻工具超集 | TODO；当前仍按任务安装和卸载部分工具 |
| Turn Composer / UI attachment | 正文投影、HTML 与状态展示已有多条实现 | 部分已有，尚未收敛成统一提交协议 |

## 不变量

1. 普通游玩每轮 append Frame，不重建完整 Session。
2. Frame 只初始化一次 Agent 工作，不包含后续工具轨迹。
3. 前台 Frame 只进入前台 Session，后台 Frame 只进入后台 Session。
4. 一轮最多一个前台 Frame，可以有多个后台 Frame。
5. 后台结果必须绑定来源正文的 branch 和 revision。
6. Agent 只能提出结果，Harness 才能提交权威事实。
7. HTML 是 Presentation 投影，不是后台 Agent 的权威状态。
8. 精确酒馆请求重建只能存在于隔离兼容路径。
9. 兼容 Runtime 解释酒馆语义，DSH Runtime 管理 Agent 执行；两者不能互相泄漏内部模型。
10. 新增兼容能力不能破坏 DSH 的追加式 Session、多轮工具调用和压缩能力。

## 后续收敛顺序

1. 从现有文本注入中提炼正式的 `ForegroundFrame` 领域模型。
2. 将后台任务输入收敛为统一 `BackgroundTaskFrame`。
3. 建立 FrameBuilder seam，并让普通游玩统一通过它进入 Session。
4. 把 MVU 额外模型调用默认路由到常驻后台 Agent。
5. 收敛 Turn Composer，使正文、状态、候选和 UI attachment 具有统一提交协议。
6. 保留精确兼容模式作为差分基线和旧卡逃生通道，不让它反向主导原生架构。

## 相关文档

- [酒馆指令到 DSH Frame 改造方案](foreground-frame-migration-plan.md)
- [LLM-Harness 架构](llm-harness-architecture.md)
- [酒馆单 Agent 协议与 DSH 前后台 Agent 架构](tavern-single-agent-vs-dsh-dual-agent.md)
- [酒馆超集兼容运行时方案](tavern-superset-compatibility-runtime.md)
- [跨 Agent 剧情时间线设计](agent-timeline.md)
- [酒馆能力在 LLM Harness 中的重新安置](tavern-capabilities-in-llm-harness.md)
