# DSH 人物卡格式（.dshcard）

2026-10-17 设计备忘，待确认后实施。相关：[从酒馆到 Galgame](tavern-to-galgame.md)、[角色演出](cast-presentation.md)、[插件接口](../plugin-api.md)。

## 为什么要专属格式

之前的结论是"沿用 CCv3/CHARX，不另起格式"。现在改为**专属格式，兼容 CHARX**，原因是新的人物卡可能带程序代码，以 DSH 插件的形式存在：

- **数据和软件要分开**：CHARX 是数据，导入只是读文件；带插件的卡是软件，DSH 插件在宿主侧能读写本机文件、联网，没有沙箱。用不同的后缀，用户、Tavern 和其他工具一眼就能区分"这张卡会运行代码"。
- **CHARX 放不下随卡分发需要的东西**：插件代码、需要的接口版本、权限说明、卡的版本、大体积素材与共用素材包。
- **不能冒充 CHARX**：卡里塞进代码还叫 `.charx`，RisuAI 等前端会默默忽略，用户以为导入的只是数据。

**兼容**：`.dshcard` 内部就是一个 CHARX。改后缀为 `.charx` 后，其他前端照样能当普通卡打开（文字设定、头像、表情、背景都在标准位置）。Tavern 也能把 `.dshcard` 降级导出为 CHARX（去掉代码和扩展素材）。

## 文件结构

ZIP 压缩包，后缀 `.dshcard`。分四块：卡本体（兼容 CHARX）、素材包（只放数据）、代码（脚本和插件）、清单。

```
大肥鱼.dshcard
├─ card.json              Character Card V3，和 CHARX 完全相同；酒馆助手脚本也在这里
├─ assets/<名字>/         所有素材，一个子目录一个包，结构沿用 Galgame 分支的 dsh-asset-pack（manifest.json、media/、credits/……）
├─ plugins/<插件名>/      随卡 DSH 插件：package.json、index.mjs、client.js、assets/
├─ presets/<名字>.json    （可选）卡推荐的预设（SillyTavern 预设 JSON），见下文「开局默认」；文件名用 ASCII，预设库里显示的名字写在 `title`
└─ dsh.json               DSH 清单（见下）
```

**数据和代码分开放**，要运行的东西一眼可见：

| 放什么 | 放哪 | Tavern 怎么对待 |
|---|---|---|
| 卡的文字设定、酒馆助手脚本 | `card.json` | 和导入普通卡一样；脚本在沙箱运行 |
| 所有素材 | `assets/<包名>/` | **不解读内容**，只存储、校验、按地址提供 |
| 其中供其他前端用的头像、表情、背景 | `card.json` 的 `data.assets` 指向 `assets/<包名>/` 里的文件 | 导入为 Tavern 的角色素材（头像、28 种情绪立绘、背景） |
| DSH 插件 | `plugins/` | 随卡启用，只在本卡生效 |

**目录名随意，标识在包里**：一张卡可以带好几个包（大肥鱼带了 4 个：本体加 3 个通用包），所以 `assets/` 下按包分子目录；子目录名只是为了好认（`dafeiyu`、`china-backgrounds`），不是标识。包的标识、版本、摘要写在包自己的 `manifest.json` 里，Tavern 认包、去重都看它，不看目录名。

**和 CHARX 共用 `assets/`**：CHARX 的惯例是 `assets/{类型}/images/…`，类型是 `icon`、`emotion`、`background`、`user_icon`、`other`。所以这几个名字不能当包名（还有以 `x_` 开头的，留给 CCv3 自定义类型）。这样 `.dshcard` 和 Tavern 导出的 CHARX 素材都在 `assets/` 下，路径不会撞。

