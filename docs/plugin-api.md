# Tavern 插件接口

接口版本：**2**

DSH Tavern 把扩展功能交给第三方 **DSH 插件**：文生图、文生视频、配音，以及记忆、叙事锚点这类需要参与提示词和后台结算的功能。Tavern 提供一层稳定的接口：让插件知道「这一轮写完了、写了什么」，把图片或别的内容「挂回这一轮」，并往正文请求和后台结算里**添加**内容。多数是添加类接口，插件出错只会丢掉它自己那一份，游戏照常进行；少数替换类接口（如 `replaceSettlement`）让插件接管某个流程，插件失败时自动退回 Tavern 自己的做法。

插件还有一个重要作用：**让 Tavern 吸收作者自己想不到的信息。** 玩家怎么玩、卡作者需要什么，没有谁能全部知道；一个做出来的插件，比一段需求描述更能说明什么值得做。做得好的插件可能被精简后吸收进本体，或者只吸收它的思路；吸收时在提交中署名原作者，插件用的接口不变，原插件照常可用。详见[插件生态](plugin-ecosystem.md)。

## 三条承诺

1. **方便**：插件不需要改 Tavern 源码、不需要读 Tavern 的数据文件、不需要打补丁。
2. **稳定**：接口带版本号，只加不改。Tavern 内部怎么重构，都不影响按本文写的插件。要废弃的东西先标记废弃，至少保留 6 个月。
3. **自由**：挂什么、何时挂、挂几个、用什么模型和服务，全由插件决定。Tavern 只负责显示、和正文版本绑定、回退时隐藏。

反过来，插件也只用本文列出的东西。Tavern 的内部模块、数据目录、内部请求、页面结构都不是接口，随时会变。

## 快速开始

一个插件就是一个文件夹。把它放进 Tavern 数据目录的 `plugins/` 下就会加载，不需要改 Tavern 的任何文件，也不需要打包：

```text
~/.dsh/profile-data/tavern/data/plugins/
└─ dsh-tavern-xxx/
   ├─ package.json   声明宿主侧入口，以及（可选的）浏览器侧
   ├─ index.mjs      宿主侧：用 ctx.tavern
   ├─ client.js      浏览器侧（可选）：用 ctx.tavernUi
   └─ assets/        图片、地图、音效等静态资源（可选），用 tavernUi.assetUrl() 取地址
```

设置了 `DSH_HOME` 时，数据目录在 `$DSH_HOME/profile-data/tavern/data/`。最小示例 [`examples/tavern-plugin-hello`](../examples/tavern-plugin-hello/) 就是这样一个文件夹，整个复制过去即可：宿主侧每轮在第一句话所在段落后挂一张图（先显示「生成中…」再换成图片），浏览器侧把正文里的 `hello###…###` 显示成徽章。把其中的 `drawImage()` 换成你的生图服务，就是一个完整的生图插件。

按「要做什么插件」找写法（配图、记忆、读变量、后台推演、接管结算等），见[常见用法](plugin-recipes.md)。

`package.json` 的写法：

```json
{
  "name": "dsh-tavern-xxx",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.mjs", "./client": "./client.js" },
  "dsh": { "client": { "platform": "web", "inject": ["dsh-tavern-plugin"] } }
}
```

- 宿主侧入口必须有（`exports` 的 `"."`，或 `main`）。只做界面的插件也要放一个空的 `index.mjs`（`export function apply() {}`）。
- 没有浏览器侧时，去掉 `"./client"` 和整个 `dsh` 字段。
- 插件名建议叫 `dsh-tavern-xxx`，方便用户辨认；不能和已安装的包同名（例如 `dsh-tavern-plugin`），否则会被跳过。
- 插件被删除或卸载时要释放的东西（定时器、连接），用 `ctx.effect(() => () => { /* 清理 */ })` 注册。

浏览器侧的 `client.js` 由浏览器直接加载，不需要打包，固定写成下面的样子；`id` 必须和 `package.json` 的 `name` 一致，React 用 `require('react')` 取：

```js
window.__ModuleLoader__.load({
  id: 'dsh-tavern-xxx',
  factory: (require) => {
    const React = require('react')
    return {
      name: 'dsh-tavern-xxx',
      inject: ['tavernUi'],
      apply(ctx) { /* ctx.tavernUi.registerTextMarker(...) 等 */ },
    }
  },
})
```

什么时候生效：

| 操作 | 生效方式 |
|---|---|
| 往 `plugins/` 放进一个新插件 | 不用重启：宿主侧几秒内加载，浏览器侧刷新一次页面后出现 |
| 修改 `client.js` | 不用刷新：几秒内自动换成新代码 |
| 修改 `index.mjs` | 要重启 DSH |
| 删除插件文件夹 | 宿主侧不再加载；刷新页面后浏览器侧消失 |

Tavern 把 `plugins/` 下的插件登记在 DSH 的 Tavern 配置（`~/.dsh/profiles/tavern/cordis.patch.yml`）里，以 `tavern-user-plugin-` 开头的条目由 Tavern 自动维护，不要手改。插件文件夹缺 `package.json` 或宿主入口时会被跳过，原因写在 Tavern 日志里。Tavern 通过插件文件夹里自动生成的 `.tavern-entry.mjs` 加载宿主侧：插件代码有语法错误、导入失败或 `apply` 抛错时，只在日志里记一条「plugins/<文件夹> 加载失败 / 启动失败」，不会让 DSH 起不来。这个文件不要改，也不用提交到插件仓库。

> 不要把插件放进 `tools/` 和 `tools.cordis.yml`：那里是卡片工作台的自创工具，挂在 Agent 预设里，要等第一局开始才加载，浏览器侧也永远不会加载。

## 怎么拿到接口

Tavern 向 DSH 注册了两个服务，插件用 DSH 自带的 `inject` 拿：

| 服务名 | 在哪边 | 用来做什么 |
|---|---|---|
| `tavern` | 宿主（Node） | 监听轮次、读正文与设定、挂媒体、往正文请求和后台结算里加内容、读写人物卡库与 Skill |
| `tavernUi` | 浏览器 | 自定义媒体的显示方式、正文标记、消息按钮、输入框按钮、侧栏面板、全屏界面、替玩家输入、人物卡列表的显示方式、舞台画面、朗读 |

```js
export const name = 'my-image-plugin'
export const inject = ['tavern']

export function apply(ctx) {
  if (ctx.tavern.apiVersion < 2) return  // 用到第 2 版的接口时
  ctx.tavern.onTurnSettled(async (turn) => { /* ... */ })
}
```

两条规则：

- **用 `ctx.tavern.方法名()` 的形式调用**，不要把方法单独取出来（`const { attach } = ctx.tavern` 会报错）。Tavern 靠调用方式认出是哪个插件，从而让各插件只能看到、修改自己的内容。
- **注册类的方法（`onTurnSettled`、`onTimelineChanged`、`promptSection`、`turnSection`、`settlementSection`、`settlementTool`、`worldbookSource`、`register…`）在插件卸载时自动撤销**，也会返回一个撤销函数，可以提前调用。

## 基本概念

| 名词 | 含义 |
|---|---|
| `gameId` | 一局游戏。等于 DSH 的会话编号。 |
| `turn` | 轮次编号，开场白是第 1 轮，玩家的第一轮是第 2 轮。编号只增不减：回退后重新生成的正文用新编号，所以编号可能不连续；被回退的轮次读不到，撤销回退后恢复。区分同一轮的不同正文请用 `textVersion`。 |
| `textVersion` | 这一轮正文的某个版本。重写、编辑、切换版本、回退后重新生成，都会得到新的 `textVersion`。不透明字符串，不要解析。 |
| 媒体项 | 插件挂到某个 `textVersion` 上的一样东西：图片、视频、音频，或插件自定义的类型。 |

**绑定规则**：媒体项只在它绑定的 `textVersion` 是当前显示的版本时出现。回退或切到别的版本时隐藏，切回来又出现。Tavern 不会因为回退而删除媒体项。

## 宿主侧：`tavern`

### `apiVersion`

当前为 `2`。以后新增能力时会增大，旧能力保持不变。浏览器侧的 `tavernUi.apiVersion` 单独计数，当前也是 `2`。

