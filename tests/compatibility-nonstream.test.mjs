import assert from 'node:assert/strict'
import test from 'node:test'

import { createCompatibilityNonStreamingTransport } from '../tavern-plugin/lib/domain/compatibility-nonstream.js'

test('兼容模式向 Infron 发送非流式请求并保持现有 DSH 参数', async () => {
  let captured
  const stream = createCompatibilityNonStreamingTransport({
    baseURL: 'https://llm.onerouter.pro/v1/',
    apiKey: function () { return 'secret' },
    fetch: async function (url, request) {
      captured = { url, request, body: JSON.parse(request.body) }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [{ message: { role: 'assistant', content: '完整回复' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
          }
        }
      }
    }
  })
  const chunks = []
  for await (const chunk of stream({
    model: 'google/gemini-3.7-flash',
    maxTokens: 64000,
    messages: [{ role: 'user', content: [{ type: 'text', text: '继续' }] }]
  })) chunks.push(chunk)

  assert.equal(captured.url, 'https://llm.onerouter.pro/v1/chat/completions')
  assert.deepEqual(captured.body, {
    model: 'google/gemini-3.7-flash',
    messages: [{ role: 'user', content: '继续' }],
    stream: false,
    max_completion_tokens: 64000
  })
  assert.equal(captured.request.headers.Authorization, 'Bearer secret')
  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '完整回复' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '完整回复' } },
    { type: 'usage', usage: { inputTokens: 11, outputTokens: 7 } },
    { type: 'finish', reason: { kind: 'stop' } }
  ])
})

test('非流式兼容传输保留供应商错误而不伪装成功', async () => {
  const stream = createCompatibilityNonStreamingTransport({
    baseURL: 'https://llm.onerouter.pro/v1',
    apiKey: function () { return 'secret' },
    fetch: async function () {
      return { ok: false, status: 403, async json() { return { error: { message: 'flagged' } } } }
    }
  })
  await assert.rejects(async function () {
    for await (const chunk of stream({ model: 'model', messages: [] })) void chunk
  }, /非流式模型请求失败 \(403\): flagged/)
})
