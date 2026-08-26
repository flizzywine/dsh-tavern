# 破限方案到内部预设投影协议（草案 0.3）

> 本文只描述运行时内部转换，不定义用户产品界面。用户导入的是“外部预设”，运行的是从中抽取并独立保存的“破限方案”；“DSH 预设”和前、中、后都不向普通用户展示。产品模型以 [外部预设库与破限方案库](./preset-library.md) 为准。

## 状态

本文记录已经确认并逐步实现的内部转换规则。文件格式仍是草案。

当前代码由对话绑定的 `bypassPlanId` 驱动。破限方案独立保存提示词和酒馆运行正则；普通 DSH 模式把方案投影成前、中、后，兼容模式按 SillyTavern 顺序使用同一方案内已开启条目。外部预设路径仅保留为来源信息，不参与运行。

## 已确认的转换规则

- `prompt_order` 决定参与转换的条目及其相对顺序；
- 普通提示词只有一份开启状态，同时供兼容模式和 DSH 模式使用；
- 正则独立保留并读取自身的 `disabled`；
- `chatHistory` 只划分历史前后，不生成 DSH 条目；
- 人物卡、玩家信息、对话示例和世界书 marker 由 DSH 原生装配，转换时忽略，避免重复注入；
- 未知 marker 不猜测、不删除，必须进入诊断等待人工判断；
- 普通提示词正文逐字保留，转换器不替用户润色或修正预设。

## 两个用户资源、一个内部投影

用户只接触两个资源库：

1. **外部预设库**：只读查看导入来源，不能激活；
2. **破限方案库**：管理从外部预设抽取并独立保存的可运行内容。

外部预设完整保存 `prompts`、`prompt_order`、采样参数和未知扩展。抽取时，用户选择提示词，正则默认完整复制并继承原启用状态；保存后，方案不再依赖来源文件。运行投影只表达前、中、后与正则。人物卡和世界书等故意忽略的占位符由运行时处理，不进入普通 DSH 投影。

对话只绑定破限方案 ID。编辑方案后，前、后从下一次请求生效；中段从下一轮开始采用最新内容，已经进入 Session 的旧中段不追溯改写。正则开关仍可实时影响展示投影。这里的内部运行投影不等同于 DSH Host 用 `preset.yml` 和 `agent.cordis.yml` 组成的 Agent Preset。

## 三段语义

一次模型请求的逻辑顺序为：

```text
前：稳定前缀消息
DSH Session 历史与当前用户消息
现有 Tavern 本轮上下文
中：每轮注入
后：请求级临时尾部
```

三段定义如下：

1. **前（front）**：每次请求读取当前预设并放在请求最前；请求形成后从有效 Session Surface 遮蔽，因此修改后下一次请求立即生效。
2. **中（middle）**：每轮前台请求第一步注入一次；后台每个候选或结算任务第一步注入一次，并作为该轮实际上下文保留在 Session 中。旧轮内容不追溯改写。
3. **后（back）**：每次前台或后台模型请求都临时追加在请求末尾；参与本次生成，请求结束后立即从有效 Session Surface 中遮蔽，不进入下一次请求上下文。

前、中、后都以请求消息表达，逐条保留源 `system`、`user`、`assistant` 角色和相对顺序。后台请求先放这组三段消息，再放 DSH 自己的结算或候选任务，使后台任务协议始终位于最后。

每次前台和后台调用在清理前、模型网络请求开始前，另外保存一份完整请求记录，包括 system、tools、全部有序 messages、前中后三段、预设路径与摘要、前后台范围、任务、轮次和步骤。该诊断记录不参与之后的模型上下文。

## 转换 Module

转换逻辑应集中在一个 Module 中，外部 Interface 暂定为：

```text
projectBypassPlan(plan, options?)
  -> { preset, report }
```

调用方只提供已经保存的破限方案；Module 内部负责顺序解析、重复标识处理、三段分类、marker 翻译和诊断。资源库 UI 不应自行拼接条目。

## 转换步骤

### 1. 选择有效 `prompt_order`

