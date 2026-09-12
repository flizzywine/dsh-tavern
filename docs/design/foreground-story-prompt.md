# 前台正文提示词的特殊处理

核对日期：2026-09-12。本文记录当前原生游玩模式（story/script）的实现，不代表 SillyTavern 兼容请求模式，也不适用于后台变量结算或文生图 Agent。

## 请求内容放在哪里

| 内容 | 注入位置 | 处理方式 |
| --- | --- | --- |
| 人物卡故事设定 | system | 开局保存上下文快照，形成会话稳定前缀 |
| 常驻世界书 | system | 纳入开局快照；当前模板上下文可替换常驻世界书段落 |
| 已启用、已确认的长期用户偏好 | system | 随开局上下文保存 |
| 共同创作约定 | user → assistant → user 种子对话 | 初始化会话时写入 |
| 已有正文、玩家输入 | 对话消息 | 玩家输入按本轮演出指引理解 |
| 本轮命中的世界书、现场状态、剧本参考、演出与写作规则 | 本轮附加的 user 消息 | 统一组装为 ForegroundFrame，存在相应内容时加入 |

这里的“稳定前缀”指内容和结构保持稳定，便于复用；不表示它只发送一次，也不保证供应商一定命中缓存。人物卡上下文是规划、投影后的文本，不是直接发送整个卡片 JSON；世界书也不是每轮无条件全文发送。

## 1. 替换通用助手的 system 内容

原生游玩组装 system 时，直接用酒馆的固定上下文段落替换继承的 sections，避免带入 DSH 通用助手人格和工作环境提示。正文演出规则通过本轮 ForegroundFrame 提供，并非全部放在 system。

来源：[foreground-orchestration-strategies.js](../../tavern-plugin/lib/domain/foreground-orchestration-strategies.js)，`createNativePlayOrchestrationStrategy` 内的 `assembleSystemPrompt`。

## 2. 固定故事设定，单独处理当前世界书

开局构建 `cardContextSnapshot`，包含规划后的人物卡、常驻世界书，以及启用且已确认的长期偏好。已有符合版本要求的快照优先复用；缺失或版本落后时会重建迁移。

稳定上下文拆成用户偏好、人物卡、常驻世界书等 system 段落。请求组装还会调用当前世界书模板上下文处理：`withCurrentWorldbook` 移除原常驻段落，再按当前结果放入常驻段落。因此，存在模板求值等情况时，不能把所有世界书内容都理解为永久不变的前缀。

来源：[play-card-snapshots.js](../../tavern-plugin/lib/domain/play-card-snapshots.js)、[session-stable-prefix.js](../../tavern-plugin/lib/domain/session-stable-prefix.js)、[index.js](../../tavern-plugin/lib/index.js) 的 `system-prompt/assemble`。

## 3. 用种子对话建立互动方式

会话初始化时预置三条消息：

1. 用户声明共同创作沉浸式小说；人物卡、世界书、正文和现场状态构成故事事实；后续输入是演出指引；只输出正文。
2. 助手确认按连续故事世界处理，重新组织完整场景，人物保持自身性格，只输出正文。
3. 用户要求从人物卡给定的开场继续。

这是程序写入的示范对话，不是额外调用模型生成的确认回复。写入有顺序和完整性检查，避免重复或残缺种子轨迹。

来源：[session-seed-trajectory.js](../../tavern-plugin/lib/domain/session-seed-trajectory.js)。

## 4. 玩家输入是演出指引，不是已经发生的正文

默认正文规则要求：

- 模型叙述和扮演所有角色；其他角色可以依人设拒绝、反对或打断玩家。
- 无标记输入视为人物行为；“场景变化”允许结束或开启场景。
- 承接上一段现场，完整演出玩家输入的核心意图，不能从输入结尾接着写而跳过过程。
- 不照搬整段指引的开头或叙述句式；明确指定的对白可以保留意思或必要原句。
- 同一动作和对白只演一次；避免重复之前剧情或在无意义内容上铺陈。
- 只输出小说正文，不解释、点评或输出元信息；篇幅由剧情决定。

