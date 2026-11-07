import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { sessionEvents, appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { assistantResultForTurn } from '../tavern-plugin/lib/domain/session-turn-result.js'
import { uncommittedRounds } from '../tavern-plugin/lib/domain/uncommitted-rounds.js'
import { findBodyRegenerationFrame } from '../tavern-plugin/lib/domain/body-regeneration-materials.js'

const model = () => ({ kind: 'model', provider: 'test', model: 'test' })

test('投影写回的正文把剧情轮号记在 message.source 上，按宿主轮号也要能取到正文', () => {
  const session = Session.create('turn-numbering')
  session.append('turn/start', { turn: 4 })
  session.append('user/message', { id: 'input', role: 'user', content: [{ type: 'text', text: '输入' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', {
    turn: 4, step: 1,
    message: { id: 'copy', role: 'assistant', content: [{ type: 'text', text: '修复写回的正文' }],
      source: { ...model(), tavernStoryTurn: 9 } }
  }, { surfaceOp: 'append' })

  const byHostTurn = assistantResultForTurn(session, 4)
  const byStoryTurn = assistantResultForTurn(session, 9)
  assert.equal(byHostTurn?.text, '修复写回的正文')
  assert.equal(byStoryTurn?.text, '修复写回的正文')
})

test('映射缺位时按帧上记着的剧情轮号找到重生成材料，而不是拿剧情号当宿主号', () => {
  const chat = {
    id: 'chat', messages: [], timeline: { branchId: 'b' },
    foregroundFrames: {
      a: { kind: 'foreground', turn: 11, storyTurn: 3, chatId: 'chat', branchId: 'b' },
      b: { kind: 'foreground', turn: 12, chatId: 'chat', branchId: 'b' }
    }
  }
  assert.equal(findBodyRegenerationFrame(chat, 3)?.storyTurn, 3)
  assert.equal(findBodyRegenerationFrame({ ...chat, regeneratedDshTurns: { 3: 12 } }, 3)?.turn, 12)
})

test('未提交回合按映射把宿主轮号换回剧情轮号再比上界', () => {
  const session = Session.create('uncommitted-inverse')
  session.append('turn/start', { turn: 20 })
  session.append('user/message', { id: 'in', role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 20, step: 1,
    message: { id: 'reply', role: 'assistant', content: [{ type: 'text', text: '正文' }], source: model() } }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 20, reason: { kind: 'completed' } })
  const header = { nativeCommits: { 3: { turn: 3, userText: '上一轮' } }, regeneratedDshTurns: { 5: 20 } }
  // 第 20 号宿主轮就是剧情第 5 轮，已经提交过，不该被当成漏存回合。
  assert.deepEqual(uncommittedRounds(session, header), [])
})
