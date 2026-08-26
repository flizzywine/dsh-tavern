# SillyTavern 与 dsh-tavern 请求差异诊断

## 2026-08-26：同输入、同模型复核

> 本节是当前最新结论，覆盖下方关于预设开关与最终消息尚未对齐的历史判断。

人物卡、预设条目开关、模型和用户输入一致时，真实 SillyTavern 的最终 provider `messages` 与 dsh-tavern 兼容模式记录的最终 `messages` 已逐字段相等：均为 3 条 `user, assistant, user`，正文长度分别为 `15092 / 995 / 563`，规范化数组 SHA-256 前 16 位同为 `6bbf0c72082406de`。兼容编译记录为 13 个选中键、10 条源消息、3 条 `strict_tools` 后消息，且无诊断错误。

仍未对齐的部分：

- 真实酒馆发送 `stream=false`；DSH 适配链固定使用流式请求。
- 真实酒馆发送 `max_tokens=65535`、`temperature=1`、`top_p=1`、`presence_penalty=0`、`frequency_penalty=0`；兼容模式调用 DSH 时只明确记录 `maxTokens=64000`。
- 真实酒馆本轮一次请求即 HTTP 200、`finish_reason=stop`；兼容模式第一次已经产生正文但以 `Stream ended without finish_reason` 结束，随后由 DSH 自动重试并成功。
- DSH 日志位于 adapter 之前，尚未取得与真实酒馆同层级的最终 HTTP body，因此不能宣称整个 wire request 已完全一致。

产品测试观察：在相同人物卡、预设、模型和供应商下，真实酒馆实际游玩未观察到内容拒绝；兼容模式仍有偶发拒绝或失败，体感成功率较低。当前证据只能把原因范围收敛到采样参数、输出长度、流式传输、自动重试或 adapter 的最终请求投影，不能归因于已经对齐的提示词正文，也不能仅凭现有样本断言某一个差异是唯一原因。

本轮证据文件仅保存在本地，不提交其中的敏感正文：

- 真实酒馆：`/Users/cf/Workspace/tools/SillyTavern/data/default-user/request-logs/chat-completions/2026-08-26T12-15-04.223Z-363f025a-4d02-4895-8769-dd3f8494b3cf.json`
- 兼容模式：`/Users/cf/.dsh/profile-data/tavern/data/model-requests/chat-mta2oey8-cdd0vh/mta2oo8c-5de0178b-8d13-45ea-aaa8-ea980c7c7e0d.json`、`mta2p5go-71082222-f7db-45db-945b-200c7fc7376e.json`

## 2026-08-26：`strict_tools` 后复核

> 状态：只做一手证据研究，未修改运行代码。以下结论优先于后文 2026-08-23 的初始诊断。
> 基线：SillyTavern 1.18.0 `release@8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`；DSH 0.1.1-rc.2；`google/gemini-3.7-flash`；Infron `https://llm.onerouter.pro/v1`。

### 新结论

`strict_tools` 本身已经对齐。把真实 SillyTavern 日志中处理前的 20 条消息交给 dsh-tavern 的 `applySillyTavernStrictTools()`，得到的 13 条消息与真实酒馆最终 provider body 的 `messages` 逐字段完全相等，完整数组 SHA-256 同为：

```text
9f37d3e3ec8a86d22c261d6da23122d2368baa3300efa75a3c2a93217f6fa74a
```

当前高优先级差异分处两层：兼容模式此前绕过了预设界面中的用户开关，重新读取导入 preset 的默认状态，实际选中了 25 条；编译后保留的首条 `system` 又会被 DSH `llm-pi-ai` 适配器改成 `user`。此外 DSH 固定流式，而真实酒馆本轮非流式；输出长度字段、数值和采样参数集合也不同。

```text
dsh-tavern strict_tools 输出
→ DSH llm-pi-ai 再投影（角色与 envelope 再变化）
→ Infron
```

### 两边证据是什么

真实酒馆明文日志：

```text
/Users/cf/Workspace/tools/SillyTavern/data/default-user/request-logs/chat-completions/
2026-08-26T08-00-08.327Z-3170b938-6177-4fd9-93d4-9d0db15c769a.json
```

该文件同时保存 `incomingRequest.body` 与 `providerRequest.body`。它由 `/Users/cf/Workspace/tools/SillyTavern/src/endpoints/backends/chat-completions.js:2601-2605` 在真正 `fetch()` 前调用 `plaintext-model-request-log.js` 的 `providerRequest()`（103-111）写入，所以是最终 HTTP body，不是 Prompt Inspector 快照。

