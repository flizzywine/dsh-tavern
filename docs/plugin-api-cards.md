# 插件开发：人物卡、Skill 与演出

宿主侧 `ctx.tavern` 中读写人物卡库与 Skill、台词标注与角色素材的接口。

## 人物卡库、改卡与 Skill（第 2 版）

不进游戏也能用：卡片工作台类插件（调卡、批量装脚本、整理经验）靠这几个接口读写人物卡和 Skill，不用直接读写 Tavern 的数据目录。

### `listCards()`

人物卡库里的全部卡片：`[{ id, name, fileName, imageUrl, script, group, starred, error }]`。`id` 是其他人物卡接口要的参数；`imageUrl` 没有封面时为空字符串；`script` 是绑定的剧本 `{ title }` 或 `null`；`group` 未分组时为空字符串；`error` 是读取失败的原因。

### `readCardRaw({ card })`

一张卡的完整 JSON（Tavern 实际在玩的工作版），只读副本。结构就是 SillyTavern 人物卡：v2/v3 卡的扩展数据在 `data.extensions` 下，例如酒馆助手脚本在 `data.extensions.tavern_helper.scripts`。

### `updateCardRaw({ card, operations })`

用 JSON Pointer 改这张卡的工作版：

```js
const raw = await ctx.tavern.readCardRaw({ card: id })
const scripts = [...(raw.data.extensions.tavern_helper?.scripts || []), myScript]
await ctx.tavern.updateCardRaw({ card: id, operations: [{ op: 'set', path: '/data/extensions/tavern_helper/scripts', value: scripts }] })
```

- `operations` 1–200 项，每项 `{ op: 'set', path, value }` 或 `{ op: 'delete', path }`；`value` 是 JSON 值，最大 2 MB。返回 `{ changed, revision }`（`revision` 为第 3 版新增，是改完后的卡版本）。
- **防止覆盖别人的修改**（第 3 版）：读卡前用 `cardRevision` 记下版本，改卡时传 `expectedRevision`。期间玩家或别的插件改过这张卡时，这次修改不生效，报 `TAVERN_PLUGIN_REVISION_CONFLICT`，重新读取后再改。比对和修改在同一个编辑队列里完成，不会有空隙。不传 `expectedRevision` 时照旧直接改。
- 改的是工作版：导入时的原版保留，玩家随时可以在 Tavern 里恢复人物卡。
- Tavern 不替插件检查卡的语义，写错了会直接影响游玩，请按 SillyTavern 人物卡结构写。

### `cardRevision({ card })`、`onCardChanged(handler)`（第 3 版）

`cardRevision` 返回这张卡工作版的版本号：每次修改（玩家编辑、恢复原版、插件 `updateCardRaw`）都会变大，从没改过时为 `0`。只用来比较，不要做算术。

`onCardChanged` 在一张卡的工作版改动之后调用 `handler({ card, revision })`，适合卡片工作台类插件刷新自己的界面或缓存。卡内插件只收到自己那张卡的通知。

```js
const revision = await ctx.tavern.cardRevision({ card })
const raw = await ctx.tavern.readCardRaw({ card })
// ……按 raw 算出要改的内容
await ctx.tavern.updateCardRaw({ card, operations, expectedRevision: revision })
```

### `cardImporter({ id, label, extensions, convert, imported? })`（第 3 版）

让 Tavern 能导入它自己不认识的人物卡文件，例如别的平台的卡包、视觉小说素材包。玩家在人物卡库导入这种扩展名的文件时，Tavern 把文件交给插件转换，再像导入普通卡一样保存：

```js
ctx.tavern.cardImporter({
  id: 'vnpack', label: '视觉小说包', extensions: ['.vnpack'],
  async convert({ name, data }) {           // data：文件的全部字节（Buffer）
    const pack = parseMyFormat(data)
    return {
      card: pack.card,                       // SillyTavern 人物卡 JSON（v2 或 v3）
      files: { 'cover.png': pack.cover },    // 可选：卡里 embeded://路径 引用的文件
      packs: [{ id: 'sprites', format: 'my-vn', title: '立绘', files: pack.sprites }],  // 可选：同 saveCardPack
    }
  },
  async imported({ card }) { /* 可选：卡已存好，card 是它在人物卡库的 id，可以接着 setCastImage 等 */ },
})
```

