import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'
import { createStoryEvents } from '../tavern-plugin/lib/domain/story-events.js'
import { apply as applyPlotCompass } from '../tavern-plugin/packages/dsh-tavern-plot-compass/lib/index.js'
import { buildPlotCompassClient } from '../tavern-plugin/packages/dsh-tavern-plot-compass/build.mjs'

function createPluginFiber(pluginName, parentService) {
  const cleanups = []
  const ctx = {
    fiber: { name: pluginName },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
      return dispose
    }
  }
  const boundService = Object.create(parentService, {
    ctx: { value: ctx, enumerable: false }
  })
  return {
    ctx: { tavern: boundService, effect: ctx.effect.bind(ctx) },
    dispose() {
      for (const fn of cleanups.splice(0)) fn()
    }
  }
}

test('内置剧情罗盘插件包 client.js 与源码保持同步', async () => {
  const packageRoot = new URL('../tavern-plugin/packages/dsh-tavern-plot-compass/', import.meta.url)
  const res = await buildPlotCompassClient({ check: true, packageRoot })
  assert.equal(res.changed, false)
})

test('剧情罗盘已加载时，本局开关控制状态区和输入框入口', async () => {
  const client = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-plot-compass/client.js', import.meta.url), 'utf8')
  let enabled = false
  let mod
  const react = {
    useState: initial => [{ ...initial, enabled }, () => {}],
    useEffect() {},
    createElement: (type, props, ...children) => ({ type, props, children }),
  }
  vm.runInNewContext(client, { window: { __ModuleLoader__: {
    load({ factory }) { mod = factory(() => react) },
  } } })
  let panel, status, composer
  mod.apply({ tavernUi: {
    registerPanel: entry => { panel = entry },
    registerComposerTool: entry => { composer = entry },
    registerStatusSection: entry => { status = entry },
  } })
  assert.equal(panel.title, '剧情罗盘')
  const renderStatus = () => status.render({ gameId: 'g1' })
  const renderComposer = () => {
    const tool = composer.render({ sessionId: 'g1' })
    return tool.type(tool.props)
  }
  assert.equal(renderStatus(), null)
  assert.equal(renderComposer(), null)
  enabled = true
  assert.ok(renderStatus())
  assert.ok(renderComposer())
  enabled = false
  assert.equal(renderStatus(), null)
  assert.equal(renderComposer(), null)
})