本轮最终 provider body：13 条消息，`user/assistant` 严格交替；`stream=false`、`max_tokens=65535`、`temperature=1`、`top_p=1`、`presence_penalty=0`、`frequency_penalty=0`；无 `tools/tool_choice`；HTTP 200、`finish_reason=stop`。日志含完整敏感剧情，只用于本地哈希验证，不提交、不摘录正文。

dsh-tavern 两次连续兼容日志：

```text
/Users/cf/.dsh/profile-data/tavern/data/model-requests/chat-mt9tm6rd-6mm0ua/
mt9u1ioc-b6ef63f2-2c7c-41bc-bc7d-20a7f5f2d04d.json
mt9u1poj-67e12ab9-924f-4232-a56a-b111ee293e07.json
```

两份均记录 `postProcessing=strict_tools`、`sourceMessageCount=31`、`finalMessageCount=6`，角色为 `system,user,assistant,user,assistant,user`；request 只有 `provider/model/maxTokens/messages/sessionId`，`maxTokens=64000`，没有 temperature、top_p、penalties、stop、stream 或 tools。

注意：它只记录 `ctx.llm.stream()` 收到的 options。证据是 `tavern-plugin/lib/domain/model-request-log.js` 的 `serializableRequest()` / `record()`（12-18、29-65）。它不是 DSH adapter 转换后的最终 HTTP body。

### 已对齐项

1. **纯文本 `strict_tools` 已对齐。** SillyTavern 权威实现是 `references/SillyTavern/src/prompt-converters.js` 的 `mergeMessages()`（823-949）；dsh-tavern 实现是 `tavern-plugin/lib/domain/sillytavern-strict-tools.js` 的 `applySillyTavernStrictTools()`（52-77），调用点 `tavern-plugin/lib/index.js:2421-2428`。本次真实 20→13 消息的角色、正文和数组哈希完全一致，不只是源码外观相似。
2. **provider、模型、base URL 对齐。** DSH 配置见 `/Users/cf/.dsh/settings.yaml:45-56`，与真实酒馆最终日志相同。
3. **本轮都没有工具。** 所以工具不是本轮差异来源；真实工具轮次仍缺双边样本。

边界：当前 dsh 实现注释明确只覆盖 text-only。SillyTavern 对多模态 content 的 token/还原逻辑在 `prompt-converters.js:834-848,906-929`，dsh-tavern 尚未实现，且没有真实多模态样本。

### 确定差异

#### A. 兼容模式没有使用预设界面的用户开关（最高优先级）

对话文件 `/Users/cf/.dsh/profile-data/tavern/data/chats/chat-mt9tm6rd-6mm0ua.json` 的 `runtimePresetSnapshot.sources` 只有 5 条，分别是 `a443...`、`main`、`d07b...`、`c127...`、`jailbreak`。这些是用户在预设界面中开启的条目，也应该同时成为 DSH 前中后投影与酒馆兼容请求的唯一条目状态。

但两份兼容请求日志的 `compatibility.selectedEntryKeys` 都有 25 条，第一条就是未出现在快照中的 `0322500e-...#1`。该项在原始 preset 的 `/prompts` 中 `enabled=false`，却在解析 `prompt_order` 时被 order item 的开关覆盖；证据是 `tavern-plugin/lib/domain/preset-reading.js:124-137` 以 `item.enabled !== false` 重建 ordered entry，而兼容编译器再以 `entry.enabled===true` 选取（`tavern-plugin/lib/domain/sillytavern-compatibility.js:108-110`）。

直接原因是 `compileCompatibilityTurn()` 每轮仅从 `runtimePresetPath` 取路径，然后调用 `readPreset(presetPath)`、重新读取并解析原始 JSON（当时的 `tavern-plugin/lib/index.js:2385-2403`），没有使用 `runtimePresets.view()` 中已持久化的用户选择。

产品决策是不再建立第二套“兼容开关”。预设界面的开启/关闭是唯一 source of truth：兼容模式按酒馆顺序取用同一批已开启条目，DSH 模式再将它们投影为前、中、后。这也解释了为什么此前用户以为已经调过开关，兼容 trace 却仍保持 25 条。

#### B. 首条 `system` 被 DSH adapter 降为 `user`

兼容日志中的 strict 后角色是：

```text
system, user, assistant, user, assistant, user
```

