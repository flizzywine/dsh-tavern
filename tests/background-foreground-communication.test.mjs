import assert from 'node:assert/strict'
import test from 'node:test'

import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { createForegroundHandoff } from '../tavern-plugin/lib/domain/foreground-handoff.js'
import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'

test('后台先提交领域快照，前台下一轮只读取世界书与结算结果', async () => {
  const order = []
  const chat = {
    id: 'chat-1',
    mode: 'story',
    messages: [{ role: 'assistant', text: '雨夜。', greeting: true }],
    posture: '',
    preparedWorldBookContext: '',
    guides: [],
    candidates: { raw: '候选 Agent 原始输出不得进入正文上下文' },
    lastSettle: { raw: '结算 Agent 原始 JSON 不得进入正文上下文' }
  }
  const planner = createContextPlanner({ prompt })
  const handoff = createForegroundHandoff({
    turns: {
      async prepare(input) {
        order.push('foreground')
        return await planner.plan({
          purpose: 'body',
          card: { name: '阿芙拉' },
          chat,
          userText: input.userText,
          sessionId: input.sessionId,
          nativeTurn: input.turn,
          scriptReference: null,
          worldBookContext: chat.preparedWorldBookContext
        })
      },
      async finalize() {},
      async discard() {}
    },
    store: { async chatForSession() { return chat } },
    tasks: { activity() { return { phase: 'pending', busy: false, role: 'worldbook' } } },
    async queueBackground() {
      order.push('background')
      chat.preparedWorldBookContext = '钟楼只在午夜开放。'
      chat.posture = '阿芙拉站在门边，右手握剑。'
    },
    logger: { error() {} }
  })

  const prepared = await handoff.prepare({ sessionId: 'session-1', turn: 2, userText: '进入钟楼' })

  assert.deepEqual(order, ['background', 'foreground'])
  assert.match(prepared.text, /钟楼只在午夜开放/)
  assert.match(prepared.text, /阿芙拉站在门边，右手握剑/)
  assert.doesNotMatch(prepared.text, /候选 Agent 原始输出/)
  assert.doesNotMatch(prepared.text, /结算 Agent 原始 JSON/)
})