### `onTurnSettled(handler)`

一轮正文写完、后台变量结算结束（成功或失败）后调用一次。同一个 `textVersion` 只通知一次；插件没加载时发生的轮次不补发；开场白不触发，需要时用 `getTurn` 读第 1 轮。

`handler` 收到：

```js
{
  gameId, turn, textVersion,
  greeting,      // 这一轮是不是开场白（onTurnSettled 里总是 false）
  text,          // 这一轮正文的纯文本（去掉了 HTML 标签与程序块，宏已展开）
  rawText,       // 模型原始输出（含插件让模型写进正文的标记）
  card: { id, name },  // id 是人物卡在库里的位置，卡被移动或改名后可能变化
  variables,     // 这一轮结算后的消息变量（副本），没有时为 null
  settledAt,     // 毫秒时间戳
}
```

`variables` 与 SillyTavern 的消息变量同一结构：使用 MVU 变量的卡，变量在 `variables.stat_data` 下。它跟着正文版本走：回退、重新生成、切换版本后读到的是当前显示版本的变量。这是副本，直接改它不影响游戏，要改请用 `setVariables`；Tavern 不解释其中的内容（例如游戏日期），由插件按卡自己的变量名读取。

处理函数里抛错不会影响游戏，错误会写进日志。处理函数不必等生图完成才返回。

### `getTurn({ gameId, turn })`

读某一轮**当前显示版本**的同一份内容（含 `variables`，不含 `settledAt`）。这一轮不存在、或者是还没结算完的最新一轮时返回 `null`。用于插件自己的「手动生成」按钮。只读这一轮，不读整局历史，可以按需随时调用。

### `getTurnState({ gameId })`（第 2 版）

这一局现在的状态，供需要知道「当前是哪一轮、能不能操作」的插件使用：

```js
{
  gameId,
  turn,          // 最新一轮（正文还在生成时，是上一轮写完的那一轮）
  textVersion,   // 最新一轮当前显示的正文版本
  greeting,      // 最新一轮是不是开场白
  generating,    // 前台正在写正文
  settling,      // 后台正在结算（或即将开始）
  busy,          // generating 或 settling
  settled,       // 最新一轮已写完、后台结算已结束
}
```

回退、撤销回退、重新生成后读到的是回退后的当前状态。浏览器侧用 `tavernUi.getTurnState` / `watchTurnState`。

### `getCardContext({ gameId, turn })`

读这一轮可用的设定材料，供插件写画面提示词：

```js
{
  description,   // 人物卡描述
  personality,   // 性格
  scenario,      // 开场情境
  lore,          // 这一轮正文生成时启用的世界书条目：[{ title, keys, constant, content }]
}
```

`lore` 是生成那一刻保存的快照，后来改世界书不影响已写完的轮次；是否与正文相关由插件自己按 `keys` 和 `constant` 判断。没有快照的旧轮次返回空数组。这一轮不可读时抛错。只读这一轮的设定材料，不读整局历史。

### `getCard({ gameId })`（第 2 版）

读这局正在玩的人物卡，返回 SillyTavern 角色卡的数据（`name`、`description`、`personality`、`scenario`、`first_mes`、`character_book`、`extensions` 等，以卡里实际有的字段为准）。开局时保存了人物卡快照的游戏，读到的是快照，和正文生成用的是同一份。返回的是副本，改它不影响游戏。

### `getCardImage({ gameId })`（第 2 版）

读这局人物卡的图片，返回 `{ url, mediaType }`，卡没有图片（例如 JSON 格式的卡）时返回 `null`。`url` 是酒馆页面里可以直接显示的地址（例如 `<img src>`），只读；读到的是人物卡库里这张卡当前的图片，卡从卡库删除后返回 `null`。浏览器侧经 `callHost` 让宿主侧调用即可。

### `getCharacterDesigns({ gameId })`、`saveCharacterDesign({ gameId, name, ... })`（第 2 版）

这一局的人物设计档案（酒馆状态里的「人物设计档案」）：正文、结算和插件读同一份，生图插件画人物时用它，文字和图片的人物设定就不会各说各的。

```js
const { characters } = await ctx.tavern.getCharacterDesigns({ gameId })
// [{ name, aliases, identity, narrativeRole, updatedAt, sections: [{ key, label, text }] }]
const look = characters.find(person => person.name === '林岚')?.sections.find(section => section.key === 'appearance')?.text
```

- `sections` 的 `key` 为 `identity`（身份）、`personality`（性格）、`appearance`（外貌）、`speechStyle`（说话方式）、`narrativeRole`（剧情作用），只列出有内容的项。还没有档案时 `characters` 为空数组。
- `saveCharacterDesign` 新建或更新一个人物，规则和后台结算自己建档时相同：`name`、`identity`、`personality`、`appearance`、`speechStyle`、`narrativeRole` 都要写完整，`aliases` 可选；同名人物会被更新。保存后这个人物同步进本局世界书，后续正文和结算都会用到。适合生图插件根据参考图修订外貌后写回，让文字跟着同一份设定走。
- 档案在后台结算时也会更新，需要最新内容时在 `onTurnSettled` 里重新读取。玩家在本局关闭了插件时，保存会被拒绝。

### `getHistory({ gameId, from, to })`（第 2 版）

读第 `from` 到 `to` 轮已经写完的正文，一次最多 50 轮（省略 `to` 时读 50 轮）。返回 `[{ turn, input, text, rawText }]`：`input` 是玩家这一轮发的话（开场白为空），`text`、`rawText` 的含义同 `onTurnSettled`。还在生成、结算中的最新一轮不返回。只读要的那几轮，长局也不会读整局历史。

### `backgroundModel({ gameId })`

返回这一局 Tavern 使用的后台模型 `{ provider, model, reasoningEffort? }`，没有时为 `null`。`reasoningEffort` 是这局设置的后台推理强度，没设置时不含这个字段。插件可以用它通过 DSH 的 `llm` 服务做自己的规划，不必让用户再选一次模型。

### `runTask({ gameId, prompt, tools?, signal? })`（第 2 版）

让 Tavern 为这局开一个一次性的后台 Agent，替插件完成一项任务，返回 `{ text }`。它用这局的后台模型，带着和 Tavern 自己的后台任务一样的背景：人物卡、世界书、最近两轮剧情，也能查世界书、查历史原文。

```js
const { text } = await ctx.tavern.runTask({
  gameId,
  prompt: '游戏日期从初五跳到了二十。按世界设定，推演这十五天里各方势力的进展，列成要点。',
  tools: [{ name: 'world_event_save', description: '保存一条推演出的事件', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    execute: async ({ text }) => { events.push(text); return { ok: true } } }],
})
```

- 每次都是新的会话，用完即弃，不会进入 Tavern 结算、候选用的那个常驻后台会话，也不影响它们的上下文。
- `tools` 最多 8 个，格式同 `settlementTool`（多一个 `execute`），工具名不能和 Tavern 自己的工具重名；一次任务最多调用 16 次。工具出错时把错误交给模型，同时记入插件错误记录。
- 请求会记进这局的请求记录，「完整上下文」里可以查看。用 `signal`（`AbortSignal`）可以中途停止；10 分钟没结束会自动停止并抛错。
- 这局没有后台模型，或玩家在本局关闭了这个插件时，直接抛错。花的是玩家后台模型的额度，请只在需要时调用。
- 只需要一次普通的模型调用、不需要游戏背景时，直接用 DSH 的 `llm` 服务更省。

### `attach({ gameId, turn, textVersion, item })`

把一个媒体项挂到某个版本上，返回 `{ id }`。`textVersion` 必须是 `onTurnSettled` 或 `getTurn` 给出的这一轮的版本，否则拒绝。用户在生成期间切换了版本也没关系：媒体项照样保存，切回那个版本时显示。

```js
item = {
  kind: 'image' | 'video' | 'audio' | '<插件名>/<类型>',
  status: 'pending' | 'ready' | 'failed',  // 默认 ready
  attachment,    // DSH attachments 服务返回的引用；pending、failed 时可以不填
  progress,      // 0–1，可选；pending 时显示百分比
  anchor,        // 可选：正文里的一句原话，媒体显示在这句所在段落之后；找不到就放在正文末尾
  caption,       // 可选：图注
  error,         // 可选：failed 时显示的原因
  data,          // 可选：插件自己的数据（JSON，≤ 64 KB），Tavern 原样保存、原样返还
}
```

