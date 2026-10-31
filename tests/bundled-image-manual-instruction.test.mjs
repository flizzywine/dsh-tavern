import test from 'node:test'
import assert from 'node:assert/strict'
import { imagePluginFixture } from './fixtures/image-plugin-runtime.mjs'
import { installTavernBridge } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/tavern-bridge.js'

function mockTavern({ readTurnData, saveTurnData } = {}) {
  return {
    apiVersion: 5,
    attach: async () => ({}),
    list: async () => [],
    getTurn: async () => ({ text: '雨夜，她望向窗外。', textVersion: 'version-1', card: { id: 'card-1', name: '测试卡' } }),
    promptSection: () => () => {},
    onTurnSettled: () => () => {},
    readTurnData: readTurnData ?? (async () => ({ data: { turn: 1, characters: [{ id: 'c1', appearance: '旧外貌' }] } })),
    saveTurnData: saveTurnData ?? (async () => {}),
  }
}

function planner({ response = '<image></image>', onCall = () => {} } = {}) {
  return { stream: args => {
    onCall(args)
    return (async function* () { yield { type: 'text-delta', text: response } })()
  } }
}

function userPrompt(call) {
  return call.messages[0].content.find(part => part.type === 'text').text
}

test('draw-turn 单次要求使用已有角色快照但不写回；空白要求保持原提示词兼容', async t => {
  const calls = []
  let reads = 0
  let writes = 0
  const historySnapshot = {
    version: 1, turn: 1, characters: { c1: {
      traits: { face: 'silver-white long hair' },
      current: { outfit: 'red raincoat', turn: 1, textVersion: 'version-1' },
    } }, changes: [],
  }
  const tavern = mockTavern({
    readTurnData: async () => { reads++; return { data: historySnapshot } },
    saveTurnData: async () => { writes++ },
  })
  const fixture = await imagePluginFixture(t, {
    config: { characterAutoUpdate: true }, tavern,
    definitions: { characters: [{ id: 'c1', name: '阿梅', match: 'A Mei', enabled: true,
      traits: { face: 'black hair' }, outfits: [{ id: 'o1', name: '常服', full: 'cream cardigan' }] }] },
    llm: planner({ onCall: args => calls.push(args) }),
  })
  const runtime = await fixture.start()
  const definitionsBefore = await fixture.read('definitions.json')

  const instructed = await runtime.request('draw-turn', { gameId: 'game-1', turn: 1, instruction: '俯视近景，抬手挡雨' })
  assert.equal(instructed.status, 200)
  assert.match(userPrompt(calls[0]), /雨夜，她望向窗外。\n\n<本次生图要求>\n俯视近景，抬手挡雨\n<\/本次生图要求>$/)
  assert.match(calls[0].system, /silver-white long hair/)
  assert.match(calls[0].system, /red raincoat/)
  assert.equal(reads, 1)
  assert.equal(writes, 0)

  const blank = await runtime.request('draw-turn', { gameId: 'game-1', turn: 1, instruction: ' \n\t ' })
  assert.equal(blank.status, 200)
  assert.equal(userPrompt(calls[1]), '雨夜，她望向窗外。')
  assert.equal(reads, 2)
  assert.equal(writes, 1, '空白要求沿用原本角色历史写回行为')
  assert.deepEqual(await fixture.read('definitions.json'), definitionsBefore)
})

test('draw-turn 对非字符串和超长要求返回 400，且不启动规划', async t => {
  let calls = 0
  const fixture = await imagePluginFixture(t, { tavern: mockTavern(), llm: planner({ onCall: () => calls++ }) })
  const runtime = await fixture.start()
  for (const instruction of [null, 42, {}, 'x'.repeat(2001)]) {
    const result = await runtime.request('draw-turn', { gameId: 'game-1', turn: 1, instruction })
    assert.equal(result.status, 400)
    assert.match(result.body.error, /instruction/)
  }
  assert.equal(calls, 0)
})

test('真实 draw-turn 路由对同轮普通请求与补充要求并发返回 409', async t => {
  let signalPlannerStarted
  let releasePlanner
  const plannerStarted = new Promise(resolve => { signalPlannerStarted = resolve })
  const waitForPlanner = new Promise(resolve => { releasePlanner = resolve })
  const fixture = await imagePluginFixture(t, {
    tavern: mockTavern(),
    llm: { stream: () => {
      signalPlannerStarted()
      return (async function* () {
        await waitForPlanner
        yield { type: 'text-delta', text: '<image></image>' }
      })()
    } },
  })
  const runtime = await fixture.start()
  const ordinary = runtime.request('draw-turn', { gameId: 'game-1', turn: 1 })
  await plannerStarted
  const instructed = await runtime.request('draw-turn', { gameId: 'game-1', turn: 1, instruction: '俯视近景' })
  assert.equal(instructed.status, 409)
  assert.match(instructed.body.error, /正在进行/)
  releasePlanner()
  assert.equal((await ordinary).status, 200)
})

test('有要求的同轮并发显式 busy；无要求手动重画仍替换自动任务', async () => {
  let releaseInstruction
  let markInstructionStarted
  const instructionStarted = new Promise(resolve => { markInstructionStarted = resolve })
  const calls = []
  const tavern = {
    apiVersion: 5,
    getTurn: async ({ turn }) => ({ textVersion: turn === 1 ? 'v1' : 'v2' }),
    list: async () => [],
    onTurnSettled: () => () => {},
  }
  const bridge = installTavernBridge({
    tavern, attachments: {}, getConfig: () => ({}), logger: {},
    engine: {
      getJob: () => null,
      planMessage: ({ manual, signal, instruction }) => {
        calls.push(manual ? 'manual' : 'auto')
        if (instruction) return new Promise(resolve => {
          releaseInstruction = () => resolve({ plans: [] })
          markInstructionStarted()
        })
        if (!manual) return new Promise(resolve => signal.addEventListener('abort', () => resolve({ plans: [] }), { once: true }))
        return Promise.resolve({ plans: [] })
      },
    },
  })
  try {
    const auto = bridge.attachTurn({ gameId: 'g', turn: 1, textVersion: 'v1', text: '正文' })
    await Promise.resolve()
    const manual = bridge.attachTurn({ gameId: 'g', turn: 1, textVersion: 'v1', text: '正文', manual: true })
    const results = await Promise.allSettled([auto, manual])
    assert.equal(results[1].status, 'fulfilled')
    assert.equal(results[0].status, 'rejected', '手动请求应取消原自动任务')
    assert.deepEqual(calls, ['manual'])

    const pending = bridge.attachTurn({ gameId: 'g', turn: 2, textVersion: 'v2', text: '正文', manual: true, instruction: '俯视' })
    await instructionStarted
    const busy = await bridge.attachTurn({ gameId: 'g', turn: 2, textVersion: 'v2', text: '正文', manual: true }).then(
      () => null, error => error,
    )
    assert.equal(busy?.statusCode, 409)
    releaseInstruction()
    await pending
  } finally {
    bridge.dispose()
  }
})
