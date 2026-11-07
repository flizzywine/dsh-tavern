---
name: figure-assets
description: "编辑素材包里的人物：新建人物，姓名与别名、人物灯、显示形式、身高与形象色、服装、差分、头像裁切、立绘、Live2D/Spine 模型导入与运行库，上传已有图片和模型。生成新图用 asset-generation；声音用 figure-voice；卡片文字里的人设用 edit-card。"
---

# 素材人物

人物（figure）保存在素材包里，用 `{packId, figureId}` 标识；人物卡 JSON 里没有放人物的位置，人物靠名字和别名在正文里被认出。界面位置：右侧栏「＋」→「舞台素材」打开包，或舞台设置 › 素材包里点包名，再进「人物」；包里「添加文件」→「人物」用一张图新建人物（名字取自文件名）。每张绑定了这个包的卡看到的都是同一个人物，改名字、服装或图片会影响所有用到它的卡。工具：`tavern_assets_read`、`tavern_assets_patch`、`tavern_media_upload`。

对用户说人物、服装和差分时用显示名（名字、`label`），id 只写进工具调用。

## 调用格式

每个工具只有一个 `request` 参数。几个动作共用的字段放在外层，`action` 和这个动作其余的字段放进 `operation`，可以嵌套多层，层级以工具 schema 为准；下文的 `动作 {字段}` 只列出字段。

- 列出包里的人物：`tavern_assets_read({request:{kind:'figures', operation:{action:'item', packId:'…'}}})`，结果带包的 `revision`，每个人物只有 `id`、名字、启用状态和显示形式。
- 读一个人物的完整字段（别名、差分、服装、图片）：在 `operation` 里加 `id:'figureId'`。改人物前先这样读。
- 人物字段：`tavern_assets_read({request:{kind:'figures', operation:{action:'schema'}}})`。
- 改人物：`tavern_assets_patch({request:{expectedRevision:'包的 revision', operation:{packId:'…', operation:{figureId:'…', operation:{action:'patch-figure', patch:{aliases:[…]}}}}}})`。

## 完整例子：新建人物

用户："在测试包里加人物小澄，带一套泳装，先不放图。"

1. 读 `schema {kind:'figures'}` 看字段；读 `item {kind:'figures', packId}`，确认包里没有同名人物，记下包的 `revision`。
2. 调用：

   ```js
   tavern_assets_patch({request:{expectedRevision:'第 1 步的包 revision', operation:{packId:'…', operation:{action:'create-figure', figure:{
     name:'小澄', appearance:'sprite', enabled:true, recall:{mode:'keyword'},
     emotions:[{id:'calm', label:'平和'}],
     outfits:[{key:'swimsuit', label:'泳装', enabled:true}]
   }}}}})
   ```

3. 回执成功后再读 `item {kind:'figures', packId}`，按名字找到小澄的 `id`（即 `figureId`），再带 `id` 读一次，确认差分和服装都在，才报告"已创建"。之后的写入用回执里的新 revision。

改别名同理：带 `id` 的 `item` 读出现有别名和包的 revision → `patch-figure {patch:{aliases:[原有别名…, '澄澄']}}` → 再带 `id` 读一次确认别名列表。

## 先找到人物

用户说"大肥鱼"或它的别名时，先确定规范的 `{packId, figureId}` 再读取或修改。`resolve` 不接受名字，按这个顺序找：

1. `tavern_assets_read({request:{action:'bindings'}})` 得到当前卡能用的包（`boundPackIds` 和 `globalEnabledPackIds`）。
2. 对这些包读 `item {kind:'figures', packId}`，按名字选出候选的 `id`；用户说的是别名时，带 `id` 读候选的详情核对 `aliases`。
3. 需要规范引用时调用 `tavern_assets_read({request:{action:'resolve', refs:[{packId:'…', figureId:'候选 id'}]}})`。

有多个结果时列出"人物名（包名）"请用户选，不自己挑，也不另建别名对照。没有候选就说明这个素材人物还没创建，需要时按上面的例子新建。

## 归属与复制

- 人物只能在它所在的包里修改。包被别的卡使用或全局启用时，宿主会请用户确认共享影响；删除人物或差分也会确认。别的卡也在用这个包（`dependencies`）而用户只想改这张卡的人物时，先 `copy` 到一个绑定给当前卡的包（复制会生成新的人物 ID），再改副本，并说明之后开场等引用要指向副本。
- 卡上没有人物的逐卡覆盖：身高、服装、图片都以包里为准。某张卡开场时穿哪套服装，在开场画面里设置（stage-setup）。

