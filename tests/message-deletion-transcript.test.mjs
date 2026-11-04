import test from 'node:test'
import assert from 'node:assert/strict'
import { createTranscriptFold, planTranscriptRows } from '../tavern-plugin/lib/domain/transcript-row-plan.js'

const model = { kind: 'model', provider: 'test', model: 'test' }
const mark = (seq, type, turn) => ({ seq, type, data: { turn, step: 1, reason: { kind: 'completed' } } })
const input = seq => ({ seq, type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: [{ type: 'text', text: '输入' }], source: { kind: 'user' } } })
const reply = (seq, turn) => ({ seq, type: 'assistant/message', surfaceOp: 'append', data: { turn, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '正文' }], source: model } } })
const round = (seq, turn) => [mark(seq, 'turn/start', turn), input(seq + 1), reply(seq + 2, turn), mark(seq + 3, 'step/end', turn), mark(seq + 4, 'turn/end', turn)]
const floors = turns => turns.flatMap(turn => [{ role: 'user' }, { role: 'assistant', turn }])
const plain = plan => Object.fromEntries(Object.keys(plan).map(key => [key, plan[key]]))

const events = [...round(0, 1), ...round(5, 2)]
const save = floors([1, 2])
const cases = [
  ['只删第一轮输入', [save[1], save[2], save[3]], { 1: { input: 0, reply: 1 } }],
  ['只删第一轮正文', [{ ...save[0], turn: 1 }, save[2], save[3]], { 1: { input: 1, reply: 0 } }],
  ['跨轮删除输入和另一轮正文', [save[1], { ...save[2], turn: 2 }], {
    1: { input: 0, reply: 1 }, 2: { input: 1, reply: 0 }
  }]
]

for (const [name, messages, expected] of cases) test(name, () => {
  assert.deepEqual(plain(planTranscriptRows({ chat: { messages }, events })), expected)
  const fold = createTranscriptFold()
  fold.setFloors(0, save)
  fold.addEvents(events)
  fold.result()
  fold.setFloors(0, messages)
  assert.deepEqual(plain(fold.result()), expected, '增量行计划应与全量重算一致')
})
