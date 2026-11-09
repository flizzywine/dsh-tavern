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
