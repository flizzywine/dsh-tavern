# Tavern 插件接口总览

接口版本：**4**（宿主侧；浏览器侧 `tavernUi.apiVersion` 仍为 **5**）

DSH Tavern 把扩展功能交给第三方 **DSH 插件**：文生图、文生视频、配音，以及记忆、叙事锚点这类需要参与提示词和后台结算的功能。Tavern 提供一层稳定的接口：让插件知道「这一轮写完了、写了什么」，把图片或别的内容「挂回这一轮」，并往正文请求和后台结算里**添加**内容。v4 另提供仅对当前人物卡卡内插件开放的官方 MVU 变量结算 provider。多数是添加类接口，插件出错只会丢掉它自己那一份，游戏照常进行；少数替换类接口（如 `replaceSettlement`）让插件接管某个流程，插件失败时自动退回 Tavern 自己的做法。

## 三条承诺

1. **方便**：插件不需要改 Tavern 源码、不需要读 Tavern 的数据文件、不需要打补丁。
2. **稳定**：接口带版本号，只加不改。Tavern 内部怎么重构，都不影响按本文写的插件。要废弃的东西先标记废弃，至少保留 6 个月。
3. **自由**：挂什么、何时挂、挂几个、用什么模型和服务，全由插件决定。Tavern 只负责显示、和正文版本绑定、回退时隐藏。

反过来，插件也只用本文列出的东西。Tavern 的内部模块、数据目录、内部请求、页面结构都不是接口，随时会变。

## 快速开始

一个插件就是一个文件夹。把它放进 Tavern 数据目录的 `plugins/` 下就会加载，不需要改 Tavern 的任何文件，也不需要打包：

```text
~/.dsh/profile-data/tavern/data/plugins/
└─ dsh-tavern-xxx/
   ├─ package.json   声明宿主侧入口，以及（可选的）浏览器侧
   ├─ index.mjs      宿主侧：用 ctx.tavern
   ├─ client.js      浏览器侧（可选）：用 ctx.tavernUi
   └─ assets/        图片、地图、音效等静态资源（可选），用 tavernUi.assetUrl() 取地址
```

