import assert from 'node:assert/strict'
import test from 'node:test'
import { createMvuSettlementModule } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { createTavernScriptDispatch } from '../tavern-plugin/lib/domain/tavern-script-dispatch.js'
import { applyMvuSettlementEffect } from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'

const input = { operationId: 'op', chatId: 'c', branchId: 'b', basedOnRevision: 1,
  sessionId: 's', messageId: 0, swipeId: 0, storyText: '测试正文',
  currentVariables: { stat_data: { hp: 10, location: 'door' } } }
const call = operations => ({ name: 'mvu_submit_update', arguments: { operations } })
const submitPosture = request => request.onToolCall({ name: 'posture_submit', arguments: { posture: '原地站立' } })
const patch = [ { op: 'delta', path: '/hp', value: -1 }, { op: 'replace', path: '/location', value: 'hall' } ]

test('MVU 启动失败停止模型纠错且保留原变量；等待中的提交也返回明确加载失败', async () => {
  const gate = createTavernScriptDispatch()
  const chat = { id: 'c', sessionId: 's', mvu: { enabled: true, owner: 'official' },
    messages: [{ role: 'assistant', text: input.storyText, swipeId: 0, swipes: [input.storyText], variables: [structuredClone(input.currentVariables)] }] }
  let writes = 0, runs = 0
  const feedback = []
  const adapter = createTavernScriptHostAdapter({ resolveChat: async () => chat, writeChat: async () => writes++,
    readCard: async () => ({}), worldBooks: { bound: async () => null }, scriptDispatch: gate })
  const module = createMvuSettlementModule({ runtime: adapter, model: { async run(request) {
    runs++
    await submitPosture(request)
    feedback.push(JSON.parse(await request.onToolCall(call(patch))))
    // Even a queued malformed correction cannot overwrite the loading failure.
    feedback.push(JSON.parse(await request.onToolCall(call({ path: '/hp' }))))
    return {}
  } } })
  gate.claim('s', 'browser', false, 'MVU 模块加载失败：Failed to fetch dynamically imported module: http://localhost/bundle.js')
  const result = await module.settleVariables(input)
  assert.equal(result.receipt.status, 'error')
  assert.equal(feedback[0].retryable, false)
  assert.deepEqual(feedback[0], feedback[1])
  assert.match(JSON.stringify(result.receipt.failures), /MVU 模块加载失败.*bundle.js/)
  const resumed = await module.resumeVariables({ ...input, submission: { operations: patch } })
  assert.equal(resumed.receipt.status, 'error')
  assert.match(JSON.stringify(resumed.receipt.failures), /MVU 模块加载失败/)
  assert.equal(runs, 1)
  assert.equal(writes, 0)
  assert.deepEqual(chat.messages[0].variables[0], input.currentVariables)
})

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

test('连续失败最多三次，保留原变量和最后错误', async () => {
  let completed = false
  const h = harness(async request => {
    await submitPosture(request)
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
    await submitPosture(request)
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
    await submitPosture(request)
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
  assert.equal(result.text, '')
})

test('执行结果不确定或目标已过期时停止自动重试', async () => {
  for (const stale of [false, true]) {
    let executions = 0
    const feedback = []
    const module = createMvuSettlementModule({ model: { async run(request) {
      await submitPosture(request)
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

test('浏览器执行器暂时缺席时立即挂起，并在恢复后复用已生成的 operations', async () => {
  let modelRuns = 0, executions = 0, runtimeReady = false
  const module = createMvuSettlementModule({ model: { async run(request) {
    modelRuns++
    await submitPosture(request)
    const feedback = JSON.parse(await request.onToolCall(call(patch)))
    assert.equal(feedback.ok, false)
    assert.equal(feedback.deferred, true)
    return { text: '' }
  } }, runtime: { async settleMvuUpdate() {
    executions++
    if (!runtimeReady) return { deferred: true }
    return { context: { messages: [{ variables: { stat_data: { hp: 9, location: 'hall' } } }] } }
  } } })

  const pending = await module.settleVariables(input)
  assert.equal(pending.receipt.status, 'pending')
  assert.deepEqual(pending.submission.operations, patch)
  assert.equal(modelRuns, 1)
  assert.equal(executions, 1)

  runtimeReady = true
  const resumed = await module.resumeVariables({ ...input, submission: pending.submission })
  assert.equal(resumed.receipt.status, 'updated')
  assert.equal(modelRuns, 1, '恢复运行时不得重新调用模型生成同一批 operations')
  assert.equal(executions, 2)
})
