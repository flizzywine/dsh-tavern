# 候选与状态结算共享一个后台 Agent

> 状态：由确定性世界书设计部分取代。后台 Session 的生命周期与回退方式由 ADR-0003 修订。

正文生成是前台职责；候选生成和状态结算共享一个对话级持久后台 Session，减少重复注入和反复研究剧情。任务仍以不同 operation 提交：候选只能写候选与向前 `point`，结算只能写获准的派生状态。

世界书不再是 Agent 任务。常驻条目进入前台稳定前缀，非常驻条目按 Tavern 关键词规则确定性匹配后投影到下一轮正文，详见[世界书激活设计](../design/worldbook-recall.md)。因此后台 participant 不接触世界书原文，也不存在 `worldbook` operation。