test('dsh-tavern-plot-compass 通过真实 createTavernPluginApi 接入：段落注入、世界书扫描、归卷事件、模型解析与 RPC 全链路', async () => {
  const storyEvents = createStoryEvents()
  const gameDataMap = new Map()
  const pluginDataMap = new Map()
  const publishedStates = []
  const runTaskCalls = []

  let currentTurn = 3
  const pluginApi = createTavernPluginApi({
    ctx: {},
    loaderOrigin: () => 'host',
    storyEvents,
    workflow: { register() { return () => {} } },
    resolveGame: async gameId => gameId === 'g1' ? { chatId: 'c1', sessionId: 'g1', cardPath: 'cards/a.json' } : null,
    readLatestSettledTurn: async () => ({ chatId: 'c1', sessionId: 'g1', turn: currentTurn, key: `${currentTurn}:0`, text: '雨夜破庙的火光摇曳。' }),
    readPendingTurn: async () => ({ chatId: 'c1', sessionId: 'g1', turn: currentTurn, key: `${currentTurn}:0`, text: '雨夜破庙的火光摇曳。' }),
    currentKey: async () => `${currentTurn}:0`,
    readTurn: async () => ({ chatId: 'c1', sessionId: 'g1', key: `${currentTurn}:0`, turn: currentTurn, rawText: '雨夜破庙的火光摇曳。', text: '雨夜破庙的火光摇曳。', variables: { trust: 5 } }),
    readHistory: async () => [{ turn: currentTurn, input: '我生起篝火', rawText: '雨夜破庙的火光摇曳。', text: '雨夜破庙的火光摇曳。' }],
    readCard: async () => ({ name: '苏晚', description: '夜行侠客' }),
    readPlayerName: async () => '沈舟',
    backgroundModel: async () => ({ provider: 'bg-prov', model: 'bg-model' }),
    foregroundModel: async () => ({ provider: 'fg-prov', model: 'fg-model', reasoningEffort: 'high' }),
    readPlayMaterial: async () => ({
      posture: '靠坐在神龛旁擦剑',
      guides: ['保持江湖克制感'],
      ledger: { location: '城郊破庙', npcs: [{ name: '苏晚', relation: '同行', condition: '轻伤' }], items: [{ name: '残图', desc: '羊皮卷' }] },
      constantWorldbookText: '[江湖铁律]\n不得背弃同门',
      worldbookEntries: [
        { title: '北岭密道', keys: ['密道'], constant: false, content: '破庙神龛后方暗藏通往北岭的密道入口' }
      ],
      activatedWorldbookTitles: [],
      scriptWindow: null
    }),
    data: {
      readGame: async ({ chatId, owner }) => gameDataMap.get(`${chatId}:${owner}`) || null,
      saveGame: async ({ chatId, owner, data }) => { gameDataMap.set(`${chatId}:${owner}`, structuredClone(data)) },
      readSettings: async () => ({ disabled: [], replacements: {}, values: {} }),
      writeSettings: async () => {}
    },
    pluginData: {
      read: async owner => pluginDataMap.get(owner) ?? null,
      save: async (owner, data) => { pluginDataMap.set(owner, structuredClone(data)) }
    },
    media: {
      issue: async () => {},
      list: async () => []
    },
    publishState: (gameId, plugin, name) => publishedStates.push({ gameId, plugin, name }),
    runTask: async input => {
      runTaskCalls.push(input)
      await input.call('plot_compass_submit', {
        targetScope: 'all',
        playArchetypes: ['奇幻冒险'],
        situationDigest: '雨夜暂歇破庙，神龛后似有异响。',
        shortTerm: [
          { id: 'st-1', tag: '探神龛', title: '挪开神龛查探密道', summary: '顺风声挪动神龛，发现北岭密道。', beats: ['试探神龛底座', '点燃火折入道'] },
          { id: 'st-2', tag: '守庙门', title: '熄火伏击追兵', summary: '借夜雨掩护在庙门设伏。', beats: ['泼灭篝火', '隐入梁上'] }
        ],
        midTerm: [
          { id: 'mt-1', tag: '北岭寻踪', title: '穿密道潜入北岭旧寨', summary: '顺密道绕过封锁直抵旧寨。', milestones: ['走出密道', '潜入旧寨'] },
          { id: 'mt-2', tag: '反客为主', title: '夺取追兵密令反查幕后', summary: '擒下领头追兵逼问买凶之人。', milestones: ['生擒头目', '搜出令牌'] }
        ],
        longTerm: [
          { id: 'lt-1', tag: '重振旧宗', title: '集齐残图重开山门', vision: '查明当年灭门真相，重振山门。', toneGuidance: '风雪夜行中始终有故人剑意回响。' },
          { id: 'lt-2', tag: '笑傲江湖', title: '焚图隐退远走天涯', vision: '不再卷入宗门恩怨，结伴浪迹天涯。', toneGuidance: '江湖风雨之外总有一处灯火可亲的归宿。' }
        ]
      })
      return { text: '', traceSessionId: 'trace-pc-1' }
    }
  })

  const mounted = createPluginFiber('dsh-tavern-plot-compass', pluginApi.service)
  applyPlotCompass(mounted.ctx)

  // 开启罗盘并切换为跟随前台模型
  await pluginApi.callHandler('plot-compass:set-enabled', { gameId: 'g1', enabled: true })
  await pluginApi.callHandler('plot-compass:set-model', { gameId: 'g1', model: 'foreground' })

  const genRes = await pluginApi.callHandler('plot-compass:generate', { gameId: 'g1', scope: 'all', wait: true })
  assert.equal(genRes.status, 'done')
  assert.equal(genRes.plotCompass.shortTerm.length, 2)
  assert.equal(genRes.plotCompassTask.traceSessionId, 'trace-pc-1')
  assert.equal(runTaskCalls.length, 1)
  assert.deepEqual(runTaskCalls[0].selection, { provider: 'fg-prov', model: 'fg-model', reasoningEffort: 'high' })
  assert.equal(typeof runTaskCalls[0].acceptWithoutText, 'function')
  assert.equal(runTaskCalls[0].acceptWithoutText(), true)
  assert.match(runTaskCalls[0].prompt, /北岭密道/)

  // 点亮近期与远期路线
  await pluginApi.callHandler('plot-compass:pin', { gameId: 'g1', horizon: 'shortTerm', routeId: 'st-1' })
  await pluginApi.callHandler('plot-compass:pin', { gameId: 'g1', horizon: 'longTerm', routeId: 'lt-1' })

  // 验证默认强牵引（guided）走 position: 'last'，以及 settlementSection / candidateSection / compactionSection / worldbookScanText
  const turnCtx = await pluginApi.turnContext({ gameId: 'g1', turn: 3, target: 'story' })
  assert.equal(turnCtx.length, 1)
  assert.equal(turnCtx[0].position, 'last')
  assert.match(turnCtx[0].text, /强牵引导演指令/)
  assert.match(turnCtx[0].text, /挪开神龛查探密道/)
  assert.match(turnCtx[0].text, /routeTag="探神龛"/)
  assert.match(turnCtx[0].text, /风雪夜行中始终有故人剑意回响/)

  const settleSections = await pluginApi.settlement.sections({ gameId: 'g1', turn: 3 })
  assert.equal(settleSections.length, 1)
  assert.match(settleSections[0].text, /挪开神龛查探密道/)

  // 切换为软铺垫（soft）时自动回落到常规 after 槽位；切换为硬性兑现（strict）时恢复 position: 'last'
  await pluginApi.callHandler('plot-compass:set-preferences', { gameId: 'g1', strength: 'soft' })
  const softTurnCtx = await pluginApi.turnContext({ gameId: 'g1', turn: 3, target: 'story' })
  assert.equal(softTurnCtx.length, 1)
  assert.equal(softTurnCtx[0].position ?? 'after', 'after')
  assert.match(softTurnCtx[0].text, /软铺垫模式/)

  await pluginApi.callHandler('plot-compass:set-preferences', { gameId: 'g1', strength: 'strict' })
  const strictTurnCtx = await pluginApi.turnContext({ gameId: 'g1', turn: 3, target: 'story' })
  assert.equal(strictTurnCtx.length, 1)
  assert.equal(strictTurnCtx[0].position, 'last')
  assert.match(strictTurnCtx[0].text, /硬性兑现裁定/)
  assert.match(strictTurnCtx[0].text, /本轮必达目标/)

  const candSections = await pluginApi.candidate.sections({ gameId: 'g1', turn: 3 })
  assert.equal(candSections.length, 1)
  assert.match(candSections[0].text, /探神龛/)
  assert.match(candSections[0].text, /top 2 featured\/actor choices directly trigger/)

  const compNotes = await pluginApi.compactionNotes({ gameId: 'g1' })
  assert.equal(compNotes.length, 1)
  assert.match(compNotes[0].text, /集齐残图重开山门/)

  const scanTexts = await pluginApi.worldbookScanTexts({ gameId: 'g1' })
  assert.equal(scanTexts.length, 1)
  assert.match(scanTexts[0], /挪开神龛查探密道/)

  // 推进轮次并触发上下文归卷事件 context-compacted 自动增量更新
  currentTurn = 5
  storyEvents.emit('context-compacted', { sessionId: 'g1' })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(runTaskCalls.length, 2)

  mounted.dispose()
})

