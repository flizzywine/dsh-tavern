# 插件开发：浏览器侧 tavernUi

浏览器侧 `ctx.tavernUi`：显示媒体、正文标记、按钮、面板、舞台与声音。

浏览器侧的代码运行在 DSH 页面里，使用 DSH 提供的 `react`。插件的 `render` 函数返回 React 元素；出错时只影响这个元素，正文其余部分照常显示。

## `registerMediaRenderer(kind, render)`

为插件自定义的 `kind`（`<插件名>/<类型>`）提供显示方式，比如边下载边显示、带播放器的卡片。`image`、`video`、`audio` 由 Tavern 显示，不能替换。

```js
render({ item, gameId, turn })  // item 与 list 返回的字段相同，另有 url（有附件时为附件地址）
```

没有注册显示方式的自定义媒体项不显示。

## `registerTextMarker({ pattern, render })`

正文里匹配 `pattern`（正则）的片段交给插件显示，例如把 `image###…###` 换成图片。生成过程中也会调用，此时 `streaming` 为 `true`。

```js
render({ match, groups, gameId, turn, streaming })  // 返回 React 元素；返回 null 或出错时原样显示这段文字
```

- 普通正文里，标记就地替换。
- 写在人物卡自己的 HTML 界面（状态栏、美化面板）里的标记，无法拆开那段 HTML，会从界面里去掉，显示在那段界面之后。
- 标记仍留在对话历史里，后续轮次模型能看到。是否要求模型继续写，由插件在提示词段落里说明。

## `registerMessageAction({ id, label, when, run })`

在每条已写完的助手消息下方加一个按钮，例如「配图」「重画」。`when(context)` 决定是否显示（不传则总是显示），点击时调用 `run(context)`，`run` 可以是异步函数，执行期间按钮不可再点。

```js
context = { gameId, turn, settled, text }
```

`text` 是这条消息的正文（模型写出的原文），可用来只在合适的消息下显示按钮，例如正文里已经有某个标记时就不显示。

## `registerComposerAction({ id, label, when, run })`

在输入框上方的操作栏加一个按钮，针对当前最新一轮。模型正在生成时按钮不可点。

```js
context = { gameId, turn, busy }
```

想替换内置生图的插件就用这个入口。内置生图的入口在每轮正文下方的操作栏（图片图标），与插件按钮互不占位，由用户选择用哪个。

## `readPluginData()`、`savePluginData(data)`（第 3 版）

读写插件自己的数据，和宿主侧 `tavern.readPluginData()`、`tavern.savePluginData({ data })` 是同一份（见[媒体与数据](plugin-api-data.md)）。都返回 Promise；`savePluginData` 传 `null` 清除。

## `registerIllustrator({ kinds, draw?, redraw?, editPrompt?, add?, cancel?, action? })`（第 5 版）

生图插件接管 Tavern 自己的配图界面：每轮的「为这一轮配图」按钮，以及正文里包住插件图片的插图卡。插图卡负责显示、版本切换、删除、进度和取消按钮，插件只负责出图。`kinds` 是插件自己的媒体类型；这些类型的媒体项由插图卡显示，不再走 `registerMediaRenderer`。

每个处理函数收到 `{ gameId, turn, textVersion, item }`，可以返回 Promise，抛错会显示在卡片上。只提供了哪个函数，卡片上就出现对应的按钮：

- `draw`：为这一轮配图（不提供就没有配图按钮，比如插件的配图功能被关掉时；已有插图照常由插图卡显示），通常 `attach` 一个 pending 占位，出图后 `update` 成 ready。等它返回期间，正文里显示「正在整理画面…」；返回 `{ notice }` 时把说明留在原处几秒（比如「本轮跳过配图：没有合适的画面」），抛错则显示失败原因。不必另弹提示。
- `redraw`：按这张图的提示词再画；新图换上后旧图成为早期版本。
- `revise`：重新整理提示词再画，多收到玩家写的 `instruction`（可能为空，空时重新构思画面）。提供了它，「重画」会打开面板，让玩家在「同提示词重画」（`redraw`）和「按意见重画 / 重新整理提示词」（`revise`）之间选。
- `editPrompt`：「改提示词」，多收到 `prompt`。
- `add`：「新增插图」，多收到玩家写的 `instruction`（可能为空）。
- `cancel`：pending 或 `activity.cancellable` 时的「取消」。
- `action`：媒体项 `actions` 里的按钮，多收到 `actionId`。

