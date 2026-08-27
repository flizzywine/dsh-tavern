# Kemini Dramatron 转换报告

## 输入

- 源文件：`Kemini Dramatron 陨落的天才v1.26.json`
- SHA-256：`3863a4b2474fc2f2640d7b721b264f1381d14b447436d722bfd949f5ae6a4648`
- Prompt 定义：47
- Prompt order：2 组（`100000`、`100001`）
- 本次选择：`character_id = 100001`

## 转换结果

| 段 | 全部条目 | 开启 | 全部正文字符 | role |
| --- | ---: | ---: | ---: | --- |
| 前 | 24 | 12 | 19253 | system 22、user 2 |
| 中 | 0 | 0 | 0 | 无 |
| 后 | 11 | 5 | 9846 | system 11 |

转换草稿状态：`review-required`。开启条目的正文快照见 [转换草稿](kemini-dramatron-dsh-preset-draft.json)；完整开关状态及未转换原值以当前转换 UI 为准。

## 前段开启条目顺序

| 源顺序 | 名称 | role | 类型 | 字符 | 宏 |
| ---: | --- | --- | --- | ---: | ---: |
| 0 | 🔗 | system | text | 400 | 19 |
| 5 | 🗃️人称设置（自改） | system | text | 131 | 2 |
| 7 | 🤖防机械化 | system | text | 218 | 2 |
| 11 | 🎞️剧情偏好（自填） | system | text | 19 | 1 |
| 13 | 📼文风基调（gemini新） | system | text | 344 | 1 |
| 15 | ✒️文风：轻小说 | system | text | 394 | 1 |
| 17 | 💠陨落的天才！（build渠道等过不去外审开） | user | text | 13622 | 0 |
| 18 | 💠CLEAR | system | text | 264 | 0 |
| 19 | 🎬ROLE AND GUIDE | user | text | 630 | 3 |
| 20 | 💠&lt;DATA&gt; | system | text | 43 | 0 |
| 29 | 💠&lt;/DATA&gt; | system | text | 7 | 0 |
| 30 | 💠&lt;HISTORY&gt; | system | text | 43 | 0 |

## 中段开启条目顺序

没有条目。所选 order 中没有启用的 `injection_position === 1` 条目。

## 后段开启条目顺序

| 源顺序 | 名称 | role | 类型 | 字符 | 宏 |
| ---: | --- | --- | --- | ---: | ---: |
| 32 | 💠&lt;/HISTORY&gt; | system | text | 22 | 0 |
| 34 | 📽️COT（格式友好型） | system | text | 390 | 6 |
| 38 | ⚙️SETTING | system | text | 201 | 4 |
| 39 | 🎬ROLEPLAY GUIDE | system | text | 842 | 6 |
| 40 | 💠continue | system | text | 244 | 0 |

## DSH 原生接管

### 由 DSH 原生接管的 7 个 marker

- 💠↑Char
- 💠Persona Description
- 💠Char Description
- 💠Char Personality
- 💠Scenario
- 💠↓Char
- Chat Examples

## DSH 三段中处于关闭状态的 18 个条目

- ⚓不媚USER
- ⚖️防支配
- 💡防全知
- 📣对话加强
- 📢加強转述
- 💬抢话
- 💬不抢话
- 🔍人称代词控制
- 📼文风基调（内心戏）
- ✒️文风：视觉小说
- ✒️文风：强主观
- 💗NSFW
- 📽️ICOT（三段）
- 📐牢大防截断
- 💿普通防截断
- 🔖摘要
- `nsfw`
- `enhanceDefinitions`

## 未转换内容

### 未出现在所选 order 中的 4 个 prompt

- SPreset配置
- 💠BEGIN
- 💠FAKE
- 🔶ICOT（自由）

### 未选择的顺序组

- 未选择的 `character_id = 100000` order 未参与转换。

顶层采样、请求、续写、图片、工具和推理参数，以及正则之外的扩展配置，在转换中直接忽略，不进入未转换内容。12 条 SPreset 正则完整进入 DSH 转换稿的独立正则区，其中 11 条开启、1 条关闭。

## Diagnostics

| 级别 | 代码 | 说明 |
| --- | --- | --- |
| info | `TAVERN_MACRO_RUNTIME` | 10 个启用条目含酒馆宏，共 45 处；开始新对话时按前、中、后顺序解析一次，未知宏保留并记录运行诊断。 |
| warning | `MIDDLE_EMPTY` | 纯结构转换后中段为空。 |
| info | `ORDER_GROUP_NOT_SELECTED` | `character_id = 100000` 没有参与本次转换。 |
| info | `DISABLED_ENTRIES_PRESERVED` | 18 个关闭条目已复制到 DSH 三段，并保持关闭状态。 |
| info | `NATIVE_MATERIAL_MARKERS_IGNORED` | 7 个人物卡或世界书 marker 由 DSH 原生流程接管，未重复写入预设。 |
| info | `UNORDERED_PROMPTS_EXCLUDED` | 4 个未编排 prompt 未复制到 DSH 三段，但在未转换内容中完整展示。 |

## 这份样例暴露的问题

1. 仅按 `chatHistory` 与深度注入分段时，中段完全为空。
2. 前段共 19253 字，其中开启条目正文 16115 字；一条 user role 内容就有 13622 字。“历史前”不天然等于适合稳定缓存。
3. 人物卡和世界书 marker 已排除，由 DSH 原生生命周期规则统一装配，避免重复注入。
4. 后段的 COT、SETTING 和 ROLEPLAY GUIDE 依赖 `getvar`；三段必须共享同一轮宏变量状态。
5. 转换稿保留 user role；当前 DSH 生命周期适配器的中、后统一以 user 请求消息表达，后续原生接口升级时再恢复更细粒度 role。
