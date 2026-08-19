# ADR-0001：Tavern 持有权威剧情时间线

- 状态：Accepted
- 日期：2026-08-19

## 背景

后台 Agent 改为持久 Session 后，正文回退与重生成不再只是界面消息操作。DSH Session 是追加式日志，并且可能 compact；给旧 Agent 追加“前文作废”不能保证它真正忘掉废弃剧情。与此同时，候选与状态结算可能在正文变化后才返回，旧结果会覆盖新状态。

## 决策

Tavern chat 中的 Story Timeline 是唯一权威状态，DSH 主会话与子 Agent Session 都只是某个 `{branchId, revision}` 的生产者或投影。

- 每次正文提交前保存完整 checkpoint。
- revision 只增不减；回退恢复 checkpoint 内容，但创建新 branch 和更大的 revision。
- 每个 Agent operation 绑定生成开始时的 branch/revision，提交时不一致就作废。
- 同一分支复用持久后台 Session；回退或正文替代后，从 checkpoint 记录的闭合回合边界派生新 Session。
- 旧 Session 保留轨迹，不再作为当前分支写入者。
- 候选 `point` 与候选正文原子提交，仍只能向前。

## 结果

好处：连续回退、正文替代、候选重生成和未来状态结算使用同一套规则；迟到结果不会复活；废弃剧情不会进入当前后台 Agent 的新分支。

代价：分叉后 Session ID 会变化；chat 需要保存 checkpoint、operation 和 participant 元数据；跨文件 chat 与 DSH surface 的崩溃恢复仍需后续 projection outbox 加固。

## 被否决方案

- 始终复用同一后台 Session，再发送“忽略旧剧情”：compact 后无法证明旧信息已被隔离。
- 回退时把 revision 改回旧数字：会产生 ABA，使旧异步结果重新满足版本检查。
- 为候选、姿势结算和未来 Agent 分别编写回退逻辑：规则会散落，新增角色时容易漏同步。
