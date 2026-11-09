# 插件开发：读取游戏

宿主侧 `ctx.tavern` 中读取游戏状态、监听回合与时间线变化的接口。

## `apiVersion`

当前为 `7`，向后兼容旧版接口；浏览器侧的 `tavernUi.apiVersion` 单独计数。调用新增的 provider 接口前检查对应能力标记；旧宿主缺少能力时关闭相关功能并说明原因。

## 自定义玩法 `gameMode`

检查 `ctx.tavern.capabilities?.gameMode === 1`，再注册
`ctx.tavern.gameMode({ name, title, version, create, advance, project, foreground? })`。
`name` 使用小写字母开头的 1–64 位字母、数字、点、下划线或连字符；`version` 是存档协议的正整数版本，不是插件包的版本字符串。注册随插件卸载撤销。

- `create({ gameId, input, signal, agent })` 创建本局；`advance({ gameId, state, input, signal, agent })` 推进行动。返回 `{ state, events? }`，`events` 为数组。参数为独立副本，成功后状态与事件一起保存。
- `project({ state })` 返回玩家可见的 JSON。秘密只留在服务端 `state`，页面只接收投影。此回调应为快速确定性的纯计算。
- 可选 `foreground({ data })` 把投影转换为非空文本，呈现在原生聊天中。只使用传入的可见数据；正文上限 2 MiB。重启后读取玩法会恢复并同步尚未加载的原生会话。
- `agent({ id, member?, system, prompt })` 返回 `{ text, ... }`，使用本局后台模型。`id` 标识本次逻辑角色；上下文由插件显式提供，不继承普通故事、世界书或工具。DSH 自身可能附带工作目录等运行信息。
- 需要持久角色时，先用已有的 `ctx.tavern.member({ name, title })` 注册，再将该名称传入 `agent` 的 `member`。同一局、同一插件成员复用持久子会话。每次调用会重建上下文，插件必须从当前 `state` 提供角色记忆，避免回退后的未来知识残留。省略 `member` 时不保证复用会话。

