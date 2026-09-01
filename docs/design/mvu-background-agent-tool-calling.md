# MVU 后台 Agent 工具调用方案

> 状态：已确认的目标方案，尚未实施。

> 实现更新（2026-08-31）：主链路已实现。当前工具契约由[变量工具纠错](mvu-tool-retry.md)修订：不再限制每轮仅调用一次，而是在同一 Agent 回合最多提交三次，工具返回实际执行结果，失败草稿不提交，成功后停止调用。下文保留原迁移设计作为背景。
>
> 前台关系更新（2026-09-01）：普通游玩当前把 MVU 定义为正文提交后的结构化投影，[有意不把变量自动注入下一轮前台](mvu-settlement-only-memo.md)。本文关于“下一轮读取变量”的旧表述不再描述普通游玩当前决定；兼容模式的显式变量宏不受影响。
>
> 本文在[《官方 MVU 本地运行时迁移方案》](official-mvu-runtime-migration.md)之上增加变量生成链路，并落实[《前台 Frame 迁移方案》](foreground-frame-migration-plan.md)中尚未实现的 `BackgroundTaskFrame`。它不改变“官方 MVU 负责变量语义、dsh-tavern 负责持久化”的既有分工。

## 一句话结论

剧情模型只生成剧情；每轮最终正文提交后，由后台 Agent 根据“当前变量快照 + 本轮最终正文 + 人物卡变量结构与更新规则”强制调用一次 MVU 更新工具。工具把结构化 JSON Patch 交给本地官方 MVU 与人物卡脚本结算，再由 Host Adapter 原子写入当前 Swipe 的变量快照。

后台 Agent **不读取本轮用户输入，也不根据用户意图更新变量**。变量只记录正文已经确认发生的事实。

## 为什么要迁移

当前变量更新和剧情共用一次模型输出，模型必须同时完成两类任务：

1. 写出自然、连贯的剧情正文；
2. 在正文末尾稳定输出 `<UpdateVariable>` 协议。

这会产生几个无法靠解析器彻底解决的问题：

- 模型在思考中规划了变量变化，最终正文却漏掉更新协议；
- 协议与正文争抢输出长度和注意力；
- 强制同一次请求使用工具调用可能挤掉正文，使用 `auto` 又可能不调用；
- 更新失败与“本轮确实没有变量变化”无法可靠区分；
- 变量协议混入正文、历史和重新生成内容，增加显示与兼容负担。

官方 MagVarUpdate 已经存在“额外模型解析”思路以及工具调用、格式化输出 Schema。本方案复用其语义，但通过 DSH 的后台执行链路接入，而不是复刻一套 SillyTavern 请求系统。

## 设计原则

### 1. 正文是唯一事实来源

后台变量 Agent 的任务输入只包含：

- 当前选中 Swipe 对应的变量快照；
- 本轮已经提交的最终正文；
- 人物卡变量结构；
- 适用于变量更新的规则。

明确排除：

- 本轮用户输入；
- 剧情模型的隐藏思考；
- 候选项；
- 未被正文确认的用户意图；
- 旧轮剧情正文和旧轮后台任务；
- DSH 前台 Session 的工具轨迹与系统提示词。

例如，用户输入“尝试突破”，正文写的是突破失败，后台只能根据“突破失败”结算，不能按用户意图写成突破成功。

### 2. 工具调用是输出契约，不是第二套变量引擎

后台模型负责判断“哪些变量应该变化”，工具负责固定“变化如何提交”。工具不能绕过官方 MVU 直接修改持久化状态。

目标链路为：

```text
后台 Agent 工具参数
  → 转换为标准 MVU UpdateVariable 命令
  → 本地官方 MVU 解析
  → 人物卡变量结构、变量守卫等脚本参与
  → Runtime effects
  → Host Adapter 原子提交
```

JSON Schema、路径校验和 revision 检查属于工具与 Runtime 的实现；具体人物卡业务规则仍来自人物卡，不写死在 Host Adapter 中。

### 3. 每轮必须调用一次工具

工具调用使用 `required`，后台任务只能以下列两种方式结束：

- 有变化：提交一个或多个 Patch operation；
- 无变化：提交空的 `operations: []`。

因此三个状态可以明确区分：

| 结果 | 含义 |
| --- | --- |
| 工具成功，`operations` 非空 | 本轮变量已更新 |
| 工具成功，`operations` 为空 | 本轮确认无需更新 |
| 没有有效工具调用或工具失败 | 本轮变量结算失败 |

不能再把“模型没有输出协议”解释为“变量未更新”。

### 4. 每轮只有一个变量更新所有者

启用后台结算后：