设置了 `DSH_HOME` 时，数据目录在 `$DSH_HOME/profile-data/tavern/data/`。最小示例 [`examples/tavern-plugin-hello`](https://github.com/flizzywine/dsh-tavern/blob/main/examples/tavern-plugin-hello/) 就是这样一个文件夹，整个复制过去即可：宿主侧每轮在第一句话所在段落后挂一张图（先显示「生成中…」再换成图片），浏览器侧把正文里的 `hello###…###` 显示成徽章。把其中的 `drawImage()` 换成你的生图服务，就是一个完整的生图插件。

按「要做什么插件」找写法（配图、记忆、读变量、后台推演、接管结算等），见[常见用法](plugin-recipes.md)。

`package.json` 的写法：

```json
{
  "name": "dsh-tavern-xxx",
  "version": "1.0.0",
  "type": "module",
  "exports": { ".": "./index.mjs", "./client": "./client.js" },
  "dsh": { "client": { "platform": "web", "inject": ["dsh-tavern-plugin"] } }
}
```

- `name` 和 `version` 必须是非空字符串（例如 `"version": "1.0.0"`）；`private: true` 也不能省略版本。DSH 会读取插件包身份，缺少版本可能使官方 DeepSeek 请求在发送前失败。
- 宿主侧入口必须有（`exports` 的 `"."`，或 `main`）。只做界面的插件也要放一个空的 `index.mjs`（`export function apply() {}`）。
- 没有浏览器侧时，去掉 `"./client"` 和整个 `dsh` 字段。
- 插件名建议叫 `dsh-tavern-xxx`，方便用户辨认；不能和已安装的包同名（例如 `dsh-tavern-plugin`），否则会被跳过。
- 插件被删除或卸载时要释放的东西（定时器、连接），用 `ctx.effect(() => () => { /* 清理 */ })` 注册。

浏览器侧的 `client.js` 由浏览器直接加载，不需要打包，固定写成下面的样子；`id` 必须和 `package.json` 的 `name` 一致，React 用 `require('react')` 取：

```js
window.__ModuleLoader__.load({
  id: 'dsh-tavern-xxx',
  factory: (require) => {
    const React = require('react')
    return {
      name: 'dsh-tavern-xxx',
      inject: ['tavernUi'],
      apply(ctx) { /* ctx.tavernUi.registerTextMarker(...) 等 */ },
    }
  },
})
```

什么时候生效：

| 操作 | 生效方式 |
|---|---|
| 往 `plugins/` 放进一个新插件 | 不用重启：宿主侧几秒内加载，浏览器侧刷新一次页面后出现 |
| 修改 `client.js` | 不用刷新：几秒内自动换成新代码 |
| 修改 `index.mjs` | 要重启 DSH |
| 删除插件文件夹 | 宿主侧不再加载；刷新页面后浏览器侧消失 |

Tavern 把 `plugins/` 下的插件登记在 DSH 的 Tavern 配置（`~/.dsh/profiles/tavern/cordis.patch.yml`）里，以 `tavern-user-plugin-` 开头的条目由 Tavern 自动维护，不要手改。插件文件夹缺 `package.json`、有效的 `name` / `version` 或宿主入口时会被跳过，原因写在 Tavern 日志里。Tavern 通过插件文件夹里自动生成的 `.tavern-entry.mjs` 加载宿主侧：插件代码有语法错误、导入失败或 `apply` 抛错时，只在日志里记一条「plugins/<文件夹> 加载失败 / 启动失败」，不会让 DSH 起不来。这个文件不要改，也不用提交到插件仓库。

浏览器侧不同：`client.js` 的 `apply` 抛错时，DSH 会把整个页面判为启动失败（「Failed to load plugins」），所有功能都打不开。浏览器侧 `apply` 里可能出错的调用要自己 `try/catch`，失败时只放弃这个功能。

升级后，已有但缺少有效 `name` / `version` 的插件会保留在磁盘上，但不再登记加载，插件管理和日志会说明原因。请补齐作者确认的版本，或安装作者修正后的插件 / 人物卡，再启用；旧卡暂存副本仍无效时需重新导入修正后的卡。不要为第三方插件随意编造版本。

写好之后怎样发布，才能让别人在设置里一键安装，见[发布与一键安装](plugin-publishing.md)。

> 不要把插件放进 `tools/` 和 `tools.cordis.yml`：那里是卡片工作台的自创工具，挂在 Agent 预设里，要等第一局开始才加载，浏览器侧也永远不会加载。

### 卡内插件

插件也可以放进 DSH 人物卡（`.dshcard`；分发时建议用 `node examples/dshcard-png.mjs` 转成带封面的 `.dshcard.png`，系统和聊天软件会显示封面，导入照常）的 `plugins/<文件夹>/` 随卡分发，写法和上面的插件文件夹完全一样，并在卡的 `dsh.json` 里登记（见[格式设计](https://github.com/flizzywine/dsh-tavern/wiki/%E8%AE%BE%E8%AE%A1%EF%BC%9Adsh-card-format)）：

- 导入卡时插件随卡启用：Tavern 把它放进 `plugins/` 加载（宿主侧几秒内生效，浏览器侧刷新页面后生效）。人物卡库的卡片详情里可以随时停用、再启用。
- **只在这张卡的局里生效**：别的局里，它注册的回调不触发、提示词与结算内容不加入、界面（面板、舞台画面、正文标记、按钮）不出现；带别的局的 `gameId` 或别的卡的 `card` 调用接口会被拒绝；`listCards` 只看得到本卡。
- `package.json` 的 `name` 就是插件名，模块导出的 `name` 要与它一致；同名插件同时只能启用一个（同一张卡导入了两份时，只能启用其中一份的插件）。
- 删除人物卡时，卡内插件一起删除。
- 卡内插件在本机运行代码，权限和普通插件一样，Tavern 只能在插件接口这一层限制它。

## 怎么拿到接口

Tavern 向 DSH 注册了两个服务，插件用 DSH 自带的 `inject` 拿：

| 服务名 | 在哪边 | 用来做什么 |
|---|---|---|
| `tavern` | 宿主（Node） | 监听轮次、读正文与设定、挂媒体、往正文请求和后台结算里加内容、读写人物卡库与 Skill |
| `tavernUi` | 浏览器 | 自定义媒体的显示方式、正文标记、消息按钮、输入框按钮、侧栏面板、全屏界面、替玩家输入、人物卡列表的显示方式、舞台画面、整轮正文的显示方式、酒馆状态里的插件分节、朗读、读最新一条回复（含卡片工作台）、折叠工作台提问、输入框上方的停靠区 |

```js
export const name = 'my-image-plugin'
export const inject = ['tavern']

export function apply(ctx) {
  if (ctx.tavern.apiVersion < 2) return  // 用到第 2 版的接口时
  ctx.tavern.onTurnSettled(async (turn) => { /* ... */ })
}
```

两条规则：

- **用 `ctx.tavern.方法名()` 的形式调用**，不要把方法单独取出来（`const { attach } = ctx.tavern` 会报错）。Tavern 靠调用方式认出是哪个插件，从而让各插件只能看到、修改自己的内容。
- **注册类的方法（`onTurnSettled`、`onTimelineChanged`、`promptSection`、`turnSection`、`settlementSection`、`settlementTool`、`worldbookSource`、`mvuSettlementProvider`、`register…`）在插件卸载时自动撤销**，也会返回一个撤销函数，可以提前调用。

## 基本概念

| 名词 | 含义 |
|---|---|
| `gameId` | 一局游戏。等于 DSH 的会话编号。 |
| `turn` | 轮次编号，开场白是第 1 轮，玩家的第一轮是第 2 轮。编号只增不减：回退后重新生成的正文用新编号，所以编号可能不连续；被回退的轮次读不到，撤销回退后恢复。区分同一轮的不同正文请用 `textVersion`。 |
| `textVersion` | 这一轮正文的某个版本。重写、编辑、切换版本、回退后重新生成，都会得到新的 `textVersion`。不透明字符串，不要解析。 |
| 媒体项 | 插件挂到某个 `textVersion` 上的一样东西：图片、视频、音频，或插件自定义的类型。 |

**绑定规则**：媒体项只在它绑定的 `textVersion` 是当前显示的版本时出现。回退或切到别的版本时隐藏，切回来又出现。Tavern 不会因为回退而删除媒体项。

## 接口分页

| 页面 | 内容 |
|---|---|
| [读取游戏](plugin-api-game.md) | 回合写完、读正文与人物卡、历史、时间线变化、改最新一轮、MVU provider |
| [正文、结算与任务](plugin-api-prompt.md) | 往正文请求、世界书、后台结算、候选、压缩里添加内容；结算任务、手动任务、`runTask`、`handle` |
| [媒体与数据](plugin-api-data.md) | 挂图片等媒体、按轮与整局数据、插件数据、本局配置项、插件在哪些局生效 |
| [人物卡、Skill 与演出](plugin-api-cards.md) | 人物卡库、改卡、Skill、台词标注、角色素材 |
| [后台任务与任务表](plugin-tasks.md) | 任务表与成员：`job`、`member`、`needs` 与产出、`on`、`emit`、`publishOutput`；后台任务页怎么看 |
| [浏览器侧 tavernUi](plugin-api-ui.md) | 显示媒体、正文标记、按钮、面板、舞台、配音与音乐 |
| [皮肤](interface-skin.md) | 只换外观不写代码：一个 .css 文件，可用的变量与类名 |

## 插件自建 Agent 的请求记录

插件用 DSH 的 `agents` 服务为某局游戏建子 Agent 时（例如自己做结算），只要创建时把 `meta.parentSession` 设为这局的 `gameId`，这个 Agent 发出的模型请求就会自动记进这局的请求记录：作为后台请求，归在当时最新的一轮，和 Tavern 自己的请求一样只保留最近 30 轮原文。在该子 Agent 的会话里打开「完整上下文」即可查看。插件不需要调用任何接口，也不要自己写 Tavern 的请求记录文件。

Tavern 只给顶层会话（玩家的游戏会话）加回合上下文和「【酒馆状态】」这类提示；带 `parentSession` 的子 Agent 会话一律不加，插件 Agent 收到的只有插件自己给的内容。

## 注册世界书召回策略

`ctx.tavern.worldbookStrategy({ name, label, description, select })` 注册一种可在本局设置中选择的策略。`name` 是插件内唯一的名称（规则同 `worldbookSource`）；宿主自动添加插件命名空间，插件卸载时自动移除。调用返回移除注册的函数。注册本身不切换任何游戏；默认仍为现有关键词注入策略。

```js
ctx.tavern.worldbookStrategy({
  name: 'first-match',
  label: '首个匹配条目',
  description: '用于与现有召回策略进行对比',
  select({ gameId, userText, purpose, entries }) {
    const entry = entries.find(entry => entry.primaryKeys?.some(key => userText.includes(key)))
    return entry ? [entry.ref] : []
  }
})
```

`select` 可以异步执行，最多 5 秒。输入是独立副本，不包含 Chat 内部状态；`entries` 只含本局启用且非 MVU 更新规则的条目，字段为 `ref`、`sourceUid`、`sourcePath`、`title`、`content`、`constant`、`primaryKeys`、`secondaryKeys`、`order`、`position`、`depth`、`role`。返回该数组内的 `ref` 字符串数组，不能返回任意正文。Tavern 负责模板渲染以及常驻、强制激活条目的保留；策略不能通过省略它们取消强制规则。此模式不消耗现有关键词召回的冷却记录，也不调用“世界书模型筛选”。

卡内插件只能参与所属人物卡的游戏；异步回调结束时再次核对作用域和卸载状态。异常、超时、非法引用、插件不可用时退回现有召回，不覆盖玩家保存的策略选择。插件代码不得在选择回调中产生游戏外副作用。可以用 `tavern.capabilities.worldbookStrategy === 1` 检查支持情况。

## 暂时没有的

下面这些目前还没有接口，不代表不能开放。有实际需要时请提[插件接口需求](https://github.com/flizzywine/dsh-tavern/issues/new?template=plugin-api.yml)，写清要做的插件和卡在哪一步，能开放的会按需补上。

- 修改更早的轮次（`setVariables`、`editTurn` 目前只改最新一轮）。
- 直接使用 Tavern 自己的常驻后台会话：它带着整局的结算历史，插件任务混进去会影响之后的结算。需要游戏背景的后台工作请用 `runTask`。
- 替换 Tavern 的其他流程（提示词组装、候选、压缩）。替换类接口会约定插件要交回的结果，插件失败时退回 Tavern 自己的做法。

直接读写 Tavern 的数据目录和人物卡文件不属于接口：这些文件的格式会随版本变化，插件这样做，Tavern 一更新就可能失效。需要里面的数据，请按上面的方式提需求，由 Tavern 提供读取接口。

## 用 DSH 自带的

- 插件设置页：用 DSH 的设置区（`settings.section`）。
- 模型调用、凭据、附件存储：用 DSH 的 `llm`、`credentials`、`attachments` 服务。

## 已知限制

- 修改插件的宿主侧代码（`index.mjs`）后要重启 DSH 才生效。这是 DSH 的机制。
- 开场白不触发 `onTurnSettled`。

## 缺接口怎么办

Tavern 尽量开放接口，并保持每个接口简单、稳定；接口按插件实际用到的内容补充，实在不能开放的会说明原因。现有接口和 DSH 自带的服务都做不到时，请提一个[插件接口需求](https://github.com/flizzywine/dsh-tavern/issues/new?template=plugin-api.yml)，写清要做的插件、卡在哪一步、试过什么办法。请不要靠改 Tavern 源码或读 Tavern 数据文件绕过去，那样 Tavern 一更新插件就会失效。

