# 酒馆预设到 DSH 原生预设转换协议（草案 0.1）

## 状态

本文是用于真实样本试转的协议草案，不是已经确认的正式规范，也不授权当前运行时执行转换结果。

第一版只回答一个问题：能否把酒馆预设按有效 `prompt_order` 整理成 DSH 可理解的“前、中、后”三段，并让用户直接检查转换结果。它不复刻 SillyTavern 的请求构造、宏环境、采样器、正则或脚本运行时。

## 两种资源

预设库后续应明确分成两类：

### 酒馆预设

- 保存原始 SillyTavern JSON；
- 完整保留 `prompts`、`prompt_order`、采样参数、正则和未知扩展；
- 可以查看、编辑和重新转换；
- 本身不在 DSH Agent 中直接执行。

### DSH 预设

- 是一次转换产生的独立资源；
- 只表达 DSH 的稳定前缀、每轮注入和后带内容；
- 可以脱离原酒馆 JSON 单独编辑、复制和使用；
- 转换是单向快照，源预设后续变化不会静默改写已有 DSH 预设。

这里的“DSH 预设”是 dsh-tavern 的原生提示词资源，不等同于 DSH Host 用 `preset.yml` 和 `agent.cordis.yml` 组成的 Agent Preset。

## 三段语义

一次模型请求的逻辑顺序为：

```text
前：稳定前缀
DSH Session 历史
中：本轮上下文投影
当前用户消息
后：请求级临时尾部
```

三段定义如下：

1. **前（front）**：创建会话时解析并形成稳定快照，后续请求继续携带同一份内容。
2. **中（middle）**：每轮请求时重新解析一次，放在 Session 历史之后、当前用户消息之前；不作为普通历史消息逐轮累积。
3. **后（back）**：每轮请求时临时追加在当前用户消息之后；参与本次生成，但不写入 Session。

## 转换 Module

转换逻辑应集中在一个 Module 中，外部 Interface 暂定为：

```text
convertTavernPreset(source, options?)
  -> { preset, report }
```

调用方只提供酒馆预设和可选的 `prompt_order` 组选择；Module 内部负责顺序解析、重复标识处理、三段分类、marker 翻译和诊断。预设库 UI 不应自行拼接条目。

## 转换步骤

### 1. 选择有效 `prompt_order`

1. 调用方明确指定 `character_id` 时使用指定组；
2. 否则优先使用 `character_id === 100001`；
3. 否则使用第一组具有合法 `order` 数组的配置；
4. 完全没有可用 `prompt_order` 时，按 `prompts` 原始顺序生成草稿，并记录警告。

`prompt_order` 是顺序与启用状态的权威来源。条目定义自身的 `enabled` 不覆盖所选 order 中的 `enabled`。

重复 `identifier` 按出现次序逐个匹配，不能用一个简单 Map 把后面的同名条目覆盖掉。order 引用了不存在的条目时，不猜正文，记录错误。

### 2. 只转换当前启用配置

DSH 预设是一个可执行配置，不是酒馆预设编辑器的完整副本。因此：

- 所选 order 中 `enabled !== false` 的条目进入转换结果；
- 已关闭条目不进入 DSH 三段，但在报告中列出；
- 未出现在所选 order 中的 `prompts` 不执行，在报告中列为未编排条目；
- 用户需要另一套开关组合时，应从酒馆预设重新转换为另一份 DSH 预设。

这样 DSH 预设不需要继承酒馆的多套 order、开关面板和大量备用条目。

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

### 5. 翻译 marker

marker 不复制空正文，而是变成结构化材料引用：

| 酒馆 marker | DSH 材料引用 |
| --- | --- |
| `charDescription` | `character.description` |
| `charPersonality` | `character.personality` |
| `scenario` | `character.scenario` |
| `personaDescription` | `player.description` |
| `dialogueExamples` | `character.dialogueExamples` |
| `worldInfoBefore` | `worldbook.before` |
| `worldInfoAfter` | `worldbook.after` |
| `chatHistory` | 三段分界，不生成条目 |

