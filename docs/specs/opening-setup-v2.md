# 开局设置 v2 规格（openingSetup version 2）

状态：已实现。版本：2.0（2026-11-03）。
依据：对 14 张已安装卡开场方式的调研。领域实现：`tavern-plugin/lib/domain/opening-setup.js`（唯一权威）。

## 1. 目标与分层

做卡人在人物卡里写一小段声明式配置，就得到一个好看、可用的开局设置页：

| 层 | 写什么 | 谁渲染 |
|---|---|---|
| schema | `fields[]` + `message` | 宿主原生表单（准备页） |
| 美化 token | `theme` | 同上，CSS 变量 `--dsh-opening-*` |
| 自定义模板（可选） | `template`（HTML/CSS，无脚本） | 沙箱 iframe，宿主把自己的控件放进插槽 |
| 脚本化（v1） | `form`（整页 HTML/JS） | 现有准备页沙箱，`window.dshOpening.start` |

位置：`data.extensions.dsh_tavern.openingSetup`。`{version: 1, form}` 照旧有效，就是 v2 的「脚本化」一档，不做任何转换（见 §8）。

本体只提供接口和默认外观。舞台素材包（背景、立绘、BGM）属于舞台边界，不进本体表单。

## 2. 文档结构

```text
{ version: 2, title?, intro?, theme?, fields: Field[], message, template? }
```

- `title`（≤ 60 字）、`intro`（≤ 400 字，纯文本，可含 `{{user}}`/`{{char}}`）：标题区。
- `fields`：1–40 个字段，按顺序显示。
- `message`：第一条玩家输入的模板（字符串，或 JSON 对象，见 §5）。
- 整份文档序列化后 ≤ 1 MB；不认识的键一律拒绝（写错的键不会被静默忽略）。

### 2.1 字段（Field）

公共键：

| 键 | 说明 |
|---|---|
| `key` | `/^[a-z][a-z0-9_]{0,31}$/`，文档内唯一；`note`、`group` 可省略 |
| `type` | `name` `text` `choice` `multi` `slider` `toggle` `note` `group` |
| `label` | 显示名（≤ 60 字），`note` 以外必填 |
| `help` | 控件下的一行说明（≤ 200 字） |
| `required` | 必填（`name` 恒为必填） |
| `default` | 默认值，见各类型 |
| `when` | 条件显示：`{ key: 值 \| [值…] \| true \| false }`，全部满足才显示；只能引用前面的字段；引用的字段被隐藏时本字段也隐藏 |
| `variable` | MVU 点路径（相对 `stat_data`），写本字段的值 |
| `variables` | `{ 点路径: 值或模板 }`，本字段显示时写入 |

类型：

| type | 额外键 | 值 | 默认 |
|---|---|---|---|
| `name` | `maxLength`（≤ 80，默认 40）`placeholder` | 本局称呼 = `{{user}}` | `{{user}}`（准备页称呼） |
| `text` | `maxLength`（≤ 4000，默认 200）`multiline` `placeholder` | 字符串 | `""` |
| `choice` | `options[]`（1–40） | 选中项的 `value` | 第一项 |
| `multi` | `options[]`、`min`、`max` | `value` 数组（按选项顺序） | `[]` |
| `slider` | `min` `max` `step`（默认 1） | 数字 | `min` |
| `toggle` | `text`（开启时的附带文字） | 布尔 | `false` |
| `note` | `text`（≤ 4000）`fold`（折叠标题） | 无 | — |
| `group` | `points`（总点数） | 无 | — |

- 文档里至多一个 `name` 字段；没有时用准备页称呼。
- `group` 是分组标题；它之后、下一个 `group` 之前的字段属于它。有 `points` 时，组内 slider 的 `(值 − min)` 之和不得超过 `points`（属性点分配）。
- `multi` 与 `toggle` 不能带开局分支（`scriptStart`）。

### 2.2 选项（Option）

`options` 的每一项：`"文字"`（简写，`value` = `label` = 文字），或对象：

| 键 | 说明 |
|---|---|
| `value` | 字符串 / 数字 / 布尔，字段内唯一；省略时 = `label` |
| `label` | 显示名（≤ 60 字） |
| `desc` | 一句说明（≤ 200 字） |
| `image` | 图片引用，见 §3.2 |
| `text` | 附带文字，消息里用 `{key.text}` 引用（≤ 8000 字） |
| `variables` | 选中时写入的 `{ 点路径: 值或模板 }` |
| `scriptStart` | 开局分支：`{ chunk: N }` 从绑定剧本第 N 块（从 1 数）开始；`{ mode: "story" }` 本局不跟随剧本（后日谈） |
| `worldbook` | 选中时的世界书开关：`{ 条目标题前缀: true \| false }` |

