import assert from 'node:assert/strict'
import test from 'node:test'
import { createMvuSettlementModule } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'

const input = { operationId: 'op', chatId: 'c', branchId: 'b', basedOnRevision: 1,
  sessionId: 's', messageId: 0, swipeId: 0, storyText: '测试正文',
  currentVariables: { stat_data: { hp: 10, location: 'door' } } }
const call = operations => ({ name: 'mvu_submit_update', arguments: { operations } })
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
    eventGate: { async dispatch(_s, _name, _args, context) {
      const before = structuredClone(context.messages[0].variables)
      bases.push(before.stat_data.hp)
      const rejected = rejectAlways || bases.length === 1
      before.stat_data.hp -= 1
      if (!rejected) before.stat_data.location = 'hall'
      await adapter.updateMessages('s', [{ message_id: 0, data: before }], 0)
      return { handled: true, diagnostics: rejected ? [{ level: 'warn', message: 'location: 校验拒绝，请修正位置字段' }] : [] }
    } }
  })
  const module = createMvuSettlementModule({ runtime: adapter, model: { run: model } })
  return { module, chat, writes, bases }
}

test('工具等待真实校验，失败回传错误后修正重试；整批回滚防止 delta 重复扣减', async () => {
  let completed = false
  const h = harness(async request => {
    const first = JSON.parse(await request.onToolCall(call(patch)))
    assert.equal(first.ok, false)
    assert.equal(first.retryable, true)
    assert.match(JSON.stringify(first), /location: 校验拒绝/)
    assert.equal(h.writes.length, 0)
    const second = JSON.parse(await request.onToolCall(call(patch)))
    assert.equal(second.ok, true)
    assert.equal(h.writes.length, 1)
    // A duplicate call after success must not execute the delta again.
    assert.equal(JSON.parse(await request.onToolCall(call(patch))).ok, true)
    completed = true
    return { text: '{}', traceSessionId: 'bg' }
  })
  const result = await h.module.settleVariables(input)
  assert.equal(result.receipt.status, 'updated')
  assert.equal(completed, true)
  assert.deepEqual(h.bases, [10, 10])
  assert.equal(h.chat.messages[0].variables[0].stat_data.hp, 9)
  assert.equal(h.writes.length, 1)
})

test('连续失败最多三次，保留原变量和最后错误', async () => {
  let completed = false
  const h = harness(async request => {
    for (let i = 0; i < 5; i++) {
      const result = JSON.parse(await request.onToolCall(call(patch)))
      assert.equal(result.ok, false)
      assert.equal(result.retryable, i < 2)
    }
    completed = true
    return { text: '{}' }
  }, { rejectAlways: true })
  const result = await h.module.settleVariables(input)
  assert.equal(result.receipt.status, 'error')
  assert.equal(completed, true)
  assert.equal(h.bases.length, 3)
  assert.equal(h.writes.length, 0)
  assert.deepEqual(h.chat.messages[0].variables[0], input.currentVariables)
})

test('缺少 operations 的参数错误在同一 Agent 回合修正，不重开模型任务', async () => {
  const feedback = []
  let runs = 0, executions = 0
  const module = createMvuSettlementModule({ model: { async run(request) {
    runs++
    feedback.push(JSON.parse(await request.onToolCall({ name: 'mvu_submit_update', arguments: {} })))
    feedback.push(JSON.parse(await request.onToolCall(call([{ op: 'delta', path: '/hp', value: -1 }]))))
    return { text: '{}' }
  } }, runtime: { async settleMvuUpdate() {
    executions++
    return { context: { messages: [{ variables: { stat_data: { hp: 9, location: 'door' } } }] } }
  } } })
  const result = await module.settleVariables(input)
  assert.equal(feedback[0].retryable, true)
  assert.match(feedback[0].error, /operations/)
  assert.equal(feedback[1].ok, true)
  assert.equal(result.receipt.status, 'updated')
  assert.equal(runs, 1)
  assert.equal(executions, 1)
})

test('并行重复调用与成功后的模型断流不会再次执行变量更新', async () => {
  let executions = 0, runs = 0
  const responses = []
  const module = createMvuSettlementModule({ model: { async run(request) {
    runs++
    responses.push(...await Promise.all([request.onToolCall(call(patch)), request.onToolCall(call(patch))]))
    throw new Error('provider stream disconnected after commit')
  } }, runtime: { async settleMvuUpdate() {
    executions++
    return { context: { messages: [{ variables: { stat_data: { hp: 9, location: 'hall' } } }] } }
  } } })
  const result = await module.settleVariables(input)
  assert.equal(responses.length, 2)
  assert.ok(responses.every(text => JSON.parse(text).ok))
  assert.equal(executions, 1)
  assert.equal(runs, 1)
  assert.equal(result.receipt.status, 'updated')
  assert.equal(result.text, '{}')
})

test('执行结果不确定或目标已过期时停止自动重试', async () => {
  for (const stale of [false, true]) {
    let executions = 0
    const feedback = []
    const module = createMvuSettlementModule({ model: { async run(request) {
      feedback.push(JSON.parse(await request.onToolCall(call(patch))))
      feedback.push(JSON.parse(await request.onToolCall(call(patch))))
      return { text: '{}' }
    } }, runtime: { async settleMvuUpdate() {
      executions++
      if (stale) return { stale: true }
      throw new Error('disk write outcome unknown')
    } } })
    const result = await module.settleVariables(input)
    assert.equal(feedback.length, 2)
    assert.ok(feedback.every(item => item.retryable === false))
    assert.equal(executions, 1)
    assert.equal(result.receipt.status, stale ? 'stale' : 'error')
  }
})