**素材只放一份**：CCv3 的 `data.assets` 直接指向素材包里的文件（`embeded://assets/dafeiyu/media/<摘要>.png`），不另外复制一份。CCv3 规范只是建议放在 `assets/{类型}/images/`（SHOULD，不是 MUST）；RisuAI 导入 CHARX 时会把包里每个文件按路径登记，任意路径都能解析（`src/ts/process/processzip.ts` 的 `CharXImporter`）。Tavern 自己的角色素材（玩家上传、ST 立绘包导入的）导出时也存成一个素材包，`format` 为 `dsh-cast`。只导出 CHARX（不带素材包）时，按规范的 `assets/{类型}/images/` 写。

**沙箱脚本只有一处**：酒馆助手脚本都在 `card.json` 里，用到 DSH 能力的脚本也一样，不另设目录。`DSH` 对象只在 Tavern 的沙箱里存在，脚本先判断 `typeof DSH !== 'undefined'` 再用；这样同一张卡导出成 CHARX，在 ST、RisuAI 里只是少了这部分效果，不会报错。

规则：
- `card.json` 必须能单独成立：去掉其他所有文件，它仍是一张合法的 CCv3 卡。
- **素材包只放数据**：Tavern 提供包内文件时，按扩展名白名单给类型（图片、音频、视频、字体、JSON、模型和纹理等），一律加 `nosniff`；HTML、SVG、JS 之类能在页面里执行的类型不在酒馆的同一来源下提供，只能作为下载或交给插件自己处理。要在沙箱外运行的东西必须放进 `plugins/`，这样才在摘要和卡片详情的插件列表里。
- 文件路径只用 ASCII，大小写敏感，`/` 分隔（同 CHARX）。
- 支持 ZIP64，单个文件、整个包都可以超过 4 GB 的 ZIP32 限制；Tavern 边读边解压，不整包读进内存。

### `dsh.json`

```json
{
  "format": "dshcard",
  "formatVersion": 1,
  "card": { "version": "1.2.0", "title": "大肥鱼", "author": "…" },
  "requires": { "tavernApi": 2 },
  "plugins": [
    { "name": "dafeiyu-director", "path": "plugins/dafeiyu-director", "version": "1.0.0",
      "sides": ["host", "browser"], "sha256": "…",
      "purpose": "每轮编排舞台：背景、音乐、立绘与镜头",
      "uses": ["runAgent", "network:api.example.com", "cardAssets"] }
  ],
  "packs": [
    { "id": "af7b2c46-…", "title": "中国通用背景", "format": "dsh-asset-pack", "contentHash": "…",
      "bytes": 44360250, "path": "assets/china-backgrounds/", "credits": ["assets/china-backgrounds/credits/CREDITS.md"],
      "url": "https://…/china-backgrounds.zip" }
  ]
}
```

- **卡不带唯一标识**：作者写的标识任何人都能抄进另一张卡，靠它自动判断"这是更新"，等于让别人的卡能顶替你的卡，替换掉文字、素材和插件。所以更新由玩家指定（见下文），卡的身份是 Tavern 导入时在本机给它的编号。`card.version` 只给人看，并在更新时比较新旧。
- `plugins[].sha256`：插件目录内容的摘要，用来判断更新时插件有没有变。
- `plugins[].purpose`、`uses`：给玩家看的用途和用到的能力。**这是声明，不是沙箱**：Tavern 能强制的只有插件接口层面（见下文作用范围），Node 层面的文件和网络访问挡不住。
- `packs`：素材包。`format` 说明由谁解读（例如 `dsh-asset-pack` 由 Galgame 插件解读），Tavern 只认 `format`、文件与摘要、署名许可、包 id。多张卡共用同一个包时按 `contentHash` 去重；包没附带时按 `url` 下载（只接受公开 HTTPS），下载前要玩家确认。插件给这张卡写的素材也存成一个包，归属是这个插件。

## 开局默认

卡可以带上作者推荐的开局设置，写在 `dsh.json` 的 `defaults` 里：