test('剧情罗盘节拍进度链、sceneTrigger、久拖自动加压、未点亮微调指令与仅中期锚定均正确生成', async () => {
  const {
    applyPlotCompassAutoProgress,
    applyPlotCompassPreferences,
    applyPlotCompassStepToggle,
    plotCompassBodyText,
    plotCompassSettlementNote,
    plotCompassWorldbookScanText,
    readPlotCompass
  } = await import('../tavern-plugin/packages/dsh-tavern-plot-compass/lib/plot-compass.js')

  // 1. 未点亮任何路线，但填写了 customDirective 时不再被短路吞掉
  const directiveOnly = applyPlotCompassPreferences({ version: 1 }, { customDirective: '多写雨夜冷寂与拔剑前的心理暗战' })
  const directiveBody = plotCompassBodyText(directiveOnly)
  assert.match(directiveBody, /多写雨夜冷寂与拔剑前的心理暗战/)
  assert.match(plotCompassWorldbookScanText(directiveOnly), /多写雨夜冷寂与拔剑前的心理暗战/)
  assert.match(plotCompassSettlementNote(directiveOnly), /多写雨夜冷寂与拔剑前的心理暗战/)

  // 2. 仅点亮中期路线（未点亮今期）时，自动将 entryHook 提升为本轮推进目标
  const midOnly = readPlotCompass({
    version: 1,
    strength: 'guided',
    midTerm: [{
      id: 'm1',
      tag: '潜入旧寨',
      title: '夜探北岭旧寨',
      summary: '查明旧寨异动根源',
      entryHook: '向苏晚追问残图背面的北岭暗记',
      milestones: [{ text: '辨认暗记', done: false }, { text: '潜入寨门', done: false }]
    }],
    pinned: { shortTerm: null, midTerm: 'm1', longTerm: null }
  })
  assert.match(plotCompassBodyText(midOnly), /【▶ 本轮推进目标〔入线铺垫〕：向苏晚追问残图背面的北岭暗记】/)

  // 3. 今期完整节拍链、sceneTrigger 与连续停滞自动加压（stalledTurns >= 2）
  let compass = readPlotCompass({
    version: 1,
    basedOnTurn: 2,
    lastCheckedTurn: 2,
    strength: 'guided',
    shortTerm: [{
      id: 's1',
      tag: '探神龛',
      title: '挪开神龛查探密道',
      summary: '发现密道入口',
      causalBasis: '神龛底座有新鲜刮痕',
      sceneTrigger: '神龛后忽然漏出一缕夹杂湿土味的冷风吹偏烛火',
      beats: [
        { text: '试探神龛底座', done: true },
        { text: '点燃火折入道', done: false },
        { text: '查看石壁刻字', done: false }
      ]
    }],
    pinned: { shortTerm: 's1', midTerm: null, longTerm: null }
  })

  const initialBody = plotCompassBodyText(compass)
  assert.match(initialBody, /\[✓ 1\.试探神龛底座\] → 【▶ 2\.点燃火折入道（本轮推进目标）】 → \[○ 3\.查看石壁刻字（后续留白）\]/)
  assert.match(initialBody, /备选破冰参考.*冷风吹偏烛火/)
  assert.match(initialBody, /目标锁定与手段开放/)
  assert.doesNotMatch(initialBody, /久拖破局加压/)

  // 第 3、4 轮连续无新节拍完成 -> stalledTurns 升至 2，触发久拖破局加压
  compass = applyPlotCompassAutoProgress(compass, { completed: [], lapsed: [] }, { turn: 3 }).compass
  assert.equal(compass.stalledTurns, 1)
  compass = applyPlotCompassAutoProgress(compass, { completed: [], lapsed: [] }, { turn: 4 }).compass
  assert.equal(compass.stalledTurns, 2)
  assert.match(plotCompassBodyText(compass), /⚠ 久拖破局加压：节拍「点燃火折入道」已连续 2 轮未达成/)

  // 软铺垫模式下不输出久拖强推压迫语
  const softStalled = applyPlotCompassPreferences(compass, { strength: 'soft' })
  assert.doesNotMatch(plotCompassBodyText(softStalled), /久拖破局加压/)

  // 手动或自动完成第 2 拍后，stalledTurns 清零
  compass = applyPlotCompassStepToggle(compass, { horizon: 'shortTerm', routeId: 's1', stepIndex: 1 })
  assert.equal(compass.stalledTurns, 0)
  assert.doesNotMatch(plotCompassBodyText(compass), /久拖破局加压/)
})

