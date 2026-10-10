# Tavern 插件接口

接口版本：**2**

DSH Tavern 把扩展功能交给第三方 **DSH 插件**：文生图、文生视频、配音，以及记忆、叙事锚点这类需要参与提示词和后台结算的功能。Tavern 提供一层稳定的接口：让插件知道「这一轮写完了、写了什么」，把图片或别的内容「挂回这一轮」，并往正文请求和后台结算里**添加**内容。目前开放的都是添加类接口；插件出错只会丢掉它自己那一份，游戏照常进行。

## 三条承诺

1. **方便**：插件不需要改 Tavern 源码、不需要读 Tavern 的数据文件、不需要打补丁。
2. **稳定**：接口带版本号，只加不改。Tavern 内部怎么重构，都不影响按本文写的插件。要废弃的东西先标记废弃，至少保留 6 个月。
3. **自由**：挂什么、何时挂、挂几个、用什么模型和服务，全由插件决定。Tavern 只负责显示、和正文版本绑定、回退时隐藏。

反过来，插件也只用本文列出的东西。Tavern 的内部模块、数据目录、内部请求、页面结构都不是接口，随时会变。

## 快速开始

最小示例：[`examples/tavern-plugin-hello`](../examples/tavern-plugin-hello/index.mjs)。每轮正文写完后，它在第一句话所在段落的后面挂一张图，先显示「生成中…」，再换成图片。把其中的 `drawImage()` 换成你的生图服务，就是一个完整的生图插件。

只有宿主侧代码的插件，可以放进 Tavern 用户数据目录：代码放在 `tools/<名称>/`，再在 `tools.cordis.yml` 里加一条（见[用户自创工具](user-extensions.md)）：

```yaml
- id: tavern-plugin-hello
  name: ./tools/tavern-plugin-hello/index.mjs
  config: {}
```

需要浏览器侧界面（自定义显示、正文标记、按钮）的插件，按 DSH 插件包的方式发布和安装。插件名建议叫 `dsh-tavern-xxx`，方便用户辨认。插件都需要**完整重启 DSH** 才会加载，刷新页面不够。

## 怎么拿到接口

Tavern 向 DSH 注册了两个服务，插件用 DSH 自带的 `inject` 拿：

