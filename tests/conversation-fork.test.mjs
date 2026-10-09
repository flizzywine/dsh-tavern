import assert from 'node:assert/strict'
import test from 'node:test'
import { assertConversationForkable } from '../tavern-plugin/lib/domain/conversation-fork.js'

function sourceChat() {
  return {
    id: 'chat-source', sessionId: 'session-source', cardPath: 'cards/a.json', cardName: '阿青', mode: 'story',
    _storageRevision: 17, createdAt: 1, updatedAt: 2, settleStatus: 'done', settleError: null,
    messages: [
      { role: 'assistant', greeting: true, turn: 1, text: '开场' },
      { role: 'user', text: '进门' },
      { role: 'assistant', turn: 2, text: '她抬起头。', variables: [{ hp: 9 }] }
    ],
    posture: '门内', worldBookReads: { gate: 2 }, tavernPluginData: { phone: { chats: ['保留'] } },
    candidates: { items: ['旧候选'] }, candidateAgent: { sessionId: 'background-old' },
    nativeCommits: { 2: { old: true } }, suppressedDshTurns: [9], regeneratedDshTurns: { 2: 9 },
    timeline: {
      schemaVersion: 1, branchId: 'branch-source', revision: 4,
      checkpoints: [{ id: 'checkpoint-4', beforeRevision: 12 }],
      participants: { background: { sessionId: 'background-old', lifetime: 'chat' } },
      operations: { completed: { id: 'completed', kind: 'body', status: 'completed' } }
    }
  }
}

test('分叉只接受没有前台或后台未完成工作的游玩对话', () => {
  assert.equal(assertConversationForkable(sourceChat()), true)
  assert.throws(() => assertConversationForkable({ ...sourceChat(), mode: 'card' }), /只有游玩对话/)
  assert.throws(() => assertConversationForkable(sourceChat(), { agentRunning: true }), /正文仍在生成/)
  const settling = sourceChat()
  settling.timeline.operations.running = { kind: 'body', status: 'completed', background: { phase: 'pending' } }
  assert.throws(() => assertConversationForkable(settling), /状态结算/)
  assert.throws(() => assertConversationForkable({
    ...sourceChat(),
    mvu: { enabled: true, openingInitialization: { status: 'pending' } }
  }), /MVU 开局状态尚未初始化完成/)
  const dangling = sourceChat()
  dangling.messages.push({ role: 'user', text: '未完成' })
  assert.throws(() => assertConversationForkable(dangling), /尚未产生正文/)
})

test('分叉运行链路复用 DSH 原生 Session，不在 Tavern 后端重放完整历史', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8'))
  const start = source.indexOf('async function forkChat(')
  const end = source.indexOf('\n  const runtimePresetSnapshots', start)
  const flow = source.slice(start, end)

  assert.ok(start >= 0 && end > start)
  assert.doesNotMatch(flow, /appendForkedConversation|sessionStore\.flush|ensureSessionStablePrefix/)
  assert.match(flow, /conversationRegistry\.publish\(fork\)/)
})

test('分叉只保留分叉点及之前的隐藏轮次记录：分叉后续用的原生轮号不会把新回复整轮隐藏', async () => {
  const { forkConversationChat } = await import('../tavern-plugin/lib/domain/conversation-fork.js')
  const { foregroundSuppressedTurns } = await import('../tavern-plugin/lib/domain/rollback-surface.js')
  // Native turns 1–3 existed; turn 3 was rolled back, an aborted regeneration left 5,
  // and turn 2 was regenerated into synthetic turn 4.
  const source = { ...sourceChat(), suppressedDshTurns: [3, 4, 5], hiddenDshErrorTurns: [2, 5], regeneratedDshTurns: { 2: 4, 3: 5 } }
  const fork = forkConversationChat(source, { chatId: 'chat-fork', sessionId: 'session-fork', id: prefix => prefix + '-x', lastNativeTurn: 4 })
  assert.deepEqual(fork.suppressedDshTurns, [3, 4])
  assert.deepEqual(fork.hiddenDshErrorTurns, [2])
  assert.deepEqual(fork.regeneratedDshTurns, { 2: 4 })
  assert.deepEqual(source.suppressedDshTurns, [3, 4, 5], 'the source game is untouched')
  let seq = 0
  const event = (type, data) => ({ seq: seq++, type, data })
  const reply = turn => event('assistant/message', { turn, message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'NEW' }] } })
  const events = [5].flatMap(turn => [event('turn/start', { turn }), reply(turn), event('turn/end', { turn, reason: { kind: 'completed' } })])
  assert.equal(foregroundSuppressedTurns(fork, events).includes(5), false, 'the fork\'s next native turn 5 shows its reply')
  const unpruned = forkConversationChat(source, { chatId: 'chat-old', sessionId: 'session-old', id: prefix => prefix + '-x' })
  assert.equal(foregroundSuppressedTurns(unpruned, events).includes(5), true, 'without the fork point the stale entry would hide it')
})
