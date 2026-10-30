# 插件开发：媒体与数据

宿主侧 `ctx.tavern` 中挂图片等媒体、保存插件数据、声明本局配置项的接口。

## `attach({ gameId, turn, textVersion, item })`

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
  // 以下三项给 Tavern 的插图卡用（见 registerIllustrator）：
  prompt,        // 可选：这张图的提示词，「改提示词」的初始内容（≤ 12000 字）
  activity,      // 可选：图还在、但正在处理时的说明，{ label, progress?, cancellable? }；null 表示没有
  actions,       // 可选：插图卡上额外的按钮，[{ id, label, confirm? }]，最多 4 个；点了交给 illustrator.action，有 confirm 时先请玩家确认
}
```

- `image` 用 `attachments.saveImage()` 保存的图片（PNG、JPEG、WebP、GIF）。
- `video`、`audio` 用 `attachments.saveFile({ data, name })` 保存的文件，`name` 要带扩展名（mp4、webm、mov、mp3、m4a、wav、ogg、flac 等），Tavern 按扩展名决定播放方式，支持拖动进度。
- 自定义类型由插件在浏览器侧注册显示方式（见 `registerMediaRenderer`）。
- `anchor`、`caption`、`error` 各不超过 500 字；每局最多 2000 个媒体项。

常见流程：先 `attach` 一个 `status: 'pending'` 的占位，生成完成后 `update` 成 `ready`。

## `update(id, changes)`

修改自己挂的媒体项，`changes` 只需写要改的字段，返回修改后的媒体项。不能修改 `id`、`turn`、`textVersion`。

图片换成新的 `attachment` 时（比如重画），旧图自动保留为早期版本，最多 8 个，在返回值的 `history` 里（`{ caption, prompt, createdAt, data? }`）。旧图当时的 `data` 也随版本保存（第 5 版），插件可据此找到要删的版本，玩家删除时也原样还给插件（见 `onMediaRemoved`）；删掉当前图、由上一版顶上时，`data` 也换回上一版的。玩家可以在插图卡上翻看和删除这些版本。

## `remove(id, { version? })`

删除自己挂的媒体项，删掉返回 `true`，不存在或不属于本插件返回 `false`。

`version`（第 5 版）只删一张图：`'current'` 删当前图，由最近的早期版本顶上；数字是 `history` 里的下标。删掉最后一张时整项删除。

## `onMediaRemoved(handler)`（第 5 版）

玩家在对话或画廊里删掉本插件挂的图时调用，只通知这张图的主人；插件自己 `remove` 不会触发。收到：

```js
{ gameId, itemId, kind, turn, textVersion,
  itemRemoved,  // 整项都没了时为 true；只删了一个版本时为 false
  pictures: [{ caption, prompt, createdAt, data? }] }  // 被删的每张图，data 是挂图或重画时写入的那份