来源：[story.md](../../tavern-plugin/prompts/story.md)。这是仓库默认规则；具体请求还可能有预设和脚本贡献的内容。

## 5. 动态世界书在正文提交后预先匹配

常规关键词匹配基于上一轮正文，在本地完成并保存下一轮上下文。下一轮准备时读取已保存的结果，不因玩家新输入或候选项选择再次触发匹配。

脚本显式提供的扫描文本单独复用匹配器；模板世界书也有独立投影处理。两者不能和常规正文关键词匹配混为一谈。

来源：[turn-orchestration.js](../../tavern-plugin/lib/domain/turn-orchestration.js)，正文准备阶段的 `worldBookContext` 组装。

## 6. 本轮材料统一组装，避免重复追加

本轮卡片上下文、命中世界书、现场状态、剧本参考、指引和写作规则按来源收集到 ForegroundFrame。适配器在第一步将有内容的 frame 作为一条 `role: user` 消息追加；按 frameId 检查重复，非第一步不再次追加。

使用官方 MVU 时，还会明确要求：“变量更新由正文提交后的后台 Agent 独立结算。只输出剧情正文，不要输出 <UpdateVariable>、JSON Patch 或变量更新说明。”

来源：[agent-input-frame.js](../../tavern-plugin/lib/domain/agent-input-frame.js)、[foreground-frame-session-adapter.js](../../tavern-plugin/lib/domain/foreground-frame-session-adapter.js)、[turn-orchestration.js](../../tavern-plugin/lib/domain/turn-orchestration.js) 的 `foregroundFrameInputs`。

## 与文生图 Agent 的区别

文生图 Agent 复用同一游戏的开局人物卡、常驻世界书和已确认长期偏好，作为自己的 system 稳定前缀。它保留独立的生图职责，不继承前台种子对话、演出规则或整份预设。为避免后续剧情污染历史配图，不使用后台结算的最新动态世界书替换；目标轮次的变化由本次材料、已保存方案和历史参考工具提供。

来源：[index.js](../../tavern-plugin/lib/index.js) 的 `resolveStablePrefix`、[background-agent-task.js](../../tavern-plugin/lib/background-agent-task.js)。

### 后台提示词对照（同日核对）

| 处理 | 结算／候选 Agent | 生图 Agent |
| --- | --- | --- |
| 系统职责 | 后台专用 persona | 生图专用 persona |
| DSH 通用运行环境 | 抑制注入 | 抑制注入 |
| 开局稳定前缀 | 人物卡、常驻世界书、已确认偏好 | 复用相同来源；首次任务写入，后续复用 |
| 当前常驻模板世界书 | 每次任务解析，任务内固定，替换常驻段落 | 不读取最新轮次替换，避免历史场景穿越 |
| 每轮输入 | 权威状态、最近剧情、任务协议作为 user 内容 | 目标场景材料、方案与任务协议作为 user 内容 |
| 人物卡额外系统／历史后指令 | 仅候选任务按字段追加到任务消息 | 不走候选专用追加逻辑 |
| 外部 Tavern 预设 | 不继承前台整份预设 | 同左 |
| 工具 | 按任务与配置提供 | 生图任务工具及只读人物设计／参考资料工具 |

注意：任务参数虽然叫 `system`，在 `backgroundPrompt` 中会进入 user 消息的“DSH 后台任务协议”段落；不要把参数名称当作实际消息角色。稳定前缀保存在会话快照元数据中，消息正文为空，system 组装时读取，避免再作为剧情文本重复发送。已有无前缀的生图会话在下一次任务时可补入前缀。

此次验证：后台 runner、稳定前缀、生图提示词及历史参考资料相关测试共 45 项通过。新增测试覆盖生图连续两次任务的 system 稳定性、三个背景段落的注入，以及不在任务正文中重复背景。此为本地模拟请求验证，未调用真实模型或图片服务。
