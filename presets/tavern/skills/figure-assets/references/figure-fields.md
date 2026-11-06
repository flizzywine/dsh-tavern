# 人物字段

具体字段名、可选值和上限以 `tavern_assets_read schema {kind:'figures'}` 的返回为准；下面说明它们的用途和容易弄错的地方。

## 人物本身

| 字段 | 用途 |
| --- | --- |
| `name`、`aliases` | 主名和其他叫法。台词身份、召回、开场选择都用它们。 |
| `enabled`、`recall.mode` | 人物灯：关 / 蓝灯 `constant` / 绿灯 `keyword`。 |
| `appearance` | 显示形式：`live2d`、`spine`、`sprite`（静态或分层立绘）、`avatar`（只有头像，不上舞台，例如只在对话或手机里出现的联系人）。缺模型或运行库时按 live2d → spine → sprite → avatar 往下找第一个可用的。 |
| `heightCm`、`heightBasis`、`elevationCm` | 身高（站姿或坐姿基准）和离地高度，舞台按它们计算人物大小与站位，不需要手动校准。 |
| `imageColor` | 形象色，用于名牌等界面点缀；部分模组会自动跟随主角形象色。 |
| `identityAppearance`、`identitySettei` | 生图用的外貌描述和人物设定图，由 asset-generation 使用。 |

## 服装

服装是有序列表，每套有稳定的 `key`（小写字母、数字、`-`、`_`，创建后不改）、显示名 `label`、启用状态 `enabled`，可选的召回设置（蓝/绿灯和触发词，与其他素材相同；服装触发词可以是单字）。服装的"使用情景"（`guidance`，告诉导演什么时候换上）属于 stage-directing。

服装里放这套衣服的立绘、头像、Live2D 引用，以及 `defaultEmotion`（默认差分）和 `fallbackEmotions`（这套服装有意不配图的差分）。服装里没有自己的差分列表。

## 差分

- 人物的 `emotions` 是唯一的差分声明，所有服装共用：`id`（小写字母开头，不透明标识，没有固定的情绪含义）、`label`（1–6 字的显示名）、可选 `guidance`（导演选用说明，最多 60 字）和配音、生图相关字段。
- 服装的 `defaultEmotion` 省略时用人物 `emotions` 的第一项。
- 只有一张图、不需要差分时，人物只有一个不带 label 的差分条目 `{id}`，导演不会看到差分选择。
- 某个差分在这套服装里没有图时，舞台退到这套服装的默认差分并提示缺图；用 `emotion-fallback {emotionId, enabled:true}` 标记为有意回退后不再提示。默认差分本身不能标记。

## 头像

显示头像时依次使用：这个差分专门上传的头像 → 服装的默认头像 → 从静态立绘自动裁出的头部。只有 Live2D 的服装会借用同一人物其他静态服装的头像，不会借别的人物。

`avatar-crop` 和 `emotion-fallback` 按服装嵌套：`tavern_assets_patch({request:{expectedRevision, operation:{packId, operation:{figureId, operation:{outfitKey, operation:{action:'avatar-crop', scope:'state', stateId:'…', crop:{x, y, w, h}}}}}}}})`。

矩形 `{x, y, w, h}` 是相对原图的 0–1 比例，w、h 大于 0，不能超出图片。`scope:'state'` 只改 `stateId` 指定的那个差分，`scope:'outfit'` 改整套服装并清除各差分的单独裁切；`crop:null` 恢复自动裁切。差分有单独上传的头像图时，头像图优先于裁切。

## 图片和模型上传

- 图片目标：`{kind:'avatar'|'sprite', figureId, outfitKey, emotionId}`；设定图用 `{kind:'settei', figureId, outfitKey}` 或 `{kind:'identity-settei', figureId}`。图片要已经是成品：立绘需要透明背景并已裁好尺寸。
- 当前大小限制（以工具报错为准）：头像约 3 MiB，立绘约 6 MiB，每边不超过 8192 像素。超限时请用户压缩后重传。
- 分层立绘（多部件、口型）用 `layered-sprite` 登记整套清单，用 `layered-part` 增改单个部件；这类差分不能用单张图替换。
- Live2D：`bundle` 上传模型目录（相对路径树，入口为 `.model3.json`），然后在服装里写模型引用和 `emotionMap`：每个差分对应 `{expression?, motion?}`，至少一项，名称取自模型自带的表情和动作组。

## 例子

用户："把大肥鱼女仆装的'害羞'头像框往上移一点。"
→ 在当前卡能用的包里找到大肥鱼（见 SKILL.md「先找到人物」）→ `item` 读取女仆装服装和"害羞"差分的现有裁切 → 小幅调整 `y` 后用 `avatar-crop`（`outfitKey` 为女仆装的 `default`，`scope:'state'`，`stateId` 为“害羞”的差分 ID）写入 → 回读。请用户在素材库看预览；如果要反复微调，建议直接用界面的「裁切头像」拖动。
