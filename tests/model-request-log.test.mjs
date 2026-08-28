import assert from 'node:assert/strict'
import test from 'node:test'

import { createModelRequestLog } from '../tavern-plugin/lib/domain/model-request-log.js'

function presetMessage(phase, text) {
  return {
    role: 'system',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-tavern', sections: [{ name: 'tavern:runtime-preset-' + phase, text }] }
  }
}

test('逐次保存前后台真实请求，并可按游玩轮次完整读取', async () => {
  const files = new Map()
  const log = createModelRequestLog({
    readJson: async function (path) { return structuredClone(files.get(path)) },
    writeJson: async function (path, value) { files.set(path, structuredClone(value)) },
    updateJson: async function (path, updater) {
      const next = await updater(structuredClone(files.get(path)))
      files.set(path, structuredClone(next))
      return structuredClone(next)
    },
    now: function () { return 1000 },
    id: (function () { let value = 0; return function () { value += 1; return 'request-' + value } })()
  })
  const chat = { id: 'chat-1', requestMode: 'sillytavern', runtimePresetPath: 'presets/demo.json', runtimePresetSnapshot: { digest: 'digest-1' } }
  const longText = '原'.repeat(13000)
  const foreground = await log.record({
    chat,
    context: null,
    coordinates: {
      turn: 2,
      step: 1,
      frame: { frameId: 'foreground:chat-1:branch-1:operation-1', basedOnRevision: 3, append: { appended: true } }
    },
    options: {
      provider: 'test', model: 'scripted', sessionId: 'foreground-1', signal: new AbortController().signal,
      system: '系统提示', tools: [{ name: 'tool-a' }],
      messages: [presetMessage('front', '前'), { role: 'user', content: [{ type: 'text', text: longText }] }, presetMessage('middle', '中'), presetMessage('back', '后')]
    }
  })
  await log.complete({ chatId: 'chat-1', id: foreground.id, text: '完整模型结果', finish: { kind: 'stop' } })
  await log.record({
    chat,
    context: { scope: 'background', task: 'candidate', turn: 2 },
    coordinates: { turn: 7, step: 2 },
    options: { provider: 'test', model: 'scripted', sessionId: 'background-1', messages: [{ role: 'user', content: [{ type: 'text', text: '候选任务' }] }] }
  })

  const evidence = await log.evidence('chat-1', 2)
  assert.equal(evidence.requests.length, 2)
  assert.deepEqual(evidence.requests.map(function (item) { return [item.scope, item.task, item.turn, item.agentTurn, item.step] }), [
    ['foreground', 'reply', 2, 2, 1],
    ['background', 'candidate', 2, 7, 2]
  ])
  assert.equal(evidence.requests[0].request.messages[1].content[0].text.length, 13000)
  assert.equal(Object.prototype.hasOwnProperty.call(evidence.requests[0].request, 'signal'), false)
  assert.equal(evidence.requests[0].requestMode, 'sillytavern')
  assert.equal(evidence.requests[0].frame.frameId, 'foreground:chat-1:branch-1:operation-1')
  assert.equal(evidence.requests[0].frame.append.appended, true)
  assert.equal(evidence.requests[0].status, 'completed')
  assert.equal(evidence.requests[0].response.text, '完整模型结果')
  assert.deepEqual(['front', 'middle', 'back'].map(function (phase) { return evidence.requests[0].phases[phase][0].content[0].text }), ['前', '中', '后'])
  assert.equal((await log.evidence('chat-1', 3)).requests.length, 0)
})
