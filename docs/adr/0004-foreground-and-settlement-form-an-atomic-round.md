# 前台正文与后台结算组成原子 Round

> 状态：Accepted

正文生成和状态结算不再是两个可以交错推进剧情的独立阶段。一次正式 Round 由 Foreground Turn 和它唯一对应的状态结算组成；只有两者都成功，Story Timeline 才建立 checkpoint 并把 revision 增加一次。

前台正文生成完成后可以作为暂存结果显示，但其 body operation 保持 `foreground-completed`，不成为已提交剧情。状态结算 operation 通过 `roundOperationId` 绑定该 body operation。结算成功时，时间线在同一次提交中写入派生状态、关闭 body operation、建立 checkpoint 并推进 revision。结算失败或等待 MVU 运行时只改变该 Round 的阶段，不提交剧情；恢复后重试同一 Round。

只要最新 Round 未完成，系统拒绝下一轮正文。候选生成是对已提交剧情的只读辅助任务，不属于 Round，也不能替代状态结算。相同 Chat 的重复结算请求采用 single-flight：如果结算已经运行，调用者等待同一任务，不再暗中排一个第二次结算。

这样做的代价是后台结算变成正式剧情继续运行的前置条件，失败时用户必须重试，而不能直接进入下一轮。这个限制是有意的：它用明确等待换取前台正文、变量、姿势、checkpoint 和 Agent Session 顺序的一致性。

## 被否决方案

- 前台正文先提交，后台结算稍后追赶：下一轮或正文重生成可能在旧结算返回前推进 revision，产生迟到结果和重复结算。
- 只在客户端禁用按钮：旧客户端、重放请求和直接 RPC 仍能突破限制，不能形成领域不变量。
- 每次发现结算正在运行就追加一次 rerun：等待者被误解成新请求，正是重复结算和 revision 漂移的来源。
