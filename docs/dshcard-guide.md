# DSH 人物卡制作指南

> 需要 DSH Tavern v3.0 或更高版本（适配 DSH 0.2.1）才能导入 DSH 人物卡，稳定版（DSH 0.1.5）不支持。当前格式版本为 1。

## DSH 人物卡是什么

DSH 人物卡（后缀 `.dshcard`）是一张普通的 Character Card V3，加上它需要的一切：立绘、背景、音乐这类素材，一段只在这张卡里运行的插件代码，推荐的预设和开局设置。玩家只导入一个文件，不用另装插件、不用手动配素材，开局就是你调好的样子。

它是 CHARX 的超集：去掉 DSH 专有的部分，剩下的 `card.json` 仍是一张合法的 CCv3 卡。Tavern 也能把它导出成 CHARX，给其他支持 CCv3 的前端用，只是少了插件和舞台。

想先看效果，导入[大肥鱼样板卡](https://github.com/flizzywine/dsh-tavern/releases/tag/dafeiyu-card-v1)；想动手做，从下面的最小示例开始；想看一张完整的 Galgame 式卡怎么搭起来，读[开发实例：大肥鱼](dshcard-tutorial.md)。

## 一张卡里有什么

`.dshcard` 就是一个 ZIP 压缩包，改个后缀而已：

```text
阿芙拉.dshcard
├─ card.json                  Character Card V3（必需）
├─ dsh.json                   DSH 清单（必需）
├─ assets/icon/images/…       CCv3 的卡面、表情、背景图片（可选）
├─ assets/<包名>/…            素材包，给插件用的大量素材（可选）
├─ plugins/<文件夹>/…         卡内插件（可选）
└─ presets/<名字>.json        推荐预设（可选）
```

| 部分 | 放什么 | Tavern 怎么处理 |
| --- | --- | --- |
| `card.json` | 人物设定、开场白、世界书、正则、酒馆助手脚本 | 和导入普通 CCv3 卡一样 |
| `card.json` 的 `data.assets` | 指向包里的图片：卡面、各情绪立绘、背景 | 导入为「角色素材」：卡面头像、情绪立绘、背景 |
| `assets/<包名>/` | 插件要用的素材，比如场景、服装、音乐 | 只存储和提供，不解读内容 |
| `plugins/<文件夹>/` | DSH 插件 | 随卡启用，只在这张卡的局里生效 |
| `presets/` | SillyTavern 格式的预设 | 导入预设库，开新局时默认使用 |
| `dsh.json` | 清单：卡的信息、插件、素材包、开局默认 | 读它来决定怎么导入 |

所有路径只用 ASCII 字母、数字、`-`、`_`、`.`，大小写敏感。

## 从最小示例开始

仓库里的 [examples/dshcard-hello](https://github.com/flizzywine/dsh-tavern/tree/main/examples/dshcard-hello) 是一张几十 KB 的完整示例卡「阿芙拉」：一张立绘、一个约 50 行的卡内插件。插件每轮在后台结算里顺带判断这一幕的氛围（温暖、平静、紧张、夜深），自己画的舞台按氛围换底色；本局设置里有一个开关可以关掉它。

```sh
node examples/dshcard-hello/build.mjs
```

生成 `examples/dshcard-hello/阿芙拉.dshcard`，在 Tavern 的人物卡库导入、刷新页面，用阿芙拉开一局，点聊天顶栏的「舞台」打开全屏舞台（「舞台设置」里的「对话气泡」和「舞台模式」默认开着）。

把这个文件夹复制一份，换掉 `card.json`、图片和插件，就是你自己的卡。`build.mjs` 只是把文件按上面的结构写进 ZIP，用任何压缩工具手动打包也一样。

## card.json

就是 Character Card V3 的 JSON（`spec` 为 `chara_card_v3`），从 SillyTavern 导出的卡可以直接用。要让 Tavern 带进立绘，在 `data.assets` 里列出图片，`uri` 用 `embeded://` 指向包里的路径：

```json
"assets": [
  { "type": "icon", "uri": "embeded://assets/icon/images/main.webp", "name": "main", "ext": "webp" },
  { "type": "emotion", "uri": "embeded://assets/emotion/images/neutral.webp", "name": "neutral", "ext": "webp" },
  { "type": "emotion", "uri": "embeded://assets/emotion/images/joy.webp", "name": "joy", "ext": "webp" },
  { "type": "background", "uri": "embeded://assets/background/images/tavern.webp", "name": "tavern", "ext": "webp" }
]
```

- `icon` 名为 `main` 的是卡面头像。
- `emotion` 的 `name` 用 SillyTavern 的 28 种情绪名（`neutral`、`joy`、`anger`、`sadness`、`embarrassment`……），导入后成为对应情绪的立绘，舞台按台词的情绪换图。
- 图片支持 PNG、JPEG、WebP、GIF。
- 这几个 CCv3 类型的目录名（`icon`、`emotion`、`background`、`user_icon`、`other`，以及 `x_` 开头的）是保留名，不能拿来当素材包的名字。

## dsh.json

```json
{
  "format": "dshcard",
  "formatVersion": 1,
  "card": { "version": "1.0.0", "title": "阿芙拉", "author": "你的名字" },
  "requires": { "tavernApi": 2 },
  "plugins": [
    { "name": "dsh-card-hello-mood", "path": "plugins/hello-mood/", "purpose": "每轮按剧情记下氛围，舞台底色跟着变" }
  ],
  "packs": []
}
```

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `format` | 是 | 固定为 `dshcard` |
| `formatVersion` | 是 | 固定为 `1`；比 Tavern 认识的版本新时，导入会提示先更新 Tavern |
| `card` | 否 | `version`、`title`、`author`，给玩家看 |
| `requires.tavernApi` | 否 | 插件用到的插件接口版本，目前写 `2` |
| `plugins` | 否 | 卡内插件列表：`name` 与插件 `package.json` 的 `name` 相同，`path` 是 `plugins/<文件夹>/`，`purpose` 一句话说明用途，导入后在卡片详情里给玩家看 |
| `packs` | 否 | 素材包列表，见下文 |
| `defaults` | 否 | 开局默认，见下文 |

卡里不需要也不应该写唯一标识：Tavern 导入时在本机给它编号。

## 开局默认

`defaults` 是作者推荐的开局方式，只影响用这张卡新开的局，玩家开局后可以在本局设置里随便改；导入卡不会改玩家的全局设置。

```json
"defaults": {
  "preset": { "path": "presets/my-stage.json", "title": "阿芙拉 · 舞台演出" },
  "settings": { "statusBarPlacement": "sidebar", "backgroundTasks": { "posture": true, "variables": true }, "webSearch": false, "sceneImages": false }
}
```

- `preset`：指向包里 `presets/` 下的 SillyTavern 预设 JSON；`title` 是它在预设库里显示的名字。导入时放进预设库，内容相同的直接复用，重名时另取名字。
- `settings`：只认这几项：状态栏位置（`sidebar` 或 `body`）、姿势与变量结算、联网搜索、场景生图。其余字段忽略。模型、API、玩家称呼、长期偏好不由卡决定。
- 舞台不由卡打开：它是玩家的全局开关，「舞台设置 › 基础设置」里「对话气泡」和「舞台模式」都开着时，每一局都有舞台，并标注每句台词的说话人和情绪。旧卡里的 `defaults.stage` 不再读取。

## 素材的两种放法

- **少量图片**（卡面、几张表情、一两张背景）：放在 `assets/icon/images/` 这类 CCv3 目录，用 `card.json` 的 `data.assets` 引用，就够了。Tavern 自带的舞台和对话头像会用它们。
- **成套素材**（几十套服装、上百张背景、音乐、音效）：做成素材包，放在 `assets/<包名>/`，在 `dsh.json` 的 `packs` 里登记，由你的卡内插件读取和解读。

```json
"packs": [
  { "id": "my-backgrounds", "title": "通用背景", "format": "my-format", "path": "assets/backgrounds/",
    "credits": ["assets/backgrounds/credits/CREDITS.md"] }
]
```

- `id`：包的标识，字母、数字、`.`、`_`、`-`，最多 80 个字符；`path` 必须是 `assets/<包名>/`。
- `format`：说明谁来解读这个包，Tavern 不看内容。大肥鱼用的是 Galgame 分支的 `dsh-asset-pack` 格式（`manifest.json` + `media/` + `credits/`），可以照着用。
- `contentHash`（可选）：包内容的摘要。多张卡带同一个包时，摘要相同的只存一份。
- `credits`：署名与许可文件。素材有许可要求时一定写清楚，转码、裁剪这类改动也要注明。
- 插件读包：宿主侧 `listCardPacks({ gameId })` 列出包，`readCardPackFile({ gameId, pack, path })` 读文件；浏览器侧用 `baseUrl + 包内路径` 直接加载。HTML、SVG、JS 只能下载，不会在页面里运行；要运行的代码一律放进 `plugins/`。

## 卡内插件

卡内插件就是普通的 DSH Tavern 插件，写法和接口与全局插件相同，见[插件开发：接口总览](https://github.com/flizzywine/dsh-tavern/blob/main/docs/plugin-api.md)。区别只在于它跟着卡走：

- 导入卡时随卡启用，不需要玩家另装；删除卡时一起卸载。
- 只在这张卡的局里生效：回调只对这张卡的局触发，带别的局的 `gameId` 调接口会被拒绝，浏览器侧注册的界面只在这张卡的局里出现。
- 在这张卡的局里，插件是这一局的一部分：总是启用。玩家要停用，就在卡片详情里整体停用。
- Tavern 按插件 `package.json` 的 `name` 识别插件，同名而内容不同的插件同时只能启用一个：撞名时后导入的卡照常导入，但它的插件不会启用。所以插件名按约定写成 `dsh-card-<卡标识>-<插件名>`，例如大肥鱼的 `dsh-card-dafeiyu-galgame`；`dsh.json` 里的 `name` 写成同一个。

一个插件文件夹有三个文件：

| 文件 | 作用 |
| --- | --- |
| `package.json` | `name` 是插件名（与 `dsh.json` 里的 `name` 相同），`exports` 指向宿主侧和浏览器侧入口 |
| `index.mjs` | 宿主侧：在 Tavern 进程里运行，可以读写每轮数据、参与后台结算 |
| `client.js` | 浏览器侧：画舞台、面板，由页面直接加载，不需要打包 |

示例卡的 [plugin](https://github.com/flizzywine/dsh-tavern/tree/main/examples/dshcard-hello/plugin) 文件夹可以直接复制改。

### 常用写法

| 想做的事 | 用哪些接口 |
| --- | --- |
| 每轮按剧情做个判断（换场景、记氛围），不额外调用模型 | 宿主侧 `settlementSection` 告诉结算模型要做什么，`settlementTool` 接收结果 |
| 把每轮的结果存下来，回退、重新生成时自动对上正文 | `saveTurnData`、`readTurnData` |
| 浏览器侧读宿主侧的结果 | 宿主侧 `handle`，浏览器侧 `tavernUi.callHost` |
| 自己画舞台 | 浏览器侧 `tavernUi.registerStageView`；翻页、朗读、全屏由 Tavern 负责 |
| 新一轮结束后刷新画面 | 浏览器侧 `tavernUi.watchTurnState` |
| 播放背景音乐 | 浏览器侧 `tavernUi.playMusic`；玩家的静音开关由 Tavern 管 |
| 让正文头像跟着情绪换图 | 宿主侧 `castAssetSource` |
| 在本局设置里加选项 | 宿主侧 `gameSettings`、`getGameSettings`，浏览器侧 `tavernUi.watchGameSettings` |
| 读卡带的素材包 | `listCardPacks`、`readCardPackFile`，浏览器侧 `tavernUi.getCardPacks` |

后台结算本来每轮都会调用一次模型，插件借这次调用顺带做事，不会多花一次请求；插件在结算里出错时，Tavern 记下错误，照常完成自己的结算。

### 安全说明

卡内插件和全局插件一样在玩家的电脑上运行。Tavern 能限制的是插件接口层面（只能碰这张卡和它的局），Node 层面的文件和网络访问挡不住。请只在插件里做卡需要的事，并在 `purpose` 里写清楚。

## 打包与调试

1. 把文件按「一张卡里有什么」的结构放好，打成 ZIP，后缀改成 `.dshcard`。
2. 在 Tavern 的人物卡库「导入人物卡」，选这个文件。导入完成后刷新页面，插件的浏览器侧才会加载。
3. 用这张卡开一局，确认舞台、立绘、插件的效果。
4. 改了插件：在卡片详情删掉这张卡，重新打包导入；或者开发时直接改 Tavern 数据目录 `plugins/` 下这张卡的插件文件夹，刷新页面即可看到浏览器侧的改动，宿主侧的改动要重启 Tavern。
5. 插件加载或运行出错时，Tavern 日志里有「插件 … 加载失败 / 出错」的记录；结算里的错误也会显示在本局设置。

导入时常见的提示：

| 提示 | 原因 |
| --- | --- |
| dsh.json 的 format 不是 dshcard | `format` 写错或缺失 |
| 格式版本较新，请先更新 Tavern | `formatVersion` 大于 1 |
| 素材包路径应为 assets/<包名>/ | `packs[].path` 不是一层目录，或包名是保留名 |
| 插件路径应为 plugins/<文件夹>/ | 插件文件夹名只能用小写字母、数字、点、下划线、连字符 |
| 插件 … 缺少可读的 package.json / 没有 name | 插件文件夹里的 `package.json` 缺失或没写 `name` |
| 已经有同名插件 … 在用 | 另一张卡或全局插件用了同样的插件名；卡已导入，插件没有启用 |
| defaults.preset 应指向包内 presets/ 下的 JSON 预设 | 预设路径写错或文件不在包里 |

## 体积与分发

- 图片用 WebP，音乐用 Ogg（Opus 或 Vorbis），体积通常能减半以上。大肥鱼的分发版就是这样从 270 MB 压到 90 MB，压缩脚本见 [examples/dafeiyu-card/compress.mjs](https://github.com/flizzywine/dsh-tavern/blob/main/examples/dafeiyu-card/compress.mjs)。
- 大文件建议放 GitHub Releases（单文件上限 2 GB），再配一份国内网盘；Discord 免费用户单文件只有 10 MB。
- 用到别人的素材，先取得授权，按许可要求署名，并在 `credits/` 里注明你做了哪些改动。

## 参考

- [开发实例：大肥鱼](dshcard-tutorial.md)：按动手顺序拆解大肥鱼：卡片结构、卡内插件怎么导演和画舞台、打包与调试。
- [大肥鱼样板卡](https://github.com/flizzywine/dsh-tavern/releases/tag/dafeiyu-card-v1)：4 个素材包、导演插件、全身立绘舞台、背景音乐、本局配置项，源码在 [examples/dafeiyu-card](https://github.com/flizzywine/dsh-tavern/tree/main/examples/dafeiyu-card)。
- [格式设计](https://github.com/flizzywine/dsh-tavern/blob/main/docs/design/dsh-card-format.md)：为什么这样设计、存储和安全的细节。
- [插件开发：接口总览](https://github.com/flizzywine/dsh-tavern/blob/main/docs/plugin-api.md)：每个接口的参数和行为。
