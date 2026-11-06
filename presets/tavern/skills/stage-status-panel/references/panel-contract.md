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
| `size` | 否 | `window`（默认，舞台中央最大 1080×860 的窗口，带标题栏）或 `full`（铺满整个舞台，没有标题栏，只在右上角浮一个关闭按钮；内容自己适配视口）。手机宽度下两者都铺满。 |
| `ledger` | 否 | 要读的台账分区名，最多 8 个、不重复：`location`、`locationPath`、`items`、`npcs`、`scenes`、`itemLog`、`updatedTurn`。 |
| `figures` | 否 | 要显示头像的人物，最多 8 个、名字不重复：`name` 是本卡人物名（最多 40 字），`emotion` 是可选的表情名（最多 24 字）。 |
| `preload` | 否 | 打开页面时先取好的素材，最多 8 项，每项 `{kind, id, variant?, file?, size?}`，格式同 `asset(ref)`；`size` 只能是 `256`、`512`、`1024`。 |

其他字段一律拒绝；没有 `variables` 字段，变量由 Helper 读写。声明只在保存时校验一次：不合格时保存失败，返回 `CARD_PAGES_INVALID` 和出错字段的路径（如 `pages.2.initial`），按报错修改后重新保存。

## 入口

- **快捷键**：在舞台上按 `shortcut` 字母打开这一页，再按一次或按 Esc 关闭。舞台自己的键先处理，所以只有上面列出的字母可用。
- **菜单行**：每个 `menu:true` 的页面在 Esc 菜单里一行，文字是 `label`，有快捷键时提示里带上键名。
- **进入舞台（showOn）**：玩家每次从文字模式进入舞台（包括「从这里进入舞台」）都会触发一次；舞台重新挂载、换轮、改设置不会触发。这一页代替本次的入场动画，从舞台的第一帧就盖住舞台（先是页面底色，页面就绪后显示内容），`continueGame()` 进入舞台后照常续读。

每次进入最多打开一页，按数组顺序取第一个匹配的：

1. 聊天里还没有玩家消息（只有开场白也算），并且有 `initial` 页：打开第一个 `initial` 页，「跳过标题页」开着也打开。
2. 否则，玩家打开了舞台设置「跳过标题页」（CONFIG 的文字区，全局，默认关）：不开页，直接从最新一轮继续。
3. 否则：打开第一个不带 `initial` 的 showOn 页。

聊天有了玩家消息之后，`initial` 页不会再被自动打开。校验不限制 showOn 页的数量，排在后面的匹配页不会自动出现，但仍可以用快捷键、菜单或 `open(id)` 打开。

页面开着时舞台暂停输入和自动/快进。关闭方式：关闭按钮、Esc、本页快捷键，或脚本调 `close()`。进入舞台时打开的 showOn 页不同：关闭就是不进入，回到文字模式（同「返回主页面」）；进入舞台用 `continueGame()` 或 `fillInput(text)`；它用 `open(id)` 换到的页也还在进入之前。

## 写入

用 `tavern_update_card` 的 `rawOperations` 只 `set` 整个 `/data/extensions/dsh_tavern/pages` 数组，不动卡的其他部分：

```js
tavern_update_card({ rawOperations: [
  { op: 'set', path: '/data/extensions/dsh_tavern/pages', value: [ /* 页面 */ ] }
] })
```

路径中间缺少的层会自动建出。移除全部页面用 `{ op: 'delete', path: '/data/extensions/dsh_tavern/pages' }`。页面不计入卡内容摘要（`cardContentDigest`），改页面不会让进行中的游戏提示「卡已更新」。

## Helper

页面框和文字模式里的卡片 HTML 是同一个：同一个 Tavern Helper、同一套信任规则，发送、生成、世界书写入和聊天/MVU 变量都照上游 Helper，舞台不加限制也不改写结果。常用的有：

| 要做的事 | Helper |
| --- | --- |
| 发一条玩家消息并开始生成 | `triggerSlash('/send 文字\|/trigger')` |
| 直接生成 | `generate(…)`、`generateRaw(…)` |
| 改楼层 | `setChatMessages(…)`、`createChatMessages(…)` |
| 读写变量 | `getVariables(option)`、`replaceVariables`、`updateVariablesWith`、`insertOrAssignVariables`；`option.type` 可以是 `message`、`chat` 等 |
| MVU | `Mvu.getMvuData({type:'message', message_id:'latest'}).stat_data`、`Mvu.replaceMvuData`；`eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, fn)` 在变量更新后刷新 |
| 世界书 | `getCharWorldbookNames().primary` 取本卡世界书名，再 `getWorldbook(name)`、`updateWorldbookWith(name, entries => entries)`：写的是人物卡库里的世界书，所有用它的聊天都会看到 |
| 事件 | `eventOn`、`eventOff`、`tavern_events` |

`Mvu` 只在本卡启用 MVU 时存在，脚本先判断再用。变量写入失败时 Helper 会抛错（例如聊天已变化），页面把错误显示给玩家，不要吞掉。

## DshCardPage

舞台在页面的第一个脚本之前放好 `window.DshCardPage`，受信任和沙箱页面里是同一个对象：

