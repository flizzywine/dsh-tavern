import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
const storyRules = readFileSync(new URL('../tavern-plugin/prompts/story.md', import.meta.url), 'utf8')
const framePlan = await createContextPlanner({ prompt: () => storyRules }).plan({purpose:'body',card:{},chat:{}})

import assert from 'node:assert/strict'

import { parseChatHistory } from '../tavern-plugin/lib/domain/chat-history-import.js'
import { buildImportedConversation } from '../tavern-plugin/lib/domain/chat-history-session.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

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
