# 跨 Agent 剧情时间线设计

## 目标

回退、正文重生成、候选生成和状态结算必须作用于同一条权威剧情时间线。Tavern 保存的正文与结构化状态是唯一真相；DSH 前台 Agent 与后台 Agent 都只是某个剧情 revision 的生产者或投影。

本设计解决以下问题：

- 正文回退后，持久后台 Agent 仍记得已经废弃的剧情。
- 正文重生成被当成新回合，剧本游标额外前进一块。
- 旧候选项、人物姿势或迟到的结算结果覆盖新正文。
- 后续每增加一种子 Agent，都要在回退函数中增加专用判断。

## 领域模型

### 剧情时间线

每个游玩会话拥有一条剧情时间线：

```text
branchId + revision + checkpoint + participants + operations
```

- `branchId`：当前剧情分支。不透明；回退或正文替代成功后必须变化。
- `revision`：权威状态版本，只增不减。回退恢复旧内容，但仍产生更大的新 revision，避免旧异步结果重新合法。
- `checkpoint`：某次正文提交前可完整恢复的剧情状态，包括消息、剧本状态、人物姿势、候选投影和 Agent 绑定。
- `participant`：时间线保存的持久 Agent 绑定。当前登记 `background`；前台 Agent 由 DSH 宿主会话持有，不重复登记。
- `operation`：绑定 `{branchId, revision}` 的生成工作。结果只有在依据仍有效时才能提交。

人物卡、Guide 和剧本文件是会话配置，不随“回退本轮”倒退；正文、剧本游标、人物姿势、候选项与派生状态属于 checkpoint。

### 前台、后台与任务权限

Agent 身份与后台任务是两个维度。候选和状态结算共享一个后台 Session，但 operation 仍按任务限制可提交效果：

| Agent | 生命周期 | 触发方式 | 可提交效果 |
| --- | --- | --- | --- |
| 前台 Agent | 会话级 | 玩家输入 | 正文 |
| 后台 Agent | 会话级持久化 | 后台任务 | 由本次 operation 的任务权限决定 |

| 后台任务 | 触发方式 | 可提交效果 |
| --- | --- | --- |
| `candidate` | 用户显式生成 | 候选项、向前 `point` 提案 |
| `settlement` | 正文提交后 | 人物姿势与获准的派生状态 |

以后增加世界状态、导演建议等能力时，优先增加后台任务，而不是新增长期 Agent；只有确实需要隔离记忆或不同生命周期时才增加 participant。

## 深 Module 与接口

新增 `Story Timeline` 深 Module。它的 Seam 位于 DSH 生命周期与 HTTP/RPC 意图之下，文件 chat、Script Continuity、DSH Session 和各类 Agent 运行细节之上。

公开接口只包含三个入口：

```js
const timeline = createStoryTimeline(dependencies)

await timeline.apply(intent)
await timeline.complete(completion)
await timeline.inspect(query)
```

### `apply(intent)`

接受用户或宿主意图。即时事务直接返回新视图；需要模型生成的工作返回 operation：

```js
{
  status: 'pending',
  operationId,
  role: 'body | worldbook | candidate | settlement',
  basedOn: { branchId, revision },
  snapshot,
  participant
}
```

当前实现支持的 intent：

- `ensure`
- `body.begin`
- `agent.begin`（role 可为 `worldbook`、`candidate`、`settlement` 或未来角色）
- `turn.rollback`
- `replacement.abort`

正文、世界书召回、候选和结算的成功或失败统一通过 `complete` 提交。正文替代目前由“恢复 checkpoint → `body.begin` → `complete`”组合完成；如果模型失败，`replacement.abort` 恢复原内容但仍创建新 branch/revision，避免 ABA。

宿主 RPC 可以继续使用 `rollbackTurn`、`regenBody` 等易懂名称，但只能翻译 intent，不能自行修改剧情状态。

### `complete(completion)`