```json
"defaults": {
  "stage": true,
  "preset": { "path": "presets/dafeiyu-stage.json", "title": "大肥鱼 · 舞台演出" },
  "settings": { "statusBarPlacement": "sidebar", "backgroundTasks": { "posture": true, "variables": true }, "webSearch": false, "sceneImages": false }
}
```

- **只是新局的初始值**：导入卡不改全局设置。用这张卡开新局时，卡带的预设和设置作为这一局的初始值，卡没提到的项沿用玩家的全局默认；开局后玩家在本局设置里随便改。已经在玩的局不受影响。
- **舞台**：舞台是玩家的全局开关，不由卡决定：「舞台设置 › 基础设置」里「舞台模式」（默认开）和「对话气泡」都开着时，每一局都有舞台（全屏，从聊天顶栏「舞台」进入），并标注台词的说话人和情绪。`defaults.stage` 不再读取。
- **预设**：导入时放进预设库（重名时另取名字，内容相同的直接复用），新局用它当本局预设。
- **只认少数几项设置**：状态栏位置、姿势与变量结算、联网搜索、场景生图。其余字段忽略，避免卡和版本绑死。
- **不放玩家自己的东西**：模型、API、推理强度、玩家称呼、长期偏好都不由卡决定。
- 导入结果会写明"开新局时默认使用卡里的预设和推荐设置"。

## 两种代码

| | 酒馆助手脚本 | 随卡 DSH 插件 |
|---|---|---|
| 放在哪 | `card.json`（和 SillyTavern 一样） | `plugins/<插件名>/` |
| 跑在哪 | 浏览器沙箱 iframe（现有机制） | 宿主 Node + Tavern 页面 |
| 能用什么 | 酒馆助手接口；在 Tavern 里多一个 `DSH` 对象：读台词标注和舞台数据、朗读、读本卡素材、调用本卡插件 | 完整插件接口，以及 Node 本身的能力 |
| 导入时 | 随卡生效 | 随卡启用，可在卡片详情停用 |

给卡作者的分工建议：界面和每条消息的逻辑写成酒馆助手脚本；需要宿主能力的（后台推演、生图、联网、存大文件、结算任务）写成插件。很多卡只想"念台词、换立绘"，脚本里用 `DSH` 对象就够。

**沙箱与本卡插件之间的通道**：脚本用 `DSH.callCardPlugin(名字, 参数)` 调用本卡插件以 `tavern.handle` 注册的处理函数；插件用 `tavern.emitToCard({ gameId, name, data })` 往这张卡的沙箱推事件，脚本用 `DSH.onCardPlugin(名字, 处理函数)` 接收。通道只连本卡自己的插件，别的插件调不到，也收不到。这样一张卡可以是"沙箱里画界面、插件在后台干活"。

导出成 CHARX 时脚本随 `card.json` 带走，`plugins/` 不进 CHARX。

## 随卡插件

### 作用范围：只在这张卡的局里生效

- 随卡插件和用户全局安装的插件是两种来源。全局插件不变。
- 随卡插件照常注册（`settlementTask`、`registerStageView`……），但 Tavern 在插件接口层按卡限制：
  - 回调（`onTurnSettled`、结算任务、提示词段落等）只对这张卡的局触发；
  - 主动调用（`getTurn`、`saveTurnData`、`runTask`……）带别的局的 `gameId` 一律拒绝；
  - 浏览器侧注册的界面（面板、舞台画面、正文标记）只在打开这张卡的局时出现；
  - 人物卡库接口（`listCards`、`updateCardRaw`）只能读写本卡。
- 在这张卡的局里，随卡插件是这一局的一部分：总是启用，不出现在本局设置的「插件」开关里，它的结算任务也不能单独关掉或调序。要整体停用，在卡片详情里停用卡内插件。
- 插件名在 Tavern 内部加上卡的前缀（例如 `card:<本机卡编号>/dafeiyu-director`），避免和全局插件、其他卡的插件重名。
- 同一张卡被导入两份时，是两张卡，各自的插件互不相干。

