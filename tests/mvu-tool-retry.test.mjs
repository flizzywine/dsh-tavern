import assert from 'node:assert/strict'
import test from 'node:test'
import { createMvuSettlementModule } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'

import { applyMvuSettlementEffect } from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'

const input = { operationId: 'op', chatId: 'c', branchId: 'b', basedOnRevision: 1,
  sessionId: 's', messageId: 0, swipeId: 0, storyText: '测试正文',
  currentVariables: { stat_data: { hp: 10, location: 'door' } } }
const call = operations => ({ name: 'mvu_submit_update', arguments: { operations } })
const submitPosture = request => request.onToolCall({ name: 'posture_submit', arguments: { posture: '原地站立' } })
const patch = [ { op: 'delta', path: '/hp', value: -1 }, { op: 'replace', path: '/location', value: 'hall' } ]

function harness(model, { rejectAlways = false } = {}) {
  const chat = { id: 'c', sessionId: 's', mode: 'story', mvu: { enabled: true, owner: 'official' },
    messages: [{ role: 'assistant', text: '测试正文', swipes: ['测试正文'], swipeId: 0, variables: [structuredClone(input.currentVariables)] }] }
  const writes = [], bases = []
  let adapter
  adapter = createTavernScriptHostAdapter({
    resolveChat: async () => chat,
    writeChat: async draft => { writes.push(structuredClone(draft)); Object.assign(chat, structuredClone(draft)) },
    readCard: async () => ({}), worldBooks: { bound: async () => null },
    scriptDispatch: { async dispatch(_s, _name, _args, context, work) {
      const before = structuredClone(context.messages[0].variables)
      bases.push(before.stat_data.hp)
      const rejected = rejectAlways || bases.length === 1
      before.stat_data.hp -= 1
      if (!rejected) before.stat_data.location = 'hall'
      await adapter.updateMessages('s', [{ message_id: 0, data: before }], 0, work.eventId)
      return { handled: true, diagnostics: rejected ? [{ level: 'warn', message: 'location: 校验拒绝，请修正位置字段' }] : [] }
    } }
  })
  const module = createMvuSettlementModule({ runtime: adapter, model: { run: model } })
  return { module, chat, writes, bases }
}

test('工具等待真实校验，失败回传错误后修正重试；整批回滚防止 delta 重复扣减', async () => {
  let completed = false
  const h = harness(async request => {
    await submitPosture(request)
    const first = JSON.parse(await request.onToolCall(call(patch)))
    assert.equal(first.ok, false)
    assert.equal(first.retryable, true)
    assert.match(JSON.stringify(first), /location: 校验拒绝/)
    assert.equal(h.writes.length, 0)
    const second = JSON.parse(await request.onToolCall(call(patch)))
    assert.equal(second.ok, true)
    assert.equal(h.writes.length, 0)
    // A duplicate call after success must not execute the delta again.
    assert.equal(JSON.parse(await request.onToolCall(call(patch))).ok, true)
    completed = true
    return { text: '{}', traceSessionId: 'bg' }
  })
  const result = await h.module.settleVariables(input)
  assert.equal(result.receipt.status, 'updated')
  assert.equal(completed, true)
  assert.deepEqual(h.bases, [10, 10])
  assert.deepEqual(h.chat.messages[0].variables[0], input.currentVariables)
  applyMvuSettlementEffect(h.chat, result.effect)
  assert.equal(h.chat.messages[0].variables[0].stat_data.hp, 9)
  assert.equal(h.writes.length, 0)
})
