# 梨园如何处理酒馆预设

本文研究 [weidu12123/Liyuan](https://github.com/weidu12123/Liyuan) 当前版本对 SillyTavern（酒馆）预设的真实处理链，目的是为 dsh-tavern 的 DSH 原生预设方向提供参考，不把梨园的宣传口径直接当作兼容性结论。

## 研究快照

- 版本：`v1.5.1`
- Commit：[`27f8daf976329a94a870cd46a988d459f0692914`](https://github.com/weidu12123/Liyuan/commit/27f8daf976329a94a870cd46a988d459f0692914)
- Commit 时间：2026-08-24 17:59:01 +08:00
- 研究范围：官方仓库源码、测试、README 与发布说明；没有采用第三方介绍。

README 写的是“预设直接导入”“变量宏、文风开关、思维链模板均生效”，v1.5.0 发布说明甚至写了“全量兼容所有预设”。但 README 同时明确排除了完整 STscript、直接改写正文和依赖酒馆 DOM 的插件。因此，下面以请求装配源码为准，把“保存了字段”与“运行时真正消费了字段”分开判断。[README](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/README.md#L53-L68) · [v1.5.0 发布说明](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/docs/RELEASE-v1.5.0.md#L1-L8)

## 一句话结论

梨园已经实现了一条可运行的“酒馆 JSON → 运行时投影 → Agent 请求”管线，其中最值得参考的是：**原始预设作为权威文档保存，运行时再按 `prompt_order`、marker 和 `chatHistory` 投影；历史前段放进 system prompt，历史后段每轮临时装配；采样参数在真正发送请求时按模型渠道投影；正则失败按单条隔离。**

但它不是完整酒馆语义：`injection_depth` 尚未消费；宏只是子集且随机宏被改成确定值；历史前段的角色被压成 system；历史后段存在角色降级并主动丢弃末尾 assistant 预填；模型参数仅覆盖少数数值键；完整 STscript 和酒馆插件运行时不支持。因此更准确的定位是：**对常见预设结构有较强的近似兼容，而不是严格兼容。**

## 真实数据流

```text
导入 ST JSON
  ↓
assets/presets/<文件名>.json
  ↓ 每轮读取；有 .liyuan/preset-override.json 时草稿优先
PresetDoc（raw 原对象 + entries 运行时投影）
  ↓
按 prompt_order 选择、开关和排序
  ↓ marker 填入角色卡 / 人设 / 常驻世界书材料
assemble()
  ├─ before：chatHistory 之前
  ├─ after：chatHistory 之后
  └─ depth：injection_position=1（目前只记录，未消费）
  ↓
before → systemPrompt
历史 → messages
当轮用户消息 + after → 请求尾部临时 messages
samplers → provider payload
  ↓
streamFn(model, { systemPrompt, messages, tools }, options)
```

最终调用点可以直接看到 `systemPrompt`、`messages`、`tools` 与采样参数投影一起交给 Agent 模型。[请求装配](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/stage/engine.ts#L675-L791)

## 逐项判断

| 项目 | 判断 | 实际行为 |
| --- | --- | --- |
| 导入与保存 | 已实现，结构保真 | 导入后保存完整 JSON 对象；运行时编辑只定点修改已知字段，未知字段继续透传。由于服务端会重新 `JSON.stringify`，这是对象结构保真，不是空白、缩进也逐字不变。 |
| `prompt_order` | 已实现，但只选一组 | 优先使用 `character_id === 100001` 的 order，否则使用第一组；order 是排序与开关的权威来源，不在 order 中的 prompt 不参与。没有 order 才回退到 `prompts` 原序。 |
| marker | 常见内置 marker 已实现 | 支持八个固定槽位；`chatHistory` 只负责切分前后，其他 marker 由梨园材料填充。未知 marker 没有材料映射。 |
| 宏变量 | 子集支持 | 支持 `char/user/lastusermessage/setvar/addvar/getvar/random/roll/trim` 与注释；变量仅在一次完整装配中跨块共享。未知宏保留原文并告警。 |
| 历史前段 | 已实现，但不是 Session 冻结前缀 | `chatHistory` 之前的内容成为 system prompt 主体；每轮按磁盘指纹重新装载，修改预设会在下一轮生效。 |
| 历史后段 | 已实现，属于临时请求材料 | 每轮重新装配，支持 `lastusermessage`，排在本轮用户原话之后，不写入剧情历史。 |
| `injection_depth` | 只解析，运行时未支持 | 会进入 `depth` 数组、排序、统计和装配报告，但没有插入最终 `messages`。源码明确标注“消费待后续里程碑接入”“尚未消费”。 |
| role | 近似支持 | before 最终只取文本拼入 system prompt，原 `user/assistant` role 消失；after 中 assistant 保留，system 降级成 user，同角色合并，末尾连续 assistant 预填被主动删除。 |
| 角色卡材料 | 部分按 marker 归位 | description、personality、scenario、dialogue examples、persona 可按 marker 位置注入；常驻世界书全部交给 `worldInfoBefore`，没有真正区分 ST 的 world-info before/after。卡的 system prompt 和 post-history instructions 还有梨园自己的独立注入位置。 |
| 模型参数 | 部分支持 | ST 原始预设只读取六个顶层数值键，再按 OpenAI、Anthropic、OpenRouter、本地模型等渠道投影；某些不接受采样参数的模型会剥离。其他预设参数不会自动进入请求。 |
| `regex_scripts` | 子集支持，且容错较好 | 读取预设和角色卡正则，顺序为 PRESET → SCOPED；区分显示侧与送模历史侧；支持捕获组、`trimStrings`、`minDepth/maxDepth`、`char/user` 宏；单条坏规则跳过。只处理 placement 含 AI 输出的规则，`substituteRegex` 非零会跳过。 |
| STscript / Tavern Helper / DOM 插件 | 未支持 | README 明确排除完整 STscript、直接改写正文及依赖酒馆 DOM/主题的前端插件；不存在酒馆插件运行时。 |

### 1. 导入、保存与热编辑

导入接口接收已经解析的 JSON 对象，写入 `assets/presets/` 并立即设为当前预设。导出则把保存的对象重新返回。因此它保留未知键和嵌套数据，但文件的缩进和空白会被重写，不是字节级原样保存。[导入与导出接口](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/server/rest.ts#L2405-L2433) · [JSON 写盘](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/server/rest.ts#L364-L368)

运行时把同一份文档拆成两层：

- `raw`：权威 JSON 对象，用于保存和未知字段透传；
- `entries`：按酒馆字段生成的运行时投影，用于装配。

面板修改不会立刻覆盖原文件，而是先写 `.liyuan/preset-override.json`；下一轮优先读取草稿，用户点击保存后才覆盖正式预设。这种“权威原文 + 临时工作副本 + 运行时投影”很值得参考。[PresetDoc 与定点写回](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/preset-doc.ts#L1-L14) · [草稿优先读取](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/server/rest.ts#L827-L850) · [保存和还原](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/server/rest.ts#L3543-L3592)

### 2. `prompt_order` 与 marker

梨园没有按 `prompts[]` 的文件顺序直接拼接。它先建立 identifier 映射，再选择一份 `prompt_order`：默认角色组 `100001` 优先，否则取第一份。order 中的 `enabled` 是权威开关；没有出现在 order 中的定义不会进入装配。[order 选择与归一化](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/preset-assemble.ts#L139-L216)

它只内建八个 marker：

- `worldInfoBefore`
- `charDescription`
- `charPersonality`
- `scenario`
- `worldInfoAfter`
- `personaDescription`
- `dialogueExamples`
- `chatHistory`

装配时，`chatHistory` 不产生文本，只把后续内容切到 after；其他 marker 用角色卡、人设和常驻世界书材料填槽。[marker 闭合集](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/preset-assemble.ts#L24-L39) · [marker 装配](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/preset-assemble.ts#L261-L317) · [marker 材料来源](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/stage/materials.ts#L261-L284)

这里有两个重要近似：

1. 只消费一份 order，没有根据当前具体角色选择角色专属 order；
2. 梨园的世界书数据没有 ST before/after position，因此常驻条目全部填到 `worldInfoBefore`，`worldInfoAfter` 通常没有材料。

### 3. 宏与变量

宏求值在一次 `assemble()` 中共享 `MacroEnv`，所以前块 `setvar`、后块 `getvar` 能贯通；关闭块完全不求值，也不会产生变量副作用；只含 `setvar` 或注释而求值为空的块不会送给模型。[宏求值器](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/preset-macro.ts#L1-L104) · [跨块求值和零字丢弃](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/preset-assemble.ts#L318-L365)

但它不是完整 Tavern 宏环境：

- 变量是一次预设装配中的临时表，不是对话 Session 变量，也没有全局变量或 message variable 语义；
- `random` 与 `roll` 被有意改成“同参数恒定同结果”，用于保持 system 前缀稳定，这与酒馆逐次随机不同；
- 清单外宏原样留给模型，同时记录 unsupported。引擎通知文字却写成“已置空处理”，与实际实现不一致，应以求值器代码为准。[确定性 random/roll](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/preset-macro.ts#L80-L101) · [未知宏保留](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/preset-macro.ts#L102-L107) · [告警文字](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/stage/engine.ts#L571-L579)

### 4. 历史前、历史后与角色

`chatHistory` 之前的片段进入 `before`，之后进入 `after`；`injection_position === 1` 的片段另进 `depth`。这是梨园预设管线最接近我们“前 / 中 / 后”设想的部分。[三路装配结果](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/preset-assemble.ts#L82-L99) · [装配分流](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/preset-assemble.ts#L261-L366)

实际请求里：

- before 只取 `.text`，拼成一个 system prompt 主体；所以 before 块原本声明的 `user` 或 `assistant` role 不再保留；
- 梨园自己的角色兜底、消息流协议、工具说明和卡作者 system prompt 还会继续追加到 system prompt；
- after 每轮整份重新装配，使 `lastusermessage` 获得当轮用户原话；
- after 作为临时 request messages 排在本轮用户原话之后，不写回剧情历史；
- after 的 system role 会变成 user，连续同角色合并，末尾 assistant 块作为预填位被整段丢弃。

这些都是有意识的 Agent 适配，但不是 SillyTavern 消息序列的严格等价物。[system prompt 组装](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/stage/assemble.ts#L240-L345) · [after 每轮重装](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/stage/materials.ts#L344-L363) · [尾部角色降级与预填丢弃](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/stage/engine.ts#L702-L766)

还有一点与我们的方向不同：梨园每轮现读预设，文件或草稿改变后下一轮立即生效。它通过文件指纹缓存减少解析开销，但没有把前段冻结为 Session 的版本化快照。因此它能“热调预设”，却不能天然保证旧 Session 的前缀复现。[每轮现读与指纹缓存](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/stage/materials.ts#L1-L8) · [缓存输入](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/stage/materials.ts#L173-L203)

### 5. `injection_depth`

数据层读取并保留：

- `injection_position`
- `injection_depth`
- `injection_order`

深度片段还会按 depth、order 排序。但是 `StageMaterials.presetDepth` 的注释明确写着“消费待后续里程碑接入”，最终请求只用了 before 与 after；装配报告也明确标记 depth“尚未消费”。因此，当前版本不能把 `injection_depth` 算作运行时支持。[字段读取与排序](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/preset-assemble.ts#L196-L216) · [仅保存未消费](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/stage/materials.ts#L55-L61) · [报告说明](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/stage/engine.ts#L1448-L1464)

### 6. 模型参数

ST 预设只从顶层搬运六个数值键：`temperature`、`top_p`、`top_k`、`frequency_penalty`、`presence_penalty`、`repetition_penalty`。[采样键清单](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/preset.ts#L33-L41) · [ST 参数读取](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/preset-doc.ts#L145-L164)

请求发送前再根据 provider、model id、base URL 和 API 类型投影：OpenAI 默认只发核心键，OpenRouter、Anthropic、本地模型各有允许集合；o 系列和部分 Kimi 模型会完全剥掉采样参数；数值还会按渠道做钳制。[渠道画像](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/samplers.ts#L84-L202) · [参数投影](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/samplers.ts#L269-L324)

这种“预设保存全值，Adapter 决定当前模型实际发送哪些值”的边界值得借鉴。不过当前 ST 读取面只有上述六键，像 `min_p`、`top_a`、`max_tokens`、`seed`、stop strings 等并没有形成完整的 ST 预设参数映射。

### 7. 正则与脚本

梨园会从预设原对象和角色卡读取 `extensions.regex_scripts`，先跑 PRESET、再跑 SCOPED。它把规则分成两条管线：

- 显示侧：处理 AI 输出美化和 HTML/CSS 皮肤；
- 送模侧：对历史 assistant 文本应用 `promptOnly` 规则及破坏性规则。

支持捕获组、`{{match}}`、`{{char}}`、`{{user}}`、`trimStrings` 与 `minDepth/maxDepth`；单条规则解析或执行失败会跳过，不拖垮整次显示或会话。这种 per-asset isolation 很值得参考。[规则提取和分流](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/cardfront.ts#L49-L77) · [显示与送模规则筛选](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/cardfront.ts#L242-L285) · [规则执行容错](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/cardSkin.ts#L263-L299) · [历史侧应用位置](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/stage/assemble.ts#L128-L199)

边界也很明确：

- 只处理 placement 包含 AI 输出的规则，没有覆盖酒馆全部 placement；
- `substituteRegex` 非零时整条跳过；
- 显示 CSS 使用 iframe 隔离，某些脚本会被移除或受到沙箱约束，不等同酒馆 DOM；
- 完整 STscript、Tavern Helper 和依赖酒馆 DOM/主题的插件没有执行环境。

## 对 dsh-tavern 最值得参考的部分

### 1. 权威原文与运行时投影分开

不要在导入时把酒馆预设永久压扁成我们自己的格式。保留原始 JSON 作为可导回、可审计的权威文档；每次编译时再产生 DSH IR。用户修改一个开关或正文时，只修改对应字段，未知扩展继续保留。

这一点比梨园早期的 `{name, samplers, blocks}` 私有格式更可靠。梨园自己也保留了旧格式兼容，但明确承认旧转换会丢 marker、压平 `prompt_order`。[旧格式的有损边界](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/preset.ts#L1-L8)

### 2. 编译器只认协议字段，不猜块名

梨园的 assembler 只根据 `identifier`、`marker`、`prompt_order`、`injection_*` 工作，不根据“思维链”“文风”“状态栏”等作者自定义名字猜语义。这与我们要做的平台中立 Tavern IR 是同一个正确方向。[assembler 原则](https://github.com/weidu12123/Liyuan/blob/27f8daf976329a94a870cd46a988d459f0692914/src/preset-assemble.ts#L1-L19)

### 3. 前后段必须在最终请求装配点落地

梨园真正有参考价值的不是 `before/after` 这两个数组，而是它把它们接进了最后一次 `streamFn`：before 进入 system prompt，after 成为请求尾部临时消息。这提醒我们，DSH 原生预设不能停留在“转换出三段文本”，必须一直追踪到 Agent 最终看到的 messages、roles、order 和参数。

### 4. 参数由 Adapter 按模型能力投影

IR 可以保留用户预设的参数意图，DSH Adapter 再决定某个 provider/model 能否发送、字段名是什么、是否要删掉默认值。这样既不丢用户配置，也不把所有参数盲塞给所有模型。

### 5. 单块、单宏、单正则失败要可诊断且不中断

梨园同时保留装配报告、unsupported 宏列表和单条正则失败隔离。dsh-tavern 可以进一步把它标准化为编译 diagnostics，并保留 source map：错误应能指出预设名、块 id、字段和降级方式，而不是让一个坏资产终止整个 Session。

### 6. 工作草稿与正式保存分开

`.liyuan/preset-override.json` 的两阶段编辑适合借鉴到 UI：用户可以立即试用当前草稿，但只有明确保存才覆盖权威预设。DSH Session 使用哪一版，则需要再加不可变版本号或内容 hash。

## 不应直接照搬的部分

1. **不能把前段当成“稳定缓存”却允许它每轮随磁盘热变。** 我们的前段应绑定 Session 的预设版本；修改预设默认只影响新 Session，或通过显式迁移产生新 revision。
2. **不能只保存 `injection_depth` 而不消费。** 对真实酒馆预设，这是明显的语义缺口；我们的“中段”必须定义深度插入的准确位置、同深度排序和 role。
3. **不能把 before 的所有 role 压成 system。** IR 应先保留原 role，DSH Adapter 若因模型协议必须降级，也要产生明确 diagnostic。
4. **不能把 assistant 预填静默丢弃当作通用规则。** 可以选择不支持，但要说明原因和影响；严格模式应能比较最终消息序列。
5. **不能把确定性 random/roll 叫作酒馆兼容。** 若为了缓存采取确定化，应把它设计为 DSH 原生策略，而不是隐藏的语义变化。
6. **不能只覆盖六个模型参数。** 应先保存完整参数意图，再由 Adapter 显式报告 applied、ignored、unsupported。
7. **不能把梨园自己的 RP Harness 当成预设语义。** 梨园会在预设前段之后追加消息流协议、工具说明、语言、世界状态、记忆、字数等自身内容；这些属于梨园产品，不属于酒馆预设，也不应进入 Tavern Compiler。

## 对“前 / 中 / 后”方向的直接启发

梨园的实现证明了两件事：

- `chatHistory` 之前和之后不是简单排版，而是不同的递送生命周期；
- 后段完全可以在每次请求时临时构造，而不污染权威对话历史。

但它还没有我们设想中的完整三段：

| DSH 原生段 | 梨园对应物 | 差异 |
| --- | --- | --- |
| 前：Session 稳定前缀 | `presetBefore → systemPrompt` | 梨园每轮读当前文件，不绑定 Session 版本；role 被压平；后面还追加梨园 Harness。 |
| 中：按轮投影到历史特定位置 | `presetDepth` | 只解析、排序和报告，尚未进入请求。 |
| 后：每轮临时尾部 | `assemblePresetAfter → tailRuns` | 生命周期相同，但有 system→user、合并同角色和丢弃 assistant 预填等适配差异。 |

因此，最适合我们的结论不是“照着梨园实现”，而是：**借鉴它的权威原文、运行时投影、前后生命周期、参数 Adapter 和失败隔离；补齐它尚未完成的中段，并让前段真正绑定 Session 版本。**

## 建议下一步验证

如果后续进入实现阶段，建议用同一份真实复杂预设分别喂给 SillyTavern、梨园和 Tavern Compiler，对比以下最终产物，而不是只对比中间 JSON：

- 最终 message 数量、role、顺序和内容 hash；
- marker 材料的实际位置；
- `setvar/getvar` 的跨块结果；
- 每个 `injection_depth` 块的插入点；
- assistant prefill 是否存在；
- 实际发给模型的采样参数；
- 正则处理前后的历史与显示文本；
- 未支持字段的 diagnostics。

只有这些结果一致，才能称为严格兼容；仅仅“能导入、能生成”只能称为可用的近似支持。
