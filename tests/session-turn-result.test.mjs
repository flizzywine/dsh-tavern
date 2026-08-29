import assert from 'node:assert/strict'
import test from 'node:test'

import { assistantResultForTurn } from '../tavern-plugin/lib/domain/session-turn-result.js'

test('模型只返回 reasoning 时保留明确的无正文判定', () => {
  const session = {
    events: [
      { seq: 1, type: 'turn/start', data: { turn: 7 } },
      {
        seq: 2,
        type: 'assistant/message',
        data: {
          turn: 7,
          message: {
            role: 'assistant',
            content: [{ type: 'reasoning', text: '正在组织正文。' }],
            source: { kind: 'model', provider: 'test', model: 'reasoning-model' }
          }
        }
      }
    ]
  }

  const result = assistantResultForTurn(session, 7)
  assert.equal(result.text, '')
  assert.equal(result.reasoningOnly, true)
  assert.equal(result.reasoningText, '正在组织正文。')
})

test('模型返回正文时以 text 为最终回复', () => {
  const session = {
    events: [
      { seq: 1, type: 'turn/start', data: { turn: 2 } },
      {
        seq: 2,
        type: 'assistant/message',
        data: {
          turn: 2,
          message: {
            role: 'assistant',
            content: [
              { type: 'reasoning', text: '先思考。' },
              { type: 'text', text: '雨水扑进房间。' }
            ],
            source: { kind: 'model', provider: 'test', model: 'model' }
          }
        }
      }
    ]
  }

  const result = assistantResultForTurn(session, 2)
  assert.equal(result.text, '雨水扑进房间。')
  assert.equal(result.reasoningOnly, false)
})
