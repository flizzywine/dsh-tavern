import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertConversationForkable,
  conversationForkReceipt,
  forkConversationChat
} from '../tavern-plugin/lib/domain/conversation-fork.js'

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

test('分叉复制持久游戏状态，但建立独立身份并清理旧运行边界', () => {
  const source = sourceChat()
  const fork = forkConversationChat(source, {
    chatId: 'chat-fork', sessionId: 'session-fork', now: () => 100,
    id: prefix => prefix + '-fork'
  })

  assert.equal(fork.id, 'chat-fork')
  assert.equal(fork.sessionId, 'session-fork')
  assert.equal(fork.timeline.branchId, 'branch-fork')
  assert.equal(fork.timeline.revision, 0)
  assert.deepEqual(fork.timeline.checkpoints, [])
  assert.deepEqual(fork.timeline.participants, {})
  assert.deepEqual(fork.timeline.operations, {})
  assert.equal(fork.posture, '门内')
  assert.deepEqual(fork.messages.at(-1).variables, [{ hp: 9 }])
  assert.deepEqual(fork.tavernPluginData, source.tavernPluginData)
  assert.equal(fork.candidates, null)
  assert.equal(fork.candidateAgent, null)
  assert.deepEqual(fork.nativeCommits, {})
  assert.deepEqual(fork.forkedFrom, {
    chatId: 'chat-source', sessionId: 'session-source', branchId: 'branch-source', revision: 4,
    storageRevision: 17, checkpointId: 'checkpoint-4', forkedAt: 100
  })
  assert.equal(Object.hasOwn(fork, '_storageRevision'), false)
  assert.deepEqual(source, sourceChat(), '源对话保持不变')
})

test('分叉只接受没有前台或后台未完成工作的游玩对话', () => {
  assert.equal(assertConversationForkable(sourceChat()), true)
  assert.throws(() => assertConversationForkable({ ...sourceChat(), mode: 'card' }), /只有游玩对话/)
  assert.throws(() => assertConversationForkable(sourceChat(), { agentRunning: true }), /正文仍在生成/)
  const settling = sourceChat()
  settling.timeline.operations.running = { kind: 'body', status: 'foreground-completed' }
  assert.throws(() => assertConversationForkable(settling), /状态结算/)
  assert.throws(() => assertConversationForkable({
    ...sourceChat(),
    mvu: { enabled: true, openingInitialization: { status: 'pending' } }
  }), /MVU 开局状态尚未初始化完成/)
  const dangling = sourceChat()
  dangling.messages.push({ role: 'user', text: '未完成' })
  assert.throws(() => assertConversationForkable(dangling), /尚未产生正文/)
})

test('分叉提交只返回轻量回执，不把完整 Chat 作为 RPC 响应', () => {
  const chat = sourceChat()
  chat.largePresentation = 'x'.repeat(500_000)

  assert.deepEqual(conversationForkReceipt(chat, { lastTurn: 22, messageCount: 43 }), {
    chatId: 'chat-source',
    sessionId: 'session-source',
    lastTurn: 22,
    messageCount: 43
  })
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
