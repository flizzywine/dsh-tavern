---
name: image-prompt
description: "卡片工作台生图。按实际渠道选择标签、自然语言或结构化提示词，复用人物服装与参考图。"
---

# 卡片工作台生图

1. `read_image_config` 查渠道、提示词格式、可选渠道、工作流、参考图与种子能力。只读本地，不出图。
2. 画面有库中角色时用 `read_character`：不传 `name` 列全部人物；传 `name` 拿 `macroName`、`macro`、`outfitMacro`，默认轻量，不含外貌与服装原文。用户要改这个角色的外貌或服装时才加 `full: true`，返回 traits 与服装原文，不含宏。
3. 提示词写法以 `references` 里 `always` 条目为准，并按 `read_image_config` 返回的 `promptMode` 分渠道：标签类（NovelAI、SD WebUI、标签式 ComfyUI）和自然语言类要求不同，别把标签写法套到所有模型上。
4. 人物宏和服装宏原样嵌进串里，展开成标签还是句子由引擎按渠道决定。**有宏就别再手动拼外貌块**：`references` 里那些拼 `face` / `bodySFW` 的旧做法，在有宏的角色身上不用重做一遍，两套说法会打架。
5. 穿常穿那套直接贴 `outfitMacro`；换库里的另一套就改服装宏的 `name`。库里没有的写进人物宏的 `outfit` 键（`"outfit":"sailor uniform, pleated skirt"`）——服装宏的名字对不上库时，人物宏会照补常穿，两套打架。服装宏的 `upperBody` / `lowerBody` 保持 `visible`。衣服不该入画就别写这个宏——填 `hidden` 不会让它消失。
6. 多人：每人一套（人物宏 + 服装宏），描述里用各自外貌或 `the woman` / `the man` 分开做主语，不写 `they`、`the two of them`、"two girls"。每人至少两项可区分特征（发色发型、衣服、体型）。句尾写明人数。宏和衣服只属于它那个人。
7. 多形态角色（名字带后缀）在宏里写形态自己的英文名，不写短名。
8. 镜头和角度写明；画面看不到的部位不写对应 tag（背影不写瞳色，遮脸不写瞳色）。
9. 用 `tavern_read_skill_reference` 按 `references/INDEX.md` 读规则：`always` 编写前、`prescan` 提交前、`manual` 改库前，`lookup` 用 `find_prompt`。没匹配条目就按用户要求写，不反复找文件。
10. 用户授权后用 `gen_image_submit` 提交，立即返回任务号。`count` 要几张、`channel` 指定渠道（只影响本次）、`comfyui` 用本地工作流。不靠试错猜渠道。
11. 参考图模式 `generation_mode: reference`，`subjects` 填 `read_character` 的精确人物与服装 ID。只在该渠道支持参考图时用，且**不要再用人物宏**，外貌会被写两遍。
12. `characters` 给每个入画人物单独写一段描述，跟 `generation_mode` 无关，纯出图也能用；NovelAI 走原生角色参数，其他渠道由引擎合成。
13. `gen_image_status` 按任务号取图，可传多个；`wait` 是最多等几秒，有图先返回那批。`markdown` 原样写进回复，保留完整地址。失败或待确认的带原因，不确定先查记录，不自动重发。

## 宏

成对闭合：`${` 开头、`}$` 结尾，漏了结尾 `$` 整段作废。

写错不报错：名字对不上库时宏被整段删掉或退化成普通称呼，图跟人物库无关且无提示。首次用某角色先确认返回的两条宏原样能用。

宏写在工具参数里，参数是 JSON，宏里的引号要转义成 `\"`。宏越长越容易把参数写坏，能不写的键就不写。

## full: true 只有一种情况

**用户明确要求改这个角色的外貌或服装**——换发色、改体型、加衣服、重写 traits。其余一律不传：

- 觉得宏太短、想先看完整外貌再画：宏里该有的都在，不知道外貌长什么样一样能画对。
- 想核对宏写得对不对：宏由工具从库拼出，不需要校对。
- 出图不对、想读全量排查：多半是主干句或主语的问题，读全量只会遮住问题。
- 拿不准：不读。

读一次全量，省下的 token 全还回去。

## sfw / nsfw / hidden / visible

人物宏的 `upperBody` / `lowerBody` 决定引擎从库取哪套外貌，不是"露多少"的修饰。

| 值 | 引擎做什么 |
|---|---|
| `sfw` | 取这套衣服下的外貌（`bodySFW` / `lowerSFW`） |
| `nsfw` | 取裸露状态的外貌（`bodyNSFW` / `lowerNSFW`），**且不再自动补常穿服装** |
| `hidden` | 该部位不入画，不取外貌 |

填了 `nsfw`，引擎就不再补常穿那套，衣服必须自己写：半脱时服装宏照给，露出的部位填 `nsfw`；只填 `nsfw` 不给服装宏，画面就是全裸。衣服确实不在画面里，就别调用服装宏。
