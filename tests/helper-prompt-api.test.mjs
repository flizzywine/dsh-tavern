import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/src/client/runtime/helper-prompt-api.js', import.meta.url), 'utf8')
const declared = vm.runInNewContext(source + '\ninstallTavernHelperPromptApi')
// Exercise the production serialization boundary, without enclosing module state.
const install = vm.runInNewContext('(' + declared.toString() + ')')
const tick = () => new Promise(resolve => setImmediate(resolve))
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { resolve, promise } }
function fixture(request = async () => ({ updated: true })) {
  const window = {}, calls = []
  const api = install({ window, copy: structuredClone, request(method, args) {
    calls.push(structuredClone({ method, args }))
    return request(method, args)
  } })
  return { window, calls, api }
}

test('serialized prompt API clones input and waits for inject and removal receipts', async () => {
  const receipt = gate(), f = fixture(() => receipt.promise)
  const prompts = [{ id: 'scene', content: 'rain', position: 'in_chat' }]
  const handle = f.window.injectPrompts(prompts, { once: true })
  prompts[0].content = 'changed'
  let finished = false
  const drain = f.window.__dshFlushPromptWrites().then(() => { finished = true })
  await tick()
  assert.equal(finished, false)
  assert.deepEqual(f.calls[0], { method: 'updateTavernHelperPrompts', args: { operation: {
    kind: 'inject', prompts: [{ id: 'scene', content: 'rain', position: 'in_chat' }], once: true,
  } } })
  receipt.resolve({ updated: true })
  await drain
  handle.uninject()
  await f.window.__dshFlushPromptWrites()
  assert.deepEqual(f.calls[1].args.operation, { kind: 'remove', ids: ['scene'] })
})

for (const mode of ['sync', 'async', 'stale']) test('completed ' + mode + ' write failure survives until the next drain', async () => {
  const f = fixture(() => {
    if (mode === 'sync') throw new Error('write rejected')
    if (mode === 'async') return Promise.reject(new Error('write rejected'))
    return Promise.resolve({ stale: true })
  })
  f.window.injectPrompts([{ id: 'scene', content: 'rain' }])
  await tick() // Failure has completed before anyone begins waiting.
  await assert.rejects(f.window.__dshFlushPromptWrites(), mode === 'stale' ? /聊天已变化/ : /write rejected/)
  await f.window.__dshFlushPromptWrites() // Failure is consumed by the failed operation.
})

test('concurrent generation flushes share one callback and wait for its writes', async () => {
  const receipt = gate(), f = fixture(() => receipt.promise)
  let events = 0, finished = false
  f.window.eventEmit = async (name, type, options, dryRun) => {
    assert.equal(name, 'GENERATION_AFTER_COMMANDS')
    assert.equal(type, 'normal')
    assert.equal(dryRun, false)
    events++
    await Promise.resolve()
    f.window.injectPrompts([{ id: 'scene', content: 'rain' }], { once: true })
    // A listener may itself wait for the write receipt without deadlocking.
    await f.window.__dshFlushPromptWrites()
  }
  const one = f.window.__dshFlushBeforeGenerate(), two = f.window.__dshFlushBeforeGenerate()
  assert.equal(one, two)
  one.then(() => { finished = true })
  await tick()
  assert.equal(events, 1)
  assert.equal(finished, false)
  receipt.resolve({ updated: true })
  await one
  assert.equal(finished, true)
})

test('listener failure still drains writes before rejecting and a later flush can retry', async () => {
  const receipt = gate(), f = fixture(() => receipt.promise)
  f.window.eventEmit = () => {
    f.window.injectPrompts([{ id: 'scene', content: 'rain' }])
    throw new Error('listener rejected')
  }
  let rejected = false
  const operation = assert.rejects(f.window.__dshFlushBeforeGenerate(), /listener rejected/).then(() => { rejected = true })
  await tick()
  assert.equal(rejected, false)
  receipt.resolve({ updated: true })
  await operation
  f.window.eventEmit = async () => {}
  await f.window.__dshFlushBeforeGenerate()
})

test('invalid injection arguments fail before RPC and existing native APIs remain untouched', () => {
  const f = fixture()
  assert.throws(() => f.window.injectPrompts({}), /数组/)
  assert.throws(() => f.window.injectPrompts([{ id: 'scene', filter: () => true }]), /filter/)
  assert.throws(() => f.window.uninjectPrompts('scene'), /数组/)
  assert.equal(f.calls.length, 0)
  assert.equal(install({ window: f.window }), f.api)
  const native = () => {}, window = { injectPrompts: native }
  assert.equal(install({ window }), null)
  assert.equal(window.injectPrompts, native)
  assert.equal(window.__dshFlushBeforeGenerate, undefined)
})
