# MVU 卡格式约定

MVU 卡就是一张普通人物卡，按下面的约定写几处内容。`tavern_apply_mvu` 会按这些约定写入开场初值、两条世界书条目和两条正则（面板 HTML 可由你在 `panel.html` 里给出，美元符号照常写）。也都可以直接改：字段用 `tavern_update_card`（`rawOperations` 可改 `extensions/regex_scripts`），世界书条目用 `tavern_update_worldbook`，也可以用文件编辑器或脚本直接改卡片 JSON（字段都在 `raw.data` 下）。改完调用 `tavern_validate_card`，按 errors 修正。

## 1. 开场初值

每个开场（`first_mes` 和每个 `alternate_greetings`）正文后面放一个 `<initvar>`，再放状态栏入口：

```text
……开场正文……

<initvar>
{
  "$meta": {"strictSet": true},
  "时间": {"日期": "民国二十五年十一月七日", "时段": "夜"},
  "地点": {"名称": "霞飞路事务所"},
  "状态": {"体力": 62},
  "线索": []
}
</initvar>

<mvu-status/>
```

- 内容是 JSON 对象（YAML 也能解析）。各开场字段结构保持一致，值按各自场景填；未知就写明确的空值，不要借用别的开场。
- 根上的 `"$meta": {"strictSet": true}` 让后台按字面值写入数组，避免 MVU 把 `[值, "说明"]` 当作带说明的值。
- 正文里不要写给模型看的状态格式说明；状态由后台按规则维护。

## 2. 世界书条目

- `[initvar]状态初值`：`enabled: false`，`content` 为默认初值 JSON（通常同第一个开场）。可选，供没有 `<initvar>` 的场合兜底。
- `[mvu_update]状态更新规则`：`enabled: true`、`constant: true`。正文写清每个字段在什么剧情事实下怎么变，末尾加一句：`依据本轮已经发生的正文事实和当前变量快照，用 mvu_submit_update 提交。路径相对于 stat_data；无变化提交空 operations。` DSH 只把它交给后台，不进前台正文。

条目字段：`comment` 标题、`content` 正文、`primaryKeys` 关键词数组、`enabled`、`constant`。

## 3. 状态栏

`extensions.regex_scripts` 加两条正则：

```json
[
  {"id": "dsh-mvu-status-view", "scriptName": "MVU 状态视图", "findRegex": "/<mvu-status\\s*\\/>/g",
   "replaceString": "```html\n（面板 HTML）\n```", "placement": [2], "disabled": false, "markdownOnly": true, "promptOnly": false, "runOnEdit": true},
  {"id": "dsh-mvu-hide-marker", "scriptName": "隐藏模型历史中的状态入口", "findRegex": "/\\n*<mvu-status\\s*\\/>/g",
   "replaceString": "", "placement": [2], "disabled": false, "markdownOnly": false, "promptOnly": true, "runOnEdit": true}
]
```

面板是完整 HTML，可以自由写样式和脚本（进度条、折叠、动画都行），在独立框架里运行。颜色用宿主注入的主题变量 `--dsh-theme-bg` / `-surface` / `-text` / `-muted` / `-accent` / `-border`（明暗主题切换时实时更新），不写固定颜色；第二参数给系统色，在别的宿主里也能读。用 `Mvu.getMvuData({type:'message', message_id:'latest'}).stat_data` 读变量，订阅 `Mvu.events.VARIABLE_UPDATE_ENDED` 等事件刷新。下面的模板用 `data-mvu` 属性绑定，可以直接改样式和结构：

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;font:14px/1.6 system-ui,sans-serif;color:var(--dsh-theme-text,CanvasText)}
.panel{padding:12px;border:1px solid var(--dsh-theme-border,GrayText);border-radius:8px}
.bar{height:6px;background:var(--dsh-theme-border,GrayText);border-radius:3px;overflow:hidden}.bar i{display:block;height:100%;background:var(--dsh-theme-accent,LinkText)}
</style>
</head>
<body>
<section class="panel">
  <div>地点：<span data-mvu="/地点/名称"></span></div>
  <div>体力 <span data-mvu="/状态/体力"></span><div class="bar"><i data-mvu-width="/状态/体力" data-max="100"></i></div></div>
  <ul data-mvu-list="/线索"></ul>