插图卡只读标准字段：`status`、`progress`、`error`、`prompt`、`activity`、`actions`，插件自己的 `data` 它不读。

## `listIllustrations()`（第 4 版）

原本列出 Tavern 自带场景生图画过的插图。Tavern 已不再保留这些旧图（配图都由插件生成），现在总是返回空列表；方法保留，旧插件调用不会出错。插件自己挂的媒体请用插件媒体接口读取。

## `getGames(gameIds)`（第 4 版）

按 `gameId` 查游戏名称，返回 Promise `{ [gameId]: { title, cardName } }`；已删除或不存在的游戏不在结果里。一次最多 500 个。

## `callHost(name, args)`（第 2 版）

调用宿主侧用 `tavern.handle(name, handler)` 注册的处理函数，返回一个 Promise，结果是处理函数的返回值。

```js
ctx.tavernUi.registerMessageAction({
  id: 'redraw', label: '重画',
  run: ({ gameId, turn }) => ctx.tavernUi.callHost('dsh-tavern-xxx/redraw', { gameId, turn }),
})
```

处理函数不存在（插件宿主侧没加载、或没注册这个名字）时失败，错误码 `TAVERN_PLUGIN_NOT_FOUND`。

## `assetUrl(path)`（第 2 版）

插件文件夹里 `assets/` 下文件的地址，用于图片、地图、音效、音乐、字体等：

```js
h('img', { src: ctx.tavernUi.assetUrl('map/forest.png') })
new Audio(ctx.tavernUi.assetUrl('sfx/hit.mp3')).play()
```

- `path` 是相对 `assets/` 的路径，不能含 `..` 或以 `.` 开头的部分。
- 只提供 `assets/` 下的文件，插件文件夹里的代码和设置不会被公开；放进 `assets/` 的文件，打开酒馆页面的人都能读到，不要放密钥。
- 音频、视频支持拖动进度（按范围读取）；文件修改后浏览器会重新取。
- 插件按 `package.json` 的 `name` 认出自己（与浏览器侧 `factory` 返回的 `name` 相同）。只对放在 `plugins/` 文件夹里的插件有效。

## `watchState(gameId, name, listener)`（第 3 版）

先用当前的值调用一次 `listener(data)`，之后本插件宿主侧每次 `tavern.publishState` 同一个 `name` 时再调用（内容没变不调用）。没有发布过时收到 `null`。返回取消函数，插件卸载时自动取消。

## `getTurnState(gameId)`、`watchTurnState(gameId, listener)`（第 2 版）

`getTurnState` 返回 Promise，结果与宿主侧 `tavern.getTurnState` 相同。`watchTurnState` 先用当前状态调用一次 `listener(state)`，之后每次状态变化（开始或写完正文、结算开始或结束、回退等）再调用；返回取消函数，插件卸载时自动取消。只在这一局在当前页面打开时有通知。

## `watchReply(sessionId, listener)`（第 6 版）

读正在写的这条回复，**卡片工作台也能用**（其他 `getTurnState` 一类接口在工作台不可用）。先用当前状态调用一次 `listener(state)`，之后每次变化（逐字生成、写完、工具开始或结束、卡片落盘）再调用；返回取消函数，插件卸载时自动取消。只在这一局在当前页面打开时有通知。

```js
const stop = ctx.tavernUi.watchReply(gameId, (state) => {
  bubble.text = state.text
  bubble.streaming = state.streaming
  if (state.cardSaved) showBuiltCard(state.cardSaved)
})
```

| 字段 | 含义 |
|---|---|
| `mode` | `'card'` 是卡片工作台，`'story'` / `'script'` 是游玩 |
| `turn` | 这一轮的轮次（工作台里同样是 DSH 的轮次） |
| `text` | 最新一条助手回复的纯文本；生成中是当前已写出的部分 |
| `streaming` | 正在逐字写（已经拿到部分文字） |
| `busy` | 这一轮还在跑（生成正文或执行工具），此时 `text` 可能还是上一轮 |
| `tool` | 正在执行的工具名（如 `tavern_update_card`），拿不到时 `null` |
| `cardSave` | 工作台最近一次落盘：`{ turn, path, createsCard, changed }`，没有时 `null` |
| `cardSaved` | 这一轮刚创建的新卡路径（`createsCard`），否则 `null` |
| `changed` | 这一轮改过或创建了这张卡（含工具直接保存），否则 `false` |

