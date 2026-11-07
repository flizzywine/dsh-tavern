# 示例

两张示例卡，分别为不同的内置皮肤设计，页面的颜色都取自 `DshCardPage.data().theme`，换皮肤后跟着变。每页的 HTML 写成一个 JSON 字符串放进 `html`，下面为了好读分开写；每段 HTML 第一行的注释标出它属于哪一页。

## 示例 A：标题页 + 开场页（本卡皮肤 `crt`）

卡《雾港》：每次从文字模式进入舞台先看到标题页；新聊天第一次进入时改为开场页，玩家在这里写下第一句话。

```json
[
  { "id": "title", "label": "标题", "showOn": { "event": "stage-enter" }, "size": "full", "html": "（title 页的 HTML）" },
  { "id": "prologue", "label": "序章", "showOn": { "event": "stage-enter" }, "initial": true, "size": "full", "html": "（prologue 页的 HTML）" }
]
```

进入舞台时：

- 新聊天（还没有玩家消息）：打开 `prologue`，玩家开了「跳过标题页」也打开。
- 之后每次从文字模式进入：打开 `title`；玩家开了「跳过标题页」就直接续读。
- 两页都没有快捷键和菜单行，只在进入舞台时出现；Esc 或关闭按钮等于「继续」。

### title

```html
<!-- page: title -->
<style>
  html, body { height: 100%; }
  .screen { position: relative; min-height: 100%; display: grid; place-items: center; overflow: hidden;
    background: var(--surface); color: var(--ink); font-family: var(--font, monospace); }
  .screen::after { content: ''; position: absolute; inset: 0; pointer-events: none;
    background: repeating-linear-gradient(transparent 0 2px, rgb(0 0 0 / .25) 2px 4px); }
  .box { position: relative; z-index: 1; display: grid; gap: 28px; justify-items: center; padding: 24px; text-align: center; }
  h1 { margin: 0; font: 700 clamp(36px, 8vw, 88px)/1.1 var(--heading, var(--font)); color: var(--accent);
    text-shadow: 0 0 12px var(--accent); animation: flicker 4s infinite; }
  nav { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; }
  button { min-width: 160px; min-height: 44px; padding: 0 20px; font: inherit; font-size: 18px; cursor: pointer;
    color: var(--ink); background: transparent; border: 1px solid var(--line); border-radius: var(--radius, 8px); }
  button:hover, button:focus-visible { color: var(--accent-ink); background: var(--accent); outline: none; }
  @keyframes flicker { 0%, 96%, 100% { opacity: 1; } 97% { opacity: .6; } }
  @media (prefers-reduced-motion: reduce) { h1 { animation: none; } }
  @media (max-width: 760px) { nav { flex-direction: column; } button { width: 100%; } }
</style>
<main class="screen">
  <div class="box">
    <h1 id="name"></h1>
    <nav>
      <button id="continue" type="button">继续</button>
      <button id="settings" type="button">设置</button>
    </nav>
  </div>
</main>
<script>
  const page = window.DshCardPage
  function applyTheme(t) {
    const vars = { accent: t.accent, 'accent-ink': t.accentText, ink: t.surfaceText, surface: t.surface,
      line: t.border, radius: t.radius + 'px', font: t.fontFamily, heading: t.headingFont }
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty('--' + k, v)
  }
  function render(d) {
    applyTheme(d.theme)
    document.getElementById('name').textContent = d.card.name
  }
  render(page.data())
  page.onData(render)
  document.getElementById('continue').onclick = () => page.close()
  document.getElementById('settings').onclick = () => page.openSettings()
  document.getElementById('continue').focus()
</script>
```

### prologue

开场页显示卡的开场白，玩家写下第一句话后可以直接发送（Helper 的 `triggerSlash`，开始一轮生成），也可以放进舞台的自由输入框再改。

