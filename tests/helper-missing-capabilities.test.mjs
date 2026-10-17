import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { helperClient, helperHostHarness } from './fixtures/helper-host-harness.mjs'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { TAVERN_COMPATIBILITY_CAPABILITIES as catalog, createTavernCompatibilityDiagnosticStore } from '../tavern-plugin/lib/domain/tavern-compatibility-diagnostics.js'
import { createMvuDiagnosticStore, createMvuDiagnosticExport } from '../tavern-plugin/lib/domain/mvu-diagnostics.js'

test('官方 MVU 恢复时可使用全局变量并登记关闭状态下的 Function Tool', async () => {
  const run = helperHostHarness({ mvuEnabled: true, globalVariables: { extra_analysis: true } })
  const ctx = run.window.SillyTavern.getContext()
  assert.deepEqual(run.window.getVariables({ type: 'global' }), { extra_analysis: true })
  assert.equal(ctx.ToolManager.isToolCallingSupported(), false)
  assert.doesNotThrow(() => ctx.registerFunctionTool({
    name: 'mvu_update', description: 'MVU update', parameters: { type: 'object' },
    action: async () => '', shouldRegister: () => false, stealth: true
  }))
  assert.equal(ctx.unregisterFunctionTool('mvu_update'), undefined)

  const deleting = run.window.deleteVariable('extra_analysis', { type: 'global' })
  const call = run.calls().at(-1)
  assert.equal(call.method, 'updateTavernHelperVariables')
  assert.equal(call.args.option.type, 'global')
  assert.deepEqual(call.args.variables, {})
  run.reply(call, { updated: true, target: { type: 'global' }, globalVariables: {} })
  assert.deepEqual(JSON.parse(JSON.stringify(await deleting)), { variables: {}, delete_occurred: true })
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
    await store.record('s1', 'r1', [{ ...call, capabilityId: 'TavernHelper.getPreset', result: 'noop' }, { ...call, capabilityId: 'SillyTavern.registerMacro', result: 'noop' }])
    saved = await store.read('s1')
    assert.equal(saved.records[1].operation, 'lookup')
    assert.equal(saved.records[1].result, 'unavailable')
    assert.equal(saved.records[2].result, 'rejected')
    const exported = await createMvuDiagnosticExport({ sessionId: 's1', store: createMvuDiagnosticStore(storage), compatibilityDiagnostics: saved })
    assert.match(exported.buffer.toString(), /compatibility\/missing-capabilities.json/)
    const archive = join(directory, 'diagnostics.zip')
    await writeFile(archive, exported.buffer)
    const unpacked = execFileSync('unzip', ['-p', archive, 'compatibility/missing-capabilities.json'], { encoding: 'utf8' })
    assert.match(unpacked, /runtime-current-script/)
    assert.doesNotMatch(unpacked, /PRIVATE_CHAT/)
    await store.record('s1', 'r2', [call, { ...call, capabilityId: 'PRIVATE_CHAT' }])
    saved = await store.read('s1')
    assert.equal(saved.records.length, 3)
    assert.equal(saved.dropped, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