提交模型结果。每个结果必须携带 `operationId` 和 `basedOn`。时间线在一次串行提交中完成：

1. operation 仍是当前工作；
2. HEAD 的 `{branchId, revision}` 仍与 `basedOn` 一致；
3. 结果格式和角色允许的领域效果有效；
4. 再写入正文、候选、`point` 或结算状态。

不一致的结果返回 `stale` 或 `cancelled`，不得写入任何权威状态。

### `inspect(query)`

返回当前权威投影和 Agent 同步状态，供界面、诊断和测试使用。它不暴露 DSH event seq、compact 格式或文件布局。

## 核心不变量

1. Tavern checkpoint 是唯一真相；Agent transcript 不能反向决定当前剧情。
2. revision 永远单调递增；回退创建新 branch 和新 revision。
3. 同一 chat 的写操作串行化；所有 Agent 结果提交前比较 `basedOn`。
4. 正文成功提交后剧本游标只前进一块。
5. 候选 `point` 只是提案，由时间线经 Script Continuity 提交；仍执行 `max(current, requested)`。
6. 正文替代是“基于正文前 checkpoint 生成，成功后一次替换”；失败时正文、游标、姿势、候选和 Agent 绑定全部不变。
7. 候选重生成不改变 branch；整条 Tavern 对话的候选与结算复用同一个后台 Agent。
8. 回退和正文替代成功会让旧分支的运行结果全部失效。
9. 回退不能只追加“前文作废”；必须用 checkpoint 边界遮蔽后台 Agent 模型 Surface 中的废弃任务，再注入最新权威状态。
10. 状态结算是后台任务，不是独立 Agent；回退直接恢复 checkpoint 中的派生状态，迟到结果因 revision 不一致而丢弃。

## 操作语义

### 正常正文推进

正文生成前锁定 checkpoint 和剧本参考；成功后提交正文、游标和新 revision，清除上一正文的候选结果，并安排绑定新 revision 的后台结算任务。后台 Agent 保持同一 branch；结算完成后候选任务直接复用其 Session 与最新剧情理解。

### 重新生成候选项

正文 HEAD 不变，因此不分叉。每次候选 operation 都有独立 ID；后发请求可让先发结果失效。成功候选与 `point` 在同一提交中落盘。

### 回退本轮

从最后一次正文提交的 `before` checkpoint 恢复正文、剧本状态、人物姿势和派生状态，同时创建新 branch/revision。当前候选结果清空；后台 participant 保留同一 Session ID，并记录待回退的闭合回合边界。下次后台任务开始前遮蔽该边界之后的模型 Surface，然后继续使用原 Session。

### 重新生成正文

它不是新回合，而是替代事务：

1. 读取被替换正文的 `before` checkpoint，但暂不改变 HEAD；
2. 基于该 checkpoint 生成替代正文；
3. 失败则结束 operation，权威状态零变化；
4. 成功则一次恢复 `before`、提交替代正文、推进游标一次、创建新 branch/revision、清空旧候选并重新安排结算。

### 状态结算

状态结算以正文 revision 为输入，只能提交该任务获准的派生字段。正文变化时，在途结算自动 stale；正文替代成功后重新运行。它与候选任务串行复用后台 Agent，但不会因此获得候选任务的 `point` 权限。

## DSH Session 投影

DSH Session 是追加式事件日志，同时提供可替换的模型 Surface。后台 participant 的 checkpoint 记录其 Session ID 与闭合边界：

```js
{ sessionId, branchId, syncedRevision, boundary, status }
```

- 正常向前推进：候选与结算恢复同一个后台 Session。
- 回退到早期 checkpoint：恢复同一个 Session，以空消息 `surface replace` 遮蔽边界之后的消息节点。
- 重新生成正文：替代正文成功后，同样在下一次后台任务前回退 Surface，再处理新正文。
- 没有可用后台 Session 的旧对话：用权威 snapshot 初始化一次，此后固定复用该 Session。
- 旧版 checkpoint 丢失直接来源时：只向更早 checkpoint 查找最近的有效闭合边界，不读取废弃分支内容反推状态。