- 前台剧情输出中的 `<UpdateVariable>` 不再参与结算；
- 后台工具调用是本轮唯一变量命令来源；
- 本地官方 MVU 是唯一变量状态执行器；
- Host Adapter 是唯一持久化提交入口。

不能同时执行前台协议和后台工具，否则同一变化可能应用两次。

## 目标模块关系

```text
Foreground Turn
  └─ 剧情模型生成最终正文
          ↓ 提交 Story Timeline
BackgroundCycleScheduler
  └─ 创建 variable-settlement operation
          ↓
BackgroundTaskFrameBuilder
  └─ 当前变量 + 最终正文 + 变量规则 + revision
          ↓
MVU Settlement Agent
  └─ required: mvu_submit_update(...)
          ↓
MVU Update Tool Adapter
  └─ 校验并转换为标准 UpdateVariable
          ↓
Official MVU Runtime
  └─ 官方事件 + 人物卡脚本 + 最终变量效果
          ↓
Tavern Host Adapter
  └─ expectedRevision 原子提交当前 Swipe 快照
          ↓
状态事件 → 变量回执 → 状态栏刷新
```

### MVU Settlement module

该 module 应成为一个深模块，对外只暴露一个动作：

```text
settleVariables({
  operationId,
  chatId,
  branchId,
  messageId,
  swipeId,
  expectedRevision,
  currentVariables,
  storyText,
  variableSchema,
  updateRules
}) → SettlementReceipt
```

调用方不需要知道工具名、JSON Schema、模型请求组织、重试方式、MVU 命令格式或人物卡脚本事件顺序。

`SettlementReceipt` 至少包含：

```text
SettlementReceipt {
  operationId
  status: "updated" | "unchanged" | "failed" | "stale" | "cancelled"
  summary
  requestedOperations
  appliedChanges
  failures
  inputRevision
  committedRevision?
  modelUsage?
}
```

前台“本轮变量更新”提示只能读取这份实际结算回执，不能根据模型 Analysis 或正文内容猜测。

## BackgroundTaskFrame

变量结算使用专门的后台 Frame：

```text
BackgroundTaskFrame {
  kind: "background-task"
  taskType: "mvu-variable-settlement"
  operationId
  trigger {
    chatId
    branchId
    messageId
    swipeId
    revision
  }
  authoritativeState {
    currentVariables
    variableSchema
  }
  foregroundOutput {
    storyText
  }
  taskRules {
    updateRules
    updateOnlyFromStory: true
  }
  outputContract {
    tool: "mvu_submit_update"
    required: true
  }
}
```

`storyText` 是从本轮最终原始回复中确定性提取出的剧情正文，不包含：

- `<UpdateVariable>`；
- `<visual_cards>`；
- `<StatusPlaceHolderImpl/>`；
- Markdown 围栏中的状态栏 HTML；
- 其他已经识别为展示或控制协议的区块。

提取失败时应终止后台结算并报告诊断，不能把整段 HTML 或控制协议交给模型猜测。

## 工具定义

建议工具名为 `mvu_submit_update`。它表示“提交变量更新建议”，真正执行仍由官方 MVU 完成。

```json
{
  "type": "function",
  "function": {
    "name": "mvu_submit_update",
    "description": "Submit all variable changes confirmed by the current story text. Call exactly once; use an empty operations array when nothing changed.",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "analysis": {
          "type": "string"
        },
        "operations": {
          "type": "array",
          "items": {
            "oneOf": [
              {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "op": { "enum": ["replace", "insert", "add"] },
                  "path": { "type": "string" },
                  "value": {}
                },
                "required": ["op", "path", "value"]
              },
              {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "op": { "const": "delta" },
                  "path": { "type": "string" },
                  "value": { "type": "number" }
                },
                "required": ["op", "path", "value"]
              },
              {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "op": { "const": "remove" },
                  "path": { "type": "string" }
                },
                "required": ["op", "path"]
              },
              {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "op": { "const": "move" },
                  "from": { "type": "string" },
                  "path": { "type": "string" }
                },
                "required": ["op", "from", "path"]
              }
            ]
          }
        }
      },
      "required": ["analysis", "operations"]
    }
  }
}
```

第一版只接受官方 MVU 已验证支持的 JSON Patch 方言。旧卡中的 lodash 风格更新规则可以作为模型规则输入，但后台输出统一收敛为 JSON Patch；确实无法等价转换的卡应明确标记不支持，不能执行任意模型生成的 JavaScript。

## 模型请求组织

后台 Agent 是每个 Tavern Chat 共享的逻辑执行者，但每次变量结算的模型上下文必须是隔离的：