但已安装 `/Users/cf/.nvm/versions/node/v22.22.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js` 的 `textOnlyContext()`（1139-1177）把 options.messages 中每条 `role === "system"` 转成 pi-ai `role:"user"`。兼容请求又没有把首条 system 放入 `options.system`；`tavern-plugin/lib/domain/compatibility-request.js:9-15` 只是替换 `messages`。

因此这 6 条进入 pi-ai 后确定变为：

```text
user, user, assistant, user, assistant, user
```

这不是序列化差异。SillyTavern `strict_tools` 特意保留唯一的首 system，而 DSH adapter 恰好抹掉它；相邻两条 user 也没有再次合并。

#### C. 真实酒馆非流式，DSH 固定流式

真实 provider body 是 `stream=false`，SillyTavern 因而走非流式 JSON 分支（`/Users/cf/Workspace/tools/SillyTavern/src/endpoints/backends/chat-completions.js:2611-2625`）。

已安装 pi-ai 的 `buildParams()` 固定写 `stream:true`，并加 `stream_options:{include_usage:true}`；源码：`@earendil-works/pi-ai/dist/api/openai-completions.js:512-527`。dsh-llm-pi-ai 只走 `streamSimple()`（1731-1745），兼容 options 无法把它切成 false。

运行旁证：`mt9u1ioc-...json` 的顶层 `status=completed`、`response.error=null`，但真正终止状态是 `response.finish.kind=error`，failure 为 `Stream ended without finish_reason`；随后同编译快照的 `mt9u1poj-...json` 才成功为 `stop`。这不能证明流式是唯一失败原因，但证明响应协议不等价，且该 transport 失败来自 DSH 流式链路。判断完成与否时不能只看顶层 `status`。

#### D. 输出长度和采样 envelope 不同

真实酒馆发送：

```text
max_tokens=65535, temperature=1, top_p=1,
presence_penalty=0, frequency_penalty=0
```

兼容 options 只有 `maxTokens=64000`；DSH 模型配置也固定为 64000（`/Users/cf/.dsh/settings.yaml:53-56`）。dsh-llm-pi-ai 只向 pi-ai 透传显式存在的 `temperature/maxTokens`（1738-1744），无 top_p 和 penalties 入口。

当前 base URL 的 pi-ai 默认推断还会选择 `max_completion_tokens` 而非 `max_tokens`（`openai-completions.js:1138-1152`），`buildParams()` 据此发送 64000（531-540）。所以最终是 `max_tokens=65535` 对 `max_completion_tokens=64000`，不是单纯 camelCase/snake_case。

### 仅序列化 / 日志层级差异

| 观察 | 判断 | 证据 |
| --- | --- | --- |
| DSH 日志是 `provider=infron`，酒馆是完整 URL | 同一目标的不同抽象层 | `/Users/cf/.dsh/settings.yaml:45-56` |
| DSH content 是 `[{type:"text",text}]`，带 `id/source`；酒馆 wire content 是 string | DSH 内部追踪结构；adapter flatten，`id/source` 不进入 provider | `compatibilityMessages()`：`tavern-plugin/lib/index.js:2438-2451`；dsh-llm-pi-ai `textOnlyContext()` |
| DSH `maxTokens` 与 HTTP snake_case | 单看命名是层级差异；实际字段和值属于上面的确定差异 | dsh-llm-pi-ai 1738-1744；pi-ai `buildParams()` 531-540 |
| 酒馆 `finish_reason=stop`，DSH `finish.kind=stop` | 响应投影差异 | 真实日志；`model-request-log.js:84-98` |

### 缺少样本，暂不能下结论

1. **同一完整历史的逐条消息对比。** 真实酒馆最终 13 条，兼容请求 6 条；两边共有同一条 995 字开场 assistant（SHA-256 前 16 位均为 `122bfd77c9b75cc4`），但真实样本已有六轮 assistant 历史，兼容样本只有两轮。可确认两次请求不同，不能据此确认编译器漏条目或排序错误。
2. **DSH adapter 后的最终 HTTP 明文。** 当前判断来自“实际 options 日志 + 当前已安装依赖源码”的确定性推导；还需要与酒馆同等级的 fetch 前脱敏探针，才能做最终 body 全文哈希。
3. **工具、多模态、custom body、reasoning。** 本轮双方无工具；dsh strict 仅 text-only；酒馆 include/exclude body 为空。酒馆前端虽传 `reasoning_effort=low/include_reasoning=true`，最终 provider body 没有 reasoning 字段，暂不列为差异。

