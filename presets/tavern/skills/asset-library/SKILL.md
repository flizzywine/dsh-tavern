---
name: asset-library
description: "管理舞台素材包：查看已装的包、本卡绑定和全局启用，安装、更新、导出包，绑定到卡，切换包的全局/本卡/关闭，编辑背景、音乐、音效、环境音、CG、皮肤等条目的灯态和触发词。人物用 figure-assets；分享整卡用 card-sharing。"
---

# 素材包

素材包属于舞台素材库，不属于某张卡。卡通过绑定使用包，多张卡可以绑定同一个包，所以改包里的内容会影响每张用到它的卡。工具：`tavern_assets_read` 读取，`tavern_assets_patch` 修改，`tavern_media_upload` 上传工作台里的文件，`tavern_assets_transfer` 安装、下载和导出。

对用户说包、条目和皮肤时用显示名（说「雨夜街道」，不说 `rainy-street-02`），id 只写进工具调用。

## 三种读取：存在、本卡、全局

| 想知道 | 调用 | 结果里看 |
| --- | --- | --- |
| 装了哪些包（存在） | `tavern_assets_read({request:{action:'list'}})`，每页最多 50 条，用 `offset` 翻页，`query` 按名字筛选 | 每个包的 `packId`、名字、`revision` 和范围概要 `scope` |
| 这张卡绑定了哪些（本卡） | `tavern_assets_read({request:{action:'bindings'}})`，不带 `path` 即当前卡 | `boundPackIds` 和卡的 `revision`（`bind` 用它） |
| 哪些全局启用（全局） | `tavern_assets_read({request:{action:'settings'}})` | `values.globalEnabledPackIds` 和设置的 `revision`（`global-packs` 用它） |

包在本卡和全局都没有就是关闭。`list` 的 `scope.card` 为 `null` 表示工作台没有关联卡，不是关闭。这些都是包的范围，不是条目的蓝绿灯，也不表示导演本轮一定会用到。

## 调用格式

每个工具只有一个 `request` 参数。几个动作共用的字段放在外层，`action` 和这个动作其余的字段放进 `operation`，可以嵌套多层，层级以工具 schema 为准；下文的 `动作 {字段}` 只列出字段。条目类读取把 `kind` 放在外层：

- 读条目：`tavern_assets_read({request:{kind:'backgrounds', operation:{action:'item', packId:'…'}}})`，结果带包的 `revision`，只列每条的 `id`、名字和启用状态；在 `operation` 里加 `id` 才返回这一条的完整字段，改条目前先这样读。整个包的详情用 `{action:'pack', packId}`。
- 条目字段：`tavern_assets_read({request:{kind:'backgrounds', operation:{action:'schema'}}})`，写条目前按它组织字段。
- 改条目：`tavern_assets_patch({request:{expectedRevision:'包的 revision', operation:{packId:'…', operation:{action:'item', item:{…}}}}})`。
- 新建包：`tavern_assets_patch({request:{action:'create-pack', name:'…', description:'…', expectedRevision:null}})`，回执给出 `packId` 和包的第一个 revision。

## 完整例子

**只给这张卡绑定一个包**

1. `tavern_assets_read({request:{action:'bindings'}})`：记下卡的 `revision` 和现有 `boundPackIds`。
2. `tavern_assets_patch({request:{expectedRevision:'第 1 步的卡 revision', operation:{action:'bind', boundPackIds:['原有包ID', '新包ID']}}})`。列表整体替换，原有的包要一起带上。只改本卡，不需要全局确认。
3. 再读 `bindings`：新包出现在 `boundPackIds` 里，才报告"已绑定到这张卡"。

**把包设为全局启用（全局写入）**

1. `tavern_assets_read({request:{action:'settings'}})`：记下设置的 `revision` 和现有 `values.globalEnabledPackIds`。
2. 告诉用户"这是全局设置，会影响所有卡片：把「通用音效」设为全局启用，所有卡的导演都能选用其中的音效"，然后调用 `tavern_assets_patch({request:{expectedRevision:'第 1 步的设置 revision', operation:{action:'global-packs', globalEnabledPackIds:['原有包ID', '该包ID']}}})`。宿主在这次调用中请用户确认。
3. 回执成功后再读 `settings`，包在 `globalEnabledPackIds` 里才报告"已全局启用"。回执是审批类错误时，按下文的报告方式说明没有改动，不换方式重试。

## 先定位，再修改

- 用户说的是名字（"走廊背景""通用音效包"），用 `list {query}` 和 `item` 找到 `packId` 与条目 `kind`/`id`。`resolve` 不接受名字，只接受从 `item` 取得的规范引用 `{packId, kind, assetId}`。多个候选同名时列出"条目名（包名）"请用户选，不按名字猜 ID。
- 用户的话有歧义（"把不用的都关掉"）时，先用三种读取列出现状，再请用户指定范围。