```html
<!-- page: prologue -->
<style>
  html, body { height: 100%; }
  .screen { min-height: 100%; box-sizing: border-box; display: grid; align-content: center; gap: 20px;
    max-width: 760px; margin: 0 auto; padding: 32px 24px;
    background: var(--surface); color: var(--ink); font: 17px/1.8 var(--font, monospace); }
  h1 { margin: 0; color: var(--accent); font: 700 28px/1.3 var(--heading, var(--font)); }
  .greeting { max-height: 40vh; overflow: auto; white-space: pre-wrap; color: var(--muted); border-left: 2px solid var(--line); padding-left: 16px; }
  textarea { min-height: 96px; padding: 12px; font: inherit; color: var(--ink); background: transparent;
    border: 1px solid var(--line); border-radius: var(--radius, 8px); resize: vertical; }
  nav { display: flex; gap: 12px; flex-wrap: wrap; }
  button { min-height: 44px; padding: 0 18px; font: inherit; cursor: pointer; color: var(--ink); background: transparent;
    border: 1px solid var(--line); border-radius: var(--radius, 8px); }
  button.primary { color: var(--accent-ink); background: var(--accent); border-color: var(--accent); }
  button:disabled { opacity: .5; cursor: default; }
  .error { min-height: 1.8em; margin: 0; color: var(--accent); }
  @media (max-width: 760px) { nav { flex-direction: column; } button { width: 100%; } }
</style>
<main class="screen">
  <h1 id="name"></h1>
  <div id="greeting" class="greeting"></div>
  <label for="line">你的第一句话</label>
  <textarea id="line"></textarea>
  <nav>
    <button id="send" class="primary" type="button">发送</button>
    <button id="fill" type="button">放进输入框</button>
    <button id="skip" type="button">先看开场</button>
  </nav>
  <p id="error" class="error" role="alert"></p>
</main>
<script>
  const page = window.DshCardPage
  const $ = id => document.getElementById(id)
  function applyTheme(t) {
    const vars = { accent: t.accent, 'accent-ink': t.accentText, ink: t.surfaceText, surface: t.surface,
      muted: t.muted, line: t.border, radius: t.radius + 'px', font: t.fontFamily, heading: t.headingFont }
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty('--' + k, v)
  }
  function render(d) {
    applyTheme(d.theme)
    $('name').textContent = d.card.name
  }
  render(page.data())
  page.onData(render)
  $('greeting').textContent = getChatMessages(0)[0]?.message || ''
  const line = () => $('line').value.trim()
  $('send').onclick = async () => {
    if (!line()) { $('error').textContent = '先写一句话。'; return }
    $('send').disabled = true
    try {
      await triggerSlash('/send ' + line().replaceAll('|', '｜') + '|/trigger')
      page.close()
    } catch (error) {
      $('error').textContent = error.message
      $('send').disabled = false
    }
  }
  $('fill').onclick = () => page.fillInput(line())
  $('skip').onclick = () => page.close()
  $('line').focus()
</script>
```

要点：

- 标题和开场白都从卡里读（`data().card.name`、第 0 楼的开场白），页面代码里不写卡的文字。
- 发送的文字里如果有 `|`，先换成全角，免得被当成下一条斜杠命令。
- 发送失败时 Helper 会抛错，页面显示出来并让按钮恢复可点。

## 示例 B：地图 + 状态页（本卡皮肤 `aero`）

卡《夏日群岛》：绑定的素材包里有若干背景（每个背景是一处地点），MVU 里有 `好感.夏帆` 和 `体力`，台账记录当前位置和物品。玩家按 M 或从 Esc 菜单打开地图，按 S 或从菜单打开状态。

```json
[
  { "id": "map", "label": "地图", "shortcut": "m", "menu": true, "html": "（map 页的 HTML）" },
  { "id": "status", "label": "状态", "shortcut": "s", "menu": true,
    "ledger": ["location", "items"], "figures": [{ "name": "夏帆", "emotion": "平静" }], "html": "（status 页的 HTML）" }
]
```

### map

地点列表来自本卡素材包的背景条目（`assets('backgrounds')`），缩略图用 `asset()` 按需取。点一处地点，把「前往某地」填进自由输入框，玩家确认后自己发送。

```html
<!-- page: map -->
<style>
  .map { padding: 20px; color: var(--ink); font: 15px/1.6 var(--font, sans-serif); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
  button { display: grid; gap: 8px; padding: 8px; text-align: left; font: inherit; color: inherit; cursor: pointer;
    background: color-mix(in srgb, var(--surface) 70%, transparent); border: 1px solid var(--line);
    border-radius: var(--radius, 12px); transition: transform .15s; }
  button:hover, button:focus-visible { border-color: var(--accent); outline: none; transform: translateY(-2px); }
  img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: calc(var(--radius, 12px) - 4px); background: var(--line); }
  .desc, .empty { color: var(--muted); font-size: 13px; }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } button:hover { transform: none; } }
  @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
</style>
<main class="map">
  <div id="grid" class="grid"></div>
  <p id="empty" class="empty" hidden>本卡的素材包里还没有背景。</p>
</main>
<script>
  const page = window.DshCardPage
  function applyTheme(t) {
    const vars = { accent: t.accent, ink: t.surfaceText, surface: t.surface, muted: t.muted,
      line: t.border, radius: t.radius + 'px', font: t.fontFamily }
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty('--' + k, v)
  }
  applyTheme(page.data().theme)
  page.onData(d => applyTheme(d.theme))
  page.assets('backgrounds').then(places => {
    const grid = document.getElementById('grid')
    document.getElementById('empty').hidden = places.length > 0
    for (const place of places) {
      const button = document.createElement('button'), img = document.createElement('img'),
        name = document.createElement('b'), desc = document.createElement('span')
      button.type = 'button'
      img.alt = ''
      name.textContent = place.name
      desc.className = 'desc'
      desc.textContent = place.description || ''
      button.append(img, name, desc)
      button.onclick = () => page.fillInput('前往' + place.name + '。')
      grid.append(button)
      page.asset({ kind: 'backgrounds', id: place.id, size: 512 }).then(url => { img.src = url }, () => {})
    }
  })
</script>
```

