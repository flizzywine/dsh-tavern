import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const serverSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const presetSource = await readFile(new URL('../presets/tavern/agent.cordis.yml', import.meta.url), 'utf8')

test('正文直接生成成稿，不再进入第二轮精修', async () => {
  const planner = createContextPlanner({ prompt, callModel: async () => '{"ids":[]}' })
  const context = await planner.plan({
    purpose: 'body',
    card: { name: '阿芙拉', character_book: { entries: [] } },
    chat: { id: 'chat-1', messages: [], guides: [], posture: '' },
    userText: '继续',
    scriptReference: { text: '两人进入钟楼。' }
  })

  assert.doesNotMatch(clientSource, /polish|精修/iu)
  assert.doesNotMatch(serverSource, /polish|精修|draftText|polishedText/iu)
  assert.doesNotMatch(presetSource, /polish|精修|draftText|polishedText/iu)
  assert.doesNotMatch(context.text, /polish|精修|draftText|polishedText/iu)
  assert.match(context.text, /只输出小说正文/)
  assert.match(context.text, /本轮演出指引/)
  assert.match(context.text, /不是已经发生的剧情/)
  assert.doesNotMatch(presetSource, /tavern_session|action=context|action=commit|assistantText/)
  assert.match(serverSource, /agent\/pre-step/)
  assert.match(serverSource, /agent\/turn-stopping/)
})