- `image` 用 `attachments.saveImage()` 保存的图片（PNG、JPEG、WebP、GIF）。
- `video`、`audio` 用 `attachments.saveFile({ data, name })` 保存的文件，`name` 要带扩展名（mp4、webm、mov、mp3、m4a、wav、ogg、flac 等），Tavern 按扩展名决定播放方式，支持拖动进度。
- 自定义类型由插件在浏览器侧注册显示方式（见 `registerMediaRenderer`）。
- `anchor`、`caption`、`error` 各不超过 500 字；每局最多 2000 个媒体项。

常见流程：先 `attach` 一个 `status: 'pending'` 的占位，生成完成后 `update` 成 `ready`。

### `update(id, changes)`

修改自己挂的媒体项，`changes` 只需写要改的字段，返回修改后的媒体项。不能修改 `id`、`turn`、`textVersion`。

### `remove(id)`

删除自己挂的媒体项，删掉返回 `true`，不存在或不属于本插件返回 `false`。

### `list({ gameId, turn? })`

列出本插件在这一局（或这一轮）挂的全部媒体项，包括其他版本上的；每项带 `current` 表示是否属于当前显示的版本。

### `onTimelineChanged(handler)`（第 2 版）

这一局的剧情线变了之后调用：回退、撤销回退、重新生成、编辑正文、分叉。`handler` 收到 `{ gameId, kind, turn?, fromGameId? }`，`kind` 是 `rollback`、`undo-rollback`、`regenerate`、`edit`、`fork` 之一；`fork` 时 `gameId` 是新游戏，`fromGameId` 是原游戏。以后可能增加新的 `kind`，不认识的请忽略。

这个通知只是告知。插件的按轮数据会自动跟着剧情线走（见下面的「插件存档数据」），不需要在这里同步。编辑正文后，Tavern 还会对新的正文版本再发一次 `onTurnSettled`，插件可以据此重算这一轮。

### `onGameRemoved(handler)`

一局游戏被删除时调用，收到 `{ gameId }`，供插件清理自己按局保存的数据。插件挂到这局上的媒体项由 Tavern 一并清理。

### `promptSection({ name, text })`

往**游玩时的正文提示词**里加一段，例如「请在正文段落之间写 `image###…###` 标记」。`name` 用小写字母、数字、点、下划线和连字符。`text` 可以是字符串，也可以是函数：每次请求模型前调用，收到 `{ gameId }`，返回空字符串就不加。

- 插件段落放在 Tavern 自己的系统提示之后，多个插件按插件名排序。单段最多 8000 字。
- 只进入游玩时的正文请求，不进入人物卡工作台和后台任务（变量结算、生图规划等）；使用 SillyTavern 兼容请求模式时不生效。
- 段落内容变化会让提示词缓存失效、增加费用，尽量保持不变。
- 函数出错时这一段被跳过，正文照常生成。

> DSH 自带的 `systemPrompt.section` 在 Tavern 游玩时不会生效，因为 Tavern 整体接管了正文提示词。请用这个入口。

`promptSection` 适合不常变的规则。每轮都会变的内容（当前状态、记忆摘要）请用下面的 `turnSection`，不会让提示词缓存失效。

### `turnSection({ name, text, position? })`（第 2 版）

往**这一轮**的正文请求里加一段上下文，例如插件维护的【当前状态】或记忆摘要。`text` 可以是字符串，也可以是函数：每轮准备请求时调用一次，收到 `{ gameId, turn, input }`（`input` 是玩家这一轮的输入原文），返回空字符串就不加。

- `position` 默认 `'after'`：段落放在 Tavern 自己的本轮上下文（世界书、现场状态、Guide 等）之后；`'before'` 放在它们之前。更细的位置（比如某一段的前后）不提供，因为 Tavern 内部的段落顺序会调整。多个插件按插件名排序。单段最多 8000 字。
- 每轮只算一次，结果随这一轮保存；同一轮重试时沿用，不会再次调用。
- 只进入游玩时的正文请求；使用 SillyTavern 兼容请求模式时不生效。
- 函数出错或 30 秒没有返回时，这一段被跳过，正文照常生成。

### `worldbookSource({ name, entries })`（第 2 版）

每轮为正文请求补充世界书条目，和 Tavern 召回的世界书放在一起。`entries` 是函数，收到 `{ gameId, turn, input }`，返回条目数组：

```js
ctx.tavern.worldbookSource({ name: 'side-quests', entries: async ({ gameId, input }) => [
  { title: '钟楼支线', content: '……' },
] })
```

- 要不要加入某条，由插件自己判断（可以按 `input` 匹配关键词）；Tavern 不再按关键词二次筛选。
- 每个来源每轮最多 20 条，每条最多 4000 字；`title` 可省略。
- 其余规则同 `turnSection`：每轮算一次、出错跳过、兼容请求模式不生效。

### `worldbookEntries({ name, entries })`（第 2 版）

把插件自己的条目放进这局的世界书条目池，和人物卡、世界书库的条目一起交给 Tavern 召回：关键词激活、常驻、冷却、筛选复审，以及后台结算、候选和 Agent 查世界书看到的资料，都按 Tavern 自己的规则处理。适合会话临时世界书、NPC 台账、剧情线索这类随游戏变化的条目。

```js
ctx.tavern.worldbookEntries({ name: 'session', entries: async ({ gameId, turn }) => {
  const saved = turn ? (await ctx.tavern.readTurnData({ gameId, turn }))?.data : null
  return (saved?.entries || []).map(item => ({ id: item.id, title: item.title, keys: item.keys, content: item.content }))
} })
```

- 每个条目：`id`（必填，同一来源内唯一，字母、数字、点、下划线和连字符，最多 64 字）、`content`（最多 4000 字）、`title`、`keys`（关键词）、`secondaryKeys`（次要关键词，填了就要求同时命中其中之一）、`constant`（常驻）、`force`（不看关键词直接入选；和其他条目一样受冷却：入选后 10 轮内内容没变就不再重复加入）。每个来源最多 200 条。
- `turn` 是最近写完的一轮（还没有时为 0）。Tavern 每次读条目池都会调用 `entries`（发送前、后台准备、候选、Agent 查世界书等，一轮里会有好几次），所以要快，读插件自己存好的数据即可，不要在这里调用模型。5 秒没有返回或出错时，本次不加插件条目，游戏照常进行。
- 冷却和已读按 `id` 记账：同一个 `id` 改了内容，按新内容重新计算。
- 插件条目是纯文本：含 EJS 模板（`<% %>`）的条目会被跳过。它们只参与召回，不写进人物卡或世界书文件，世界书编辑界面里看不到。
- 不合格的条目（`id` 重复、超长、含模板）被跳过，原因记在「本局设置 → 高级 → 插件」的错误记录里；同一个问题只记一次，直到它变化。
- 和 `worldbookSource` 的区别：`worldbookSource` 由插件自己决定加入哪些内容，直接写进正文请求；`worldbookEntries` 只把条目放进条目池，加不加入由 Tavern 召回决定。

### `settlementSection({ name, text })`（第 2 版）

往每轮的**后台结算**任务里加一段说明，例如「本轮结束时用 `anchor_submit` 记录叙事锚点」。`text` 是字符串或函数，函数收到 `{ gameId, turn }`。出错时跳过。

### `settlementTool({ name, description, parameters, execute })`（第 2 版）

给后台结算的模型一个工具，和 Tavern 自己的结算工具同级。

```js
ctx.tavern.settlementTool({
  name: 'anchor_submit',
  description: '记录本轮的叙事锚点',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  async execute({ gameId, turn, arguments: args }) {
    await save(gameId, turn, args.text)
    return { ok: true }
  },
})
```