test('推演模型设置全局一致：跨对话共享、不写入单局存档、广播同步与旧存档平滑迁移', async () => {
  const storyEvents = createStoryEvents()
  const gameDataMap = new Map()
  const pluginDataMap = new Map()
  const publishedStates = []
  const runTaskCalls = []

  const games = {
    g1: { chatId: 'c1', sessionId: 'g1', fg: { provider: 'fg-1', model: 'fg-model-1' }, bg: { provider: 'bg-1', model: 'bg-model-1' } },
    g2: { chatId: 'c2', sessionId: 'g2', fg: { provider: 'fg-2', model: 'fg-model-2' }, bg: { provider: 'bg-2', model: 'bg-model-2' } },
    gLegacyDefault: { chatId: 'c-def', sessionId: 'gLegacyDefault', fg: { provider: 'fg-d', model: 'm' }, bg: { provider: 'bg-d', model: 'm' } },
    gLegacyCustom: { chatId: 'c-cus', sessionId: 'gLegacyCustom', fg: { provider: 'fg-c', model: 'm' }, bg: { provider: 'bg-c', model: 'm' } },
    gLegacyStale: { chatId: 'c-stale', sessionId: 'gLegacyStale', fg: { provider: 'fg-s', model: 'm' }, bg: { provider: 'bg-s', model: 'm' } }
  }

  // 预置旧版按对话保存的残留数据
  gameDataMap.set('c-def:dsh-tavern-plot-compass', {
    version: 1,
    enabled: true,
    modelSelection: 'background',
    compass: { version: 1 }
  })
  gameDataMap.set('c-cus:dsh-tavern-plot-compass', {
    version: 1,
    enabled: true,
    modelSelection: { provider: 'migrated-prov', model: 'migrated-model', reasoningEffort: 'high' },
    compass: { version: 1 }
  })
  gameDataMap.set('c-stale:dsh-tavern-plot-compass', {
    version: 1,
    enabled: true,
    modelSelection: { provider: 'stale-prov', model: 'stale-model' },
    compass: { version: 1 }
  })

  const pluginApi = createTavernPluginApi({
    ctx: {},
    loaderOrigin: () => 'host',
    storyEvents,
    workflow: { register() { return () => {} } },
    resolveGame: async gameId => games[gameId] || null,
    readLatestSettledTurn: async sessionId => ({ chatId: games[sessionId]?.chatId, sessionId, turn: 2, key: '2:0', text: '夜色沉沉。' }),
    readPendingTurn: async sessionId => ({ chatId: games[sessionId]?.chatId, sessionId, turn: 2, key: '2:0', text: '夜色沉沉。' }),
    currentKey: async () => '2:0',
    readTurn: async sessionId => ({ chatId: games[sessionId]?.chatId, sessionId, key: '2:0', turn: 2, rawText: '夜色沉沉。', text: '夜色沉沉。' }),
    readHistory: async () => [{ turn: 2, input: '环顾四周', rawText: '夜色沉沉。', text: '夜色沉沉。' }],
    readCard: async () => ({ name: '林月', description: '旅人' }),
    readPlayerName: async () => '你',
    backgroundModel: async sessionId => games[sessionId]?.bg || null,
    foregroundModel: async sessionId => games[sessionId]?.fg || null,
    data: {
      readGame: async ({ chatId, owner }) => gameDataMap.get(`${chatId}:${owner}`) || null,
      saveGame: async ({ chatId, owner, data }) => { gameDataMap.set(`${chatId}:${owner}`, structuredClone(data)) },
      readSettings: async () => ({ disabled: [], replacements: {}, values: {} }),
      writeSettings: async () => {}
    },
    pluginData: {
      read: async owner => pluginDataMap.get(owner) ?? null,
      save: async (owner, data) => { pluginDataMap.set(owner, structuredClone(data)) }
    },
    media: { issue: async () => {}, list: async () => [] },
    publishState: (gameId, plugin, name) => publishedStates.push({ gameId, plugin, name }),
    runTask: async input => {
      runTaskCalls.push(input)
      await input.call('plot_compass_submit', {
        targetScope: 'all',
        playArchetypes: ['悬疑调查'],
        situationDigest: '夜色潜行。',
        shortTerm: [
          { id: 'st-1', tag: '查探', title: '查探窗影', summary: '靠近窗边查看动静。', beats: ['屏息靠近'] },
          { id: 'st-2', tag: '退避', title: '退入暗巷', summary: '先隐入暗巷观察。', beats: ['借阴影掩护'] }
        ],
        midTerm: [
          { id: 'mt-1', tag: '追查', title: '顺藤摸瓜', summary: '查清夜行者来历。', milestones: ['锁定踪迹'] },
          { id: 'mt-2', tag: '设局', title: '引蛇出洞', summary: '放出假消息设伏。', milestones: ['散布风声'] }
        ],
        longTerm: [
          { id: 'lt-1', tag: '破局', title: '揭开真相', vision: '水落石出。' },
          { id: 'lt-2', tag: '远遁', title: '全身而退', vision: '离开是非之地。' }
        ]
      })
      return { text: '', traceSessionId: 'trace-global-model' }
    }
  })

  const mounted = createPluginFiber('dsh-tavern-plot-compass', pluginApi.service)
  applyPlotCompass(mounted.ctx)

  // 1. 先打开仅带默认 background 的旧存档，不应锁死迁移；再打开带自定义独立模型的旧存档，应自动提升为全局模型
  const defBefore = await pluginApi.callHandler('plot-compass:state', { gameId: 'gLegacyDefault' })
  assert.equal(defBefore.modelSelection, 'background')
  assert.equal(pluginDataMap.has('dsh-tavern-plot-compass'), false)

  const cusState = await pluginApi.callHandler('plot-compass:state', { gameId: 'gLegacyCustom' })
  assert.deepEqual(cusState.modelSelection, { provider: 'migrated-prov', model: 'migrated-model', reasoningEffort: 'high' })
  assert.deepEqual(pluginDataMap.get('dsh-tavern-plot-compass')?.modelSelection, {
    provider: 'migrated-prov',
    model: 'migrated-model',
    reasoningEffort: 'high'
  })

  // 已打开过的 gLegacyDefault 以及全新对话 g1 均立即共享迁移后的全局独立模型
  const defAfter = await pluginApi.callHandler('plot-compass:state', { gameId: 'gLegacyDefault' })
  assert.deepEqual(defAfter.modelSelection, { provider: 'migrated-prov', model: 'migrated-model', reasoningEffort: 'high' })
  const g1Initial = await pluginApi.callHandler('plot-compass:state', { gameId: 'g1' })
  assert.deepEqual(g1Initial.modelSelection, { provider: 'migrated-prov', model: 'migrated-model', reasoningEffort: 'high' })

  // 2. 在 g1 修改推演模型为新的独立模型，应只写全局 pluginData，不写单局 gameData，且 g2 同步生效
  const setRes = await pluginApi.callHandler('plot-compass:set-model', {
    gameId: 'g1',
    model: { provider: 'ind-prov', model: 'ind-model', reasoningEffort: 'low' }
  })
  assert.deepEqual(setRes.modelSelection, { provider: 'ind-prov', model: 'ind-model', reasoningEffort: 'low' })
  assert.equal(gameDataMap.has('c1:dsh-tavern-plot-compass'), false, '修改全局模型不应产生单局存档')

  // 开启 g1 与 g2：验证单局保存的记录里不再携带 modelSelection 字段
  await pluginApi.callHandler('plot-compass:set-enabled', { gameId: 'g1', enabled: true })
  await pluginApi.callHandler('plot-compass:set-enabled', { gameId: 'g2', enabled: true })
  assert.equal('modelSelection' in gameDataMap.get('c1:dsh-tavern-plot-compass'), false)
  assert.equal('modelSelection' in gameDataMap.get('c2:dsh-tavern-plot-compass'), false)

  const g2State = await pluginApi.callHandler('plot-compass:state', { gameId: 'g2' })
  assert.deepEqual(g2State.modelSelection, { provider: 'ind-prov', model: 'ind-model', reasoningEffort: 'low' })

  await pluginApi.callHandler('plot-compass:generate', { gameId: 'g2', scope: 'all', wait: true })
  assert.equal(runTaskCalls.length, 1)
  assert.deepEqual(runTaskCalls[0].selection, { provider: 'ind-prov', model: 'ind-model', reasoningEffort: 'low' })

  // 3. 在 g2 切换为 foreground，g1 会收到状态广播，并在推演时自动使用 g1 自己的前台模型
  publishedStates.length = 0
  await pluginApi.callHandler('plot-compass:set-model', { gameId: 'g2', model: 'foreground' })
  await new Promise(resolve => setTimeout(resolve, 20))
  const broadcastedGames = new Set(publishedStates.filter(s => s.name === 'compass').map(s => s.gameId))
  assert.ok(broadcastedGames.has('g1') && broadcastedGames.has('g2'), '所有已打开会话都应收到最新模型状态广播')

  const g1AfterFg = await pluginApi.callHandler('plot-compass:state', { gameId: 'g1' })
  assert.equal(g1AfterFg.modelSelection, 'foreground')
  await pluginApi.callHandler('plot-compass:generate', { gameId: 'g1', scope: 'all', wait: true })
  assert.equal(runTaskCalls.length, 2)
  assert.deepEqual(runTaskCalls[1].selection, { provider: 'fg-1', model: 'fg-model-1' })

  // 4. 切换回全局 background 后，打开带有陈旧独立模型的旧存档 gLegacyStale，绝不能被旧存档覆盖
  await pluginApi.callHandler('plot-compass:set-model', { gameId: 'g1', model: 'background' })
  const staleState = await pluginApi.callHandler('plot-compass:state', { gameId: 'gLegacyStale' })
  assert.equal(staleState.modelSelection, 'background')
  await pluginApi.callHandler('plot-compass:generate', { gameId: 'gLegacyStale', scope: 'all', wait: true })
  assert.equal(runTaskCalls.length, 3)
  assert.deepEqual(runTaskCalls[2].selection, { provider: 'bg-s', model: 'm' })

  mounted.dispose()
})

