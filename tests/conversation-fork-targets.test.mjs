import assert from 'node:assert/strict'
import test from 'node:test'
import { forkTurnsByMessageId } from '../tavern-plugin/lib/domain/conversation-fork-targets.js'

const start = (seq, turn) => ({ type: 'turn/start', seq, data: { turn } })
const end = (seq, turn, kind = 'completed') => ({ type: 'turn/end', seq, data: { turn, reason: { kind } } })
const reply = (seq, turn, id, kind = 'model') => ({ type: 'assistant/message', seq, data: { turn, message: { id, source: { kind } } } })
const session = events => ({ events })

test('重新生成的轮次映射回剧情轮次，被替换的原回复不再作为目标', () => {
  const events = [start(1, 1), reply(2, 1, 'a'), end(3, 1),
    start(4, 2), reply(5, 2, 'old-2'), end(6, 2),
    start(7, 3), reply(8, 3, 'regen-2'), end(9, 3)]
  assert.deepEqual(forkTurnsByMessageId(session(events), { 2: 3 }), { a: 1, 'regen-2': 2 })
})

test('只有最近 50 轮显示分叉按钮', () => {
  const events = []
  for (let turn = 1, seq = 1; turn <= 60; turn++) events.push(start(seq++, turn), reply(seq++, turn, 'm' + turn), end(seq++, turn))
  const turns = Object.values(forkTurnsByMessageId(session(events))).sort((a, b) => a - b)
  assert.equal(turns[0], 11)
  assert.equal(turns.at(-1), 60)
  assert.equal(turns.length, 50)
})
