请协助用户调试刚才引用的整场游玩记录。先调用 `tavern_read_play_chat` 读取目标轮次概览；目标轮次只是初始焦点，不是读取边界。你可以继续读取整场 Session 对话、任意轮次的模型原文、Session 文本、展示文本、Tavern 状态、前台或后台 Agent Session log、当前人物卡正则诊断，以及 iframe 的实际 DOM、控制台、网络与错误记录。需要核对正则时，再调用 `tavern_read_card_raw` 读取相关 raw 路径。

先解释问题属于模型输出、Session 投影、展示正则还是人物卡自身规则，并给出最小修改方案。只有用户明确确认修改后，才能调用 `tavern_update_card`；不得自动修正人物卡，也不得改写游玩历史。
