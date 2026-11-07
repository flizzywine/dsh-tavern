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
const withSurface = (events, nodes) => ({ events, surface: { nodes } })

test('重新生成的轮次映射回剧情轮次，被替换的原回复不再作为目标', () => {
  const events = [start(1, 1), reply(2, 1, 'a'), end(3, 1),
    start(4, 2), reply(5, 2, 'old-2'), end(6, 2),
    start(7, 3), reply(8, 3, 'regen-2'), end(9, 3)]
  assert.deepEqual(forkTurnsByMessageId(session(events), { 2: 3 }), { a: 1, 'regen-2': 2 })
})

test('一轮有多条模型消息时都能找到这一轮，宿主显示的不一定是最后一条 (#234)', () => {
  const events = [start(1, 1), reply(2, 1, 'opening'), end(3, 1),
    start(4, 2), reply(5, 2, 'tool-step'), reply(6, 2, 'visible'), reply(7, 2, 'projection'), end(8, 2)]
  assert.deepEqual(forkTurnsByMessageId(session(events)), { opening: 1, 'tool-step': 2, visible: 2, projection: 2 })
})

// Production shape: the replacement is projected with data.turn=2 (the story
// row's own turn) and source.tavernStoryTurn=2 while the attempt ran in
// lifecycle turn 3; the mapping is { story 2 -> native 3 }. The displaced
// original is still in the log.
test('重生成后分叉目标只落到剧情轮次 2，候选 lifecycle 3 与旧原始事件都不出现', () => {
  const events = [start(1, 1), reply(2, 1, 'a'), end(3, 1),
    start(4, 2), reply(5, 2, 'old-2'), end(6, 2),
    start(7, 3), reply(8, 3, 'candidate-3'), end(9, 3),
    replacement(10, 2, 'regen-2', 2, [5])]
  const targets = forkTurnsByMessageId(session(events), { 2: 3 })
  assert.deepEqual(targets, { a: 1, 'regen-2': 2 })
  assert.ok(!Object.values(targets).includes(3), 'lifecycle turn 3 不能当故事轮次')
})

test('分叉键跟随可见转录行：不可见的旧副本不参与，可见的替换投影生效', () => {
  // 重放出来的转录副本住在编辑轮次 3，但属于故事 2；替换投影随后取代它。
  const copy = tagged(8, 3, 'copy-2', 2, { surfaceOp: 'append' })
  const events = [start(1, 1), reply(2, 1, 'opening'), end(3, 1),
    start(4, 2), reply(5, 2, 'old-2'), end(6, 2),
    start(7, 3), copy, end(9, 3),
    replacement(10, 3, 'regen-2', 2, [5, 8])]
  assert.deepEqual(forkTurnsByMessageId(withSurface(events, [2, 10])), { opening: 1, 'regen-2': 2 })
})

test('storyByNative 映射之外的旧生命周期轮次不会冒充故事轮次', () => {
  // 第二轮重生成把故事 2 挪到 lifecycle 4，失败的候选 3 仍留在记录里。
  const events = [start(1, 1), reply(2, 1, 'a'), end(3, 1),
    start(4, 2), reply(5, 2, 'old-2'), end(6, 2),
    start(7, 3), reply(8, 3, 'candidate-3'), end(9, 3),
    start(10, 4), reply(11, 4, 'regen-2'), end(12, 4),
    replacement(13, 2, 'regen-2b', 2, [5, 8, 11])]
  assert.deepEqual(forkTurnsByMessageId(session(events), { 2: 4 }), { a: 1, 'regen-2b': 2 })
})