### 启用

2026-10-17 决定：**导入不弹确认、不提醒，插件随卡启用**。

1. 导入 `.dshcard`：解包、校验后，插件随卡启用（放进 `plugins/` 加载），导入结果里列出插件名。
2. 人物卡库的卡片详情列出卡内插件，可以停用、再启用。
3. 同名插件已被别的卡启用时，这张卡的插件不启用，导入结果里说明原因。

### 更新

- 导入时默认是新卡。人物卡库里已有同名、同作者的卡时，提示"可能是 大肥鱼 1.1.0 的新版本（1.2.0）"，玩家选**更新这张**还是**另存为新卡**；也可以在人物卡详情里主动"用文件更新"。
- 存档保留；卡文本、素材、插件替换为新版。
- 插件随新版替换；旧版先卸载再加载新版，不混用版本。
- 导入较旧版本时提示降级，由玩家决定。

### 卸载

删除人物卡时，随卡插件一并卸载，素材按引用计数清理（共用素材包还有别的卡在用就保留）。

## 存储层

不论格式怎么定，"插件写素材、存大文件"都要靠这一层。

- **全局内容寻址仓库**：所有素材文件按 SHA-256 存一份（`blobs/ab/cd…`），多张卡、多个插件引用同一文件不重复占空间。
- **按卡、按归属的清单**：每张卡一个清单，记录"归属 → 路径 → 文件摘要 + 类型 + 元数据"。归属有 `tavern.cast`（现在的角色素材）、`plugin:<名字>`、`pack:<id>`。现有的 `cast-assets/<卡>/` 迁移到这里。
- **共用素材包**：作为独立对象存在，卡在清单里引用包 id。
- **读取**：`/api/dsh-tavern/card-blob?…` 支持 Range，可缓存，音频、视频、Live2D 能边下边播。
- **写入**：大文件走流式上传，不再整个转成 base64 放进请求。
- **容量**：每张卡（不含共用包）先定 1 GB 上限；共用包单独计。超出时拒绝并说明。
- **清理**：删卡、更新后，没有引用的文件进入待清理，延迟删除（避免误删正在导入的文件）。

### 插件接口（宿主侧）

```js
await ctx.tavern.putCardAsset({ gameId /* 或 card */, path: 'live2d/maid/model.json', data /* Buffer 或流 */, mediaType, meta })
await ctx.tavern.listCardAssets({ gameId, prefix: 'live2d/' })   // [{ path, size, mediaType, meta, url }]
await ctx.tavern.removeCardAsset({ gameId, path })
await ctx.tavern.saveCastImage({ gameId, name, slot /* 'avatar' | 情绪名 */, data })  // 写角色素材，和玩家上传同一条路
await ctx.tavern.saveCastBackground({ gameId, name, data, main })
await ctx.tavern.setCastVoice({ gameId, name, provider, voice })
```

- 插件只能读写自己的归属；角色素材（`tavern.cast`）可以写，但走 Tavern 的校验（图片格式、大小）。
- 随卡插件只能写本卡；全局插件写哪张卡由 `gameId` 决定，玩家在本局关闭了插件时拒绝。
- 浏览器侧拿 `url` 直接用。

## 和现有格式、Galgame 分支的兼容

- PNG、JSON、CHARX 照常导入；CHARX 的处理不变（见 tavern-to-galgame.md）。
- `extensions.dsh_tavern`：Tavern 已经在用 `cast`；Galgame 分支用了 `schemaVersion`、`assetBindings`（绑定素材包）、`openings`（开场画面）、`stage`（皮肤等）。导入时原样保留不认识的键，导出时不覆盖。`assetBindings.boundPackIds` 和 `dsh.json` 的 `packs` 表达的是同一件事，以后可以互相转换。
- 导出：人物卡库「导出」提供三种：JSON、CHARX（无代码、只带 CCv3 能放的素材）、DSH 人物卡（全部）。