### 2.3 变量写入

- 点路径 `/^[^.\s]+(\.[^.\s]+)*$/`，≤ 200 字，相对 `stat_data`。宿主在建新局时写进所选开场白楼层（§6 第 5 步）；MVU 的 `[值, 说明]` 只替换值。
- 顺序：字段按出现顺序；同一字段内 `variable` → 字段 `variables` → 选中项的 `variables`。后写的覆盖先写的。
- 被 `when` 隐藏的字段不写任何变量、不进消息。
- `variables` 的字符串值是模板（§5）；整串恰好是一个占位符时保留原类型（数字、布尔、数组）。

### 2.4 开局分支与世界书

- 所有显示中的选中项里，至多一个带 `scriptStart`；写卡时校验只有一个 choice 字段的选项带它。省略时完全沿用既有行为。
- `scriptStart` 走既有宿主路径（`parseOpeningScriptStart` → 准备草稿 → `startAligned`），块不存在时中止开局，不钳制。
- `worldbook` 作用于本次准备草稿的世界书快照，不改原卡、不影响其他聊天：每个条目取匹配到的**最长**标题前缀决定启用与否；没有匹配的条目不变；后面字段的开关覆盖前面的。

## 3. 美化 token

### 3.1 theme

| 键 | CSS 变量 | 默认（宿主主题） | 校验 |
|---|---|---|---|
| `accent` | `--dsh-opening-accent` | `--fork-accent` | 颜色 |
| `background` | `--dsh-opening-bg` | `--fork-bg` | 颜色 |
| `surface` | `--dsh-opening-surface` | `--fork-surface` | 颜色 |
| `text` | `--dsh-opening-text` | `--fork-text` | 颜色 |
| `muted` | `--dsh-opening-muted` | `--fork-muted` | 颜色 |
| `border` | `--dsh-opening-border` | `--fork-border` | 颜色 |
| `radius` | `--dsh-opening-radius` | `--fork-radius-md` | `0`–`32px` |
| `font` | `--dsh-opening-font` | 宿主正文字体 | `serif` `sans` `mono` 或字体名列表 |
| `titleFont` | `--dsh-opening-title-font` | = `font` | 同上 |
| `image` | `--dsh-opening-image` | 无 | §3.2 |
| `layout` | — | `center` | `center` / `split` |

颜色：`#rgb`、`#rgba`、`#rrggbb`、`#rrggbbaa`、`rgb()/rgba()`。字体名只允许字母、数字、空格、中日文、`-` `,` `'` `"`。

布局：手机（窄于 720 px）永远单列；桌面 `center` 为居中单列（最宽 720 px），`split` 为左图右表（有 `image` 时）。

### 3.2 图片引用

只接受：`"cover"`（本卡封面）或 `data:image/(png|jpeg|webp|gif);base64,…`（单张 ≤ 256 KB）。外链、卡内其他路径一律在写卡时拒绝（外链会被 CSP 拦下且泄露玩家 IP）。卡内资源引用留给后续版本（目前客户端没有稳定的卡内资源 URL 合同）。

## 4. 自定义模板（可选）

`template`：一段 HTML（可含 `<style>`），≤ 200 KB。有模板时宿主用模板代替默认表单外观。

### 4.1 沙箱

- `<iframe sandbox="allow-same-origin" srcdoc="…">`，**不带** `allow-scripts`、`allow-forms`、`allow-popups`、`allow-top-navigation`。模板里的任何脚本都不会执行。
- srcdoc 由宿主编译（`compileOpeningTemplate`），头部是这条 CSP：

```text
default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; font-src 'self' data:; script-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; connect-src 'none'; media-src 'none'; form-action 'none'; base-uri 'none'
```

- 编译时删除：`script` `iframe` `frame` `frameset` `object` `embed` `applet` `noscript` `template` `title` 元素（连同内容）；`form` `base` `meta` `link` `html` `head` `body` 标签（内容保留）；作者的 `<style>` 提到头部；所有 `on*` 属性、`srcdoc`、`target`、`formaction`、`action`、`http-equiv`；`href`/`src`/`xlink:href`/`action` 中 `javascript:`、`vbscript:`、`data:`（非图片）URL；`href` 只保留 `#` 锚点；CSS 里的 `@import`、`expression(`、`url()` 中非 `data:image` 的引用。
- `{{user}}`/`{{char}}` 在编译时替换（HTML 转义）。token 样式表（§3）先于作者样式注入。