工具调用不会改动 `text`；想在工作台里判断「建好了」，用 `cardSaved`，不要匹配正文。

## `watchWorkStatus(sessionId, listener)`、`getWorkStatus(sessionId)`（第 7 版）

读这一局现在在做什么，给桌宠、陪玩这类要跟着状态换表情的插件用。`watchWorkStatus` 先用当前状态调用一次 `listener(status)`，之后每次变化再调用，返回取消函数；只在这一局于当前页面打开时有通知。`getWorkStatus` 同步读当前值，不订阅。

```js
const stop = ctx.tavernUi.watchWorkStatus(gameId, (status) => {
  pet.face(status.state) // idle / thinking / working / waiting / success / error
})
```

| 字段 | 含义 |
|---|---|
| `state` | `idle` 空闲；`thinking` 正在写正文；`working` 正在跑工具或后台结算；`waiting` 在等玩家回答（`ask_user_question`）；`success` 刚忙完；`error` 出错 |
| `reason` | 细分来源：`idle` / `busy` / `streaming` / `tool` / `settlement` / `question` / `settled` / `load` |
| `busy` | 这一局现在是否在跑 |
| `turn` | 最新一轮的轮次；还没有正文时为 `0` |
| `tool` | 正在执行的工具名，拿不到时 `null` |
| `phase`、`role` | Tavern 的原始活动字段（`role` 如 `settlement`） |
| `error` | `state === 'error'` 时的原因，否则空字符串 |
| `updatedAt` | 这次状态的生成时刻 |

- `success` 只在**看着这一局从忙变闲**时出现，持续 4 秒后回到 `idle`；第一次订阅一个早就写完的局不会补一次成功。
- 换局、关掉这一局、插件卸载都会自动停掉订阅。
- 只读，不改变游戏。

## `acquireLease({ sessionId, scope, ttlMs?, reason? })`、`getLease(sessionId, scope)`、`watchLease(sessionId, scope, listener)`（第 7 版）

「占用锁」：同一局同一个 `scope` 同时只给一个插件。给桌宠这类会抢气泡、动作、舞台的插件协调用，避免两个插件同时说话或同时换画面。

```js
const lease = ctx.tavernUi.acquireLease({ sessionId: gameId, scope: 'voice', ttlMs: 30000, reason: '引导提问' })
try { /* 这段归我说话 */ } finally { lease.release() }
```

- `scope` 只能用小写字母、数字、点、下划线和连字符，以字母开头；建议用 `voice`、`bubble`、`stage`、`composer` 这类语义名。
- `ttlMs` 默认 30 秒，范围 1 秒–10 分钟。过期是懒判的：`getLease` 和下一次 `acquireLease` 会清掉，`watchLease` 会收到 `expired`。
- 返回 `{ leaseId, holder, expiresAt, renew(ttlMs?), release(), active() }`。`holder` 是插件名（`package.json` 的 `name`）。
- 别人持有这个 `scope` 时 `acquireLease` 抛错，`error.code === 'TAVERN_PLUGIN_LEASED'`，另带 `holder` 与 `expiresAt`；同一个插件重拿是续期，`leaseId` 不变。
- 续期时锁已经丢了，抛 `TAVERN_PLUGIN_LEASE_LOST`；`release()` 是幂等的。
- `getLease(sessionId, scope)` 返回当前持有者快照或 `null`；`watchLease` 先给一次当前值（`cause === 'current'`），之后在 `acquired` / `renewed` / `released` / `expired` 时回调，返回取消函数。
- 插件卸载时自动释放。Tavern 保证同一 `scope` 只有一个持有者；拿不到锁的插件应当自己让路（检查 `getLease` / `watchLease`），Tavern 不会替它改已经注册的界面。

## `registerReplyPresenter({ id, modes, present })`（第 6 版）

让插件把会话里的**已完成**回复折叠成一行，例如卡片工作台里已经由桌宠念过的提问。Tavern 在画每条助手消息时同步调用 `present(message)`；返回 `null` 或不认识就保持原文。

