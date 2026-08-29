# 编排策略与酒馆脚本运行模块架构

> 状态：目标架构与当前实现映射。本文定义长期模块关系，不把尚未落地的接口写成完成状态。

## 一句话结论

dsh-tavern 同时提供普通游玩编排策略和兼容编排策略。两种策略共享原生资源仓库与酒馆脚本运行模块，但对上下文和 Agent 的组织方式不同。

```text
人物卡 / 世界书 / 预设 / 脚本
                  ↓
             编排策略
       ┌──────────┴──────────┐
       ↓                     ↓
普通游玩编排策略        兼容编排策略
       │                     │
       ├── 原生 modules      ├── 完整酒馆请求编译
       └──────────┬──────────┘
                  ↓ 按需调用
           酒馆脚本运行模块
                  ↓ Host seam
          Host Adapter（桥接层）
                  ↓
      dsh-tavern 权威状态 / DSH Runtime
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

## 运行角色

### 普通游玩编排策略

普通游玩编排策略以持续 DSH Session 和增量 Frame 为核心。它直接调用 dsh-tavern 原生 modules：

- 人物卡 module；
- Worldbook module；
- Macro Engine；
- Regex Engine；
- FrameBuilder、Story Timeline 与后台任务；
- Turn Composer 与 Presentation Runtime。

人物卡需要 MVU、Tavern Helper 或 EJS 时，这个策略按生命周期调用酒馆脚本运行模块；它不因此改用完整酒馆请求编译。

### 兼容编排策略

兼容编排策略按 SillyTavern 可观察语义重建完整请求，负责 Prompt Order、历史重排、精确注入位置和单 Agent 输出协议。它与普通游玩共享资源仓库和酒馆脚本运行模块，但不共享 Frame 编排。

### 酒馆脚本运行模块

酒馆脚本运行模块承接需要直接运行的酒馆程序：

- Tavern Helper 和人物卡 JavaScript；
- MVU 初始化、补丁解析、守卫和事件；
- ST Prompt Template / EJS；
- 脚本按钮、状态栏和卡片 UI 生命周期。

宏、世界书、正则和人物卡读取若已有原生实现，不因追求兼容性而强制经过脚本运行模块。

### Host Adapter（桥接层）

Host Adapter 由 dsh-tavern 拥有，只向酒馆脚本运行模块呈现酒馆形状的宿主能力。酒馆脚本运行模块不认识 dsh-tavern；脚本对消息、变量、世界书、模型调用和展示的操作，由 Adapter 映射到 dsh-tavern 的权威状态、执行轨迹和 Projection。原生 modules 不绕行 Host Adapter。

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
4. 普通游玩编排策略把 Frame append 到前台 DSH Session
5. 前台 Agent 自主进行模型调用、思考和工具调用
6. 前台最终正文完成
7. Turn Composer 取得原始输出并执行确定性输出投影
8. Runtime 根据卡片能力触发零个或多个 BackgroundTaskFrame
9. 常驻后台 Agent 依次完成后台任务
10. Harness 校验结果并提交新的剧情 revision、变量和候选项
11. Presentation Runtime 根据权威状态渲染 UI
```

“一轮输入”与“一次模型调用”不是同一个概念。一个 Frame 可以在 DSH 内触发多次模型调用和工具调用，Frame 不需要也不应该记录这些后续步骤。

## 两种编排策略

### 普通游玩编排策略

普通游玩调用原生 modules 解释人物卡、世界书、宏和正则，再写入 Frame；只有卡片携带 MVU、Tavern Helper 或 EJS 时才调用酒馆脚本运行模块：

```text
酒馆资源
  → dsh-tavern 原生 modules
  → ForegroundFrame / BackgroundTaskFrame
  → DSH Session

卡片脚本
  → 酒馆脚本运行模块
  → Host Adapter
  → dsh-tavern 权威状态
```

MVU 的“额外模型解析”是最清晰的后台 seam。dsh-tavern 可以拦截这次模型调用，将原提示词、正文、变量和输出要求包装成 `BackgroundTaskFrame`，交给常驻后台 Agent；MVU 仍负责原有补丁解析、变量提交和事件语义。

### 兼容编排策略

部分旧卡依赖 SillyTavern 的完整 Prompt Order、历史重排、注入深度和单 Agent 输出协议。为了验证或运行这类资源，可以保留隔离的精确兼容路径：

```text
固定酒馆资源 + 历史
  → 按 SillyTavern 语义重建完整请求
  → 按需调用酒馆脚本运行模块
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
| 普通游玩编排策略 | `ForegroundFrameBuilder`、`Turn Orchestrator` 与持续 DSH Session | 已有主要链路 |
| 兼容编排策略 | `compileCompatibilityTurn` 与临时 provider request 投影 | 已有主要链路，仍散落在 `index.js` |
| 酒馆脚本运行模块 | MVU、Prompt Template、Helper 与 iframe 相关 modules | 已有能力，尚未收敛为独立 module |
| Host Adapter（桥接层） | Helper 消息、变量、世界书、模型和展示投影 | 已有子集，尚未形成独立 seam |
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
8. 精确酒馆请求重建只属于兼容编排策略。
9. 酒馆脚本运行模块只认识酒馆宿主；DSH 与 dsh-tavern 内部模型只能出现在 Host Adapter 之后。
10. 两种编排策略都可以按需调用酒馆脚本运行模块。
11. 新增脚本能力不能破坏 DSH 的追加式 Session、多轮工具调用和压缩能力。

## 后续收敛顺序

1. 明确普通游玩和兼容模式是两种编排策略，不再建立顶层“兼容层”。
2. 将 MVU、Tavern Helper、EJS 与卡片 JavaScript 收敛为酒馆脚本运行模块。
3. 建立酒馆脚本运行模块与 dsh-tavern 之间的 Host Adapter seam。
4. 将精确兼容回合从 `index.js` 收进兼容编排策略。
5. 保持普通游玩的 ForegroundFrame 路径独立，并按需调用酒馆脚本运行模块。

## 相关文档

- [酒馆指令到 DSH Frame 改造方案](foreground-frame-migration-plan.md)
- [LLM-Harness 架构](llm-harness-architecture.md)
- [酒馆单 Agent 协议与 DSH 前后台 Agent 架构](tavern-single-agent-vs-dsh-dual-agent.md)
- [历史方案：酒馆超集兼容层](tavern-superset-compatibility-layer.md)
- [跨 Agent 剧情时间线设计](agent-timeline.md)
- [酒馆能力在 LLM Harness 中的重新安置](tavern-capabilities-in-llm-harness.md)
