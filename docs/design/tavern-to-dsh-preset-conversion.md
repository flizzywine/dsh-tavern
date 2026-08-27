# 外部预设条目到内部请求投影协议（草案 0.4）

> 本文描述运行时内部转换。用户只接触“预设库”和其中的条目选择；自包含选择快照与前、中、后三段均为内部实现。

## 状态

外部预设完整保存 `prompts`、`prompt_order`、采样参数和未知扩展。用户选择提示词与正则后，系统保存一份内部快照。普通 DSH 模式把已选条目投影成前、中、后，兼容模式按 SillyTavern 顺序编译同一批条目。

## 已确认规则

- `prompt_order` 决定参与转换的条目及相对顺序；
- 程序不猜测条目用途，只执行用户明确选择；
- 正则独立保留自身启用状态；
- `chatHistory` 只划分历史前后，不生成 DSH 条目；
- 人物卡、玩家信息、对话示例和世界书 marker 由运行时提供，避免重复注入；
- 未知 marker 不猜测、不删除，必须进入诊断；
- 普通提示词正文、role 和相对顺序原样保留。

## 内部生命周期

一次普通 DSH 请求的逻辑顺序为：

```text
前：稳定前缀消息
DSH Session 历史与当前用户消息
现有 Tavern 本轮上下文
中：每轮注入
后：请求级临时尾部
```

1. **前（front）**：每次请求临时放在最前，不写入权威 Session 历史；
2. **中（middle）**：每轮注入一次，并保留该轮实际上下文；
3. **后（back）**：每次请求临时附加在末尾，请求结束后遮蔽。

兼容模式不使用这三段的 DSH 生命周期，而是按来源 `prompt_order`、marker、role 和 `strict_tools` 规则重新构造本轮消息。

## 选择有效 `prompt_order`

1. 调用方明确指定 `character_id` 时使用指定组；
2. 否则优先使用 `character_id === 100001`；
3. 否则使用第一组具有合法 `order` 数组的配置；
4. 没有可用组时按 `prompts` 原始顺序生成草稿并记录警告。

重复 `identifier` 按出现次序逐个匹配，不能用简单 Map 覆盖。order 引用不存在条目时记录错误，不猜正文。

## 条目选择

- 只使用内部快照中已启用的普通提示词；
- 未出现在所选 order 中的提示词不执行；
- `injection_position === 1` 的条目进入 `middle`；
- 其他位于 `chatHistory` 前的条目进入 `front`；
- 其他位于 `chatHistory` 后的条目进入 `back`；
- 深度注入在 DSH 模式折叠到 `middle` 并产生诊断，在兼容模式按 SillyTavern 语义处理。

选择保存在内部快照，不改写来源外部预设。界面重新提交选择时更新同一来源对应的内部快照并激活它。

## 原生材料 marker

| 酒馆 marker | DSH 原生来源 |
| --- | --- |
| `charDescription` | `character.description` |
| `charPersonality` | `character.personality` |
| `scenario` | `character.scenario` |
| `personaDescription` | `player.description` |
| `dialogueExamples` | `character.dialogueExamples` |
| `worldInfoBefore` | `worldbook.before` |
| `worldInfoAfter` | `worldbook.after` |
| `chatHistory` | 历史分界，不生成条目 |

## 正则

- 读取原生 `extensions.regex_scripts`；
- 默认继承来源启用状态，用户可以取消；
- 正则不进入提示词正文；
- 展示正则只改变展示投影，不覆盖权威模型原文；
- 损坏规则产生诊断，后续规则继续执行。

## 诊断

每次请求在模型网络调用前保存完整记录，包括 system、tools、最终有序 messages、内部投影、外部预设来源、选中条目、正则、任务、轮次和步骤。诊断记录不进入后续模型上下文。

产品行为以 [预设库](./preset-library.md) 为准。
