# SillyTavern 与 dsh-tavern 请求差异诊断

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

其中 SillyTavern 成功请求使用非流式配置，而 dsh-tavern 的失败表现正是流式响应在没有 `finish_reason` 时中断，值得优先做单变量测试。

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
