import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

async function loadFactory() {
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} })
}

const client = await loadFactory()

test('Tavern 不导出正文锁定或 Session 恢复协调器', function () {
  assert.equal(client.createComposerGate, undefined)
  assert.equal(client.createRuntimeVersionGuard, undefined)
  assert.equal(client.createRuntimeConnectionCoordinator, undefined)
})

test('Tavern 客户端不保存恢复草稿、不重载页面、不注入超时恢复 UI', function () {
  assert.doesNotMatch(source, /dsh-tavern:runtime-generation:v1/)
  assert.doesNotMatch(source, /dsh-tavern:reconnect-draft:v1/)
  assert.doesNotMatch(source, /TavernSignalTimeoutNotice/)
  assert.doesNotMatch(source, /dsh-tavern-signal-timeout/)
  assert.doesNotMatch(source, /conversation\.blocks/)
})

test('候选项后台协调仍由 Tavern SSE 提供', function () {
  assert.equal(typeof client.createTavernCoordinationEventModule, 'function')
  assert.match(source, /new window\.EventSource/)
  assert.doesNotMatch(source, /runtimeVersionGuard\.observe/)
})
