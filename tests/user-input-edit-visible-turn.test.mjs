import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from './fixtures/client-vm.mjs'
import { sourceFunction } from './fixtures/source-function.mjs'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'
import { planTranscriptRows } from '../tavern-plugin/lib/domain/transcript-row-plan.js'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
function loadClient() {
  const declarations = ['nodeTurn', 'latestTavernUserTurn', 'tavernPlanShowsRow'].map(name => sourceFunction(source, name)).join('\n');
  return vm.runInNewContext(declarations + '\n({ latestTavernUserTurn })');
}

function playTurn(session, turn, text) {
  appendSessionEvent(session, 'turn/start', { turn })
  const user = appendSessionEvent(session, 'user/message', { id: 'u' + turn, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user', rpcId: 'r' + turn } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: '回复' + turn }], source: { kind: 'model', provider: 'f', model: 'f' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
  return user
}
function failedTurn(session, turn, text) {
  appendSessionEvent(session, 'turn/start', { turn })
  appendSessionEvent(session, 'user/message', { id: 'u' + turn, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user', rpcId: 'r' + turn } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: '失败' }], source: { kind: 'model', provider: 'f', model: 'f' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'error' } })
}

test('回退后，编辑入口认的是页面剩下的最后一条输入，不是日志里被藏掉的那条', () => {
  const session = Session.create('user-input-visible-turn')
  playTurn(session, 1, '开始')
  playTurn(session, 2, '第一条输入')
  // A failed turn keeps its append nodes too; the plan hides it after it was cleared.
  failedTurn(session, 6, '失败轮输入')
  const rolledInput = playTurn(session, 10, '被回退的输入')
  const rolledReply = sessionEvents(session).findLast(event => event.type === 'assistant/message')
  replaceSessionSurface(session, 'assistant/message', {
    turn: 11, step: 1,
    message: { id: 'rollback', role: 'assistant', content: [], source: { kind: 'model', provider: 'f', model: 'f' } }
  }, { start: Number(rolledInput.seq), end: Number(rolledReply.seq), sourceEventSeqs: [rolledInput.seq, rolledReply.seq] })
  // What the host keeps: every append message node, including the one on screen no
  // longer because the row plan hides it.
  const nodes = []
  for (const event of sessionEvents(session)) {
    if (event.type === 'user/message' && event.surfaceOp === 'append' && event.data?.source?.kind === 'user') nodes.push({ kind: 'user', seq: event.seq })
    else if (event.type === 'assistant/message' && event.surfaceOp === 'append') nodes.push({ kind: 'assistant', turn: Number(event.data?.turn) })
  }
  const plan = planTranscriptRows({
    chat: { messages: [
      { role: 'assistant', turn: 1, greeting: true },
      { role: 'user' },
      { role: 'assistant', turn: 2 }
    ] },
    events: sessionEvents(session)
  })
  assert.equal(plan['10']?.input, 0, '回退掉的输入行由行计划隐藏')
  assert.equal(plan['6']?.input, 0, '清掉的失败轮输入行同样隐藏')
  const client = loadClient()
  assert.equal(client.latestTavernUserTurn({ legacy: { nodes } }, { turns: plan, from: null }), 2)
  // Without the plan the old scan still walks to the hidden node; the view always
  // carries a plan in play mode, but the helper must not throw on a host without one.
  assert.equal(client.latestTavernUserTurn({ legacy: { nodes } }, null), 10)
})
