# 插件开发：媒体与数据

宿主侧 `ctx.tavern` 中挂图片等媒体、保存插件数据、声明本局配置项的接口。

## 生图模型与人物、服装库（`imageModels: 1`、`imageLibrary: 1`）

通过能力版本探测后调用；宿主 API 版本不因新增可选能力递增。资源由来源插件保存，Tavern 提供发现、筛选和隔离，插件之间不读取对方的 JSON 或内部路由。

### 查询并选择已配置的生图模型

```js
if (ctx.tavern.capabilities?.imageModels >= 1) {
  const models = await ctx.tavern.listImageModels({ gameId })
  // 将 models 展示给用户，由用户选定可用项。
  const selected = models.find(item => item.ready)
  if (selected) {
    const image = await ctx.tavern.generateImage({
      gameId, providerId: selected.providerId,
      ...(selected.modelId ? { modelId: selected.modelId } : {}),
      prompt: '雨后的教室', width: 1024, height: 1024,
    })
  }
}
```

`listImageModels({ gameId?, card? })` 返回数组，每项为 `{ providerId, providerLabel, modelId, label, model, ready, reason, maxReferences }`。`providerId` 是宿主分配的 `插件名/渠道名`，`modelId` 是来源的稳定本地 ID；都应原样保存和传回。列表只描述已经配置的模型，不向在线平台请求远程模型目录，也不验证额度。

`imageProvider({ id, label, status, generate, models? })` 可以增加 `models(context)` 回调，返回 `{ id, label, model, ready, reason?, maxReferences }[]`。`status({ modelId? })` 和 `generate({ ...原参数, modelId? })` 必须使用指定模型。未提供 `models` 的旧来源仍显示当前模型，`modelId` 为空字符串；调用时省略 `modelId`。

- 不指定 `providerId`、`modelId` 时使用首个适用来源的当前渠道；指定 `modelId` 时必须同时指定 `providerId`。
- 模型删除或来源卸载后返回 `NOT_CONFIGURED`，不会改用其他模型再次收费。生图仍使用原有参数校验、最多四张并发和 `mayHaveCharged` 错误语义。
- 各来源并行查询，单个回调最多 5 秒；异常来源记日志后跳过。不要把密钥、参考图文件路径放进模型元数据。

### 提供和读取人物、服装库

```js
ctx.tavern.registerImageLibrary({
  id: 'my-library', label: '我的人物与服装',
  characters({ card }) {
    return [{ id: 'person-a', name: '小雨', aliases: ['Rain'],
      traits: { face: '黑发，蓝色眼睛' }, outfitIds: ['uniform'] }]
  },
  outfits({ card, characterId }) {
    return [{ id: 'uniform', name: '制服', characterId: 'person-a',
      parts: { upper: '白色衬衫', lower: '蓝色长裙' }, isDefault: true }]
  },
})

const people = await ctx.tavern.listImageCharacters({ gameId, query: '小雨', limit: 50 })
const person = people.items[0]
const outfits = person ? await ctx.tavern.listImageOutfits({
  gameId, providerId: person.providerId, characterId: person.id,
}) : null
```

每个插件可按不同 `id` 注册多个库；`characters`、`outfits` 至少提供一个。注册随 Cordis 插件卸载撤销，也返回可主动调用的撤销函数。

`listImageCharacters`、`listImageOutfits` 都接受 `{ gameId?, card?, providerId?, query?, offset?, limit? }`，服装查询另可传 `characterId`（此时必须指定 `providerId`，避免不同库的角色 ID 冲突）。返回 `{ items, total, offset, limit, hasMore, errors }`；默认每页 50 项，最多 200 项。`query` 最多 200 字，匹配名称、说明和人物别名。`errors` 仅报告 `{ providerId, code: 'PROVIDER_FAILED' }`，其他正常来源仍可用。

每项带 `providerId`、`providerLabel`；人物字段为 `{ id, name, aliases, group, description, traits, outfitIds }`，`traits` 沿用配图人物库的分视角键 `feature/face/faceBack/bodySFW/bodySFWBack/lowerSFW/lowerSFWBack/bodyNSFW/bodyNSFWBack/lowerNSFW/lowerNSFWBack/negative`；服装字段为 `{ id, name, description, characterId, parts, negative, isDefault }`，`parts` 支持 `upper/lower/shoes/accessory/full/back`。通用服装的 `characterId` 是 `null`。`id` 与 `outfitIds` 都是不透明字符串，按 `providerId + id` 标识资源。宿主只返回这些字段的独立副本，不传文件路径或未知字段。

每个来源单次返回最多 2000 项，来源负责按收到的 `{ gameId?, card?, characterId? }` 筛选自己库内的可见项；宿主在合并后搜索、分页。回调并行执行且最多等待 5 秒，不缓存用户资料，卸载后尚未返回的结果会丢弃。

