# dsh-tavern 提示词与输入输出审查报告

- 审查基线：`6dbe54e`（refactor: remove body polish pass）
- 审查时工作区干净（仅 `output/` 未跟踪），`npm test` 11/11 通过
- 状态：**已人工复核并实施**
- 实施范围：P0-1 ~ P0-5、PR-1 ~ PR-7、IO-1 ~ IO-6；IO-7 仅删除旧 settings 覆盖，保留 `nativeCommits`

## 实施结论

- 候选项改用独立提示，不再复用“只输出小说正文”的 `buildSystem`。
- persona 只保留 `context → 按 systemContext 生成 → commit` 流程；重新生成文案与 UI 一致。
- 选择 P0-2 方案 B：删除无前端入口的 `settings.json` 模型覆盖与 RPC，统一使用当前会话的原生模型选择器。
- 选择 P0-4 方向 1：注入模型前统一把 `{{char}}` / `{{user}}` 替换为实际卡名 / “你”；卡片编辑中仍保留模板变量。
- 姿势结算、卡片 JSON、工具描述和候选任务已精简；未使用返回字段、双份候选输出与死状态已删除。
- 额外复核发现 extract 提示使用了不存在的 `draftPatch` 名称，已统一为工具真实参数 `cardPatch`。
- `nativeCommits` 不按原报告建议裁剪：它不只服务回退，还用于同一 DSH turn 重复调用 `context` 时复用原剧本块，保证幂等与上下文一致。

> 以下保留审查基线上的原始问题、建议与采纳记录；位置和“现状”描述均指修改前的 `6dbe54e`。

## 0. 审查基线的环节结构

| # | 环节 | 提示词位置 | 输入 | 输出 |
|---|---|---|---|---|
| 1 | 正文生成（story/script） | `presets/tavern/agent.cordis.yml` persona（约 1530 字）+ `tavern_session` 返回的 `systemContext`（`buildSystem`，`index.js:1137`）+ 工具描述 | 用户消息 → context（人物卡/姿势/Guide/世界书/剧本块）→ 历史 | 正文，commit 后结算 posture |
| 2 | 候选项生成 | `generateChoices`（`index.js:834`），独立模型调用，复用 `buildSystem` 再追加任务 | system + 最近 30 条消息 + 上一段结尾 + guidance | 4 action + 1 scene（剧本模式 1 个）+ scriptCursor |
| 3 | 世界书检索 | `selectWorldBookEntries`（`index.js:1077`），独立调用 | system 一句 + 最近 8 条 + 本轮输入 + posture + 条目（各截 160 字） | 最多 3 个条目 ID |
| 4 | 姿势结算 | `settleSystemPrompt` / `runSettlement`（`index.js:1243/1336`），独立调用 | system + 当前姿势 + 最近 4 条消息 | `{"posture":"..."}` |
| 5 | 卡片编辑 revision | persona 第 4 条 + context 动态 systemContext（`index.js:1997`） | 当前人物卡全字段 JSON + 剧本提示 | 讨论回复 + cardPatch |
| 6 | 素材抽取 extract | persona 第 4 条 + `buildExtractSystem`（`index.js:1439`） | 草稿全字段 JSON + 每轮 6 块素材 | 讨论回复 + draftPatch |
| 7 | 重新生成正文 | `regenBody` 合成消息（`index.js:1579`） | 原玩家输入 + guidance 组成合成消息 | 替换后的正文 |

---

## 1. 矛盾 / 误导（建议先修）

### P0-1 候选项生成的系统提示自相矛盾

- 位置：`tavern-plugin/lib/index.js:869-875`
- 现状：候选生成先复用 `buildSystem`，其中第一句是：

  > 你是小说续写引擎，只输出小说正文，不要解释、点评或元信息……

  随后又追加：

  > 【额外任务】……只输出 JSON……

- 问题：同一个 system 里“只输出正文”与“只输出 JSON”直接冲突。候选的解析失败、需要多次容错（`parseJsonLenient` / `extractChoicesArray` / `parseChoiceObjects`）很可能与此有关。
- 建议：候选生成不再复用正文 `buildSystem`。抽取公共上下文数据块（世界书、posture、Guide、人物卡、剧本块），候选使用独立的候选任务提示头。
- 影响：只影响候选生成路径，不动正文路径。
- 风险：需要重新组织 `buildSystem`；候选生成后建议实测 3~5 次。
- 确认：☑ 采纳　☐ 不采纳

### P0-2 persona 与 UI/代码行为矛盾

