import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginTurnReader } from '../tavern-plugin/lib/domain/plugin-turns.js'

function reader({ rounds = 60, recent = true } = {}) {
  const messages = [{ role: 'assistant', greeting: true }]
  for (let turn = 2; turn <= rounds; turn++) messages.push({ role: 'user' }, { role: 'assistant', turn })
  const calls = { whole: 0 }
  const game = { id: 'c', sessionId: 's', mode: 'story' }
  const pluginTurns = createPluginTurnReader({
    sessionState: async () => { calls.whole++; return { ...game, messages } },
    recentState: recent ? async (_id, count) => ({ ...game, messages: messages.slice(-count), messagesFrom: Math.max(0, messages.length - count) }) : undefined,
    sceneState: async () => null,
    header: async () => ({ settleStatus: 'done' }),
    slice: async () => null, fullChat: async () => null, readChatCard: async () => null
  })
  return { pluginTurns, calls, messages }
}

test('插件读最近一轮只读最近几层楼；读很早的一轮才退回完整摘要', async () => {
  const { pluginTurns, calls } = reader()
  // sceneState is null: material stops at the scene target, after locating the floor.
  assert.equal(await pluginTurns.readLatestSettledTurn('s'), null)
  assert.equal(calls.whole, 0)
  assert.equal(await pluginTurns.readTurn('s', 3), null)
  assert.equal(calls.whole, 1)
})

test('MVU 提供器检查只读取游玩会话的卡片头字段', async () => {
  const headers = {
    story: { mode: 'story', cardPath: '/cards/a.json' },
    script: { mode: 'script', cardPath: '/cards/b.json' },
    editor: { mode: 'editor', cardPath: '/cards/a.json' }
  }
  const pluginTurns = createPluginTurnReader({
    header: async (sessionId, fields) => { assert.deepEqual(fields, ['cardPath']); return headers[sessionId] },
    recentState: async () => assert.fail('scope check should not read floors'),
    sessionState: async () => assert.fail('scope check should not read full state')
  })
  assert.equal(await pluginTurns.readPlayCardPath('story'), '/cards/a.json')
  assert.equal(await pluginTurns.readPlayCardPath('script'), '/cards/b.json')
  assert.equal(await pluginTurns.readPlayCardPath('editor'), null)
  assert.equal(await pluginTurns.readPlayCardPath('missing'), null)
})
