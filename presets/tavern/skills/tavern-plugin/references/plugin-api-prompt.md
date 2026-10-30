# 插件开发：正文、结算与任务

宿主侧 `ctx.tavern` 中往正文请求、世界书、后台结算、候选和压缩里添加内容，以及插件任务的接口。

## `promptSection({ name, text })`

往**游玩时的正文提示词**里加一段，例如「请在正文段落之间写 `image###…###` 标记」。`name` 用小写字母、数字、点、下划线和连字符。`text` 可以是字符串，也可以是函数：每次请求模型前调用，收到 `{ gameId }`，返回空字符串就不加。

- 插件段落放在 Tavern 自己的系统提示之后，多个插件按插件名排序。单段最多 8000 字。
- 只进入游玩时的正文请求，不进入人物卡工作台和后台任务（变量结算、生图规划等）；使用 SillyTavern 兼容请求模式时不生效。
- 段落内容变化会让提示词缓存失效、增加费用，尽量保持不变。
- 函数出错时这一段被跳过，正文照常生成。

> DSH 自带的 `systemPrompt.section` 在 Tavern 游玩时不会生效，因为 Tavern 整体接管了正文提示词。请用这个入口。

`promptSection` 适合不常变的规则。每轮都会变的内容（当前状态、记忆摘要）请用下面的 `turnSection`，不会让提示词缓存失效。

## `turnSection({ name, text, position? })`（第 2 版）

往**这一轮**的正文请求里加一段上下文，例如插件维护的【当前状态】或记忆摘要。`text` 可以是字符串，也可以是函数：每轮准备请求时调用一次，收到 `{ gameId, turn, input }`（`input` 是玩家这一轮的输入原文），返回空字符串就不加。

- `position` 默认 `'after'`：段落放在 Tavern 自己的本轮上下文（世界书、现场状态、Guide 等）之后；`'before'` 放在它们之前。更细的位置（比如某一段的前后）不提供，因为 Tavern 内部的段落顺序会调整。多个插件按插件名排序。单段最多 8000 字。
- 每轮只算一次，结果随这一轮保存；同一轮重试时沿用，不会再次调用。
- 只进入游玩时的正文请求；使用 SillyTavern 兼容请求模式时不生效。
- 函数出错或 30 秒没有返回时，这一段被跳过，正文照常生成。

## `worldbookSource({ name, entries })`（第 2 版）

每轮为正文请求补充世界书条目，和 Tavern 召回的世界书放在一起。`entries` 是函数，收到 `{ gameId, turn, input }`，返回条目数组：

```js
ctx.tavern.worldbookSource({ name: 'side-quests', entries: async ({ gameId, input }) => [
  { title: '钟楼支线', content: '……' },
] })
```

- 要不要加入某条，由插件自己判断（可以按 `input` 匹配关键词）；Tavern 不再按关键词二次筛选。
- 每个来源每轮最多 20 条，每条最多 4000 字；`title` 可省略。
- 其余规则同 `turnSection`：每轮算一次、出错跳过、兼容请求模式不生效。

## `worldbookEntries({ name, entries })`（第 2 版）

把插件自己的条目放进这局的世界书条目池，和人物卡、世界书库的条目一起交给 Tavern 召回：关键词激活、常驻、冷却、筛选复审，以及后台结算、候选和 Agent 查世界书看到的资料，都按 Tavern 自己的规则处理。适合会话临时世界书、NPC 台账、剧情线索这类随游戏变化的条目。

```js
ctx.tavern.worldbookEntries({ name: 'session', entries: async ({ gameId, turn }) => {
  const saved = turn ? (await ctx.tavern.readTurnData({ gameId, turn }))?.data : null
  return (saved?.entries || []).map(item => ({ id: item.id, title: item.title, keys: item.keys, content: item.content }))
} })
```

