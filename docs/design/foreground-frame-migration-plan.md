# 酒馆指令到 DSH Frame 改造方案

> 状态：前台 Frame 代码链路已落地，真实游玩与兼容请求 hash 验收待运行环境复核。架构同时定义 `ForegroundFrame` 与 `BackgroundTaskFrame`；后台 Frame 暂不实现。

## 决策

dsh-tavern 保留两条明确隔离的运行路径：

| 模式 | 上下文架构 | 约束 |
| --- | --- | --- |
| 兼容模式 | 每轮按 SillyTavern 语义重建完整请求 | 继续作为旧卡逃生通道和差分基线 |
| 游玩模式 | 持续 DSH Session + 每轮追加一个 `ForegroundFrame` | 不得调用完整酒馆请求编译器 |

兼容模式继续使用 `compileCompatibilityTurn()` 和临时 provider request 投影，不做改造。游玩模式由 Tavern Compatibility Runtime 识别酒馆指令，再由 dsh-tavern Runtime 直接将指令翻译为前台 Frame、后台 Frame、确定性行动、展示行动或明确忽略。历史、工具轨迹、压缩和后续模型调用仍由 DSH 管理。

本方案的核心是“酒馆指令 → dsh-tavern 行动”翻译表。酒馆指令直接进入 dsh-tavern Runtime 的指令分派 seam，不经过额外的中间编排对象。

酒馆指令的来源范围、原生语义、翻译目标和当前支持状态，以 [酒馆指令清单与 dsh-tavern Runtime 翻译计划](../research/tavern-instruction-inventory.md) 为盘点基线。本文只保留改造里程碑所需的摘要，不再凭抽象名称猜测指令范围。

## 目标设计范围

完整架构包括：

- 公共 `AgentInputFrame`；
- 前台 `ForegroundFrame`；
- 后台 `BackgroundTaskFrame`；
- 酒馆指令到 dsh-tavern 行动的统一分派；
- Harness 状态提交与 Presentation 投影；
- 无法或不值得迁移的指令采用显式忽略策略。

## 当前实施范围

包含：

- 定义正式的 `ForegroundFrame`；
- 定义公共 `AgentInputFrame` 和未来 `BackgroundTaskFrame` 的接口与不变量；
- 定义完整的酒馆指令分派表；
- 建立唯一的 `ForegroundFrameBuilder` seam；
- 把人物卡、当前世界书、当前状态、剧本引用、Guide 和游玩写作规则收进本轮 Frame；
- 把输入宏和发送正则作为 Frame 构建过程的一部分，只执行一次；
- 将 Frame 只追加到前台 DSH Session；
- 移除游玩模式在 provider request 阶段对完整消息数组的二次重排。

不包含：

- `BackgroundTaskFrame` 的代码实现与 Session 接入；
- MVU 额外模型后台路由；
- 候选生成、状态结算和后台 Agent 改造；
- 改写兼容模式的 Prompt Order、世界书或完整请求编译器；
- 将旧酒馆卡自动转换成前后台双 Agent 卡。

现有后台流程保持原样。后台 Frame 已进入目标设计，但不纳入当前开发里程碑和验收范围。

## 已落地的前台边界

游玩模式已经形成以下稳定边界：

1. Context Planner 保留带 kind、required 和 text 的结构化 section，不再只暴露拼接文本。
2. Turn Orchestrator 把 section 翻译为统一酒馆指令，并生成带 branch/revision/source 的 `ForegroundFrame`。
3. `agent/pre-step` 只在 `step=1` 通过 Session Adapter 追加 Frame；重试复用同一 operation 已持久化的 Frame。
4. 游玩模式不再在 `llm/stream` 阶段投影完整前台预设或重排 provider request。
5. 兼容模式仍独立使用完整酒馆编译和临时 provider request 替换。

## 目标链路