- 位置：`presets/tavern/agent.cordis.yml:16`
- 现状：
  - persona 写“重新生成由 DSH 原生重试完成”，但 UI 有独立“重新生成正文”按钮（`client.js:1025`），后端有 `regenBody`（`index.js:1540`）。
  - persona 写“切换模型使用原生模型选择器”，但 `modelSelection`（`index.js:90-92`）会优先读取 `data/settings.json` 的 provider/model 覆盖原生选择；且 `getSettings/updateSettings` 没有前端入口。
- 建议：
  - 方案 A（推荐）：persona 末句改为与真实功能一致，例如“重新生成正文由界面按钮完成；模型使用当前会话的原生选择器”。
  - 方案 B：保留原生选择器为唯一入口，删除 `modelSelection` 里的 settings 覆盖和 get/updateSettings RPC。
- 影响：只改文案（方案 A）或删死配置（方案 B）。
- 风险：低。
- 确认：☐ A　☑ B　☐ 不采纳

### P0-3 extract 提交反馈文案错误

- 位置：`tavern-plugin/lib/index.js:1890`
- 现状：extract 模式保存草稿时，render 返回“故事状态已更新”。
- 问题：与卡片抽取模式语义矛盾，模型可能误以为保存了故事状态。
- 建议：改为“卡片草稿已保存”/“卡片草稿未改动”（与 revision 分支对称）。
- 影响：只改模型可见文案。
- 风险：无。
- 确认：☑ 采纳　☐ 不采纳

### P0-4 `{{char}}` 替换规则不一致（潜在质量 bug）

- 位置：`tavern-plugin/lib/index.js:68-71、1148、1151、631、1999`；`presets/tavern/agent.cordis.yml:13`
- 现状：
  - `buildSystem` 首轮把 description / mes_example 的 `{{char}}` 替换为字面量“所有其他角色”，`{{user}}` 替换为“你”。
  - system_prompt / post_history_instructions 原样保留 `{{char}}/{{user}}`。
  - revision 提示又要求“保留 {{char}}、{{user}} 模板变量”。
- 问题：替换规则不一致。`mes_example` 的 `{{char}}:` 会变成“所有其他角色: *阿芙拉……*”，示例失真，可能影响文风。
- 建议（需要你定方向）：
  - 方向 1：统一替换为“实际角色名 / 你”；
  - 方向 2：统一保留模板变量；
  - 方向 3：只修 mes_example 的 `{{char}}` 替换为角色名，其余不动。
- 影响：影响首轮上下文生成质量。
- 风险：低，但需要实测首轮效果。
- 确认：☑ 方向 1　☐ 方向 2　☐ 方向 3　☐ 不采纳

### P0-5 候选项提示与真实注入内容不符

- 位置：`tavern-plugin/lib/index.js:857` 对 `tavern-plugin/lib/index.js:1145-1151`
- 现状：候选任务说“你已能看到……人物卡信息”，但 `buildSystem` 从第二轮起只注入角色名；description/personality/scenario/文风示例仅首轮注入。
- 问题：提示有误导，模型看到的人物卡信息与预期不符。
- 建议：改述为“人物卡首轮信息 + 历史上下文”；或明确决定后续轮是否补注入卡片摘要。
- 影响：只改文案。
- 风险：低。
- 确认：☑ 采纳　☐ 不采纳

---

## 2. 提示词冗余（收益最大）

### PR-1 persona 第 3 条与 systemContext 几乎全文重复

- 位置：`presets/tavern/agent.cordis.yml:12` vs `tavern-plugin/lib/index.js:1139-1157`
- 现状：persona 第 3 条复述“标记规则 / 指令是引导 / 玩家不是上帝 / 不重复上一段 / 剧本成稿要求”等，`buildSystem` 已有几乎相同内容。
- 建议：persona 只保留流程控制，例如：
  - 1. 先调 `tavern_session action=context`（userText=用户原文）；
  - 2. `ready=false` → 提示选卡；
  - 3. 严格按 systemContext 执行；回复写好后调 `action=commit`（卡片模式按 systemContext 填 cardPatch）；
  - 4. 最终回复只输出 assistantText。
  - 所有模式规则只留在 systemContext 一处。
- 预计：persona 从约 1530 字缩到 300~400 字；每轮主会话都省 token。
- 风险：persona 变短后需要 smoke 验证流程稳定性。
- 确认：☑ 采纳　☐ 不采纳

### PR-2 persona 第 4 条与 revision/extract systemContext 重复