</section>
<script>
(function () {
  function get(data, path) { return path.split('/').slice(1).reduce(function (value, key) { return value == null ? undefined : value[key]; }, data); }
  function render() {
    var data = Mvu.getMvuData({ type: 'message', message_id: 'latest' }).stat_data || {};
    document.querySelectorAll('[data-mvu]').forEach(function (el) { var v = get(data, el.dataset.mvu); el.textContent = v == null || v === '' ? '未明确' : String(v); });
    document.querySelectorAll('[data-mvu-width]').forEach(function (el) { var v = Number(get(data, el.dataset.mvuWidth)) || 0, max = Number(el.dataset.max) || 100; el.style.width = Math.max(0, Math.min(100, v / max * 100)) + '%'; });
    document.querySelectorAll('[data-mvu-list]').forEach(function (el) { var v = get(data, el.dataset.mvuList); el.replaceChildren(); (Array.isArray(v) ? v : []).forEach(function (item) { var li = document.createElement('li'); li.textContent = String(item); el.append(li); }); });
  }
  waitGlobalInitialized('Mvu').then(function () {
    new Set([Mvu.events.VARIABLE_INITIALIZED, Mvu.events.VARIABLE_UPDATE_ENDED].concat(Object.values(tavern_events))).forEach(function (event) { eventOn(event, render); });
    render();
  });
})();
</script>
</body>
</html>
```

面板里可以放可点的动作按钮（道具、快捷行动），按钮的 `onclick` 调酒馆助手接口：`triggerSlash('/setinput 递上热毛巾')` 把文字写进本局输入框、由玩家自己发送；`triggerSlash('/send 递上热毛巾 | /trigger')` 直接发送。只作用于面板所在的这一局，不需要插件。

容易出错的地方（校验会提示）：

- `replaceString` 会被当作正则替换文本：`$1`、`$&`、`$$` 会被改写。脚本里需要美元符号写成 `$`。
- 面板脚本语法错误会导致整个面板空白。
- `data-mvu` 等引用的路径要和初值里的字段一致。

## 4. 隐藏属性（只展示属性名，隐藏具体数值）

需要让玩家看到存在某项属性（如好感度、黑化值、怀疑度）但看不到具体数字时，底层 `<initvar>` 和 `[mvu_update]` 照常使用数字维护与结算，在 `tavern_apply_mvu` 的 `visibility` 参数（写入 `extensions.dsh_tavern.mvuVisibility`）里声明路径规则（支持 `*` 单段通配符适配动态新增角色）：

- `mode: "masked"`（纯迷雾）：面板显示 `placeholder`（默认 `"？？？"`），变量回执仅提示「已发生变化」，不透涨跌方向。
- `mode: "trend"`（迷雾 + 趋势）：面板显示 `"？？？"`，变量回执只提示 `略有上升 ↑` / `大幅上升 ↑↑` / `略有下降 ↓`（阈值可用 `largeDelta` 调整，默认 `10`），不显示具体前后值与差值。
- `mode: "tiered"`（模糊档位）：配合 `tiers: [[0, "戒备"], [30, "疏离"], [60, "熟稔"], [85, "信赖"]]`，面板显示对应阶段词；回执在未跨档时提示阶段词与趋势（`trend: false` 可关趋势），跨档时高亮显示 `疏离 → 熟稔`。
- `revealWhen` 为条件破雾预留字段，校验会原样保留，当前阶段暂不执行自动解锁。

## 5. 取值范围（上下限与可选值）

数值有上下限（体力不能为负、进度最多 30 格）或只能取几个值（阶段 0–3）时，写在初值里这一层对象的 `$meta` 中，和 `extensible` 放在一起：`limits` 的键是这一层的子项名（`*` 表示每一项），值是 `min`、`max` 或 `values`：

```json
{
  "$meta": {"limits": {"阶段": {"values": [0, 1, 2, 3]}}},
  "阶段": 0,
  "状态": {"体力": 62, "$meta": {"limits": {"体力": {"min": 0, "max": 100}}}},
  "进度": {"调查": 0, "人脉": 0, "$meta": {"limits": {"*": {"min": 0, "max": 30}}}}
}
```

后台结算写入后核对本轮改到的值：超出范围时整批不保存，把哪一项、允许的范围和执行前后的值退回给后台修正重交（不会悄悄截断）。范围也会列在后台的提示里。`[mvu_update]` 里照常用 `delta` 写增量，不必自己写「不低于 0」。各开场的 `<initvar>` 结构一致时，范围以第一个开场（没有时以 `[initvar]` 条目）为准。

### 规则类的卡

数是规则算出来的（掷骰、花资源、价目表、换阶段时的一串账），就不要让后台读正文去算：在卡的 `data.extensions["dsh.rules"]` 里声明规则（格式 `dsh-rules` v2，写法见 AI检定模组的 README）。规则里的 `state` 列出归规则管的变量，正文模型在故事走到某个动作时用 `tavern_check` 提交，脚本算数，回复结算时由程序直接写进变量。这样写时：

- 归规则管的变量，范围只写在规则里；初值的 `$meta.limits` 不再写它们（卡检查会报错）。
- `[mvu_update]` 只写叙事性的变量（地点、关系进展、任务档案）。不要写「照工具结果记」一类的话：程序已经写了，后台再写这些路径也不作数。
- 换阶段就是一个动作（`set` 阶段变量）加一句 `stop`（这一轮写到哪里为止）；主持说明里写「……时提交『任务开始』」，不写「回合后的结算会……」。

## 6. 修改已有 MVU 卡

照常直接改：加字段就在每个开场的 `<initvar>` 里加，同步改 `[mvu_update]` 规则和面板；删字段同理。改开场正文时保留末尾的 `<initvar>` 和 `<mvu-status/>`。改完校验。