```text
人物卡、预设、世界书、MVU、正则、Helper
  ↓
Tavern Compatibility Runtime 识别酒馆指令
  ↓
dsh-tavern Runtime 逐条分派
  ├── 前台上下文贡献 → ForegroundFrameBuilder
  ├── 后台语义任务   → BackgroundTaskFrameBuilder（后续实现）
  ├── 确定性行动     → Harness
  ├── 显示行动       → Presentation Runtime
  └── 不适配的语义   → ignored + diagnostics
```

前台链路：

```text
玩家输入
  ↓
Turn Orchestrator 建立本轮 operation
  ↓
dsh-tavern Runtime 接收本轮酒馆指令
  ↓
ForegroundFrameBuilder.build(...)
  ├── 投影本轮玩家输入
  ├── 接收人物卡、世界书、状态、剧本、Guide 和写作规则贡献
  └── 记录资源 revision/hash
  ↓
ForegroundFrameSessionAdapter.append(frame)
  ↓ 只执行一次
持续存在的前台 DSH Session
  ↓
DSH 自主管理模型调用、工具轨迹、压缩与恢复
```

第二次及后续 Agent step 不再重新构建或追加 Frame，也不重新投影人物卡、世界书和预设。它们只使用 DSH Session 已经拥有的本轮轨迹继续工作。

## Frame 模型

```text
AgentInputFrame
├── ForegroundFrame
└── BackgroundTaskFrame
```

公共字段只关联权威剧情和来源：

```text
AgentInputFrame {
  frameId
  chatId
  branchId
  basedOnRevision
  source
}
```

### ForegroundFrame

```text
ForegroundFrame {
  frameId
  kind: "foreground"
  chatId
  branchId
  basedOnRevision
  turn

  userInput {
    sourceText
    projectedText
  }

  context {
    cardContext
    activeWorldbook
    currentStateProjection
    scriptReference
    guide
    writingRules
  }

  source {
    card { path, name, revision }
    worldBook { branchId, revision, refs }
    state { branchId, revision }
    preset { id, digest }
  }
}
```

Frame 不包含：

- 完整聊天历史；
- DSH system prompt；
- 旧轮工具调用与结果；
- 本轮随后产生的思考、模型调用和回复；
- 为复刻 Prompt Order 而生成的完整 `messages[]`。

`source` 用于诊断、重放和幂等判断，不是要求 Agent 阅读的提示词正文。

### BackgroundTaskFrame

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

后台 Frame 用于 MVU 额外模型解析、状态结算和候选生成等任务。它只能进入后台 Session，必须绑定产生它的 branch/revision，迟到结果由 Harness 拒绝。

当前里程碑只冻结这个接口和路由位置，不实现 Builder、Adapter、模型调用或结果提交。

## 核心深模块

### TavernInstructionDispatcher

它属于 dsh-tavern Runtime。Tavern Compatibility Runtime 给出酒馆指令后，由 Dispatcher 直接决定：

```text
applyInstruction(turnContext, instruction)
```

指令会被翻译为前台 Frame 贡献、未来后台 Frame 任务、Harness 行动、Presentation 行动或显式忽略。Dispatcher 隐藏酒馆术语与 DSH 领域行动之间的映射；调用方不维护另一份翻译表。

这不是新的 Compatibility Plan。它是 dsh-tavern Runtime 内部执行酒馆指令的深模块。

### ForegroundFrameBuilder

唯一外部接口：

```text
buildForegroundFrame({ sessionId, turn, userInput }) → ForegroundFrame
```

它接收 Dispatcher 已翻译出的前台贡献，在内部完成选择、去重、状态投影和来源记录。酒馆字段的识别属于 Tavern Compatibility Runtime，酒馆指令到领域行动的翻译属于 Dispatcher，FrameBuilder 不直接理解 `prompt_order`、注入深度等酒馆实现细节。

删除这个模块时，上述复杂度会重新散落到 `agent/pre-step`、Turn Orchestrator 和多个资源模块，因此它是一个有实际深度的模块，而不是转发层。

### ForegroundFrameSessionAdapter

逻辑接口：

```text
appendForegroundFrame(session, frame) → AppendReceipt
```