- 每个条目：`id`（必填，同一来源内唯一，字母、数字、点、下划线和连字符，最多 64 字）、`content`（最多 4000 字）、`title`、`keys`（关键词）、`secondaryKeys`（次要关键词，填了就要求同时命中其中之一）、`constant`（常驻）、`force`（不看关键词直接入选；和其他条目一样受冷却：入选后 10 轮内内容没变就不再重复加入）。每个来源最多 200 条。
- `turn` 是最近写完的一轮（还没有时为 0）。Tavern 每次读条目池都会调用 `entries`（发送前、后台准备、候选、Agent 查世界书等，一轮里会有好几次），所以要快，读插件自己存好的数据即可，不要在这里调用模型。5 秒没有返回或出错时，本次不加插件条目，游戏照常进行。
- 冷却和已读按 `id` 记账：同一个 `id` 改了内容，按新内容重新计算。
- 插件条目是纯文本：含 EJS 模板（`<% %>`）的条目会被跳过。它们只参与召回，不写进人物卡或世界书文件，世界书编辑界面里看不到。
- 不合格的条目（`id` 重复、超长、含模板）被跳过，原因记进 Tavern 日志；同一个问题只记一次，直到它变化。
- 和 `worldbookSource` 的区别：`worldbookSource` 由插件自己决定加入哪些内容，直接写进正文请求；`worldbookEntries` 只把条目放进条目池，加不加入由 Tavern 召回决定。

## `settlementSection({ name, text })`（第 2 版）

往每轮的**后台结算**任务里加一段说明，例如「本轮结束时用 `anchor_submit` 记录叙事锚点」。`text` 是字符串或函数，函数收到 `{ gameId, turn, text, textVersion }`：`text` 是正在结算的这一轮正文（结算结束前 `getTurn` 还读不到它），按它决定这一轮要写什么。出错时跳过。

## `settlementTool({ name, description, parameters, execute })`（第 2 版）

给后台结算的模型一个工具，和 Tavern 自己的结算工具同级。

```js
ctx.tavern.settlementTool({
  name: 'anchor_submit',
  description: '记录本轮的叙事锚点',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  async execute({ gameId, turn, arguments: args }) {
    await save(gameId, turn, args.text)
    return { ok: true }
  },
})
```

- `name` 用小写字母、数字和下划线，以字母开头，3–48 个字符；不能和 Tavern 自己的工具或其他插件的工具重名。
- `execute` 的返回值交给模型：字符串原样给，其他值转成 JSON。抛错或 30 秒没有返回时，模型收到一条失败说明，本轮结算照常进行。
- 每轮结算里，所有插件工具合计最多调用 8 次；插件工具要在模型提交本轮结算之前调用，提交之后再调用会被拒绝。
- 只在后台结算任务里可调用，候选、生图等其他后台任务里调用会被拒绝。
- 插件工具跟着 Tavern 自己的结算一起运行：玩家关掉了所有后台结算项时，这一轮不会运行结算，插件工具也就不会被调用。需要每轮必定执行的逻辑，请放在 `onTurnSettled` 里。
- 工具列表在后台会话建立时固定（它位于请求的缓存前缀里）。插件在启动时注册即可；运行中途才注册的工具，要等下一个后台会话才生效。
- 插件不在这一局生效时（例如别的人物卡的卡内插件），它的工具仍在工具列表里（缓存前缀不变），但每轮结算任务会写明哪些插件工具本轮可用、哪些不可用，调用不可用的工具会被拒绝。

## `candidateSection({ name, text })`（第 2 版）

往后台**候选**任务（生成下一步行动选项）里加一段要求，例如「至少给一个探索类选项」。`text` 是字符串或函数，函数收到 `{ gameId }`。出错时跳过，候选照常生成。

## `compactionSection({ name, text })`（第 2 版）

往游玩对话的**上下文压缩**（历史摘要）要求里加一段，例如「摘要里保留每个叙事锚点的原文」。`text` 是字符串或函数，函数收到 `{ gameId }`。只作用于游玩对话；出错时跳过，压缩照常进行。

