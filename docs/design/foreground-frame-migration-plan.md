# 游玩模式前台 Frame 改造方案

> 状态：待实施。本文只设计前台 `ForegroundFrame`；后台 Agent、`BackgroundTaskFrame` 和后台结算不在本阶段范围内。

## 决策

dsh-tavern 保留两条明确隔离的运行路径：

| 模式 | 上下文架构 | 约束 |
| --- | --- | --- |
| 兼容模式 | 每轮按 SillyTavern 语义重建完整请求 | 继续作为旧卡逃生通道和差分基线 |
| 游玩模式 | 持续 DSH Session + 每轮追加一个 `ForegroundFrame` | 不得调用完整酒馆请求编译器 |

兼容模式继续使用 `compileCompatibilityTurn()` 和临时 provider request 投影，不做改造。游玩模式只把酒馆资源解释为本轮增量输入，历史、工具轨迹、压缩和后续模型调用仍由 DSH 管理。

## 本阶段范围

包含：

- 定义正式的 `ForegroundFrame`；
- 建立唯一的 `ForegroundFrameBuilder` seam；
- 把人物卡、当前世界书、当前状态、剧本引用、Guide 和游玩写作规则收进本轮 Frame；
- 把输入宏和发送正则作为 Frame 构建过程的一部分，只执行一次；
- 将 Frame 只追加到前台 DSH Session；
- 移除游玩模式在 provider request 阶段对完整消息数组的二次重排。

不包含：

- `BackgroundTaskFrame`；
- MVU 额外模型后台路由；
- 候选生成、状态结算和后台 Agent 改造；
- 改写兼容模式的 Prompt Order、世界书或完整请求编译器；
- 将旧酒馆卡自动转换成前后台双 Agent 卡。

现有后台流程保持原样，只是不纳入本次 Frame 设计。

## 当前问题

游玩模式已经有 Frame 雏形，但尚未形成稳定架构：

1. `Turn Orchestrator.prepare()` 最终只返回一段 `prepared.text`，资源来源、剧情 revision 和输入投影没有成为正式领域对象。
2. `agent/pre-step` 在第一步追加这段文本，但 Frame 的一次性、幂等和来源约束没有独立接口保证。
3. 运行时预设的 `front/back` 仍可在 `llm/stream` 阶段重新投影 provider request。这会让游玩模式残留“每次模型调用再次拼提示词”的行为。
4. 兼容模式与游玩模式共用同一组请求钩子，主要依靠条件分支隔离，缺少不可跨越的行为测试。

## 目标链路

```text
玩家输入
  ↓
Turn Orchestrator 建立本轮 operation
  ↓
ForegroundFrameBuilder.build(...)
  ├── 投影本轮玩家输入
  ├── 读取人物卡的当前有效语义
  ├── 读取已经准备好的世界书上下文
  ├── 读取当前权威状态投影
  ├── 选择剧本引用、Guide 与写作规则
  └── 记录资源 revision/hash
  ↓
ForegroundFrameSessionAdapter.append(frame)
  ↓ 只执行一次
持续存在的前台 DSH Session
  ↓
DSH 自主管理模型调用、工具轨迹、压缩与恢复
```

第二次及后续 Agent step 不再重新构建或追加 Frame，也不重新投影人物卡、世界书和预设。它们只使用 DSH Session 已经拥有的本轮轨迹继续工作。

## ForegroundFrame 模型

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
    cardRevision
    worldbookRevision
    stateRevision
    presetSnapshotId
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

## 核心深模块

### ForegroundFrameBuilder

唯一外部接口：

```text
buildForegroundFrame({ sessionId, turn, userInput }) → ForegroundFrame
```

它在内部完成资源读取、选择、去重、宏解析、发送正则、状态投影和来源记录。调用方不需要知道人物卡、世界书、剧本、MVU 或预设分别存在哪里。

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

## 酒馆能力如何进入前台 Frame

| 酒馆能力 | 游玩模式中的位置 |
| --- | --- |
| 人物卡描述、性格、场景 | `cardContext` |
| 玩家输入宏、发送正则 | `userInput.projectedText`，构建时执行一次 |
| 当前激活世界书 | `activeWorldbook` |
| MVU 当前变量 | `currentStateProjection` |
| 剧本进度 | `scriptReference` |
| Guide | `guide` |
| 原生游玩预设和写作约束 | `writingRules` |
| 输出正则、HTML、状态栏 | 不进入 Frame；在最终回复后由 Presentation 投影 |
| 完整 Prompt Order 与历史重排 | 只留在兼容模式 |

这里的“预设进入 Frame”不是复制完整酒馆预设。游玩模式只提取 Agent 本轮需要遵守的写作和任务规则；无法可靠翻译的精确位置语义继续走兼容模式。

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

### 阶段 0：冻结两条路径

- 保存一个真实兼容请求的角色、顺序和内容 hash，防止改造破坏兼容模式；
- 增加游玩模式护栏测试，证明其不会调用 `compileCompatibilityTurn()` 或 `createEphemeralCompatibilityRequest()`；
- 增加多 step 测试，证明当前问题可被测试捕获。

### 阶段 1：引入领域模型

- 新建 `foreground-frame` 模块；
- 新建 FrameBuilder，以当前 `prepared.text` 为初始文本投影，先保持运行结果不变；
- 为 `frameId`、branch/revision 和资源来源建立稳定规则；
- 测试只通过 FrameBuilder 的公开接口验证行为。

### 阶段 2：接入 DSH 游玩链路

- `requestMode=dsh && step=1` 时构建并追加 Frame；
- 同一 turn 的重试复用同一个 Frame；
- `step>1` 完全交回 DSH，不再执行 Tavern 资源投影；
- 兼容模式分支保持原样。

### 阶段 3：收回请求边界投影

- 将游玩模式的 `middle/front/back` 可翻译语义收进 `writingRules`；
- 删除游玩模式的 `runtimePresetSnapshots` 和 `runtimePresetRedispatches` 路径；
- `llm/stream` 不再为游玩模式重排完整请求，只保留日志、重试、压缩等 DSH 生命周期能力。

### 阶段 4：收敛旧接口

- 删除 `prepared.text` 作为隐式 Frame 的跨模块契约；
- 删除重复的资源读取与注入代码；
- 将日志改为记录 `frameId`、来源 revision/hash 和追加结果；
- 更新架构文档中的“当前实现映射”。

每个阶段独立提交、独立验证；不能把领域模型、运行链路切换和旧代码清理塞进同一个提交。

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
游玩模式 = 酒馆语义编译器 → 单个 ForegroundFrame → 持续 DSH Session
```

本阶段不以后台任务迁移为完成条件。后台 Frame 将在前台 Frame seam 稳定后单独设计。
