import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorldbookPrefilter } from '../tavern-plugin/lib/domain/worldbook-prefilter.js'

test('同一对话再次预筛会取消上一轮；取消没有在运行的预筛不报错', async () => {
  const runs = []
  const prefilter = createWorldbookPrefilter({ logger: { warn() {} }, async run(chatId, signal) {
    runs.push(signal)
    await new Promise(resolve => setTimeout(resolve, 5))
  } })
  const first = prefilter.start('chat-1')
  const second = prefilter.start('chat-1')
  await Promise.all([first, second])
  assert.equal(runs.length, 1, '被取代的预筛不会开始')
  assert.equal(await prefilter.cancel('chat-1'), false)
})