test('剧情罗盘目标导向：短期/中期/长期三跨度剧情树收敛规则、启停清除、脑暴与全段落注入', async () => {
  const {
    activePlotCompassGoal,
    applyPlotCompassGoal,
    buildPlotCompassBrainstormPrompt,
    buildPlotCompassMaterial,
    emptyPlotCompass,
    plotCompassBodyText,
    plotCompassCandidateText,
    plotCompassCompactionNote,
    plotCompassSettlementNote,
    plotCompassWorldbookScanText,
    readPlotCompass
  } = await import('../tavern-plugin/packages/dsh-tavern-plot-compass/lib/plot-compass.js')

  const initial = emptyPlotCompass()
  assert.deepEqual(initial.goal, { enabled: false, horizon: 'shortTerm', text: '' })
  assert.equal(activePlotCompassGoal(initial), null)
  assert.throws(() => applyPlotCompassGoal(initial, { enabled: true }), /请先输入目标内容/)
  assert.throws(() => applyPlotCompassGoal(initial, { text: '达成目标', horizon: 'invalid' }), /无效的目标跨度选项/)

  // 1. 短期目标（shortTerm）：近期所有分支终点直达该结果，中长期以此为因果起点顺延
  const shortGoalCompass = applyPlotCompassGoal(initial, {
    horizon: 'shortTerm',
    text: '在破庙雨夜内说服苏晚交出北岭残图并暂时结盟'
  })
  assert.deepEqual(shortGoalCompass.goal, {
    enabled: true,
    horizon: 'shortTerm',
    text: '在破庙雨夜内说服苏晚交出北岭残图并暂时结盟'
  })
  const shortMaterial = buildPlotCompassMaterial({
    card: { name: '苏晚' },
    messages: [{ role: 'assistant', turn: 2, text: '雨夜破庙的火光摇曳。' }],
    compass: shortGoalCompass,
    scope: 'all'
  })
  assert.match(shortMaterial, /<player_goal>[\s\S]*Target Horizon \(短期\): shortTerm[\s\S]*说服苏晚交出北岭残图并暂时结盟[\s\S]*Target Horizon — Direct Fulfillment[\s\S]*<\/player_goal>/)
  assert.match(shortMaterial, /MANDATORY GOAL ORIENTATION \[短期 · shortTerm\]/)

  // 未手动点亮单张卡片时，目标导向本身即可激活正文导演指令、候选引导、世界书扫描、结算与归卷保鲜
  const shortBody = plotCompassBodyText(shortGoalCompass)
  assert.match(shortBody, /🎯 玩家锁定目标导向〔短期 · 2–5轮内达成〕：在破庙雨夜内说服苏晚交出北岭残图并暂时结盟/)
  assert.match(shortBody, /本轮推进目标/)
  assert.match(plotCompassCandidateText(shortGoalCompass), /\[PLAYER GOAL ORIENTATION · shortTerm\].*说服苏晚交出北岭残图并暂时结盟/)
  assert.equal(plotCompassWorldbookScanText(shortGoalCompass), '在破庙雨夜内说服苏晚交出北岭残图并暂时结盟')
  assert.match(plotCompassSettlementNote(shortGoalCompass), /目标导向〔短期〕：「在破庙雨夜内说服苏晚交出北岭残图并暂时结盟」/)
  assert.match(plotCompassCompactionNote(shortGoalCompass), /目标导向〔短期〕：在破庙雨夜内说服苏晚交出北岭残图并暂时结盟/)

  // 2. 中期目标（midTerm）：短期路线铺垫阶梯，中期路线收束兑现，长期作为已达成前置顺延
  const midGoalCompass = applyPlotCompassGoal(shortGoalCompass, {
    horizon: 'midTerm',
    text: '在江南武林大会揭穿盟主伪善面目并全身而退'
  })
  const midMaterial = buildPlotCompassMaterial({
    card: { name: '苏晚' },
    messages: [{ role: 'assistant', turn: 2, text: '雨夜破庙的火光摇曳。' }],
    compass: midGoalCompass,
    scriptWindow: { cursor: 0, total: 3, chunks: [{ id: 'c1', text: '原著中主角隐忍退让。' }] },
    scope: 'all'
  })
  assert.match(midMaterial, /Target Horizon \(中期\): midTerm/)
  assert.match(midMaterial, /Immediate Stepping Stones/)
  assert.match(midMaterial, /Target Horizon — Chapter Culmination/)
  assert.match(midMaterial, /Player Goal-Oriented Mode is active: align ALL routes toward `<player_goal>`/)

  // 3. 长期目标（longTerm）：全新生成（fresh: true）与脑暴对话均持续保留并导向该终局结果
  const longGoalCompass = applyPlotCompassGoal(midGoalCompass, {
    horizon: 'longTerm',
    text: '查明当年灭门真相，携手重开北岭山门'
  })
  const withOldRoutes = readPlotCompass({
    ...longGoalCompass,
    shortTerm: [{ id: 's1', tag: '旧径', title: '旧短期路线', summary: '旧摘要', beats: ['旧节拍'] }],
    midTerm: [{ id: 'm1', tag: '旧章', title: '旧中期路线', summary: '旧摘要', milestones: ['旧节点'] }],
    longTerm: [{ id: 'l1', tag: '隐退', title: '焚图隐退', vision: '放弃山门隐居' }]
  })
  const freshMaterial = buildPlotCompassMaterial({
    card: { name: '苏晚' },
    compass: withOldRoutes,
    scope: 'all',
    fresh: true
  })
  assert.doesNotMatch(freshMaterial, /<existing_plot_compass>/)
  assert.match(freshMaterial, /<player_goal>[\s\S]*Target Horizon \(长期\): longTerm[\s\S]*Target Horizon — Endgame Fulfillment[\s\S]*携手重开北岭山门/)
  assert.match(freshMaterial, /FRESH REBUILD explicitly requested by the player while `<player_goal>` is active/)

  const brainstormPrompt = buildPlotCompassBrainstormPrompt({
    card: { name: '苏晚' },
    compass: withOldRoutes,
    message: '帮我想几个切入点'
  })
  assert.match(brainstormPrompt, /<player_goal>[\s\S]*携手重开北岭山门/)

  // 4. 暂停与清除目标导向
  const paused = applyPlotCompassGoal(longGoalCompass, { enabled: false })
  assert.equal(paused.goal.enabled, false)
  assert.equal(paused.goal.text, '查明当年灭门真相，携手重开北岭山门')
  assert.equal(activePlotCompassGoal(paused), null)
  assert.equal(plotCompassBodyText(paused), '')
  assert.doesNotMatch(buildPlotCompassMaterial({ card: { name: '苏晚' }, compass: paused }), /<player_goal>/)

  const resumed = applyPlotCompassGoal(paused, { enabled: true })
  assert.equal(activePlotCompassGoal(resumed)?.horizon, 'longTerm')

  const cleared = applyPlotCompassGoal(resumed, { text: '' })
  assert.deepEqual(cleared.goal, { enabled: false, horizon: 'longTerm', text: '' })
})

