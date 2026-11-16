import test from 'node:test'
import assert from 'node:assert/strict'
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

  // 验证 turnSection / candidateSection / compactionSection / worldbookScanText
  const turnCtx = await pluginApi.turnContext({ gameId: 'g1', turn: 3, target: 'story' })
  assert.equal(turnCtx.length, 1)
  assert.match(turnCtx[0].text, /挪开神龛查探密道/)
  assert.match(turnCtx[0].text, /风雪夜行中始终有故人剑意回响/)

  const candSections = await pluginApi.candidate.sections({ gameId: 'g1', turn: 3 })
  assert.equal(candSections.length, 1)
  assert.match(candSections[0].text, /探神龛/)

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