- `extensions` 1–10 个，写成 `.xxx`，大小写不敏感。`.png`、`.json`、`.charx`、`.dshcard` 始终由 Tavern 自己导入，插件不能接管；同一扩展名只能有一个插件。
- `card` 里 CCv3 的 `data.assets`（封面、表情、背景）按 `files` 里的文件导入，和 CHARX 一样进角色素材；`packs` 存成素材包挂到这张卡上。
- 同一个文件再次导入时直接打开已导入的卡，不再调用 `convert`。
- `convert` 抛错、120 秒没返回或交回的东西不合格时，这次导入失败并把原因告诉玩家。`imported` 出错只记进 Tavern 日志，不影响已经导入的卡。
- 卡内插件不能注册导入器。

### `toolNetwork({ name, capability })`

插件用 DSH 注册工具后，可以声明它需要联网：

```js
ctx.tavern.toolNetwork({ name: 'reference_lookup', capability: 'search' })
```

`capability` 为 `search`（默认）或 `fetch`。游玩时随本局联网开关和前台逐工具开关过滤；卡片工作台允许搜索，`fetch` 还需全局开启网页读取。Tavern 在组装工具列表和实际执行前均检查。后台仍受任务自己的工具白名单与联网限制，不会因为声明而自动获得工具。插件子会话继承可识别的父会话联网开关；非酒馆会话不受影响。

此接口只声明插件自己的工具，不能覆盖 `web_search`、`web_fetch` 等内置工具。返回注销函数，卸载插件时也会自动清理。无需读取 Tavern 的存储文件。`toolModes` 与联网声明独立，可同时使用。

### `toolModes({ name, modes })`

插件用 DSH 的 `tools` 服务注册的工具，默认在游玩和卡片工作台的对话里都会出现。用这个接口限定它出现在哪：`modes` 取 `play`（游玩时写正文的请求）、`card`（卡片工作台），一项或两项。

```js
ctx.tavern.toolModes({ name: 'wrongbook_lookup', modes: ['card'] })  // 只给卡片工作台用
```

只能设置插件自己注册的工具；Tavern 自己的工具由 Tavern 决定。插件卸载时自动撤销。

### `listSkills()`、`readSkill({ name })`、`saveSkill({ name, description, body, references?, overwrite? })`、`removeSkill({ name })`

Tavern 的 Skill：`listSkills` 返回 `[{ name, source, description }]`，`source` 为 `builtin`（内置）、`plugin`（插件自带，第 3 版）或 `user`（玩家自己的）。`readSkill` 返回 `{ name, source, description, content, references }`，`references` 是 `[{ path, content }]`。

- `saveSkill` 新建或覆盖玩家自己的 Skill：`body` 是 SKILL.md 正文，`references` 是完整的参考文件列表（`references/*.md`，最多 30 个，每个最多 10 万字），省略时保留原有参考文件。已存在时要传 `overwrite: true`。内置 Skill 不能覆盖，要改请新建一个自己的。
- `removeSkill` 只能删玩家自己的 Skill。

### `skillSource({ dir, role? })`（第 3 版）

插件自带的 Skill：把插件文件夹里的一个目录登记为 Skill 来源，目录下每个 `<名字>/SKILL.md`（可带 `references/`）就是一个 Skill，写法同玩家自己的 Skill。适合导演、生图这类插件把「怎么写舞台指令」「怎么写画面提示词」交给模型按需读取。

```js
import { fileURLToPath } from 'node:url'
ctx.tavern.skillSource({ dir: fileURLToPath(new URL('./skills', import.meta.url)), role: 'background' })
```

- `dir` 是绝对路径。`role` 是 SKILL.md 没写用途时给谁用：`'card'`（默认，卡片工作台）或 `'background'`（后台任务）；写了 `metadata.tavern.purpose` 的按它来。
- 只读：玩家可以在 Skill 页停用它、改给别的角色用，不能删改插件的文件；`saveSkill` 不能写同名 Skill。`listSkills` 里 `source` 为 `plugin`。
- 优先级在 Tavern 内置的之后、玩家自己的之前：和内置 Skill 同名时用内置的。
- 插件卸载时自动撤销。卡内插件不能添加 Skill（Skill 对所有局可见）。

## 演出：台词标注与角色素材（第 2 版）

玩家在「舞台设置」打开「对话气泡」后，正文模型把每句台词写成带说话人和情绪的对白气泡，人物卡还可以配上各人物的头像和表情立绘（见[角色演出](design/cast-presentation.md)）。这些是给配音、立绘、Galgame 式演出这类插件用的公共数据：插件读它们，不用自己再让模型标一遍。

### `getCast({ gameId, turn })`

读某一轮**当前显示版本**的台词标注，返回 `{ turn, textVersion, lines }`，没有标注时返回 `null`。`lines` 按正文顺序排列：

