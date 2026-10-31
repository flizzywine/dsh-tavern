import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

async function loadFactory() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console, AbortController }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} }).createCardLibraryRefreshModule
}

function deferred() {
  let resolve
  const promise = new Promise(function (done) { resolve = done })
  return { promise, resolve }
}

test('同一人物卡的并发读取共用一个请求', async function () {
  const createRefresh = await loadFactory()
  const refresh = createRefresh()
  const pending = deferred()
  let loads = 0
  const load = function () { loads += 1; return pending.promise }

  const first = refresh.load('cards/a.json', load)
  const second = refresh.load('cards/a.json', load)

  assert.equal(loads, 1)
  assert.equal(first, second)
  pending.resolve('done')
  assert.equal(await first, 'done')
})
