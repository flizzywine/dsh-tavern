import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadDecision() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} }).decideRuntimeConnectionAction
}

const decide = await loadDecision()

function plain(value) { return JSON.parse(JSON.stringify(value)) }

test('首次发现服务代次时只记录，不重载', function () {
  assert.deepEqual(plain(decide('', { runtimeGeneration: 'runtime-a', liveSession: true }, false, false)), {
    kind: 'remember',
    generation: 'runtime-a'
  })
})

test('首次发现冷 Session 时先记录代次并预热 Agent', function () {
  assert.deepEqual(plain(decide('', { runtimeGeneration: 'runtime-a', liveSession: false }, false, false)), {
    kind: 'warm',
    generation: 'runtime-a'
  })
})

test('服务代次变化时重连，并按请求是否已接收决定是否恢复草稿', function () {
  assert.deepEqual(plain(decide('runtime-a', { runtimeGeneration: 'runtime-b', liveSession: true }, true, false)), {
    kind: 'reload',
    generation: 'runtime-b',
    restoreDraft: true
  })
  assert.deepEqual(plain(decide('runtime-a', { runtimeGeneration: 'runtime-b', liveSession: true }, true, true)), {
    kind: 'reload',
    generation: 'runtime-b',
    restoreDraft: false
  })
  assert.deepEqual(plain(decide('runtime-a', { runtimeGeneration: 'runtime-b', liveSession: true }, false, true)), {
    kind: 'reload',
    generation: 'runtime-b',
    restoreDraft: true
  })
})

test('同代服务在空闲时预热冷 Session，发送竞争时才重载保护草稿', function () {
  assert.deepEqual(plain(decide('runtime-a', { runtimeGeneration: 'runtime-a', liveSession: true }, true, false)), { kind: 'none' })
  assert.deepEqual(plain(decide('runtime-a', { runtimeGeneration: 'runtime-a', liveSession: false }, false, false)), {
    kind: 'warm',
    generation: 'runtime-a'
  })
  assert.deepEqual(plain(decide('runtime-a', { runtimeGeneration: 'runtime-a', liveSession: false }, true, false)), {
    kind: 'reload',
    generation: 'runtime-a',
    restoreDraft: true
  })
})