```js
[{ n: 1, quote: '你来了。', speaker: '林曦', emotion: 'joy' }]
```

- `quote` 是这句台词：对白气泡里的原话（更早的轮次是后台标注过的引号里的原话），用它在正文里找到这句；`speaker` 是正文里的人名；`emotion` 是 SillyTavern 表情扩展的 28 个情绪名之一（`joy`、`anger`、`neutral`…），可以直接对应 ST 立绘包的文件名。
- 台词跟着正文版本走：重新生成、编辑后读到的是新版本自己的台词，正文提交后就有。没写成对白气泡的台词不在列表里。
- 玩家关掉「对话气泡」后正文不再写对白气泡，已有的照常可读。

### `onCastAnnotated(handler)`

一轮正文提交后、里面有对白气泡时调用 `handler({ gameId, turn, textVersion, lines })`，字段同 `getCast`。适合配音插件在这时合成语音、演出插件在这时编排下一幕。它不等后台结算，早于 `onTurnSettled`；插件不在这一局生效时不通知。

### `getCastAssets({ gameId })`

这局人物卡的角色素材：`{ player, card: { name, imageUrl }, characters: [{ name, aliases, avatarUrl, avatars, sprites, voices }] }`。`player` 是玩家名；`avatars` 是各情绪的头像、`sprites` 是各情绪的立绘，都是 `{ 情绪名: 图片地址 }`；`voices` 是 `{ 配音渠道: 声音 }`；地址都可以直接放进 `<img src>`。素材由玩家在全屏舞台上传或导入 ST 立绘包，跟着人物卡走，所有用这张卡的局共用。找人物时同时比对 `name` 和 `aliases`。

### `castAssetSource({ name, characters })`（第 2 版）

把插件自己掌握的人物图片并入这局的角色素材，例如 DSH 人物卡素材包里的表情头像。`characters({ gameId })` 返回 `[{ name, aliases?, avatarUrl?, avatars?, sprites? }]`，`avatars`、`sprites` 是 `{ 情绪名: 图片地址 }`，情绪名用台词标注的 28 个。地址要能直接放进 `<img src>`（`/` 开头、`http(s)://` 或 `data:image/`），其他的丢掉。

- 并入后 `getCastAssets`、舞台、正文头像都会用到：正文里每句台词旁的头像按这句的情绪取 `avatars`，没有再取 `sprites`、`avatarUrl`。
- 和玩家自己的素材是同一人物时（比对 `name` 和 `aliases`），玩家的图片优先，插件只补玩家没有的；只由插件提供的人物不能在「角色素材」里清除。
- 每次读取都会调用，出错时跳过这个来源并记进 Tavern 日志。

### `listCardPacks({ gameId })`、`readCardPackFile({ gameId, pack, path })`

DSH 人物卡（`.dshcard`，见[格式设计](design/dsh-card-format.md)）带的素材包。`listCardPacks` 返回这局人物卡带的包：`[{ id, contentHash, format, title, name, baseUrl }]`。Tavern 不解读包的内容，`format` 说明由谁解读（例如 `dsh-asset-pack`）。读文件：宿主侧用 `readCardPackFile`，返回 `{ data, mediaType, size }`；浏览器侧直接用 `baseUrl + 包内路径`，支持分段读取（音频、视频可以边下边播）。图片、音频、视频、字体、JSON、文本按原类型提供，其他类型（包括 HTML、SVG、JS）只能下载，不会在页面里运行。浏览器侧用 `tavernUi.getCardPacks(gameId)` 拿同样的列表。

### 写角色素材：`setCastImage`、`removeCastImage`、`setCastCharacter`、`setCastVoice`、`removeCastCharacter`（第 3 版）

和玩家在「舞台素材」里做的一样，按人物卡写（`card` 是 `listCards` 的 `id`，或 `onTurnSettled` 里 `card.id`）。适合生图插件把画好的立绘存进卡、导入器插件导入素材、配音插件给人物配上声音：

```js
await ctx.tavern.setCastImage({ card, name: '林岚', slot: 'joy', data: pngBytes })   // slot：'avatar' 或 28 个情绪名之一
await ctx.tavern.setCastCharacter({ card, name: '林岚', aliases: ['岚'] })           // 新建或改别名；rename 改名
await ctx.tavern.setCastVoice({ card, name: '林岚', provider: 'dsh-tavern-edge/edge', voice: 'zh-CN-XiaoxiaoNeural' })  // voice 为 '' 时清除
await ctx.tavern.removeCastImage({ card, name: '林岚', slot: 'joy' })
await ctx.tavern.removeCastCharacter({ card, name: '林岚' })
```

