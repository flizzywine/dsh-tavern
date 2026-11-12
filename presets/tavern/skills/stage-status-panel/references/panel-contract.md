# 页面合同

## 声明

写在人物卡 raw 的 `data.extensions.dsh_tavern.pages`，一个最多 8 项的数组：

```json
[
  { "id": "title", "label": "标题", "showOn": { "event": "stage-enter" }, "size": "full", "html": "…" },
  { "id": "status", "label": "状态", "shortcut": "s", "menu": true,
    "ledger": ["items"], "figures": [{ "name": "辉夜", "emotion": "平静" }], "html": "…" }
]
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 页面 id，小写字母开头，只含小写字母、数字和 `-`，最长 32 个字符，卡内不重复。`open(id)` 用它。 |
| `label` | 是 | 页面名，最多 16 字：标题栏、菜单行和快捷键列表里显示它。 |
| `html` | 是 | 页面内容，非空字符串，见「渲染」。 |
| `shortcut` | 否 | 快捷键，一个小写字母，只能从 `b c d e f i j k m n o p q r s t u w x y z` 里选（其余字母是舞台自己的键），卡内不重复。 |
| `menu` | 否 | `true` 时在 Esc 菜单里加一行，按数组顺序排在原来「状态」的位置。 |
| `showOn` | 否 | 只能是 `{"event": "stage-enter"}`：进入舞台时打开，见「入口」。 |
| `initial` | 否 | 只能是 `true`，且必须同时有 `showOn`：只在新聊天里出现的开场页。 |
| `opening` | 否 | 只能是 `true`，需要 `size:"full"`、不能有 `showOn`，一张卡最多一页，且本卡要有 v2 开局设置（`openingSetup`）：本卡的**开局页**。玩家开新游戏时舞台直接打开这一页，不再出现通用的「游戏准备」；页面用 `opening()` 读开场白、用 `startGame(choice)` 开局，见「开局页」。 |
| `size` | 否 | `window`（默认，舞台中央最大 1080×860 的窗口，带标题栏）或 `full`（铺满整个舞台，没有标题栏，只在右上角浮一个关闭按钮；内容自己适配视口）。手机宽度下两者都铺满。 |
| `closeControl` | 否 | 只能是 `"page"`，且需要 `size:"full"`：页面自己负责关闭和返回。页面显示出来后舞台不画关闭按钮；Esc、本页快捷键、右键交给页面的 `onCloseRequest`，页面决定是先返回自己的上一层（比如从详情回到地图）还是 `close()`。没有登记 `onCloseRequest` 时照常关闭；页面读取中、读取失败时舞台仍画关闭按钮。页面要自己画一个关闭按钮。 |
| `ledger` | 否 | 要读的台账分区名，最多 8 个、不重复：`location`、`locationPath`、`items`、`npcs`、`scenes`、`itemLog`、`updatedTurn`。 |
| `figures` | 否 | 要显示头像的人物，最多 8 个、名字不重复：`name` 是本卡人物名（最多 40 字）；写 `{{user}}` 就是这个聊天里玩家的名字，用来显示玩家自己的头像；`emotion` 是可选的表情名（最多 24 字）。 |
| `preload` | 否 | 打开页面时先取好的素材，最多 8 项，每项 `{kind, id, variant?, file?, size?}`，格式同 `asset(ref)`；`size` 只能是 `256`、`512`、`1024`。 |

其他字段一律拒绝；没有 `variables` 字段，变量由 Helper 读写。声明只在保存时校验一次：不合格时保存失败，返回 `CARD_PAGES_INVALID` 和出错字段的路径（如 `pages.2.initial`），按报错修改后重新保存。

## 入口

- **快捷键**：在舞台上按 `shortcut` 字母打开这一页，再按一次或按 Esc 关闭。舞台自己的键先处理，所以只有上面列出的字母可用。
- **菜单行**：每个 `menu:true` 的页面在 Esc 菜单里一行，文字是 `label`，有快捷键时提示里带上键名。
- **进入舞台（showOn）**：玩家每次从文字模式进入舞台（包括「从这里进入舞台」）都会触发一次；舞台重新挂载、换轮、改设置不会触发。这一页从舞台的第一帧就盖住舞台（先是页面底色，页面就绪后显示内容）；本卡设了入场演出时，入场演出在页面后面等着，`continueGame()` 进入舞台时先播入场演出，再照常续读。

每次进入最多打开一页，按数组顺序取第一个匹配的：

1. 聊天里还没有玩家消息（只有开场白也算），并且有 `initial` 页：打开第一个 `initial` 页，「跳过标题页」开着也打开。
2. 否则，玩家打开了舞台设置「跳过标题页」（CONFIG 的文字区，全局，默认关）：不开页，直接从最新一轮继续。
3. 否则：打开第一个不带 `initial` 的 showOn 页。

本卡有开局页（`opening:true`）时还有一条：聊天还没开局（新游戏开出的空档）、上面也没有打开任何页（没有标题页，或「跳过标题页」开着）时，打开开局页。

聊天有了玩家消息之后，`initial` 页不会再被自动打开。校验不限制 showOn 页的数量，排在后面的匹配页不会自动出现，但仍可以用快捷键、菜单或 `open(id)` 打开。

页面开着时舞台暂停输入和自动/快进。关闭方式：关闭按钮、Esc、本页快捷键，或脚本调 `close()`（`closeControl:"page"` 的页面由页面自己处理，见上表）。进入舞台时打开的 showOn 页不同：关闭就是不进入，回到文字模式（同「返回主页面」）；进入舞台用 `continueGame()` 或 `fillInput(text)`；它用 `open(id)` 换到的页也还在进入之前。

## 写入

用 `tavern_update_card` 的 `rawOperations` 只 `set` 整个 `/data/extensions/dsh_tavern/pages` 数组，不动卡的其他部分：

```js
tavern_update_card({ rawOperations: [
  { op: 'set', path: '/data/extensions/dsh_tavern/pages', value: [ /* 页面 */ ] }
] })
```

路径中间缺少的层会自动建出。移除全部页面用 `{ op: 'delete', path: '/data/extensions/dsh_tavern/pages' }`。页面不计入卡内容摘要（`cardContentDigest`），改页面不会让进行中的游戏提示「卡已更新」。

## Helper

页面框和文字模式里的卡片 HTML 是同一个：同一个 Tavern Helper、同一套信任规则，发送、生成、世界书写入和聊天/MVU 变量的写法照上游 Helper，由 DSH 的兼容实现提供（世界书只能访问本卡绑定的那本，生成是整段返回后再模拟流式），舞台不另加限制。常用的有：

| 要做的事 | Helper |
| --- | --- |
| 发一条玩家消息并开始生成 | `triggerSlash('/send 文字\|/trigger')` |
| 直接生成 | `generate(…)`、`generateRaw(…)` |
| 改楼层 | `setChatMessages(…)`、`createChatMessages(…)` |
| 读写变量 | `getVariables(option)`、`replaceVariables`、`updateVariablesWith`、`insertOrAssignVariables`；`option.type` 可以是 `message`、`chat` 等 |
| MVU | `Mvu.getMvuData({type:'message', message_id:'latest'}).stat_data`、`Mvu.replaceMvuData`；`eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, fn)` 在变量更新后刷新 |
| 世界书 | `getCharWorldbookNames().primary` 取本卡世界书名，再 `getWorldbook(name)`、`updateWorldbookWith(name, entries => entries)`：这个聊天有自己的世界书副本时只改这个聊天，否则改人物卡库里的世界书，用它的其他聊天都会看到 |
| 事件 | `eventOn`、`eventOff`、`tavern_events` |

`Mvu` 只在本卡启用 MVU 时存在，脚本先判断再用。变量写入失败时 Helper 会抛错（例如聊天已变化），页面把错误显示给玩家，不要吞掉。

## DshCardPage

舞台在页面的第一个脚本之前放好 `window.DshCardPage`，受信任和沙箱页面里是同一个对象：

| 接口 | 作用 |
| --- | --- |
| `page` | 本页 id。 |
| `data()` | 当前快照（副本）：`{ledger, figures, theme, card: {name}, saved}`。 |
| `onData(fn)` | 推送新快照时调用 `fn(snapshot)`，返回取消订阅的函数。 |
| `onCloseRequest(fn)` | 只用于 `closeControl:"page"` 的页面：玩家按 Esc、本页快捷键或右键时调用 `fn()`，页面先关自己的详情等，已在最上层时调 `close()`；返回取消订阅的函数。本页上面开着 CONFIG、回想或履历时 Esc 先关它们，不调用 `fn`。 |
| `close()` | 关闭本页；进入舞台时打开的 showOn 页是返回主页面。 |
| `open(id)` | 关闭本页，打开另一页。 |
| `openSettings()` | 在本页上面打开舞台 CONFIG，本页保持打开。 |
| `fillInput(text)` | 把文字填进舞台「自由输入」：关闭本页、跳到最新一轮末尾并显示草稿，不发送。 |
| `asset(ref)` | 本卡绑定素材包里的媒体，返回 `Promise<blob: URL>`。`ref` 是 `{kind, id, variant?, file?, size?}`：图片按 `variant`（默认该条目的默认差分），视频包按 `file`（默认入口文件，`'poster'` 是封面）；`size` 取缩略图。不在本卡绑定包里时 Promise 拒绝，报「本卡的素材包里没有」。 |
| `assets(kind)` | 本卡绑定包里某类已启用条目的列表，返回 `Promise<[{id, name, description?, variants?, files?}]>`，同一 id 以绑定顺序靠前的包为准。 |
| `opening(userName)` | 只用于开局页：本卡的开局，返回 `Promise<{userName, setup, openings}>`。`userName` 是名字框里的名字（空时用玩家默认名，返回的 `userName` 就是它）；`setup` 是本卡的 v2 开局设置（字段、消息）；`openings` 是每段开场白 `{id, text, state?, scene?}`：`text` 是按这个名字投影好的正文，`state` 是它 `<initvar>` 里的起点变量，`scene` 是作者给它配的画面 `{title?, background?, music?, timeOfDay?}`（素材 id，名称用 `assets(kind)` 查）。 |
| `startGame(choice)` | 只用于开局页：开局。`choice` 是 `{openingId, values, withoutGreeting?}`：`openingId` 是 `openings` 里的一段，`values` 是开局设置字段的值（键是字段的 `key`，和「游戏准备」表单交的一样），`withoutGreeting:true` 时不用这段开场白，由 AI 按开局消息写第一幕。宿主用和「游戏准备」同一份开局设置结算（字段校验、变量路由、开局消息），开出的一局取代这个没玩过的空档，舞台从第一幕开始；值不合格时 Promise 拒绝，报错写明哪个字段，页面显示给玩家。 |
| `newGame()` | 本卡有开局页时打开开局页（本局已存档时先确认、另开一局，舞台直接进那一局的开局页）。其余：本局还没存档（`saved` 不为 true，玩家还没说过话）时，这一局就是新游戏，不另开一局：本卡有开局设置（`openingSetup`）时离开舞台、打开「游戏准备」，在那里开始的一局取代这个没玩过的空档；没有开局设置时和 `continueGame()` 一样关闭本页、从开场进入舞台。本局已存档时先弹确认框，确认后离开舞台、打开本卡的「游戏准备」开一局新的（与人物卡列表的开始游戏相同，旧的一局留在游玩记录里）；玩家取消时得到 `{started: false}`，页面保持打开。 |
| `continueGame()` | 关闭本页，从当前读到的那一句继续（showOn 页由此进入舞台）。 |
| `openGallery()` | 在本页上面打开「回想」，关掉回想回到本页。 |
| `openBacklog()` | 在本页上面打开「履历」，关掉履历回到本页；在履历里点某一句就关闭本页，从那一句进入舞台。 |
| `exit()` | 返回主页面（与舞台菜单的「返回主页面」相同）。 |
| `sound(name)` | 播放当前舞台皮肤自带的界面音效，`name` 是 `move`（移动、悬停）、`confirm`（确定）、`open`、`close` 之一；跟随界面音量和静音。皮肤没有这个音效时不出声。 |

每个动作都返回 Promise。页面开着时它会兑现或拒绝，点按钮时先禁用按钮、等 Promise 结束后再启用即可；页面被关掉时还没结束的 Promise 可能不再结束，不要靠它做收尾。

给元素加 `data-dsh-sound` 属性，舞台替页面放音效：鼠标移上或获得焦点时 `move`，点击时 `confirm`；禁用的元素不出声。

```html
<!-- 新游戏在继续左边；还没存档时焦点默认落在新游戏 -->
<button data-dsh-sound id="new">新游戏</button>
<button data-dsh-sound id="continue">继续</button>
<script>
  const page = window.DshCardPage
  document.getElementById('continue').disabled = !page.data().saved
  async function run(button, action) {
    document.querySelectorAll('button').forEach(b => { b.disabled = true })
    try { await action() } finally { document.querySelectorAll('button').forEach(b => { b.disabled = b.id === 'continue' && !page.data().saved }) }
  }
  document.getElementById('new').onclick = event => run(event.currentTarget, page.newGame)
  document.getElementById('continue').onclick = event => run(event.currentTarget, page.continueGame)