前端通过 [registerGameModeView](plugin-api-ui.md#registergamemodeview-name-render-presentation-lobby) 注册行动界面。玩法激活后，普通故事生成输入被拒绝，玩家通过玩法界面提交结构化行动。

一次 `advance` 是一个独立时间线节点。宿主支持停止、回退、撤销回退、存档导入导出和复制；回退后继续会截掉未来节点。普通故事的正文编辑与回退不修改玩法节点。存档 `version` 与注册版本必须相等；插件缺失或版本不兼容时明确报错。

宿主按局互斥，以 revision 拒绝过期操作，相同已采用 actionId 不再执行；只有当前前台视图可推进行动。取消、超时或卸载后的迟到结果不提交。停止不撤销已提交行动，重试可能再次调用模型并产生费用。默认单次操作超时十分钟；每个快照最多 8 MiB，每局最多 2000 个节点、64 MiB。

独立人物卡示例：[dshcard-werewolf](https://github.com/flizzywine/dshcard-werewolf)。规则与 UI 由人物卡维护，本体只提供通用接口。

## 正文生成器 `bodyGenerator({ name, title, prepare?, generate })`（第 7 版）

检查 `ctx.tavern.capabilities?.bodyGeneration === 1` 后注册。一个生成器同时处理正常发送、最新正文重生成和最新失败输入重试。插件组织自己的上下文、调用 DSH 模型或独立子代理、解析响应，返回最终正文；宿主负责采用、保存、原生会话同步、版本通知和结算。注册返回清理函数，插件卸载自动撤销并取消运行中的回调。

用户在「设置 → DSH Tavern → 剧情」先选正文生成插件，再选择「插件直接生成」或「前台检索后由插件生成」。本局设置可以覆盖全局选择，也可以恢复跟随。生成器标识由宿主组成 `插件名:name`，仅允许当前游戏作用域内已启用的插件。插件注册不会自动改变用户的选择。

- **直接生成**：宿主准备人物、已激活世界书、输入和状态后直接调用插件；不额外请求前台模型。内部通过宿主工具完成原生回合收尾，插件无需调用该工具。
- **前台检索后生成**：前台模型可以查询世界书，再调用宿主工具结束资料收集，宿主把成功查询结果加入材料并调用插件。该模式会产生额外的前台模型请求。

首版仅接受文本输入；附件在调用正文模型前拒绝。使用宿主原有的发送、重生成、失败重试和停止按钮；没有单独的 `bodyRegenerator`、`startBodyRegeneration` 或任意正文提交接口。现有 `runTask` 是后台任务接口，有后台上下文和排队约束，不用于接管前台正文。

### 配置快照与回调

```js
ctx.tavern.bodyGenerator({
  name: 'my-writer',
  title: '我的正文生成器',
  async prepare({ gameId, reason, signal }) {
    // readMySettings 是插件自己的 helper。返回可恢复的配置内容或固定版本。
    const settings = await readMySettings(gameId)
    signal.throwIfAborted()
    return { preset: settings.preset, model: settings.model }
  },
  async generate({ materials, config, signal }) {
    // compile / callModel / parse 是插件自己的 helper，不是 Tavern 接口。
    const request = compile(config.preset, materials)
    const response = await callModel(config.model, request, { signal })
    signal.throwIfAborted()
    return { text: parse(response) }
  },
})
```

`prepare` 可选，可异步；`reason` 为 `normal | regenerate | retry`。宿主在操作开始时调用它，并保存返回的 JSON 配置快照（最多 2 MiB）；未提供时 `config` 为 `null`。正常轮次的配置在前台检索之前冻结。回调内部不要写游戏状态或启动收费模型请求。凭据继续由 DSH 服务管理，不放入配置快照。

`generate` 得到材料和配置的独立副本。返回值必须为 `{ text: string }`，非空、最多 200000 个 JavaScript 字符。插件的输出处理在返回之前完成。用户可选择在提交时追加一遍宿主正则，默认关闭。开启后，宿主按全局、预设、人物卡的顺序处理，并分别保存显示和模型上下文的结果。刷新读取已保存的结果，宿主正文宏不会执行。插件负责校验模型的工具调用并提取正文。

两种回调都有取消信号和 10 分钟超时。传递 `signal` 到模型请求与 Worker；取消、超时、卸载后的迟到结果不会被采用。生成期间更改预设、模型或宿主生成方式只影响后续操作。生成器失败不自动重试、不切换模型或改用宿主生成。

### 失败契约

回调可抛出普通 Error，或附加 `code`、`stage`、`details`。例如：

```js
throw Object.assign(new Error('请求超过模型上下文容量'), {
  code: 'MY_CONTEXT_OVERFLOW', stage: 'response',
  details: { httpStatus: 400, providerCode: 'context_length_exceeded' }
})
```

宿主保留可序列化的 `failure: { code, stage, message, details, category? }`，贯穿失败存档、version 1 工具回执、回合校验与重生成 RPC。外层错误码仍为 `TAVERN_PLUGIN_BODY_GENERATION_FAILED`。旧的普通 Error 和只有 message 的回执继续有效。已知失败类别显示中文原因，诊断信息保留原错误码和阶段。

message 必须是适合玩家阅读的安全摘要（宿主最多保留 500 字符并移除常见凭据、URL 和响应尾部）；不得把请求、响应正文、剧情、思考或凭据拼进 message。details 只接收 100–599 的整数 httpStatus，以及最多 96 字符的 providerCode、finishReason、blockReason 标识（字母、数字、点、下划线、冒号、连字符）。其它字段、cause、stack 均不传播。code/stage 同样限制为 96 字符标识。宿主不代替插件解析服务商协议。

### `materials`（schemaVersion 1）

| 字段 | 语义 |
| --- | --- |
| `schemaVersion / gameId / operationId` | 材料格式、当前游戏、操作标识；操作标识用于诊断，不是存档写权限 |
| `reason` | `normal` 新正文、`regenerate` 最新正文替换、`retry` 最新失败输入补全 |
| `input.raw / input.text` | 原始玩家输入、已完成本轮预处理的输入；不使用合成的重生成指令 |
| `history` | `[{ role, text, turn?, greeting?, input? }]`；目标之前完整有效的已解析可见历史，不含目标旧正文、隐藏工作、废弃 swipe 和回退分支 |
| `context` | `[{ id, kind, text, source }]`；已解析的材料段，`kind` 为 `character / persona / worldbook / writing-rules / guide / script / other` |
| `identities` | `{ characterName, playerName }`，供预设的身份宏使用 |
| `state` | `{ variables, messageVariables, status }`，输入预处理完成、正文生成之前的状态；与内部用于回退的轮前存档分开 |
| `guidance` | 本次重生成指导；空字符串表示未提供 |
| `outputProcessing?.hostRegex` | 本轮开始时选定的宿主正则开关。为 `true` 时，宿主在插件输出处理完成后应用自己的规则。旧宿主可能省略此字段。插件可用它说明处理顺序 |

`context` 的世界书段已包含当轮有效设定和成功的查询补充。查询补充只接受本轮有效的 `worldbook_list/grep/search` 和宿主世界书文件的受限 `read`；失败、隐藏、其他轮次和任意文件读取结果不会传入。已保存材料不会在恢复时重新读文件或执行宏。

历史来自完整存档投影，不从压缩后的模型消息反推，也不重新执行历史宏。材料无法可靠恢复时明确失败；旧存档、已编辑输入或导入记录可能缺少必要快照。`context` 按宿主现有语义段拆分；旧人物快照中未单独保存的字段可能合并为一个人物段，不保证与 ST 原始人物字段逐项对应。

插件决定如何分配模型窗口、是否摘要或筛选已提供的材料；应向用户说明自己的策略。宿主不会为插件静默截断完整历史。不要把 `context` 全部拼接后又重复插入世界书或人物段。

### 提交与恢复

宿主用自己保存的操作、分支、材料及正文版本校验结果，插件无需回传这些内部字段。生成期间旧正文继续有效；提交前失败或取消保留原正文。采用新正文后，即使原生同步或结算失败，也保留新正文并走恢复/重试结算，停止操作不会撤销已提交正文。

同一操作重复调度共享一次执行，已持久化的成功候选可复用。崩溃遗留的运行中模型请求不自动重发；重生成的已保存候选在恢复后由用户重试时采用。模型成功返回到候选落盘之间仍有不确定窗口，不能据此承诺收费调用恰好一次。一次明确的新生成操作可以重新读取插件设置；复用已有候选时不重跑输出正则。

### STcontext 0.3.x 的迁移示例

保留插件的预设存储、`createDshGeneration`、Worker 编译和输出处理。将原来的两次注册替换为一次 `bodyGenerator`，移除面板中对专用重生成任务接口的调用，使用宿主的重生成/停止按钮。`apiVersion 7` 是本仓库版本，不能用 fork 的 API 8 判断兼容性，应检查 `capabilities.bodyGeneration`。

以下 `legacyMaterials` 是插件内部兼容层，让现有 `compilePreset` 先继续工作；后续可直接让编译器读取分段 `context`：

```js
function legacyMaterials(m) {
  const join = kind => m.context.filter(s => s.kind === kind).map(s => s.text).join('\n\n')
  const kinds = { 'writing-rules': 'writingRules', guide: 'guide', script: 'scriptReference', other: 'other' }
  return {
    schemaVersion: 1, completeness: { history: 'all-visible' },
    gameId: m.gameId, trigger: m.reason === 'normal' ? 'normal' : 'regenerate',
    history: m.history,
    input: { raw: m.input.raw, projected: m.input.text },
    card: { name: m.identities.characterName },
    persona: { name: m.identities.playerName, description: join('persona') },
    cardContext: [join('character'), join('persona')].filter(Boolean).join('\n\n'),
    worldbook: { context: join('worldbook') },
    beforeState: { ...m.state, posture: m.state.status },
    writingRequirements: [
      ...m.context.filter(s => kinds[s.kind]).map(s => ({ kind: kinds[s.kind], text: s.text })),
      ...(m.guidance ? [{ kind: 'guidance', text: m.guidance }] : []),
    ],
  }
}

// store、runCompiler、generateBody 均复用 STcontext 自己的实现。
if (ctx.tavern.capabilities?.bodyGeneration === 1) {
  ctx.tavern.bodyGenerator({
    name: 'st-context', title: 'STcontext',
    prepare: () => store.active(),
    async generate({ materials, config: active, signal }) {
      const compiled = await runCompiler('compile', {
        document: active.document, settings: active.settings,
        materials: legacyMaterials(materials),
      }, { signal })
      const response = await generateBody({ request: compiled.request, signal })
      signal.throwIfAborted()
      const output = await runCompiler('output', {
        document: active.document, response, toolName: compiled.toolName,
      }, { signal })
      return { text: output.text }
    },
  })
}
```

STcontext 的请求预览继续由插件维护；`operationId` 可用来区分不同尝试。模型响应同时含普通文本和工具正文时，插件应按声明的协议选择结果，不能简单取最长字符串。

## Provider 能力检查

`tavern.capabilities` 只声明宿主实现了哪些 provider 接口，不代表某个插件已注册，也不代表当前游戏会选择它。检查该能力值为 `1`，并保留旧宿主的降级路径：

```js
const api = ctx.tavern
const canSettleMvu = api.apiVersion >= 4 && api.capabilities?.mvuSettlementProvider === 1
if (canSettleMvu) api.mvuSettlementProvider({ name: 'my-mvu', settle })
```

MVU provider 仅供**当前人物卡绑定的卡内插件**使用；普通全局插件不能接管其他卡的游戏。卡内插件停用或卸载时注册会撤销。若同一游戏有多个候选 provider，Tavern 不会任意挑选一个，会走原生结算。

## `mvuSettlementProvider({ name, settle })`（第 4 版）

为当前卡的官方 MVU 变量结算提供替代结果。注册返回清理函数；卸载时也会自动撤销。`settle` 收到：

```js
{
  gameId, turn, textVersion,
  input,                 // 玩家本轮输入
  storyText,              // 本轮正文
  currentVariables,       // 当前完整变量快照
  variableSchema,         // MVU 变量结构
  swipe, branch,
  lifecycleRevision, storageRevision,
  signal
}
```

返回 `null` 或 `false` 表示不接管，继续 Tavern 原生 MVU 结算；接管时返回 `{ operations }`：

```js
async function settle({ currentVariables, signal }) {
  signal.throwIfAborted()
  const hp = currentVariables.stat_data.角色.体力
  return { operations: [{ op: 'replace', path: '/stat_data/角色/体力', value: hp - 1 }] }
}
```

`textVersion` 是宿主从当前轮 canonical `readPendingTurn().key` 读取后附给回调的正文版本。把回调当作纯计算：不要修改输入快照，也不要在里面写游戏状态或执行不可重复的外部副作用。回调可能在操作尚未持久化前因结算重试再次运行。

`operations` 使用官方 MVU JSON Patch 方言（`replace`、`insert`、`add`、`delta`、`remove`、`move`），`path` 和 `move` 的 `from` 都是以 `/stat_data/` 开头的绝对 JSON Pointer。宿主会校验变量路径和值，通过官方 MVU 运行时应用、审计并原子提交；插件不要调用 `setVariables` 写回快照来模拟结算。`textVersion`、`swipe`、`branch`、`lifecycleRevision` 和 `storageRevision` 标识本次结算目标；回调应按这些字段及 `gameId`、`turn` 实现幂等。宿主会在投递操作前持久化它们；中断后恢复时复用已保存操作，不会为同一份已保存提交再次调用 provider。`signal` 中止时应停止计算，本次结果不提交。返回 `null` 或 `false`（包括多个 provider 候选时）继续原生结算。provider 抛错、返回格式错误或 patch 校验失败时不会形成变量提交，错误会记录并使本次变量结算失败，不会自动改走原生结算；用户重试时 provider 可能再次运行。若操作已持久化，恢复会重投已保存操作；若 provider 已卸载、停用或不再绑定当前卡，宿主拒绝投递这些操作。

该接口只接管变量，姿势与人物设计仍按原有开关运行，不改变现有对白处理。它不是 `replaceSettlement`，也不用于没有官方 MVU 状态的游戏。启用正式 MVU 变量结算仍需人物卡启用了官方 MVU，且游戏的后台变量结算开关开启。

## `onTurnSettled(handler)`

一轮正文写完、后台变量结算结束（成功或失败）后调用一次。同一个 `textVersion` 只通知一次；插件没加载时发生的轮次不补发；开场白不触发，需要时用 `getTurn` 读第 1 轮。

`handler` 收到：

```js
{
  gameId, turn, textVersion,
  greeting,      // 这一轮是不是开场白（onTurnSettled 里总是 false）
  text,          // 这一轮正文的纯文本（去掉了 HTML 标签与程序块，宏已展开）
  rawText,       // 模型原始输出（含插件让模型写进正文的标记）
  card: { id, name },  // id 是人物卡在库里的位置，卡被移动或改名后可能变化
  variables,     // 这一轮结算后的消息变量（副本），没有时为 null
  settledAt,     // 毫秒时间戳
}
```

`variables` 与 SillyTavern 的消息变量同一结构：使用 MVU 变量的卡，变量在 `variables.stat_data` 下。它跟着正文版本走：回退、重新生成、切换版本后读到的是当前显示版本的变量。这是副本，直接改它不影响游戏，要改请用 `setVariables`；Tavern 不解释其中的内容（例如游戏日期），由插件按卡自己的变量名读取。

处理函数里抛错不会影响游戏，错误会写进日志。处理函数不必等生图完成才返回。

## `getTurn({ gameId, turn })`

读某一轮**当前显示版本**的同一份内容（含 `variables`，不含 `settledAt`）。这一轮不存在、或者是还没结算完的最新一轮时返回 `null`。用于插件自己的「手动生成」按钮。只读这一轮，不读整局历史，可以按需随时调用。

## `getTurnState({ gameId })`（第 2 版）

这一局现在的状态，供需要知道「当前是哪一轮、能不能操作」的插件使用：

```js
{
  gameId,
  turn,          // 最新一轮（正文还在生成时，是上一轮写完的那一轮）
  textVersion,   // 最新一轮当前显示的正文版本
  greeting,      // 最新一轮是不是开场白
  generating,    // 前台正在写正文
  settling,      // 后台正在结算（或即将开始）
  busy,          // generating 或 settling
  settled,       // 最新一轮已写完、后台结算已结束
}
```

回退、撤销回退、重新生成后读到的是回退后的当前状态。浏览器侧用 `tavernUi.getTurnState` / `watchTurnState`。

## `getDefaultPlayerName()`、`getPlayerName({ gameId })`

两个接口都异步返回玩家称呼字符串，空值返回 `"你"`，每次调用读取最新值：

- `getDefaultPlayerName()`：全局设置中的「默认玩家称呼」，用于新游戏；不需要 `gameId`。
- `getPlayerName({ gameId })`：这局当前使用的玩家称呼，即 `{{user}}` 的值。开局或本局修改过称呼时，它可能与全局默认值不同；游戏不存在或不是游玩对话时抛出 `TAVERN_PLUGIN_NOT_FOUND`。

人物档案、NPC 提取等插件应读取**本局称呼**来识别玩家。称呼并非玩家的完整别名列表；第二人称「你」等指代仍需插件按正文语境处理。旧版宿主请检查方法是否存在：

```js
ctx.tavern.onTurnSettled(async ({ gameId, text }) => {
  if (typeof ctx.tavern.getPlayerName !== 'function') return
  const playerName = await ctx.tavern.getPlayerName({ gameId })
  // 用 playerName 识别正文中的玩家，避免为玩家建立 NPC 档案。
})
```

浏览器插件可通过自己的宿主处理器调用，再用 `tavernUi.callHost` 取回结果（见[界面扩展](plugin-api-ui.md)）。

### `setDefaultPlayerName({ playerName })`、`setPlayerName({ gameId, playerName })`

两个修改接口都异步返回保存后的称呼字符串。`playerName` 必须是最多 80 字的字符串，去掉首尾空白后保存；空字符串恢复为 `"你"`。类型错误、超过长度或省略 `playerName` 时拒绝修改。

```js
await ctx.tavern.setDefaultPlayerName({ playerName: '林岚' }) // 只影响新游戏默认值
await ctx.tavern.setPlayerName({ gameId, playerName: '林岚' }) // 只修改这一局
```

本局修改使用玩家在设置中修改称呼的同一保存流程，修改后界面和后续 `{{user}}` 展开使用新称呼，已生成的历史正文保持原样。正文生成或后台结算期间拒绝本局修改，报 `TAVERN_PLUGIN_BUSY`；游戏不存在时报 `TAVERN_PLUGIN_NOT_FOUND`。卡内插件只能修改所属卡的游戏称呼，不能修改全局默认值，越界时报 `TAVERN_PLUGIN_SCOPE`。

适合插件里的玩家设置表单。只需排除玩家建档的插件使用读取接口即可。旧版宿主请先检查对应修改方法是否存在。

## `getCardContext({ gameId, turn })`

读这一轮可用的设定材料，供插件写画面提示词：

```js
{
  description,   // 人物卡描述
  personality,   // 性格
  scenario,      // 开场情境
  lore,          // 这一轮正文生成时启用的世界书条目：[{ title, keys, constant, content }]
}
```

`lore` 是生成那一刻保存的快照，后来改世界书不影响已写完的轮次；是否与正文相关由插件自己按 `keys` 和 `constant` 判断。没有快照的旧轮次返回空数组。这一轮不可读时抛错。只读这一轮的设定材料，不读整局历史。

## `getRequestContext({ gameId, turn })`（第 3 版）

读 Tavern 为这一轮**正文请求**准备的本轮上下文，供导演、配图这类后台任务拿到和正文模型同一份材料，不用自己从人物卡、世界书里再拼一遍：

```js
{
  turn,
  input,       // 玩家这一轮的输入（经宏展开等处理后发给模型的样子）
  sections: [  // 按发给模型的顺序
    { slot: 'activeWorldbook', origin: 'tavern:world-book', text },
    { slot: 'currentStateProjection', origin: 'plugin', plugin: 'memory', name: 'recent', text },
  ],
}
```

- `slot` 是这段在请求里的位置：`cardContext`（人物卡材料）、`activeWorldbook`（本轮世界书）、`currentStateProjection`（现场状态）、`scriptReference`（剧本）、`guide`、`writingRules`（写作要求）。
- `origin` 说明来源：`tavern:<种类>` 是 Tavern 自己的，`preset` 来自预设，`plugin` 来自插件的 `turnSection` / `worldbookSource`（带 `plugin`、`name`）。
- 只含**本轮上下文**，不含固定前缀（人物卡描述等，用 `getCard`、`getCardContext` 读）和历史消息（用 `getHistory`）。
- 是这一轮在当前剧情分支上**最近一次**准备的请求；Tavern 只保留最近 40 次准备，更早的轮次返回 `null`。重新生成后读到的是新请求的。

## `getCard({ gameId })`（第 2 版）

读这局正在玩的人物卡，返回 SillyTavern 角色卡的数据（`name`、`description`、`personality`、`scenario`、`first_mes`、`character_book`、`extensions` 等，以卡里实际有的字段为准）。开局时保存了人物卡快照的游戏，读到的是快照，和正文生成用的是同一份。返回的是副本，改它不影响游戏。

## `getCardImage({ gameId })`（第 2 版）

读这局人物卡的图片，返回 `{ url, mediaType }`，卡没有图片（例如 JSON 格式的卡）时返回 `null`。`url` 是酒馆页面里可以直接显示的地址（例如 `<img src>`），只读；读到的是人物卡库里这张卡当前的图片，卡从卡库删除后返回 `null`。浏览器侧经 `callHost` 让宿主侧调用即可。

## `getHistory({ gameId, from, to })`（第 2 版）

读第 `from` 到 `to` 轮已经写完的正文，一次最多 50 轮（省略 `to` 时读 50 轮）。返回 `[{ turn, input, text, rawText }]`：`input` 是玩家这一轮发的话（开场白为空），`text`、`rawText` 的含义同 `onTurnSettled`。还在生成、结算中的最新一轮不返回。只读要的那几轮，长局也不会读整局历史。

## `getCharacterDesigns({ gameId })`、`saveCharacterDesign({ gameId, name, ... })`（第 2 版）

这一局的人物设计档案（酒馆状态里的「人物设计档案」）：正文、结算和插件读同一份，生图插件画人物时用它，文字和图片的人物设定就不会各说各的。

```js
const { characters } = await ctx.tavern.getCharacterDesigns({ gameId })
// [{ name, aliases, identity, narrativeRole, updatedAt, sections: [{ key, label, text }] }]
const look = characters.find(person => person.name === '林岚')?.sections.find(section => section.key === 'appearance')?.text
```

- `sections` 的 `key` 为 `identity`（身份）、`personality`（性格）、`appearance`（外貌）、`speechStyle`（说话方式）、`narrativeRole`（剧情作用），只列出有内容的项。还没有档案时 `characters` 为空数组。
- `saveCharacterDesign` 新建或更新一个人物，规则和后台结算自己建档时相同：`name`、`identity`、`personality`、`appearance`、`speechStyle`、`narrativeRole` 都要写完整，`aliases` 可选；同名人物会被更新。保存后这个人物同步进本局世界书，后续正文和结算都会用到。适合生图插件根据参考图修订外貌后写回，让文字跟着同一份设定走。
- 档案在后台结算时也会更新，需要最新内容时在 `onTurnSettled` 里重新读取。插件不在这一局生效时，保存会被拒绝。

## `backgroundModel({ gameId })`

返回这一局 Tavern 使用的后台模型 `{ provider, model, reasoningEffort? }`，没有时为 `null`。`reasoningEffort` 是这局设置的后台推理强度，没设置时不含这个字段。插件可以用它通过 DSH 的 `llm` 服务做自己的规划，不必让用户再选一次模型。

## `onTimelineChanged(handler)`（第 2 版）

这一局的剧情线变了之后调用：回退、撤销回退、重新生成、编辑正文、分叉。`handler` 收到 `{ gameId, kind, turn?, textVersion?, fromGameId? }`，`kind` 是 `rollback`、`undo-rollback`、`regenerate`、`edit`、`fork` 之一；`textVersion`（第 3 版）是变化之后第 `turn` 轮当前显示的正文版本，这一轮已不存在时没有这个字段；`fork` 时 `gameId` 是新游戏，`fromGameId` 是原游戏。以后可能增加新的 `kind`，不认识的请忽略。通知在变化保存之后发出。

这个通知只是告知。插件的按轮数据会自动跟着剧情线走（见[媒体与数据](plugin-api-data.md)的「插件存档数据」），不需要在这里同步。编辑正文后，Tavern 还会对新的正文版本再发一次 `onTurnSettled`，插件可以据此重算这一轮。

## `versionSignal({ gameId, turn, textVersion })`（第 3 版）

返回一个 `AbortSignal`：这一轮的 `textVersion` 一旦不再是当前显示的版本（回退、重新生成、编辑正文、删局），它就中止，`signal.reason.code` 为 `TAVERN_PLUGIN_STALE_VERSION`。传入时已经不是当前版本的，直接返回已中止的信号。

```js
ctx.tavern.onTurnSettled(async ({ gameId, turn, textVersion, text }) => {
  const signal = await ctx.tavern.versionSignal({ gameId, turn, textVersion })
  const plan = await myDirector(text, { signal })          // 版本失效时自己的模型请求跟着停
  await ctx.tavern.saveTurnData({ gameId, turn, textVersion, data: plan })  // 版本失效时这里也会被拒
})
```

- 适合插件自己开的长任务（导演、生图、配音预合成）：剧情一变就停，不用自己监听 `onTimelineChanged` 再比对版本。
- 结算任务 `run` 收到的 `signal` 已经包含它，不用再取。
- 只负责「停」：迟到的写入照样由 `textVersion` 拦下（`saveTurnData`、`attach`、`setVariables`、`editTurn` 都会拒绝旧版本），插件不需要另做提交、回滚。
- 插件卸载后，它取的信号不再更新。

## `onGameRemoved(handler)`

一局游戏被删除时调用，收到 `{ gameId }`，供插件清理自己按局保存的数据。插件挂到这局上的媒体项由 Tavern 一并清理。

## 改最新一轮（第 2 版）

两个接口都只能改**最新一轮**，并且要等这一轮写完、后台结算结束；适合在 `onTurnSettled` 里调用。都要带上 `textVersion`：期间玩家回退、重新生成或已经改过，会报 `TAVERN_PLUGIN_STALE_VERSION`，什么也不改。插件不在这一局生效时也会被拒绝。

### `setVariables({ gameId, turn, textVersion, variables })`

用 `variables` 整个替换这一轮当前版本的消息变量（结构同 `onTurnSettled` 收到的 `variables`，MVU 卡的数据在 `stat_data` 下）。先读、改、再整个写回：

```js
ctx.tavern.onTurnSettled(async ({ gameId, turn, textVersion, variables }) => {
  if (!variables?.stat_data) return
  const next = structuredClone(variables)
  next.stat_data.世界.日期 = advance(next.stat_data.世界.日期)
  await ctx.tavern.setVariables({ gameId, turn, textVersion, variables: next })
})
```

- 改完后状态栏随即刷新，下一轮正文和后台结算都以改过的变量为准。
- Tavern 不检查变量结构，写错了会直接影响状态栏和后续结算，请按这张卡的变量结构写。最大 1 MB。
- 这一轮的后台结算还没结束时报 `TAVERN_PLUGIN_TURN_UNAVAILABLE`，下一轮正文已经在生成时报 `TAVERN_PLUGIN_BUSY`，都是稍后再试；在 `onTurnSettled` 里调用就不会遇到。

### `editTurn({ gameId, turn, textVersion, text })`

用 `text` 替换这一轮的正文，走的是玩家「编辑正文」同一条路：回退、分叉照常，宏、脚本和结算不会重跑。返回改后这一轮的内容（同 `getTurn`），里面有新的 `textVersion`。

- `text` 是完整的新正文，请在 `rawText` 的基础上改；不要拿 `text` 字段去改，它去掉了 HTML 块，交回来会被拒绝。正文里的 HTML 块（状态栏、美化代码等）必须原样保留，只能改它们之间的文字，也不能在 HTML 块之间新增段落。
- 改完后所有插件会再收到一次这一轮的 `onTurnSettled`（`textVersion` 是新的）。在 `onTurnSettled` 里改正文的插件，要先判断是不是已经改过，避免反复修改。
