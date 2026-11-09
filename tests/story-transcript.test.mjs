import test from 'node:test'
import assert from 'node:assert/strict'

import { projectStoryTranscript } from '../tavern-plugin/lib/domain/story-transcript.js'

const summarize = messages => messages.map(({ role, turn, greeting }) => ({ role, turn, greeting }))

// `to` is inclusive, matching native-conversation-storage.readWindow.
const project = (messages, from, to, revision = 1) => projectStoryTranscript({
  chat: { messages: messages.slice(from, to + 1) },
  from,
  to,
  messageCount: messages.length,
  revision
}, summarize(messages))

const fullProject = (messages, revision = 1) => projectStoryTranscript({
  chat: { messages: messages.slice() },
  from: 0,
  to: messages.length - 1,
  messageCount: messages.length,
  revision
})

const rows = projection => projection.messages.map(entry => ({
  absoluteIndex: entry.absoluteIndex,
  key: entry.key,
  legacyTurn: entry.legacyTurn,
  floorNo: entry.floorNo
}))

test('楼层从 1 起、按 assistant 实际顺序，开场不跳过，user 读作 null', () => {
  const greeting = { role: 'assistant', greeting: true, turn: 1, text: '开场' }
  const action = { role: 'user', text: '行动' }
  const reply = { role: 'assistant', turn: 2, text: '正文' }
  const secondOpening = { role: 'assistant', greeting: true, turn: 3, text: '第二幕' }
  const messages = [greeting, action, reply, secondOpening]

  const projection = fullProject(messages, 11)

  assert.equal(projection.source, 'story')
  assert.equal(projection.revision, 11)
  assert.equal(projection.from, 0)
  assert.equal(projection.to, 3)
  assert.equal(projection.messageCount, 4)
  assert.equal(projection.floorCount, 3)
  assert.equal(projection.floorOffset, 0)
  assert.deepEqual(projection.messages.map(entry => entry.floorNo), [1, null, 2, 3])
  assert.deepEqual(projection.messages.map(entry => entry.key), ['turn:1', 'index:1', 'turn:2', 'turn:3'])
  assert.deepEqual(projection.messages.map(entry => entry.legacyTurn), [1, null, 2, 3])
  assert.deepEqual(projection.messages.map(entry => entry.absoluteIndex), [0, 1, 2, 3])
  assert.equal(projection.messages[0].message, greeting)
  assert.equal(projection.messages[3].message, secondOpening)
})

test('空窗口用 from=0,to=-1 投影出 0 楼层且透传 revision', () => {
  const projection = projectStoryTranscript({ chat: { messages: [] }, from: 0, to: -1, messageCount: 0, revision: 'r0' })

  assert.equal(projection.source, 'story')
  assert.equal(projection.revision, 'r0')
  assert.equal(projection.from, 0)
  assert.equal(projection.to, -1)
  assert.equal(projection.floorCount, 0)
  assert.equal(projection.floorOffset, 0)
  assert.deepEqual(projection.messages, [])
})

