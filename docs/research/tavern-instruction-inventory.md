# 酒馆指令清单与 dsh-tavern Runtime 翻译计划

> 状态：调研与目标语义。本文不改变运行代码。
>
> 范围：人物卡能够携带、扩展脚本能够调用，并会改变一次游玩行为的指令面。SillyTavern 面板中的全部管理命令和数百条 slash command 不逐条抄录；`triggerSlash()` 作为一个开放命令入口单独处理。

## 结论

“酒馆指令”不是一种统一格式，而是分散在人物卡、预设、世界书、正则、宏、酒馆助手、ST Prompt Template 和 MVU 中的一组行为约定。它们至少分为六类：

1. **上下文贡献**：告诉模型本轮需要知道什么；
2. **文本变换**：在发送前或显示前改写文字；
3. **状态行动**：读写变量、消息、swipe 和世界书；
4. **生命周期反应**：在发送、回复、切换 swipe 等时机运行脚本；
5. **语义任务**：再次调用模型完成变量分析、候选生成等工作；
6. **界面呈现**：生成 HTML、iframe、按钮、状态栏和媒体界面。

因此，游玩模式不能把所有酒馆资源重新拼成一份 `messages[]`，也不能把所有内容都塞进 `ForegroundFrame`。正确翻译是：

```text
Tavern Compatibility Runtime
  识别来源格式并产出语义指令
        ↓
dsh-tavern Runtime
  ├── ForegroundFrame：本轮给前台 Agent 的新输入
  ├── BackgroundTaskFrame：后台 Agent 的语义任务（后续实现）
  ├── Harness：确定性状态和时间线行动
  ├── Presentation：显示与交互行动
  ├── Compat-only：只能在完整酒馆兼容模式忠实执行
  └── Ignored：游玩模式明确忽略并记录诊断
```

这张翻译表描述的是**语义结果**，不是要求 dsh-tavern 复刻 SillyTavern 的内部调用顺序。

## 术语和边界

### 什么算“指令”

本文把能够影响上下文、状态、时间线、模型调用或显示结果的字段、标签、脚本调用和事件订阅统称为“酒馆指令”。例如：

- 世界书条目的 `keys` 是激活条件，`content` 是上下文贡献；
- 正则的 `findRegex`、`replaceString` 和 `placement` 合起来是一条文本变换指令；
- `setChatMessages()` 是时间线写行动；
- `generateRaw()` 是一次新语义任务；
- `MESSAGE_SWIPED` 是一个生命周期触发点。

头像、作者名、标签、收藏状态等纯管理元数据不算运行指令；图片 URL 本身是资源引用，只有在 HTML/脚本要求呈现或预取它时才形成 Presentation 行动。

### 翻译目标

| 目标 | 含义 |
| --- | --- |
| `FG` | 写入本轮唯一的 `ForegroundFrame`，追加到持续的前台 DSH Session |
| `BG` | 创建 `BackgroundTaskFrame`，交给持续的后台 DSH Session；本文只设计，不实施 |
| `H` | Harness 立即执行的确定性查询、校验、提交或时间线行动 |
| `P` | Presentation Runtime 的 HTML、媒体、按钮和显示投影 |
| `C` | 只在“兼容（实验性）”中忠实执行；游玩模式不模拟 |
| `I` | 游玩模式明确忽略，并记录来源、原因和建议 |

一个指令可以有多个目标。例如输出正则既可能产生正文清洗结果，也可能产生 Presentation HTML。

## 一、SillyTavern 原生资源

### 人物卡

