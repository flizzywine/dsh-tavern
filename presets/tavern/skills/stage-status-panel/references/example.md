# 最小示例

一个显示好感度、随身物品和人物头像的面板。卡的 MVU 里有 `好感.辉夜`，台账记录物品。

## 声明

```json
{
  "version": 1,
  "title": "辉夜的状态",
  "variables": { "reads": { "affinity": { "source": "mvu", "path": "/好感/辉夜" } } },
  "ledger": ["items"],
  "figures": [{ "name": "辉夜", "emotion": "平静" }],
  "html": "（下面的 HTML，作为一个 JSON 字符串）"
}
```

## HTML

```html
<style>
  body { margin: 0; padding: 16px; font: 15px/1.6 var(--font, serif); color: var(--ink); }
  .row { display: flex; gap: 12px; align-items: center; }
  .row img { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; background: var(--surface); }
  ul { padding-left: 1.2em; }
  .muted { color: var(--muted); }
</style>
<div class="row"><img id="face" alt=""><div><b>辉夜</b><div id="affinity" class="muted"></div></div></div>
<ul id="items"></ul>
<script>
  let api = null
  try { api = parent.DshStatusPanel } catch {}
  function render(d) {
    const t = d.theme, root = document.documentElement.style
    root.setProperty('--ink', t.surfaceText); root.setProperty('--muted', t.muted)
    root.setProperty('--surface', t.surface); root.setProperty('--font', t.fontFamily)
    const a = d.variables.affinity
    document.getElementById('affinity').textContent = a.status === 'ready' ? '好感 ' + a.value : '好感 —'
    const face = d.figures.find(f => f.name === '辉夜')
    if (face?.avatar) document.getElementById('face').src = face.avatar
    const carried = (d.ledger.items || []).filter(i => i.carried)
    document.getElementById('items').innerHTML = carried.length
      ? carried.map(i => '<li>' + i.name.replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';') + ' ×' + (i.qty ?? 1) + '</li>').join('')
      : '<li class="muted">没有随身物品</li>'
  }
  if (api) { render(api.data()); api.onData(render) }
  else document.getElementById('affinity').textContent = '当前会话不受信任，面板读不到数据。'
</script>
```

要点：

- 打开时先用 `data()` 画一次，之后的推送（新回合结算、头像就绪）都走 `onData(render)`，同一个函数处理两种情况。
- 每个变量先看 `status`，不是 `ready` 就显示占位。
- 台账文本来自剧情，插进 HTML 前转义。
- 不受信任的会话里没有 `DshStatusPanel`，脚本显示一行说明而不是报错。

## 写入

```js
tavern_update_card({ rawOperations: [
  { op: 'set', path: '/data/extensions/dsh_tavern/statusPanel', value: { /* 上面的声明 */ } }
] })
```

路径中间缺少的层会自动建出。只 `set` 到 `statusPanel`，不要整个 `set` `dsh_tavern`，否则会覆盖它下面的其他字段（例如 `modSystem`）。移除面板用 `{ op: 'delete', path: '/data/extensions/dsh_tavern/statusPanel' }`。