- 图片 `data` 是 `Uint8Array` 或 `Buffer`，PNG、JPEG、WebP、GIF，单张最多 8 MB；同样的内容只存一份。规则和限制与玩家上传相同，不合格时抛错。
- 写的是玩家自己的素材：玩家在「酒馆状态」里看得到、改得了、删得掉；与 `castAssetSource`（插件临时提供、玩家清不掉）不同。
- 写完后这张卡的各局（正文头像、舞台）自动刷新。卡内插件只能写自己的卡。

### `saveCardPack({ card, id, format?, title?, files })`、`removeCardPack({ card, id })`（第 3 版）

把一组文件存成素材包并挂到人物卡上，和 DSH 人物卡自带的包存在同一处、按同样方式读取（`listCardPacks`、`readCardPackFile`、浏览器侧 `baseUrl`）。适合插件导入 Live2D 模型、背景、BGM 这类成套素材：

```js
const { id, contentHash } = await ctx.tavern.saveCardPack({ card, id: 'stage-bg', format: 'my-director', title: '背景',
  files: [{ path: 'bg/night.png', data: pngBytes }, { path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) }] })
```

- `id` 用字母、数字、点、下划线和连字符；同一张卡上已有同 `id` 的包时整个替换。`files` 1–5000 个，`path` 是包内相对路径（不能以 `/` 开头，不能含 `..` 或以 `.` 开头的部分），`data` 是 `Uint8Array` 或 `Buffer`。
- 每个文件按内容只存一份，内容完全相同的包直接复用；`contentHash` 由 Tavern 计算，包的内容一变它就变，浏览器可以放心长期缓存。
- `format` 说明由谁解读包的内容，Tavern 不解读。图片、音视频、字体、JSON、文本按原类型提供，其他类型只能下载、不会在页面里运行。
- `removeCardPack` 只是把包从卡上取下，返回是否取下了。卡内插件只能写自己的卡。

### `speechProvider({ id, label, description?, voices?, defaultVoice?, version?, synthesize })`

添加一个配音渠道，例如 Edge TTS、火山、自己部署的语音服务。玩家在「设置 → DSH Tavern → 显示与交互 → 配音」的渠道列表里选中它后，台词朗读、舞台朗读和其他插件的 `synthesizeSpeech` 都走这个渠道。

```js
ctx.tavern.speechProvider({
  id: 'edge', label: 'Edge 朗读',
  voices: ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural'],   // 声音输入框的候选，可省略
  defaultVoice: 'zh-CN-XiaoxiaoNeural',
  async synthesize({ text, voice, emotion, signal }) {
    const data = await myTts(text, voice, { signal })
    return { data, mediaType: 'audio/mpeg' }   // Uint8Array 或 Buffer；mp3、wav、ogg、aac、flac
  },
})
```

- `id` 用小写字母、数字、点、下划线和连字符，渠道全名是 `插件名/id`；`label` 1–30 字。
- `voice` 是这个人物在这个渠道上的声音（玩家在「舞台素材」里填），没填时是玩家填的默认声音，再没有就是 `defaultVoice`；`emotion` 是台词标注的情绪名，旁白为 `neutral`。
- `synthesize` 还收到（第 3 版）：`gameId`（为某一局合成时）、`speaker`（正文里的人名，设置页试听时为空字符串）、`narration`（是不是旁白）。渠道可以据此自己决定怎么读，例如按人物挑参考音频。
- `version`（第 3 版，最多 40 字）：渠道的合成方式变了（换了模型、参数）时改它，旧缓存就不再使用。
- 渠道自己的地址、Key 等设置由插件自己保存（DSH 的设置区或凭据服务），Tavern 只保存每个人物用哪个声音。
- 同一渠道、同一声音、同一情绪的同一句话只合成一次，之后读缓存；插件渠道的缓存还按 `speaker`、`narration` 和 `version` 区分。120 秒没返回或出错时这句不播，错误记进 Tavern 日志。插件卸载后渠道消失，选着它的玩家听不到配音，直到选别的渠道或插件重新加载。

### `synthesizeSpeech({ gameId, speaker, text, emotion?, narration? })`

用玩家选的渠道和这个人物的声音合成一句，返回 `{ url, mediaType }`，`url` 可以直接交给 `<audio>`。配音关闭、渠道是浏览器朗读（声音在浏览器里合成，宿主侧拿不到音频）、或旁白没有设声音时返回 `null`。`narration: true` 表示旁白，用旁白声音。适合做自己的播放界面、把语音挂进媒体项；只想在浏览器里播放时用 `tavernUi.speak` 更省事。