- `name` 用小写字母、数字和下划线，以字母开头，3–48 个字符；不能和 Tavern 自己的工具或其他插件的工具重名。
- `execute` 的返回值交给模型：字符串原样给，其他值转成 JSON。抛错或 30 秒没有返回时，模型收到一条失败说明，本轮结算照常进行。
- 每轮结算里，所有插件工具合计最多调用 8 次；插件工具要在模型提交本轮结算之前调用，提交之后再调用会被拒绝。
- 只在后台结算任务里可调用，候选、生图等其他后台任务里调用会被拒绝。
- 插件工具跟着 Tavern 自己的结算一起运行：玩家关掉了所有后台结算项时，这一轮不会运行结算，插件工具也就不会被调用。需要每轮必定执行的逻辑，请放在 `onTurnSettled` 里。
- 工具列表在后台会话建立时固定（它位于请求的缓存前缀里）。插件在启动时注册即可；运行中途才注册的工具，要等下一个后台会话才生效。
- 玩家在本局关掉插件后，它的工具仍在工具列表里（缓存前缀不变），但每轮结算任务会写明哪些插件工具本轮可用、哪些不可用，调用不可用的工具会被拒绝。玩家重新打开插件后，下一轮任务会重新列为可用，并说明以本轮为准，模型不会因为之前回合的拒绝而继续不调用。

### `candidateSection({ name, text })`（第 2 版）

往后台**候选**任务（生成下一步行动选项）里加一段要求，例如「至少给一个探索类选项」。`text` 是字符串或函数，函数收到 `{ gameId }`。出错时跳过，候选照常生成。

### `compactionSection({ name, text })`（第 2 版）

往游玩对话的**上下文压缩**（历史摘要）要求里加一段，例如「摘要里保留每个叙事锚点的原文」。`text` 是字符串或函数，函数收到 `{ gameId }`。只作用于游玩对话；出错时跳过，压缩照常进行。

### `replaceSettlement({ settle })`（第 2 版）

由插件**接管**每轮的后台结算（替换类接口）。适合想用自己的模型和流程做结算、并维护自己状态的插件。

```js
ctx.tavern.replaceSettlement({
  async settle({ gameId, turn, text, posture, tasks, signal }) {
    // text：这一轮的正文；posture：上一轮的现场姿势；tasks.posture：本局是否开启了姿势结算
    // signal：玩家点「停止后台」时中止，把它传给自己的模型请求或子 Agent
    const next = await myModel(text, posture, { signal })
    await ctx.tavern.saveTurnData({ gameId, turn, data: next.state })
    return { posture: next.posture }
  },
})
```

- **必须交回什么**：一个对象。本局开启了姿势结算时，`posture` 必须是非空字符串（最多 8000 字），它会成为下一轮正文看到的【现场】；没开启时可以不返回 `posture`。
- **失败时退回**：`settle` 抛错、120 秒没有返回、或者交回的东西不合格，这一轮自动改用 Tavern 自己的结算，并在「本局设置 → 高级 → 插件」里记下原因。
- **停止**：`signal` 是一个 `AbortSignal`。玩家点「停止后台」时它会中止，Tavern 立刻停止等待，这一轮按玩家停止处理，不会改用 Tavern 自己的结算，也不记为插件错误。插件应据此取消自己的模型请求或子 Agent（例如 `agent.cancel()`）。
- **进度**：结算进行中，Tavern 的后台等待提示会写明「插件「名称」正在结算」。插件为这局建的子 Agent（见下文「插件自建 Agent 的请求记录」）在输出时，提示会区分「模型仍在输出」和「等待模型有效输出」，与 Tavern 自己的结算一样。
- **范围**：只替换普通卡的姿势结算（以及同一步里的人物设计）。使用官方 MVU 变量的卡，变量结算仍由 Tavern 负责，不会调用 `settle`。玩家关掉了所有后台结算项时，这一轮不结算，也不调用 `settle`。
- **只有一个生效**：每个插件只能注册一次。只有一个插件注册时，它自动生效；有多个时，要玩家在「本局设置 → 高级 → 插件」里选一个，选好之前都不生效，用 Tavern 自己的结算。玩家也可以在那里选回 Tavern 自己的结算。

### `settlementTask({ name, title?, phase?, run })`（第 2 版）

注册一个**结算任务**：每轮正文写完后，和 Tavern 自己的结算排在一起依次运行。适合记忆整理、世界推演、写作建议这类每轮都要做、有自己的提示词和流程的后台工作。

```js
ctx.tavern.settlementTask({
  name: 'world-events',
  title: '世界推演',          // 显示给玩家；省略时用 name
  phase: 'after',             // 'before'：在 Tavern 自己的结算之前；'after'（默认）：之后
  async run({ gameId, turn, textVersion, text, variables, phase, signal, runAgent }) {
    const { text: events } = await runAgent({ prompt: '按这一轮的剧情推演各方势力的进展，列成要点：\n' + text })
    await ctx.tavern.saveTurnData({ gameId, turn, textVersion, data: { events } })
  },
})
```

- **顺序**：每轮先跑所有 `before` 任务，再跑 Tavern 自己的结算，最后跑所有 `after` 任务。同一阶段的任务一个接一个运行，默认按插件名、任务名排序；玩家可以在「本局设置 → 高级 → 插件」里调整先后，也可以单独关掉某个任务。
- **下一轮会等它们跑完**：玩家发下一轮时，Tavern 先等这些任务结束，所以这一轮的产出（存进 `saveTurnData`，再用 `turnSection` 注入）一定赶得上下一轮。任务越慢，玩家等得越久。
- **`run` 收到**：这一轮的 `gameId`、`turn`、`textVersion`、`text`、`rawText`、`card`、`variables`（同 `onTurnSettled`），以及 `phase`、`signal`、`runAgent`。`before` 任务看到的是结算前的变量；`after` 任务看到的是 Tavern 结算之后的变量，前面的任务改过变量时，后面的任务读到的是改过的。
- **`runAgent(input)`**：等同 `runTask`，参数相同（`prompt`、`tools`），`gameId` 和 `signal` 已经替你填好。提示词、工具、流程都由插件自己决定，也可以不用它，改用 DSH 的 `llm` 服务。
- **每个正文版本只跑一次**：同一个 `textVersion` 的同一阶段不会重复运行（例如重试结算时）。编辑正文、重新生成产生新版本后会再跑。
- **停止与超时**：玩家点「停止后台」时 `signal` 中止，这一阶段剩下的任务不再运行，不记为错误。单个任务 5 分钟没结束按出错处理。
- **出错**：只记进「本局设置 → 高级 → 插件」的错误记录，接着跑下一个任务；不影响 Tavern 自己的结算和下一轮。
- **进度**：运行中，后台等待提示会写明「插件「插件名 · 任务名」正在结算」，期间本局显示后台忙，候选、编辑等操作要等它结束。
- `before` 任务运行时这一轮还没结算完：可以 `saveTurnData`，不能用 `setVariables`、`editTurn`（它们要等结算结束）。想让 Tavern 的结算用上 `before` 任务的产出，配合 `settlementSection` 把它写进结算说明。
- 开场白不触发结算任务。

### `manualTask({ name, title?, description?, input?, run })`（第 2 版）

注册一个**手动任务**：游玩时状态栏的「插件任务」里出现一个按钮，玩家点了才运行。适合「整理一下记忆」「生成本章总结」这类按需的后台工作。

```js
ctx.tavern.manualTask({
  name: 'chapter-summary',
  title: '本章总结',
  description: '总结到目前为止的剧情',              // 按钮的提示文字
  input: { label: '侧重点（选填）', placeholder: '例如：人物关系' },  // 省略时直接运行，不弹输入框
  async run({ gameId, turn, textVersion, text, variables, input, signal, runAgent }) {
    const { text: summary } = await runAgent({ prompt: '总结本局到目前为止的剧情。侧重点：' + (input || '无') })
    await ctx.tavern.saveGameData({ gameId, data: { summary } })
  },
})
```

- `run` 收到最新一轮（结算结束后的）内容，字段同结算任务；还没有正文时 `turn` 为 `null`。`input` 是玩家在输入框里填的文字（最多 4000 字，可能为空字符串）。
- 和 Tavern 自己的手动任务（设计人物、整理台账）一样独占后台：正文生成中、后台结算或别的任务运行时不能启动；运行期间本局显示后台忙，玩家可以点「停止后台」中止，下一轮会等它结束。
- 10 分钟没结束按出错处理；出错记进插件错误记录。