SillyTavern V2 人物卡把角色上下文、开场、嵌入世界书和扩展字段装在同一个数据包中；字段基线见官方 [`char-data.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/char-data.js#L48-L82)。

| 来源语义 | 酒馆行为 | 游玩模式翻译 | 目标 | 当前状态 |
| --- | --- | --- | --- | --- |
| `name`、`description`、`personality`、`scenario` | 定义角色、性格和场景 | 合并为有来源标识的 `cardContext`；只在开局或卡片 revision 改变时完整贡献，普通轮只投影必要摘要 | FG | 已有文本投影，待正式 Frame 化 |
| `mes_example` | 作为示例对话参与提示词 | 译为角色表演规则或示例引用，不伪造为历史消息 | FG | 待改造 |
| `system_prompt` | 可覆盖预设 main prompt | 译为卡片级高优先写作/角色规则 | FG | 兼容模式已支持；游玩语义待收敛 |
| `post_history_instructions` | 可覆盖 jailbreak / 历史后指令 | 译为本轮写作规则；不再放到“历史之后” | FG | 兼容模式已支持；游玩语义待收敛 |
| `first_mes`、`alternate_greetings` | 建立第 0 楼及其 swipes | 创建/选择开场时间线节点；它们是故事数据，不是每轮提示词 | H + P | 已有开局与 swipe 支持 |
| `creator_notes`、tags、作者、版本 | 管理和说明信息 | 默认不进入 Agent；只有显式标为运行规则时才贡献 | I / FG | 需显式策略 |
| `character_book` | 卡片内嵌世界书 | 导入为 Worldbook 资源，再走世界书翻译 | H | 已有导入能力 |
| `depth_prompt` | 按指定深度插入角色提示 | 内容可译为本轮规则；精确深度不复刻 | FG；深度为 C | 待改造 |
| `regex_scripts` | 卡片级文本变换 | 进入正则管线 | H + P | 已有主要语义 |
| Tavern Helper scripts 等非标准扩展 | 随卡携带程序 | 进入受控脚本 Runtime；脚本产生的调用再逐条翻译 | H / P / BG / C | 部分兼容 |

原则：人物卡是**应用程序包的清单**，不等于一段提示词。开场、世界书、正则、脚本分别进入时间线、上下文、Harness 和 Presentation。

### 预设与 Prompt Order

SillyTavern 的 Prompt Manager 支持普通提示、marker、角色、启停、绝对位置、注入深度、覆盖限制和 Prompt Order；字段见官方 [`PromptManager.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/PromptManager.js#L80-L201)。

| 来源语义 | 酒馆行为 | 游玩模式翻译 | 目标 | 当前状态 |
| --- | --- | --- | --- | --- |
| 普通 system/user/assistant prompt | 按 Prompt Order 组成请求 | 提取稳定的任务、文风和输出约束，写入 `writingRules`；不保留伪造 role | FG | 待正式 Frame 化 |
| marker：角色描述、性格、场景、示例、世界书、历史 | 在排序位置展开对应资源 | 资源分别进入 `cardContext`、`activeWorldbook` 等领域槽位 | FG | 兼容编译器已支持 marker |
| enabled / Prompt Order | 控制哪些条目参与及其顺序 | 保留启停；顺序只用于同类规则的确定性合并，不重排 Session 历史 | FG | 部分已有 |
| absolute position / injection depth / injection order | 在完整 `messages[]` 的精确位置插入 | 内容可降级为本轮规则；精确位置和历史插入只留兼容模式 | FG + C | 兼容模式已有 |
| `forbid_overrides`、卡片 prompt override | 控制人物卡能否覆盖预设 | 在资源解析阶段确定最终规则来源，并记录覆盖链 | H → FG | 兼容模式已有 |
| generation / sampling / provider 参数 | 改变一次模型请求 | 交给 DSH 模型策略；可映射的参数显式映射，不允许在 provider 边界重建请求 | H；不支持项 I | 待单独盘点 |
| 完整 Prompt Order 与历史重排 | 每次调用重新排列全部上下文 | 游玩模式不执行；需要完全复刻时使用兼容模式 | C | 已有兼容编译器 |

### 世界书

官方世界书包含关键词、选择逻辑、扫描范围、概率、分组、递归、持续/冷却/延迟以及多种插入位置；激活和位置定义见 [`world-info.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L100-L172) 与 [`world_info_position`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js#L855-L864)。

| 来源语义 | 酒馆行为 | 游玩模式翻译 | 目标 | 当前状态 |
| --- | --- | --- | --- | --- |
| constant entry | 每轮固定激活 | 作为稳定世界设定；开局完整进入，后续按 revision/Session Surface 避免重复灌入 | FG | 已有 constant 投影 |
| primary / secondary keys、AND/NOT 逻辑 | 扫描文本并选择条目 | 对本轮输入、近期正文和可用 Session Surface 做确定性激活 | H → FG | 已有简化关键词激活 |
| scan depth、匹配角色/人格/场景/作者注等 | 扩大或限制扫描语料 | 翻译为召回查询范围；不把全历史重新拼接 | H | 尚不完整 |
| probability、group、group weight/scoring | 概率触发和组内竞争 | Harness 以稳定种子决定，结果记录到 turn trace，保证重试一致 | H → FG | 尚不完整 |
| recursion、prevent/exclude recursion、delay-until-recursion | 新激活内容继续触发其他条目 | Harness 在有界轮次内求激活闭包；超限诊断 | H → FG | 游玩模式未实现 |
| sticky、cooldown、delay | 跨楼层维护激活状态 | 写入权威剧情状态/世界书读取记录；重试不得推进计数 | H → FG | 当前只有项目自定义 cooldown，非完整 ST 语义 |
| before/after character、example、Author Note、EM | 插入不同提示块 | 内容统一进入 `activeWorldbook`，保留来源和语义标签；不复刻物理位置 | FG | 计划语义 |
| at-depth | 插入历史指定深度和 role | 降级为本轮上下文；记录 `position-degraded` | FG + C | 待改造 |
| outlet | 由其他提示或扩展按名称消费 | 注册为命名上下文出口，由可识别消费者读取；无人消费则不进入 Frame | H / FG | 未实现 |
| 世界书 CRUD、绑定全局/角色/聊天世界书 | 修改资源和绑定 | 作为资源管理命令执行，不进入 Frame；要求权限和 revision 校验 | H | Helper 子集已有 |

### 宏与变量宏

SillyTavern 宏既有纯替换，也有副作用。变量宏的官方实现包括 `setvar/getvar/addvar/incvar/decvar/hasvar/deletevar` 及 global 版本，见 [`variable-macros.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/macros/definitions/variable-macros.js)。

| 来源语义 | 酒馆行为 | 游玩模式翻译 | 目标 | 当前状态 |
| --- | --- | --- | --- | --- |
| 身份/上下文宏：user、char、last message 等 | 读取当前运行环境并替换文本 | 从 Frame 构建上下文或 Session Surface 解析 | H → FG | 部分已有 |
| 时间、日期、随机、骰子、条件、trim、comment | 纯计算或带随机的文本生成 | Harness 确定性执行；随机结果绑定 frame/turn seed | H → FG | 部分已有 |
| local/chat/global/message 变量读取 | 从不同作用域取值 | 映射到明确的 DSH 状态 scope | H → FG/P | Helper/MVU 子集已有 |
| set/add/inc/dec/delete 变量 | 宏求值时产生副作用 | 生成状态事务，Frame 成功追加后再提交；失败不留半次写入 | H | 目前缺统一事务边界 |
| 未知扩展宏 | 由扩展自行注册 | 交给已注册兼容 Runtime；无法解析则保留原文并诊断 | C / I | 部分支持 |

### 正则

卡片正则字段及作用域见官方 [`RegexScriptData`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/char-data.js#L88-L102)，执行路由见 [`engine.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/extensions/regex/engine.js#L334-L376)。

| 来源语义 | 酒馆行为 | 游玩模式翻译 | 目标 | 当前状态 |
| --- | --- | --- | --- | --- |
| placement：user/AI/slash/world-info/reasoning 等 | 限定处理对象 | 翻译为输入、输出、资源或显示管线的具体阶段 | H / P | 常用 user/AI 路径已有 |
| `promptOnly` | 只改变发送给模型的投影，不改存储正文 | 输入侧写入 `projectedText`；历史消息不反复重算 | H → FG | 已有主要语义 |
| `markdownOnly` | 只改变显示投影 | 交给 Presentation，不改权威正文 | P | 已有 |
| 两者都关 | 改写实际处理文本 | 根据 placement 形成输入或输出的确定性转换 | H | 已有主要语义 |
| find/replace、capture、trimStrings、宏替换 | 执行具体文本转换 | 按卡片声明顺序执行并记录命中 trace | H / P | 已有主要语义 |
| min/max depth、runOnEdit | 按楼层深度/编辑场景启用 | 用时间线节点深度和操作类型判断 | H / P | 已有 |
| replacement 生成 HTML | 酒馆随后把结果交给 Markdown/Helper 渲染 | 正文与展示层分离；HTML 只进入 Presentation | P | 已有分层投影 |

## 二、酒馆助手 / JS-Slash-Runner

酒馆助手不是单一脚本，而是卡片脚本的运行宿主和一套高权限 API。官方类型面覆盖消息、swipe、变量、世界书、预设、角色、persona、正则、生成、事件、脚本和显示 DOM；可从提交 `4dd4b873` 的 [`@types/function`](https://github.com/N0VI028/JS-Slash-Runner/tree/4dd4b873f191accb5dd933089ddf36b846458585/%40types/function) 核对。

| API/行为族 | 酒馆行为 | 游玩模式翻译 | 目标 | 当前状态 |
| --- | --- | --- | --- | --- |
| `getChatMessages()`，读取 swipe/data/info | 查询当前聊天投影 | 从 Story Timeline/Session Surface 返回只读兼容视图 | H | 已有常用子集 |
| `set/create/delete/rotateChatMessages()` | 改消息、建楼、删楼、切 swipe | 翻译为时间线命令，必须带 branch/revision；禁止直接改 DSH 内部历史 | H + P | 仅 set/切 swipe 子集已有 |
| `get/replace/updateVariablesWith()` | 读写 global/character/chat/message/script/extension 变量 | 映射到具名状态 scope，作为原子事务提交 | H | message/chat/script 子集已有 |
| 世界书/lorebook 查询、CRUD、绑定 | 动态改资料库 | 翻译为资源仓库行动；影响下轮召回，除非脚本显式要求本轮重建 | H | 查询和有限更新子集已有 |
| preset 查询、加载、CRUD、更新 | 动态改完整提示词配置 | 兼容模式执行；游玩模式只允许修改可翻译的 `writingRules` 资源 | C / H | 游玩模式未定义 |
| character/persona 查询和 CRUD | 动态改卡片或玩家身份 | 资源管理行动；当前轮只通过新 revision 生效 | H | 未完整支持 |
| Tavern regex 查询和更新 | 动态改变正则程序 | 更新卡片/预设正则资源，下一次适用阶段生效 | H | 未完整支持 |
| `injectPrompts()` | 临时向完整提示结构注入消息 | 能表达为本轮规则时进入 FG；精确位置只能兼容模式 | FG + C | 未完整支持 |
| `generate()`、`generateRaw()`、停止生成 | 从脚本再次调用模型 | 普通前台正文生成禁止嵌套；独立语义任务转为 BG；脚本依赖完整酒馆请求时为 C | BG / C | 后台只设计 |
| generation/stream 事件 | 观察一次模型调用 | 映射到 DSH step/stream 生命周期；事件 payload 采用兼容投影 | H | 事件门已有子集 |
| message/chat/world-info/render 事件 | 在生命周期节点运行脚本 | Runtime 在对应领域事件前后分派；可修改参数的事件必须走事务 | H / P | 常用消息/MVU事件子集已有 |
| script buttons、通知、弹窗、音频 | 提供用户交互 | 交给 Presentation，并把点击翻译成 Harness command | P + H | 部分已有 |
| iframe/DOM 访问、刷新消息 | 直接操纵酒馆页面 | 只允许操作该卡片的 Presentation Surface；父页面 DOM 语义不承诺 | P / C | iframe 兼容已有，DOM 仍非完整 ST |
| `triggerSlash(command)` | 打开 SillyTavern 全部 slash 命令面 | 不逐条透传。建立 allowlist：查询/变量/消息/资源类翻译为 H；生成类为 BG；UI/服务器/未知命令为 C 或 I | H / BG / C / I | 尚无完整 allowlist |
| 任意网络、文件、浏览器全局和第三方库 | 执行通用 JavaScript | 不属于 Frame；按受信任脚本能力运行并记录来源。不可用能力应显式失败，不能静默伪造 | P / H / C | 受信任 iframe 部分兼容 |

关键约束：酒馆助手 API 返回的是“酒馆形状的数据”，但权威对象仍必须是 DSH 的 Story Timeline、资源仓库和状态仓库。兼容层只能做投影与命令翻译，不能建立第二份权威聊天历史。

## 三、ST Prompt Template

ST Prompt Template 在发送前和显示时执行 EJS，并提供变量、聊天、世界书、角色、正则和注入 API。官方 README 明确其在发送前构造动态提示、在接收后动态渲染；见提交 `9bf9bcdf` 的 [`README.md`](https://github.com/zonde306/ST-Prompt-Template/blob/9bf9bcdfa8d0d38ab1f4f7342067bc16f347d85d/README.md#L1-L23) 和 [`features.md`](https://github.com/zonde306/ST-Prompt-Template/blob/9bf9bcdfa8d0d38ab1f4f7342067bc16f347d85d/docs/features.md#L23-L37)。

| 模板语义 | 酒馆行为 | 游玩模式翻译 | 目标 | 当前状态 |
| --- | --- | --- | --- | --- |
| `<% code %>`、`<%= escaped %>`、`<%- raw %>` | 执行 JavaScript 并输出动态文本/HTML | 在限定资源、时间和输出大小的模板 VM 中执行 | H → FG/P | QuickJS 子集已有 |
| `variables`、getvar/setvar/inc/dec/del/insert | 读取或修改多层变量 | 读取状态快照，写入待提交事务；生成失败时回滚 | H | 常用 API 已有，事务待统一 |
| get chat/message/character/world-info | 读取酒馆运行数据 | 从 DSH Surface 和资源仓库提供兼容只读视图 | H → FG/P | chat/world-info 子集已有 |
| `[InitialVariables]`、`@@initial_variables` | 从世界书初始化变量树 | 创建初始状态 action，按聊天/开场 revision 幂等执行 | H | 已有 |
| `[GENERATE:BEFORE/AFTER]`、`@@generate_*` | 在最终 prompt 首尾注入 | 内容翻译为本轮规则；物理首尾不承诺 | FG + C | 尚不完整 |
| `[RENDER:BEFORE/AFTER]`、`@@render_*`、`@@message_formatting` | 在楼层 HTML 前后注入显示内容 | 交给 Presentation，不进入模型上下文 | P | 未完整支持 |
| `@INJECT pos/target/regex` | 按绝对位置、目标 role 或消息正则插入 prompt message | 能表达为规则的内容进入 FG；精确数组位置、role 和历史匹配为 C | FG + C | 未实现 |
| `injectPrompt/getPromptsInjected` 命名出口 | 生产和消费命名提示片段 | 翻译为本轮具名 context outlet | H → FG | 未实现 |
| `@@preload`、`@@only_preload` | 打开卡片/聊天时预执行 | 映射为资源加载生命周期行动，按 revision 幂等 | H | 未完整支持 |
| `@@if`、`@@private`、escape-ejs | 控制模板执行和作用域 | 在模板 VM 内忠实求值 | H → FG/P | EJS 基础已支持，decorator 未完整 |
| `@@iframe` 或 raw HTML 输出 | 隔离并呈现 UI | 交给 Presentation iframe | P | 基础 HTML/iframe 已有 |

模板执行必须先区分 `runType=generate` 与 `runType=render`。同一段 EJS 在发送和显示阶段产生不同副作用，不能把显示模板误送给 Agent，也不能在一次 DSH step 中重复执行生成模板。

## 四、MVU

MVU 官方仓库说明它是“基于酒馆助手的变量状态维护脚本”；见提交 `0a730cd4` 的 [`README.md`](https://github.com/MagicalAstrogy/MagVarUpdate/blob/0a730cd4a9b99689d1135a49b542c780b977c24c/README.md)。它实际包含初始化、更新命令解析、Schema/守卫、按 message/swipe 持久化、事件，以及可选的额外模型请求。

| MVU 语义 | 酒馆行为 | 游玩模式翻译 | 目标 | 当前状态 |
| --- | --- | --- | --- | --- |
| 世界书 `[initvar]`、开场 `<initvar>` | 建立初始 `stat_data`；开场块可覆盖角色世界书初值 | 创建开场状态，分别保存每个 greeting swipe 的初始快照 | H | 已有主要语义 |
| `stat_data`、`schema`、initialized lorebooks | 保存权威变量及结构 | 映射为剧情状态快照；`schema` 是 Harness 校验规则，不作为自然语言历史 | H；投影为 FG/P | 已有主要语义 |
| lodash 命令 `_.set/insert/assign/remove/unset/delete/add/move` | 从模型文本提取并应用更新 | 解析为 typed state operations，经 schema/guard 校验后原子提交 | H | 已有主要命令；完整 schema 仍需核对 |
| JSON Patch / structured output | 以结构化补丁更新变量 | 直接转为同一 state operation IR，不保留模型输出格式差异 | H | 已有主要操作 |
| 随 AI 输出更新 | 从前台正文中提取补丁 | 回复完成后由 Harness 结算，绑定本轮 branch/revision | H | 已有 |
| 额外模型解析 | 正文完成后再调用模型生成变量补丁 | 创建 `BackgroundTaskFrame`，包含正文、旧状态、更新规则和输出契约；结果仍交给同一 Harness | BG → H | 只设计，暂不实施 |
| VARIABLE_INITIALIZED / UPDATE_STARTED / COMMAND_PARSED / UPDATE_ENDED / BEFORE_MESSAGE_UPDATE | 允许卡片脚本修正命令、守卫变量和改消息 | 映射为 Harness 事务钩子；事件处理结果参与同一提交 | H | 常用事件已有 |
| 每楼层、每 swipe variables | 切换 swipe 时恢复对应状态轨迹 | 状态 checkpoint 绑定时间线节点和 swipe；切换即改变当前 branch projection | H + P | 已有主要语义 |
| snapshot、restore、replay、cleanup | 管理和修复变量历史 | 翻译为状态时间线维护命令，必须可审计和可撤销 | H | 未完整支持 |
| `StatusPlaceHolderImpl`、display/delta data | 给状态栏显示当前/本轮变化 | 生成 Presentation 状态投影，不进入正文语义 | P | 已有主要显示链路 |
| 请求策略、重试、模型源、response format、世界书过滤 | 控制额外模型调用 | 归入未来 BG task policy；DSH 负责模型与重试，MVU 负责任务规则和结果解析 | BG | 只设计 |

官方实现中，额外模型路径会在收到 AI 回复后发起请求、把结果附加回消息，再运行同一变量解析器；源码见 [`on_message_received.ts`](https://github.com/MagicalAstrogy/MagVarUpdate/blob/0a730cd4a9b99689d1135a49b542c780b977c24c/src/function/update/on_message_received.ts)。这说明“前台更新”和“后台更新”只应在**补丁由谁生成**上不同，最终状态提交必须共用一个 Harness。

## 五、界面、HTML 与外部资源

| 来源语义 | 酒馆行为 | 游玩模式翻译 | 目标 | 当前状态 |
| --- | --- | --- | --- | --- |
| Markdown | 格式化普通消息 | 从权威正文生成显示投影 | P | 已有 |
| 正则 replacement HTML、EJS raw HTML、HTML code block | 形成状态栏、面板或 CG 界面 | 进入受信任 Presentation iframe，不进入后续 Agent 历史 | P | 已有主要链路 |
| 按钮与表单 | 调脚本、slash command 或发送消息 | UI 事件翻译为具名 Harness command；需要生成时再形成 FG/BG | P → H/FG/BG | 部分已有 |
| CG、字体、CSS、JS 的外部 URL | 运行时加载依赖 | 由静态资源代理和缓存获取，保留原 URL、内容 hash、失败诊断 | P | 已有代理/缓存，兼容环境仍在补全 |
| 状态栏、动态图鉴、动态世界书管理 | 卡片专属程序 UI | 视为卡片 Presentation 模块；其数据读写仍走 Helper/Harness API | P + H | 卡片级部分兼容 |
| 直接访问父页 DOM / SillyTavern 全局 | 借宿主内部结构实现功能 | 不进入 Frame。只有显式提供的兼容 Surface 有承诺；其余为 C 或明确失败 | C / I | 不承诺全量 |

## 六、统一翻译协议

Tavern Compatibility Runtime 不应直接返回一段“已经拼好的提示词”，而应产出带来源的语义指令。下列名称是设计词汇，不是当前代码接口：

| 指令族 | 例子 | dsh-tavern Runtime 行动 |
| --- | --- | --- |
| `context.*` | `context.card.contribute`、`context.worldbook.activate`、`context.rules.contribute` | 收入当前 `ForegroundFrame` 的对应领域槽位 |
| `transform.*` | `transform.input.regex`、`transform.output.regex`、`transform.template.render` | Harness 在声明阶段执行一次，结果进入 FG 或 P |
| `state.*` | `state.variable.set`、`state.mvu.applyPatch`、`state.worldbook.update` | 在 branch/revision 上执行事务并产生提交回执 |
| `timeline.*` | `timeline.message.update`、`timeline.swipe.select` | 修改 Story Timeline，不修改 DSH 内部消息数组 |
| `lifecycle.*` | `lifecycle.message.received`、`lifecycle.swipe.changed` | 在固定领域节点向脚本 Runtime 分派事件 |
| `task.*` | `task.mvu.analyze`、`task.candidates.generate` | 创建未来的 `BackgroundTaskFrame` |
| `presentation.*` | `presentation.html.mount`、`presentation.asset.prefetch` | 更新 Presentation Surface |
| `compat.*` | `compat.prompt.injectAtDepth`、`compat.slash.execute` | 仅兼容模式执行；游玩模式诊断降级或忽略 |

Dispatcher 的输出不是新的 `ForegroundCompatibilityPlan`。它直接调用 FrameBuilder、Harness、Presentation 或兼容路径的窄接口；翻译表只在 Dispatcher 内有一个权威实现。

## 七、前台里程碑的实施顺序

当前只建设前台 Frame，按以下顺序推进：

1. **固定指令分类与诊断格式**：每条指令都有 source、kind、target、status 和 degradation reason；
2. **Frame 上下文贡献**：人物卡、已激活世界书、当前 MVU 状态、Guide、剧本引用和可翻译写作规则；
3. **一次性输入投影**：宏、EJS generate 模板和 user-placement 正则只在 Frame 构建时执行一次；
4. **隔离请求边界**：游玩模式不再运行 Prompt Order、历史重排或 provider request 二次投影；
5. **保持回复后链路**：输出正则、MVU 前台结算、Helper 生命周期和 Presentation 暂沿用现有行为；
6. **显式降级**：at-depth、`@INJECT` 精确位置、未知 slash command 等不伪装成功；提示用户改用兼容模式。

本里程碑不实现：MVU 额外模型、候选项生成和其他 `BackgroundTaskFrame`。但指令分类和接口必须为 BG 保留正式位置，不能再次把这些任务塞回前台正文生成。

## 八、当前代码能力与缺口

| 能力 | 当前落点 | 判断 |
| --- | --- | --- |
| 完整酒馆请求编译 | `tavern-plugin/lib/domain/sillytavern-compatibility.js` | 可作为兼容模式基线；不得进入游玩模式 |
| 运行预设与请求边界投影 | `runtime-presets.js`、`runtime-preset-lifecycle.js` | 兼容语义已有；游玩模式需收敛成 writing rules 并移除二次投影 |
| 世界书读取/简化召回 | `worldbook-resource.js`、`worldbook-recall.js` | 已支持常量、关键词和项目自定义 cooldown；尚非完整 ST 激活器 |
| 正则输入/显示投影 | `tavern-regex-display.js` | 常用语义已有，且已区分正文与 Presentation |
| MVU 初始化和前台结算 | `tavern-mvu-runtime.js`、`tavern-mvu-opening-reconciliation.js` | 主链已有；完整 schema、维护命令和额外模型仍缺 |
| EJS 模板 | `tavern-prompt-template-runtime.js` | 已有受限 QuickJS 与常用变量/chat/world-info API；decorator、注入和完整扩展 API 未齐 |
| Helper 脚本宿主 | `tavern-helper-*.js` 与客户端 iframe shim | 已支持脚本加载、常用变量/消息/世界书和事件子集；不是完整酒馆助手 |
| HTML/状态栏/CG | `reply-presentation.js` 与 iframe/static asset 路径 | 主展示链已有；ST CSS/全局/DOM 仍需按兼容面补全 |
| ForegroundFrame | 设计文档与现有 `foreground-handoff` 雏形 | 尚未成为正式领域对象 |
| BackgroundTaskFrame | 仅目标设计 | 本轮不实施 |

## 九、必须保留的两种行为

### 兼容（实验性）

- 继续每轮按 SillyTavern 语义重建完整请求；
- 忠实处理 Prompt Order、role、marker、注入深度和历史位置；
- 作为旧卡逃生通道，也是游玩模式翻译的差分基线。

### 游玩

- 每轮只向持续 DSH Session 追加一个 `ForegroundFrame`；
- Tavern 指令被翻译成 DSH 行动，不再重建完整历史；
- 无法自然翻译的精确位置语义显式降级；
- DSH 继续拥有 system、tools、历史轨迹、压缩、重试和模型调用。

两种模式追求的不是字节级相同：兼容模式追求酒馆行为忠实，游玩模式追求卡片**意图**与程序状态兼容。

## 十、待补充的专项清单

以下内容不阻塞前台 Frame，但实施对应功能前必须单独盘点：

- SillyTavern 全量 slash command 的 allowlist 与副作用分类；
- Tavern Helper 完整导出 API 的逐函数支持矩阵；
- 世界书完整概率、分组、递归和 timed effects 一致性测试；
- ST Prompt Template decorators、`@INJECT` 和 prompt outlet；
- MVU schema/zod、快照恢复与额外模型请求策略；
- 受信任脚本的网络、DOM、文件和第三方依赖能力边界。

## 参考基线

| 项目 | 固定版本 | 主要证据 |
| --- | --- | --- |
| SillyTavern | `release@8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8` | [`char-data.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/char-data.js)、[`PromptManager.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/PromptManager.js)、[`world-info.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/world-info.js)、[`regex/engine.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/extensions/regex/engine.js)、[`events.js`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/events.js) |
| 酒馆助手 / JS-Slash-Runner | `main@4dd4b873f191accb5dd933089ddf36b846458585` | [`@types/function`](https://github.com/N0VI028/JS-Slash-Runner/tree/4dd4b873f191accb5dd933089ddf36b846458585/%40types/function)、[`variables.ts`](https://github.com/N0VI028/JS-Slash-Runner/blob/4dd4b873f191accb5dd933089ddf36b846458585/src/function/variables.ts)、[`chat_message.ts`](https://github.com/N0VI028/JS-Slash-Runner/blob/4dd4b873f191accb5dd933089ddf36b846458585/src/function/chat_message.ts)、[`generate`](https://github.com/N0VI028/JS-Slash-Runner/tree/4dd4b873f191accb5dd933089ddf36b846458585/src/function/generate) |
| ST Prompt Template | `master@9bf9bcdfa8d0d38ab1f4f7342067bc16f347d85d` | [`README.md`](https://github.com/zonde306/ST-Prompt-Template/blob/9bf9bcdfa8d0d38ab1f4f7342067bc16f347d85d/README.md)、[`features.md`](https://github.com/zonde306/ST-Prompt-Template/blob/9bf9bcdfa8d0d38ab1f4f7342067bc16f347d85d/docs/features.md)、[`reference.md`](https://github.com/zonde306/ST-Prompt-Template/blob/9bf9bcdfa8d0d38ab1f4f7342067bc16f347d85d/docs/reference.md) |
| MVU / MagVarUpdate | `0a730cd4a9b99689d1135a49b542c780b977c24c` | [`README.md`](https://github.com/MagicalAstrogy/MagVarUpdate/blob/0a730cd4a9b99689d1135a49b542c780b977c24c/README.md)、[`variable_init.ts`](https://github.com/MagicalAstrogy/MagVarUpdate/blob/0a730cd4a9b99689d1135a49b542c780b977c24c/src/function/initvar/variable_init.ts)、[`update_variables.ts`](https://github.com/MagicalAstrogy/MagVarUpdate/blob/0a730cd4a9b99689d1135a49b542c780b977c24c/src/function/update_variables.ts)、[`on_message_received.ts`](https://github.com/MagicalAstrogy/MagVarUpdate/blob/0a730cd4a9b99689d1135a49b542c780b977c24c/src/function/update/on_message_received.ts) |

相关目标架构见：[Frame 与 dsh-tavern Runtime 架构](../design/frame-and-dsh-tavern-runtime-architecture.md) 与 [酒馆指令到 DSH Frame 改造方案](../design/foreground-frame-migration-plan.md)。
