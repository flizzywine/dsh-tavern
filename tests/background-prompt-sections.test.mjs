import assert from 'node:assert/strict'
import test from 'node:test'
import { backgroundPrompt } from '../tavern-plugin/lib/domain/background-task-prompt.js'
import { promptSection } from '../tavern-plugin/lib/domain/prompt-section.js'

const text = value => [{ type: 'text', text: value }]

// The background turn wraps the English task sections in the same tagged English envelope.
test('the background turn envelope uses tagged English sections', () => {
  const candidate = backgroundPrompt([{ role: 'user', content: text('ACTION') }, { role: 'assistant', content: text('STORY') }], 'STATE', 'candidate',
    promptSection('candidate_request', 'Generate the choices by the rules above.'), { postHistoryText: 'POST_HISTORY' })
  const director = backgroundPrompt([{ role: 'assistant', content: text('STORY') }], 'STATE', 'stage-director', 'STAGE_PROTOCOL',
    { contextPolicy: 'shared-background', systemPromptText: 'CARD_SYSTEM', postHistoryText: 'POST_HISTORY' })
  for (const value of [candidate, director]) assert.doesNotMatch(value, /【|任务类型/, 'no Chinese envelope around English sections')
  assert.deepEqual([...candidate.matchAll(/^<([a-z_]+)>$/gm)].map(match => match[1]),
    ['authoritative_state', 'recent_task', 'task_requirements', 'candidate_request', 'post_history'])
  assert.ok(candidate.includes('<recent_task>\nTask type: choice generation\n[User]\nACTION\n\n[Story]\nSTORY\n</recent_task>'))
  assert.match(candidate, /<post_history>\nCard instructions:\nPOST_HISTORY\n<\/post_history>$/)
  assert.match(director, /^<card_system>\nCard system prompt:\nCARD_SYSTEM\n<\/card_system>/)
  assert.match(director, /<task_requirements>\nDSH background task protocol \(final instructions\):\nSTAGE_PROTOCOL\n<\/task_requirements>/)
})
