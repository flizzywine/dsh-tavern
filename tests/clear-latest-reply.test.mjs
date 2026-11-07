import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { createMessageDeletion } from '../tavern-plugin/lib/domain/message-deletion.js'
import { createPlayHandlers } from '../tavern-plugin/lib/rpc/play.js'

const model = { kind: 'model', provider: 'fixture', model: 'fixture' }

// 截断场景的两副存档形态：
//   committed —— 部分正文已经入档，尾行是 assistant；
//   orphan    —— 正文没入档，尾行是玩家的未回复输入。
function fixture(kind) {
  const session = Session.create('clear-latest-' + kind + '-' + Math.random().toString(36).slice(2))
  let chat = { id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 1,
    tavernHelperLifecycleRevision: 7, messages: [], nativeCommits: {}, userInputEdits: {}, candidates: null }
  const turns = kind === 'orphan' ? [2, 3] : [2, 3]
  for (const turn of turns) {
    appendSessionEvent(session, 'turn/start', { turn })
    const input = appendSessionEvent(session, 'user/message',
      { id: 'in-' + turn, role: 'user', content: [{ type: 'text', text: '输入' + turn }], source: { kind: 'user', rpcId: 'request-' + turn } },
      { surfaceOp: 'append' })
    chat.messages.push({ role: 'user', text: '输入' + turn })
    chat.userInputEdits[turn] = { text: '输入' + turn, id: 'edit-' + turn, seq: input.seq, role: 'user' }
    const last = turn === 3 && kind === 'orphan'
    if (last) { appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'error', error: { message: '截断' } } }); continue }
    const reply = appendSessionEvent(session, 'assistant/message', { turn, step: 1,
      message: { id: 'out-' + turn, role: 'assistant', content: [{ type: 'text', text: '正文' + turn }], source: model } },
    { surfaceOp: 'append', sourceEventSeqs: [] })
    appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
    chat.messages.push({ role: 'assistant', turn, text: turn === 3 && kind === 'committed' ? '正文3（截断）' : '正文' + turn,
      nativeAnchor: { formatVersion: 4, turn, input: input.seq, reply: reply.seq } })
    chat.nativeCommits[turn] = { turn, userText: '输入' + turn }
  }
  const calls = []
  const agent = { session, phase: { kind: 'idle', lastTurn: 3 } }
  const options = {
    chats: {
      forSession: async () => structuredClone(chat),
      async update(_id, mutate, metadata) {
        calls.push(metadata.source)
        const next = await mutate(structuredClone(chat))
        if (next !== undefined) {
          next._storageRevision = chat._storageRevision + 1
          chat = structuredClone(next)
        }
        return structuredClone(chat)
      }
    },
    sessions: { get: () => agent, flush: async () => {} },
    activity: () => ({ busy: false }),
    view: async () => structuredClone(chat)
  }
  return { session, options, calls,
    get chat() { return chat },
    handlers: () => createPlayHandlers({ str: String,
      reconcileStory: async () => {},
      chatForSession: async () => structuredClone(chat),
      messageDeletion: createMessageDeletion(options),
      rollbackTurn: async (_sessionId, _chatId, turn) => { calls.push(['rollbackTurn', turn]); return { rolledBack: true } },
      notifyPluginTimeline: (...args) => calls.push(args) })
  }
}

function nodeTexts(session) {
  const bySeq = new Map(sessionEvents(session).map(event => [event.seq, event]))
  return session.surface.nodes.map(seq => {
    const event = bySeq.get(seq)
    const content = event?.data?.message?.content || event?.data?.content || []
    return content.map(block => block.text || '').join('')
  })
}

test('清除未完成回复：尾部是截断正文时只删这一条 AI 输出，玩家输入与之前轮次原样保留', async () => {
  const h = fixture('committed')
  const result = await h.handlers().clearLatestReply({ sessionId: h.session.id })
  assert.equal(result.deletedCount, 1)
  assert.deepEqual(h.chat.messages.map(row => row.text), ['输入2', '正文2', '输入3'])
  assert.deepEqual(nodeTexts(h.session), ['输入2', '正文2', '输入3', ''])
})

test('清除未完成回复：尾部是未回复输入时只删上一条 AI 输出，不连删两轮', async () => {
  const h = fixture('orphan')
  const result = await h.handlers().clearLatestReply({ sessionId: h.session.id })
  assert.equal(result.deletedCount, 1)
  assert.deepEqual(h.chat.messages.map(row => row.text), ['输入2', '输入3'])
  assert.deepEqual(nodeTexts(h.session), ['输入2', '', '输入3'])
})

test('清除未完成回复：首轮失败没有正文时只清失败残留，开场白与输入行都不动', async () => {
  const h = fixture('orphan')
  h.chat.messages = [{ role: 'assistant', greeting: true, text: '开场白' }, { role: 'user', text: '输入2' }]
  const result = await h.handlers().clearLatestReply({ sessionId: h.session.id })
  assert.equal(result.deletedCount, 0)
  assert.deepEqual(h.calls.find(call => Array.isArray(call)), ['rollbackTurn', null])
  assert.deepEqual(h.chat.messages.map(row => row.text), ['开场白', '输入2'])
})
