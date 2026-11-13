import assert from 'node:assert/strict'
import test from 'node:test'
import { diffStatData, mergeVariableUpdate, recordVariableUpdate, variableUpdateFor, variableUpdateText } from '../tavern-plugin/lib/domain/variable-update.js'

test('只记下改动的字段；同一轮再改合并（保留最初的旧值），改回原值就不再提', () => {
  const before = { 金币: 10, 状态: { 体力: 5, 心情: '好' }, 背包: ['剑'] }
  const after = { 金币: 40, 状态: { 体力: 5, 心情: '好' }, 背包: ['剑', '盾'], 新字段: true }
  const changes = diffStatData(before, after)
  assert.deepEqual(changes, [
    { path: ['金币'], from: 10, to: 40 },
    { path: ['背包'], from: ['剑'], to: ['剑', '盾'] },
    { path: ['新字段'], from: undefined, to: true }
  ])
  const first = mergeVariableUpdate(null, { afterTurn: 7, changes })
  const again = mergeVariableUpdate(first, { afterTurn: 7, changes: [{ path: ['金币'], from: 40, to: 50 }] })
  assert.deepEqual(again.changes[0], { path: ['金币'], from: 10, to: 50 })
  const reverted = mergeVariableUpdate(again, { afterTurn: 7, changes: [{ path: ['金币'], from: 50, to: 10 }] })
  assert.deepEqual(reverted.changes.map(change => change.path[0]), ['背包', '新字段'])
  assert.deepEqual(mergeVariableUpdate(first, { afterTurn: 8, changes: [{ path: ['金币'], from: 40, to: 41 }] }).changes, [{ path: ['金币'], from: 40, to: 41 }], '另一轮的修改替换旧记录')
})

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
