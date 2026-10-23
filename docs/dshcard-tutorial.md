# DSH 人物卡开发实例：大肥鱼

> 需要 DSH Tavern v3.0 或更高版本（适配 DSH 0.2.1）才能导入 DSH 人物卡，稳定版（DSH 0.1.5）不支持。本文的代码都摘自大肥鱼样板卡的实际文件，源码在 [examples/dafeiyu-card](https://github.com/flizzywine/dsh-tavern/tree/main/examples/dafeiyu-card)。

[DSH 人物卡制作](dshcard-guide.md)讲格式：每个文件、每个字段是什么。这一篇拿[大肥鱼样板卡](https://github.com/flizzywine/dsh-tavern/releases/tag/dafeiyu-card-v1)从头走一遍：一张带 Galgame 式舞台的卡是怎么搭起来的，按动手的顺序讲。

## 先玩一局

导入 `大肥鱼.dshcard`，刷新页面，用大肥鱼开一局，留意这几样：

- 舞台：右侧「酒馆状态」顶部，场景背景、全身立绘、场景下方的对白框，点画面翻到下一句。
- 立绘和正文头像跟着台词的情绪换表情。
- 剧情换了地点或时间，背景跟着换；换服装、换背景音乐也一样。
- 本局设置里有「大肥鱼舞台」一组，两个开关：「舞台导演」「导演换服装」。

这些除了翻页、朗读、静音按钮，都是卡里自带的插件做的。下面拆开看。

## 卡片结构

`.dshcard` 是 ZIP，改成 `.zip` 就能解开。大肥鱼的分发版有 596 个文件、90 MB：

```text
大肥鱼.dshcard
├─ dsh.json                       清单：插件、素材包、开局默认
├─ card.json                      人物卡（Character Card V3）
├─ presets/dafeiyu-stage.json     推荐预设：教正文模型写出好上舞台的文字
├─ plugins/galgame/               卡内插件
│  ├─ package.json
│  ├─ index.mjs                   宿主侧：读素材、每轮导演、存结果
│  └─ client.js                   浏览器侧：画舞台
├─ assets/icon/images/main.png    卡面
├─ assets/dafeiyu/                素材包：人物、服装、立绘、表情头像
├─ assets/china-backgrounds/      素材包：场景背景（分白天、黄昏、夜晚）
├─ assets/general-bgm/            素材包：背景音乐
└─ assets/general-sfx/            素材包：音效
```

文字和代码加起来只有 34 KB：`card.json` 10 KB，插件 20 KB，`dsh.json` 3 KB，预设 1 KB，其余全是素材。做一张卡，工作量主要在人设、素材和那 200 多行插件上。

## 各部分的作用

### dsh.json：告诉 Tavern 怎么导入

```json
"plugins": [
  { "name": "dsh-card-dafeiyu-galgame", "path": "plugins/galgame/", "purpose": "每轮导演舞台：换场景、时段、服装和背景音乐，在舞台上显示" }
],
"defaults": {
  "preset": { "path": "presets/dafeiyu-stage.json", "title": "大肥鱼 · 舞台演出" },
  "settings": { "statusBarPlacement": "sidebar", "backgroundTasks": { "posture": true, "variables": true }, "webSearch": false, "sceneImages": false }
},
"packs": [
  { "id": "af7b2c46-40f1-4ea5-984b-5c03108a238d", "title": "中国通用背景", "format": "dsh-asset-pack",
    "contentHash": "f473aee5…", "path": "assets/china-backgrounds/",
    "credits": ["assets/china-backgrounds/credits/CREDITS.md", "…"] }
]
```

- `plugins`：插件随卡启用。`name` 和插件 `package.json` 里的 `name` 相同，`purpose` 显示在卡片详情里给玩家看。
- 舞台不由卡打开：玩家在「舞台设置」打开「对话气泡」和「舞台模式」（全局开关）后，每局都有舞台，Tavern 会给每句台词标上说话人和情绪，插件的舞台就靠这份标注换表情。`defaults.stage` 不再读取。
- `defaults.preset`：开新局默认用卡里的预设。
- `defaults.settings`：打开后台结算。插件的导演借后台结算运行，玩家关掉所有结算项时，这一轮不结算，导演也不会工作。
- `packs`：4 个素材包，`format` 都是 `dsh-asset-pack`。Tavern 只存储、提供文件，不看内容，由插件解读。

### card.json：一张普通的 CCv3 卡

人设、开场白、世界书都和普通人物卡一样，拿去别的前端也能用。和 DSH 有关的有两处。

`data.assets` 列出卡面和表情图，`uri` 直接指向素材包里的文件，不用另存一份：

```json
{ "type": "icon", "uri": "embeded://assets/icon/images/main.png", "name": "main", "ext": "png" },
{ "type": "emotion", "uri": "embeded://assets/dafeiyu/media/7e44480c….webp", "name": "anger", "ext": "webp" },
```

大肥鱼的表情名用的是素材包自己的 14 种（`calm`、`joy`、`shy`、`smug`、`eating`……），不是 SillyTavern 的 28 种，所以插件里有一张映射表把两者对上（见下文）。

`data.extensions.dsh_tavern.openings` 记着开场的场景，插件读它决定开局的背景、时段和音乐：

```json
"primary": {
  "background": { "assetId": "cn-modern-living", "kind": "backgrounds", "packId": "af7b2c46-…" },
  "music": { "assetId": "mu3eefd8756f", "kind": "music", "packId": "41818b6c-…" },
  "timeOfDay": "night"
}
```

这是 Galgame 分支的写法，Tavern 不解读，你的卡可以用自己的字段。

### 预设：让正文好上舞台

舞台把正文拆成一句句台词和旁白。拆得准不准，取决于正文怎么写。大肥鱼的预设只有一条提示词，专门管这个：

```text
- 人物说话一律写在引号里（“……”或「……」），并让说话人一眼可辨……一段只放一个人的台词。
- 动作、表情、心情写在旁白里，不写进引号；情绪要写得明显（开心、害羞、生气、难过、惊讶……），舞台会按它换表情。
- 地点、时间（白天、黄昏、夜晚）有变化时，在旁白里点明。
```

最后一条是给插件的导演用的：正文点明了地点和时间，导演才知道该换场景。

### 素材包：插件自己解读的素材

每个包是 `manifest.json` + `media/` + `credits/`。`manifest.json` 的 `assets` 列出素材，`blobs` 记着每个文件的扩展名，文件按内容摘要存在 `media/<摘要>.<扩展名>`。一条背景长这样（节选）：

```json
{
  "id": "cn-metro-platform", "kind": "backgrounds", "name": "地铁·屏蔽门站台",
  "recall": { "keywords": ["地铁站台", "地铁站", "屏蔽门", "候车线", "等地铁"] },
  "variants": { "default": "day", "entries": [
    { "id": "day", "content": { "media": "77ceba12…" } },
    { "id": "night", "content": { "media": "b8e5a09d…" } }
  ] }
}
```

`dsh-asset-pack` 是 Galgame 分支定的格式，可以照着用，也可以用你自己的。Tavern 只要求包放在 `assets/<包名>/`、在 `dsh.json` 登记。

## 卡内插件

插件分两半，跑在两个地方：

| 文件 | 跑在哪里 | 大肥鱼用它做什么 |
| --- | --- | --- |
| `index.mjs` | Tavern 进程 | 读素材包；每轮后台结算时顺带当导演，定下场景、时段、服装、音乐，存成按轮数据；把场景交给浏览器侧；把表情头像交给正文 |
| `client.js` | 浏览器页面 | 画舞台：背景、拼好的全身立绘、对白框；放背景音乐 |

`package.json` 指明两个入口：

```json
{
  "name": "dsh-card-dafeiyu-galgame",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.mjs",
    "./client": "./client.js"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["dsh-tavern-plugin"]
    }
  }
}
```

插件名按约定写成 `dsh-card-<卡标识>-<插件名>`。Tavern 按这个名字识别插件，同名而内容不同的插件同时只能启用一个：撞名时后导入的卡照常导入，但它的插件不会启用。

### 宿主侧：导演

入口导出 `name`、`inject` 和 `apply`，接口都在 `ctx.tavern` 上：

```js
export const name = 'dsh-card-dafeiyu-galgame'
export const inject = ['tavern']

export function apply(ctx) {
  const tavern = ctx.tavern
  // ……
}
```

**1. 读素材包。** 每局读一次，缓存起来。`listCardPacks` 列出这张卡带的包，`readCardPackFile` 读包里的 JSON，`baseUrl` 加包内路径就是浏览器能直接加载的地址：

```js
const packs = await tavern.listCardPacks({ gameId })
const json = async (pack, path) => JSON.parse(Buffer.from((await tavern.readCardPackFile({ gameId, pack: pack.id, path })).data).toString('utf8'))
// ……
const media = hash => hash && manifest.blobs?.[hash] ? pack.baseUrl + encodeURIComponent('media/' + hash + '.' + manifest.blobs[hash].ext) : ''
```

开场场景从卡里读：`tavern.getCard({ gameId })`，取上面那段 `openings`。

**2. 在本局设置里加开关。** 玩家在本局设置里看到「大肥鱼舞台」这一组：

```js
if (typeof tavern.gameSettings === 'function') tavern.gameSettings({ title: '大肥鱼舞台', fields: [
  { key: 'director', type: 'boolean', label: '舞台导演', description: '每轮按正文换场景、时段、服装和背景音乐。关掉后舞台停在当前的样子。', default: true },
  { key: 'outfits', type: 'boolean', label: '导演换服装', description: '关掉后大肥鱼一直穿现在这套。', default: true }
] })
```

用的时候 `tavern.getGameSettings({ gameId })` 读玩家的选择。

**3. 每轮导演，不多花一次请求。** Tavern 每轮写完正文都会调用一次后台模型做结算。插件用 `settlementSection` 往这次结算里加一段说明，用 `settlementTool` 给它一个工具：

```js
tavern.settlementSection({ name: 'direct', text: async ({ gameId, turn, text: turnText }) => {
  // ……
  return ['【舞台导演】按本轮正文，调用一次 ' + TOOL + ' 设定舞台；不需要变化的项省略。场景没有变化时不要换。',
    '当前：场景 ' + /* …… */,
    '可选场景（id：名称〔可选时段〕）：' + /* …… */,
    // 服装、音乐同理
  ].filter(Boolean).join('\n')
} })
```

可选场景只列「正文里提到关键词的」加上「当前的」，最多 12 个：背景有上百张，全列出来每轮都要多花不少 token。素材条目里的 `recall.keywords` 就用在这里。

结算模型调用工具时，`execute` 校验参数，把结果存成这一轮的数据：

```js
tavern.settlementTool({
  name: TOOL,
  description: '设定这一幕的舞台：场景、时段、服装、背景音乐。只填需要改变的项。',
  parameters: { type: 'object', properties: {
    scene: { type: 'string', description: '场景 id' }, time: { type: 'string', enum: ['day', 'dusk', 'night'] },
    outfit: { type: 'string', description: '服装 key' }, music: { type: 'string', description: '音乐 id' } } },
  async execute({ gameId, turn, arguments: args }) {
    // ……
    if (args.scene && !scene) return { ok: false, error: '没有这个场景：' + args.scene }
    // ……
    await tavern.saveTurnData({ gameId, turn, data: next })
    return { ok: true }
  }
})
```

`execute` 的返回值会交给模型：给了不存在的 id，就返回 `{ ok: false, error }` 告诉它错在哪。

**4. 查某一轮的场景。** 存的是按轮数据，回退、重新生成时 Tavern 自动对上正文，插件不用自己处理：

```js
async function sceneAt(gameId, turn) {
  const data = await catalog(gameId)
  const record = turn > 0 ? await tavern.readTurnData({ gameId, turn }).catch(() => null) : null
  return { ...data.opening, ...(record?.data || {}) }
}
```

**5. 把场景交给浏览器侧。** `handle` 注册一个处理函数，浏览器侧用同一个名字调用。返回背景地址、当前服装各表情的头像和全身立绘、音乐：

```js
tavern.handle('dsh-card-dafeiyu-galgame/scene', async ({ gameId, turn }) => {
  // ……
  return {
    background: scene ? { name: scene.name, url: scene.variants[current.time] || scene.variants[scene.fallback] } : null,
    time: current.time,
    figure: data.figure ? { names: [data.figure.name, ...(data.figure.aliases || [])], /* avatars、standing …… */ } : null,
    music: track ? { name: track.name, url: track.url } : null
  }
})
```

全身立绘在素材包里有的是整图，有的是分层的部件，`standingPicture` 按包里的配方算出每一层的图片和位置，交给浏览器侧拼。

**6. 正文头像随情绪换。** `castAssetSource` 把大肥鱼当前服装的表情头像交给 Tavern，正文里每句台词旁的头像就跟着情绪变。这里用到前面说的映射表，把 Tavern 标注的 28 种情绪对到素材包自己的表情：

```js
const EMOTIONS = { joy: 'joy', amusement: 'joy', /* …… */ anger: 'anger', annoyance: 'anger', /* …… */
  embarrassment: 'shy', disgust: 'disgust', love: 'love', desire: 'love', pride: 'smug' }
// ……
tavern.castAssetSource({ name: 'figure', characters: async ({ gameId }) => {
  // ……
  return [{ name: data.figure.name, aliases: data.figure.aliases || [], avatarUrl: avatar(outfit?.defaultEmotion || 'calm'), avatars }]
} })
```

### 浏览器侧：挂到舞台上

`client.js` 不需要打包，页面直接加载。外层是固定写法：用 `__ModuleLoader__.load` 登记，`factory` 拿到 `require`（React 由页面提供），返回插件对象：

```js
window.__ModuleLoader__.load({
  id: 'dsh-card-dafeiyu-galgame',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    // ……
    return {
      name: 'dsh-card-dafeiyu-galgame',
      inject: ['tavernUi'],
      apply(ctx) {
        const ui = ctx.tavernUi
        if (typeof ui.registerStageView !== 'function' || typeof ui.playMusic !== 'function') return
        ui.registerStageView({ id: 'galgame', label: '大肥鱼舞台', render: input => h(Stage, { ui, ...input }) })
      },
    }
  },
})
```

`registerStageView` 就是挂进呈现层的那一下：注册之后，全屏舞台改用插件的画面。分工是这样的：

| Tavern 负责 | 插件负责 |
| --- | --- |
| 把正文拆成句、标说话人和情绪 | 场景背景、立绘、对白框长什么样 |
| 翻页、自动播放、退出的按钮（`footer`） | 把 `footer` 放进自己的对白框 |
| 读到最后一句时的输入框（全屏时占底部 88px） | 全屏时把底部 88px 空出来 |
| 播放背景音乐、玩家的静音开关 | 决定放哪首 |

`render` 每次收到 `{ gameId, stage, beats, index, beat, fullscreen, advance, footer }`：`beats` 是拆好的句子，`beat` 是当前这句（台词有 `speaker`、`emotion`），`advance()` 翻到下一句。大肥鱼的 `Stage` 拿到这些后做三件事。

**取场景，新一轮写完时刷新。** `watchTurnState` 在状态变化时通知，`callHost` 调宿主侧的 `handle`：

```js
function useScene(ui, gameId, turn) {
  const [scene, setScene] = React.useState(null)
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => ui.watchTurnState(gameId, () => setVersion(value => value + 1)), [gameId])
  React.useEffect(() => {
    let active = true
    ui.callHost('dsh-card-dafeiyu-galgame/scene', { gameId, turn: turn || 0 }).then(value => { if (active) setScene(value) }, () => {})
    return () => { active = false }
  }, [gameId, turn, version])
  return scene
}
```

**放音乐。** 换了场景音乐就换曲，没有就淡出：

```js
React.useEffect(() => { if (scene) ui.playMusic(track ? { url: track.url, title: track.name } : '') }, [gameId, scene && (track ? track.url : '')])
```

**按台词情绪选立绘，画出来。** 从开头读到当前这句，大肥鱼最后一次说话的情绪就是她现在的表情；没有对应的全身立绘时退回头像：

```js
let emotion = figure ? figure.defaultEmotion : 'calm'
for (const item of beats.slice(0, index + 1)) if (figure && item.kind === 'line' && figure.names.includes(item.speaker)) emotion = EMOTIONS[item.emotion] || figure.defaultEmotion
```

画面上半是场景（背景 + 立绘），下半是固定高度的对白框，`footer` 放在框的最下面，点任何地方都调 `advance` 翻页。分层立绘画进一张 canvas 再缩放（`Standing` 组件），分开缩放时层与层的接缝会露出细线。

## 打包、导入和调试

**打包。** 把文件按上面的结构放好，压成 ZIP，后缀改成 `.dshcard`；压缩时选中这些文件本身，不要连外层文件夹一起压。大肥鱼的 `build.mjs` 是从 Galgame 分支的卡包转换过来的，只适用于它自己；做新卡照着[最小示例的 build.mjs](https://github.com/flizzywine/dsh-tavern/blob/main/examples/dshcard-hello/build.mjs) 写，几十行。

**压体积。** 图片转 WebP、音乐转 Ogg Opus。大肥鱼用 [compress.mjs](https://github.com/flizzywine/dsh-tavern/blob/main/examples/dafeiyu-card/compress.mjs) 从 270 MB 压到 90 MB，还在每个素材包的 `credits/` 里写了一份改动说明，素材许可要求注明改动。

**导入。** 人物卡库 → 导入人物卡 → 选文件，导入后刷新页面，插件的浏览器侧才会加载。

**改插件，不用每次重新打包。** 导入后，插件被复制到 Tavern 数据目录的 `plugins/` 下，文件夹名以 `card-` 开头。开发时直接改这里的文件：

- 改了 `client.js`：刷新页面。
- 改了 `index.mjs`：重启 Tavern。
- 改好了，把文件拷回自己的源码目录，重新打包。

**出错去哪看。** 插件加载失败、运行出错，Tavern 日志里有记录；结算里的错误（比如导演工具抛错）显示在本局设置的「插件」里。`render` 出错时舞台退回内置画面，错误显示在错误提示里。

**自检。** 开一局，玩两三轮：

- 剧情换地点后，下一轮背景换了吗？没换，先看本局设置里有没有结算错误，再看正文有没有点明地点。
- 立绘和头像换表情了吗？没换，看台词是不是写在引号里、情绪是不是写明白了，这两条靠预设。
- 回退一轮、重新生成，舞台回到那一轮的样子了吗？

## 从大肥鱼改出你的卡

1. 复制 `plugin/`，把插件名和 `handle` 的名字换成你的卡名。
2. 换 `card.json` 的人设和开场；`data.assets` 指向你的卡面和表情图。
3. 准备素材。照用 `dsh-asset-pack` 的话，插件读素材的代码基本不用改；用自己的格式，就改宿主侧读包的那一段。
4. 改情绪映射表 `EMOTIONS`，对上你的表情名。
5. 改预设，写清楚你的舞台需要正文怎么写。
6. 打包、导入、玩几轮，按上面的自检过一遍。

各接口的完整参数见[插件开发：接口总览](plugin-api.md)，`dsh.json` 各字段见 [DSH 人物卡制作](dshcard-guide.md)。