可传 `gameId` 用于游玩或卡片工作台，也可用 `card` 指定人物卡；同时提供时必须指向同一张卡。省略目标时仅显示全局来源与全局人物。卡内插件必须指定自己的卡或会话，无法读取或调用其他人物卡的来源。内置配图插件从当前内存中的人物库、角色服装和通用服装生成投影；隐藏停用项，保留人物卡绑定与通用服装引用，修改后下次查询即生效。

这些接口用于读取与复用。编辑资料仍通过来源插件自己的保存流程，以保留备份和覆盖保护。

**共用人物记录（schema 4）。** 来源可在注册时另带 `schemaVersion: 4` 与四个函数 `getCharacter({ characterId | figureId })`、`patchCharacter({ characterId, expected, patch })`、`createCharacter({ character })`、`putReferenceImage({ data: Uint8Array, mediaType, name })`，把完整人物记录交给 Tavern 素材库就地编辑。来源仍是唯一存放处：素材库不缓存、不复制记录；写入带上刚读到的记录，来源按它拒绝过期写入（`REVISION_CONFLICT`），没有记录时返回 `NOT_FOUND`，输入不符时返回 `INVALID_ARGUMENT`。记录字段与三层参考图见内置配图插件 README「共用人物记录」。只提供部分函数、或 `schemaVersion` 不是整数时注册报错；不带 `schemaVersion` 的来源保持只读。

## 把插件自己的图片列入对话画廊（`galleryProvider: 1`）

`attach` 需要 `gameId`、`turn` 和正文版本，适合随剧情走的媒体。卡片工作台或插件自己的本地图库没有这些信息时，用 `registerGalleryProvider` 提供图片列表；这些图片只出现在当前 Tavern 会话的「画廊」里，不会伪装成某轮正文附件。

```js
if (ctx.tavern.capabilities?.galleryProvider >= 1) {
  ctx.tavern.registerGalleryProvider({
    async list({ sessionId }) {
      // 从插件自己的图库读取元数据；可忽略 sessionId 来显示插件的本地全局图库。
      return [{ id: 'image-123', caption: '试画', createdAt: Date.now() }]
    },
    async read({ sessionId, id }) {
      const image = await readOwnImage(id)
      return { data: image.bytes, mediaType: image.mediaType }
    },
    async remove({ sessionId, id }) {
      return await deleteOwnImage(id) // 仅确实删除时返回 true
    }
  })
}
```

- `list` 每项需要稳定的字符串 `id`，可选 `caption`、`createdAt`、`updatedAt`；所有来源合计最多展示 2000 项。画廊中的图片按来源名分组，不关联轮次。
- Tavern 只把 `sessionId` 传给回调，不要求插件有 `gameId` 或 `turn`。但它会先确认这是 Tavern 已知会话；未知会话不调用 provider。卡内插件只在 `cardPath` 属于它自己的卡时可见。
- 画廊返回的 ID 是 Tavern 生成的不透明值。每次读取或删除前，Tavern 都会核对该原始 ID 当前仍由同一个 provider 列出；批量删除每个 provider 只读取一次列表。
- `read` 返回 `{ data, mediaType }` 或直接返回字节。只接受与字节签名相符的 PNG、JPEG、WebP、GIF，单图上限 32 MB；SVG、HTML、文件路径和 URL 不受理。图片由 Tavern 的同源媒体路由提供。
- `remove` 仅收到该 provider 自己列表中的 ID；只有返回 `true` 才报告删除成功。回调超时、插件卸载或卡片作用域变化时，迟到结果会被丢弃。provider 出错只隐藏或跳过它自己的条目。
- 注册随插件卸载自动撤销；每个插件最多注册一个画廊来源。provider 图片仍由插件自己的存储管理，Tavern 不复制文件，也不让它们进入剧情分叉或存档。

## 提供模型价格（`pricingProvider: 1`）

Tavern 自己不带价格表。知道模型价格的插件（例如读自己网关定价的插件）用 `pricingProvider` 报价；界面经 `tavernPresentation.getModelPricing(sessionId)` 问到的就是它对这个会话当前模型的报价。

```js
if (ctx.tavern.capabilities?.pricingProvider >= 1) {
  ctx.tavern.pricingProvider({
    async quote({ provider, model }) {
      const price = await myGatewayPrice(provider, model)
      if (!price) return { available: false, reason: '网关没有 ' + model + ' 的价格' }
      return { available: true, rates: { input: price.input, output: price.output, cacheRead: price.cached, cacheWrite: price.input } }
    }
  })
}
```

- `quote` 收到会话当前的模型选择 `{ provider, model, reasoningEffort? }`（会话没有选择时为 `null`），价格以美元 / 百万 Token 计。拿不到价格时返回 `{ available: false, reason }`，不要猜值。
- 每个插件最多一个，多个插件都提供时只问最先注册的那个；没有插件提供时 `getModelPricing` 返回 `{ available: false }`。超过 30 秒或出错时这次没有价格，错误记进 Tavern 日志。注册随插件卸载自动撤销。

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