## 验证用例：大肥鱼

Galgame 分支的示例卡「大肥鱼」（`dafeiyu.card-bundle.zip`，274.7 MB，SHA-256 与发行清单一致）已下载拆解，并用脚本试改成 `.dshcard`。

### 它原来的结构

分支已经有一套自己的卡包格式 `dsh-tavern-card-bundle`，和本文的设计很接近：

```
card/card.json                CCv3，extensions.dsh_tavern 里有素材包绑定、开场画面、舞台皮肤
card/cover.png
dsh-tavern-card-bundle.json   format、schemaVersion、cover、dependencies（每个素材包的 id + contentHash）、files
packs/<包 id>/manifest.json   format: "dsh-asset-pack"
packs/<包 id>/media/<sha256>.<ext>   按内容寻址的文件
packs/<包 id>/figures/  sprites/  bundles/  credits/
```

四个素材包：大肥鱼本体（171 MB）、中国通用背景（43 MB，197 个背景）、通用 BGM（55 MB）、通用音效（4.7 MB）。

素材包里的数据模型比 Tavern 的角色素材丰富得多：
- **人物 × 服装 × 情绪**：3 套服装，每套 14 种情绪；情绪是开放集合（`eating`、`singing`、`crashed`、`drooling` 不在 ST 的 28 种里）。
- **分层立绘**：带嘴型帧（a/e/i/o/u/闭）和眨眼图层，供口型同步。
- **Live2D 模型**：每套服装一个，情绪对应表情和动作。
- **背景**：有日夜变体。
- **给模型看的说明**：背景、人物都带检索关键词、`directorNote`（给导演的用法说明）、`generationGuidance`（生图用的情绪描述）。
- **署名与许可**：每个包有 `credits/`（CREDITS、LICENSE、图片来源）。

### 试改结果

脚本（不进仓库）把它改成了：
- `card.json` 放到根目录，补上 CCv3 `assets`：封面作为 `icon`，默认服装（女仆装）的 14 张情绪头像作为 `emotion`；
- `dsh.json` 写卡的标识、版本和 4 个素材包（id、format、contentHash、署名文件）；
- `packs/` 原样放入。

得到 `dafeiyu.dshcard`（288 MB）和去掉素材包的 `dafeiyu.charx`（16 MB）。试改时把头像和情绪图另复制了一份；按"素材只放一份"的结论，应直接指向素材包里的原文件，能省下这 16 MB 的重复。用现在的导入代码试：
- **CHARX 版能导入**：14 种情绪认出 9 种当立绘，Tavern 自带的舞台和对话头像直接可用；`crashed`、`drooling`、`eating`、`singing` 没有对应，原样保留。试的过程中发现 `crying` 抢在 `sad` 前面占了"难过"，已修复：按名字贴近程度排序。
- **`.dshcard` 导入失败**：现在的 zip 读取有 50 MB 上限，并且要整包读进内存。这印证了实施步骤 1、3 必须先做。

### 按定稿结构改写（第二版）

按本文最终的结构重新改了一次：

- 4 个包放进 `assets/dafeiyu/`、`assets/china-backgrounds/`、`assets/general-bgm/`、`assets/general-sfx/`，包内容原样不动。
- `card.json` 放在根目录：封面在 CHARX 惯例的 `assets/icon/images/main.png`（封面不属于任何包）；14 种情绪直接指向 `assets/dafeiyu/media/<摘要>.png`，不复制。
- `dsh.json` 写卡的标识和版本、4 个包（id、format、contentHash、大小、署名文件）；`plugins` 为空。

检查结果：`card.json` 单独是合法的 CCv3；15 个素材地址都能解析；4 个包共 713 个文件逐个核对摘要，全部一致；署名文件齐全；包里没有能执行的文件；包名没有用到保留名。得到 `大肥鱼.dshcard`（272.5 MB）和降级的 `大肥鱼.charx`（16.2 MB）。降级的 CHARX 用现在的导入代码导入，认出 9 种情绪当立绘。