### `startTask({ gameId, name, input? })`（第 2 版）

替玩家启动本插件的一个手动任务，效果和玩家点按钮一样，任务开始后立即返回 `{ started: true }`。适合插件在自己的面板里放按钮。不能启动时（例如后台正忙）抛错。

### `handle(name, handler)`（第 2 版）

注册一个处理函数，供插件自己的浏览器侧用 `tavernUi.callHost(name, args)` 调用，例如浏览器侧的「重画」按钮让宿主侧去生成。

```js
ctx.tavern.handle('dsh-tavern-xxx/redraw', async ({ gameId, turn }) => {
  const current = await ctx.tavern.getTurn({ gameId, turn })
  // ……生成并 attach
  return { ok: true }
})
```

- `name` 在所有插件之间唯一，建议以插件名开头；用小写字母、数字和 `. _ : / -`，最多 96 个字符。
- `handler` 收到浏览器侧传来的参数（能转成 JSON 的值，最多 256 KB），返回值同样要能转成 JSON（最多 4 MB），原样交回浏览器侧。抛错时浏览器侧的 `callHost` 以同样的错误信息失败。
- 参数里带上 `gameId`：玩家在这一局关掉了插件时，调用会被拒绝；处理函数出错会记进这一局的插件错误。不带 `gameId` 的调用不受按局开关约束。
- 没有超时限制，长任务请自己控制。

## 改最新一轮（第 2 版）

两个接口都只能改**最新一轮**，并且要等这一轮写完、后台结算结束；适合在 `onTurnSettled` 里调用。都要带上 `textVersion`：期间玩家回退、重新生成或已经改过，会报 `TAVERN_PLUGIN_STALE_VERSION`，什么也不改。玩家在本局关闭了这个插件时也会被拒绝。

### `setVariables({ gameId, turn, textVersion, variables })`

用 `variables` 整个替换这一轮当前版本的消息变量（结构同 `onTurnSettled` 收到的 `variables`，MVU 卡的数据在 `stat_data` 下）。先读、改、再整个写回：

```js
ctx.tavern.onTurnSettled(async ({ gameId, turn, textVersion, variables }) => {
  if (!variables?.stat_data) return
  const next = structuredClone(variables)
  next.stat_data.世界.日期 = advance(next.stat_data.世界.日期)
  await ctx.tavern.setVariables({ gameId, turn, textVersion, variables: next })
})
```

- 改完后状态栏随即刷新，下一轮正文和后台结算都以改过的变量为准。
- Tavern 不检查变量结构，写错了会直接影响状态栏和后续结算，请按这张卡的变量结构写。最大 1 MB。
- 这一轮的后台结算还没结束时报 `TAVERN_PLUGIN_TURN_UNAVAILABLE`，下一轮正文已经在生成时报 `TAVERN_PLUGIN_BUSY`，都是稍后再试；在 `onTurnSettled` 里调用就不会遇到。

### `editTurn({ gameId, turn, textVersion, text })`

用 `text` 替换这一轮的正文，走的是玩家「编辑正文」同一条路：回退、分叉照常，宏、脚本和结算不会重跑。返回改后这一轮的内容（同 `getTurn`），里面有新的 `textVersion`。

- `text` 是完整的新正文，请在 `rawText` 的基础上改；不要拿 `text` 字段去改，它去掉了 HTML 块，交回来会被拒绝。正文里的 HTML 块（状态栏、美化代码等）必须原样保留，只能改它们之间的文字，也不能在 HTML 块之间新增段落。
- 改完后所有插件会再收到一次这一轮的 `onTurnSettled`（`textVersion` 是新的）。在 `onTurnSettled` 里改正文的插件，要先判断是不是已经改过，避免反复修改。

## 人物卡库、改卡与 Skill（第 2 版）

不进游戏也能用：卡片工作台类插件（调卡、批量装脚本、整理经验）靠这几个接口读写人物卡和 Skill，不用直接读写 Tavern 的数据目录。

### `listCards()`

人物卡库里的全部卡片：`[{ id, name, fileName, imageUrl, script, group, starred, error }]`。`id` 是其他人物卡接口要的参数；`imageUrl` 没有封面时为空字符串；`script` 是绑定的剧本 `{ title }` 或 `null`；`group` 未分组时为空字符串；`error` 是读取失败的原因。

### `readCardRaw({ card })`

一张卡的完整 JSON（Tavern 实际在玩的工作版），只读副本。结构就是 SillyTavern 人物卡：v2/v3 卡的扩展数据在 `data.extensions` 下，例如酒馆助手脚本在 `data.extensions.tavern_helper.scripts`。

### `updateCardRaw({ card, operations })`

用 JSON Pointer 改这张卡的工作版：

```js
const raw = await ctx.tavern.readCardRaw({ card: id })
const scripts = [...(raw.data.extensions.tavern_helper?.scripts || []), myScript]
await ctx.tavern.updateCardRaw({ card: id, operations: [{ op: 'set', path: '/data/extensions/tavern_helper/scripts', value: scripts }] })
```

- `operations` 1–200 项，每项 `{ op: 'set', path, value }` 或 `{ op: 'delete', path }`；`value` 是 JSON 值，最大 2 MB。返回 `{ changed }`。
- 改的是工作版：导入时的原版保留，玩家随时可以在 Tavern 里恢复人物卡。
- Tavern 不替插件检查卡的语义，写错了会直接影响游玩，请按 SillyTavern 人物卡结构写。

### `toolModes({ name, modes })`

插件用 DSH 的 `tools` 服务注册的工具，默认在游玩和卡片工作台的对话里都会出现。用这个接口限定它出现在哪：`modes` 取 `play`（游玩时写正文的请求）、`card`（卡片工作台），一项或两项。

```js
ctx.tavern.toolModes({ name: 'wrongbook_lookup', modes: ['card'] })  // 只给卡片工作台用
```

只能设置插件自己注册的工具；Tavern 自己的工具由 Tavern 决定。插件卸载时自动撤销。

### `listSkills()`、`readSkill({ name })`、`saveSkill({ name, description, body, references?, overwrite? })`、`removeSkill({ name })`

Tavern 的 Skill：`listSkills` 返回 `[{ name, source, description }]`，`source` 为 `builtin`（内置）或 `user`（玩家自己的）。`readSkill` 返回 `{ name, source, description, content, references }`，`references` 是 `[{ path, content }]`。

- `saveSkill` 新建或覆盖玩家自己的 Skill：`body` 是 SKILL.md 正文，`references` 是完整的参考文件列表（`references/*.md`，最多 30 个，每个最多 10 万字），省略时保留原有参考文件。已存在时要传 `overwrite: true`。内置 Skill 不能覆盖，要改请新建一个自己的。
- `removeSkill` 只能删玩家自己的 Skill。

## 演出：台词标注与角色素材（第 2 版）

玩家在「设置 → DSH Tavern → 显示与交互」打开「对话头像」后，后台结算会顺带标注每轮引号台词的说话人和情绪，人物卡还可以配上各人物的头像和表情立绘（见[角色演出](design/cast-presentation.md)）。这些是给配音、立绘、Galgame 式演出这类插件用的公共数据：插件读它们，不用自己再让模型标一遍。

### `getCast({ gameId, turn })`

读某一轮**当前显示版本**的台词标注，返回 `{ turn, textVersion, lines }`，没有标注时返回 `null`。`lines` 按正文顺序排列：

```js
[{ n: 1, quote: '你来了。', speaker: '林曦', emotion: 'joy' }]
```

- `quote` 是引号里的原话（不含引号），用它在正文里找到这句；`speaker` 是正文里的人名；`emotion` 是 SillyTavern 表情扩展的 28 个情绪名之一（`joy`、`anger`、`neutral`…），可以直接对应 ST 立绘包的文件名。
- 标注跟着正文版本走：重新生成、编辑后旧标注读不到，新版本要等这一轮结算完才有。没被标注的台词（看不出是谁说的）不在列表里。
- 玩家关掉「对话头像」后不再产生新标注，已有的照常可读。