### 下一步顺序

1. 让兼容模式直接使用预设界面已持久化的条目开关；与 DSH 前中后投影共用一份状态。
2. 解决或旁路 DSH adapter 的首 `system → user` 二次改写，并在 provider fetch 前验证。
3. 明确兼容模式是否必须支持 `stream=false`；若 DSH adapter 只能流式，应标成架构限制，不能宣称请求等价。
4. 投影 `temperature/top_p/presence_penalty/frequency_penalty/max_tokens`，确认 Infron 接受的长度字段。
5. 用同一开场、同一完整历史、同一输入各发送一次，对最终 provider messages 做角色、长度、逐条 SHA-256 对比；最后补工具和多模态样本。

当前前三项是：**兼容模式绕过共享的用户开关、实际沿用原始 preset 25 条；首 system 被降为 user；stream=false 对固定 stream=true。** 第四项是 `max_tokens=65535` 对 `max_completion_tokens=64000` 且采样参数缺失。在收敛这些差异并取得同条件最终 HTTP 日志前，不应把拒绝差异归因于模型随机性、预设文本无效或 Agent 架构本身。

---

## 2026-08-23 初始诊断（历史记录）

> 日期：2026-08-23  
> 状态：已完成静态请求结构对比，尚未修改实现  
> 测试对象：Gemini 3.7 Flash（Infron）、人物卡《段莹莹》、Kemini Dramatron 陨落的天才 v1.26

## 结论

预设本身已经在 SillyTavern 中验证有效。dsh-tavern 当前失败的主要原因不是“预设没有注入”，而是只兼容了预设文本，没有兼容预设的执行结构。

SillyTavern 预设不是一段普通系统提示词，而是一套带有消息角色、插入位置、动态占位、历史边界和模型参数的请求组装方案。dsh-tavern 当前把勾选条目合并成一个字符串，导致这些语义丢失。

本次两边的测试配置也不完全相同，因此现有实验还不是严格的同条件对照。

## 已确认的差异

| 项目 | SillyTavern 成功请求 | dsh-tavern 失败请求 | 判断 |
| --- | --- | --- | --- |
| 消息结构 | 22 条独立消息，保留 `user`、`system`、`assistant` | 一个系统区块和少量用户消息 | 角色语义丢失 |
| 预设顺序 | 预设前段、人物卡字段、历史、预设尾段依次排列 | 勾选条目全部合并到系统提示词最前面 | 插入位置丢失 |
| 当前实验 | 没有把整份预设再次作为普通用户消息注入 | 系统提示词已有预设，每一步又追加一份 `user` 预设副本 | 重复且角色错误 |
| 人物卡字段 | 在 DATA 区以多条系统消息展开 | 由 Context Planner 打包进本轮用户上下文 | 信息位置和角色不同 |
| 历史边界 | 历史位于 HISTORY 区，之后还有多条系统指令 | 没有等价的历史后置预设区块 | 靠近生成位置的强化指令缺失 |
| 启用条目 | 成功请求包含 DATA、HISTORY、COT、SETTING、ROLEPLAY GUIDE、continue 等结构 | dsh-tavern 只启用 4 条 | 配置不一致 |
| 额外条目 | 成功请求没有启用“牢大防截断” | dsh-tavern 启用了该条目 | 配置不一致 |
| 模型参数 | 预设配置包含 `temperature=1`、`max_tokens=65535`、`stream=false`、低推理 | 记录到 `maxTokens=64000`，由 DSH 流式调用；其余参数未按预设执行 | 请求参数不一致 |
| 对话阶段 | 成功快照已有 8 条历史消息 | 自由模式失败发生在开场后的首轮 | 输入上下文不一致 |
| 工具调用 | 不适用 | 自由模式在没有工具调用时仍然失败 | 工具调用不是根本原因 |

## dsh-tavern 失败请求的实际形态

从 DSH Session 记录确认，该次自由模式失败请求包含：

```text
system：19516 字预设合并文本 + 141 字游玩提示词
assistant：995 字开场白
user：19516 字完整预设副本
user：34 字玩家输入
user：1880 字人物卡及本轮上下文
```

同一份预设实际出现了两次：

1. 作为系统提示词最前面的单一文本区块；
2. 作为每一步临时插入的普通 `user` 消息。

这与 SillyTavern 的成功请求结构明显不同。

## SillyTavern 成功请求的结构

成功快照的角色顺序为：

