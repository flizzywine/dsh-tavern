# Tavern-only 持久后台 Agent 设计

> 状态：Accepted Scope
> 当前范围：只改 dsh-tavern，不修改 DSH 本体。

## 结论

dsh-tavern 只需要保证一件事：

> 每个 Tavern 对话绑定同一个持久后台 Agent。状态结算和候选生成持续发送给这个 Agent，使它保留同一份身份、Session 轨迹和上下文。

这里的“持续存在”同时包括 Session 身份和进程内 Agent handle：

- 后台 Agent 使用稳定的 Session ID；
- 同一 Tavern 对话后续任务复用同一个常驻 Agent handle；
- 每项任务只调用 `Agent.followup()`，任务结束后不释放 handle；
- 只有 Tavern 插件或 Host 退出时才释放 Agent；Host 重启后从持久 Session 恢复一次并继续常驻；
- 剧情回退时仍使用同一 Session，并把后台可见 Surface 回退到对应 checkpoint。

常驻由 dsh-tavern 自己管理，不要求修改 DSH 的生命周期实现，也不建立独立于 Host 的外部守护进程。

## 两条原则

1. **不修改 DSH 本体。** 只使用当前 DSH 已公开的 `agents.create()`、`agents.resume()`、`Agent.followup()`、`Agent.whenIdle()` 和 Session 持久化能力。
2. **只解决前台与持久后台 Agent 的任务通信。** 浏览器状态推送、通用 Agent 团队、任务 DAG 和新的消息总线不属于本设计。

## “前后台”的含义

本文中的：

- **前台 Agent**：负责与用户对话和生成正文的 Agent；
- **后台 Agent**：负责派生状态结算和候选生成的持久 Agent。世界书由 Tavern 确定性规则 Module 处理，不进入后台 Session。

它不是“浏览器前端与 Host 后端”的简称。WebUI 状态展示是外围能力，不决定 Agent 通信是否正确。

## 目标链路

```text
前台 Agent / Tavern Host
  → 建立 Tavern operation
  → 找到对话绑定的后台 Session
  → 复用常驻后台 Agent；不存在时 create 或 resume 一次
  → Agent.followup() 投递任务
  → Agent.whenIdle() 等待本轮真实结束
  → 读取后台 Session 的本轮最终回复
  → Story Timeline 校验并提交结果
  → Agent 保持 idle，等待下一项 followup
```

前台正文 Agent 不直接接收后台最终回复。后台结果先进入对应的 Tavern 领域 Module，再由 Story Timeline 判断能否影响当前剧情。

## 权威状态

| 事实 | 权威来源 |
| --- | --- |
| 当前剧情、branch、revision、checkpoint | Tavern Story Timeline |
| 后台任务身份、用途、依据和提交结果 | Tavern operation |
| 后台 Agent 身份和完整运行轨迹 | DSH Session |
| 当前对话绑定哪个后台 Agent | Story Timeline participant 中的 Session ID |
| 单次任务的消息顺序 | DSH Agent inbox |

Tavern 不保存第二个“后台 Agent 是否在线”字段。进程中的常驻 handle 由 Runner 注册表管理，只是可重建的运行时资源；持久身份仍以 participant 中的 Session ID 为准。

## 现有通信 seam

当前实现由三个各自有明确 interface 的 Module 协作，不再增加一层只做转发的包装：

- `Background Task Coordinator`：建立、查询并提交 Tavern operation；
- `Background Agent Runner`：管理同一后台 Session 的创建、恢复、任务投递和本轮结果；
- `Foreground Handoff`：在前台下一轮开始前等待后台周期，并把已提交的领域快照交给 Turn Orchestrator。

结算和候选只通过 `Background Task Coordinator` 建立 operation，再调用同一个 `Background Agent Runner.run()`。Runner 内部负责：

1. 读取 Story Timeline participant；
2. Runner 已有该 participant 的常驻 handle 时直接复用；
3. 没有常驻 handle 时，participant 无 Session ID 则使用 `agents.create()`，已有 Session ID 则使用 `agents.resume()`，随后缓存 handle；
4. 将完整任务通过 `Agent.followup()` 投递；
5. 使用 `Agent.whenIdle()` 等待本轮结束，不使用固定时长判断成功或失败；
6. 从本轮 Session 事件中取得最终 assistant 内容或真实终止原因；
7. 调用对应领域 Module 解析结果；
8. 最终通过 `Story Timeline.complete()` 幂等提交；
9. 本轮工具解绑后让 Agent 保持 idle，不释放 handle；仅在 Tavern 插件或 Host 退出时统一释放。