### `onCastAnnotated(handler)`

一轮的标注保存后调用 `handler({ gameId, turn, textVersion, lines })`，字段同 `getCast`。适合配音插件在这时合成语音、演出插件在这时编排下一幕。它在结算过程中触发，早于 `onTurnSettled`；玩家在本局关闭了插件时不通知。

### `getCastAssets({ gameId })`

这局人物卡的角色素材：`{ player, card: { name, imageUrl }, characters: [{ name, aliases, avatarUrl, sprites, voices }] }`。`player` 是玩家名；`sprites` 是 `{ 情绪名: 图片地址 }`；`voices` 是 `{ 配音渠道: 声音 }`；地址都可以直接放进 `<img src>`。素材由玩家在舞台页上传或导入 ST 立绘包，跟着人物卡走，所有用这张卡的局共用。找人物时同时比对 `name` 和 `aliases`。

### `speechProvider({ id, label, description?, voices?, defaultVoice?, synthesize })`

添加一个配音渠道，例如 Edge TTS、火山、自己部署的语音服务。玩家在「设置 → DSH Tavern → 显示与交互 → 配音」的渠道列表里选中它后，台词朗读、舞台朗读和其他插件的 `synthesizeSpeech` 都走这个渠道。

```js
ctx.tavern.speechProvider({
  id: 'edge', label: 'Edge 朗读',
  voices: ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural'],   // 声音输入框的候选，可省略
  defaultVoice: 'zh-CN-XiaoxiaoNeural',
  async synthesize({ text, voice, emotion, signal }) {
    const data = await myTts(text, voice, { signal })
    return { data, mediaType: 'audio/mpeg' }   // Uint8Array 或 Buffer；mp3、wav、ogg、aac、flac
  },
})
```

- `id` 用小写字母、数字、点、下划线和连字符，渠道全名是 `插件名/id`；`label` 1–30 字。
- `voice` 是这个人物在这个渠道上的声音（玩家在舞台页「角色素材」里填），没填时是玩家填的默认声音，再没有就是 `defaultVoice`；`emotion` 是台词标注的情绪名，旁白为 `neutral`。
- 渠道自己的地址、Key 等设置由插件自己保存（DSH 的设置区或凭据服务），Tavern 只保存每个人物用哪个声音。
- 同一渠道、同一声音、同一情绪的同一句话只合成一次，之后读缓存。120 秒没返回或出错时这句不播，错误写进插件错误记录。插件卸载后渠道消失，选着它的玩家听不到配音，直到选别的渠道或插件重新加载。

### `synthesizeSpeech({ gameId, speaker, text, emotion?, narration? })`

用玩家选的渠道和这个人物的声音合成一句，返回 `{ url, mediaType }`，`url` 可以直接交给 `<audio>`。配音关闭、渠道是浏览器朗读（声音在浏览器里合成，宿主侧拿不到音频）、或旁白没有设声音时返回 `null`。`narration: true` 表示旁白，用旁白声音。适合做自己的播放界面、把语音挂进媒体项；只想在浏览器里播放时用 `tavernUi.speak` 更省事。

## 本局插件面板

「本局设置 → 高级 → 插件」列出本局用到的插件、各自用到了哪些阶段（观察、添加、替换），玩家可以按局关掉某个插件，选择由谁负责结算，开关和排序插件的结算任务，并查看最近的插件错误。被关掉的插件在这一局不再参与提示词、结算和通知（`onTurnSettled`、`onTimelineChanged`），它的结算工具调用会被拒绝；它已经挂上的媒体和存档数据保留。

## 插件存档数据（第 2 版）

记忆、叙事锚点这类插件需要按轮保存状态。Tavern 提供两种存储，每个插件只能读写自己的那一份：

| 存储 | 随回退、重新生成变化 | 用来放 |
|---|---|---|
| 按轮数据 | 是，自动 | 记忆、状态、锚点等跟剧情走的东西 |
| 整局数据 | 否 | 插件设置、缓存、跨分支的统计 |

### `saveTurnData({ gameId, turn, textVersion?, data })`

把数据挂在这一轮**当前显示的正文版本**上。`textVersion` 可以省略；给了就必须是当前版本，否则报错（防止把旧回合的结果写到新正文上）。`data` 是能转成 JSON 的值，最多 64 KB；传 `null` 清除这一轮的数据。每个插件每局最多 2000 条、合计 8 MB。返回 `{ turn, textVersion }`。

在 `settlementTool` 的 `execute` 里调用时，用收到的 `gameId`、`turn`，省略 `textVersion` 即可。

插件自己在后台跑的长任务（例如推演），开始时记下这一轮的 `textVersion`，保存时带上它：期间玩家回退、重新生成或切换了版本，保存会报错，过期的结果不会写进当前剧情线。需要提前停掉任务时，监听 `onTimelineChanged`。

### `readTurnData({ gameId, turn })`

读**当前剧情线上第 `turn` 轮及之前最新的一条**，返回 `{ turn, textVersion, data }`，没有时返回 `null`。

不需要处理回退：被回退、被重新生成、被编辑替换掉的正文版本，挂在上面的数据自然读不到；撤销回退后又能读到。推荐每轮存一份**完整状态**，读的时候直接拿最近一条，不用自己拼。

### `saveGameData({ gameId, data })`、`readGameData({ gameId })`

整局数据，不随剧情线变化，最多 256 KB。`readGameData` 没有数据时返回 `null`。

各种操作下的行为：

| 操作 | 按轮数据 | 整局数据 |
|---|---|---|
| 回退 | 被回退的轮次读不到 | 不变 |
| 撤销回退 | 恢复 | 不变 |
| 重新生成、编辑正文 | 新版本还没有数据，旧版本的读不到 | 不变 |
| 分叉 | 分叉点及之前、当前显示的数据带到新游戏 | 复制一份到新游戏 |
| 删局 | 删除 | 删除 |
| 导出、导入存档 | 当前剧情线上的数据随存档带走，导入后在新游戏里照常读到 | 随存档带走 |

分叉、导出存档时，插件挂的媒体项也按同样规则带走，媒体用到的图片、音视频文件一并打进存档包。

这两种数据由 Tavern 存在每局一个的插件数据文件里，插件不用自己找地方存，也不要自己写文件：自己写的文件不会随存档、分叉带走，回退时也不会跟着变。插件自己的设置、跨局共享的东西不属于某一局，用 DSH 的设置区或插件自己的存储。

## 浏览器侧：`tavernUi`

浏览器侧的代码运行在 DSH 页面里，使用 DSH 提供的 `react`。插件的 `render` 函数返回 React 元素；出错时只影响这个元素，正文其余部分照常显示。

### `registerMediaRenderer(kind, render)`

为插件自定义的 `kind`（`<插件名>/<类型>`）提供显示方式，比如边下载边显示、带播放器的卡片。`image`、`video`、`audio` 由 Tavern 显示，不能替换。

```js
render({ item, gameId, turn })  // item 与 list 返回的字段相同，另有 url（有附件时为附件地址）
```

没有注册显示方式的自定义媒体项不显示。

### `registerTextMarker({ pattern, render })`

正文里匹配 `pattern`（正则）的片段交给插件显示，例如把 `image###…###` 换成图片。生成过程中也会调用，此时 `streaming` 为 `true`。

```js
render({ match, groups, gameId, turn, streaming })  // 返回 React 元素；返回 null 或出错时原样显示这段文字
```

- 普通正文里，标记就地替换。
- 写在人物卡自己的 HTML 界面（状态栏、美化面板）里的标记，无法拆开那段 HTML，会从界面里去掉，显示在那段界面之后。
- 标记仍留在对话历史里，后续轮次模型能看到。是否要求模型继续写，由插件在提示词段落里说明。

### `registerMessageAction({ id, label, when, run })`

在每条已写完的助手消息下方加一个按钮，例如「配图」「重画」。`when(context)` 决定是否显示（不传则总是显示），点击时调用 `run(context)`，`run` 可以是异步函数，执行期间按钮不可再点。

```js
context = { gameId, turn, settled }
```

### `registerComposerAction({ id, label, when, run })`

