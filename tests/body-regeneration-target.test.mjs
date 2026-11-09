import assert from 'node:assert/strict'
import test from 'node:test'
import * as surface from '../tavern-plugin/lib/domain/rollback-surface.js'

import { selectRegenerationTarget } from '../tavern-plugin/lib/domain/round-history.js'
const model = { kind: 'model', provider: 'test', model: 'test-model' }
const assistant = (seq, turn, source = model, content = [{ type: 'text', text: '正文' }]) => ({ seq, type: 'assistant/message', data: { turn, step: 1, message: { role: 'assistant', source, content } } })
const cleanup = (seq, turn) => assistant(seq, turn, { kind: 'plugin', plugin: 'dsh-tavern-failed-turn-cleanup' }, [])
test('没有非问候助手时才拒绝；前一条不是玩家输入不再是拒绝理由', () => {
  let evidence
  assert.throws(() => selectRegenerationTarget({ messages: [{ role: 'assistant', greeting: true }] }, { events: [], surface: { nodes: [] } }, value => { evidence = value }), /没有可重新生成的正文/)
  assert.equal(evidence.reason, 'no-non-greeting-assistant')
  // 尾巴是 [助手, 助手]（被撤回的输入、修复轮）时不再因"缺配对"拒绝；
  // 消息面上没有这一轮的正文也不再拒绝：没有旧正文可替换，就按补写处理。
  let second
  const messages = [{ role: 'assistant', turn: 5, text: '上一轮' }, { role: 'assistant', turn: 7, text: '这一轮' }]
  const selection = selectRegenerationTarget({ messages }, { events: [], surface: { nodes: [] } }, value => { second = value })
  assert.equal(second.reason, 'save-only')
  assert.equal(selection.saveOnly, true)
  assert.equal(selection.oldSeq, null)
  assert.equal(selection.oldTurn, 7)
})