| 服务名 | 在哪边 | 用来做什么 |
|---|---|---|
| `tavern` | 宿主（Node） | 监听轮次、读正文与设定、挂媒体、往正文请求和后台结算里加内容 |
| `tavernUi` | 浏览器 | 自定义媒体的显示方式、正文标记、消息按钮、输入框按钮 |

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
| `turn` | 轮次编号，开场白是第 1 轮。编号只增不减：回退后重新生成的正文用新编号，所以编号可能不连续；被回退的轮次读不到，撤销回退后恢复。区分同一轮的不同正文请用 `textVersion`。 |
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
  text,          // 这一轮正文的纯文本（去掉了 HTML 标签与程序块，宏已展开）
  rawText,       // 模型原始输出（含插件让模型写进正文的标记）
  card: { id, name },  // id 是人物卡在库里的位置，卡被移动或改名后可能变化
  settledAt,     // 毫秒时间戳
}
```

处理函数里抛错不会影响游戏，错误会写进日志。处理函数不必等生图完成才返回。

### `getTurn({ gameId, turn })`

读某一轮**当前显示版本**的同一份内容（不含 `settledAt`）。这一轮不存在、或者是还没结算完的最新一轮时返回 `null`。用于插件自己的「手动生成」按钮。只读这一轮，不读整局历史，可以按需随时调用。

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

### `backgroundModel({ gameId })`

返回这一局 Tavern 使用的后台模型 `{ provider, model }`，没有时为 `null`。插件可以用它通过 DSH 的 `llm` 服务做自己的规划，不必让用户再选一次模型。

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

### `candidateSection({ name, text })`（第 2 版）

往后台**候选**任务（生成下一步行动选项）里加一段要求，例如「至少给一个探索类选项」。`text` 是字符串或函数，函数收到 `{ gameId }`。出错时跳过，候选照常生成。

### `compactionSection({ name, text })`（第 2 版）

往游玩对话的**上下文压缩**（历史摘要）要求里加一段，例如「摘要里保留每个叙事锚点的原文」。`text` 是字符串或函数，函数收到 `{ gameId }`。只作用于游玩对话；出错时跳过，压缩照常进行。

### `replaceSettlement({ settle })`（第 2 版）

由插件**接管**每轮的后台结算（替换类接口）。适合想用自己的模型和流程做结算、并维护自己状态的插件。

```js
ctx.tavern.replaceSettlement({
  async settle({ gameId, turn, text, posture, tasks }) {
    // text：这一轮的正文；posture：上一轮的现场姿势；tasks.posture：本局是否开启了姿势结算
    const next = await myModel(text, posture)
    await ctx.tavern.saveTurnData({ gameId, turn, data: next.state })
    return { posture: next.posture }
  },
})
```

- **必须交回什么**：一个对象。本局开启了姿势结算时，`posture` 必须是非空字符串（最多 8000 字），它会成为下一轮正文看到的【现场】；没开启时可以不返回 `posture`。
- **失败时退回**：`settle` 抛错、120 秒没有返回、或者交回的东西不合格，这一轮自动改用 Tavern 自己的结算，并在「本局设置 → 插件」里记下原因。
- **范围**：只替换普通卡的姿势结算（以及同一步里的人物设计）。使用官方 MVU 变量的卡，变量结算仍由 Tavern 负责，不会调用 `settle`。玩家关掉了所有后台结算项时，这一轮不结算，也不调用 `settle`。
- **只有一个生效**：每个插件只能注册一次。只有一个插件注册时，它自动生效；有多个时，要玩家在「本局设置 → 插件」里选一个，选好之前都不生效，用 Tavern 自己的结算。玩家也可以在那里选回 Tavern 自己的结算。

## 本局插件面板

「本局设置 → 插件」列出本局用到的插件、各自用到了哪些阶段（观察、添加、替换），玩家可以按局关掉某个插件，选择由谁负责结算，并查看最近的插件错误。被关掉的插件在这一局不再参与提示词、结算和通知（`onTurnSettled`、`onTimelineChanged`），它的结算工具调用会被拒绝；它已经挂上的媒体和存档数据保留。

## 插件存档数据（第 2 版）

记忆、叙事锚点这类插件需要按轮保存状态。Tavern 提供两种存储，每个插件只能读写自己的那一份：

| 存储 | 随回退、重新生成变化 | 用来放 |
|---|---|---|
| 按轮数据 | 是，自动 | 记忆、状态、锚点等跟剧情走的东西 |
| 整局数据 | 否 | 插件设置、缓存、跨分支的统计 |

### `saveTurnData({ gameId, turn, textVersion?, data })`

把数据挂在这一轮**当前显示的正文版本**上。`textVersion` 可以省略；给了就必须是当前版本，否则报错（防止把旧回合的结果写到新正文上）。`data` 是能转成 JSON 的值，最多 64 KB；传 `null` 清除这一轮的数据。每个插件每局最多 2000 条、合计 8 MB。返回 `{ turn, textVersion }`。

在 `settlementTool` 的 `execute` 里调用时，用收到的 `gameId`、`turn`，省略 `textVersion` 即可。

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
| 导出存档 | 不包含 | 不包含 |

分叉时，插件挂的媒体项也按同样规则带到新游戏。

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

### `registerPanel({ id, title, render })`（第 2 版）

在右侧栏加一页插件自己的面板，比如记忆、锚点或状态一览。玩家从侧栏的「＋」里打开，面板显示在「插件」一组。

```js
ctx.tavernUi.registerPanel({ id: 'memory', title: '记忆', render: ({ gameId, visible }) => h(MemoryPanel, { gameId }) })
```

- `id` 用小写字母、数字、点、下划线和连字符；`title` 1–40 字。
- `render` 收到当前侧栏对应的 `gameId`，返回 React 元素；没有打开游戏时，Tavern 显示提示，不调用 `render`。
- 面板出错时只显示一行错误，不影响侧栏其他页。插件卸载时面板自动移除。

## 插件自建 Agent 的请求记录

插件用 DSH 的 `agents` 服务为某局游戏建子 Agent 时（例如自己做结算），只要创建时把 `meta.parentSession` 设为这局的 `gameId`，这个 Agent 发出的模型请求就会自动记进这局的请求记录：作为后台请求，归在当时最新的一轮，和 Tavern 自己的请求一样只保留最近 30 轮原文。在该子 Agent 的会话里打开「完整上下文」即可查看。插件不需要调用任何接口，也不要自己写 Tavern 的请求记录文件。

## 不提供的

- 修改正文、修改变量、调用 Tavern 内部的 Agent。
- 替换 Tavern 的其他流程（提示词组装、世界书召回、候选、压缩、MVU 变量结算）：暂未提供。需要时请提插件接口需求；替换类接口都会约定插件要交回的结果，并在插件失败时退回 Tavern 自己的做法。
- 读写 Tavern 数据目录、人物卡文件。
- 插件设置页：用 DSH 自己的设置区（`settings.section`）。
- 模型调用、凭据、附件存储：直接用 DSH 的 `llm`、`credentials`、`attachments` 服务。

## 已知限制

- 插件需要完整重启 DSH 才会加载。这是 DSH 的机制。
- 导出存档暂不包含插件媒体项和插件存档数据；导入后的新局里看不到它们。
- 开场白不触发 `onTurnSettled`。

## 缺接口怎么办

Tavern 不提前设计接口，而是根据插件实际用到的内容补接口。现有接口和 DSH 自带的服务都做不到时，请提一个[插件接口需求](https://github.com/flizzywine/dsh-tavern/issues/new?template=plugin-api.yml)，写清要做的插件、卡在哪一步、试过什么办法。请不要靠改 Tavern 源码或读 Tavern 数据文件绕过去，那样 Tavern 一更新插件就会失效。

## 版本记录

| 版本 | 变化 |
|---|---|
| 1 | 首个版本。 |
| 2 | 新增 `turnSection`、`worldbookSource`、`settlementSection`、`settlementTool`：插件可以往每轮正文请求和后台结算里添加内容。新增插件存档数据（`saveTurnData`、`readTurnData`、`saveGameData`、`readGameData`）与 `onTimelineChanged`；编辑正文后重新发 `onTurnSettled`；分叉时带上插件数据和媒体项。新增第一个替换类接口 `replaceSettlement`，以及本局插件面板（按局开关、选择结算由谁负责、错误记录）。新增 `candidateSection`、`compactionSection`；浏览器侧新增 `registerPanel`（`tavernUi.apiVersion` 为 2）。第 1 版接口不变。 |