test('分页投影与全历史楼层一致，重复 turn 跨页也不生成 turn 键', () => {
  const messages = [
    { role: 'assistant', greeting: true, turn: 1, text: '开场' },
    { role: 'user', text: '行动一' },
    { role: 'assistant', turn: 2, text: '正文一' },
    { role: 'user', text: '行动二' },
    { role: 'assistant', turn: 2, text: '正文二' },
    { role: 'user', text: '行动三' },
    { role: 'assistant', turn: 5, text: '正文三' }
  ]

  const first = project(messages, 0, 2)
  const second = project(messages, 3, 4)
  const third = project(messages, 5, 6)

  assert.equal(first.floorCount, 4)
  assert.equal(second.floorCount, 4)
  assert.equal(third.floorCount, 4)
  assert.equal(second.floorOffset, 2)
  assert.equal(third.floorOffset, 3)
  assert.deepEqual(rows(first), [
    { absoluteIndex: 0, key: 'turn:1', legacyTurn: 1, floorNo: 1 },
    { absoluteIndex: 1, key: 'index:1', legacyTurn: null, floorNo: null },
    { absoluteIndex: 2, key: 'index:2', legacyTurn: 2, floorNo: 2 }
  ])
  assert.deepEqual(rows(second), [
    { absoluteIndex: 3, key: 'index:3', legacyTurn: null, floorNo: null },
    { absoluteIndex: 4, key: 'index:4', legacyTurn: 2, floorNo: 3 }
  ])
  assert.deepEqual(rows(third), [
    { absoluteIndex: 5, key: 'index:5', legacyTurn: null, floorNo: null },
    { absoluteIndex: 6, key: 'turn:5', legacyTurn: 5, floorNo: 4 }
  ])
  assert.equal(second.messages[1].message, messages[4])
})