### status

变量用 Helper 的 MVU 接口读，`Mvu.events.VARIABLE_UPDATE_ENDED` 之后重画；位置、物品和头像来自 `DshCardPage.data()`，每结算完一轮或头像就绪时由 `onData` 推送。

```html
<!-- page: status -->
<style>
  .status { display: grid; gap: 16px; padding: 20px; color: var(--ink); font: 15px/1.6 var(--font, sans-serif); }
  .who { display: flex; gap: 16px; align-items: center; }
  .who img { width: 72px; height: 72px; border-radius: 50%; object-fit: cover; background: var(--line); }
  .bar { height: 10px; border-radius: 5px; background: var(--line); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--accent); }
  section { padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--radius, 12px); }
  h2 { margin: 0 0 8px; font: 600 15px/1.4 var(--heading, var(--font)); }
  ul { margin: 0; padding-left: 1.2em; }
  .muted { color: var(--muted); }
  @media (max-width: 760px) { .status { padding: 12px; } }
</style>
<main class="status">
  <div class="who">
    <img id="face" alt="">
    <div><b>夏帆</b><div id="affinity" class="muted"></div><div class="bar"><i id="affinity-bar"></i></div></div>
  </div>
  <section><h2>体力</h2><div id="stamina" class="muted"></div></section>
  <section><h2>位置</h2><div id="location" class="muted"></div></section>
  <section><h2>随身物品</h2><ul id="items"></ul></section>
</main>
<script>
  const page = window.DshCardPage
  const $ = id => document.getElementById(id)
  const escape = text => String(text).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';')
  function applyTheme(t) {
    const vars = { accent: t.accent, ink: t.surfaceText, surface: t.surface, muted: t.muted,
      line: t.border, radius: t.radius + 'px', font: t.fontFamily, heading: t.headingFont }
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty('--' + k, v)
  }
  function renderVariables() {
    const stat = window.Mvu ? Mvu.getMvuData({ type: 'message', message_id: 'latest' }).stat_data || {} : {}
    const affinity = stat.好感?.夏帆
    $('affinity').textContent = typeof affinity === 'number' ? '好感 ' + affinity : '好感 未记录'
    $('affinity-bar').style.width = typeof affinity === 'number' ? Math.max(0, Math.min(100, affinity)) + '%' : '0'
    $('stamina').textContent = stat.体力 ?? '未记录'
  }
  function renderPage(d) {
    applyTheme(d.theme)
    const face = d.figures.find(f => f.name === '夏帆')
    if (face?.avatar) $('face').src = face.avatar
    $('location').textContent = d.ledger.location || '未记录'
    const carried = (d.ledger.items || []).filter(item => item.carried)
    $('items').innerHTML = carried.length
      ? carried.map(item => '<li>' + escape(item.name) + ' ×' + (item.qty ?? 1) + '</li>').join('')
      : '<li class="muted">没有随身物品</li>'
  }
  renderPage(page.data())
  page.onData(renderPage)
  renderVariables()
  if (window.Mvu) eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, renderVariables)
</script>
```

要点：

- 变量和台账分两路：变量走 Helper（`Mvu.getMvuData` + `eventOn`），台账和头像走 `DshCardPage`（`data()` + `onData`）。同一个函数既画第一次也画后续推送。
- 每个值先判断有没有，缺了显示「未记录」；本卡没开 MVU 时没有 `Mvu`，变量区也显示「未记录」。
- 台账文本来自剧情，插进 HTML 前转义。
- 边距写在外层容器上：卡片 HTML 文档统一把 `html`、`body` 的 margin 和 padding 归零（带 `!important`）。

## 写入

两张卡都只 `set` 整个 `pages` 数组：

```js
tavern_update_card({ rawOperations: [
  { op: 'set', path: '/data/extensions/dsh_tavern/pages', value: [ /* 上面的声明，html 换成对应的 HTML 字符串 */ ] }
] })
```

不要整个 `set` `dsh_tavern`，否则会覆盖它下面的其他字段（例如 `modSystem`、`assetBindings`）。
