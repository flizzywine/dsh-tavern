import assert from 'node:assert/strict'
import test from 'node:test'
import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'

// Game 'game' at its latest turn 3; regenerateLatest stands in for the 重新生成 button (rpc/play.js regenBody).
function harness({ owner = 'rewriter', origin = 'global', regenerate = true } = {}) {
  const state = { turn: 3, key: 'version-1', greeting: false, activity: null, result: { aborted: false }, calls: [] }
  const material = () => ({ chatId: 'chat', sessionId: 'game', turn: state.turn, index: 1, key: state.key, greeting: state.greeting,
    text: state.key, source: state.key, card: { path: 'cards/a.json', name: 'A' } })
  const api = createTavernPluginApi({
    ctx: { fiber: { name: owner } }, logger: { warn() {} },
    runningUserPlugins: new Map([[owner, { runtimeName: owner, origin }]]),
    cardScope: async () => new Map(origin === 'card' ? [[owner, { cards: ['cards/b.json'] }]] : []),
    cardPathOf: async () => 'cards/a.json',
    resolveGame: async gameId => gameId === 'game' ? { chatId: 'chat', sessionId: 'game' } : null,
    readTurn: async () => material(), readLatestSettledTurn: async () => material(), readPendingTurn: async () => material(),
    readActivity: async () => state.activity, publish() {},
    ...(regenerate ? {
      regenerateLatest: async (sessionId, guidance) => {
        state.calls.push({ sessionId, guidance })
        if (state.result instanceof Error) throw state.result
        if (!state.result.aborted) state.key = 'version-' + (state.calls.length + 1)
        return state.result
      }
    } : {})
  })
  return { service: api.service, state }
}

test('regenerateTurn：按修改意见重新生成最新一轮，回来时带着新正文的版本', async () => {
  const { service, state } = harness()
  assert.equal(service.capabilities.regenerateTurn, 1)
  // 结算还没完也能重新生成：跟按钮一样，重新生成会停下这一轮的结算
  state.activity = { settling: true }
  assert.deepEqual(await service.regenerateTurn({ gameId: 'game', turn: 3, textVersion: 'version-1', guidance: '  台词再收一点\n' }), { turn: 3, textVersion: 'version-2' })
  // 不写意见就是普通的重新生成
  assert.deepEqual(await service.regenerateTurn({ gameId: 'game', turn: 3, textVersion: 'version-2' }), { turn: 3, textVersion: 'version-3' })
  assert.deepEqual(state.calls, [{ sessionId: 'game', guidance: '台词再收一点' }, { sessionId: 'game', guidance: '' }])
})

test('regenerateTurn：只认最新一轮当前显示的那一版；前台在写、开场白、写错轮次都不动', async () => {
  const { service, state } = harness()
  const call = input => service.regenerateTurn({ gameId: 'game', turn: 3, textVersion: 'version-1', ...input })
  await assert.rejects(call({ textVersion: 'version-0' }), { code: 'TAVERN_PLUGIN_STALE_VERSION' })
  await assert.rejects(call({ textVersion: undefined }), { code: 'TAVERN_PLUGIN_STALE_VERSION' })
  await assert.rejects(call({ turn: 2 }), { code: 'TAVERN_PLUGIN_TURN_UNAVAILABLE' })
  state.greeting = true
  await assert.rejects(call(), { code: 'TAVERN_PLUGIN_TURN_UNAVAILABLE' })
  state.greeting = false
  state.activity = { generating: true }
  await assert.rejects(call(), { code: 'TAVERN_PLUGIN_BUSY' })
  state.activity = null
  await assert.rejects(call({ gameId: 'missing' }), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
  await assert.rejects(call({ guidance: 3 }), TypeError)
  await assert.rejects(call({ guidance: '改'.repeat(20001) }), /不能超过 20000 字/)
  assert.deepEqual(state.calls, [])
})

test('regenerateTurn：被停下报 TAVERN_PLUGIN_ABORTED，宿主的错照原样抛出', async () => {
  const { service, state } = harness()
  state.result = { aborted: true }
  await assert.rejects(service.regenerateTurn({ gameId: 'game', turn: 3, textVersion: 'version-1' }), { code: 'TAVERN_PLUGIN_ABORTED' })
  state.result = Object.assign(new Error('最新一轮的输入还没有写出正文，不能重新生成上一轮'), { code: 'TAVERN_PLUGIN_TURN_UNAVAILABLE' })
  await assert.rejects(service.regenerateTurn({ gameId: 'game', turn: 3, textVersion: 'version-1' }), { code: 'TAVERN_PLUGIN_TURN_UNAVAILABLE' })
})

test('regenerateTurn：宿主没接上时没有这项能力；卡内插件只能动自己那张卡的局', async () => {
  const old = harness({ regenerate: false })
  assert.equal(old.service.capabilities.regenerateTurn, undefined)
  await assert.rejects(old.service.regenerateTurn({ gameId: 'game', turn: 3, textVersion: 'version-1' }), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
  const card = harness({ owner: 'card-rewriter', origin: 'card' })
  await assert.rejects(card.service.regenerateTurn({ gameId: 'game', turn: 3, textVersion: 'version-1' }), { code: 'TAVERN_PLUGIN_SCOPE' })
  assert.deepEqual(card.state.calls, [])
})
