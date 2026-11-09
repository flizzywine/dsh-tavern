import assert from 'node:assert/strict'
import test from 'node:test'
import { forkTurnsByMessageId } from '../tavern-plugin/lib/domain/conversation-fork-targets.js'

const start = (seq, turn) => ({ type: 'turn/start', seq, data: { turn } })
const end = (seq, turn, kind = 'completed') => ({ type: 'turn/end', seq, data: { turn, reason: { kind } } })
const reply = (seq, turn, id, kind = 'model') => ({ type: 'assistant/message', seq, data: { turn, message: { id, source: { kind } } } })
const tagged = (seq, turn, id, story, extra = {}) => ({ type: 'assistant/message', seq, ...extra,
  data: { turn, step: 1, message: { id, content: [{ type: 'text', text: '正文' }], source: { kind: 'model', tavernStoryTurn: story } } } })
// A regeneration replacement keeps the old reply's place and shadows the seqs it displaced.
const replacement = (seq, turn, id, story, shadowed) => tagged(seq, turn, id, story,
  { surfaceOp: { op: 'replace', start: 5, end: 5 }, sourceEventSeqs: shadowed })
const session = events => ({ events })

test('storyByNative 映射之外的旧生命周期轮次不会冒充故事轮次', () => {
  // 第二轮重生成把故事 2 挪到 lifecycle 4，失败的候选 3 仍留在记录里。
  const events = [start(1, 1), reply(2, 1, 'a'), end(3, 1),
    start(4, 2), reply(5, 2, 'old-2'), end(6, 2),
    start(7, 3), reply(8, 3, 'candidate-3'), end(9, 3),
    start(10, 4), reply(11, 4, 'regen-2'), end(12, 4),
    replacement(13, 2, 'regen-2b', 2, [5, 8, 11])]
  assert.deepEqual(forkTurnsByMessageId(session(events), { 2: 4 }), { a: 1, 'regen-2b': 2 })
})