### 4.2 插槽（受限桥）

| 元素 | 作用 |
|---|---|
| `<dsh-field key="K"></dsh-field>` | 宿主放入字段 K 的控件（与默认表单同一套控件） |
| `<dsh-value key="K" part="label\|text" fallback="…"></dsh-value>` | 宿主实时填入 K 的值（或选项标签/附带文字），空时显示 `fallback` |
| `<dsh-start>文字</dsh-start>` | 开始按钮；没有时宿主在模板下方放默认按钮 |

- 每个非 `note`、非 `group` 字段必须恰好出现在一个 `<dsh-field>` 里（写卡时校验）；`note`/`group` 由模板自己排版，可以不放。
- 字段的 `when` 照常生效：被隐藏字段所在的 `<dsh-field>` 及其最近的 `[data-dsh-when]` 祖先隐藏。
- 模板里的「弹窗」「示例按钮」等脚本交互做不到；用 `<details>` 代替弹窗。

## 5. 消息模板

占位符：

| 写法 | 结果 |
|---|---|
| `{K}` | 字段值；choice 为选项 `value`，multi 以「、」连接，toggle 为 `是`/`否` |
| `{K.label}` | 选项 `label`（multi 以「、」连接） |
| `{K.text}` | 选项 / toggle 的附带文字（multi 以换行连接）；toggle 关闭时为空 |
| `{K\|备用}` | 值为空或字段被隐藏时用「备用」 |
| `{{user}}` `{{char}}` | 本局称呼、角色名 |

- 键必须是文档里的字段（写卡时校验）；其他花括号原样保留。
- `message` 为对象时，宿主对每个字符串叶子做替换后 `JSON.stringify(…, null, 2)` 作为第一条输入；整串恰好是一个占位符的叶子保留原类型。
- 结果去掉首尾空白后不能为空。

## 6. 开局流程（帧中继）

1. 准备页读到 v2 文档时，每条开场白的预览带 `setup`（宿主已替换 `{{user}}`/`{{char}}`，已编译模板）；开场白预览帧照常挂载但视觉隐藏（保留布局，不用 `display:none`），它的准备页运行时和桥保持可用。
2. 玩家填表、点开始。父页面向该帧 `contentWindow` 发：`{ type: "dsh-tavern-opening-setup-start", values: { K: 值… } }`（只含 schema 字段键，不含隐藏字段）。
3. 帧（只接受 `event.source === parent`）调 `dsh-tavern-helper-call`，`method: "resolveOpeningSetup"`，`args: { values }`。
4. 宿主（`opening-preparation.callRuntime`）从草稿的卡读出 spec，`resolveOpeningSetup(spec, values, {userName, charName})` 得到 `{ playerName, variables, message, scriptStart?, worldbook? }`；有 `worldbook` 时改写草稿世界书快照；`variables` 留在宿主草稿上；返回 `{ playerName, message, scriptStart? }`。值不合法时抛出一句可读的中文错误。
5. 帧调用既有 `window.dshOpening.start(resolved)`（称呼、剧本起点、开局命令沿用 v1 路径）。随后的 `prepareOpeningCommand` 把这些变量绑定到本次开局，建新局时由宿主写进所选开场白楼层（`applyOpeningVariables`，MVU 的 `[值, 说明]` 只替换值）。不在帧里写：帧里的 MVU 可能仍在初始化开场楼层，会用 initvar 默认值盖掉刚写的值（实测中卡的愿望与位置字段因此丢失）。跳过设定或 v1 开局不带这些变量。
6. 帧回复父页面 `{ type: "dsh-tavern-opening-setup-result", ok: true }` 或 `{ ok: false, error }`；父页面把错误显示在开始按钮下一行。
7. 「跳过设定，直接开始」照旧：不填表单直接开局，由玩家先说话。

有 v2 文档的卡：准备页运行时总是启用（不加载 MVU 以外的东西），开场白不显示也不发送（与 v1 相同，开场楼层写 U+3000 承载开局变量）。

## 7. 校验在哪里做

| 时机 | 做什么 | 代码 |
|---|---|---|
| 写卡（卡片工作台、`card apply`、导入后的更新，统一走 `card-preparation.update`） | `validateOpeningSetupSpec`：结构、类型、键唯一、`when` 前向引用、路径、颜色/字体/图片、`scriptStart` 形状、模板插槽恰好一次、消息占位符键存在 | `card-preparation.js` |
| 玩家提交 | `resolveOpeningSetup`：必填、长度、选项属于该字段、slider 范围与步长、组总点数、multi 数量 | `opening-preparation.js` |
| 读取 | 不再校验 | — |