迁移期使用当前 `agent/pre-step` 注入机制作为 Adapter；测试使用内存 Adapter。若 DSH 后续提供正式的外部 Session Frame 事件，再替换生产 Adapter，不改变 FrameBuilder。

Adapter 必须保证：

- 只接受 `requestMode=dsh`；
- 只在 `step=1` 追加；
- 同一 `frameId` 重试时幂等；
- 不替换 DSH 已有的完整 `messages[]`；
- 不修改 DSH system、tools 或历史轨迹。

## 酒馆指令如何分派

| 酒馆指令 | dsh-tavern Runtime 的翻译 | 当前里程碑 |
| --- | --- | --- |
| 人物卡描述、性格、场景 | 写入 `ForegroundFrame.cardContext` | 实现 |
| 玩家输入宏、发送正则 | 转换 `ForegroundFrame.userInput.projectedText` | 实现 |
| 激活世界书条目 | 写入 `ForegroundFrame.activeWorldbook` | 实现 |
| 世界书插入历史指定深度 | 不复刻深度；改为本轮前台上下文，无法翻译时忽略并诊断 | 实现降级语义 |
| MVU 当前变量 | 写入 `ForegroundFrame.currentStateProjection` | 实现 |
| 剧本进度 | 写入 `ForegroundFrame.scriptReference` | 实现 |
| Guide | 写入 `ForegroundFrame.guide` | 实现 |
| 原生游玩预设和写作约束 | 写入 `ForegroundFrame.writingRules` | 实现 |
| 完整 Prompt Order、历史重排 | 游玩模式忽略并诊断；兼容模式忠实执行 | 实现隔离 |
| MVU 额外模型解析 | 创建 `BackgroundTaskFrame` | 仅设计 |
| 状态结算、候选生成 | 创建对应 `BackgroundTaskFrame` | 仅设计 |
| MVU 前台更新 | 回复完成后交给 Harness 结算 | 保持现状 |
| 输出正则 | 回复完成后执行消息或显示投影 | 保持现状 |
| HTML、状态栏、CG | 交给 Presentation Runtime | 保持现状 |
| 未知或不支持的酒馆指令 | `ignored`，记录指令类型、来源和原因 | 实现 |

这里的“预设进入 Frame”不是复制完整酒馆预设。游玩模式只提取 Agent 本轮需要遵守的写作和任务规则；无法可靠翻译的精确位置语义可以忽略，要求忠实执行时改走兼容模式。

## 当前实现的迁移落点

| 当前实现 | 改造方向 |
| --- | --- |
| `Turn Orchestrator.prepare()` | 保留 operation、输入投影和权威状态准备；资源组合迁入 FrameBuilder |
| `foregroundHandoff.prepare()` | 保留现有前台进入条件；取得 Frame 后交给 Session Adapter |
| `planner.plan({ purpose: "body" })` | 变成 FrameBuilder 内部的文本投影实现，不再是跨模块返回的隐式 Frame |
| `agent/pre-step` 手写 snapshot 消息 | 改为调用 Session Adapter；只处理 `step=1` |
| `runtimePresetPhaseMessages(..., "middle")` | 翻译为 `writingRules`，随 Frame 一次性进入 Session |
| `projectRuntimePresetRequest()` | 从游玩模式移除；兼容模式不使用它且保持不变 |
| `compileCompatibilityTurn()` | 只允许兼容模式调用，增加隔离测试 |
| `createEphemeralCompatibilityRequest()` | 只允许兼容模式替换 provider request |

## 分阶段实施

### 阶段 0：冻结两条路径（代码护栏已完成，真实请求 hash 待复核）

- 保存一个真实兼容请求的角色、顺序和内容 hash，防止改造破坏兼容模式；
- 增加游玩模式护栏测试，证明其不会调用 `compileCompatibilityTurn()` 或 `createEphemeralCompatibilityRequest()`；
- 增加多 step 测试，证明当前问题可被测试捕获。

### 阶段 1：引入领域模型（已完成）