```text
稳定前缀
  ├─ 后台变量结算职责
  ├─ 固定工具定义
  ├─ 人物卡变量结构
  └─ 人物卡变量更新规则

本轮内容
  ├─ 当前变量快照
  └─ 本轮最终正文
```

旧轮后台任务、旧轮正文和旧工具结果不进入本次 provider 请求。后台 Session 可以保留完整审计轨迹，但请求投影必须只发送当前任务所需内容。稳定前缀按人物卡 revision 生成 digest，未变化时可复用提供商前缀缓存。

模型设置建议：

- 使用当前用户选择的模型连接，第一版不增加第二套密钥配置；
- `tool_choice = required`；
- 低温度；
- 不要求长思考；
- 限制输出 token；
- 单次失败允许一次结构修正重试，不并发发起多个可能写入的请求。

## 工具执行与事务

工具收到参数后依次执行：

1. 校验 `operationId`、chat、branch、message、Swipe 和 revision；
2. 校验工具参数符合固定 Schema；
3. 校验路径、操作类型和基础值类型；
4. 将参数转换为规范化 `<UpdateVariable><JSONPatch>...` 命令，仅作为 Runtime 内部输入；
5. 在对话级共享脚本沙箱中交给本地官方 MVU；
6. 按官方顺序触发变量结构、变量守卫和其他人物卡脚本；
7. 收集最终变量树、实际差异、脚本效果和诊断；
8. 使用 `expectedRevision` 原子提交；
9. 保存 `SettlementReceipt` 并发布一次状态事件。

任一步失败都不能部分写入变量快照。工具调用以 `operationId` 幂等：同一 operation 重放时返回既有回执，不再次应用 Patch。

## 前台生命周期与交互

推荐时序：

```text
剧情正文完成
  → 立即提交并显示正文
  → 显示“变量结算中”
  → 后台工具调用与官方 MVU 结算
  → 成功：显示“本轮变量更新 N 项”并刷新状态栏
  → 无变化：显示“本轮确认无需更新”
  → 失败：显示失败原因和“重试变量结算”
```

在变量结算完成前，下一轮发送和候选生成应排队或明确禁用。否则下一轮可能读取旧变量快照。状态栏保留上一份完整快照，直到新 revision 一次性准备完成；不能先清空再重建。

重新生成与 Swipe：

- 每个 Swipe 创建独立的变量结算 operation；
- operation 绑定产生它的正文 hash 和基准变量 revision；
- 切换 Swipe 时读取该 Swipe 已提交的变量快照；
- 迟到结果若不再对应当前 branch/revision，则记为 `stale`，不得覆盖当前状态；
- 对同一 Swipe 手动重试时复用正文，只重新运行变量结算。

## 变量规则来源

输出格式可以通用，更新语义不能写死。`BackgroundTaskFrameBuilder` 按以下优先级收集规则：

1. 人物卡已注册的变量 Schema；
2. 明确标记为 `[mvu_update]` 的世界书条目；
3. 同时适用于剧情和更新、且经过编译器确认可安全投影的 MVU 规则；
4. 本地官方 MVU 的固定更新约束。

明确标记为 `[mvu_plot]` 的条目不得进入后台变量请求。无法区分用途的旧卡可以进入兼容诊断，但不能为了“看起来支持”而把全部世界书无差别发给后台 Agent。

## 普通游玩与兼容模式

两种编排策略共享同一个 `MVU Settlement module`：

```text
普通游玩最终正文 ─┐
                  ├─→ MVU Settlement module → Official MVU Runtime
兼容模式最终正文 ─┘
```

差异只存在于正文如何生成；变量结算读取的是相同形状的最终正文、变量快照和人物卡规则。不能为兼容模式保留另一套前台 `<UpdateVariable>` 执行器。

## 当前实现差距

仓库中已经具备：

- `BackgroundTaskFrame` 的领域位置；
- 本地固定版官方 MVU 源码与运行方向；
- JSON Patch 解析、变量快照、Swipe、回执和 Host revision 基础；
- 官方 MVU 上游的额外模型 Schema 与工具调用实现，可作为行为依据。

尚未具备：

- `BackgroundTaskFrameBuilder` 的生产实现；
- 后台变量 Agent 的 DSH Session Adapter；
- 将已登记 Function Tool 投影到真实模型请求并执行其 `action` 的桥接，以及 `generate` 和 `generateRaw`；当前 Host 只在工具调用明确关闭时保留注册生命周期，尚不把注册项发送给模型；
- `mvu_submit_update` 的事务式 Tool Adapter；
- 从最终回复可靠提取 `storyText` 的统一接口；
- 前台协议退出和后台单所有者切换；
- 变量结算期间的发送门控与用户重试入口。

