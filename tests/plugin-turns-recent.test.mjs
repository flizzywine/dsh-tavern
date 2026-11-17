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

test('readTurnState 单趟只读 settleStatus 与 scene key，不加载预设快照也不解析人物卡正则', async () => {
  let recentCalls = 0
  let headerFieldsRequested = []
  let sceneCalls = 0
  const pluginTurns = createPluginTurnReader({
    sessionState: async () => { throw new Error('不得整档读取') },
    recentState: async () => {
      recentCalls += 1
      return {
        id: 'c1',
        sessionId: 's1',
        mode: 'story',
        messagesFrom: 10,
        messages: [{ role: 'user' }, { role: 'assistant', turn: 6, mvu: { pending: false } }]
      }
    },
    sceneState: async (_id, turns) => {
      sceneCalls += 1
      return {
        id: 'c1',
        mode: 'story',
        sceneTargets: { [turns[0]]: { key: 'ver-6', turn: turns[0], swipeId: 0, sourceDigest: 'dig-6', source: '正文' } }
      }
    },
    header: async (_id, fields) => {
      headerFieldsRequested.push(fields)
      return { settleStatus: 'done' }
    },
    regexScripts: async () => { throw new Error('readTurnState 不得解析人物卡与预设正则') },
    slice: async () => null,
    fullChat: async () => null,
    readChatCard: async () => null
  })

  const summary = await pluginTurns.readTurnState('s1')
  assert.deepEqual(summary, { sessionId: 's1', turn: 6, key: 'ver-6', greeting: false, settled: true })
  assert.equal(recentCalls, 1)
  assert.equal(sceneCalls, 1)
  assert.deepEqual(headerFieldsRequested, [['settleStatus']])
})
