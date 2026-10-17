import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
const storyRules = readFileSync(new URL('../tavern-plugin/prompts/story.md', import.meta.url), 'utf8')
const framePlan = await createContextPlanner({ prompt: () => storyRules }).plan({purpose:'body',card:{},chat:{}})

import assert from 'node:assert/strict'

import { parseChatHistory } from '../tavern-plugin/lib/domain/chat-history-import.js'
import { buildImportedConversation } from '../tavern-plugin/lib/domain/chat-history-session.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { cardSystemPromptText } from '../tavern-plugin/lib/domain/card-system-prompt.js'

const timeline = createStoryTimeline()
function plan() {
  const text = [{ chat_metadata: {} }, { is_user: false, mes: 'opening', variables: [{stat_data:{hp:10}}] },
    { is_user: true, mes: 'walk' }, { is_user: false, mes: 'arrived', variables: [{stat_data:{hp:9}}] },
    { is_user: true, mes: 'rest' }, { is_user: false, mes: 'rested', variables: [{stat_data:{hp:12}}] }].map(JSON.stringify).join('\n')
  const chat = timeline.apply({ chat: { id:'chat', messages:[], scriptState:null, mvu:{enabled:true,owner:'official',runtime:'magvarupdate'} }, intent:{kind:'ensure'} }).chat
  return buildImportedConversation(chat, parseChatHistory(text), {operationId:'import-test',framePlan})
}

test('successive rollback restores selected MVU states without storage-history snapshots', async () => {
  let chat=(await plan()).chat
  for (const checkpoint of chat.timeline.checkpoints) {
    checkpoint.before = { ...checkpoint.importBefore, messages: structuredClone(chat.messages.slice(0, checkpoint.importMessageCount)) }
    delete checkpoint.importBefore; delete checkpoint.importMessageCount
  }
  chat=timeline.apply({chat,intent:{kind:'turn.rollback',turn:3}}).chat
  assert.equal(chat.messages.at(-1).text,'arrived')
  assert.equal(chat.messages.at(-1).variables[0].stat_data.hp,9)
  chat=timeline.apply({chat,intent:{kind:'turn.rollback',turn:2}}).chat
  assert.equal(chat.messages.length,1)
  assert.equal(chat.messages[0].variables[0].stat_data.hp,10)
  assert.equal(chat.timeline.participants.background.status,'needs-session')
})

test('导入历史以开局系统指令为基线，动态变化与恢复仅追加一次完整版本', async () => {
  const planner = createContextPlanner({ prompt: () => '正文规则' })
  const card = { name: '角色', system_prompt: '天气：{{getvar::weather}}' }
  const chat = timeline.apply({ chat: { id: 'dynamic-import', messages: [], cardContextSnapshot: cardSystemPromptText('天气：晴') }, intent: { kind: 'ensure' } }).chat
  const rows = [{ chat_metadata: {} }, { is_user: false, mes: '开场' }]
  for (let i = 0; i < 4; i++) rows.push({ is_user: true, mes: '行动' + i }, { is_user: false, mes: '正文' + i })
  const result = await buildImportedConversation(chat, parseChatHistory(rows.map(JSON.stringify).join('\n')), { operationId: 'dynamic-import',
    prepareFrame: ({ turn }) => planner.plan({ purpose: 'body', card, chat: { macroState: { local: { weather: turn === 3 || turn === 4 ? '雨' : '晴' } } } }) })
  const messages = result.events.filter(e => e.type === 'user/message').map(e => e.data)
  const updates = messages.filter(m => m.source?.form === 'card-system-prompt-update')
  assert.deepEqual(updates.map(m => m.source.trace.cardSystemPromptSnapshot.text), ['天气：雨', '天气：晴'])
  assert.ok(messages.filter(m => m.source?.form === 'foreground-frame').every(m => !JSON.stringify(m.content).includes('天气：')))
  assert.equal(result.chat.cardContextSnapshot, cardSystemPromptText('天气：晴'))
})
