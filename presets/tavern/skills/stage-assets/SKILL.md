---
name: stage-assets
description: "管理舞台素材库：素材包的绑定与启用，人物的形象、服装差分、Live2D 和应用内生图，人物声音与配音后端、声音克隆、读音和没声音排查，背景、CG、音乐音效、皮肤与触发词，安装和导出素材包。"
---

# 素材库

素材包属于舞台素材库，不属于某张卡。卡通过绑定使用包，多张卡可以绑定同一个包，所以改包里的内容会影响每张用到它的卡。包里有人物（`figures`，含服装、差分、立绘、模型和声音绑定）和素材条目（背景、CG、音乐、音效、环境音、皮肤等）。

对用户说包、人物、条目时用显示名（说「雨夜街道」，不说 `rainy-street-02`），id 只写进工具调用。

## 按任务读哪篇

| 用户想做的事 | 读 |
| --- | --- |
| 绑定或全局启用一个包、复制包给单卡用、新建或删除包 | [包与绑定](references/packs.md) |
| 让素材每轮可用或只在提到时可用、改触发词 | [灯态与触发词](references/lamps-recall.md) |
| 加或改背景、CG | [背景与 CG](references/backgrounds-cg.md) |
| 加或改 BGM、音效、环境音 | [音乐、音效、环境音](references/music-sound.md) |
| 皮肤条目 | [皮肤条目](references/skins.md) |
| 安装别人的素材包、检查更新、导出包 | [安装与导出](references/transfer.md) |
| 新建人物、改名字别名、服装、差分、头像裁切、上传立绘 | [人物](references/figures.md)；字段含义见 [人物字段](references/figure-fields.md) |
| 导入 Live2D / Spine 模型、装运行库 | [Live2D 与 Spine](references/live2d-spine.md) |
| 用应用内生图画立绘、头像、设定图、背景 | [应用内生图](references/generation.md)；目标类型见 [生图目标](references/generation-targets.md) |
| 第一次配音、问「怎么让角色说话」 | [从零开始配音](references/voice-start.md) |
| 添加或修改语音服务、填密钥、测试连接 | [配音后端](references/voice-backend.md) |
| 给某个人物配声音（浏览器朗读、在线 TTS、Fish 声音库、声音模板） | [给人物配声音](references/figure-voice.md) |
| 声音克隆、参考音频 | [声音克隆](references/voice-clone.md) |
| 语速语调、开心时换一种说法、换配音语言 | [声音变体](references/voice-variants.md) |
| 某个词读错了 | [读音词典](references/voice-readings.md) |
| 「没有声音」「配音用不了」 | [没有声音时按顺序检查](references/voice-troubleshooting.md) |
| 查音色、来源、绑定的数据形状 | [声音数据](references/voice-data.md) |

舞台本身的开关（对话气泡、配音、舞台模式、BGM 等四态开关）和开场画面在 stage-setup；导演怎么用素材在 stage-directing；分享整张卡在 stage-sharing。

## 三种读取：存在、本卡、全局

| 想知道 | 调用 | 结果里看 |
| --- | --- | --- |
| 装了哪些包 | `tavern_assets_read({request:{action:'list'}})`，每页最多 50 条，用 `offset` 翻页，`query` 按名字筛选 | 每个包的 `packId`、名字、`revision` 和范围概要 `scope` |
| 这张卡绑定了哪些 | `tavern_assets_read({request:{action:'bindings'}})`，不带 `path` 即当前卡 | `boundPackIds` 和卡的 `revision`（`bind` 用它） |
| 哪些全局启用 | `tavern_assets_read({request:{action:'settings'}})` | `values.globalEnabledPackIds` 和设置的 `revision`（`global-packs` 用它） |

包在本卡和全局都没有就是关闭。`list` 的 `scope.card` 为 `null` 表示工作台没有关联卡，不是关闭。

**两层开关**：包的范围（全局 / 本卡 / 关闭）决定这张卡能不能用这个包；条目和人物的灯（蓝灯每轮可用、绿灯提到时可用、关）决定导演本轮看不看得到它。两层都满足，导演才可能用到。

## 调用格式

每个工具只有一个 `request` 参数。几个动作共用的字段放在外层，`action` 和这个动作其余的字段放进 `operation`，可以嵌套多层，层级以工具 schema 为准；各篇里的 `动作 {字段}` 只列出字段。

- 读条目：`tavern_assets_read({request:{kind:'backgrounds', operation:{action:'item', packId:'…'}}})`，结果带包的 `revision`，只列每条的 `id`、名字和启用状态；在 `operation` 里加 `id` 才返回这一条的完整字段，改之前先这样读。整个包的详情用 `{action:'pack', packId}`。
- 字段说明：`tavern_assets_read({request:{kind:'backgrounds', operation:{action:'schema'}}})`，写之前按它组织字段。
- 改条目：`tavern_assets_patch({request:{expectedRevision:'包的 revision', operation:{packId:'…', operation:{action:'item', item:{…}}}}})`。

用户说的是名字时，用 `list {query}`、`item` 找到 `packId` 与条目 `kind`/`id`；`resolve` 只接受从 `item` 取得的规范引用，不接受名字。多个候选同名时列出「条目名（包名）」请用户选，不按名字猜 ID。

## 写入规则

- 包、卡绑定、全局设置、读音词典各有自己的 revision，分别来自各自的读取结果，不能混用；连续写入时用上一次回执里的新 revision。数组和字典字段整体替换，先读出现有成员，保留不改的再写回。
- 收到 `REVISION_CONFLICT`：重新读取，在最新内容上只重做这次的改动，不把旧的整段内容写回去（会覆盖用户刚做的修改）。
- 改别的卡也在用的包、全局启用的包，或删除条目、人物、包时，宿主会请用户确认并列出影响；调用前先用一句话说明会影响哪些卡（`dependencies` 查在用的卡，查不到就说「影响范围未知」）。全局写入（`global-packs`、语音服务、读音词典、声音模板）先说明「这是全局设置，会影响所有卡片」和具体变化。
- 文件必须已经放在工作台目录里，工具不接受网址。超出大小或格式不符时请用户压缩或转换后再传，不擅自转码。
- 保存素材不会重置进行中的游戏：已经在舞台上的背景、音乐、服装保持，直到导演发出新指令；之后的台词才用新声音，已生成的音频不重新合成。

## 按事实报告

- 素材库只通过这些工具读写：`tavern_assets_read`、`tavern_assets_patch`、`tavern_media_upload`、`tavern_assets_transfer`、`tavern_asset_generation`、`tavern_voice_read`、`tavern_voice_patch`。报错里的 `example` 是最小合法骨架：占位符换成读到的值，空数组只表示类型。工具做不到的事，说明缺什么或界面位置。
- 分清：计划（还没调用写工具）、已问你（等你回复）、等待宿主批准、未获批准没有改动（照审批错误的 `message` 转述，会话策略自动拒绝不说成用户拒绝）、已保存（回执成功且回读到目标值）。
- 保存成功只说明数据已写入。画面和声音要用户在素材库预览、试听，或在游玩页看下一轮；没看过就只说「已保存」。
