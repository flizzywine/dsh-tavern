# 酒馆单 Agent 协议与 DSH 前后台 Agent 架构

> 状态：架构备忘。本文记录两套运行模型的根本差异，以及兼容和迁移的边界。

## 核心差异

SillyTavern 生态默认只有一个正文模型。人物卡、预设、世界书、正则和变量规则共同要求这个模型在一次输出中完成多种职责：

```text
用户输入
  → 单个前台模型
  → 正文 + 状态块 + 控制标记 + UI 数据
  → 正则、脚本或 MVU 解析
  → 聊天历史与界面
```

因此，许多酒馆人物卡不是单纯的写作资料，而是一份围绕“单模型输出协议”组织起来的 LLM 混合程序。正文、状态计算和展示协议经常互相嵌套，不能假定它们已经天然分层。

dsh-tavern 的目标架构则明确区分三种职责：

```text
前台 Agent：生成用户阅读的正文
后台 Agent：理解剧情，完成状态结算、变量更新和候选生成
Harness / Presentation Runtime：校验、提交、组合并渲染结果
```

前后台是两套持续 Session。前台负责表演，后台负责语义计算；两者都不直接拥有权威状态，最终事实由 Harness 提交。

## 前台 Frame 与后台 Frame

既然前台和后台是两套职责不同的持续 Session，它们就不能共用一种含义模糊的输入。架构上应定义一个公共输入抽象，并区分两种 Frame：

```text
AgentInputFrame
├── ForegroundFrame
└── BackgroundTaskFrame
```

`ForegroundFrame` 表示玩家开始了新一轮，只追加到前台 Session：

```text
ForegroundFrame {
  userInput
  cardContext
  activeWorldbook
  currentStateProjection
  writingRules
  branch
  revision
}
```

它的目标是生成用户阅读的正文。一轮通常只有一个 `ForegroundFrame`。

`BackgroundTaskFrame` 表示系统需要完成一项后台语义任务，只追加到后台 Session：

```text
BackgroundTaskFrame {
  taskType
  trigger
  foregroundOutput
  authoritativeState
  taskRules
  outputContract
  branch
  revision
}
```

它的目标是生成变量补丁、状态动作、候选项或其他结构化结果。一轮可以没有后台任务，也可以依次产生多个 `BackgroundTaskFrame`。后台任务可以重试或延迟完成，但结果必须绑定触发它的前台 `branch / revision`，并由 Harness 防止重复提交或写入过期分支。

两种 Frame 都只负责初始化一次 Agent 工作，不包含随后发生的模型调用、思考、工具调用和工具结果；这些轨迹由各自的 DSH Session 管理。

```text
ForegroundFrame
  → 前台正文
  → BackgroundTaskFrame(MVU)
  → BackgroundTaskFrame(状态结算)
  → BackgroundTaskFrame(候选生成)
  → Harness 校验并提交
```

因此，Frame 不是一种统一的“每轮消息格式”，而是一组面向不同 Agent Session 的输入协议：前台接收回合 Frame，后台接收任务 Frame。

## 两种协议必须并存

### 酒馆兼容协议

未经改造的酒馆卡继续遵守原始单 Agent 语义。若卡片要求前台同时输出正文、状态标签和 UI 标记，兼容层就必须保留这种行为，再执行原有正则和脚本。不能为了内部架构整洁而破坏人物卡协议。

### DSH 前后台协议

原生卡或已经迁移的卡采用明确分工：

```text
InputFrame
  → 前台 Agent 生成正文
  → 触发 BackgroundTaskFrame
  → 后台 Agent 生成结构化状态动作
  → Harness 校验并提交 branch / revision
  → Turn Composer 组合正文、状态与 UI attachment
  → 前端 UI Adapter 渲染 HTML
```

这里的“前台 Agent”和“前端 UI”不是一回事。后台 Agent 只计算结构化数据；真正的 HTML 由确定性的 UI Adapter 在浏览器中渲染。

## MVU 与纯正则卡的不同

MVU 的“额外模型解析”已经提供了天然的前后台边界。兼容层可以拦截这次模型调用，将其转换为 `BackgroundTaskFrame` 并交给常驻后台 Agent，同时保留 MVU 原有的提示词、补丁解析、变量提交和事件行为。无需再次研究如何拆分变量更新任务。

纯正则卡通常没有这个边界。它把正文、状态和显示标记放在同一次前台输出中，而正则只描述如何匹配和替换，并不完整描述后台应该如何生成状态。因此，纯正则卡在兼容模式下仍由前台 Agent 完成原协议。

## 未来的改卡 Skill

要把纯正则卡迁移到前后台架构，需要离线分析和重构，而不是在运行时猜测。未来的改卡 Skill 应生成：

- `ForegroundContract`：前台正文职责；
- `BackgroundContract`：后台语义任务；
- `StateSchema`：结构化状态与动作；
- `UIAdapter`：从状态确定性渲染界面；
- `CompositionPolicy`：正文、状态和 UI 的提交时机；
- 兼容与回归样例：验证迁移前后的剧情和展示效果。

这本质上是把“酒馆单 Agent 单体程序”重构为“前台 Agent、后台 Agent 与 Harness 协作的程序”，不是简单地把正则搬到后台。

## 架构原则

1. 兼容模式忠实执行酒馆的单 Agent 协议。
2. MVU 额外模型请求默认进入后台 Agent。
3. 纯正则卡未经迁移时继续由前台生成完整协议。
4. 原生和迁移后的卡使用前后台分工协议。
5. 后台计算结构化数据，Presentation Runtime 负责 HTML 渲染。
6. 不用运行时启发式拆分代替明确的卡片迁移。

一句话概括：

> 酒馆把正文、状态和展示压在一个 Agent 的输出里；dsh-tavern 则要在保持兼容的同时，逐步把它们重构为前台 Agent、后台 Agent 和确定性 Harness 的协作协议。
