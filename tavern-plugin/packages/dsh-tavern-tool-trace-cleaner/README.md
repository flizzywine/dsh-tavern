# dsh-tavern-tool-trace-cleaner

DSH Tavern 独立插件：在不改动酒馆本体的前提下，清理前台 4 类工具调用留下的痕迹：

1. **读变量**：`tavern_read_variables`
2. **使用 Skill**：`skill`、`tavern_read_skill_reference` 以及注入的 `<skill_content>`
3. **查世界书**：`query_lorebook`（及旧名 `read_lorebook` / `list_lorebook` / `grep_lorebook` / `worldbook_list` / `worldbook_grep`）
4. **召回历史**：`tavern_recall_history`

## 清理范围

- **L1（上下文历史非破坏式过滤）**：在 `agent/pre-step` 阶段仅对**已完成的历史轮次**按 `callId` 成对剥离目标工具调用与结果消息，不修改当前正在执行的轮次，不触碰 `tvh_` / `tvc_` 合成历史调用，也不改动底层会话文件。
- **L2（正文文本残片清理）**：通过 `ctx.tavern.replyRewriter` 在流式输出前剥离 `<skill_content>`、泄漏的工具调用标签与明确的过程元叙述前缀；并在 `onTurnSettled` 通过 `editTurn` 兜底覆盖 `submit_story` 模式或流式槽位被其他插件占用的情况。

## 安装方式

将本目录整体复制到酒馆用户插件目录 `<data>/plugins/dsh-tavern-tool-trace-cleaner/` 即可自动加载并热重载，或在「本局设置」中按类开关。