## `replaceSettlement({ settle })`（第 2 版）

由插件**接管**每轮的后台结算（替换类接口）。适合想用自己的模型和流程做结算、并维护自己状态的插件。

```js
ctx.tavern.replaceSettlement({
  async settle({ gameId, turn, text, posture, tasks, signal }) {
    // text：这一轮的正文；posture：上一轮的现场姿势；tasks.posture：本局是否开启了姿势结算
    // signal：玩家点「停止后台」时中止，把它传给自己的模型请求或子 Agent
    const next = await myModel(text, posture, { signal })
    await ctx.tavern.saveTurnData({ gameId, turn, data: next.state })
    return { posture: next.posture }
  },
})
```

- **必须交回什么**：一个对象。本局开启了姿势结算时，`posture` 必须是非空字符串（最多 8000 字），它会成为下一轮正文看到的【现场】；没开启时可以不返回 `posture`。
- **失败时退回**：`settle` 抛错、120 秒没有返回、或者交回的东西不合格，这一轮自动改用 Tavern 自己的结算，并把原因记进 Tavern 日志。
- **停止**：`signal` 是一个 `AbortSignal`。玩家点「停止后台」时它会中止，Tavern 立刻停止等待，这一轮按玩家停止处理，不会改用 Tavern 自己的结算，也不记为插件错误。插件应据此取消自己的模型请求或子 Agent（例如 `agent.cancel()`）。
- **进度**：结算进行中，Tavern 的后台等待提示会写明「插件「名称」正在结算」。插件为这局建的子 Agent（见下文「插件自建 Agent 的请求记录」）在输出时，提示会区分「模型仍在输出」和「等待模型有效输出」，与 Tavern 自己的结算一样。
- **范围**：只替换普通卡的姿势结算（以及同一步里的人物设计）。使用官方 MVU 变量的卡，变量结算仍由 Tavern 负责，不会调用 `settle`。玩家关掉了所有后台结算项时，这一轮不结算，也不调用 `settle`。
- **只有一个生效**：每个插件只能注册一次。只有一个插件注册时，它自动生效；有多个时都不生效，用 Tavern 自己的结算。

## `replaceLedger({ consolidate })`（第 6 版）

由插件**接管**玩家手动发起的「整理台账」（替换类接口）。适合想用自己的办法挑选上下文、查询旧条目或校验提交的插件。Tavern 仍负责发起、计算待整理的剧情、校验并保存结果，以及下一轮把台账给正文看一次。

```js
ctx.tavern.replaceLedger({
  async consolidate({ gameId, from, through, text, ledger, rules, tool, signal }) {
    // text：第 from–through 轮待整理的剧情；ledger：当前完整台账
    // rules、tool：Tavern 自己整理时用的规则和 ledger_submit 工具定义，可直接复用
    const delta = await myConsolidation({ text, ledger, rules, tool, signal })
    return { delta }  // 格式同 ledger_submit 的参数；返回 null 表示这次交给 Tavern 自己整理
  },
})
```

- **必须交回什么**：`{ delta }`，格式同 `ledger_submit` 的参数（物品、人物、地点的 add / update / remove，地点还有 reparent），无变化交 `{ delta: {} }`。Tavern 按自己的规则原子校验并保存，并记下整理到第 `through` 轮。
- **失败时退回**：`consolidate` 抛错、120 秒没有返回、或者 `delta` 校验不通过，这次自动改用 Tavern 自己的整理，并把原因记进 Tavern 日志。返回 `null` 也由 Tavern 自己整理，但不记错误。
- **停止**：玩家点「停止后台」时 `signal` 中止，这次整理按失败处理，不会改用 Tavern 自己的整理。
- **模型**：Tavern 不替插件调用模型。可以用 `runTask` 让 Tavern 开一个带自定义工具的后台 Agent（整理期间可以调用；它的 `prompt` 最多 2 万字，而 `text` 最多 4 万字，需要自己挑选或分段），也可以用插件自己的模型或子 Agent。
- **只有一个生效**：规则同 `replaceSettlement`。