- 位置：`presets/tavern/agent.cordis.yml:13` vs `index.js:1997`、`index.js:1444-1449`
- 现状：“不角色扮演、不续写剧情”“只有用户明确确认时才最小 patch、只讨论 {}”在两处重复。
- 建议：并入 PR-1，persona 不再复述，只保留“卡片模式按 systemContext 执行，commit 时填 cardPatch”。
- 风险：低。
- 确认：☑ 采纳　☐ 不采纳

### PR-3 剧本相关提示重复 4 处

- 位置：`index.js:1875`（工具描述）、`index.js:1990`（scriptLookHint）、`index.js:1157`（buildSystem）、persona 第 3 条
- 现状：“游标由候选调整、commit 不推进、action=script 前瞻/查看”在 4 处重复。
- 建议：工具描述保留一句；buildSystem 保留成稿要求；删除 scriptLookHint 或缩成一句“commit 不推进游标；需要前后文用 action=script”。
- 风险：低。
- 确认：☑ 采纳　☐ 不采纳

### PR-4 候选项任务冗余

- 位置：`index.js:850-881`
- 现状：
  - `task`（system）与 `baseRequest`（user）重复描述同一任务；
  - guidance 注入两次（system taskSystem + user 消息）；
  - `latestTail` 上一段结尾与 `buildMessages` 的最近 30 条历史重复；
  - script 模式 task 555 字，story 模式 269 字。
- 建议：随 P0-1 建独立候选提示：任务只写一处，guidance 只注入一次，上一段结尾只保留一处；目标 script 模式约 250 字、story 模式约 180 字。
- 风险：需实测候选 JSON 输出稳定性。
- 确认：☑ 采纳　☐ 不采纳

### PR-5 结算提示词与输出上限冗余

- 位置：`index.js:1243-1248`、`index.js:1352`、`index.js:1363`
- 现状：结算 system 228 字；`maxTokens: 8000`（实际只需要一句话 JSON）；`lastSettle.raw` 保存 800 字原始输出，`console.log` 也打 800 字。
- 建议：system 压到约 130 字；`maxTokens` 改 300~400；`lastSettle.raw` 删除或缩到 200。
- 影响：每轮后台结算都省 token 和磁盘日志。
- 风险：低。
- 确认：☑ 采纳　☐ 不采纳

### PR-6 extract/revision 全量 JSON 每轮注入空字段

- 位置：`index.js:1450`、`index.js:1997`
- 现状：`JSON.stringify(draft/editable)` 每轮注入 9 个字段，即使全部为空。
- 建议：只输出非空字段；空草稿显示“暂无已确认内容”；字段清单仍由上面的提示词提供。
- 影响：空草稿阶段省最多；内容多时差异小。
- 风险：低。
- 确认：☑ 采纳　☐ 不采纳

### PR-7 工具描述与 script 返回 hint 重复

- 位置：`index.js:1875-1883`、`index.js:1934`、`index.js:1947`
- 现状：工具描述教一遍 action=script 用法，script-read 返回的 hint 再教一遍，persona/systemContext 还教一遍。
- 建议：工具描述压缩到一句；删除 hint，或只保留“可继续读取其他分块”。
- 风险：低。
- 确认：☑ 采纳　☐ 不采纳

---

## 3. 输入输出冗余（不改业务行为）

### IO-1 `tavern_session context` 返回模型看不到的字段

- 位置：`index.js:1964-1966`、`index.js:1999-2001`、`index.js:2003-2005`
- 现状：返回 `opening / posture / lore / scriptCursor / scriptTotalChunks`，但 render（`index.js:1888-1892`）只输出 `mode / cardName / systemContext`；posture 已包含在 systemContext，opening 已在原生开场白，lore 恒为空。
- 建议：删除这些返回字段。
- 风险：无（按当前 render 逻辑模型不可见）。
- 确认：☑ 采纳　☐ 不采纳

### IO-2 `view` 携带全量历史等未使用字段

- 位置：`index.js:636-662`
- 现状：`view` 返回 `messages`（全量聊天历史）、`lore`、`pending`、`lastSettle`、`settleError`、`group`，客户端（`client.js`）均未读取；`messages` 在长会话下每次 `getSession` 轮询都完整传输。
- 建议：删除上述字段；`settleError` 如需调试可保留但不再进 view。
- 风险：低；需确认没有外部 API 消费者依赖这些字段。
- 确认：☑ 采纳　☐ 不采纳

### IO-3 `cardViewOf` 冗余字段

- 位置：`index.js:613-614`、`index.js:631-632`
- 现状：`opening`、`alternateGreetings` 两个字段，客户端使用的是 `first_mes` 和 `alternate_greetings`。
- 建议：删除。
- 风险：无。
- 确认：☑ 采纳　☐ 不采纳