```

插件自己另存了图（生成记录、缓存文件）时，在这里一并删掉，让两边同进同退。

## `list({ gameId, turn? })`

列出本插件在这一局（或这一轮）挂的全部媒体项，包括其他版本上的；每项带 `current` 表示是否属于当前显示的版本。

## `publishState({ gameId, name, data })`（第 3 版）

把插件的最新状态推给自己的浏览器侧，浏览器侧用 `tavernUi.watchState(gameId, name, listener)` 收到。适合导演定下这一幕后让舞台立刻换景，不用浏览器侧反复 `callHost` 轮询。

```js
// 宿主侧
await ctx.tavern.publishState({ gameId, name: 'stage', data: { turn, textVersion, scene } })
// 浏览器侧
ctx.tavernUi.watchState(gameId, 'stage', state => render(state))
```

- 只保留每个 `name` 最新的一份（不是事件队列）；`data` 是 JSON 值，最多 256 KB，`null` 表示清空。`name` 规则同 `promptSection`。
- 只有本插件自己的浏览器侧收得到。插件不在这一局生效时不能发布，浏览器侧读到 `null`。
- 只存在内存里：DSH 重启或删局后没有了。要跟剧情走、要随存档保存的状态，存进 `saveTurnData`，这里只放给页面显示的那一份；建议带上 `textVersion`，浏览器侧据此判断是不是当前版本。

## 插件存档数据（第 2 版）

记忆、叙事锚点这类插件需要按轮保存状态。Tavern 提供两种存储，每个插件只能读写自己的那一份：

| 存储 | 随回退、重新生成变化 | 用来放 |
|---|---|---|
| 按轮数据 | 是，自动 | 记忆、状态、锚点等跟剧情走的东西 |
| 整局数据 | 否 | 这一局的缓存、跨分支的统计 |

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

### `savePluginData({ data })`、`readPluginData()`（第 3 版）

插件自己的数据，**不跟某一局走**：服务地址、默认画风、全局开关这类插件设置，以及跨局的统计。每个插件一份，最多 256 KB；`data` 是能转成 JSON 的值，传 `null` 清除。`readPluginData` 没有数据时返回 `null`。

```js
await ctx.tavern.savePluginData({ data: { endpoint: 'http://127.0.0.1:8188', style: 'anime' } })
const settings = (await ctx.tavern.readPluginData()) || {}
```

- 存在 Tavern 的数据目录里，不在插件文件夹里：用户更新插件不会丢；删除插件时随插件文件夹一起移进 `plugin-backups`。
- 存在服务端：电脑、手机打开同一个酒馆，读到的是同一份。
- 浏览器侧用 `tavernUi.readPluginData()`、`tavernUi.savePluginData(data)` 读写同一份，适合插件自己的设置页。
- 密钥不要放这里，用 DSH 的 `credentials` 服务。

### `gameSettings({ title?, fields })`、`getGameSettings({ gameId })`、`onGameSettingsChanged(handler)`（第 2 版）

给每一局加插件自己的配置项。插件只声明有哪些项，Tavern 把它们画在本局设置里（和本局设置的其他项同样的样式），玩家的取值按局保存，分叉、导出存档时一起带走。

```js
ctx.tavern.gameSettings({ title: '舞台导演', fields: [
  { key: 'director', type: 'boolean', label: '舞台导演', description: '每轮按正文换场景。', default: true },
  { key: 'pace', type: 'select', label: '换装频率', options: [{ value: 'low', label: '少' }, { value: 'high', label: '多' }] },
  { key: 'lines', type: 'number', label: '每幕句数', min: 1, max: 9, default: 3 },
  { key: 'note', type: 'text', label: '导演备注', maxLength: 200 }
] })
const { director } = await ctx.tavern.getGameSettings({ gameId })
ctx.tavern.onGameSettingsChanged(({ gameId, values }) => { /* 玩家在本局设置里改了 */ })
```

- 每个插件声明一次；`title` 最多 20 字，默认用插件名。`fields` 1–20 项，`key` 用字母、数字和下划线；`label` 1–40 字，`description` 最多 200 字。
- `type`：`boolean` 开关；`select` 单选（`options` 1–20 项，写成字符串或 `{ value, label }`）；`number` 数字（可选 `min`、`max`、`step`）；`text` 一行文本（`maxLength` 最多 500，默认 200）。不写 `default` 时分别默认为关、第一个选项、`min` 或 0、空字符串。
- `getGameSettings` 返回这一局实际生效的值：玩家改过的用玩家的，没改过或已不合法（例如插件更新后选项变了）的用默认值。
- 卡内插件的配置项只在它那张卡的局里显示。
- 浏览器侧用 `tavernUi.getGameSettings(gameId)` 读同样的值，`tavernUi.watchGameSettings(gameId, listener)` 在现在和每次改动后收到最新的值。

分叉、导出存档时，插件挂的媒体项也按同样规则带走，媒体用到的图片、音视频文件一并打进存档包。

这两种数据由 Tavern 存在每局一个的插件数据文件里，插件不用自己找地方存，也不要自己写文件：自己写的文件不会随存档、分叉带走，回退时也不会跟着变。插件自己的设置、跨局共享的东西不属于某一局，用 DSH 的设置区或插件自己的存储。

## 插件在哪些局生效

装好并启用的插件在每一局都生效，玩家要停用就在「设置 → 酒馆插件」里整体停用；卡内插件只在它那张卡的局里生效。插件出错时 Tavern 改用自己的做法，并把原因记进 Tavern 日志。
