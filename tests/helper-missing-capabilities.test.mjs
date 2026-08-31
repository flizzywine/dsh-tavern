import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { helperClient, helperHostHarness } from './fixtures/helper-host-harness.mjs'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { TAVERN_COMPATIBILITY_CAPABILITIES as catalog, createTavernCompatibilityDiagnosticStore } from '../tavern-plugin/lib/domain/tavern-compatibility-diagnostics.js'
import { createMvuDiagnosticStore, createMvuDiagnosticExport } from '../tavern-plugin/lib/domain/mvu-diagnostics.js'

const observations = run => run.sent.filter(message => message.type === 'dsh-tavern-helper-compatibility')

test('辅助空实现继续运行、核心占位明确失败；原有缺失函数保留 fallback', () => {
  const run = helperHostHarness({ mvuEnabled: false }), w = run.window, ctx = w.SillyTavern.getContext()
  let touched = false
  const sensitive = { get password() { touched = true; throw Error('must not inspect') }, toJSON() { touched = true; throw Error('must not serialize') } }
  for (let n = 0; n < 100; n++) assert.equal(ctx.scrollChatToBottom('PRIVATE_CHAT', sensitive, null), undefined)
  assert.equal(touched, false)
  assert.equal(observations(run).at(-1).count, 100)
  assert.deepEqual(Array.from(observations(run).at(-1).argumentTypes), ['string', 'object', 'null'])
  for (const name of ['showLoader', 'hideLoader', 'unregisterMacro', 'unregisterFunctionTool']) assert.equal(ctx[name](), undefined)
  for (const name of ['registerMacro', 'registerFunctionTool', 'getRequestHeaders', 'getChatCompletionModel']) {
    assert.throws(() => ctx[name]('PRIVATE_CHAT'), error => error.code === 'TAVERN_CAPABILITY_UNSUPPORTED')
  }
  let fallback = false
  if (typeof w.TavernHelper.generateRaw === 'function') w.TavernHelper.generateRaw()
  else fallback = true
  assert.equal(fallback, true)
  assert.equal(w.generateRaw, undefined)
  assert.equal(ctx.deleteMessage, undefined)
  assert.equal(observations(run).find(item => item.capabilityId === 'TavernHelper.generateRaw').count, 1)
  assert.equal(run.calls().length, 0, '空实现或探测不得触发保存或模型 RPC')
  assert.doesNotMatch(JSON.stringify(observations(run)), /PRIVATE_CHAT|password|toJSON/)
  const before = observations(run).length
  assert.equal(ctx.then, undefined)
  assert.equal(ctx.randomUnknownMethod, undefined)
  assert.equal(observations(run).length, before, '不伪造任意未知函数')
  w.TavernHelper.generateRaw = () => 'plugin fallback'
  assert.equal(w.generateRaw(), 'plugin fallback', '插件仍能自行安装原有缺失函数的回退实现')
})

test('事件回调按已有脚本身份记账，互不混合', async () => {
  const run = helperHostHarness(), w = run.window
  w.__dshTavernHelperSetCurrentScript('a')
  w.eventOn('TEST', () => w.SillyTavern.hideLoader())
  w.__dshTavernHelperSetCurrentScript('b')
  w.eventOn('TEST', () => w.SillyTavern.hideLoader())
  await w.eventEmit('TEST')
  assert.deepEqual(observations(run).map(item => [item.scriptId, item.count]), [['a', 1], ['b', 1]])
})

function parentHarness(rpc, reportError = () => {}) {
  const listeners = {}, frames = []
  let sequence = 0
  const hostWindow = { crypto: { randomUUID: () => 'runtime-' + (++sequence) }, setTimeout, clearTimeout,
    addEventListener(name, fn) { listeners[name] = fn }, removeEventListener() {} }
  const root = { isConnected: true, appendChild() {}, remove() {} }
  const document = { body: { appendChild() {} }, createElement(tag) {
    if (tag === 'div') return root
    const frame = { contentWindow: { postMessage() {} }, addEventListener() {}, remove() {} }
    frames.push(frame)
    return frame
  } }
  const runtime = helperClient.createTavernHelperScriptRuntime({ window: hostWindow, document, rpc, reportError, resolveError() {}, onMutation() { assert.fail('diagnostics must not invalidate Chat') } })
  const view = { tavernHelper: { messages: [], compatibilityCapabilities: catalog }, tavernHelperScripts: [{ id: 'a', name: '已知脚本', content: '' }] }
  runtime.sync('s1', view)
  return { runtime, view, send(data = {}, source = frames[0].contentWindow) {
    listeners.message({ source, data: { type: 'dsh-tavern-helper-compatibility', token: 'runtime-1', scriptId: 'a', capabilityId: 'SillyTavern.hideLoader', count: 1, ...data } })
  } }
}