创建、恢复、投递、等待、结果定位和错误归一化全部隐藏在 Runner 内。结算和候选调用方不得分别管理 Agent 生命周期。

## 常驻生命周期

```text
create / resume 一次
  → followup → whenIdle
  → followup → whenIdle
  → ...
  → Tavern 插件或 Host 退出时 dispose
```

同一个后台 Agent 的任务仍严格串行。`idle` 只表示它正在等待下一项任务，不会持续调用模型或占用生成算力。每轮 system prompt、temperature 和任务工具按当前 operation 更新；任务工具在本轮结束后解绑，但 Agent handle 保持常驻。

## 持久 participant

Story Timeline participant 至少保存：

```js
{
  role: 'background',
  lifetime: 'chat',
  sessionId,
  branchId,
  syncedRevision,
  boundary,
  status: 'current | needs-session | needs-rewind',
  rewindTo,
  updatedAt
}
```

约束：

- 每个 Tavern chat 只有一个 `background` participant；
- `settlement`、`candidate` 共用它；
- 正常推进不得因任务 role 不同而创建新 Session；
- 只有 participant 尚未创建时才能生成新的 Session ID；
- 普通失败不得删除 participant；
- Host 重启不得清空 participant；
- 剧情回退更新 `needs-rewind`，不替换 Session ID。

## 任务消息

每条发送给后台 Agent 的任务消息至少包含：

```text
operationId
role
basedOn.branchId
basedOn.revision
当前任务所需的权威剧情 Surface
本轮输入
允许使用的工具
结果格式和权限
```

任务消息是模型内容，不是 Tavern 自建传输协议。真正的消息投递使用 `Agent.followup()`。

同一后台 Agent 的任务必须串行执行，避免多个任务同时修改同一 Session Surface。串行器只是 Module 的进程内执行纪律，不是第二个持久 Agent 邮箱；消息顺序仍以 DSH inbox 为准。

## 结果提交

后台回复不能直接写入前台正文。提交前必须校验：

1. `operationId` 仍存在且未终结；
2. 当前 `{ branchId, revision }` 与 `basedOn` 一致；
3. 结果符合当前 role 的格式和权限；
4. 重复完成同一 operation 不会产生第二份领域结果。

结果分别交给：

- `settlement` → 派生状态结算；
- `candidate` → Candidate Generator；
- 最后统一由 `Story Timeline.complete()` 提交。

剧情已经推进或回退时，迟到结果进入 `stale`，不得覆盖当前剧情。

## 后台信息进入前台 Agent

后台完成后不直接调用前台 Agent 的 `inject()`、`steer()` 或 `followup()`，也不自动启动一轮前台生成。

采用持久领域快照交接：

```text
后台 Agent 完成
  → 对应领域 Module 解析并校验
  → Story Timeline.complete() 提交
  → 保存结算状态
  → 玩家发起下一轮
  → agent/pre-step
  → Foreground Handoff 等待尚未完成的后台周期
  → Turn Orchestrator 读取最新持久快照
  → Context Planner 加入前台本轮上下文
```

只投影前台真正需要的领域事实：

- 世界书：由确定性 Worldbook Module 保存的 `preparedWorldBookContext`，不经过后台 Agent；
- `settlement`：`posture` 等已经提交的权威状态；
- `candidate`：不注入前台 Agent，只供玩家选择；
- 后台原始回复、完整 transcript、调试信息：不注入。

这条交接复用现有 `Foreground Handoff` interface。持久 Tavern 状态是通信内容的权威来源，`agent/pre-step` 只是把最新快照投影进当前模型请求，因此 Host 重启后不会丢失已经提交的信息，也不会让后台完成事件意外唤醒前台 Agent。

## 剧情回退

回退时保留原后台 Session：

1. Story Timeline 创建新 branch，revision 保持单调增加；
2. participant 标记为 `needs-rewind`；
3. 后续任务继续复用同一个常驻后台 Agent；若 Host 已重启，则先恢复同一个后台 Session；
4. 后台 Surface 回退到 checkpoint 记录的 boundary；
5. 新任务继续投递到同一个 Agent。

这样后台 Agent 仍是同一个参与者，但不会继续看到已经废弃的剧情分支。

## Host 重启