1. 调用方明确指定 `character_id` 时使用指定组；
2. 否则优先使用 `character_id === 100001`；
3. 否则使用第一组具有合法 `order` 数组的配置；
4. 完全没有可用 `prompt_order` 时，按 `prompts` 原始顺序生成草稿，并记录警告。

`prompt_order` 是顺序与启用状态的权威来源。条目定义自身的 `enabled` 不覆盖所选 order 中的 `enabled`。

重复 `identifier` 按出现次序逐个匹配，不能用一个简单 Map 把后面的同名条目覆盖掉。order 引用了不存在的条目时，不猜正文，记录错误。

### 2. 使用方案开关

酒馆预设无法通过字段可靠区分各类内容用途，因此程序不猜测，只执行用户选择：

- 运行时只使用方案内已开启的普通提示词；
- 兼容模式按有效 `prompt_order` 组装它们；
- DSH 模式将它们继续划分为前、中、后；
- 未出现在所选 order 中的 `prompts` 不执行，在报告中列为未编排条目；
- 开关保存在破限方案中，不改写来源外部预设。

### 3. 按 `prompt_order` 遍历并划分三段

按所选 order 从前到后遍历：

1. 遇到 `chatHistory` marker 时，只记录分界，不生成 DSH 条目；
2. `injection_position === 1` 的条目进入 `middle`；
3. 其他位于 `chatHistory` 之前的条目进入 `front`；
4. 其他位于 `chatHistory` 之后的条目进入 `back`。

每一段内部继续保持原 `prompt_order` 相对顺序。三段生命周期高于原始交错位置：深度注入从源顺序中抽出后统一进入 `middle`。

草案 0.1 不复刻酒馆的历史深度：`injection_depth` 与 `injection_order` 只写入转换报告。所有深度注入都会折叠到 DSH 唯一的中段，并产生 `TAVERN_DEPTH_COLLAPSED` 警告。

### 4. 保留 role

普通文本条目的 `system`、`user`、`assistant` 原样保留。转换器不得把它们全部压成 `system`，也不得删除末尾 `assistant` 预填。

如果后续 DSH Adapter 无法表达某种 role 或排列，应在使用阶段明确报错或降级；这不是转换器可以静默处理的问题。

### 5. 识别但忽略原生材料 marker

DSH 已经通过人物卡、玩家信息和世界书的原生装配流程提供下列材料。转换器只识别这些 marker，用于解释它们为何消失，不再把它们写入 DSH 预设：

| 酒馆 marker | DSH 原生来源 |
| --- | --- |
| `charDescription` | `character.description` |
| `charPersonality` | `character.personality` |
| `scenario` | `character.scenario` |
| `personaDescription` | `player.description` |
| `dialogueExamples` | `character.dialogueExamples` |
| `worldInfoBefore` | `worldbook.before` |
| `worldInfoAfter` | `worldbook.after` |
| `chatHistory` | 三段分界，不生成条目 |

这些 marker 不进入前、中、后任一段，也不计入 DSH 预设条目数；诊断区记录“原生接管”的数量，便于核对转换没有漏项。这样可以避免人物描述、性格、场景、对话示例、玩家信息和世界书被重复注入。

未知 marker 不按名称猜测，也不能静默删除，继续记录 `UNKNOWN_MARKER` 错误并保留在待复核转换结果中。

### 6. 正文逐字保留

普通条目的 `content` 逐字保留，不总结、不合并、不添加标题、不清理 HTML，也不把相邻同 role 条目自动拼成一条。

每个 DSH 条目保留稳定 `key`、显示名称、role 和可选来源信息。来源信息只用于追溯，不参与运行。

## 运行前宏解析

转换稿保留宏原文。每次模型请求前，运行时按 `front → middle → back` 以及各段内部顺序解析宏，三段共享同一变量状态；解析结果记录为本次请求证据。已支持的 `setvar/getvar`、`user`、`char` 等宏在这里展开，未知宏保留原文并产生运行诊断，不由转换器猜测替换。

### 采样参数

`temperature`、`top_p`、`top_k`、penalty 等不进入 DSH 转换稿，也不列入未转换内容和 diagnostics。酒馆源文件仍原样保存，转换过程直接忽略这些参数。

