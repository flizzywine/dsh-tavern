# 面板合同

## 声明

写在人物卡 raw 的 `data.extensions.dsh_tavern.statusPanel`：

```json
{
  "version": 1,
  "title": "辉夜的状态",
  "html": "<style>…</style><div id=\"panel\"></div><script>…</script>",
  "variables": { "reads": { "affinity": { "source": "mvu", "path": "/好感/辉夜" } } },
  "ledger": ["items"],
  "figures": [{ "name": "辉夜", "emotion": "平静" }]
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `version` | 是 | 固定为 `1`。 |
| `title` | 否 | 覆盖层标题栏的文字，最多 40 字，省略时显示「状态」。 |
| `size` | 否 | 面板窗口大小：`window`（默认，舞台中央最大 1080×860 的窗口）或 `full`（铺满整个舞台，没有标题栏，只在右上角浮一个关闭按钮，适合整屏场景式面板；内容需自行适配视口，别让底部被裁掉）。手机宽度下两者都铺满。 |
| `html` | 是 | 面板内容，非空字符串，见「渲染」。 |
| `variables.reads` | 否 | 要读的变量，格式与舞台组件的变量声明相同，只有 `reads`，没有 `writes`。 |
| `ledger` | 否 | 要读的台账分区名，最多 8 个、不重复。 |
| `figures` | 否 | 要显示头像的人物，最多 8 个、名字不重复：`name` 是人物名（最多 40 字），`emotion` 是可选的表情名（最多 24 字）。 |

`variables.reads` 的规则：

- 键是读取名，小写字母开头，只含小写字母、数字和 `-`，最长 32 个字符；最多 32 项。
- `source`：`mvu` 读最新已结算回合的 `stat_data`；`helper-chat` 读聊天变量。
- `path` 是 JSON Pointer，以 `/` 开头，从 `stat_data`（或聊天变量）的根算起，最多 16 层、512 字节；不能用 `-`、`*`、`$` 或 `__` 开头的键。
- 同一来源的两个路径不能互相包含：要整棵子树就只声明父路径。

`ledger` 的分区名：`location`、`locationPath`、`items`、`npcs`、`scenes`、`itemLog`、`updatedTurn`。

`figures` 的头像由舞台已有的人物头像查找提供，名字写本卡人物的名字；认不出或没有头像时 `avatar` 为 `null`。

其他字段一律拒绝。声明只在保存时校验一次：不合格时保存失败，返回 `CARD_STATUS_PANEL_INVALID` 和出错字段的路径（如 `statusPanel.ledger.1`），按报错修改后重新保存。

## 写入

用 `tavern_update_card` 的 `rawOperations` 只改 `data.extensions.dsh_tavern.statusPanel`，不动卡的其他部分。面板是纯展示数据，不计入卡内容摘要（`cardContentDigest`），改面板不会让进行中的游戏提示「卡已更新」。

## 数据

面板脚本从 `DshStatusPanel` 拿数据：

| 接口 | 作用 |
| --- | --- |
| `data()` | 返回当前快照（副本，可以随意修改）。 |
| `onData(fn)` | 每次推送新快照时调用 `fn(snapshot)`，返回取消订阅的函数。 |
| `close()` | 关闭面板。 |

快照：

```js
{
  variables: { affinity: { status: 'ready', value: 3 } },
  ledger: { items: [{ name: '钥匙', qty: 1, carried: true }] },
  figures: [{ name: '辉夜', emotion: '平静', avatar: 'data:image/webp;base64,…' }],
  theme: { accent: '#c79060', accentText: '#171717', surface: '#242321', surfaceText: '#faf7f2',
           muted: '#c6c0b8', border: '#70685f', radius: 12, fontFamily: '…', headingFont: '…' }
}
```

- `variables` 每项有 `status`：`ready` 时 `value` 是该路径的值；`missing` 表示路径不存在；`unavailable` 表示来源还没有数据（例如还没有结算过的回合）；`too-large` 表示超出预算。全部读取合计不超过 12 KiB，单个值不超过 8 KiB。面板要能显示这四种状态，而不是假设一定有值。
- `ledger` 只含声明的分区。合计不超过 12 KiB，超出时从最长的列表末尾截掉条目。
- `figures` 的头像是 `data:` URL，到得比文字晚：打开时 `avatar` 可能还是 `null`，头像就绪后会再推送一次。
- 推送时机：打开时读一次；面板开着时每结算完一轮读一次，连续的信号合并成一次读取。

脚本可以从第一行起用 `parent.DshStatusPanel`；页面加载完后 `window.DshStatusPanel` 也指向同一个对象。

## 皮肤配色

`theme` 是当前舞台皮肤的配色，与选项框、设置页同源（来自舞台的 `--gal-ui-*` 变量和本卡皮肤）。面板在自己的文档里运行，读不到舞台页的 CSS 变量，要自己把 `theme` 写成 CSS 变量，例如：

```js
const t = DshStatusPanel.data().theme
Object.entries({ accent: t.accent, ink: t.surfaceText, surface: t.surface, muted: t.muted, line: t.border })
  .forEach(([k, v]) => document.documentElement.style.setProperty('--' + k, v))
```

## 渲染

`html` 与状态栏、正则 HTML、消息内 HTML 走同一条路径：引擎把它交给同一个卡片 HTML 文档构建器，装进覆盖层里的 iframe，不额外加隔离，也不改写内容。写成片段即可：`<style>`、标记和 `<script>`。

- **受信任会话**（设置 `trustedCardMode`，默认开启）：iframe 与页面同源、没有 sandbox 属性，`DshStatusPanel` 可用。
- **不受信任会话**：iframe 带 `sandbox="allow-scripts"`，与消息内 HTML 相同；此时没有 `DshStatusPanel`，访问 `parent` 会抛错，面板只能显示静态内容。脚本先判断接口是否存在，不存在时显示一行说明。

其他约束：

- 覆盖层在 1920 宽的桌面和 390 宽的手机上都会打开，面板布局要能适应窄屏。
- 小图可以内联成 `data:` URI；不要依赖外部网络资源。
- 文档背景透明，下面是覆盖层的皮肤表面色；`html`、`body` 的 margin 和 padding 被统一归零（`!important`），边距写在外层容器上。
- 关闭：标题栏的关闭按钮、点面板外、右键、Esc，或脚本调 `close()`。焦点在受信任的面板内时只有 Esc 关闭，S 键留给面板自己的输入。
