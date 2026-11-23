import assert from 'node:assert/strict'
import test from 'node:test'
import { recordVariableUpdate, variableUpdateFor, variableUpdateText } from '../tavern-plugin/lib/domain/variable-update.js'

test('只在紧接被改那一轮的正文请求里出现：重新生成下一轮仍带，再往后或回退到更早都不带', () => {
  const variableUpdate = { afterTurn: 7, changes: [{ path: ['状态', '体力'], from: 5, to: 9 }] }
  const reply = turn => ({ role: 'assistant', turn })
  assert.equal(variableUpdateFor({ variableUpdate, messages: [reply(6), { role: 'user' }, reply(7), { role: 'user' }] }), variableUpdate)
  assert.equal(variableUpdateFor({ variableUpdate, messages: [reply(7), { role: 'user' }, reply(8)] }), null)
  assert.equal(variableUpdateFor({ variableUpdate, messages: [reply(6)] }), null)
  assert.equal(variableUpdateText(variableUpdate), '<variable_update>\n以下变量已更新，以此为准：\n- 状态.体力：5 → 9\n</variable_update>')
})

test('面板保存只在有改动时写入本局', async () => {
  let chat = { id: 'game', messages: [] }, writes = 0
  const deps = { chatForSession: async () => structuredClone(chat), updateChat: async (_id, mutate) => { writes++; const next = mutate(structuredClone(chat)); if (next) chat = next; return chat } }
  await recordVariableUpdate(deps, 'story', { afterTurn: 3, before: { 金币: 1 } }, { 金币: 1 })
  assert.equal(writes, 0)
  await recordVariableUpdate(deps, 'story', { afterTurn: 3, before: { 金币: 1 } }, { 金币: 2 })
  assert.deepEqual(chat.variableUpdate, { afterTurn: 3, changes: [{ path: ['金币'], from: 1, to: 2 }] })
})