</script>
```

进入舞台时打开的 showOn 页（标题页、开场页）开着时，舞台的这一句（打字、配音、自动播放）停在原处，进入舞台后才从当前这一句开始。读到一半用快捷键或菜单打开的页面不停：正在播的配音照常播完。BGM 和环境音不受影响。

快照：

```js
{
  ledger: { items: [{ name: '钥匙', qty: 1, carried: true }] },
  figures: [{ name: '辉夜', emotion: '平静', avatar: 'data:image/webp;base64,…' }],
  theme: { accent: '#c79060', accentText: '#171717', surface: '#242321', surfaceText: '#faf7f2',
           muted: '#c6c0b8', border: '#70685f', radius: 12, fontFamily: '…', headingFont: '…' },
  saved: true,
  card: { name: '辉夜大小姐' }
}
```

- `ledger` 只含声明的分区，合计超过 12 KiB 时从最长的列表末尾截掉条目，直到不超过或没有列表可截（`location` 这类单值不截）。页面开着时每结算完一轮重新读一次并推送。
- `figures` 的头像是 `data:` URL，到得比文字晚：打开时 `avatar` 可能还是 `null`，就绪后再推送一次。认不出的人物 `avatar` 一直是 `null`。
- 台账和人物名来自剧情，插进 HTML 前转义。
- `saved`：这局已经有玩家发过的消息（不是刚开局）。标题页用它决定「继续」是否可用。

## 开局页

开局页（`opening:true`）让卡在舞台里用自己的画面完成开局，代替通用的「游戏准备」。玩家从人物卡开始游戏、或在标题页点「新游戏」时，宿主开一个没玩过的空档并进入舞台，舞台打开开局页（有标题页时先是标题页，它的 `newGame()` 到开局页）。页面：

1. `opening(名字)` 读开场白和开局设置；名字改了再读一次，正文里的 `{{user}}` 就是新名字。
2. 让玩家选一段开场白（可以给一个「不用开场白」）、填开局设置的字段；字段的含义、必填和开局消息都是卡的 `openingSetup`（`docs/specs/opening-setup-v2.md`），页面只画。
3. `startGame({openingId, values, withoutGreeting})` 开局；页面在 Promise 结束前禁用开始按钮，拒绝时把报错显示出来。

开局页要自己画返回（通常回标题页 `open('title')`）并声明 `closeControl:"page"`；支持键盘（方向键选、Enter 开始、Esc 返回）和手机宽度。

## 皮肤配色

`theme` 是当前舞台皮肤的配色，与选项框、设置页同源。页面在自己的文档里运行，读不到舞台的 CSS 变量，要把 `theme` 写成自己的 CSS 变量。`theme` 在页面打开时取一次，换皮肤后重新打开页面才用新配色；照样在 `onData` 里应用即可：

```js
function applyTheme(t) {
  Object.entries({ accent: t.accent, 'accent-ink': t.accentText, ink: t.surfaceText, surface: t.surface,
    muted: t.muted, line: t.border, font: t.fontFamily, heading: t.headingFont })
    .forEach(([k, v]) => document.documentElement.style.setProperty('--' + k, v))
}
```

## 渲染

`html` 与正文里的卡片 HTML 走同一条路径：同一个卡片 HTML 文档构建器，装进覆盖层里的 iframe。构建时在前面加入 `DshCardPage` 和基础样式、让内联 module 脚本等 Helper 就绪，其余内容原样保留。写成片段即可：`<style>`、标记和 `<script>`。

- **受信任会话**（设置 `trustedCardMode`，默认开启）：iframe 与页面同源、没有 sandbox 属性，Helper 完整，可以访问 `parent`。
- **不受信任会话**：iframe 带 `sandbox="allow-scripts"`，与正文里的卡片 HTML 相同；读写父页面的 DOM 和属性会抛错（`parent.postMessage` 仍可用）。`DshCardPage` 和 Helper 照常可用。
- 文档背景透明，下面是覆盖层的皮肤表面色；`html`、`body` 的 margin 和 padding 被统一归零（`!important`），边距写在外层容器上。
- 小图可以内联成 `data:` URI；本卡素材用 `asset()`；不依赖外部网络资源。

## 怎么画

- **铺满**：`html`、`body` 的高度被统一设为 `auto`，写 `height: 100%` 不起作用；外层容器用 `min-height: 100vh`（iframe 的高度）。`size:'full'` 时 iframe 就是整个舞台，底部不要被裁掉。
- **手机**：页面在 1920 宽的桌面和 390 宽的手机上都会打开。`@media (max-width: 760px)` 改成单列、可滚动；按钮至少 44×44 px。
- **键盘**：页面拿到焦点后，方向键和 Enter 由页面自己处理；按钮用真正的 `<button>`，能用 Tab 走到。
- **减少动态**：`@media (prefers-reduced-motion: reduce)` 下不播视频、不做位移动画，用封面静图。
- **视频背景**：先用 `<img>` 放封面（`asset({kind, id, file: 'poster'})`），视频 `muted loop playsinline`，`playing` 之后再淡入；手机用 720p 条目。
- **声音**：音乐和配音归舞台管，页面里的视频静音、不放 BGM；按钮音效用 `sound()` 或 `data-dsh-sound`。