因此不能只打开官方 MVU 的某个设置项；需要完成后台执行、工具、官方 Runtime 和 Host 提交四段链路。

## 实施阶段

### 阶段 0：冻结回归证据

- 保存“思考中规划更新但最终漏掉 `<UpdateVariable>`”的真实回合；
- 保存正常前台 Patch、空更新、错误路径、变量守卫改写和 Swipe 夹具；
- 固定人物卡 revision、官方 MVU commit、最终正文和基准变量树。

### 阶段 1：建立后台任务与正文输入

- 实现 `BackgroundTaskFrameBuilder`；
- 建立 `storyText` 提取器；
- 创建每对话串行的 `variable-settlement` operation；
- 完成 branch/revision、取消、过期和幂等测试；
- 暂不调用模型、不写变量。

### 阶段 2：实现工具调用 Adapter

- 注册严格的 `mvu_submit_update`；
- 使用 `required` 发起隔离后台请求；
- 支持非空 Patch 与空 Patch；
- 工具无效时允许一次结构修正重试；
- 保存模型用量、工具参数和失败诊断。

### 阶段 3：接入本地官方 MVU

- 将工具参数转换为官方 MVU 标准输入；
- 在共享脚本沙箱中运行变量结构和变量守卫；
- Host Adapter 使用 `expectedRevision` 原子提交；
- 前台回执改为读取实际提交差异。

### 阶段 4：切换单所有者

- 后台工具成为新回合唯一变量命令来源；
- 前台不再要求剧情模型输出 `<UpdateVariable>`；
- 前台遗留协议不执行，避免双重更新；
- 普通游玩和兼容模式同时切换，不保留两套生产所有者。

### 阶段 5：完善交互与恢复

- 正文先显示，状态栏保留旧快照；
- 展示结算中、已更新、无需更新、失败和过期；
- 提供手动重试变量结算；
- 验证刷新、重启、断线恢复、重新生成和 Swipe。

每个阶段必须独立提交、独立验证。阶段 4 之前不得让后台结果写入真实对话，阶段 4 完成后不得继续执行前台变量协议。

## 验收标准

### 输入隔离

1. 后台 provider 请求不包含本轮用户输入。
2. 后台 provider 请求不包含前台隐藏思考。
3. 后台 provider 请求只包含当前最终正文，不包含旧轮正文。
4. `visual_cards`、状态栏 HTML 和控制协议不进入 `storyText`。

### 工具契约

5. 每个成功后台任务恰好有一次有效 `mvu_submit_update` 调用。
6. 空 Patch 被记录为“确认无需更新”，不是失败。
7. 没有工具调用、Schema 错误和非法路径均记录为失败。
8. 模型不能通过工具参数执行任意 JavaScript。

### 状态一致性

9. 每轮最多产生一次变量提交。
10. 官方 MVU 与人物卡脚本完成处理后才允许提交。
11. 提交失败不改变上一份完整变量快照。
12. 迟到任务不能覆盖新的 branch、revision 或 Swipe。
13. 刷新后正文、变量回执和状态栏来自同一已提交 revision。

### 用户体验

14. 正文完成后立即可见，不等待变量 Agent 才显示。
15. 结算期间状态栏不闪白、不展示半成品。
16. 用户可以区分“更新 N 项”“确认无需更新”和“结算失败”。
17. 失败可以只重试变量结算，不重新生成正文。

### 兼容性

18. 普通游玩和兼容模式使用同一个后台结算 module。
19. 重新生成的每个 Swipe 拥有独立变量快照。
20. 无 MVU 卡不创建变量结算 operation，也不增加模型请求。

## 不在本方案中解决

- 让后台 Agent 根据用户输入补写正文没有发生的事件；
- 从剧情模型隐藏思考中推断变量；
- 允许模型生成任意 JavaScript 更新变量；
- 为每张人物卡实现专用变量工具；
- 在同一次前台请求中同时生成正文并强制工具调用；
- 完整复刻 SillyTavern 的额外模型设置面板和多 API 配置；
- 无限制并发多次变量请求并采用多数投票。

## 完成定义

只有同时满足以下条件，才能宣布迁移完成：

- 剧情模型不再承担变量协议输出职责；
- 后台请求只以当前变量、最终正文和变量规则为依据；
- 每轮必须通过固定工具提交非空或空 Patch；
- 本地官方 MVU 和人物卡脚本是唯一变量语义执行链路；
- DSH 仍是消息、Swipe、变量和 Session 的唯一持久化权威；
- 前台显示的变量回执来自真实提交差异；
- 普通游玩、兼容模式、重新生成、Swipe、刷新和重启测试全部通过。
