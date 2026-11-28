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
  const settingsChanges = []
  const settings = { disabled: [], replacements: {}, values: {} }
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
      readSettings: async () => structuredClone(settings),
      updateSettings: async (_chatId, update) => { update(settings) }
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
    settingsChanged: (gameId, plugin) => settingsChanges.push({ gameId, plugin }),
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

  const plugin = 'dsh-tavern-plot-compass'
  const readOptions = async () => (await pluginApi.gamePlugins('g1')).settings
  const changeOption = (key, value) => pluginApi.setGamePlugin('g1', { setting: { plugin, key, value } })
  assert.deepEqual(await readOptions(), [])
  await assert.rejects(changeOption('maxRoutes', 5), /没有这个插件配置项/)

  // 开启罗盘并切换为跟随前台模型。设置只走插件工作台面板，宿主本局设置不再有罗盘分组。
  await pluginApi.callHandler('plot-compass:set-enabled', { gameId: 'g1', enabled: true })
  assert.deepEqual(await readOptions(), [])
  assert.deepEqual(settingsChanges, [])
  assert.equal(await pluginApi.pluginGameSettings('g1', plugin), null)
  await pluginApi.callHandler('plot-compass:set-preferences', { gameId: 'g1', maxRoutes: 5 })
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

test('剧情罗盘今期节拍按多轮阶段解析、注入正文、核对完成与超时加压', async () => {
  const {
    applyPlotCompassAutoProgress,
    buildPlotCompassProgressPrompt,
    buildPlotCompassSubmitTool,
    collectPendingCompassSteps,
    parsePlotCompassSubmission,
    plotCompassBodyText,
    plotCompassCandidateText,
    readPlotCompass
  } = await import('../tavern-plugin/packages/dsh-tavern-plot-compass/lib/plot-compass.js')

  // 工具 schema：今期节拍必须给出预计轮数、阻力与达成标志；中期里程碑仍是一句转折
  const tool = buildPlotCompassSubmitTool(4)
  const beatsSchema = tool.parameters.properties.shortTerm.items.properties.beats
  assert.equal(beatsSchema.maxItems, 3)
  assert.deepEqual(beatsSchema.items.required, ['text', 'turns', 'friction', 'doneWhen'])
  assert.equal(beatsSchema.items.properties.turns.minimum, 1)
  assert.equal(beatsSchema.items.properties.turns.maximum, 3)
  assert.deepEqual(tool.parameters.properties.midTerm.items.properties.milestones.items.required, ['text'])

  // 解析：保留阶段字段并把轮数截到 1–3；旧式字符串节拍与中期里程碑不带阶段字段
  const parsed = parsePlotCompassSubmission({
    playArchetypes: ['奇幻冒险'],
    situationDigest: '雨夜破庙，追兵将至。',
    shortTerm: [
      {
        id: 's1', tag: '套话', title: '撬开苏晚的口风', summary: '以情报换情报，拿到残图下落。',
        beats: [
          { text: '撬开苏晚对残图去向的口风', turns: 2, friction: '苏晚只肯以情报换情报', doneWhen: '苏晚承认残图在她手里' },
          { text: '抢在追兵前进入密道', turns: 7, friction: '追兵已在庙外林中搜索', doneWhen: '两人进入密道并封住入口', done: false }
        ]
      },
      { id: 's2', tag: '守庙门', title: '熄火伏击追兵', summary: '借夜雨设伏。', beats: ['泼灭篝火'] }
    ],
    midTerm: [
      { id: 'm1', tag: '北岭', title: '北岭寻踪', summary: '直抵旧寨。', milestones: [{ text: '走出密道', turns: 2, friction: '甲', doneWhen: '乙' }] },
      { id: 'm2', tag: '反查', title: '反查幕后', summary: '逼问买凶之人。', milestones: ['生擒头目'] }
    ],
    longTerm: [
      { id: 'l1', tag: '重振', title: '重开山门', vision: '重振山门。' },
      { id: 'l2', tag: '隐退', title: '远走天涯', vision: '浪迹天涯。' }
    ]
  })
  const stages = [
    { text: '撬开苏晚对残图去向的口风', turns: 2, friction: '苏晚只肯以情报换情报', doneWhen: '苏晚承认残图在她手里', done: false },
    { text: '抢在追兵前进入密道', turns: 3, friction: '追兵已在庙外林中搜索', doneWhen: '两人进入密道并封住入口', done: false }
  ]
  assert.deepEqual(parsed.shortTerm[0].beats, stages)
  assert.deepEqual(parsed.shortTerm[1].beats, [{ text: '泼灭篝火', done: false }])
  assert.deepEqual(parsed.midTerm[0].milestones, [{ text: '走出密道', done: false }])

  let compass = readPlotCompass({
    version: 1,
    basedOnTurn: 10,
    lastCheckedTurn: 10,
    strength: 'guided',
    shortTerm: parsed.shortTerm,
    pinned: { shortTerm: 's1', midTerm: null, longTerm: null }
  })
  assert.deepEqual(compass.shortTerm[0].beats, stages)

  // 第 1 轮：链路标注预计轮数，并单列当前阶段的阻力、达成标志与逐轮节奏
  let body = plotCompassBodyText(compass)
  assert.match(body, /【▶ 1\.撬开苏晚对残图去向的口风〔约2轮〕（本轮推进目标）】 → \[○ 2\.抢在追兵前进入密道〔约3轮〕（后续留白）\]/)
  assert.match(body, /当前阶段「撬开苏晚对残图去向的口风」：预计 2 轮，本轮为第 1 轮 ｜ 阻力\/变数：苏晚只肯以情报换情报 ｜ 达成标志：苏晚承认残图在她手里/)
  assert.match(body, /阶段节奏：本轮只演当前阶段内的一个回合/)
  assert.match(body, /沉浸场景例外/)
  assert.doesNotMatch(body, /本轮已到该阶段的预计轮数|久拖破局加压/)
  assert.match(plotCompassCandidateText(compass), /target shift → 撬开苏晚对残图去向的口风 \| live friction in this stage: 苏晚只肯以情报换情报\./)

  // 硬性兑现：没到预计轮数时每轮必推，到点才要求必达
  assert.match(plotCompassBodyText(readPlotCompass({ ...compass, strength: 'strict' })), /（本轮必推阶段）/)
  assert.match(plotCompassBodyText(readPlotCompass({ ...compass, strength: 'strict', stalledTurns: 1 })), /（本轮必达目标）/)

  // 软铺垫只给阶段信息，不催进度；只铺垫节奏到点也不催兑现
  const softBody = plotCompassBodyText(readPlotCompass({ ...compass, strength: 'soft', stalledTurns: 5 }))
  assert.match(softBody, /当前阶段「撬开苏晚对残图去向的口风」/)
  assert.doesNotMatch(softBody, /阶段节奏|久拖破局加压|沉浸场景例外/)
  const foreshadowBody = plotCompassBodyText(readPlotCompass({ ...compass, pace: 'foreshadow', stalledTurns: 1 }))
  assert.match(foreshadowBody, /阶段节奏：本轮只在当前阶段内蓄势与试探/)
  assert.doesNotMatch(foreshadowBody, /本轮已到该阶段的预计轮数/)

  // 第 2 轮仍未达成：到预计轮数，提示本轮兑现，但还不加压
  compass = applyPlotCompassAutoProgress(compass, { completed: [], lapsed: [] }, { turn: 11 }).compass
  body = plotCompassBodyText(compass)
  assert.match(body, /预计 2 轮，本轮为第 2 轮/)
  assert.match(body, /本轮已到该阶段的预计轮数.*段尾停在下一阶段的入口/)
  assert.doesNotMatch(body, /久拖破局加压/)

  // 超出预计轮数才加压
  compass = applyPlotCompassAutoProgress(compass, { completed: [], lapsed: [] }, { turn: 12 }).compass
  body = plotCompassBodyText(compass)
  assert.match(body, /⚠ 久拖破局加压：节拍「撬开苏晚对残图去向的口风」已超出预计的 2 轮，连续 2 轮未达成/)
  assert.doesNotMatch(body, /本轮已到该阶段的预计轮数/)

  // 核对器拿到达成标志
  const pending = collectPendingCompassSteps(compass)
  assert.equal(pending[0].key, 'shortTerm:s1:0')
  assert.equal(pending[0].doneWhen, '苏晚承认残图在她手里')
  const progressPrompt = buildPlotCompassProgressPrompt([{ role: 'assistant', turn: 12, text: '苏晚沉默良久，仍不肯松口。' }], pending, { compass })
  assert.match(progressPrompt, /key="shortTerm:s1:0".*撬开苏晚对残图去向的口风 ｜ 达成标志：苏晚承认残图在她手里/)

  // 阶段达成后计数清零，下一阶段从第 1 轮算起；3 轮阶段演到第 3 轮也不加压
  compass = applyPlotCompassAutoProgress(compass, { completed: ['shortTerm:s1:0'], lapsed: [] }, { turn: 13 }).compass
  assert.equal(compass.stalledTurns, 0)
  body = plotCompassBodyText(compass)
  assert.match(body, /\[✓ 1\.撬开苏晚对残图去向的口风\] → 【▶ 2\.抢在追兵前进入密道〔约3轮〕（本轮推进目标）】/)
  assert.match(body, /当前阶段「抢在追兵前进入密道」：预计 3 轮，本轮为第 1 轮/)
  compass = applyPlotCompassAutoProgress(compass, { completed: [], lapsed: [] }, { turn: 14 }).compass
  compass = applyPlotCompassAutoProgress(compass, { completed: [], lapsed: [] }, { turn: 15 }).compass
  body = plotCompassBodyText(compass)
  assert.match(body, /预计 3 轮，本轮为第 3 轮/)
  assert.match(body, /本轮已到该阶段的预计轮数.*段尾留下这条路线收束后的新悬念/)
  assert.doesNotMatch(body, /久拖破局加压/)
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

test('剧情罗盘面板：命运之骰同款工作台双页签与 ? / × 详细说明展开收起', async t => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://tavern.test/' })
  const restore = []
  const install = (name, value) => { restore.push([name, globalThis[name]]); globalThis[name] = value }
  install('window', dom.window)
  install('document', dom.window.document)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  t.after(() => {
    for (const [name, value] of restore.reverse()) globalThis[name] = value
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
    dom.window.close()
  })

  const React = (await import('react')).default
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const source = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-plot-compass/client.js', import.meta.url), 'utf8')
  let def = null
  vm.runInContext(source, vm.createContext({
    window: { __ModuleLoader__: { load: v => { def = v } } },
    console
  }), { filename: 'dsh-tavern-plot-compass/client.js' })
  const mod = def.factory(spec => {
    if (spec === 'react') return React
    throw new Error('意外依赖：' + spec)
  })

  const statePayload = {
    enabled: true,
    modelSelection: 'background',
    latestAssistantTurn: 4,
    plotCompassTask: { status: 'idle', scope: 'all', error: '' },
    plotCompass: {
      strength: 'guided',
      pace: 'natural',
      stalledTurns: 0,
      blindBox: false,
      customDirective: '',
      goal: { enabled: false, horizon: 'shortTerm', text: '' },
      autoUpdateInterval: 0,
      maxRoutes: 4,
      playArchetypes: ['奇幻冒险'],
      customArchetypes: [],
      situationDigest: '雨夜暂歇破庙，神龛后似有异响。',
      shortTerm: [
        { id: 'st-1', tag: '探神龛', title: '挪开神龛查探密道', summary: '顺风声挪动神龛，发现北岭密道。', beats: [{ text: '试探底座', turns: 2, friction: '底座下压着半截断符', doneWhen: '神龛挪开露出暗道入口', done: false }] }
      ],
      midTerm: [],
      longTerm: [],
      pinned: { shortTerm: 'st-1', midTerm: null, longTerm: null },
      archived: [],
      chatHistory: [],
      basedOnTurn: 4
    }
  }
  const calls = []
  const ui = {
    async callHost(name, args) {
      calls.push([name, args])
      if (name === 'plot-compass:state') return statePayload
      if (name === 'plot-compass:set-preferences') {
        Object.assign(statePayload.plotCompass, args)
        return { plotCompass: statePayload.plotCompass }
      }
      return { ok: true }
    }
  }

  const host = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(host)
  const root = createRoot(host)

  await act(async () => { root.render(React.createElement(mod.PlotCompassPanel, { ui, gameId: 'g-ui' })) })
  assert.ok(host.querySelector('.pc-root.pc-workbench'), '应当使用命运之骰同款工作台根节点')
  assert.match(host.textContent, /挪开神龛查探密道/)
  // 今期节拍显示预计轮数、阻力与达成标志，漏斗区显示当前节拍演到第几轮
  assert.match(host.textContent, /约2轮/)
  assert.match(host.textContent, /阻力：底座下压着半截断符 ｜ 达成：神龛挪开露出暗道入口/)
  assert.match(host.textContent, /节拍进度：第 1 轮 \/ 约 2 轮/)

  // 顶栏 ? 点开变 × 并展示多段说明，点「收起」还原
  const topHelp = host.querySelector('button.pc-help-btn')
  assert.equal(topHelp.textContent, '?')
  await act(async () => { topHelp.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.equal(topHelp.textContent, '×')
  const pop = host.querySelector('.pc-help-pop')
  assert.ok(pop)
  assert.ok(pop.querySelectorAll('.pc-help-line').length >= 3)
  await act(async () => { pop.querySelector('button.pc-help-close').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.equal(host.querySelectorAll('.pc-help-pop').length, 0)
  assert.equal(topHelp.textContent, '?')

  // 第一页头部包含「游玩类型标签」与「目标导向」及其独立问号
  for (const label of ['查看说明：游玩类型标签', '查看说明：目标导向']) {
    const btn = [...host.querySelectorAll('button.pc-help-btn')].find(b => b.getAttribute('aria-label') === label)
    assert.ok(btn, `路线与推演页头部应当存在 ${label}`)
  }

  // 切换到「罗盘设置」页签：其余设置项均有独立 ? 按钮，且点开不发 RPC
  const settingsTab = [...host.querySelectorAll('button[role="tab"]')].find(b => b.textContent === '罗盘设置')
  assert.ok(settingsTab, '应当存在「罗盘设置」页签')
  await act(async () => { settingsTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  const callsBefore = calls.length
  for (const label of ['查看说明：约束力度', '查看说明：推进节奏', '查看说明：盲盒防剧透模式', '查看说明：自动更新间隔', '查看说明：每层条目上限', '查看说明：推演模型']) {
    const btn = [...host.querySelectorAll('button.pc-help-btn')].find(b => b.getAttribute('aria-label') === label)
    assert.ok(btn, `罗盘设置页应当存在 ${label}`)
  }
  const strengthHelp = [...host.querySelectorAll('button.pc-help-btn')].find(b => b.getAttribute('aria-label') === '查看说明：约束力度')
  await act(async () => { strengthHelp.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.match(host.querySelector('.pc-help-pop').textContent, /软铺垫/)
  assert.equal(calls.length, callsBefore)

  await act(async () => { root.unmount() })
})

test('plot-compass:model-reasoning 兼容 DSH 标准 info.reasoning.efforts 与旧版字段', async () => {
  const storyEvents = createStoryEvents()
  const modelInfos = {
    'google/gemini-4-neon': { reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
    'legacy/flat': { reasoningEfforts: ['medium', { id: 'max', name: 'Max' }] },
    'legacy/caps': { capabilities: { reasoningEfforts: [{ id: 'minimal', name: 'Minimal' }] } },
    'plain/no-effort': { context: { contextWindow: 128000 } }
  }
  const pluginApi = createTavernPluginApi({
    ctx: {},
    loaderOrigin: () => 'host',
    storyEvents,
    workflow: { register() { return () => {} } },
    resolveGame: async () => null,
    readLatestSettledTurn: async () => null,
    readPendingTurn: async () => null,
    currentKey: async () => null,
    readTurn: async () => null,
    readHistory: async () => [],
    readCard: async () => null,
    readPlayerName: async () => '你',
    backgroundModel: async () => null,
    foregroundModel: async () => null,
    data: {
      readGame: async () => null,
      saveGame: async () => {},
      readSettings: async () => ({ disabled: [], replacements: {}, values: {} }),
      writeSettings: async () => {}
    },
    pluginData: {
      read: async () => null,
      save: async () => {}
    },
    media: { issue: async () => {}, list: async () => [] },
    publishState: () => {},
    runTask: async () => ({ text: '' })
  })

  const mounted = createPluginFiber('dsh-tavern-plot-compass', pluginApi.service)
  applyPlotCompass(mounted.ctx, {
    llm: {
      async resolveModelInfo(provider, model) {
        return modelInfos[`${provider}/${model}`] || null
      }
    }
  })

  const standard = await pluginApi.callHandler('plot-compass:model-reasoning', { provider: 'google', model: 'gemini-4-neon' })
  assert.deepEqual(standard, {
    ok: true,
    reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] }
  })

  const flat = await pluginApi.callHandler('plot-compass:model-reasoning', { provider: 'legacy', model: 'flat' })
  assert.deepEqual(flat, {
    ok: true,
    reasoning: { efforts: [{ id: 'medium', name: 'medium' }, { id: 'max', name: 'Max' }] }
  })

  const caps = await pluginApi.callHandler('plot-compass:model-reasoning', { provider: 'legacy', model: 'caps' })
  assert.deepEqual(caps, {
    ok: true,
    reasoning: { efforts: [{ id: 'minimal', name: 'Minimal' }] }
  })

  const empty = await pluginApi.callHandler('plot-compass:model-reasoning', { provider: 'plain', model: 'no-effort' })
  assert.deepEqual(empty, { ok: true, reasoning: null })

  mounted.dispose()
})

test('小说参考纯域逻辑：粘贴切块、骨架合并续拆、结构化用与顺轨改编提示词、游标边界钳制与防泄露', async () => {
  const {
    MAX_PASTE_TEXT_CHARS,
    NOVEL_EXCERPT_TOOL_NAME,
    NOVEL_INSPECT_TOOL_NAME,
    advanceNovelCursorOnComplete,
    applyNovelCursorUpdate,
    buildNovelAnalyzePrompt,
    buildNovelReferenceSection,
    executeNovelToolCall,
    mergeNovelBlueprintBatch,
    parseNovelBlueprintSubmission,
    projectBlueprintForClient,
    splitPasteTextToChunks
  } = await import('../tavern-plugin/packages/dsh-tavern-plot-compass/lib/novel-reference.js')
  const {
    applyPlotCompassNovelRef,
    buildPlotCompassMaterial,
    mergePlotCompassUpdate,
    parsePlotCompassSubmission,
    plotCompassBodyText,
    readPlotCompass
  } = await import('../tavern-plugin/packages/dsh-tavern-plot-compass/lib/plot-compass.js')

  // 1. 粘贴切块按约 500 汉字/块且单块不超 1600 字符
  const longText = Array.from({ length: 120 }, (_, i) => `第${i + 1}句雨夜长街风声急，暗处有人低声试探残图下落。`).join('')
  const chunks = splitPasteTextToChunks(longText, 500)
  assert.ok(chunks.length >= 4 && MAX_PASTE_TEXT_CHARS === 30000)
  assert.ok(chunks.every((c, idx) => c.order === idx && c.text.length > 0 && c.text.length <= 1600))

  // 2. 拆书解析与增量续拆合并
  const analyzePrompt1 = buildNovelAnalyzePrompt({
    title: '夜雨暗卷',
    chunks: chunks.slice(0, 2),
    totalChunks: 4,
    startChunk: 0,
    sampledChunks: [{ order: 3, text: '末章采样文本。' }]
  })
  assert.match(analyzePrompt1, /<source_window>/)
  assert.match(analyzePrompt1, /<book_wide_samples>/)

  const parsedBatch1 = parseNovelBlueprintSubmission({
    dna: {
      toneAndPacing: '冷峻悬疑，三拍一小转折',
      conflictEngines: ['信息差反制'],
      frictionPatterns: ['盟友各自隐瞒底牌'],
      twistTechniques: ['先抑后扬亮出后手'],
      arcStructure: '试探 → 反制 → 揭底'
    },
    units: [
      {
        chapterLabel: '暗室试探与反咬筹码',
        scenePatterns: ['试探谈判', '信息差'],
        dramaticCore: '[主角方] 借半枚假筹码迫使 [施压者] 露出真正诉求。',
        conflictEngine: '双方各怀秘密，谁先交底谁吃亏',
        frictionDesign: '[施压者] 早已在门外安排耳目并设下三息倒计时',
        twistOrPayoff: '反客为主掌握谈判主导权',
        stakes: '筹码归属与合作破裂风险',
        chunkStart: 0,
        chunkEnd: 99 // 应被钳制到 maxChunkOrder
      }
    ],
    sourceEntities: ['谢无咎', '天机阁']
  }, { startIndex: 0, minChunkOrder: 0, maxChunkOrder: 1 })
  assert.equal(parsedBatch1.units[0].chunkEnd, 1)

  const bp1 = mergeNovelBlueprintBatch(null, parsedBatch1, {
    id: 'bp-test',
    title: '夜雨暗卷',
    sourceKind: 'paste',
    sourceHash: 'abc123',
    totalChunks: 4,
    nextIndexedChunks: 2,
    sourceChars: longText.length,
    pasteChunks: chunks,
    now: 1000
  })

  const parsedBatch2 = parseNovelBlueprintSubmission({
    dna: {
      toneAndPacing: '冷峻悬疑',
      conflictEngines: ['信息差反制', '限时突围'],
      frictionPatterns: ['第三方势力趁乱插手'],
      twistTechniques: ['借刀杀人反制'],
      arcStructure: '升级 → 决裂'
    },
    units: [
      {
        chapterLabel: '雨夜断桥截杀',
        scenePatterns: ['追逃交锋'],
        dramaticCore: '[主角方] 在退路被封时借 [第三方势力] 搅浑局势脱身。',
        conflictEngine: '多方势力狭窄地形遭遇',
        frictionDesign: '桥头伏兵封死常规出口，强行硬闯必留伤势代价',
        twistOrPayoff: '弃车保帅反将追兵引向对手阵营',
        chunkStart: 2,
        chunkEnd: 3
      }
    ],
    sourceEntities: ['断云桥']
  }, { startIndex: 1, minChunkOrder: 2, maxChunkOrder: 3 })

  const bp2 = mergeNovelBlueprintBatch(bp1, parsedBatch2, {
    nextIndexedChunks: 4,
    now: 2000
  })
  assert.equal(bp2.units.length, 2)
  assert.deepEqual(bp2.units.map(u => u.index), [0, 1])
  assert.deepEqual(bp2.dna.conflictEngines, ['信息差反制', '限时突围'])
  assert.deepEqual(bp2.sourceEntities, ['谢无咎', '天机阁', '断云桥'])

  // 投影给前端时不暴露 pasteChunks 和 sourceEntities
  const projected = projectBlueprintForClient(bp2)
  assert.equal('pasteChunks' in projected, false)
  assert.equal('sourceEntities' in projected, false)

  // 3. 结构化用 vs 顺轨改编 Prompt 与优先级声明、黑名单防串戏
  let compass = applyPlotCompassNovelRef({ version: 1 }, {
    blueprintId: bp2.id,
    enabled: true,
    mode: 'adapt_structure',
    weight: 'balanced'
  }, { totalUnits: bp2.units.length })
  compass = readPlotCompass({
    ...compass,
    goal: { enabled: true, horizon: 'shortTerm', text: '迫使苏晚交出北岭真图' }
  })

  const materialAdapt = buildPlotCompassMaterial({
    card: { name: '苏晚', description: '夜行侠客' },
    messages: [{ role: 'user', turn: 1, text: '我盯着她袖口。' }, { role: 'assistant', turn: 1, text: '苏晚按住剑柄。' }],
    compass,
    novelContext: { blueprint: bp2, novelRef: compass.novelRef }
  })
  assert.match(materialAdapt, /<novel_reference_blueprint>/)
  assert.match(materialAdapt, /ADAPT_STRUCTURE/)
  assert.match(materialAdapt, /<latest_scene_snapshot>.*<player_goal>.*<novel_reference_blueprint>/)
  assert.match(materialAdapt, /FORBIDDEN source proper nouns.*谢无咎.*天机阁.*断云桥/)
  assert.match(materialAdapt, /beats\[\]\.friction/)

  // 顺轨改编游标模式
  const compassTrack = applyPlotCompassNovelRef(compass, { mode: 'track_arc', cursorUnit: 0 }, { totalUnits: bp2.units.length })
  const trackSection = buildNovelReferenceSection({
    blueprint: bp2,
    novelRef: compassTrack.novelRef,
    maxRoutes: 4,
    hasActiveGoal: false,
    hasScriptWindow: false
  })
  assert.match(trackSection, /TRACK_ARC/)
  assert.match(trackSection, /CURRENT CURSOR UNIT/)
  assert.match(trackSection, /Upcoming Lookahead Units/)
  assert.match(trackSection, /novelCursorUpdate/)

  // 4. 提交解析、游标边界钳制与前台零串戏检查
  const sub = parsePlotCompassSubmission({
    playArchetypes: ['悬疑调查'],
    situationDigest: '雨夜对峙一触即发。',
    shortTerm: [
      {
        id: 'st-n1', tag: '假图试探', title: '以半卷残页诈出真图去向', summary: '借信息差反向试探对方底线。',
        beats: [{ text: '抛出假线索逼问反应', turns: 2, friction: '苏晚同样怀疑你在设局拖延', doneWhen: '苏晚失言漏出真图线索' }],
        novelTechnique: '借假筹码制造信息差反客为主',
        sourceHook: '顺轨改编'
      },
      { id: 'st-n2', tag: '撤离破庙', title: '暂避锋芒另寻切口', summary: '先拉开距离观察敌动向。', beats: [{ text: '退到庙檐下僵持', turns: 2, friction: '大雨倾盆视线受阻', doneWhen: '摸清庙外埋伏人数' }] }
    ],
    midTerm: [
      { id: 'mt-n1', tag: '北岭对局', title: '潜入北岭核对旧账', summary: '顺线索摸向旧寨。', milestones: ['摸进外围', '质询证人'] },
      { id: 'mt-n2', tag: '借势脱身', title: '引第三方搅局', summary: '借追兵彼此牵制。', milestones: ['散布风声', '趁乱破局'] }
    ],
    longTerm: [
      { id: 'lt-n1', tag: '真相大白', title: '掀开北岭旧案', vision: '双双直面旧日真凶。' },
      { id: 'lt-n2', tag: '各自天涯', title: '交易两清分道扬镳', vision: '拿到所需后各奔前程。' }
    ],
    novelCursorUpdate: {
      nextCursorUnit: 99,
      markAdaptedUnits: [0],
      graftNote: '已借暗室试探嫁接进破庙对峙，顺延至下一单元'
    }
  })
  assert.equal(sub.shortTerm[0].novelTechnique, '借假筹码制造信息差反客为主')

  const mergedCompass = mergePlotCompassUpdate(
    { ...compassTrack, pinned: { shortTerm: 'st-n1', midTerm: null, longTerm: null } },
    sub,
    { scope: 'all', turn: 2, novelTotalUnits: bp2.units.length }
  )
  assert.equal(mergedCompass.novelRef.cursorUnit, 1, 'nextCursorUnit 越界时钳制为最后一个单元下标')
  assert.deepEqual(mergedCompass.novelRef.adaptedUnits, [0])
  assert.match(mergedCompass.novelRef.graftNote, /破庙对峙/)

  const pinnedCompass = readPlotCompass({ ...mergedCompass, pinned: { shortTerm: 'st-n1', midTerm: null, longTerm: null } })
  const body = plotCompassBodyText(pinnedCompass)
  assert.doesNotMatch(body, /夜雨暗卷|borrow|借假筹码制造信息差反客为主|单元 #/, '前台正文不得泄露参考小说书名、单元号或技巧标签')

  // 游标辅助函数
  const advanced = advanceNovelCursorOnComplete({ ...compassTrack.novelRef, cursorUnit: 0 }, 2)
  assert.equal(advanced.cursorUnit, 1)
  assert.deepEqual(advanced.adaptedUnits, [0])
  const clampedUpdate = applyNovelCursorUpdate(advanced, { nextCursorUnit: -5, markSkippedUnits: [0, 99] }, 2)
  assert.equal(clampedUpdate.cursorUnit, 0)
  assert.deepEqual(clampedUpdate.skippedUnits, [0])

  // 只读参考工具调用
  const inspectRes = JSON.parse(await executeNovelToolCall({
    call: { name: NOVEL_INSPECT_TOOL_NAME, arguments: { query: '断桥' } },
    blueprint: bp2
  }))
  assert.equal(inspectRes.ok, true)
  assert.equal(inspectRes.matched[0].chapterLabel, '雨夜断桥截杀')

  const excerptRes = JSON.parse(await executeNovelToolCall({
    call: { name: NOVEL_EXCERPT_TOOL_NAME, arguments: { startChunk: 0, count: 2 } },
    blueprint: bp2
  }))
  assert.equal(excerptRes.ok, true)
  assert.equal(excerptRes.chunks.length, 2)
  assert.match(excerptRes.warning, /严禁照搬原著/)
})

test('小说参考全链路 RPC：剧本库分批拆书、跨对话全局共享、粘贴拆书、多工具检索转译、游标更新与优雅降级', async () => {
  const { createScriptLibrary } = await import('../tavern-plugin/lib/domain/script-library.js')
  const storyEvents = createStoryEvents()
  const gameDataMap = new Map()
  const pluginDataMap = new Map()
  const runTaskCalls = []

  const sourcePath = 'materials/孤城谍影.txt'
  let bookChunks = Array.from({ length: 26 }, (_, order) => ({
    id: `chunk-${String(order + 1).padStart(5, '0')}`,
    order,
    text: `第${order + 1}段原著情报战剧情：角色顾沉在老钟表店用暗号试探对手，钟摆声倒计时逼近。`
  }))
  const scriptLibrary = createScriptLibrary({
    fileResources: { list: async () => [sourcePath] },
    readScript: async p => p === sourcePath
      ? { path: sourcePath, title: '孤城谍影.txt', sourceChars: 2600, chunkSize: 500, chunks: bookChunks }
      : undefined
  })

  const games = {
    g1: { chatId: 'c1', sessionId: 'g1', cardName: '林月', cardDesc: '民国暗桩' },
    g2: { chatId: 'c2', sessionId: 'g2', cardName: '白术', cardDesc: '修仙丹师' }
  }

  let analyzeCallCount = 0
  let compassToolTrace = []
  const pluginApi = createTavernPluginApi({
    ctx: {},
    loaderOrigin: () => 'host',
    storyEvents,
    scriptLibrary,
    workflow: { register() { return () => {} } },
    resolveGame: async gid => games[gid] ? { chatId: games[gid].chatId, sessionId: gid, cardPath: `cards/${gid}.json` } : null,
    readLatestSettledTurn: async gid => ({ chatId: games[gid]?.chatId, sessionId: gid, turn: 2, key: '2:0', text: '雨丝斜落石阶，对面的茶摊还亮着灯。' }),
    readPendingTurn: async gid => ({ chatId: games[gid]?.chatId, sessionId: gid, turn: 2, key: '2:0', text: '雨丝斜落石阶，对面的茶摊还亮着灯。' }),
    currentKey: async () => '2:0',
    readTurn: async gid => ({ chatId: games[gid]?.chatId, sessionId: gid, key: '2:0', turn: 2, rawText: '雨丝斜落石阶，对面的茶摊还亮着灯。', text: '雨丝斜落石阶，对面的茶摊还亮着灯。' }),
    readHistory: async () => [{ turn: 2, input: '推门进茶摊', rawText: '雨丝斜落石阶，对面的茶摊还亮着灯。', text: '雨丝斜落石阶，对面的茶摊还亮着灯。' }],
    readCard: async gid => ({ name: games[gid]?.cardName || '角色', description: games[gid]?.cardDesc || '' }),
    readPlayerName: async () => '你',
    backgroundModel: async () => ({ provider: 'bg', model: 'bg-m' }),
    foregroundModel: async () => ({ provider: 'fg', model: 'fg-m' }),
    data: {
      readGame: async ({ chatId, owner }) => gameDataMap.get(`${chatId}:${owner}`) || null,
      saveGame: async ({ chatId, owner, data }) => { gameDataMap.set(`${chatId}:${owner}`, structuredClone(data)) },
      readSettings: async () => ({ disabled: [], replacements: {}, values: {} }),
      updateSettings: async () => {}
    },
    pluginData: {
      read: async owner => pluginDataMap.get(owner) ?? null,
      save: async (owner, data) => { pluginDataMap.set(owner, structuredClone(data)) }
    },
    media: { issue: async () => {}, list: async () => [] },
    publishState: () => {},
    runTask: async input => {
      runTaskCalls.push(input)
      if (input.tools.some(t => t.name === 'novel_blueprint_submit')) {
        analyzeCallCount++
        const isContinuation = /Incremental Continuation Batch/.test(input.prompt)
        await input.call('novel_blueprint_submit', {
          dna: {
            toneAndPacing: '暗流高压、倒计时逼近',
            conflictEngines: [isContinuation ? '双向暴露危机' : '暗号错位试探'],
            frictionPatterns: ['对手用反常沉默逼主角先露破绽'],
            twistTechniques: ['表面服软实则反手锁定退路'],
            arcStructure: '错位试探 → 定时反咬 → 破局撤离'
          },
          units: [
            {
              chapterLabel: isContinuation ? '真假身份对峙二番战' : '茶肆暗号试探交锋',
              scenePatterns: ['试探谈判'],
              dramaticCore: isContinuation
                ? '[施压者] 亮出第二枚物证逼迫 [主角方] 站队。'
                : '[主角方] 借错位暗号反测 [施压者] 是否真知内情。',
              conflictEngine: '信息不对称下的身份猜疑',
              frictionDesign: '[施压者] 故意留半句错漏反钓鱼，且外街巡哨正在合拢',
              twistOrPayoff: '借势把怀疑转移到第三方势力头上',
              chunkStart: isContinuation ? 16 : 0,
              chunkEnd: isContinuation ? 25 : 15
            }
          ],
          sourceEntities: ['顾沉', '老钟表店']
        })
        return { text: '', traceSessionId: `trace-analyze-${analyzeCallCount}` }
      }

      // 罗盘推演阶段：若挂载了小说参考只读工具，先检视与翻阅再提交
      if (input.tools.some(t => t.name === 'novel_blueprint_inspect')) {
        const r1 = JSON.parse(await input.call('novel_blueprint_inspect', { unitIndex: 0 }))
        const r2 = JSON.parse(await input.call('novel_excerpt_read', { startChunk: 0, count: 2 }))
        compassToolTrace.push({ inspected: r1.ok, excerptCount: r2.chunks?.length || 0 })
      }
      await input.call('plot_compass_submit', {
        playArchetypes: ['悬疑调查'],
        situationDigest: '雨夜茶摊，对方似在试探底细。',
        shortTerm: [
          {
            id: 'st-1', tag: '错位试探', title: '故意抛出半真半假的消息试探茶客', summary: '借信息差反向套出对方真实来意。',
            beats: [{ text: '反咬一口引出对方后手', turns: 2, friction: '茶客故意留半句错漏反钓鱼，街口更鼓渐近', doneWhen: '茶客露出口风承认在等人' }],
            novelTechnique: '借错位暗号钓鱼试探与倒计时施压',
            sourceHook: '顺轨改编'
          },
          { id: 'st-2', tag: '绕后查探', title: '借点茶之际查看后院动静', summary: '观察茶摊外围接应人手。', beats: [{ text: '试探后门动向', turns: 2, friction: '伙计紧盯柜台', doneWhen: '确认门外伏兵人数' }] }
        ],
        midTerm: [
          { id: 'mt-1', tag: '暗桩揭底', title: '顺线索反追幕后接头点', summary: '由茶摊顺藤摸瓜。', milestones: ['核对令牌', '反制接头人'] },
          { id: 'mt-2', tag: '借刀脱身', title: '把巡夜视线引向竞争势力', summary: '坐收渔利趁乱退场。', milestones: ['嫁祸风声', '安全撤离'] }
        ],
        longTerm: [
          { id: 'lt-1', tag: '执棋反杀', title: '反控整条情报暗网', vision: '成为暗线真正执棋人。' },
          { id: 'lt-n2', tag: '隐姓埋名', title: '销毁账册抽身远遁', vision: '了结旧账悄然退隐。' }
        ],
        ...(input.tools[0].parameters.properties.novelCursorUpdate
          ? {
              novelCursorUpdate: {
                nextCursorUnit: 1,
                markAdaptedUnits: [0],
                graftNote: '茶摊试探已承接第 1 单元，推进至第 2 单元对峙'
              }
            }
          : {})
      })
      return { text: '', traceSessionId: 'trace-compass-novel' }
    }
  })

  const mounted = createPluginFiber('dsh-tavern-plot-compass', pluginApi.service)
  applyPlotCompass(mounted.ctx)

  await pluginApi.callHandler('plot-compass:set-enabled', { gameId: 'g1', enabled: true })
  await pluginApi.callHandler('plot-compass:set-enabled', { gameId: 'g2', enabled: true })

  // 1. 列出剧本库
  const srcRes = await pluginApi.callHandler('plot-compass:list-script-sources', {})
  assert.equal(srcRes.available, true)
  assert.deepEqual(srcRes.sources.map(s => s.path), [sourcePath])

  // 2. g1 从剧本库拆第一批（16/26 块，且因 >24 块携带全书抽样）
  const a1 = await pluginApi.callHandler('plot-compass:analyze-novel', {
    gameId: 'g1',
    sourceKind: 'script',
    sourcePath,
    wait: true,
    bindToGame: true
  })
  assert.equal(a1.status, 'done')
  assert.equal(a1.blueprint.indexedChunks, 16)
  assert.equal(a1.blueprint.totalChunks, 26)
  assert.equal(a1.blueprint.units.length, 1)
  assert.match(runTaskCalls[0].prompt, /<book_wide_samples>/)

  // 同 hash 再次拆书自动复用不重耗模型
  const reused = await pluginApi.callHandler('plot-compass:analyze-novel', {
    gameId: 'g1',
    sourceKind: 'script',
    sourcePath,
    wait: true
  })
  assert.equal(reused.reused, true)
  assert.equal(analyzeCallCount, 1)

  // 3. 续拆下一批（16..26）
  const cont = await pluginApi.callHandler('plot-compass:continue-novel', {
    gameId: 'g1',
    blueprintId: a1.blueprint.id,
    wait: true
  })
  assert.equal(cont.status, 'done')
  assert.equal(cont.blueprint.indexedChunks, 26)
  assert.equal(cont.blueprint.units.length, 2)

  // 4. g2 状态共享同一全局骨架，但默认未启用；g2 独立勾选启用顺轨模式
  const g2StateBefore = await pluginApi.callHandler('plot-compass:state', { gameId: 'g2' })
  assert.equal(g2StateBefore.novelBlueprints.length, 1)
  assert.equal(g2StateBefore.plotCompass.novelRef.enabled, false)

  await pluginApi.callHandler('plot-compass:set-novel-ref', {
    gameId: 'g2',
    blueprintId: a1.blueprint.id,
    enabled: true,
    mode: 'track_arc',
    weight: 'strong'
  })

  // 5. g2 推演：Agent 先调用 inspect 和 excerpt 只读工具，再提交路线和游标更新
  const g2Gen = await pluginApi.callHandler('plot-compass:generate', { gameId: 'g2', scope: 'all', wait: true })
  assert.equal(g2Gen.status, 'done')
  assert.deepEqual(compassToolTrace, [{ inspected: true, excerptCount: 2 }])
  assert.equal(g2Gen.plotCompass.shortTerm[0].novelTechnique, '借错位暗号钓鱼试探与倒计时施压')
  assert.equal(g2Gen.plotCompass.novelRef.cursorUnit, 1)
  assert.deepEqual(g2Gen.plotCompass.novelRef.adaptedUnits, [0])

  // 6. 粘贴小说片段拆书（校验过短报错 + 正常提交）
  await assert.rejects(
    pluginApi.callHandler('plot-compass:analyze-novel', {
      gameId: 'g1',
      sourceKind: 'paste',
      title: '过短片段',
      text: '不足两百字。',
      wait: true
    }),
    /至少需要 200 字/
  )
  const pasteBody = '黑夜风雪卷过山门，'.repeat(30)
  const pasteRes = await pluginApi.callHandler('plot-compass:analyze-novel', {
    gameId: 'g1',
    sourceKind: 'paste',
    title: '山门风雪神回',
    text: pasteBody,
    wait: true
  })
  assert.equal(pasteRes.status, 'done')
  assert.equal(pasteRes.blueprint.sourceKind, 'paste')
  assert.equal('pasteChunks' in pasteRes.blueprint, false, '返回给客户端的视图已剥离 pasteChunks')

  // 7. 删除全局骨架后，g2 推演依然优雅降级成功（不会崩溃）
  const delRes = await pluginApi.callHandler('plot-compass:delete-novel', { blueprintId: a1.blueprint.id })
  assert.equal(delRes.removed, true)
  const g2GenAfterDelete = await pluginApi.callHandler('plot-compass:generate', { gameId: 'g2', scope: 'all', wait: true })
  assert.equal(g2GenAfterDelete.status, 'done')

  mounted.dispose()
})

test('顺轨改编自动闭环：节拍完成自动进游标与近末尾自动续拆、路线失效偏离嫁接、全新生成与全局模型并发保鲜', async () => {
  const { createScriptLibrary } = await import('../tavern-plugin/lib/domain/script-library.js')
  const storyEvents = createStoryEvents()
  const gameDataMap = new Map()
  const pluginDataMap = new Map()
  const genPrompts = []

  const sourcePath = 'materials/长卷试炼.txt'
  const bookChunks = Array.from({ length: 30 }, (_, order) => ({
    id: `chunk-${String(order + 1).padStart(5, '0')}`,
    order,
    text: `第${order + 1}段试炼原文内容。`
  }))
  const scriptLibrary = createScriptLibrary({
    fileResources: { list: async () => [sourcePath] },
    readScript: async p => p === sourcePath
      ? { path: sourcePath, title: '长卷试炼.txt', sourceChars: 3000, chunkSize: 500, chunks: bookChunks }
      : undefined
  })

  let currentTurn = 1
  let currentProse = '苏晚打开密匣确认了第一枚机关钥匙。'
  let progressOutcomeJson = JSON.stringify({
    completed: [{ key: 'shortTerm:st-1:0', evidence: '苏晚打开密匣确认了第一枚机关钥匙' }],
    lapsed: []
  })
  let analyzeBatchCount = 0

  const pluginApi = createTavernPluginApi({
    ctx: {},
    loaderOrigin: () => 'host',
    storyEvents,
    scriptLibrary,
    workflow: { register() { return () => {} } },
    resolveGame: async gid => gid === 'g1' ? { chatId: 'c1', sessionId: 'g1', cardPath: 'cards/a.json' } : null,
    readLatestSettledTurn: async () => ({ chatId: 'c1', sessionId: 'g1', turn: currentTurn, key: `${currentTurn}:0`, text: currentProse, source: currentProse, card: { path: 'cards/a.json', name: '苏晚' } }),
    readPendingTurn: async () => ({ chatId: 'c1', sessionId: 'g1', turn: currentTurn, key: `${currentTurn}:0`, text: currentProse, source: currentProse, card: { path: 'cards/a.json', name: '苏晚' } }),
    currentKey: async () => `${currentTurn}:0`,
    readTurn: async () => ({ chatId: 'c1', sessionId: 'g1', key: `${currentTurn}:0`, turn: currentTurn, rawText: currentProse, text: currentProse, source: currentProse, card: { path: 'cards/a.json', name: '苏晚' } }),
    readHistory: async () => [{ turn: currentTurn, input: '试着开启密匣', rawText: currentProse, text: currentProse }],
    readCard: async () => ({ name: '苏晚', description: '旅人' }),
    readPlayerName: async () => '你',
    backgroundModel: async () => ({ provider: 'bg', model: 'bg-m' }),
    foregroundModel: async () => ({ provider: 'fg', model: 'fg-m' }),
    data: {
      readGame: async ({ chatId, owner }) => gameDataMap.get(`${chatId}:${owner}`) || null,
      saveGame: async ({ chatId, owner, data }) => { gameDataMap.set(`${chatId}:${owner}`, structuredClone(data)) },
      readSettings: async () => ({ disabled: [], replacements: {}, values: {} }),
      updateSettings: async () => {}
    },
    pluginData: {
      read: async owner => pluginDataMap.get(owner) ?? null,
      save: async (owner, data) => { pluginDataMap.set(owner, structuredClone(data)) }
    },
    media: { issue: async () => {}, list: async () => [] },
    publishState: () => {},
    runTask: async input => {
      if (input.tools.some(t => t.name === 'novel_blueprint_submit')) {
        analyzeBatchCount++
        await input.call('novel_blueprint_submit', {
          dna: {
            toneAndPacing: '试炼递增',
            conflictEngines: ['机关解谜'],
            frictionPatterns: ['机关暗锁连锁反应'],
            twistTechniques: ['假门引真路'],
            arcStructure: '开门 → 闯关'
          },
          units: analyzeBatchCount === 1
            ? [
                { chapterLabel: '试炼第一重', scenePatterns: ['机关'], dramaticCore: '[主角方] 破解第一重机关。', conflictEngine: '限时解码', frictionDesign: '错一步即毒箭齐发', twistOrPayoff: '暗格弹出真钥', chunkStart: 0, chunkEnd: 7 },
                { chapterLabel: '试炼第二重', scenePatterns: ['陷阱'], dramaticCore: '[主角方] 穿越连环石室。', conflictEngine: '重力失衡', frictionDesign: '队友立场动摇不愿冒险垫后', twistOrPayoff: '利用坠石卡死机关', chunkStart: 8, chunkEnd: 15 }
              ]
            : [
                { chapterLabel: '试炼第三重', scenePatterns: ['boss战'], dramaticCore: '[主角方] 直面守关傀儡。', conflictEngine: '以弱博强', frictionDesign: '傀儡核心被多层护甲保护', twistOrPayoff: '共鸣声波震碎核心', chunkStart: 16, chunkEnd: 29 }
              ]
        })
        return { text: '', traceSessionId: `trace-b-${analyzeBatchCount}` }
      }

      genPrompts.push(input.prompt)
      await input.call('plot_compass_submit', {
        playArchetypes: ['副本闯关'],
        situationDigest: '推进下一幕试炼。',
        shortTerm: [
          { id: 'st-1', tag: '开锁', title: '破解密匣开启石门', summary: '开启第一道石门。', beats: [{ text: '确认密匣机关钥匙', turns: 2, friction: '暗锁随时可能反锁', doneWhen: '确认了第一枚机关钥匙' }] },
          { id: 'st-2', tag: '绕道', title: '绕道通风井', summary: '走暗道绕行。', beats: [{ text: '撬开铁栅', turns: 2, friction: '铁栅锈死易出声', doneWhen: '撬开井盖' }] }
        ],
        midTerm: [
          { id: 'mt-1', tag: '闯关', title: '贯通地下石室', summary: '打通整座秘境。', milestones: ['越过石室', '夺得核心'] },
          { id: 'mt-2', tag: '折返', title: '封印秘境撤离', summary: '毁掉入口离开。', milestones: ['封门', '脱身'] }
        ],
        longTerm: [
          { id: 'lt-1', tag: '登顶', title: '取得最终传承', vision: '继承试炼遗泽。' },
          { id: 'lt-2', tag: '归隐', title: '带走秘宝归隐', vision: '远走江湖。' }
        ]
      })
      return { text: '', traceSessionId: 'trace-g' }
    }
  })

  const mounted = createPluginFiber('dsh-tavern-plot-compass', pluginApi.service)
  applyPlotCompass(mounted.ctx, {
    llm: {
      async stream() {
        return progressOutcomeJson
      }
    }
  })

  await pluginApi.callHandler('plot-compass:set-enabled', { gameId: 'g1', enabled: true })
  const analyzed = await pluginApi.callHandler('plot-compass:analyze-novel', {
    gameId: 'g1',
    sourceKind: 'script',
    sourcePath,
    wait: true,
    bindToGame: true
  })
  await pluginApi.callHandler('plot-compass:set-novel-ref', {
    gameId: 'g1',
    blueprintId: analyzed.blueprint.id,
    enabled: true,
    mode: 'track_arc'
  })
  await pluginApi.callHandler('plot-compass:generate', { gameId: 'g1', scope: 'all', wait: true })
  await pluginApi.callHandler('plot-compass:pin', { gameId: 'g1', horizon: 'shortTerm', routeId: 'st-1' })

  // 1. 回合结算：今期路线全部达成 -> 游标从 0 进到 1（接近 2 个单元末尾），自动触发续拆（analyzeBatchCount 变为 2，单元数变为 3）并重推今期
  currentTurn = 2
  await pluginApi.turnSettled('g1')
  await new Promise(resolve => setTimeout(resolve, 60))

  const afterComplete = await pluginApi.callHandler('plot-compass:state', { gameId: 'g1' })
  assert.equal(afterComplete.plotCompass.novelRef.cursorUnit, 1)
  assert.deepEqual(afterComplete.plotCompass.novelRef.adaptedUnits, [0])
  assert.equal(analyzeBatchCount, 2, '游标接近末尾且原文未拆完时应自动续拆下一段')
  assert.equal(afterComplete.novelBlueprints[0].units.length, 3)

  // 2. 偏离失效触发：guidance 中应包含偏离嫁接指导
  currentTurn = 3
  currentProse = '你一脚踹塌了石门，直接奔向外部悬崖。'
  progressOutcomeJson = JSON.stringify({
    completed: [],
    lapsed: [{ horizon: 'shortTerm', routeId: 'st-1', reason: '玩家已踹塌石门离开密室' }]
  })
  await pluginApi.turnSettled('g1')
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.ok(genPrompts.some(p => /游标.*第 2 单元|偏离|嫁接/.test(p)), '偏离失效重推应携带顺轨嫁接指导')

  // 3. 全新生成（fresh: true）不丢失 novelRef，且修改全局模型不覆盖全局 novelBlueprints
  await pluginApi.callHandler('plot-compass:generate', { gameId: 'g1', scope: 'all', fresh: true, wait: true })
  await pluginApi.callHandler('plot-compass:set-model', { gameId: 'g1', model: 'foreground' })
  const afterModelAndFresh = await pluginApi.callHandler('plot-compass:state', { gameId: 'g1' })
  assert.equal(afterModelAndFresh.modelSelection, 'foreground')
  assert.equal(afterModelAndFresh.novelBlueprints.length, 1, '修改全局模型不得覆盖全局骨架库')
  assert.equal(afterModelAndFresh.plotCompass.novelRef.enabled, true, '全新生成保留小说参考绑定')
  assert.equal(afterModelAndFresh.plotCompass.novelRef.blueprintId, analyzed.blueprint.id)

  mounted.dispose()
})

test('剧情罗盘面板小说参考 UI：三页签保留原有问号、小说参考页签交互、游标控制与盲盒隐藏化用手法', async t => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://tavern.test/' })
  const restore = []
  const install = (name, value) => { restore.push([name, globalThis[name]]); globalThis[name] = value }
  install('window', dom.window)
  install('document', dom.window.document)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  t.after(() => {
    for (const [name, value] of restore.reverse()) globalThis[name] = value
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
    dom.window.close()
  })

  const React = (await import('react')).default
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const source = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-plot-compass/client.js', import.meta.url), 'utf8')
  let def = null
  vm.runInContext(source, vm.createContext({
    window: { __ModuleLoader__: { load: v => { def = v } } },
    console
  }), { filename: 'dsh-tavern-plot-compass/client.js' })
  const mod = def.factory(spec => {
    if (spec === 'react') return React
    throw new Error('意外依赖：' + spec)
  })

  const statePayload = {
    enabled: true,
    modelSelection: 'background',
    latestAssistantTurn: 4,
    scriptLibraryAvailable: true,
    novelBlueprintTask: { status: 'idle', blueprintId: '', title: '', progressText: '', error: '' },
    novelBlueprints: [
      {
        id: 'bp-ui-1',
        title: '孤城暗卷',
        sourceKind: 'script',
        sourcePath: 'materials/孤城暗卷.txt',
        sourceHash: 'deadbeef',
        sourceChars: 2000,
        totalChunks: 12,
        indexedChunks: 8,
        dna: {
          toneAndPacing: '暗流拉扯',
          conflictEngines: ['信息差反制'],
          frictionPatterns: ['对手留半句诱饵'],
          twistTechniques: ['反客为主'],
          arcStructure: '试探 → 反转'
        },
        units: [
          { index: 0, id: 'unit-1', chapterLabel: '雨夜茶摊试探', scenePatterns: ['试探'], dramaticCore: '借暗号摸底', conflictEngine: '猜疑', frictionDesign: '对方留错漏钓鱼', twistOrPayoff: '反将一军', chunkStart: 0, chunkEnd: 3 },
          { index: 1, id: 'unit-2', chapterLabel: '钟表店对峙', scenePatterns: ['对峙'], dramaticCore: '倒计时逼供', conflictEngine: '倒计时', frictionDesign: '外街巡哨逼近', twistOrPayoff: '脱身反控', chunkStart: 4, chunkEnd: 7 }
        ]
      }
    ],
    plotCompassTask: { status: 'idle', scope: 'all', error: '' },
    plotCompass: {
      strength: 'guided',
      pace: 'natural',
      stalledTurns: 0,
      blindBox: false,
      customDirective: '',
      goal: { enabled: false, horizon: 'shortTerm', text: '' },
      novelRef: {
        enabled: true,
        blueprintId: 'bp-ui-1',
        mode: 'track_arc',
        weight: 'balanced',
        cursorUnit: 0,
        adaptedUnits: [],
        skippedUnits: [],
        graftNote: '已承接雨夜试探切口'
      },
      autoUpdateInterval: 0,
      maxRoutes: 4,
      playArchetypes: ['悬疑调查'],
      customArchetypes: [],
      situationDigest: '雨夜对峙。',
      shortTerm: [
        {
          id: 'st-1',
          tag: '套话',
          title: '以假情报钓鱼试探',
          summary: '顺势套出相手后手。',
          novelTechnique: '借错位暗号钓鱼试探',
          beats: [{ text: '抛出半真半假消息', turns: 2, friction: '对方先装傻反问', doneWhen: '对方露出口风', done: false }]
        }
      ],
      midTerm: [],
      longTerm: [],
      pinned: { shortTerm: 'st-1', midTerm: null, longTerm: null },
      archived: [],
      chatHistory: [],
      basedOnTurn: 4
    }
  }

  const calls = []
  const ui = {
    async callHost(name, args) {
      calls.push([name, args])
      if (name === 'plot-compass:state') return structuredClone(statePayload)
      if (name === 'plot-compass:list-script-sources') {
        return { available: true, sources: [{ path: 'materials/孤城暗卷.txt', title: '孤城暗卷.txt' }] }
      }
      if (name === 'plot-compass:set-novel-ref') {
        Object.assign(statePayload.plotCompass.novelRef, args)
        return { plotCompass: structuredClone(statePayload.plotCompass) }
      }
      if (name === 'plot-compass:analyze-novel') {
        return { status: 'running', blueprintId: 'bp-new' }
      }
      return { ok: true }
    }
  }

  const host = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(host)
  const root = createRoot(host)

  await act(async () => { root.render(React.createElement(mod.PlotCompassPanel, { ui, gameId: 'g-ui-novel' })) })

  // 1. 路线与推演页展示 3 页签、小说参考快捷栏及化用手法
  const tabLabels = [...host.querySelectorAll('button[role="tab"]')].map(b => b.textContent)
  assert.equal(tabLabels.includes('路线与推演'), true)
  assert.equal(tabLabels.includes('小说参考'), true)
  assert.equal(tabLabels.includes('罗盘设置'), true)
  assert.match(host.textContent, /📖 化用手法：借错位暗号钓鱼试探/)
  assert.match(host.textContent, /顺轨 #1\/2/)

  // 2. 切到「小说参考」页签：检验开关、游标微调、从剧本库拆书与粘贴片段表单
  const novelTab = [...host.querySelectorAll('button[role="tab"]')].find(b => b.textContent === '小说参考')
  await act(async () => { novelTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.match(host.textContent, /本局小说参考/)
  assert.match(host.textContent, /全局叙事骨架库/)
  assert.match(host.textContent, /雨夜茶摊试探/)

  // 点击「▶ 下一单元」微调游标
  const nextUnitBtn = [...host.querySelectorAll('button')].find(b => b.textContent === '▶ 下一单元')
  assert.ok(nextUnitBtn)
  await act(async () => { nextUnitBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.ok(calls.some(([name, args]) => name === 'plot-compass:set-novel-ref' && args.cursorUnit === 1))

  // 打开「+ 从剧本库拆书」触发列表加载
  const fromScriptBtn = [...host.querySelectorAll('button')].find(b => b.textContent === '+ 从剧本库拆书')
  await act(async () => { fromScriptBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.ok(calls.some(([name]) => name === 'plot-compass:list-script-sources'))
  assert.match(host.textContent, /孤城暗卷\.txt/)

  // 切回「路线与推演」并验证盲盒遮罩隐藏 novelTechnique
  statePayload.plotCompass.blindBox = true
  const routesTab = [...host.querySelectorAll('button[role="tab"]')].find(b => b.textContent === '路线与推演')
  await act(async () => { routesTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  // 触发状态重新读取（通过点选节拍或再点一次刷新态，直接重挂载一份验证初始 blindBox 即可）
  await act(async () => { root.render(React.createElement(mod.PlotCompassPanel, { ui, gameId: 'g-ui-novel-2' })) })
  assert.match(host.textContent, /盲盒防剧透已开启/)
  assert.doesNotMatch(host.textContent, /借错位暗号钓鱼试探/)

  await act(async () => { root.unmount() })
})