## `settlementTask({ name, title?, phase?, run })`（第 2 版）

注册一个**结算任务**：每轮正文写完后，和 Tavern 自己的结算排在一起依次运行。适合记忆整理、世界推演、写作建议这类每轮都要做、有自己的提示词和流程的后台工作。

```js
ctx.tavern.settlementTask({
  name: 'world-events',
  title: '世界推演',          // 显示给玩家；省略时用 name
  phase: 'after',             // 'before'：Tavern 自己的结算之前；'parallel'（第 3 版）：和它同时；'after'（默认）：之后
  async run({ gameId, turn, textVersion, text, variables, phase, signal, runAgent }) {
    const { text: events } = await runAgent({ prompt: '按这一轮的剧情推演各方势力的进展，列成要点：\n' + text })
    await ctx.tavern.saveTurnData({ gameId, turn, textVersion, data: { events } })
  },
})
```

- **顺序**：每轮先跑所有 `before` 任务，再跑 Tavern 自己的结算，最后跑所有 `after` 任务。`parallel` 任务（第 3 版）在 Tavern 自己的结算开始时启动、和它同时运行，`after` 任务等它们和结算都结束才开始；适合导演、配音预合成这类只读正文、想尽早开工的工作。同一阶段的任务一个接一个运行，按插件名、任务名排序。
- **下一轮会等它们跑完**：玩家发下一轮时，Tavern 先等这些任务结束，所以这一轮的产出（存进 `saveTurnData`，再用 `turnSection` 注入）一定赶得上下一轮。任务越慢，玩家等得越久。
- **`run` 收到**：这一轮的 `gameId`、`turn`、`textVersion`、`text`、`rawText`、`card`、`variables`（同 `onTurnSettled`），以及 `phase`、`signal`、`runAgent`。`before`、`parallel` 任务看到的是结算前的变量；`after` 任务看到的是 Tavern 结算之后的变量，前面的任务改过变量时，后面的任务读到的是改过的。
- **`runAgent(input)`**：等同 `runTask`，参数相同（`prompt`、`tools`），`gameId` 和 `signal` 已经替你填好。提示词、工具、流程都由插件自己决定，也可以不用它，改用 DSH 的 `llm` 服务。
- **每个正文版本只跑一次**：同一个 `textVersion` 的同一阶段不会重复运行（例如重试结算时）。编辑正文、重新生成产生新版本后会再跑。
- **停止与超时**：玩家点「停止后台」、或这一轮的正文版本被替换（回退、重新生成、编辑）时 `signal` 中止，这一阶段剩下的任务不再运行，不记为错误。单个任务 5 分钟没结束按出错处理。
- **出错**：只记进 Tavern 日志，接着跑下一个任务；不影响 Tavern 自己的结算和下一轮。
- **进度**：运行中，后台等待提示会写明「插件「插件名 · 任务名」正在结算」，期间本局显示后台忙，候选、编辑等操作要等它结束。
- `before`、`parallel` 任务运行时这一轮还没结算完：可以 `saveTurnData`，不能用 `setVariables`、`editTurn`（它们要等结算结束）。想让 Tavern 的结算用上 `before` 任务的产出，配合 `settlementSection` 把它写进结算说明。
- 开场白不触发结算任务。

## `manualTask({ name, title?, description?, input?, run })`（第 2 版）

注册一个**手动任务**：游玩时状态栏的「插件任务」里出现一个按钮，玩家点了才运行。适合「整理一下记忆」「生成本章总结」这类按需的后台工作。

