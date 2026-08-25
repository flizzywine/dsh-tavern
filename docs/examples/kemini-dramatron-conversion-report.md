# Kemini Dramatron 转换报告

## 输入

- 源文件：`Kemini Dramatron 陨落的天才v1.26.json`
- SHA-256：`3863a4b2474fc2f2640d7b721b264f1381d14b447436d722bfd949f5ae6a4648`
- Prompt 定义：47
- Prompt order：2 组（`100000`、`100001`）
- 本次选择：`character_id = 100001`

## 转换结果

| 段 | 启用条目 | 正文字符 | role |
| --- | ---: | ---: | --- |
| 前 | 19 | 16115 | system 17、user 2 |
| 中 | 0 | 0 | 无 |
| 后 | 5 | 1699 | system 5 |

转换草稿状态：`review-required`。完整正文见 [转换草稿](kemini-dramatron-dsh-preset-draft.json)。

## 前段顺序

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
| 21 | 💠↑Char | system | `worldbook.before` | 0 | 0 |
| 22 | 💠Persona Description | system | `player.description` | 0 | 0 |
| 23 | 💠Char Description | system | `character.description` | 0 | 0 |
| 25 | 💠Char Personality | system | `character.personality` | 0 | 0 |
| 26 | 💠Scenario | system | `character.scenario` | 0 | 0 |
| 27 | 💠↓Char | system | `worldbook.after` | 0 | 0 |
| 28 | Chat Examples | system | `character.dialogueExamples` | 0 | 0 |
| 29 | 💠&lt;/DATA&gt; | system | text | 7 | 0 |
| 30 | 💠&lt;HISTORY&gt; | system | text | 43 | 0 |

## 中段顺序

没有条目。所选 order 中没有启用的 `injection_position === 1` 条目。

## 后段顺序

| 源顺序 | 名称 | role | 类型 | 字符 | 宏 |
| ---: | --- | --- | --- | ---: | ---: |
| 32 | 💠&lt;/HISTORY&gt; | system | text | 22 | 0 |
| 34 | 📽️COT（格式友好型） | system | text | 390 | 6 |
| 38 | ⚙️SETTING | system | text | 201 | 4 |
| 39 | 🎬ROLEPLAY GUIDE | system | text | 842 | 6 |
| 40 | 💠continue | system | text | 244 | 0 |

## 未进入 DSH 预设

### 所选 order 中关闭的 18 个条目

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

### 未出现在所选 order 中的 4 个 prompt

- SPreset配置
- 💠BEGIN
- 💠FAKE
- 🔶ICOT（自由）

### 独立保留在酒馆源预设

- 顶层采样、请求、续写、图片、工具和推理参数均未进入前、中、后；
- 12 条 SPreset 正则未进入 DSH 预设；
- 未选择的 `character_id = 100000` order 未参与转换。

## Diagnostics

| 级别 | 代码 | 说明 |
| --- | --- | --- |
| error | `TAVERN_MACRO_UNSUPPORTED` | 10 个启用条目仍含酒馆宏，共 45 处；其中 `setvar` 25 处、`getvar` 17 处。草稿不能直接执行。 |
| warning | `MIDDLE_EMPTY` | 纯结构转换后中段为空。 |
| info | `ORDER_GROUP_NOT_SELECTED` | `character_id = 100000` 没有参与本次转换。 |
| info | `DISABLED_ENTRIES_EXCLUDED` | 18 个关闭条目未复制到 DSH 预设。 |
| info | `UNORDERED_PROMPTS_EXCLUDED` | 4 个未编排 prompt 未复制到 DSH 预设。 |
| info | `MODEL_PARAMETERS_NOT_APPLIED` | 酒馆采样及请求参数保留在源文件，未进入 DSH 三段。 |
| info | `PRESET_EXTENSIONS_NOT_CONVERTED` | 12 条正则及其他扩展未进入 DSH 预设。 |

## 这份样例暴露的问题

1. 仅按 `chatHistory` 与深度注入分段时，中段完全为空。
2. 前段包含 16115 字启用正文，其中一条 user role 内容就有 13622 字；“历史前”不天然等于适合稳定缓存。
3. 前段 marker 包含角色描述、性格、场景和世界书；是否全部稳定，需要 DSH 自己的生命周期规则决定。
4. 后段的 COT、SETTING 和 ROLEPLAY GUIDE 依赖 `getvar`；不设计 DSH 变量协议就无法成为原生可运行内容。
5. 转换保留了 user role，没有拍平成 system；后续 DSH 请求装配必须决定如何表达。
