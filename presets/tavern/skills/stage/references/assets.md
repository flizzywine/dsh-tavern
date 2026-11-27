# 素材库

要读写素材包、人物或条目时先读这篇：它是各篇 asset- 和 voice- 参考共用的规则。

素材包属于舞台素材库，不属于某张卡。卡通过绑定使用包，多张卡可以绑定同一个包，所以改包里的内容会影响每张用到它的卡。包里有人物（`figures`，含服装、差分、立绘、模型和声音绑定）和素材条目（背景、CG、音乐、音效、环境音、物品、皮肤、演出风格等）。

工具：`tavern_assets_read`、`tavern_assets_patch`、`tavern_media_upload`、`tavern_assets_transfer`、`tavern_asset_generation`、`tavern_voice_read`、`tavern_voice_patch`。

## 三种读取：存在、本卡、全局

| 想知道 | 调用 | 结果里看 |
| --- | --- | --- |
| 装了哪些包 | `tavern_assets_read({request:{action:'list'}})`，每页最多 50 条，用 `offset` 翻页，`query` 按名字筛选 | 每个包的 `packId`、名字、`revision` 和范围概要 `scope` |
| 这张卡绑定了哪些 | `tavern_assets_read({request:{action:'bindings'}})`，不带 `path` 即当前卡 | `boundPackIds`、`globalEnabledPackIds` 和卡的 `revision`（`bind` 用它） |
| 哪些全局启用 | `tavern_assets_read({request:{action:'settings'}})` | `values.globalEnabledPackIds` 和设置的 `revision`（`global-packs` 用它） |

包在本卡和全局都没有就是关闭。`list` 的 `scope.card` 为 `null` 表示工作台没有关联卡，不是关闭。

**两层开关**：包的范围（全局 / 本卡 / 关闭）决定这张卡能不能用这个包；条目和人物的灯（蓝灯每轮可用、绿灯提到时可用、关）决定导演本轮看不看得到它（[灯态与触发词](asset-lamps-recall.md)）。两层都满足，导演才可能用到。

## 读条目和写条目

- 读条目：`tavern_assets_read({request:{kind:'backgrounds', operation:{action:'item', packId:'…'}}})`，结果带包的 `revision`，只列每条的 `id`、名字和启用状态；在 `operation` 里加 `id` 才返回这一条的完整字段，改之前先这样读。整个包的详情用 `{action:'pack', packId}`。
- 字段说明：`tavern_assets_read({request:{kind:'backgrounds', operation:{action:'schema'}}})`，写之前按它组织字段。
- 改条目：`tavern_assets_patch({request:{expectedRevision:'包的 revision', operation:{packId:'…', operation:{action:'item', item:{…}}}}})`。

用户说的是名字时，用 `list {query}`、`item` 找到 `packId` 与条目 `kind`/`id`；`resolve` 只接受从 `item` 取得的规范引用，不接受名字。

## 写入规则

- 改别的卡也在用的包、全局启用的包，或删除条目、人物、包时，宿主会请用户确认并列出影响；调用前先用一句话说明会影响哪些卡（`dependencies` 查在用的卡，查不到就说「影响范围未知」）。
- 文件必须已经放在工作台目录里，工具不接受网址。超出大小或格式不符时请用户压缩或转换后再传，不擅自转码。
- 保存素材不会重置进行中的游戏：已经在舞台上的背景、音乐、服装保持，直到导演发出新指令；之后的台词才用新声音，已生成的音频不重新合成。
- 工具做不到的事，说明缺什么或界面位置。
