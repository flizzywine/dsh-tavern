import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { synchronizeTemplateHistory } from '../tavern-plugin/lib/domain/template-history.js'
import { userMessageForTurn, requestIdForTurn } from '../tavern-plugin/lib/domain/session-turn-input.js'

const input = (id, text, rpcId) => ({ id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user', rpcId } })
const reply = (id, turn, text) => ({ turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'test', model: 'test' } } })

// #196: a prompt template rewrote an earlier saved input; the native copy is
// synchronised in the next turn's pre-step, i.e. after that turn has started.
test('上一轮输入的模板改写同步写在新一轮开始之后，新一轮仍取到本轮玩家输入（#196）', async () => {
  const session = Session.create('turn-input')
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  appendSessionEvent(session, 'user/message', input('in-1', '原始输入', 'rpc-1'), { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', reply('out-1', 1, '第一轮正文'), { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  const chat = { messages: [{ role: 'user', text: '模板改写后的输入', templateInputSource: '原始输入' }, { role: 'assistant', text: '第一轮正文' }] }
  appendSessionEvent(session, 'turn/start', { turn: 2 })
  await synchronizeTemplateHistory(session, chat, async () => {})
  appendSessionEvent(session, 'user/message', input('in-2', '第二轮输入', 'rpc-2'), { surfaceOp: 'append' })
  assert.equal(userMessageForTurn(session, 2).content[0].text, '第二轮输入')
  assert.equal(requestIdForTurn(session, 2), 'rpc-2')
})

test('重新生成时模板改写同步落在本次尝试中，不会被当成新的玩家输入而截断尝试或阻止撤销（#196）', async () => {
  const { planRegenerationSurface } = await import('../tavern-plugin/lib/domain/rollback-surface.js')
  const { sessionEvents } = await import('../tavern-plugin/lib/domain/session-events.js')
  const session = Session.create('regen-template-edit')
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  appendSessionEvent(session, 'user/message', input('in-1', '原始输入', 'rpc-1'), { surfaceOp: 'append' })
  const old = appendSessionEvent(session, 'assistant/message', reply('out-1', 1, '第一轮正文'), { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  const eventStart = sessionEvents(session).length
  appendSessionEvent(session, 'turn/start', { turn: 2 })
  await synchronizeTemplateHistory(session, { messages: [{ role: 'user', text: '模板改写后的输入', templateInputSource: '原始输入' }, { role: 'assistant', text: '第一轮正文' }] }, async () => {})
  appendSessionEvent(session, 'user/message', { id: 'regen', role: 'user', content: [{ type: 'text', text: '原始输入' }], source: { kind: 'plugin', plugin: 'dsh-tavern-regen' } }, { surfaceOp: 'append' })
  const fresh = appendSessionEvent(session, 'assistant/message', reply('new', 2, '新正文'), { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/end', { turn: 2, reason: { kind: 'completed' } })
  const plan = planRegenerationSurface({ events: sessionEvents(session), nodes: session.surface.nodes, oldAssistantSeq: old.seq, eventStart })
  assert.equal(plan.finalAssistantSeq, fresh.seq)
})

test('找出模型看过、存档却没记下的已完成轮次；回退、失败、重新生成的轮次不算（#196 自愈）', async () => {
  const { uncommittedRounds } = await import('../tavern-plugin/lib/domain/uncommitted-rounds.js')
  const { replaceSessionSurface } = await import('../tavern-plugin/lib/domain/session-surface-mutations.js')
  const session = Session.create('uncommitted')
  const round = (turn, text, rpcId, reason = 'completed') => {
    appendSessionEvent(session, 'turn/start', { turn })
    appendSessionEvent(session, 'user/message', input('in-' + turn, text, rpcId), { surfaceOp: 'append' })
    const out = appendSessionEvent(session, 'assistant/message', reply('out-' + turn, turn, text + '的回复'), { surfaceOp: 'append' })
    appendSessionEvent(session, 'turn/end', { turn, reason: { kind: reason } })
    return out
  }
  round(1, '第一轮', 'rpc-1')
  round(2, '第二轮', 'rpc-2')
  round(3, '失败的一轮', 'rpc-3', 'error')
  round(4, '漏记的一轮', 'rpc-4')
  const rolled = round(5, '已回退的一轮', 'rpc-5')
  replaceSessionSurface(session, 'assistant/message', { turn: 5, step: 1, message: { id: 'tomb', role: 'assistant', content: [], source: { kind: 'model', provider: 'test', model: 'test' } } }, { start: rolled.seq, end: rolled.seq, sourceEventSeqs: [rolled.seq] })
  round(6, '重新生成的合成轮', 'rpc-6')
  const header = { nativeCommits: { 1: { turn: 1 }, 2: { turn: 2 } }, suppressedDshTurns: [6] }
  assert.deepEqual(uncommittedRounds(session, header).map(item => [item.turn, item.requestId, item.userText, item.assistantText]), [[4, 'rpc-4', '漏记的一轮', '漏记的一轮的回复']])
  assert.deepEqual(uncommittedRounds(session, { nativeCommits: {} }), [], 'saves without commit records are left alone')
})

test('输入来源只在一处判定：玩家、重新生成、旧版重放；替换记录永远不算新输入', async () => {
  const { inputKind, isNewTurnInput, isNewPlayerInput, requestIdOf, requestIdForMessages } = await import('../tavern-plugin/lib/domain/session-turn-input.js')
  const player = input('p', '玩家', 'rpc-9'), regen = { source: { kind: 'plugin', plugin: 'dsh-tavern-regen' } }, replay = { source: { kind: 'plugin', plugin: 'dsh-tavern-replay' } }
  assert.deepEqual([player, regen, replay, { source: { kind: 'plugin', plugin: 'dsh-tavern' } }, {}].map(inputKind), ['player', 'regenerate', 'replay', null, null])
  assert.equal(isNewPlayerInput({ type: 'user/message', data: player, surfaceOp: 'append' }), true)
  assert.equal(isNewTurnInput({ type: 'user/message', data: player, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 } }), false)
  assert.equal(isNewPlayerInput({ type: 'user/message', data: regen, surfaceOp: 'append' }), false)
  assert.equal(requestIdOf(player), 'rpc-9')
  assert.equal(requestIdOf(regen), '')
  assert.equal(requestIdForMessages([input('a', '旧', 'rpc-1'), player]), 'rpc-9')
})