前台与后台使用同一种回退语义：Tavern checkpoint 恢复权威领域状态，DSH `surface replace` 恢复模型面。底层追加式事件仍保留用于审计，但不再参与后续模型上下文。

## 一致性与失败恢复

以下 outbox 是跨进程强一致性的后续加固目标，不是第一阶段已经完成的能力。第一阶段已经落地 canonical revision、operation 持久化、迟到结果拒绝和后台 Surface 回退；DSH surface 投影仍由宿主在同一次 RPC 中立即执行。

JSON chat 与 DSH Session 不能形成真正的跨存储 ACID 事务。提交顺序固定为：

1. 在 Tavern 中记录 operation；
2. compare-and-swap 提交 canonical checkpoint/revision；
3. 同一提交写入待执行的 projection outbox；
4. Session Adapter 执行 Surface 遮蔽或导航更新；
5. 确认 outbox。

投影失败不回滚已经提交的 canonical revision，而是显示 `sync-pending` 并在重启或下次访问时重试。相同 request/operation 必须幂等。

## 错误模式

- `STALE_REVISION`：结果依据已过期，丢弃结果。
- `OPERATION_CANCELLED`：工作被回退或替代抢占。
- `INVALID_AGENT_RESULT`：输出格式或领域效果非法，权威状态不变。
- `NOTHING_TO_ROLLBACK`：没有可恢复 checkpoint。
- `CHECKPOINT_MISSING`：老数据不足以安全执行破坏性操作。
- `PROJECTION_PENDING`：权威状态已提交，DSH 投影等待重试。
- `IDEMPOTENCY_CONFLICT`：同一 operation 对应了不同输入。

## 兼容与迁移

旧对话首次读取时惰性建立 baseline timeline。现有 `nativeCommits` 转为 checkpoint 输入；现有 `candidateAgent.sessionId` 作为 legacy 后台 participant 绑定，上一版 timeline 中的 `candidate` participant 也会改名为 `background`。旧版 `needs-branch/forkFrom` 会迁移为同一 Session 的 `needs-rewind/rewindTo`；直接来源已经丢失时，向更早 checkpoint 恢复最近有效边界。

checkpoint 初期保存完整领域快照并保留最近 40 个。以后可以在 Store Adapter 内改成增量与周期快照，不改变 Story Timeline 接口。

## 验收矩阵

- 正常连续正文：revision 单调增加，游标每次只前进一块。
- 同正文反复候选重生成：复用同一后台 Session。
- 连续回退：每次恢复完整 checkpoint，不创建无用 Agent。
- 正文反复替代：每次游标只提交一次，失败零变化。
- 候选运行中回退：候选结果 stale，`point` 不落盘。
- 状态结算运行中回退：结算结果 stale，checkpoint 姿势保留。
- 回退后重新生成候选：Session ID 不变，checkpoint 之后的废弃正文不在模型 Surface 中。
- 服务重启后重复 operation：不重复写正文、不重复推进游标。
- DSH 投影失败：canonical 状态保持，outbox 可重试。

## 当前落地范围

已实现：完整 checkpoint、单调 revision、新分支回退、正文替代只推进一次、候选/结算迟到结果作废、整条 Tavern 对话复用一个后台 Session、回退后从闭合回合边界遮蔽模型 Surface、旧对话从 `nativeCommits` 惰性迁移。上一版的 `candidate` participant 会惰性迁移为 `background`，旧版派生状态会迁移为 Surface 回退状态。

后续加固：文件 Store 的跨进程 CAS、持久 projection outbox、compact 后 Surface 回退能力的显式检测。这三项不影响当前单进程 Tavern 的时间线正确性，但在多进程写入、DSH 投影中途崩溃或目标边界已被 compact 时仍需要恢复机制。