| 接口 | 作用 |
| --- | --- |
| `page` | 本页 id。 |
| `data()` | 当前快照（副本）：`{ledger, figures, theme, card: {name}, saved}`。 |
| `onData(fn)` | 推送新快照时调用 `fn(snapshot)`，返回取消订阅的函数。 |
| `close()` | 关闭本页；进入舞台时打开的 showOn 页是返回主页面。 |
| `open(id)` | 关闭本页，打开另一页。 |
| `openSettings()` | 在本页上面打开舞台 CONFIG，本页保持打开。 |
| `fillInput(text)` | 把文字填进舞台「自由输入」：关闭本页、跳到最新一轮末尾并显示草稿，不发送。 |
| `asset(ref)` | 本卡绑定素材包里的媒体，返回 `Promise<blob: URL>`。`ref` 是 `{kind, id, variant?, file?, size?}`：图片按 `variant`（默认该条目的默认差分），视频包按 `file`（默认入口文件，`'poster'` 是封面）；`size` 取缩略图。不在本卡绑定包里时 Promise 拒绝，报「本卡的素材包里没有」。 |
| `assets(kind)` | 本卡绑定包里某类条目的列表 `[{id, name, description?, variants?, files?}]`，同一 id 以绑定顺序靠前的包为准。 |
| `newGame()` | 离开舞台，打开本卡的「游戏准备」（与人物卡列表的开始游戏相同）。本局已存档（`saved`）时先弹确认框；玩家取消时得到 `{started: false}`，页面保持打开。 |
| `continueGame()` | 关闭本页，从当前读到的那一句继续（showOn 页由此进入舞台）。 |
| `openGallery()` | 在本页上面打开「回想」，关掉回想回到本页。 |
| `exit()` | 返回主页面（与舞台菜单的「返回主页面」相同）。 |
| `sound(name)` | 播放当前舞台皮肤自带的界面音效，`name` 是 `move`（移动、悬停）、`confirm`（确定）、`open`、`close` 之一；跟随界面音量和静音。皮肤没有这个音效时不出声。 |

每个动作都返回 Promise，并且一定会兑现或拒绝：点按钮时先禁用按钮的页面，等 Promise 结束后再启用即可，不会卡住。

给元素加 `data-dsh-sound` 属性，舞台替页面放音效：鼠标移上或获得焦点时 `move`，点击时 `confirm`；禁用的元素不出声。

```html
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

- `ledger` 只含声明的分区，合计不超过 12 KiB，超出时从最长的列表末尾截掉条目。页面开着时每结算完一轮重新读一次并推送。
- `figures` 的头像是 `data:` URL，到得比文字晚：打开时 `avatar` 可能还是 `null`，就绪后再推送一次。认不出的人物 `avatar` 一直是 `null`。
- 台账和人物名来自剧情，插进 HTML 前转义。
- `saved`：这局已经有玩家发过的消息（不是刚开局）。标题页用它决定「继续」是否可用。

## 皮肤配色

`theme` 是当前舞台皮肤的配色，与选项框、设置页同源。页面在自己的文档里运行，读不到舞台的 CSS 变量，要把 `theme` 写成自己的 CSS 变量，并在 `onData` 里跟着更新，换皮肤后页面也跟着变：

```js
function applyTheme(t) {
  Object.entries({ accent: t.accent, 'accent-ink': t.accentText, ink: t.surfaceText, surface: t.surface,
    muted: t.muted, line: t.border, font: t.fontFamily, heading: t.headingFont })
    .forEach(([k, v]) => document.documentElement.style.setProperty('--' + k, v))
}
```

## 渲染

`html` 与正文里的卡片 HTML 走同一条路径：同一个卡片 HTML 文档构建器，装进覆盖层里的 iframe，不改写内容。写成片段即可：`<style>`、标记和 `<script>`。

- **受信任会话**（设置 `trustedCardMode`，默认开启）：iframe 与页面同源、没有 sandbox 属性，Helper 完整，可以访问 `parent`。
- **不受信任会话**：iframe 带 `sandbox="allow-scripts"`，与正文里的卡片 HTML 相同；访问 `parent` 会抛错。`DshCardPage` 和 Helper 照常可用。
- 文档背景透明，下面是覆盖层的皮肤表面色；`html`、`body` 的 margin 和 padding 被统一归零（`!important`），边距写在外层容器上。
- 小图可以内联成 `data:` URI；本卡素材用 `asset()`；不依赖外部网络资源。

## 怎么画

- **铺满**：`html, body { height: 100% }`，外层容器 `min-height: 100%`。`size:'full'` 时 iframe 就是整个舞台，底部不要被裁掉。
- **手机**：页面在 1920 宽的桌面和 390 宽的手机上都会打开。`@media (max-width: 760px)` 改成单列、可滚动；按钮至少 44×44 px。
- **键盘**：页面拿到焦点后，方向键和 Enter 由页面自己处理；按钮用真正的 `<button>`，能用 Tab 走到。
- **减少动态**：`@media (prefers-reduced-motion: reduce)` 下不播视频、不做位移动画，用封面静图。
- **视频背景**：先用 `<img>` 放封面（`asset({kind, id, file: 'poster'})`），视频 `muted loop playsinline`，`playing` 之后再淡入；手机用 720p 条目。
- **声音**：页面没有声音权限，视频静音，不放 BGM。