```text
user, system, user,
system, system, system, system, system, system,
assistant, user, assistant, user, assistant, user, assistant, user,
system, system, system, system, system
```

可概括为：

```text
预设前段
→ 人物卡动态字段
→ 对话历史
→ 历史后的预设系统指令
```

预设角色、人物卡字段位置及历史后的系统指令都参与了最终效果，不能用一个合并后的系统字符串等价替代。

## 架构原因

当前运行时预设设计主动丢弃了执行语义：

- `Runtime Preset` 只收集各条目的 `content`；
- 条目用两个换行合并成单一 `text`；
- 原始角色只用于预设管理器展示；
- DATA、HISTORY 等占位条目不进入运行快照；
- temperature、stream、reasoning 等参数不属于当前兼容范围；
- 前台再把合并文本作为一个系统区块注入。

因此，当前实现完成的是“预设内容导入”，不是“预设运行语义兼容”。

## 建议的实现方向

### 1. 停止重复整份预设

不应继续把完整预设作为 `user` 消息追加到每一步。该实验会重复上下文，并进一步改变预设角色。

### 2. 保存有序预设条目

运行快照不应只有一个 `text`，至少需要保存：

```text
role
content
identifier
position / anchor
```

### 3. 翻译为适合追加式 Agent 的结构

不必复制 SillyTavern 的整套动态提示词组装器，可以翻译为：

```text
稳定前缀
→ 创建对话时展开的人物卡字段
→ DSH 原生追加式历史
→ 每次请求临时投影的预设尾段
```

- 历史前条目只在 Session 初始化时写入一次；
- 人物卡占位在创建对话时展开；
- 对话历史继续由 DSH 追加式 Session 管理；
- 历史后条目在每次模型请求及工具续接时临时附加，但不写入持久历史；
- 所有条目保留原始角色和顺序。

### 4. 逐步兼容模型参数

优先验证以下参数对结果的影响：

```text
stream
temperature
max_tokens
reasoning_effort
```

早期 SillyTavern 成功请求使用非流式配置，而 dsh-tavern 曾出现流式响应缺少 `finish_reason`。2026-08-26 的单变量实验已经排除“是否流式”是当前成功率差异的主要原因，见下节。

### 2026-08-26：流式单变量实验

- 真实 SillyTavern 在同一模型、人物卡和预设下，关闭流式可以成功；随后开启流式仍可成功输出。
- dsh-tavern 曾临时改为非流式直连，但该实验同时绕开 DSH 原有适配器和超时收尾，且请求参数未与 SillyTavern 对齐；请求等待约 226 秒后失败，因此不能作为审核差异证据，相关改动已撤销。
- 恢复 DSH 原生流式链路后，用户在兼容模式连续实测三轮均成功输出。持久化日志中可核验的后两轮均为单次请求直接完成：第 4 轮耗时 22.958 秒、输出 1784 字；第 5 轮耗时 25.354 秒、输出 1903 字；两轮均以 `finish: stop` 结束，无自动重试和错误。

当前结论：流式和非流式都能成功，不能再把此前偶发拒绝归因于流式传输。后续继续比较采样参数、最终供应商请求体和适配器行为。

## 下一步验证顺序

1. 从成功快照还原 SillyTavern 实际启用的条目、角色和顺序；
2. 使用完全相同的开场白、历史和当前玩家输入；
3. 捕获 SillyTavern 最终发往 Infron 的 HTTP 请求体；
4. 捕获 dsh-tavern 最终发往 Infron 的请求投影；
5. 对比消息角色、顺序、内容哈希、参数和工具续接后的结构；
6. 先做到结构等价，再进行破限效果测试；
7. 最后分别测试角色、尾部指令、流式开关等单一变量。

## 当前判断

现有实验不能证明 dsh-tavern 的 Agent 架构无法破限，只能证明当前发送给模型的请求与 SillyTavern 成功请求并不等价。

真正需要修复的是预设兼容层，而不是继续堆叠或重复破限提示词。

## 证据文件

- `docs/research/sillytavern-successful-prompt-snapshot-2026-08-23.json`：SillyTavern 成功提示词快照，仅保存在本地，不提交公开仓库；
- `docs/research/preset-bypass-test-notes.md`：此前破限实验简短记录；
- `tavern-plugin/lib/domain/runtime-presets.js`：当前预设文本组合实现；
- `tavern-plugin/lib/index.js`：前台系统提示词与逐步提醒注入位置；
- `tavern-plugin/lib/background-agent-runner.js`：后台 Agent 的预设注入位置。