```js
ctx.tavernUi.registerReplyPresenter({
  id: 'question', modes: ['card'],
  present: ({ text }) => parseQuestion(text) ? { fold: { summary: '第 2 题：核心定位是什么？' } } : null,
})
```

- `message = { sessionId, turn, text, changed, streaming }`，`streaming` 恒为 `false`（生成中不调用）。
- 返回 `{ fold: { summary } }` 时，这条消息显示成 `🐾 摘要 · 展开`；`summary` 压成一行、最多 60 字，点击就地展开原文，再点「收起」回到一行。
- `modes` 目前只有 `'card'` 有效；同一会话注册多个时，按注册顺序取第一个返回非 `null` 的。
- `present` 必须同步且快；抛错会记到插件错误里，连续 3 次后这一会话不再调用它。插件卸载后恢复原文。
- 只修改显示，存档里的正文不变。

## `registerComposerSlot({ id, modes, render })`（第 6 版）

在输入框正上方加一块插件自己的界面（与对话栏同宽），给卡片工作台的引导员这类需要常驻的角色用。

```js
ctx.tavernUi.registerComposerSlot({
  id: 'guide', modes: ['card'],
  render: ({ sessionId, busy }) => h(GuideDock, { sessionId, busy }),
})
```

- `render` 返回 React 元素，收到 `{ sessionId, busy }`（`busy` 是这一轮是否在跑）。
- 同一会话只显示一个停靠区（先注册者），`modes` 不符合的会话不显示；插件卸载后移除。
- 高度由内容决定，最高 40vh，超出内部滚动；Tavern 会把输入区上移，不会盖住最新一条消息。
- 出错时只显示一行错误；卡内插件按它那张卡的局生效。

## `setInput({ gameId, text })`、`submitInput({ gameId, text })`（第 2 版）

`setInput` 把文字填进这一局的输入框，不发送，玩家可以改了再发。`submitInput` 直接作为玩家输入发送并生成正文，返回 Promise（提交后完成，不等正文写完；要等结果用 `watchTurnState`）。正在生成时会排在当前这轮之后。这一局没有在当前页面打开时报错。

```js
ctx.tavernUi.submitInput({ gameId, text: '我举盾格挡，然后反击。' })
```

## `openOverlay({ gameId?, render, dismissible?, onClose? })`（第 2 版）

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

## `registerPanel({ id, title, render })`（第 2 版）

在右侧栏加一页插件自己的面板，比如记忆、锚点或状态一览。玩家从侧栏的「＋」里打开，面板显示在「插件」一组。

```js
ctx.tavernUi.registerPanel({ id: 'memory', title: '记忆', render: ({ gameId, visible }) => h(MemoryPanel, { gameId }) })
```

- `id` 用小写字母、数字、点、下划线和连字符；`title` 1–40 字。
- `render` 收到当前侧栏对应的 `gameId`，返回 React 元素；没有打开游戏时，Tavern 显示提示，不调用 `render`。
- 面板出错时只显示一行错误，不影响侧栏其他页。插件卸载时面板自动移除。

## `registerStartGroup({ title, tabs })`（第 2 版）

把插件自己的几个侧栏页归成一组，显示在侧栏开始页（点「＋」看到的那一页）。不声明时，`registerPanel` 的面板在「插件」组，直接用 DSH `betterSidebar.registerTab` 注册的页在「其他」组。

```js
ctx.tavernUi.registerStartGroup({ title: '叙事锚定', tabs: ['narrative-anchor:settings', 'narrative-anchor:state', 'memory'] })
```

- `title` 1–20 字；`tabs` 1–20 个侧栏页 id，按顺序显示。带 `:` 的是侧栏页的完整 id（`registerTab` 时的 `id`）；不带 `:` 的是本插件 `registerPanel` 的 `id`。
- 插件分组排在 Tavern 自带的「本局」「资料库」「偏好」之后、「插件」之前，按注册顺序。Tavern 自己的页不能移进插件分组；同一页被几个分组声明时只显示在第一个里。
- 列出的页没有注册时不显示；整组都没有可显示的页时，整组隐藏。插件卸载时分组自动移除。

## `registerCardListView({ id, label, render })`（第 2 版）

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

## `registerStatusSection({ id, title, render })`（第 3 版）