test('父窗口校验来源/token/脚本/接口，合并计数并在切换时保存到旧 Session', async () => {
  const calls = []
  const host = parentHarness(async (method, args, sessionId) => { calls.push({ method, args, sessionId }) })
  host.send({ token: 'forged' })
  host.send({}, {})
  host.send({ scriptId: 'forged' })
  host.send({ capabilityId: 'PRIVATE_CHAT' })
  host.send({ count: NaN })
  await host.runtime.flushCompatibilityDiagnostics()
  assert.equal(calls.length, 0)
  host.send({ count: 2, scriptName: 'forged', argumentTypes: ['PRIVATE_CHAT', 'string'], args: ['PRIVATE_CHAT'] })
  host.send({ count: 1 })
  await host.runtime.flushCompatibilityDiagnostics()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args.calls[0].count, 2)
  assert.equal(calls[0].args.calls[0].scriptName, '已知脚本')
  assert.doesNotMatch(JSON.stringify(calls), /PRIVATE_CHAT|forged/)
  assert.notEqual(calls[0].args.runtimeId, 'runtime-1', '持久化标识不能复用 iframe 通信凭据')
  host.runtime.sync('s1', { ...host.view, tavernHelper: { messages: [] } })
  host.send({ count: 3 })
  host.runtime.sync('s2', host.view)
  await host.runtime.flushCompatibilityDiagnostics()
  assert.equal(calls.at(-1).sessionId, 's1')
  assert.equal(calls.at(-1).args.calls[0].count, 3)
  host.send({ count: 999 }) // the old frame is now detached
  await host.runtime.flushCompatibilityDiagnostics()
  assert.equal(calls.length, 2)
  host.runtime.dispose()
})

test('记录保存失败明确提示，不打断空操作或无限重试', async () => {
  const errors = []
  let attempts = 0
  const host = parentHarness(async () => { attempts++; throw Error('disk unavailable') }, (source, error) => errors.push(error.message))
  host.send()
  await host.runtime.flushCompatibilityDiagnostics()
  assert.equal(attempts, 1)
  assert.match(errors[0], /部分调用可能未记录/)
  host.runtime.dispose()
})

test('记录落盘回读、去重、容量限制、Session 隔离与日志包导出', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tavern-compatibility-'))
  try {
    const storage = createProfileDataStore({ dataRoot: directory })
    const store = createTavernCompatibilityDiagnosticStore(storage, { maxRecords: 3 })
    const call = { scriptId: 'a', scriptName: '测试脚本', capabilityId: 'SillyTavern.hideLoader', count: 10, argumentTypes: ['string', 'PRIVATE_CHAT'], args: ['PRIVATE_CHAT'], stack: 'PRIVATE_CHAT' }
    await store.record('s1', 'r1', [call])
    await store.record('s1', 'r1', [{ ...call, count: 2 }])
    await store.record('s1', 'r1', [call])
    let saved = await createTavernCompatibilityDiagnosticStore(createProfileDataStore({ dataRoot: directory })).read('s1')
    assert.equal(saved.records.length, 1)
    assert.equal(saved.records[0].count, 10)
    assert.equal(saved.records[0].result, 'noop')
    assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_CHAT/)
    assert.equal((await store.read('s2')).records.length, 0)
    await store.record('s1', 'r1', [{ ...call, capabilityId: 'TavernHelper.generateRaw', result: 'noop' }, { ...call, capabilityId: 'SillyTavern.registerMacro', result: 'noop' }])
    saved = await store.read('s1')
    assert.equal(saved.records[1].operation, 'lookup')
    assert.equal(saved.records[1].result, 'unavailable')
    assert.equal(saved.records[2].result, 'rejected')
    const exported = await createMvuDiagnosticExport({ sessionId: 's1', store: createMvuDiagnosticStore(storage), compatibilityDiagnostics: saved })
    assert.match(exported.buffer.toString(), /compatibility\/missing-capabilities.json/)
    assert.match(exported.buffer.toString(), /runtime-current-script/)
    assert.doesNotMatch(exported.buffer.toString(), /PRIVATE_CHAT/)
    await store.record('s1', 'r2', [call, { ...call, capabilityId: 'PRIVATE_CHAT' }])
    saved = await store.read('s1')
    assert.equal(saved.records.length, 3)
    assert.equal(saved.dropped, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
