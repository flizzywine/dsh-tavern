// 消息面上没有这一轮的正文时，重新生成不再拒绝：认轮只看存档，落位改成补写。
// 典型来源：一次被截断的重新生成，正文进了存档但没能落到模型视野，随后被清理摘掉。
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { selectRegenerationTarget } from '../tavern-plugin/lib/domain/round-history.js'

after(() => { for (const session of Session.list ?? []) session.close?.() })

const model = { kind: 'model', provider: 'test', model: 'test' }
const message = (id, role, text, source = model) => ({ id, role, content: [{ type: 'text', text }], source })

test('先前正文已被其他存档行认领时，目标正文缺失仍可补写', () => {
  const session = Session.create('save-only-previous-claimed')
  appendSessionEvent(session, 'assistant/message', { turn: 2, step: 1,
    message: message('previous-body', 'assistant', '上一轮正文') }, { surfaceOp: 'append' })
  const chat = { messages: [
    { role: 'user', text: '上一轮输入' }, { role: 'assistant', turn: 2, text: '上一轮正文' },
    { role: 'user', text: '这一轮输入' }, { role: 'assistant', turn: 8, text: '缺失正文' }
  ] }
  const selection = selectRegenerationTarget(chat, session)
  assert.equal(selection.saveOnly, true)
  assert.equal(selection.oldTurn, 8)
})