在这一局的「酒馆状态」页加一节插件自己的内容，排在 Tavern 自己的各节之后，例如当前场景、好感度、导演状态。和 `registerPanel` 的区别：面板是单独的一页，要玩家从「＋」里打开；状态分节和本局状态放在一起，打开状态页就能看到。

```js
ctx.tavernUi.registerStatusSection({ id: 'scene', title: '当前场景', render: ({ gameId }) => h(SceneSummary, { gameId }) })
```

- `id` 规则同 `registerPanel`；`title` 1–20 字，Tavern 画成这一节的标题。
- 出错时这一节只显示一行错误，状态页其余部分照常。卡内插件的分节只出现在它那张卡的局里。插件卸载时自动移除。

## `registerTurnView({ id, label, render })`（第 3 版）

换一种方式显示**整轮正文**，例如对话气泡、剧本排版。`render` 收到 Tavern 自己渲染好的这一轮正文作 `children`，插件可以在外面包一层、在前后加东西，或者自己重画；正文本身（存档里的内容）不变。

```js
ctx.tavernUi.registerTurnView({
  id: 'bubble', label: '气泡',
  render({ gameId, turn, settled, streaming, greeting, text, lines, children }) {
    if (!settled || !lines.length) return null        // 还在生成、或没有台词标注时用 Tavern 自己的
    return h(BubbleTurn, { lines, text, fallback: children })
  },
})
```

| 字段 | 含义 |
|---|---|
| `turn`、`settled`、`streaming` | 第几轮；是否已写完；是否正在生成（生成中也会调用） |
| `greeting` | 是不是开场白 |
| `text` | 这一轮模型写的原文 |
| `lines` | 这一轮的台词标注（同宿主侧 `getCast` 的 `lines`），还没有时为空数组 |
| `children` | Tavern 自己渲染好的这一轮正文（含人物卡的 HTML 界面、正文标记、插件媒体的位置） |

- 每一轮只由收尾的那一步显示一次，不会重复。
- 注册后默认用插件的样式；「酒馆状态」页出现「正文样式」选择，玩家可以选回内置，这台浏览器记住选择（卡内插件带的样式按卡记住）。插件卸载后回到内置。
- `render` 返回 `null` 或出错时用 Tavern 自己的显示，错误写进错误提示。卡内插件的样式只用于它那张卡的局。

## `getStage(gameId, { count? })`、`watchStage(gameId, listener)`（第 2 版）

舞台要显示的东西：`{ enabled, player, card, background, characters, turns }`。`background` 是人物卡带的主背景图地址，没有时为空字符串。`turns` 是最近 `count` 轮（默认 5，最多 10）的 `{ turn, text, lines }`，`text` 是去掉 HTML 块的正文，`lines` 同宿主侧 `getCast`；`characters` 同宿主侧 `getCastAssets`；`enabled` 是玩家是否打开了「对话头像」。`watchStage` 先回调一次，之后在新的一轮、新的标注、素材变化后再回调，只在这一局在当前页面打开时有效。

## `registerStageView`（已停用）

插件不能再替换舞台画面。舞台由 Tavern 按人物卡绑定的素材包绘制：给人物卡绑定素材包并打开对话气泡即可。调用 `registerStageView` 会直接报错。

## `speak({ gameId, speaker?, text, emotion?, narration? })`、`stopSpeech()`（第 2 版）

在当前页面朗读一句，用玩家选的配音渠道和这个人物的声音（浏览器朗读也可以）。返回的 Promise 在读完时为 `true`，被打断、配音关闭或失败时为 `false`。同一时间只读一句，新的一句会打断正在读的；`stopSpeech()` 立即停止。适合插件的舞台画面、自己的面板逐句朗读。

## `playMusic(url | { url, title?, volume? })`、`stopMusic()`（第 2 版）

背景音乐由 Tavern 播放：同一时间一首、循环；传入同一个地址时接着放，换地址时淡入新曲，传空字符串或调 `stopMusic()` 时淡出。玩家在全屏舞台控制栏的「♪ 音乐」开关决定听不听得到（记在这个浏览器里），所有卡的音乐都受这一个开关管。离开这一局（切换、删除对话）或这一局不再显示舞台时，Tavern 会停掉音乐；插件换局后要重新调 `playMusic`。`volume` 为 0–1，默认 0.45。