### 正则、HTML 与脚本

SillyTavern 的 `extensions.regex_scripts` 不属于提示词三段。它作为内部投影的独立“正则”部分完整映射，保留名称、开关、查找、替换、作用位置、深度、`promptOnly`、`markdownOnly`、`runOnEdit` 等字段。`extensions.SPreset.RegexBinding` 是 SPreset 编辑器元数据，不与酒馆运行正则合并。正则只处理前台游玩消息的输入、Session 和展示投影，不处理后台 Agent 的结算 JSON、候选协议或历史日志。正则开关实时读取，因此无需新建对话即可重新生成已有前台展示投影。

HTML、CSS、Tavern Helper、STscript、MVU 及其他扩展不进入转换稿，也不列入未转换内容；它们仍原样保存在酒馆源文件中。

## 暂定逻辑格式

文件语法尚未确定。为了真实试转，样例暂用 JSON 表达以下逻辑结构：

```json
{
  "schema": "dsh-tavern/native-preset-draft@0.1",
  "name": "示例",
  "status": "ready",
  "front": [
    {
      "key": "main#1",
      "name": "主提示词",
      "role": "system",
      "type": "text",
      "content": "保持角色一致。"
    }
  ],
  "middle": [],
  "back": [],
  "regex": [
    {
      "name": "示例替换",
      "enabled": true,
      "findRegex": "/foo/g",
      "replaceString": "bar",
      "placement": [2],
      "promptOnly": false,
      "markdownOnly": true
    }
  ]
}
```

`status` 只有两个草案值：

- `ready`：没有阻止执行的转换错误；
- `review-required`：存在未知 marker、缺失条目等阻止可靠映射的问题。仅包含可运行宏不会让草稿进入该状态。

转换来源、未转换内容和 diagnostics 放在并列的转换报告中，不扩大 DSH 预设的运行 Interface。

## 转换报告

报告至少包含：

- 源文件名与内容 hash；
- 选择的 `prompt_order.character_id`；
- 原始、启用、关闭、未编排条目数量；关闭条目属于 DSH 三段，不属于未转换内容；
- 前、中、后三段的条目数、role 分布和正文字符数；
- DSH 原生接管的 marker 及其排除数量，但不重复展示这些故意忽略的条目正文；
- 正则条目数量、开关及完整转换字段；
- 未选择 `prompt_order` 组的完整原值；
- 未编排 prompt、未知 marker 与缺失定义的完整可用内容；
- 宏、未知 marker、缺失定义、深度折叠等 diagnostics；
- 每个输出条目到源 `identifier` 和 order 位置的映射。

诊断不静默修改结果。错误阻止草稿成为 `ready`；警告允许继续评审。

## 第一份真实样本

草案使用本地已导入的 `Kemini Dramatron 陨落的天才v1.26.json`，选择 `character_id = 100001` 的 order。按上述规则，其启用结果为：

| 段 | 条目 | 开启 | 说明 |
| --- | ---: | ---: | --- |
| 前 | 24 | 12 | 7 个原生材料 marker 已排除；12 个关闭条目保留在本段 |
| 中 | 0 | 0 | 样本没有 `injection_position === 1` 的条目 |
| 后 | 11 | 5 | 6 个关闭条目保留在本段 |

另外有 7 个由 DSH 原生接管的材料 marker；它们不进入 DSH 预设，也不在“未转换内容”中重复展示。该样本含 7 条 SillyTavern 运行正则，抽取时默认全部进入方案；SPreset 编辑器元数据中的 12 条记录只供来源检查，不参与运行。采样参数和其他扩展直接忽略。

这个结果故意不做“智能修正”。它首先要让我们判断：

1. 纯结构转换导致中段为空，是否符合 DSH 预设直觉；
2. 当前宏兼容范围是否足够，哪些宏需要继续补齐；
3. DSH 预设是否需要保留 disabled 备用条目；
4. `user/assistant` role 在前后段应如何交给 DSH Agent。

这些问题确认后，再冻结正式文件格式和运行 Interface。
