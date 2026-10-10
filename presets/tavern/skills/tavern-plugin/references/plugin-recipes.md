# Tavern 插件常见用法

这里按「我要做什么」列出常见插件的写法，每段代码都只用[插件接口](https://github.com/flizzywine/dsh-tavern/blob/main/docs/plugin-api.md)里列出的方法。代码是骨架：`drawImage()`、`callModel()` 这类函数换成你自己的服务。每个方法的完整规则以接口文档为准。

## 每轮配一张图（生图、配音、视频）

一轮写完后生成内容，先挂一个「生成中」的占位，生成好了再换成成品。配音、视频同理，只是 `kind` 换成 `audio`、`video`，用 `attachments.saveFile` 保存。

```js
export const name = 'dsh-tavern-my-image'
export const inject = ['tavern', 'attachments']

export function apply(ctx) {
  ctx.tavern.onTurnSettled(async turn => {
    const { id } = await ctx.tavern.attach({
      gameId: turn.gameId, turn: turn.turn, textVersion: turn.textVersion,
      item: { kind: 'image', status: 'pending', anchor: turn.text.split('。')[0] },
    })
    try {
      const image = await drawImage(turn.text)
      const attachment = await ctx.attachments.saveImage({ data: image.data, mediaType: image.mediaType, name: 'scene' })
      await ctx.tavern.update(id, { status: 'ready', attachment })
    } catch (error) {
      await ctx.tavern.update(id, { status: 'failed', error: String(error.message || error) })
    }
  })
}
```

- 媒体项绑定在 `textVersion` 上：玩家重新生成、回退后自动隐藏，切回来又出现，插件不用管。
- 想写画面提示词时，用 `getCardContext({ gameId, turn })` 读人物卡描述和这一轮启用的世界书。
- 想用和这局一样的模型做规划，用 `backgroundModel({ gameId })` 拿到模型，再调用 DSH 的 `llm` 服务。
- 完整可运行的例子：[tavern-plugin-hello](https://github.com/flizzywine/dsh-tavern/blob/main/examples/tavern-plugin-hello/index.mjs)。

## 让玩家手动触发（「配图」「重画」按钮）

不想每轮都生成，就在浏览器侧加按钮，按钮再调用插件自己在宿主侧注册的功能。

```js
// 浏览器侧
ctx.tavernUi.registerMessageAction({
  id: 'draw', label: '配图',
  when: ({ settled }) => settled,
  run: async ({ gameId, turn }) => { await callMyHostApi('draw', { gameId, turn }) },
})
```

宿主侧收到请求后，用 `getTurn({ gameId, turn })` 读这一轮的正文和 `textVersion`，再按上一节挂图。针对最新一轮的按钮放在输入框上方，用 `registerComposerAction`。

## 让模型在正文里写标记，由插件显示

例如要求模型在合适的位置写 `image###一段画面描述###`，浏览器侧把标记换成图片。

```js
// 宿主侧：规则不常变，用 promptSection
ctx.tavern.promptSection({ name: 'image-marker', text: '需要配图时，在段落之间单独写一行 image###画面描述###。' })

// 浏览器侧
ctx.tavernUi.registerTextMarker({
  pattern: /image###([^#]+)###/,
  render: ({ groups, streaming }) => streaming ? h('span', null, '（画面生成中）') : h(MyImage, { prompt: groups[0] }),
})
```

`promptSection` 的内容每次请求都一样才不会让提示词缓存失效，不要把每轮变化的内容放进去。`onTurnSettled` 收到的 `rawText` 保留了模型写的标记，宿主侧可以据此提前生成。

## 记忆、状态：每轮记下来，下一轮交给正文

后台结算时让模型调用插件的工具提交本轮要记的东西，存进按轮数据；下一轮写正文前，把最近一份状态加进请求。

```js
ctx.tavern.settlementSection({ name: 'memory', text: '本轮结束时，用 memory_submit 记下本轮新发生、以后需要记得的事。' })

ctx.tavern.settlementTool({
  name: 'memory_submit',
  description: '记录本轮需要长期记住的事',
  parameters: { type: 'object', properties: { notes: { type: 'array', items: { type: 'string' } } }, required: ['notes'] },
  async execute({ gameId, turn, arguments: args }) {
    const previous = (await ctx.tavern.readTurnData({ gameId, turn }))?.data || { notes: [] }
    await ctx.tavern.saveTurnData({ gameId, turn, data: { notes: [...previous.notes, ...args.notes].slice(-50) } })
    return { ok: true }
  },
})

ctx.tavern.turnSection({ name: 'memory', text: async ({ gameId, turn }) => {
  const saved = await ctx.tavern.readTurnData({ gameId, turn })
  return saved ? '【记忆】\n' + saved.data.notes.join('\n') : ''
} })
```

- 每轮存一份**完整状态**，读的时候拿最近一条。回退、重新生成后，被替换掉的版本上的数据自然读不到，不需要自己清理。
- 每轮变化的内容用 `turnSection`，不要用 `promptSection`。
- 玩家关掉了所有后台结算项时，结算不运行，工具也不会被调用。必须每轮执行的逻辑放进 `onTurnSettled`，自己调用模型。
- 想让历史摘要保留这些内容，用 `compactionSection` 提一句要求。

## 读这一轮的变量（游戏日期、数值）

`onTurnSettled` 在后台变量结算完成后才触发，收到的 `variables` 就是这一轮结算后的变量。MVU 卡的变量在 `variables.stat_data` 下，变量名由人物卡决定。

```js
ctx.tavern.onTurnSettled(async ({ gameId, turn, variables }) => {
  const date = variables?.stat_data?.世界?.日期   // 按这张卡的变量结构读
  if (date === undefined) return                   // 没有日期变量的卡，由插件自己决定怎么处理
  const last = (await ctx.tavern.readTurnData({ gameId, turn }))?.data   // 上一次记下的状态
  if (last?.date === date) return
  const world = await advanceWorld(last, date)                           // 按两次日期之间过了多久推进
  await ctx.tavern.saveTurnData({ gameId, turn, data: { ...world, date } })
})
```

变量只读，改它不影响游戏。不同的卡变量结构不同，Tavern 不解释变量的含义。

## 后台长任务：不要写入过期的结果

插件自己在后台推演、生成时，玩家可能已经回退或重新生成。开始时记下 `textVersion`，保存时带上：版本已经不是当前显示的，保存会报 `TAVERN_PLUGIN_STALE_VERSION`，过期结果写不进去。

```js
const running = new Map()   // gameId → AbortController

ctx.tavern.onTurnSettled(async ({ gameId, turn, textVersion, text }) => {
  running.get(gameId)?.abort()
  const controller = new AbortController()
  running.set(gameId, controller)
  try {
    const result = await simulate(text, { signal: controller.signal })
    await ctx.tavern.saveTurnData({ gameId, turn, textVersion, data: result })
  } catch (error) {
    if (error.code !== 'TAVERN_PLUGIN_STALE_VERSION' && !controller.signal.aborted) throw error
  }
})

ctx.tavern.onTimelineChanged(({ gameId }) => running.get(gameId)?.abort())
```

`onTimelineChanged` 只用来提前停掉没用的任务；即使漏了，带 `textVersion` 的保存也能挡住过期结果。

## 用 DSH 子 Agent 做后台工作

需要多步工具调用时，用 DSH 的 `agents` 服务为这局建一个子 Agent。创建时把 `meta.parentSession` 设为 `gameId`：它的请求会自动记进这局的请求记录（「完整上下文」可查看），Tavern 也不会往它的请求里加游戏上下文。

```js
const handle = await ctx.get('agents').create({ meta: { parentSession: gameId, origin: 'subagent' }, /* 模型、工具等见 DSH 文档 */ })
handle.agent.followup({ id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: task }] })
await handle.agent.whenIdle()
```

- 停止：`handle.agent.cancel({ kind: 'user' })`。
- 常驻复用的子 Agent，在 `onGameRemoved` 里释放（`handle.dispose()`）。
- 子 Agent 的建立、压缩、回收都是 DSH 的能力，参数以 DSH 的文档为准。

## 接管每轮结算

想用自己的模型和流程做普通卡的姿势结算，用 `replaceSettlement`。交回 `posture`，玩家点「停止后台」时用 `signal` 取消自己的工作。

```js
ctx.tavern.replaceSettlement({
  async settle({ gameId, turn, text, posture, tasks, signal }) {
    const next = await callModel({ text, posture, signal })
    await ctx.tavern.saveTurnData({ gameId, turn, data: next.state })
    return tasks.posture ? { posture: next.posture } : {}
  },
})
```

- 抛错、超时或交回的结果不合格时，这一轮自动改用 Tavern 自己的结算，并在「本局设置 → 插件」里记下原因。
- 使用 MVU 变量的卡不会调用 `settle`。只想让结算顺带记点东西，用上面的 `settlementSection` 和 `settlementTool` 就够了，不需要接管。

## 回退、分叉、删局时插件要做什么

| 发生了什么 | 按轮数据、媒体项 | 插件要做的 |
|---|---|---|
| 回退、重新生成、编辑正文 | 自动跟着正文版本走 | 通常不用做；编辑后会再收到一次 `onTurnSettled` |
| 分叉 | 自动带到新游戏 | 整局数据会复制；插件自己在外面存的东西按 `fromGameId` 复制 |
| 删局 | 自动删除 | 在 `onGameRemoved` 里清理插件自己在外面存的东西、释放子 Agent |

插件自己的设置、缓存、跨分支统计放进整局数据（`saveGameData`），跟剧情走的东西放进按轮数据（`saveTurnData`）。

## 在侧栏放一个面板

记忆、状态、事务表这类内容可以给玩家看，用 `registerPanel` 在右侧栏加一页。

```js
ctx.tavernUi.registerPanel({ id: 'memory', title: '记忆', render: ({ gameId }) => h(MemoryPanel, { gameId }) })
```

面板要读宿主侧的数据时，由插件自己的宿主代码提供读取入口。玩家可以在「本局设置 → 插件」里按局关掉插件；关掉后插件不再收到这局的通知，它已经保存的数据保留。

## 缺接口时

上面的组合做不到时，请提[插件接口需求](https://github.com/flizzywine/dsh-tavern/issues/new?template=plugin-api.yml)，写清要做的插件和卡在哪一步。不要改 Tavern 源码或读 Tavern 的数据文件，Tavern 一更新插件就会失效。
