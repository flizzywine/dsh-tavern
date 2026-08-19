# 后台 Agent 使用单 Session 与 Surface 回退

后台候选与状态结算在一条 Tavern 对话中始终复用同一个后台 Session。正文回退或替代时，Tavern 根据 checkpoint 保存的闭合回合边界，用 DSH `surface replace` 遮蔽其后的后台消息，再注入最新权威状态继续运行；不再为剧情分支派生新 Session。这与前台 Agent 的既有回退机制一致，保留连续记忆和单一轨迹，同时由 Tavern revision 校验阻止旧任务结果落盘。底层事件日志仍保留被遮蔽事件，因此 compact 后的严格物理遗忘不作保证；当前产品选择一致的模型 Surface、较低迁移复杂度和更清晰的用户体验。