Host 重启后：

1. 从 Story Timeline 读取 participant Session ID；
2. 下一次任务到来时使用 `agents.resume()` 恢复一次，并将 handle 保持常驻；
3. 已经提交的领域结果保持不变；
4. 未提交完成的进程内任务按 Tavern operation 恢复规则处理；
5. 相同 request ID 的重试复用原 operation，结果提交保持幂等。

当前 DSH 接口无法证明 Host 崩溃瞬间某一后台回合是否已经完成。因此本设计不承诺任意崩溃点的无损续跑；它保证后台 Agent 身份和已持久 Session 不丢失，并用 operation 幂等避免重复领域结果。

## WebUI 状态

WebUI 可以继续读取 Tavern 持久 operation 的派生状态。SSE、RPC 或现有同步实现属于 UI Adapter，不属于 Agent 通信 seam。

约束：

- UI 状态不得反向决定 operation 是否成功；
- 浏览器 optimistic state 不是权威状态；
- 后台运行时长不能作为失败依据；
- UI 同步失败不能删除或替换后台 participant；
- 不把 UI 消息通道包装成 Agent 邮箱。

## 不做的事情

- 不修改 DSH 本体；
- 不要求外部插件 Session 事件注册；
- 不接入 Tavern 自定义 Session Projection；
- 不要求 WebUI 使用 `useProjection()`；
- 不迁移到 `ctx.subagents.startContinuable()`；
- 不处理 continuable subagent 的 settlement 唤醒策略；
- 不建立脱离 Tavern Host 生命周期的后台守护进程；
- 不建立 Agent 团队、DAG 或通用消息总线；
- 不让后台回复自动触发一轮前台正文生成；
- 不把 Agent transcript 当成 Story Timeline。

## 迁移顺序

### 第一阶段：锁定统一通信入口

- 常驻、创建、恢复、投递、等待和结果定位统一由 `Background Agent Runner` 负责；
- 结算和候选通过 `Background Task Coordinator` 建立 operation；
- 禁止调用方绕过 Runner 分别管理 Agent 生命周期。

### 第二阶段：固定持久 participant

- 确保每个 chat 只有一个后台 Session ID；
- 验证三个 role 始终复用同一个 Session；
- 验证 Host 重启后能够 resume；
- 验证剧情回退只回退 Surface，不换后台 Session。

### 第三阶段：收敛重复状态

- operation 成为任务状态权威来源；
- 删除与 participant 身份重复的在线状态；
- 将持久任务信箱中仍有价值的 request 幂等信息并入 operation；
- UI 同步只读取派生结果，不参与任务执行。

迁移采用替换，不让结算和候选长期各自维护一套 Agent 生命周期。

## 验收矩阵

- 同一 Tavern chat 连续执行结算和候选，两个任务使用同一后台 Session ID；
- 新 Tavern chat 创建自己的后台 Session，不与其他 chat 混用；
- 后台 Agent 第一次创建或恢复后保持常驻，连续任务之间不再 resume 或 dispose；
- Tavern 插件或 Host 退出时，常驻 Agent 统一释放；
- Host 重启后下一次任务仍恢复原后台 Session；
- 剧情回退后仍使用原 Session，并先回退到正确 boundary；
- 多个后台任务严格串行，不并发污染同一 Session；
- 后台运行 10 秒、1 分钟或 2 分钟不会因时长被判失败；
- 后台失败、取消或达到 token 上限时保留真实终止原因；
- 相同 operation 重复完成不产生重复领域结果；
- 旧 branch 的迟到结果变为 `stale`；
- 后台任务完成不会自动生成一轮前台正文；
- 测试通过 Task Coordinator、Agent Runner 和 Foreground Handoff 的 interface 观察行为，不依赖内部队列次数。

## 最终不变量

1. 一个 Tavern chat 在 Tavern 进程生命周期内对应一个常驻后台 Agent handle，并始终绑定同一个持久 Session。
2. 结算和候选持续与这个后台 Agent 通信；世界书保持 Tavern 本地确定性投影。
3. 单项任务完成后 Agent 进入 idle 而不释放；只有 Tavern 插件或 Host 退出时才释放，重启后从原 Session 恢复一次。
4. 剧情事实由 Story Timeline 决定，Agent Session 不反向覆盖剧情。
5. 后台结果只能通过 operation 校验后提交。
6. 运行时长永远不是错误依据。
7. 不修改 DSH 本体。