```js
ctx.tavern.manualTask({
  name: 'chapter-summary',
  title: '本章总结',
  description: '总结到目前为止的剧情',              // 按钮的提示文字
  input: { label: '侧重点（选填）', placeholder: '例如：人物关系' },  // 省略时直接运行，不弹输入框
  async run({ gameId, turn, textVersion, text, variables, input, signal, runAgent }) {
    const { text: summary } = await runAgent({ prompt: '总结本局到目前为止的剧情。侧重点：' + (input || '无') })
    await ctx.tavern.saveGameData({ gameId, data: { summary } })
  },
})
```

- `run` 收到最新一轮（结算结束后的）内容，字段同结算任务；还没有正文时 `turn` 为 `null`。`input` 是玩家在输入框里填的文字（最多 4000 字，可能为空字符串）。
- 和 Tavern 自己的手动任务（设计人物、整理台账）一样独占后台：正文生成中、后台结算或别的任务运行时不能启动；运行期间本局显示后台忙，玩家可以点「停止后台」中止，下一轮会等它结束。
- 10 分钟没结束按出错处理；出错记进 Tavern 日志。

## `startTask({ gameId, name, input? })`（第 2 版）

替玩家启动本插件的一个手动任务，效果和玩家点按钮一样，任务开始后立即返回 `{ started: true }`。适合插件在自己的面板里放按钮。不能启动时（例如后台正忙）抛错。

## `runTask({ gameId, prompt, tools?, signal? })`（第 2 版）

让 Tavern 为这局开一个一次性的后台 Agent，替插件完成一项任务，返回 `{ text }`。它用这局的后台模型，带着和 Tavern 自己的后台任务一样的背景：人物卡、世界书、最近两轮剧情，也能查世界书、查历史原文。

```js
const { text } = await ctx.tavern.runTask({
  gameId,
  prompt: '游戏日期从初五跳到了二十。按世界设定，推演这十五天里各方势力的进展，列成要点。',
  tools: [{ name: 'world_event_save', description: '保存一条推演出的事件', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    execute: async ({ text }) => { events.push(text); return { ok: true } } }],
})
```

- 每次都是新的会话，用完即弃，不会进入 Tavern 结算、候选用的那个常驻后台会话，也不影响它们的上下文。
- `tools` 最多 8 个，格式同 `settlementTool`（多一个 `execute`），工具名不能和 Tavern 自己的工具重名；一次任务最多调用 16 次。工具出错时把错误交给模型，同时记进 Tavern 日志。
- 请求会记进这局的请求记录，「完整上下文」里可以查看。用 `signal`（`AbortSignal`）可以中途停止；10 分钟没结束会自动停止并抛错。
- 这局没有后台模型，或插件不在这一局生效时，直接抛错。花的是玩家后台模型的额度，请只在需要时调用。
- 只需要一次普通的模型调用、不需要游戏背景时，直接用 DSH 的 `llm` 服务更省。

## `handle(name, handler)`（第 2 版）

注册一个处理函数，供插件自己的浏览器侧用 `tavernUi.callHost(name, args)` 调用，例如浏览器侧的「重画」按钮让宿主侧去生成。

```js
ctx.tavern.handle('dsh-tavern-xxx/redraw', async ({ gameId, turn }) => {
  const current = await ctx.tavern.getTurn({ gameId, turn })
  // ……生成并 attach
  return { ok: true }
})
```

- `name` 在所有插件之间唯一，建议以插件名开头；用小写字母、数字和 `. _ : / -`，最多 96 个字符。
- `handler` 收到浏览器侧传来的参数（能转成 JSON 的值，最多 256 KB），返回值同样要能转成 JSON（最多 4 MB），原样交回浏览器侧。抛错时浏览器侧的 `callHost` 以同样的错误信息失败。
- 参数里带上 `gameId`：插件不在这一局生效时，调用会被拒绝；处理函数出错会记进 Tavern 日志。不带 `gameId` 的调用不受按局开关约束。
- 没有超时限制，长任务请自己控制。