## 常见修改

字段的含义、限制和图片规则读 [人物字段](references/figure-fields.md)。

- **名字与别名**：别名是台词身份和召回共用的叫法，不写和主名重复的项。与其他人物重名会被拒绝，改用能区分的名字。
- **人物灯**：`enabled:false` 为关；`recall.mode` 为 `constant`（蓝灯，每轮可上场）或 `keyword`（绿灯，正文提到名字或别名时才提供）。新建人物默认绿灯。
- **服装与差分**：差分声明在人物的 `emotions` 上，所有服装共用；服装用 `defaultEmotion` 指定默认差分（省略时用人物的第一个差分）。删除一个差分会从整个人物移除它。
- **头像裁切**：可以用 `avatar-crop` 写入数值矩形；需要拖动框选时请用户在界面操作：素材库 › 打开该包的人物 ›「编辑」› 选中差分 ›「裁切头像」（立绘取景用「裁切立绘…」），预览满意后点保存。
- **立绘与头像图片**：工作台里的图片用 `tavern_media_upload` 的 `image`，目标写清人物、服装、差分和类型（立绘或头像），上传即绑定。有分层或口型的差分不能换成单张图。需要先裁剪、对齐或去背景的图片，请用户处理好再上传，或交给界面的裁切步骤。本轮没有收到图片文件时，请用户提供，不假设已上传。
- **Live2D / Spine 模型**：用户自己导入最简单：人物编辑页选中服装 › 切到「模型」视图 ›「导入模型」（已有模型时即替换），或包里「添加文件」→「导入模型…」新建人物。选模型文件夹或 ZIP：Live2D 要 Cubism 3 及以上的 `.model3.json`；Spine 要 `.skel`/`.json` 和同文件夹的 `.atlas`。对话框里给每个差分选表情或动作。用工具时，Live2D 模型目录用 `tavern_media_upload` 的 `bundle` 上传，再用 `patch-figure` 在服装里写引用和 `emotionMap`；Spine 只能在界面导入。
- **运行库**：Live2D 的 Cubism Core、pixi-live2d-display 显示库和 Spine 的 pixi-spine 不随应用分发，也不属于素材包。Live2D：用户在「设置」›「舞台」›「运行库」点「下载并安装…」，同意许可后应用从官方下载 Cubism Core 与 `pixi-live2d-display`（下载失败时可把官网下载的文件拖进来；Core 适用 [Live2D 专有软件许可](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)，显示库适用 [Live2D 开放软件许可](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html)）；Spine 由用户打开官方页下载后导入 `pixi-spine.umd.js`，需要自己的 Spine 授权。舞台上的「Live2D 未安装 · 安装」提示也能打开同一入口。不经同意不会下载。没装时舞台改用同服装的静态立绘，再退到头像。

## 写入顺序

先读取取得包的 `revision`，以它作为 `expectedRevision` 写入，后续写入使用回执里的新 revision。数组和字典字段整体替换，所以先读出现有的服装、差分、别名，保留不改的成员后再写回。收到 `REVISION_CONFLICT` 时重新读取，只重做本次的改动。

## 不会改变进行中的游戏

修改默认服装、服装列表或差分，只影响新出场和之后导演的选择。游戏里角色当前穿的衣服、在场名单不会因为保存素材而重置；导演不发换装指令时保持原样。

## 用工具完成，按事实报告

- 人物只通过本 Skill 的工具读写。报错里的 `example` 是最小合法骨架：占位符换成读到的值，空数组只表示类型、不代表清空。工具做不到的事，说明缺什么或界面位置。
- 报告只描述工具结果里出现的事，分清：计划（还没调用写工具）、已问你（等你回复）、等待宿主批准、未获批准没有改动（照审批错误的 `message` 转述，会话策略自动拒绝不说成用户拒绝）、已保存（回执成功且回读到目标值）。

## 完成标准

写入回执成功，回读 `item` 显示目标字段，未改的字段保持原值。图片上传回执的 `attached:true` 只说明已绑定，不代表画面合适：请用户在素材库预览或游玩页看一次头像和立绘，尤其是裁切和站位。报告改了哪个包里的哪个人物、哪些卡会受影响。