test('剧情罗盘目标导向 RPC 全链路：设置目标、重推剧情树、全新生成保留目标、归卷演进与客户端面板契约', async () => {
  const clientCode = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-plot-compass/client.js', import.meta.url), 'utf8')
  assert.match(clientCode, /plot-compass:set-goal/)
  assert.match(clientCode, /PC_GOAL_HORIZON_OPTIONS/)
  assert.match(clientCode, /保存并推演剧情树/)

  const storyEvents = createStoryEvents()
  const gameDataMap = new Map()
  const runTaskCalls = []
  let currentTurn = 4

  const pluginApi = createTavernPluginApi({
    ctx: {},
    loaderOrigin: () => 'host',
    storyEvents,
    workflow: { register() { return () => {} } },
    resolveGame: async gameId => gameId === 'gGoal' ? { chatId: 'cGoal', sessionId: 'gGoal' } : null,
    readLatestSettledTurn: async () => ({ chatId: 'cGoal', sessionId: 'gGoal', turn: currentTurn, key: `${currentTurn}:0`, text: '议事堂内暗流涌动。' }),
    readPendingTurn: async () => ({ chatId: 'cGoal', sessionId: 'gGoal', turn: currentTurn, key: `${currentTurn}:0`, text: '议事堂内暗流涌动。' }),
    currentKey: async () => `${currentTurn}:0`,
    readTurn: async () => ({ chatId: 'cGoal', sessionId: 'gGoal', key: `${currentTurn}:0`, turn: currentTurn, rawText: '议事堂内暗流涌动。', text: '议事堂内暗流涌动。' }),
    readHistory: async () => [{ turn: currentTurn, input: '我环视众长老', rawText: '议事堂内暗流涌动。', text: '议事堂内暗流涌动。' }],
    readCard: async () => ({ name: '沈清秋', description: '宗门执剑长老' }),
    readPlayerName: async () => '陆行舟',
    backgroundModel: async () => ({ provider: 'bg-prov', model: 'bg-model' }),
    readPlayMaterial: async () => ({ posture: '立于议事堂阶前', guides: [], ledger: { location: '议事堂' }, worldbookEntries: [] }),
    data: {
      readGame: async ({ chatId, owner }) => gameDataMap.get(`${chatId}:${owner}`) || null,
      saveGame: async ({ chatId, owner, data }) => { gameDataMap.set(`${chatId}:${owner}`, structuredClone(data)) },
      readSettings: async () => ({ disabled: [], replacements: {}, values: {} }),
      writeSettings: async () => {}
    },
    pluginData: { read: async () => null, save: async () => {} },
    media: { issue: async () => {}, list: async () => [] },
    publishState: () => {},
    runTask: async input => {
      runTaskCalls.push(input)
      await input.call('plot_compass_submit', {
        targetScope: 'all',
        playArchetypes: ['权谋博弈'],
        situationDigest: '众长老各怀心思，掌门印信悬而未决。',
        shortTerm: [
          { id: 'st-g1', tag: '亮出旧诏', title: '当堂呈验先师遗诏', summary: '借遗诏压服摇摆长老，打开夺印切口。', beats: ['出示遗诏残卷', '迫使大长老验印'] },
          { id: 'st-g2', tag: '分化旁支', title: '私下许诺刑堂席位拉拢二长老', summary: '先拆解反对同盟，为夺取印信铺路。', beats: ['休会密谈许利', '联名重开议事'] }
        ],
        midTerm: [
          { id: 'mt-g1', tag: '正名夺印', title: '宗门大比立威执掌掌门印信', summary: '在宗门大比与长老公议中正面夺回掌门印信。', milestones: ['查清叛徒账册', '大比挫败对手', '正式执掌掌门印信'] },
          { id: 'mt-g2', tag: '暗棋逼宫', title: '控制护山大阵迫使大长老交出印信', summary: '以阵枢与铁证双线合围，兵不血刃接掌掌门印信。', milestones: ['秘密接管阵枢', '公布勾结铁证', '大长老交出掌门印信'] }
        ],
        longTerm: [
          { id: 'lt-g1', tag: '执印革新', title: '执掌印信后重整宗门戒律', vision: '稳坐掌门之位，涤荡旧弊威震北境。' },
          { id: 'lt-g2', tag: '执印北伐', title: '凭掌门印信号令诸峰反攻北境', vision: '以新任掌门之姿统合宗门剑指宿敌。' }
        ]
      })
      return { text: '', traceSessionId: 'trace-goal' }
    }
  })

  const mounted = createPluginFiber('dsh-tavern-plot-compass', pluginApi.service)
  applyPlotCompass(mounted.ctx)

  await pluginApi.callHandler('plot-compass:set-enabled', { gameId: 'gGoal', enabled: true })

  // 设置中期目标导向
  const setGoalRes = await pluginApi.callHandler('plot-compass:set-goal', {
    gameId: 'gGoal',
    horizon: 'midTerm',
    text: '夺回宗门掌门印信并坐稳少掌门之位'
  })
  assert.deepEqual(setGoalRes.plotCompass.goal, {
    enabled: true,
    horizon: 'midTerm',
    text: '夺回宗门掌门印信并坐稳少掌门之位'
  })

  // 推演剧情树：系统提示词与请求素材都必须包含目标导向收敛规则
  const genRes = await pluginApi.callHandler('plot-compass:generate', { gameId: 'gGoal', scope: 'all', wait: true })
  assert.equal(genRes.status, 'done')
  assert.equal(runTaskCalls.length, 1)
  assert.match(runTaskCalls[0].system, /Goal-Oriented Convergence Mode/)
  assert.match(runTaskCalls[0].prompt, /<player_goal>[\s\S]*夺回宗门掌门印信并坐稳少掌门之位/)

  // 即使未点亮具体路线卡片，由于开启了目标导向，推进轮次后触发归卷（context-compacted）也会自动演进延续该目标
  currentTurn = 7
  storyEvents.emit('context-compacted', { sessionId: 'gGoal' })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(runTaskCalls.length, 2)
  assert.match(runTaskCalls[1].prompt, /导向达成玩家设定的中期目标结果「夺回宗门掌门印信并坐稳少掌门之位」/)

  // 全新生成（fresh: true）作废旧路线后，玩家设置的目标导向依然保留并约束新剧情树
  const freshRes = await pluginApi.callHandler('plot-compass:generate', { gameId: 'gGoal', scope: 'all', fresh: true, wait: true })
  assert.equal(freshRes.plotCompass.goal.enabled, true)
  assert.equal(freshRes.plotCompass.goal.text, '夺回宗门掌门印信并坐稳少掌门之位')
  assert.equal(runTaskCalls.length, 3)
  assert.doesNotMatch(runTaskCalls[2].prompt, /<existing_plot_compass>/)
  assert.match(runTaskCalls[2].prompt, /<player_goal>[\s\S]*夺回宗门掌门印信并坐稳少掌门之位/)

  mounted.dispose()
})

