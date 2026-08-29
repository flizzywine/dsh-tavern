import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadFactory() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console, AbortController }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} }).createWorldBookLibraryRefreshModule
}

function deferred() {
  let resolve
  const promise = new Promise(function (done) { resolve = done })
  return { promise, resolve }
}

test('世界书库刷新进行中时把多次通知合并为一次补充刷新', async () => {
  const createRefresh = await loadFactory()
  assert.equal(typeof createRefresh, 'function')
  const pending = []
  let loads = 0
  const values = []
  const refresh = createRefresh({
    load() {
      loads += 1
      const item = deferred()
      pending.push(item)
      return item.promise
    },
    onValue(value) { values.push(value) }
  })

  const first = refresh.request()
  refresh.request()
  refresh.request()
  assert.equal(loads, 1)

  pending[0].resolve('first')
  await first
  await new Promise(function (resolve) { setImmediate(resolve) })
  assert.equal(loads, 2)

  pending[1].resolve('latest')
  await refresh.whenIdle()
  assert.deepEqual(values, ['first', 'latest'])
  assert.equal(loads, 2)
})
