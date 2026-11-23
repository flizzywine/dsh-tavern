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