test('插件候选联动 runner 通过 liveTavernView.getSnapshot 读取最新消息 ID', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/features/play-controls.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /liveTavernView\.snapshot\(/, 'liveTavernView 没有 snapshot 方法，必须使用 getSnapshot')
  assert.match(
    source,
    /attachCandidateRunner\(async function \(sessionId, guidance\) \{[\s\S]*?liveTavernView\.getSnapshot\(sessionId\)/,
    'attachCandidateRunner 应调用 liveTavernView.getSnapshot(sessionId)'
  )
})

test('剧情罗盘剧情规划条目上限：默认 4、校验截断、动态工具 Schema、提示词与候选角标联动', async () => {
  const {
    PLOT_COMPASS_DEFAULT_MAX_ROUTES,
    applyPlotCompassPreferences,
    buildPlotCompassChatSubmitTool,
    buildPlotCompassMaterial,
    buildPlotCompassSubmitTool,
    emptyPlotCompass,
    parsePlotCompassSubmission,
    plotCompassCandidateText,
    readPlotCompass
  } = await import('../tavern-plugin/packages/dsh-tavern-plot-compass/lib/plot-compass.js')

  const makeShort = count => Array.from({ length: count }, (_, i) => ({
    id: `s${i + 1}`,
    tag: `今期${i + 1}`,
    title: `今期路线${i + 1}`,
    summary: `今期摘要${i + 1}`,
    beats: [{ text: `节拍${i + 1}`, done: false }]
  }))
  const makeMid = count => Array.from({ length: count }, (_, i) => ({
    id: `m${i + 1}`,
    tag: `中期${i + 1}`,
    title: `中期路线${i + 1}`,
    summary: `中期摘要${i + 1}`,
    milestones: [{ text: `里程碑${i + 1}`, done: false }]
  }))
  const makeLong = count => Array.from({ length: count }, (_, i) => ({
    id: `l${i + 1}`,
    tag: `长期${i + 1}`,
    title: `长期路线${i + 1}`,
    vision: `长期愿景${i + 1}`
  }))

  // 默认上限为 4
  const empty = emptyPlotCompass()
  assert.equal(PLOT_COMPASS_DEFAULT_MAX_ROUTES, 4)
  assert.equal(empty.maxRoutes, 4)
  assert.equal(readPlotCompass(null).maxRoutes, 4)

  // 参数校验：非法值拒绝
  assert.throws(() => applyPlotCompassPreferences(empty, { maxRoutes: 0 }), /1–10/)
  assert.throws(() => applyPlotCompassPreferences(empty, { maxRoutes: 11 }), /1–10/)
  assert.throws(() => applyPlotCompassPreferences(empty, { maxRoutes: 2.5 }), /1–10/)
  assert.throws(() => applyPlotCompassPreferences(empty, { maxRoutes: true }), /1–10/)

  // 动态工具 Schema
  const tool6 = buildPlotCompassSubmitTool(6)
  assert.equal(tool6.parameters.properties.shortTerm.minItems, 2)
  assert.equal(tool6.parameters.properties.shortTerm.maxItems, 6)
  assert.equal(tool6.parameters.properties.midTerm.maxItems, 6)
  assert.equal(tool6.parameters.properties.longTerm.maxItems, 6)

  const chatTool1 = buildPlotCompassChatSubmitTool(1)
  assert.equal(chatTool1.parameters.properties.shortTerm.minItems, 1)
  assert.equal(chatTool1.parameters.properties.shortTerm.maxItems, 1)

  // parsePlotCompassSubmission 按上限保留 / 允许 1 条
  const parsed6 = parsePlotCompassSubmission({
    playArchetypes: ['权谋博弈'],
    situationDigest: '测试局势',
    shortTerm: makeShort(7),
    midTerm: makeMid(6),
    longTerm: makeLong(6)
  }, { maxRoutes: 6 })
  assert.equal(parsed6.shortTerm.length, 6)
  assert.equal(parsed6.midTerm.length, 6)
  assert.equal(parsed6.longTerm.length, 6)

  const parsed1 = parsePlotCompassSubmission({
    playArchetypes: ['权谋博弈'],
    situationDigest: '单线测试',
    shortTerm: makeShort(1),
    midTerm: makeMid(1),
    longTerm: makeLong(1)
  }, { maxRoutes: 1 })
  assert.equal(parsed1.shortTerm.length, 1)

  // 调低上限会立即裁剪已有路线并清理失效点亮
  const expanded = readPlotCompass({
    version: 1,
    maxRoutes: 6,
    shortTerm: makeShort(6),
    midTerm: makeMid(6),
    longTerm: makeLong(6),
    pinned: { shortTerm: 's5', midTerm: 'm2', longTerm: 'l6' }
  })
  assert.equal(expanded.shortTerm.length, 6)
  assert.equal(expanded.pinned.shortTerm, 's5')

  // 候选角标在 maxRoutes=6 且未点亮时不被硬截断到 4 条
  const candText = plotCompassCandidateText({
    ...expanded,
    pinned: { shortTerm: null, midTerm: null, longTerm: null }
  })
  assert.match(candText, /今期5/)
  assert.match(candText, /今期6/)

  const shrunk = applyPlotCompassPreferences(expanded, { maxRoutes: 3 })
  assert.equal(shrunk.maxRoutes, 3)
  assert.equal(shrunk.shortTerm.length, 3)
  assert.equal(shrunk.midTerm.length, 3)
  assert.equal(shrunk.longTerm.length, 3)
  assert.equal(shrunk.pinned.shortTerm, null)
  assert.equal(shrunk.pinned.midTerm, 'm2')
  assert.equal(shrunk.pinned.longTerm, null)

  // 推演请求素材明确告知当前上限
  const material = buildPlotCompassMaterial({
    card: { name: '林疏' },
    messages: [],
    compass: shrunk,
    scope: 'all'
  })
  assert.match(material, /at most 3 routes per horizon/)
})

test('剧情罗盘条目上限 RPC 全链路与客户端面板契约', async () => {
  const clientCode = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-plot-compass/client.js', import.meta.url), 'utf8')
  assert.match(clientCode, /PC_MAX_ROUTES_PRESETS/)
  assert.match(clientCode, /剧情规划条目上限/)
  assert.match(clientCode, /maxRoutes/)

  const storyEvents = createStoryEvents()
  const gameDataMap = new Map()
  const runTaskCalls = []

  const pluginApi = createTavernPluginApi({
    ctx: {},
    loaderOrigin: () => 'host',
    storyEvents,
    workflow: { register() { return () => {} } },
    resolveGame: async gameId => gameId === 'gLimit' ? { chatId: 'cLimit', sessionId: 'gLimit' } : null,
    readLatestSettledTurn: async () => ({ chatId: 'cLimit', sessionId: 'gLimit', turn: 3, key: '3:0', text: '案卷上出现新线索。' }),
    readPendingTurn: async () => ({ chatId: 'cLimit', sessionId: 'gLimit', turn: 3, key: '3:0', text: '案卷上出现新线索。' }),
    currentKey: async () => '3:0',
    readTurn: async () => ({ chatId: 'cLimit', sessionId: 'gLimit', key: '3:0', turn: 3, rawText: '案卷上出现新线索。', text: '案卷上出现新线索。' }),
    readHistory: async () => [{ turn: 3, input: '查案', rawText: '案卷上出现新线索。', text: '案卷上出现新线索。' }],
    readCard: async () => ({ name: '沈砚', description: '大理寺少卿' }),
    readPlayerName: async () => '你',
    backgroundModel: async () => ({ provider: 'bg-prov', model: 'bg-model' }),
    readPlayMaterial: async () => ({ posture: '大理寺书房', guides: [], ledger: { location: '大理寺' }, worldbookEntries: [] }),
    data: {
      readGame: async ({ chatId, owner }) => gameDataMap.get(`${chatId}:${owner}`) || null,
      saveGame: async ({ chatId, owner, data }) => { gameDataMap.set(`${chatId}:${owner}`, structuredClone(data)) },
      readSettings: async () => ({ disabled: [], replacements: {}, values: {} }),
      writeSettings: async () => {}
    },
    pluginData: { read: async () => null, save: async () => {} },
    media: { issue: async () => {}, list: async () => [] },
    publishState: () => {},
    runTask: async input => {
      runTaskCalls.push(input)
      const makeRoutes = (prefix, count, field) => Array.from({ length: count }, (_, i) => ({
        id: `${prefix}${i + 1}`,
        tag: `${prefix}签${i + 1}`,
        title: `${prefix}路线${i + 1}`,
        ...(field === 'vision'
          ? { vision: `${prefix}终局${i + 1}` }
          : { summary: `${prefix}摘要${i + 1}`, [field]: [{ text: `${prefix}步${i + 1}`, done: false }] })
      }))
      await input.call('plot_compass_submit', {
        targetScope: 'all',
        playArchetypes: ['悬疑调查'],
        situationDigest: '多线并进',
        shortTerm: makeRoutes('s', 5, 'beats'),
        midTerm: makeRoutes('m', 5, 'milestones'),
        longTerm: makeRoutes('l', 5, 'vision')
      })
      return { text: '', traceSessionId: 'trace-limit' }
    }
  })

  const mounted = createPluginFiber('dsh-tavern-plot-compass', pluginApi.service)
  applyPlotCompass(mounted.ctx)

  await pluginApi.callHandler('plot-compass:set-enabled', { gameId: 'gLimit', enabled: true })
  const initState = await pluginApi.callHandler('plot-compass:state', { gameId: 'gLimit' })
  assert.equal(initState.plotCompass.maxRoutes, 4)

  // 通过偏好 RPC 将上限调至 6
  const prefRes = await pluginApi.callHandler('plot-compass:set-preferences', { gameId: 'gLimit', maxRoutes: 6 })
  assert.equal(prefRes.plotCompass.maxRoutes, 6)

  // 推演时工具 schema maxItems 为 6，返回 5 条全部保留
  const genRes = await pluginApi.callHandler('plot-compass:generate', { gameId: 'gLimit', scope: 'all', wait: true })
  assert.equal(genRes.status, 'done')
  assert.equal(runTaskCalls.length, 1)
  assert.equal(runTaskCalls[0].tools[0].parameters.properties.shortTerm.maxItems, 6)
  assert.equal(genRes.plotCompass.shortTerm.length, 5)
  assert.equal(genRes.plotCompass.midTerm.length, 5)
  assert.equal(genRes.plotCompass.longTerm.length, 5)

  // 调低上限为 2 后立刻截断已有路线
  const shrinkRes = await pluginApi.callHandler('plot-compass:set-preferences', { gameId: 'gLimit', maxRoutes: 2 })
  assert.equal(shrinkRes.plotCompass.maxRoutes, 2)
  assert.equal(shrinkRes.plotCompass.shortTerm.length, 2)
  assert.equal(shrinkRes.plotCompass.midTerm.length, 2)
  assert.equal(shrinkRes.plotCompass.longTerm.length, 2)

  mounted.dispose()
})