在输入框上方的操作栏加一个按钮，针对当前最新一轮。模型正在生成时按钮不可点。

```js
context = { gameId, turn, busy }
```

想替换内置生图的插件就用这个入口。内置生图的入口在每轮正文下方的操作栏（图片图标），与插件按钮互不占位，由用户选择用哪个。

### `callHost(name, args)`（第 2 版）

调用宿主侧用 `tavern.handle(name, handler)` 注册的处理函数，返回一个 Promise，结果是处理函数的返回值。

```js
ctx.tavernUi.registerMessageAction({
  id: 'redraw', label: '重画',
  run: ({ gameId, turn }) => ctx.tavernUi.callHost('dsh-tavern-xxx/redraw', { gameId, turn }),
})
```

处理函数不存在（插件宿主侧没加载、或没注册这个名字）时失败，错误码 `TAVERN_PLUGIN_NOT_FOUND`。

### `assetUrl(path)`（第 2 版）

插件文件夹里 `assets/` 下文件的地址，用于图片、地图、音效、音乐、字体等：

```js
h('img', { src: ctx.tavernUi.assetUrl('map/forest.png') })
new Audio(ctx.tavernUi.assetUrl('sfx/hit.mp3')).play()
```

- `path` 是相对 `assets/` 的路径，不能含 `..` 或以 `.` 开头的部分。
- 只提供 `assets/` 下的文件，插件文件夹里的代码和设置不会被公开；放进 `assets/` 的文件，打开酒馆页面的人都能读到，不要放密钥。
- 音频、视频支持拖动进度（按范围读取）；文件修改后浏览器会重新取。
- 插件按 `package.json` 的 `name` 认出自己（与浏览器侧 `factory` 返回的 `name` 相同）。只对放在 `plugins/` 文件夹里的插件有效。

### `getTurnState(gameId)`、`watchTurnState(gameId, listener)`（第 2 版）

`getTurnState` 返回 Promise，结果与宿主侧 `tavern.getTurnState` 相同。`watchTurnState` 先用当前状态调用一次 `listener(state)`，之后每次状态变化（开始或写完正文、结算开始或结束、回退等）再调用；返回取消函数，插件卸载时自动取消。只在这一局在当前页面打开时有通知。

### `setInput({ gameId, text })`、`submitInput({ gameId, text })`（第 2 版）

`setInput` 把文字填进这一局的输入框，不发送，玩家可以改了再发。`submitInput` 直接作为玩家输入发送并生成正文，返回 Promise（提交后完成，不等正文写完；要等结果用 `watchTurnState`）。正在生成时会排在当前这轮之后。这一局没有在当前页面打开时报错。

```js
ctx.tavernUi.submitInput({ gameId, text: '我举盾格挡，然后反击。' })
```

### `openOverlay({ gameId?, render, dismissible?, onClose? })`（第 2 版）

打开一层盖住整个页面的插件界面，适合战斗、地图这类需要大空间的玩法。返回 `{ close }`。

```js
const overlay = ctx.tavernUi.openOverlay({
  gameId,
  render: ({ gameId, close }) => h(BattleScreen, { gameId, onFinish: close }),
  onClose: () => { /* 界面关闭后 */ },
})
```

- `render` 收到 `{ gameId, close }`，返回 React 元素；界面自己负责提供关闭的按钮。
- 按 Esc 关闭；`dismissible: false` 时 Esc 不关闭，只能调用 `close`。
- 关闭时调用一次 `onClose`。插件卸载时界面自动关闭。界面出错时显示一行错误和关闭按钮。

### `registerPanel({ id, title, render })`（第 2 版）

在右侧栏加一页插件自己的面板，比如记忆、锚点或状态一览。玩家从侧栏的「＋」里打开，面板显示在「插件」一组。

```js
ctx.tavernUi.registerPanel({ id: 'memory', title: '记忆', render: ({ gameId, visible }) => h(MemoryPanel, { gameId }) })
```

- `id` 用小写字母、数字、点、下划线和连字符；`title` 1–40 字。
- `render` 收到当前侧栏对应的 `gameId`，返回 React 元素；没有打开游戏时，Tavern 显示提示，不调用 `render`。
- 面板出错时只显示一行错误，不影响侧栏其他页。插件卸载时面板自动移除。

### `registerStartGroup({ title, tabs })`（第 2 版）

把插件自己的几个侧栏页归成一组，显示在侧栏开始页（点「＋」看到的那一页）。不声明时，`registerPanel` 的面板在「插件」组，直接用 DSH `betterSidebar.registerTab` 注册的页在「其他」组。

```js
ctx.tavernUi.registerStartGroup({ title: '叙事锚定', tabs: ['narrative-anchor:settings', 'narrative-anchor:state', 'memory'] })
```

- `title` 1–20 字；`tabs` 1–20 个侧栏页 id，按顺序显示。带 `:` 的是侧栏页的完整 id（`registerTab` 时的 `id`）；不带 `:` 的是本插件 `registerPanel` 的 `id`。
- 插件分组排在 Tavern 自带的「本局」「资料库」「偏好」之后、「插件」之前，按注册顺序。Tavern 自己的页不能移进插件分组；同一页被几个分组声明时只显示在第一个里。
- 列出的页没有注册时不显示；整组都没有可显示的页时，整组隐藏。插件卸载时分组自动移除。

### `registerCardListView({ id, label, render })`（第 2 版）

换一种方式显示人物卡列表，例如按分组排的书架、带更多信息的卡片。「人物卡库」和「选择人物卡 · 开始游玩」两处都会用到。列表上方本来就有 Tavern 自带的「列表 / 宫格」切换，注册后多出一个 `<label>`，用户选哪个，这台浏览器就记住哪个。搜索、分组筛选、批量管理的工具栏（全选、删除、移动分组）仍由 Tavern 显示在列表上方，插件只负责画卡片。

```js
ctx.tavernUi.registerCardListView({
  id: 'grid', label: '宫格',
  render({ place, cards, busy, selecting, isSelected, toggle, open, menu, mention }) {
    return h('div', { className: 'my-grid' }, cards.map(card => h('button', {
      key: card.path, disabled: busy, onClick: () => open(card.path),
      'aria-pressed': selecting ? isSelected(card.path) : undefined,
    }, card.imageUrl ? h('img', { src: card.imageUrl, alt: '' }) : null, card.name)))
  },
})
```

`render` 的参数：

| 字段 | 含义 |
|---|---|
| `place` | `'library'`（人物卡库）或 `'play'`（开始游玩窗口） |
| `cards` | 已按搜索和分组筛选、排好序的卡片：`{ path, name, fileName, imageUrl, script, group, starred, error }`。`imageUrl` 没有封面时为空字符串；`script` 是 `{ title }` 或 `null`；`group` 未分组时为空字符串；`error` 是卡片读取失败的原因，正常时为空字符串 |
| `busy` | Tavern 正在导入、删除等操作，期间不要让用户点卡 |
| `selecting` | 是否处于批量管理 |
| `isSelected(path)` | 批量管理时这张卡是否已选 |
| `toggle(path)` | 批量管理时勾选或取消；不在批量管理时什么也不做 |
| `open(path)` | 等于点内置列表的一行：批量管理时勾选或取消，否则在人物卡库打开详情、在开始游玩窗口开局（读取失败的卡不开局） |
| `menu(path)` | Tavern 自己的「⋯ 移到分组」菜单，可放在卡片角上；开始游玩窗口和批量管理时为 `null` |
| `mention(path)` | Tavern 自己的「@ 在对话中引用」按钮，点了把这张卡引用进卡片工作台的输入框，可放在卡片角上；只在卡片工作台的人物卡库、且不在批量管理时有，其余为 `null` |

- `id` 只能用小写字母、数字、点、下划线和连字符；`label` 1–20 字。
- 某一处不想换（例如只想改人物卡库），对那个 `place` 返回 `null`，那里继续用内置列表。
- 显示出错时自动换回内置列表，错误写进错误提示；切换按钮仍在，用户可以重新选。插件卸载后切换消失，回到内置列表。
- 列多少、每格多大、键盘怎么走、Shift 连选这类交互都由插件自己做；`cards` 的顺序就是内置列表的顺序。