## 两层开关

- **包的范围**：全局（蓝灯，所有卡可用，`global-packs`）、本卡（绿灯，写入当前卡的绑定，`bind`）、关闭。用户只想让这张卡用，就绑定到本卡；想让所有卡都用，才改全局。
- **条目的灯**：`enabled:false` 为关；启用后 `recall.mode` 为 `constant`（蓝灯，每轮都提供给导演）或 `keyword`（绿灯，正文命中触发词、或智能判断认为相关时才提供）。

这两层决定导演能选哪些素材；功能本身的开关（四态，含本卡开启/关闭）在 stage-setup 和 stage-mods。灯态和触发词怎么选，读 [灯态与触发词](references/lamps-recall.md)。

## 界面位置与影响范围

- 包的范围：舞台设置 ›「素材包」›「管理」，每个包的标签选「全局 / 本卡 / 关闭」，「完成」收起。包内容：右侧栏「＋」→「舞台素材」，或点舞台设置里的包名；包里「添加文件」加人物、背景、CG、音乐等（条目名取自文件名，建议用正文里会出现的叫法），包的「⋯」有「复制」「导出」。
- 影响范围：包里的内容（人物、服装、差分、触发词、条目灯）影响所有用到这个包的卡；把包设为全局或把全局包改成本卡/关闭影响所有卡；本卡与关闭之间切换只影响这张卡。
- 「另存副本」的人物卡和原卡共用同一批包。只想改副本的素材时：复制包（`copy`，或界面包的「⋯」→「复制」）→ 副本卡把新包设为本卡、原包设为关闭 → 只改新包。原包是全局的，关掉它会影响所有卡，先说明。设置向导创建的「本卡素材包」里已经是副本，可以直接改。

## 写入顺序

包、卡绑定、全局设置各有自己的 `revision`，分别来自 `item`、`bindings`、`settings` 的读取结果，不能混用；连续写入时改用上一次回执里的新 revision。

- 收到 `REVISION_CONFLICT`：重新读取目标，在最新内容上只重做这次要改的部分。不要把旧的整段内容写回去，那会覆盖用户刚做的修改。
- 改全局（`global-packs`、`catalogue-settings`）前，按上面的例子说明影响和具体变化。
- 改或删一个包前，用 `dependencies` 看还有哪些卡在用。别的卡也在用而用户只想改这张卡时，先用 `copy` 复制到新包，再把当前卡的绑定从原包换成副本；复制和改绑是两步，分别报告结果。依赖数量查不到时如实说"影响范围未知"。
- 修改别的卡也在用或全局启用的包、删除条目或包时，宿主也会请用户确认并列出影响；调用前先用一句话说明会影响哪些卡。
- 删除包不会改写卡的绑定和历史记录，缺失的引用会保留并显示诊断。

## 媒体

文件必须已经放在工作台目录里，工具不接受网址。音频（音乐、音效、环境音）先 `tavern_media_upload` 的 `blob` 得到 hash 和新 revision，再用条目修改把 hash 写进条目；只上传不写条目，素材不会出现。图片用 `image` 目标，上传与绑定一次完成。超出大小限制或格式不符时，请用户压缩或转换后再传，不要擅自转码。

## 不会重置游戏中的状态

改条目、改灯或关闭包，只影响之后导演能选什么。正在进行的游戏里已经播放的音乐、环境音、当前背景不会因为保存素材而重置；导演不输出新指令时状态保持。环境音独立于背景，换背景不会换掉或清空环境音。以游玩页的实际表现为准，不承诺"马上换掉"。

## 安装、更新与导出

从链接、目录或 ZIP 安装素材包、检查更新、处理冲突和导出包，读 [安装与导出](references/transfer.md)。

## 用工具完成，按事实报告

- 素材包、绑定和全局启用只通过本 Skill 的工具读写。报错里的 `example` 是最小合法骨架：占位符换成读到的值，空数组只表示类型、不代表清空。工具做不到的事，说明缺什么或界面位置。
- 报告只描述工具结果里出现的事，分清：计划（还没调用写工具）、已问你（等你回复）、等待宿主批准、未获批准没有改动（照审批错误的 `message` 转述，会话策略自动拒绝不说成用户拒绝）、已保存（回执成功且回读到目标值）。

## 完成标准

写入回执成功，并且回读（`item`、`bindings` 或 `settings`）显示了目标值。交付时说明改了哪个包或哪个条目、影响哪些卡，并请用户在下一轮游玩中留意效果。保存成功只说明数据已写入，导演是否真的选用要看实际游玩。