## 8. v1 `{form}` 是脚本化子集

- `{version: 1, form}` 继续有效，读法、准备页、`window.dshOpening.start` 全部不变，没有转换代码。
- v2 文档不能带 `form`；需要脚本（实时计算、示例按钮、多步向导）的卡继续用 v1。
- `window.dshOpening` 保留：v2 的开始也经过它。
- 现有 v1 卡可以改写为 v2 并删掉 `form` 键。

## 9. 标准示例（露娜，schema + token）

```json
{
  "version": 2,
  "title": "月面电台",
  "intro": "从月亮来的露娜，要在虚拟城当上主播。",
  "theme": { "accent": "#e8578f", "font": "serif" },
  "fields": [
    { "key": "name", "type": "name", "label": "你的称呼" },
    { "key": "stage", "type": "choice", "label": "从哪里开始", "variable": "剧情.阶段", "options": [
      { "value": "同居初期", "desc": "露娜刚住进小澄家，想当主播" },
      { "value": "星光杯", "desc": "露娜报名了星光杯，小澄当制作人" },
      { "value": "坦白之后", "desc": "花火大会后，露娜说出了瞒着的事" },
      { "value": "月之迎接", "desc": "满月之夜，月人要来接她回去" },
      { "value": "结局之后", "label": "后日谈", "desc": "十年后，露娜在新的身体里复活", "scriptStart": { "mode": "story" } } ] },
    { "key": "bond", "type": "choice", "label": "和露娜的关系", "variable": "好感.露娜", "options": [
      { "value": 5, "label": "刚认识" }, { "value": 35, "label": "常一起玩" }, { "value": 65, "label": "最在意的人" } ] }
  ],
  "message": "（开局：{stage.label}。{name}和露娜的关系：{bond.label}。从眼前的场景写起。）"
}
```

- 18 行，UTF-8 1 227 字节（按上面排版，LF 换行；`tests/opening-setup-v2.test.mjs` 从本节读出并校验）。
- 从零开始的做卡步骤：① 列出 initvar 里给玩家的变量（占位值 `待定`/`未知`/`{{user}}` 就是字段骨架，见 RESEARCH §e）；② 每个变量写一个字段（称呼用 `name`，阶段用 `choice` + `variable`）；③ 写一句 `message`；④ 可选写 `theme`；⑤ 用 `card apply` 的 `openingSetup.set` 写入（dry-run 后 confirm）。共 5 步，其中 ④ 可选。

## 10. 调研「schema 影响」逐条处理

1. 字段类型 text/name/choice/multi/slider/toggle/note/group —— **采纳**，§2.1；图片选择是 choice 选项带 `image`，不单设类型。
2. `name` 即本局称呼、唯一一处 —— **采纳**，至多一个 `name` 字段，默认 `{{user}}`。
3. 起点是选项属性，后日谈同形 —— **采纳**，`option.scriptStart`，复用 v1 形状与校验。
4. `variable` + 选项 `variables`（可内插）—— **采纳**，§2.3。
5. `when` 条件显示、隐藏字段不写 —— **采纳**，§2.1/§2.3。
6. 消息模板、可输出 JSON 对象 —— **采纳**，§5（有卡的开局载荷是 JSON）。
7. 选项附带文字 `text` —— **采纳**，`{K.text}`；toggle 也有 `text`。
8. 世界书开关 —— **采纳**，`option.worldbook` 按最长标题前缀；扣扣的周目路线照搬后与 v1 结果一致。
9. 属性点总数 —— **采纳**，`group.points`。
10. 选项图、封面、背景限于封面与 data: —— **部分采纳**：`cover` 与 `data:` 采纳；卡内资源引用暂不采纳（客户端没有稳定的卡内资源 URL 合同）。
11. 无脚本模板 + 值回显 —— **采纳**，§4（`<dsh-value>`）。
12. 示例按钮、弹窗做不到 —— **接受这一限制**：弹窗用 `<details>`，示例按钮删除；真需要脚本的卡留在 v1。
13. 多开场白 = 起点选择 —— **否决选项切换开场白**：准备页已有开场白翻页，v2 表单显示在每条开场白上；再加一个「切换开场白」的选项会和翻页打架。
14. initvar 占位值 = 字段骨架 —— **采纳为做卡步骤**（§9 第 ① 步、工作台 Skill），不进运行时。
