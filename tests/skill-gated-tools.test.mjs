import assert from 'node:assert/strict'
import test from 'node:test'

import { createSkillGatedTools } from '../tavern-plugin/lib/domain/skill-gated-tools.js'

test('任务专用工具在加载对应 Skill 后才出现，其余工具不受影响', () => {
  const visible = createSkillGatedTools()
  const names = ['bash', 'tavern_update_card', 'cordis_run', 'tavern_save_skill', 'tavern_user_profile_read', 'tavern_read_play_chat']
  const session = { id: 's', events: [{ type: 'user/message', data: { content: [{ type: 'text', text: '改卡' }] } }] }
  assert.deepEqual(visible(names, session), ['bash', 'tavern_update_card'])
  // Slash commands expand into the user message; the skill tool returns the same block.
  session.events.push({ type: 'user/message', data: { content: [{ type: 'text', text: '<skill_content name="debug-card">…</skill_content>' }] } })
  assert.deepEqual(visible(names, session), ['bash', 'tavern_update_card', 'tavern_read_play_chat'])
  session.events.push({ type: 'tool/result', data: { output: [{ type: 'text', text: '<skill_content name="advanced-capabilities">' }] } })
  assert.deepEqual(visible(names, session), ['bash', 'tavern_update_card', 'cordis_run', 'tavern_save_skill', 'tavern_read_play_chat'])
  assert.deepEqual(visible(names, undefined), ['bash', 'tavern_update_card'])
})


test('DSH 建卡独立加载即可读取长期偏好，无需传统建卡 Skill', () => {
  const visible = createSkillGatedTools()
  const session = {id:'dsh-card',events:[{type:'tool/result',data:{output:[{type:'text',text:'<skill_content name="create-dsh-card">'}]}}]}
  assert.deepEqual(visible(['tavern_update_card','tavern_user_profile_read','cordis_run'],session),['tavern_update_card','tavern_user_profile_read'])
})