test('稀疏、缺失、重复、非单调 turn 回退到 index 键', () => {
  const messages = [
    { role: 'assistant', turn: 5, text: 'a' },
    { role: 'assistant', text: 'b' },
    { role: 'assistant', turn: 3, text: 'c' },
    { role: 'assistant', turn: 3, text: 'd' },
    { role: 'assistant', turn: 0, text: 'e' },
    { role: 'assistant', turn: '7', text: 'f' },
    { role: 'assistant', turn: 2.5, text: 'g' },
    { role: 'assistant', turn: -1, text: 'h' },
    { role: 'assistant', turn: 5, text: 'i' }
  ]

  const projection = project(messages, 0, 8)

  assert.equal(projection.floorCount, 9)
  assert.deepEqual(projection.messages.map(entry => entry.floorNo), [1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.deepEqual(projection.messages.map(entry => entry.key), [
    'index:0', 'index:1', 'index:2', 'index:3', 'index:4',
    'index:5', 'index:6', 'index:7', 'index:8'
  ])
  assert.deepEqual(projection.messages.map(entry => entry.legacyTurn), [5, null, 3, 3, null, null, null, null, 5])
})

test('独立 user/assistant 行各自投影，floorOffset 只数 from 之前的 assistant', () => {
  const messages = [
    { role: 'user', text: 'a' },
    { role: 'user', text: 'b' },
    { role: 'assistant', turn: 3, text: 'c' },
    { role: 'user', text: 'd' },
    { role: 'assistant', turn: 4, text: 'e' },
    { role: 'assistant', turn: 6, text: 'f' }
  ]

  const projection = project(messages, 3, 5)

  assert.equal(projection.floorCount, 3)
  assert.equal(projection.floorOffset, 1)
  assert.deepEqual(rows(projection), [
    { absoluteIndex: 3, key: 'index:3', legacyTurn: null, floorNo: null },
    { absoluteIndex: 4, key: 'turn:4', legacyTurn: 4, floorNo: 2 },
    { absoluteIndex: 5, key: 'turn:6', legacyTurn: 6, floorNo: 3 }
  ])
})

test('非 user/assistant 角色占位但不占楼层', () => {
  const messages = [
    { role: 'system', turn: 1, text: 'a' },
    { role: 'assistant', turn: 2, text: 'b' },
    { role: 'system', text: 'c' },
    { role: 'assistant', turn: 3, text: 'd' }
  ]

  const projection = fullProject(messages)

  assert.equal(projection.floorCount, 2)
  assert.deepEqual(projection.messages.map(entry => entry.floorNo), [null, 1, null, 2])
  assert.deepEqual(projection.messages.map(entry => entry.key), ['turn:1', 'turn:2', 'index:2', 'turn:3'])
})

test('summaries 与 messageCount/from 不连续或缺项时抛出明确错误', () => {
  const messages = [
    { role: 'assistant', turn: 1, text: 'a' },
    { role: 'user', text: 'b' },
    { role: 'assistant', turn: 2, text: 'c' },
    { role: 'user', text: 'd' }
  ]
  const summaries = summarize(messages)
  const page = (from, to) => ({ chat: { messages: messages.slice(from, to + 1) }, from, to, messageCount: 4, revision: 1 })

  const shortSummaries = summarize(messages).slice(0, 3)
  assert.throws(() => projectStoryTranscript(page(0, 3), shortSummaries), /不连续/)

  const sparse = summarize(messages)
  delete sparse[1]
  assert.throws(() => projectStoryTranscript(page(0, 3), sparse), /缺项/)
  assert.throws(() => projectStoryTranscript(page(0, 3), [summaries[0], null, summaries[2], summaries[3]]), /缺项/)
  assert.throws(() => projectStoryTranscript(page(0, 3), [summaries[0], { turn: 1 }, summaries[2], summaries[3]]), /role/)
  assert.throws(() => projectStoryTranscript(page(0, 3), { length: 4 }), /summaries/)

  assert.throws(() => projectStoryTranscript({ chat: { messages: messages.slice(0, 3) }, from: 0, to: 3, messageCount: 4 }, summaries), /chat\.messages/)
  assert.throws(() => projectStoryTranscript(page(0, 4), summaries), /to/)
  assert.throws(() => projectStoryTranscript(page(0, -2), summaries), /to/)
  assert.throws(() => projectStoryTranscript(page(5, 4), summaries), /from/)
  assert.throws(() => projectStoryTranscript(page(-1, 2), summaries), /from/)
  assert.throws(() => projectStoryTranscript(page(2, 3), undefined), /全历史/)
  assert.throws(() => projectStoryTranscript(page(0, 1), undefined), /全历史/)
  assert.throws(() => projectStoryTranscript({ chat: {}, from: 0, to: 0, messageCount: 0 }), /chat\.messages/)
  assert.throws(() => projectStoryTranscript(undefined, summaries), /window/)
})

test('分页拼接顺序与整页投影逐条一致', () => {
  const messages = [
    { role: 'assistant', greeting: true, turn: 2, text: '开场' },
    { role: 'user', text: '行动一' },
    { role: 'assistant', turn: 4, text: '正文一' },
    { role: 'assistant', turn: 4, text: '正文一改' },
    { role: 'user', text: '行动二' },
    { role: 'assistant', text: '无 turn' },
    { role: 'user', text: '行动三' },
    { role: 'assistant', turn: 9, text: '正文三' }
  ]

  const whole = fullProject(messages, 3)
  const pages = [project(messages, 0, 2, 3), project(messages, 3, 5, 3), project(messages, 6, 7, 3)]
  const stitched = pages.flatMap(projection => projection.messages.map(entry => ({
    absoluteIndex: entry.absoluteIndex,
    key: entry.key,
    legacyTurn: entry.legacyTurn,
    floorNo: entry.floorNo,
    text: entry.message.text
  })))

  const expected = whole.messages.map(entry => ({
    absoluteIndex: entry.absoluteIndex,
    key: entry.key,
    legacyTurn: entry.legacyTurn,
    floorNo: entry.floorNo,
    text: entry.message.text
  }))

  assert.deepEqual(stitched, expected)
  assert.deepEqual(stitched.map(entry => entry.absoluteIndex), [0, 1, 2, 3, 4, 5, 6, 7])
  for (const page of pages) {
    assert.equal(page.messageCount, 8)
    assert.equal(page.revision, 3)
    assert.equal(page.floorCount, whole.floorCount)
  }
  assert.equal(whole.floorCount, 5)
  assert.equal(whole.to, 7)
  assert.equal(stitched[0].key, 'turn:2')
  assert.equal(stitched[7].key, 'turn:9')
  for (const [index, entry] of pages.flatMap(page => page.messages).entries()) {
    assert.equal(entry.message, messages[index])
  }
})
