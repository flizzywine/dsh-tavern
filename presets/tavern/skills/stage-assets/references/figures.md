# 人物

用户要新建素材人物、改名字和别名、服装、差分、头像裁切，或上传立绘和头像时读这篇。字段含义和限制见[人物字段](figure-fields.md)；模型导入见 [Live2D 与 Spine](live2d-spine.md)；人物的声音见[给人物配声音](figure-voice.md)。

人物（figure）保存在素材包里，用 `{packId, figureId}` 标识；人物卡 JSON 里没有放人物的位置，人物靠名字和别名在正文里被认出。每张用到这个包的卡看到的是同一个人物，改名字、服装或图片会影响所有这些卡。卡上没有人物的逐卡覆盖；某张卡开场穿哪套服装在开场画面里设（stage-setup）。

## 新建人物的几条路

| 用户手里有什么 | 走哪条 |
| --- | --- |
| 一张现成的立绘或头像图 | 界面：包里「添加文件」→「人物」选图，每张图建一个人物，名字取自文件名，图成为它的默认立绘。不需要生图接口。工具：先 `create-figure`，再用 `tavern_media_upload image` 上传立绘（见下文） |
| 只有名字（和想要的声音），还没有图 | 工具：`create-figure` 不放图（例子见下文），之后再补图或配声音。没有图的人物在气泡里只显示名字，没有头像 |
| 设定图或几句人物介绍，想让应用画 | 界面：舞台设置 ›「人物」末尾的「添加人物」（设置向导第 2 步的「添加角色」是同一页）：填设定图、人物介绍、名称、触发词，点「生成形象」得到立绘和头像，再点「创建人物」。这一步用应用内生图，按所选生图服务计费，见[应用内生图](generation.md) |
| Live2D / Spine 模型 | 「添加文件」→「导入模型…」，见 [Live2D 与 Spine](live2d-spine.md) |

目前「添加人物」页要先生成出立绘和头像才会出现「创建人物」，没有配置生图时这页建不了人物，在这页选的声音离开不创建也会丢掉。没有生图的用户请走前两条路。

## 调用格式

- 列出包里的人物：`tavern_assets_read({request:{kind:'figures', operation:{action:'item', packId:'…'}}})`，结果带包的 `revision`，每个人物只有 `id`、名字、启用状态和显示形式。
- 读一个人物的完整字段：在 `operation` 里加 `id:'figureId'`。改之前先这样读。
- 字段说明：`tavern_assets_read({request:{kind:'figures', operation:{action:'schema'}}})`。
- 改人物：`tavern_assets_patch({request:{expectedRevision:'包的 revision', operation:{packId:'…', operation:{figureId:'…', operation:{action:'patch-figure', patch:{aliases:[…]}}}}}})`。

## 例子：新建一个还没有图的人物

用户："在测试包里加人物小澄，带一套泳装，先不放图。"

1. 读 `schema {kind:'figures'}`；读 `item {kind:'figures', packId}`，确认包里没有同名人物，记下包的 `revision`。
2. 调用：

   ```js
   tavern_assets_patch({request:{expectedRevision:'第 1 步的包 revision', operation:{packId:'…', operation:{action:'create-figure', figure:{
     name:'小澄', appearance:'sprite', enabled:true, recall:{mode:'keyword'},
     emotions:[{id:'calm', label:'平和'}],
     outfits:[{key:'swimsuit', label:'泳装', enabled:true, recall:{mode:'keyword', keywords:['泳装']}}]
   }}}}})
   ```

   启用的服装至少要一个触发词（这套衣服本身的叫法），否则报 `TRIGGER_LINT`。只用来说话、不上舞台的人物可以不写 `outfits`（这时也不能写 `heightCm`）。
3. 再读 `item {kind:'figures', packId}`，按名字找到小澄的 `id`，带 `id` 读一次，确认差分和服装都在，才报告「已创建」。之后的写入用回执里的新 revision。

给它上传立绘：`tavern_media_upload({request:{action:'image', packId:'…', expectedRevision:'…', file:'images/xiaocheng.png', target:{kind:'sprite', figureId:'…', outfitKey:'swimsuit', emotionId:'calm'}}})`，上传即绑定；头像把 `kind` 换成 `avatar`。

## 先找到人物

用户说名字或别名时，先确定 `{packId, figureId}`：`tavern_assets_read({request:{action:'bindings'}})` 得到当前卡能用的包（`boundPackIds` 和 `globalEnabledPackIds`）→ 对这些包读 `item {kind:'figures', packId}` 按名字选候选 → 用户说的是别名时带 `id` 读详情核对 `aliases`。有多个结果时列出「人物名（包名）」请用户选，不另建别名对照；没有候选就说明这个人物还没创建。

## 常见修改

- **名字与别名**：别名是台词身份和召回共用的叫法，不写和主名重复的项。和其他人物重名会被拒绝，改用能区分的名字。
- **人物灯**：`enabled:false` 为关；`recall.mode` 为 `constant`（蓝灯，每轮可上场）或 `keyword`（绿灯，正文提到名字或别名时才提供）。新建人物默认绿灯。
- **服装与差分**：差分声明在人物的 `emotions` 上，所有服装共用；服装用 `defaultEmotion` 指定默认差分（省略时用第一个）。删除一个差分会从整个人物移除它。
- **头像裁切**：`avatar-crop` 写数值矩形（见[人物字段](figure-fields.md)）；要拖动框选时请用户在界面操作：素材库 › 打开该包的人物 ›「编辑」，在差分格的菜单里用「从立绘裁切…」（头像）或「重新裁切…」（立绘取景）。
- **立绘与头像图片**：上传目标写清人物、服装、差分和类型。有分层或口型的差分不能换成单张图。需要先裁剪、对齐或去背景的图，请用户处理好再传，或交给界面的裁切步骤。本轮没有收到图片文件时请用户提供，不假设已上传。

数组和字典字段整体替换：先读出现有的服装、差分、别名，保留不改的成员再写回。人物只能在它所在的包里改；别的卡也在用而用户只想改这张卡时，先按[包与绑定](packs.md)复制到本卡的包再改副本。

## 完成标准

回读 `item` 显示目标字段，未改的字段保持原值。图片回执 `attached:true` 只说明已绑定，不代表画面合适：请用户在素材库预览或游玩页看一次头像和立绘，尤其是裁切和站位。报告改了哪个包里的哪个人物、哪些卡会受影响。
