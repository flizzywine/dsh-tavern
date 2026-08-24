# DSH Tavern Domain

## Story Timeline

Tavern Chat 中唯一权威的剧情记录。它用单调递增的 revision、branch、checkpoint 和 operation 描述当前有效剧情；DSH Session、后台 Agent 与浏览器界面都是它的生产者或投影。

## Foreground Turn

玩家可见的一轮输入与正文回复。只有成功提交到 Story Timeline 的 Foreground Turn 才能推进剧情，并产生后续 Background Cycle。

## Background Agent

每个 Tavern Chat 共享的单一持久 Agent。它串行执行世界书召回、状态结算与候选生成，不直接拥有剧情权威。

## Background Operation

Background Agent 基于特定 Story Timeline branch/revision 执行的一项工作。运行时长本身不构成失败；operation 只有排队、运行、完成、失败、过期或取消等生命周期事实。

## Background Cycle

Foreground Turn 成功后必须依次完成的一组 Background Operation：世界书召回，然后状态结算。Cycle 完成前，下一次 Foreground Turn 与候选生成不可开始。

## Background Activity

Story Timeline 中 Background Operation 生命周期的只读投影，用于回答 Background Agent 是否空闲以及交互是否可用。它不是独立保存的第二份权威状态。

## Session Continuity

浏览器与当前 DSH runtime 中同一个 Session 的连接连续性。它负责识别 runtime 重启、恢复 Session 和保留未发送草稿，但不能决定或改写 Story Timeline 与 Background Operation。

## Projection

从权威领域状态派生、可随时重建的只读表示。DSH Session Surface、Background Activity、Tavern 状态视图和浏览器交互状态都是 Projection。