未知 marker 不按名称猜测，记录 `UNKNOWN_MARKER` 错误。材料引用进入哪一段，第一版只服从其在 `prompt_order` 中的位置，不根据 marker 名称擅自改变生命周期。

### 6. 正文逐字保留

普通条目的 `content` 逐字保留，不总结、不合并、不添加标题、不清理 HTML，也不把相邻同 role 条目自动拼成一条。

每个 DSH 条目保留稳定 `key`、显示名称、role 和可选来源信息。来源信息只用于追溯，不参与运行。

## 暂不转换的内容

### 酒馆宏

草案 0.1 不建立 Tavern 宏运行时。检测到 `setvar/getvar`、`lastUserMessage`、随机宏或其他酒馆宏时：

- 在转换预览中暂时逐字保留；
- 把 DSH 预设状态标为 `review-required`；
- 为每个相关条目产生诊断；
- 在宏被删除或翻译为未来的 DSH 变量协议前，不得把该草稿宣称为可直接运行。

### 采样参数

`temperature`、`top_p`、`top_k`、penalty 等不进入前、中、后。当前 DSH 没有酒馆式完整采样参数配置；转换报告只记录“保留在酒馆源文件，未应用”。

### 正则、HTML 与脚本

正则、HTML、CSS、Tavern Helper、STscript、MVU 等不属于提示词三段，也不进入 DSH 预设。它们继续留在酒馆源预设，由各自独立的兼容 Module 决定是否支持。

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
    },
    {
      "key": "charDescription#1",
      "name": "角色描述",
      "role": "system",
      "type": "material",
      "material": "character.description"
    }
  ],
  "middle": [],
  "back": []
}
```

`status` 只有两个草案值：

- `ready`：没有阻止执行的转换错误；
- `review-required`：存在未翻译宏、未知 marker、缺失条目等问题。

转换来源、被排除条目和 diagnostics 放在并列的转换报告中，不扩大 DSH 预设的运行 Interface。

## 转换报告

报告至少包含：

- 源文件名与内容 hash；
- 选择的 `prompt_order.character_id`；
- 原始、启用、关闭、未编排条目数量；
- 前、中、后三段的条目数、role 分布和正文字符数；
- marker 映射；
- 被忽略的采样参数与扩展；
- 宏、未知 marker、缺失定义、深度折叠等 diagnostics；
- 每个输出条目到源 `identifier` 和 order 位置的映射。

诊断不静默修改结果。错误阻止草稿成为 `ready`；警告允许继续评审。

## 第一份真实样本

草案使用本地已导入的 `Kemini Dramatron 陨落的天才v1.26.json`，选择 `character_id = 100001` 的 order。按上述规则，其启用结果为：

| 段 | 启用条目 | 启用正文字符 | 说明 |
| --- | ---: | ---: | --- |
| 前 | 19 | 16115 | 包含 7 个材料 marker、2 个 user role，以及含 Tavern 宏的文本 |
| 中 | 0 | 0 | 样本没有 `injection_position === 1` 的启用条目 |
| 后 | 5 | 1699 | 全部为 system role，其中多条依赖 `getvar` |

另外有 18 个所选 order 内关闭条目、4 个未编排 prompt、12 条预设正则及多项采样参数未进入 DSH 预设。

这个结果故意不做“智能修正”。它首先要让我们判断：

1. 纯结构转换导致中段为空，是否符合 DSH 预设直觉；
2. 历史前的角色和世界书 marker 是否都应该成为稳定前缀；
3. 酒馆宏应该被翻译、移除，还是交给用户处理；
4. DSH 预设是否需要保留 disabled 备用条目；
5. `user/assistant` role 在前后段应如何交给 DSH Agent。

这些问题确认后，再冻结正式文件格式和运行 Interface。