### IO-4 候选项 RPC 双份输出

- 位置：`index.js:1816-1818`、`index.js:983-997`、`client.js:987-988`
- 现状：`generateChoices` 返回 `{choices, candidates}`（candidates 里又含 choices），客户端只用外层 `choices`；`getChoices` 却返回 `{candidates}`，接口不一致。
- 建议：统一为 `{candidates}`；客户端 `generateChoices` 调用处同步改 1 行。
- 风险：低。
- 确认：☑ 采纳　☐ 不采纳

### IO-5 列表输出冗余

- 位置：`index.js:1000-1016`、`index.js:482-485`
- 现状：`listSessions` 的 `messageCount / group`，`listCards` 的 `description / tags / importedAt`，列表 UI 未使用；详情由 `getCard` 提供。
- 建议：列表只返回 UI 需要的字段。
- 风险：低；需确认没有外部 API 消费者。
- 确认：☑ 采纳　☐ 不采纳

### IO-6 死状态 / 死字段

| 字段 | 位置 | 现状 |
|---|---|---|
| `scriptState.lookahead / lookaheadTurn` | `index.js:1195-1196、1912-1922` | 只写入从未读取，还存整块剧本 |
| `chat.pending` | `index.js:560、1746、2039、2057、2081` | 只会被置 null，从未被赋值 |
| `chat.lore` | `index.js:558` | 结算注释已声明不再维护，仍传进 view |
| `scriptProgress.skippedCount` | `index.js:661` | UI 只显示 recalledCount |
| `awaitingScene` | `index.js:561、1628-1637` | 只维护，不再注入任何提示词 |

- 建议：删除上述死状态及相关代码；`skippedChunkIds` 如无内部消费可一并评估。
- 风险：低~中，需要逐项确认后小步提交。
- 确认：☑ 全部采纳　☐ 部分采纳（注明项）　☐ 不采纳

### IO-7 存储冗余

- 位置：`index.js:1394-1404`（nativeCommits）、`data/settings.json`
- 复核后现状：
  - `nativeCommits.scriptReference.text` 不只用于回退。`nativeCommitFor` 会在同一 DSH turn 重复调用 `context` 时复用已提交的剧本参考，完整文本可避免剧本文件变化后同一轮上下文漂移。
  - `data/settings.json` 已无前端入口；其 provider/model 覆盖还会与当前会话的原生模型选择器冲突。
- 实施：删除 settings 读写、覆盖与 RPC；保留 `nativeCommits` 现有结构。如以后需要减小存储，应单独设计“按 scriptVersion + chunkId 重建参考”的迁移与幂等测试。
- 确认：☑ 只清理 settings　☑ 保留 nativeCommits

---

## 4. 不建议随本次改动的内容

- 候选历史窗口 30 条、素材每轮 6 块、世界书条目截 160 字：这些是功能参数，想省 token 应另行实验。
- 世界书 LLM 检索 + 关键词兜底流程：保留，不做行为改变。
- `nativeCommits` 存储裁剪：需要单独设计剧本参考重建和幂等回归，本次保留。

---

## 5. 原实施包建议（已按上述结论执行）

### 包 A（低风险：矛盾修复 + 提示词瘦身）
P0-1 ~ P0-5 + PR-1 ~ PR-7

- 预计 persona 1530 → 300~400 字；候选/结算/工具 hint 明显缩短。
- 需要同步修改 `tests/polish-removal.test.mjs`：它当前断言 persona 含“正文要直接写出成稿”“写完后直接调用 action=commit”，精简 persona 后这两句应改到 `index.js`（buildSystem / 工具动作）上断言。

### 包 B（结构性：I/O 清理）
IO-1 ~ IO-7

- 纯字段/死代码清理，不改业务行为。
- 建议逐项小步提交，每步跑 `npm test` + smoke。

### 包 C（单独决定）
- P0-2 方案 B（删除 settings 覆盖模型选择）
- P0-4 `{{char}}` 替换方向
- IO-7 nativeCommits 存储裁剪

---

## 6. 验证方式

1. `npm test`
2. 启动 `dsh-tavern`，逐模式 smoke：
   - story：首轮正文、候选项 5 个、姿态结算
   - script：候选项 1 个 + scriptCursor、正文召回、action=script 前后看
   - revision：讨论不落盘、确认后落盘
   - extract：素材注入、草稿更新、保存
   - regenBody、rollbackTurn 各一次
3. 检查长会话下 `getSession` 返回体是否明显减小。