暴露的问题：
- **卡标识**：改写时临时算了一个卡 id，而且是把哈希值排成 UUID 的样子，并不是合法的 UUID。讨论后的结论是卡本来就不该带标识（见 `dsh.json` 一节），已从格式中去掉。
- **`plugins` 是空的**：Galgame 的导演、舞台、Live2D、模组都写在分支的核心代码里，没有可以放进 `plugins/` 的插件。所以这张 `.dshcard` 目前只能做到"三级可用"的前两级：在其他前端是普通卡，在 Tavern 里有头像、立绘和舞台。第三级（服装、Live2D、导演、音乐）要等分支作者把这些改写成一个解读 `dsh-asset-pack` 的插件。这正是插件接口要支撑的事。

### 对格式的结论

1. **素材包直接采用分支的 `dsh-asset-pack` 结构**，不另造：按内容寻址、清单带每个文件的摘要，正是存储层要的。`.dshcard` 的 `assets/<包名>/` 原样放它（分支卡包里的 `packs/<id>/` 导入时按 `dsh-tavern-card-bundle.json` 照认）。
2. **Tavern 不解读素材包的内容**，只认四样：`format`、文件与摘要、署名许可、包 id。服装、分层立绘、Live2D、日夜变体、导演说明属于声明这个 `format` 的插件（这里是 Galgame 插件）。Tavern 自己的角色素材保持简单（头像、28 种情绪立绘、背景、声音），保证不装插件时也能用。
3. **同一张卡分三级可用**：
   - 在 ST、RisuAI 里是一张普通卡（CHARX 部分）；
   - 在 Tavern 里不装插件，有头像、立绘、舞台；
   - 装上 Galgame 插件，有服装、Live2D、导演、音乐。
4. **署名许可是格式的一部分**：`dsh.json` 的每个包列出署名文件，导入后可以查看，导出时必须带上。
5. **服装暂不进 Tavern 自己的角色素材模型**：Tavern 的角色素材是"每个人物一个头像 + 每种情绪一张立绘"，没有"服装"这一层。不装插件时，内置舞台和对话头像只用一套（默认服装）；换装由插件读素材包自己处理。要让内置舞台也会换装，后台结算还得每轮判断"穿哪套"，多一份提示词和费用，等第二个需要服装的插件出现再说。
6. 分支的 `dsh-tavern-card-bundle.json` 可以直接转换成 `dsh.json`（`dependencies` 对应 `packs`），导入时两种都认，这样分支已经发出去的卡包不用重做。

## 实施步骤

每一步单独提交，相关测试和 e2e 通过。

1. **存储层**：全局内容寻址仓库、按卡清单、Range 读取、流式上传、容量与清理；`cast-assets` 迁移进来。行为不变。
2. **插件写素材的接口**：`putCardAsset` 等；文档与示例。
3. **`.dshcard` 读写**：ZIP64、流式解压；`dsh.json` 校验；导入（不含插件）与三种导出；共用素材包去重与下载确认；兼容读取分支的 `dsh-tavern-card-bundle.json`。
4. **随卡插件**：加载、按卡限制、启用与停用、更新与卸载。
5. **沙箱里的 `DSH` 对象与本卡插件通道**。
6. **大肥鱼改造**：作为验收用例和给卡作者的示范。

## 待定

- 后缀名：`.dshcard` 暂定。
- 签名：是否支持作者签名，用来识别"同一作者的更新"。第一版不做。
- 随卡插件能否依赖全局插件，或依赖 npm 包（第一版：只能用宿主已有的模块，和用户插件规则相同）。
- 素材包的独立分发与更新（脱离卡单独升级），第一版只做"随卡带入、按摘要去重"。