### `getStage(gameId, { count? })`、`watchStage(gameId, listener)`（第 2 版）

舞台要显示的东西：`{ enabled, player, card, background, characters, turns }`。`background` 是人物卡带的主背景图地址，没有时为空字符串。`turns` 是最近 `count` 轮（默认 5，最多 10）的 `{ turn, text, lines }`，`text` 是去掉 HTML 块的正文，`lines` 同宿主侧 `getCast`；`characters` 同宿主侧 `getCastAssets`；`enabled` 是玩家是否打开了「对话头像」。`watchStage` 先回调一次，之后在新的一轮、新的标注、素材变化后再回调，只在这一局在当前页面打开时有效。

### `registerStageView({ id, label, render })`（第 2 版）

换掉舞台的画面：右侧栏的「舞台」页和「全屏舞台」都会用它。Tavern 保留阅读流程（逐句翻页、自动播放、读到最后一句时的输入框），插件只画场景，例如加背景、镜头、Live2D、特效。

```js
ctx.tavernUi.registerStageView({
  id: 'vn', label: '视觉小说',
  render({ gameId, stage, beats, index, beat, fullscreen, advance, footer }) {
    const who = beat?.kind === 'line' ? stage.characters.find(c => c.name === beat.speaker) : null
    return h('div', { className: 'my-scene', onClick: advance },
      who?.sprites[beat.emotion] ? h('img', { src: who.sprites[beat.emotion] }) : null,
      h('div', { className: 'my-textbox' }, beat?.speaker, beat?.text, footer))
  },
})
```

`render` 的参数：

| 字段 | 含义 |
|---|---|
| `stage` | 同 `getStage` 的返回值 |
| `beats` | 最新一轮拆成的「句」：`{ kind: 'line', text, speaker, emotion, turn }`（标注过的台词所在的一行）或 `{ kind: 'narration', text, turn }`（旁白段落） |
| `index`、`beat` | 当前读到第几句、这一句 |
| `fullscreen` | 是否在全屏舞台里 |
| `advance()` | 翻到下一句，点击场景时调用 |
| `footer` | Tavern 的翻页、自动、退出按钮，请放进插件自己的文字框里 |

- 注册后舞台默认用插件的画面；舞台页顶部出现「舞台样式」选择，玩家可以选回内置，这台浏览器记住选择。插件卸载后回到内置舞台。
- `render` 返回 `null` 或出错时用内置画面，错误写进错误提示。只想换全屏、不换右侧栏时，对 `fullscreen === false` 返回 `null`。
- 舞台入口只在玩家打开「对话头像」后出现。
- 完整示例见 [`examples/tavern-plugin-director`](../examples/tavern-plugin-director/)：宿主侧用结算任务做「导演」，每轮定下地点、时间和气氛；浏览器侧按它画舞台。

### `speak({ gameId, speaker?, text, emotion?, narration? })`、`stopSpeech()`（第 2 版）

在当前页面朗读一句，用玩家选的配音渠道和这个人物的声音（浏览器朗读也可以）。返回的 Promise 在读完时为 `true`，被打断、配音关闭或失败时为 `false`。同一时间只读一句，新的一句会打断正在读的；`stopSpeech()` 立即停止。适合插件的舞台画面、自己的面板逐句朗读。

## 插件自建 Agent 的请求记录

插件用 DSH 的 `agents` 服务为某局游戏建子 Agent 时（例如自己做结算），只要创建时把 `meta.parentSession` 设为这局的 `gameId`，这个 Agent 发出的模型请求就会自动记进这局的请求记录：作为后台请求，归在当时最新的一轮，和 Tavern 自己的请求一样只保留最近 30 轮原文。在该子 Agent 的会话里打开「完整上下文」即可查看。插件不需要调用任何接口，也不要自己写 Tavern 的请求记录文件。

Tavern 只给顶层会话（玩家的游戏会话）加回合上下文和「【酒馆状态】」这类提示；带 `parentSession` 的子 Agent 会话一律不加，插件 Agent 收到的只有插件自己给的内容。

## 暂时没有的

下面这些目前还没有接口，不代表不能开放。有实际需要时请提[插件接口需求](https://github.com/flizzywine/dsh-tavern/issues/new?template=plugin-api.yml)，写清要做的插件和卡在哪一步，能开放的会按需补上。

- 修改更早的轮次（`setVariables`、`editTurn` 目前只改最新一轮）。
- 直接使用 Tavern 自己的常驻后台会话：它带着整局的结算历史，插件任务混进去会影响之后的结算。需要游戏背景的后台工作请用 `runTask`。
- 替换 Tavern 的其他流程（提示词组装、世界书召回、候选、压缩、MVU 变量结算）。替换类接口会约定插件要交回的结果，插件失败时退回 Tavern 自己的做法。

直接读写 Tavern 的数据目录和人物卡文件不属于接口：这些文件的格式会随版本变化，插件这样做，Tavern 一更新就可能失效。需要里面的数据，请按上面的方式提需求，由 Tavern 提供读取接口。

## 用 DSH 自带的

- 插件设置页：用 DSH 的设置区（`settings.section`）。
- 模型调用、凭据、附件存储：用 DSH 的 `llm`、`credentials`、`attachments` 服务。

## 已知限制

- 修改插件的宿主侧代码（`index.mjs`）后要重启 DSH 才生效。这是 DSH 的机制。
- 开场白不触发 `onTurnSettled`。

## 缺接口怎么办

Tavern 尽量开放接口，并保持每个接口简单、稳定；接口按插件实际用到的内容补充，实在不能开放的会说明原因。现有接口和 DSH 自带的服务都做不到时，请提一个[插件接口需求](https://github.com/flizzywine/dsh-tavern/issues/new?template=plugin-api.yml)，写清要做的插件、卡在哪一步、试过什么办法。请不要靠改 Tavern 源码或读 Tavern 数据文件绕过去，那样 Tavern 一更新插件就会失效。

## 版本记录

| 版本 | 变化 |
|---|---|
| 1 | 首个版本。 |
| 2 | 新增 `turnSection`、`worldbookSource`、`settlementSection`、`settlementTool`：插件可以往每轮正文请求和后台结算里添加内容。新增插件存档数据（`saveTurnData`、`readTurnData`、`saveGameData`、`readGameData`）与 `onTimelineChanged`；编辑正文后重新发 `onTurnSettled`；分叉时带上插件数据和媒体项。新增第一个替换类接口 `replaceSettlement`，以及本局插件面板（按局开关、选择结算由谁负责、错误记录）。新增 `candidateSection`、`compactionSection`、`worldbookEntries`；新增 `getCharacterDesigns`、`saveCharacterDesign`（人物设计档案）、`listCards`、`readCardRaw`、`updateCardRaw`、`toolModes` 与 Skill 读写（`listSkills`、`readSkill`、`saveSkill`、`removeSkill`）；浏览器侧新增 `registerPanel`、`registerStartGroup`、`registerCardListView`（`tavernUi.apiVersion` 为 2）。`onTurnSettled`、`getTurn` 增加只读的 `variables`。新增 `getCard`、`getCardImage`、`getHistory`、`setVariables`、`editTurn`、`runTask`。新增宿主侧 `handle` 与浏览器侧 `callHost`，插件的浏览器侧可以调用自己的宿主侧。新增 `settlementTask`、`manualTask`、`startTask`：插件可以定义每轮结算前后运行的任务和玩家手动运行的任务。新增 `getTurnState`，`onTurnSettled`、`getTurn` 增加 `greeting`；浏览器侧新增 `getTurnState`、`watchTurnState`、`setInput`、`submitInput`、`openOverlay`、`assetUrl`（插件文件夹的 `assets/` 静态资源）。导出存档包含插件存档数据和媒体项，导入后照常可读。插件可放进数据目录的 `plugins/` 文件夹加载。新增演出接口：宿主侧 `getCast`、`onCastAnnotated`、`getCastAssets`，浏览器侧 `getStage`、`watchStage`、`registerStageView`。新增配音接口：宿主侧 `speechProvider`、`synthesizeSpeech`，浏览器侧 `speak`、`stopSpeech`。第 1 版接口不变。 |
