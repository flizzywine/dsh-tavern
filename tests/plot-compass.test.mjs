import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

test('剧情罗盘输入栏入口在窄屏只显示图标', async () => {
  const text = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-plot-compass/client.js', import.meta.url), 'utf8')
  // 文字节点必须带独立 class，否则下面的窄屏规则无从命中。
  assert.match(text, /className: 'dsh-tavern-compass-dock-label'/)
  const narrow = text.match(/@media \(max-width: 1023px\) \{[\s\S]{0,900}?\n\}/)
  assert.ok(narrow, '缺少窄屏媒体查询')
  assert.match(narrow[0], /\.dsh-tavern-compass-dock-label \{\s*display: none;/)
  // 图标靠左贴住输入条边缘（与上方楼层药丸同一左边界），而不居中缩进。
  assert.match(narrow[0], /\.dsh-tavern-compass-dock-btn \{[^}]*justify-content: flex-start;[^}]*min-width: 30px;/)
})

test('剧情罗盘入口走输入框尾部工具位，不再独占停靠区一行', async () => {
  const main = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-plot-compass/src/client/main.js', import.meta.url), 'utf8')
  // 优先用宿主的 compact tool 槽（输入卡尾部、提交键旁），只有旧宿主才退回停靠区。
  assert.match(main, /typeof ui\.registerComposerTool === 'function'/)
  assert.match(main, /h\(PlotCompassComposerTool/)
  assert.match(main, /ui\.registerComposerSlot/, '旧宿主仍要能退回停靠区')
  const text = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-plot-compass/client.js', import.meta.url), 'utf8')
  assert.match(text, /dsh-tavern-compass-tool-btn/)
  assert.match(text, /dsh-tavern-compass-tool-glyph/)
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

test('turnSection 支持 position: last 且排在预设中段之后，旧宿主不支持 last 时罗盘自动降级回 after', async () => {
  const { foregroundFrameInputs } = await import('../tavern-plugin/lib/domain/turn-orchestration.js')

  const storyEvents = createStoryEvents()
  const pluginApi = createTavernPluginApi({
    ctx: {},
    loaderOrigin: () => 'host',
    storyEvents,
    workflow: { register() { return () => {} } },
    resolveGame: async gameId => gameId === 'g1' ? { chatId: 'c1', sessionId: 'g1' } : null,
    data: {
      readGame: async () => null,
      saveGame: async () => {},
      readSettings: async () => ({ disabled: [], replacements: {}, values: {} }),
      writeSettings: async () => {}
    },
    pluginData: { read: async () => null, save: async () => {} },
    media: { issue: async () => {}, list: async () => [] },
    publishState: () => {}
  })

  const probe = createPluginFiber('probe-plugin', pluginApi.service)
  assert.throws(
    () => probe.ctx.tavern.turnSection({ name: 'bad', position: 'middle', text: 'x' }),
    /position 只能是 'before'、'after' 或 'last'/
  )
  probe.ctx.tavern.turnSection({ name: 'early', position: 'after', text: 'AFTER_PLUGIN' })
  probe.ctx.tavern.turnSection({ name: 'late', position: 'last', text: 'LAST_PLUGIN' })

  const pluginSections = await pluginApi.turnContext({ gameId: 'g1', turn: 1, target: 'story' })
  const frameInputs = foregroundFrameInputs(
    { sections: [{ kind: 'guide', required: false, text: 'GUIDE_TEXT' }] },
    '玩家行动',
    '玩家行动',
    { middle: { entries: [{ id: 'p1', role: 'system', content: 'PRESET_MIDDLE_RULE' }] } },
    {},
    pluginSections
  )
  const texts = frameInputs.map(item => item.text).filter(Boolean)
  const afterIdx = texts.indexOf('AFTER_PLUGIN')
  const presetIdx = texts.indexOf('PRESET_MIDDLE_RULE')
  const lastIdx = texts.indexOf('LAST_PLUGIN')
  assert.ok(afterIdx >= 0 && presetIdx > afterIdx && lastIdx > presetIdx, 'last 插件段落须排在预设 middle 之后')
  probe.dispose()

  // 模拟只允许 before/after 的旧宿主：applyPlotCompass 应捕获异常并回退走 after
  const legacySections = []
  let savedRecord = {
    version: 1,
    enabled: true,
    compass: {
      version: 1,
      strength: 'strict',
      shortTerm: [{ id: 's1', tag: '破门', title: '破门突入', summary: '踹开木门', beats: [{ text: '踹门而入', done: false }] }],
      midTerm: [],
      longTerm: [],
      pinned: { shortTerm: 's1', midTerm: null, longTerm: null }
    }
  }
  const legacyTavern = {
    readPluginData: async () => null,
    readGameData: async () => savedRecord,
    saveGameData: async ({ data }) => { savedRecord = data },
    turnSection(spec) {
      if (!['before', 'after'].includes(spec.position || 'after')) {
        throw new Error("position 只能是 'before' 或 'after'")
      }
      legacySections.push(spec)
      return () => {}
    }
  }
  const cleanup = applyPlotCompass({ tavern: legacyTavern })
  assert.equal(legacySections.length, 1)
  assert.equal(legacySections[0].position, 'after')
  const fallbackText = await legacySections[0].text({ gameId: 'g1' })
  assert.match(fallbackText, /硬性兑现裁定/)
  assert.match(fallbackText, /踹门而入/)
  if (typeof cleanup === 'function') cleanup()
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
  assert.match(initialBody, /场面切入抓手.*冷风吹偏烛火/)
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