- 定义 `AgentInputFrame`、`ForegroundFrame` 与 `BackgroundTaskFrame`；
- 新建 TavernInstructionDispatcher 和前台 FrameBuilder；
- 前台 FrameBuilder 以当前 `prepared.text` 为初始文本投影，先保持运行结果不变；
- 为 `frameId`、branch/revision 和资源来源建立稳定规则；
- 测试只通过 FrameBuilder 的公开接口验证行为。

### 阶段 2：接入 DSH 游玩链路（已完成）

- `requestMode=dsh && step=1` 时构建并追加 Frame；
- 同一 turn 的重试复用同一个 Frame；
- `step>1` 完全交回 DSH，不再执行 Tavern 资源投影；
- 兼容模式分支保持原样。

### 阶段 3：收回请求边界投影（前台已完成）

- 将游玩模式的 `middle/front/back` 可翻译语义收进 `writingRules`；
- 删除游玩模式的 `runtimePresetSnapshots` 和 `runtimePresetRedispatches` 路径；
- `llm/stream` 不再为游玩模式重排完整请求，只保留日志、重试、压缩等 DSH 生命周期能力。

### 阶段 4：收敛旧接口（基础收敛已完成）

- 删除 `prepared.text` 作为隐式 Frame 的跨模块契约；
- 删除重复的资源读取与注入代码；
- 将日志改为记录 `frameId`、来源 revision/hash 和追加结果；
- 更新架构文档中的“当前实现映射”。

每个阶段独立提交、独立验证；不能把领域模型、运行链路切换和旧代码清理塞进同一个提交。

### 后续阶段：后台 Frame

前台 seam 稳定后另行实施：

- `BackgroundTaskFrameBuilder`；
- 后台 Session Adapter；
- MVU 额外模型、状态结算和候选生成的指令路由；
- branch/revision 校验、迟到结果拒绝和提交协议。

这些内容属于同一目标架构，但不是当前改造任务的交付物。

## 验收标准

1. 游玩模式每个 turn 恰好构建并追加一个 `ForegroundFrame`。
2. 同一 turn 重试不会产生第二个 Frame。
3. 同一 turn 的第二次及后续模型调用不会重新执行人物卡、世界书、宏、正则或预设投影。
4. 游玩模式的 provider 请求保留 DSH system、tools、Session 历史和工具轨迹。
5. 游玩模式不调用完整酒馆请求编译器，也不替换完整 `messages[]`。
6. 兼容模式最终请求的角色、顺序和内容 hash 与改造前一致。
7. 人物卡、当前世界书、当前状态、剧本、Guide 和写作规则都能从 Frame 来源追踪。
8. 输出正则、MVU 前台结算和 HTML 展示结果不因输入架构改造而变化。
9. DSH 压缩后可以继续从 Session Surface + 新 Frame 正常游玩。
10. `BackgroundTaskFrame` 的接口、路由目标和权威状态约束已经固定，但没有后台实现也不影响当前里程碑完成。

## 风险与回退

- **预设语义无法自然翻译**：不在游玩模式伪造 Prompt Order，提示用户改用兼容模式。
- **Frame 重复追加**：以 `{chatId, branchId, turn}` 生成稳定 `frameId`，Adapter 幂等拒绝重复。
- **重试时资源发生变化**：同一 Frame 固定首次构建的来源 revision；新资源只在下一 turn 生效。
- **DSH 尚无正式 Frame 事件接口**：先使用现有 `agent/pre-step` Adapter，保留未来替换 seam。
- **改造影响旧对话**：以 `requestMode` 和 Frame 版本做读取兼容，不批量改写历史数据。

回退时只需让游玩模式恢复旧的 `prepared.text` 注入；兼容模式从始至终不参与切换。

## 完成定义

本方案完成时，dsh-tavern 应满足：

```text
兼容模式 = 完整酒馆请求编译器
游玩模式 = 酒馆指令 → dsh-tavern Runtime 行动
          ├── ForegroundFrame → 前台持续 DSH Session
          └── BackgroundTaskFrame → 后台持续 DSH Session（后续实现）
```

当前里程碑只以前台 Frame 落地为完成条件；后台 Frame 已完成架构设计，待前台 seam 稳定后单独实现。
