import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

test('static stage loads shared Pixi and filters without a model SDK', async () => {
  const scripts = [], window = {}
  const context = vm.createContext({ window, document: {
    createElement: () => ({}),
    head: { appendChild(node) {
      scripts.push(node.src)
      if (node.src.endsWith('/pixi.min.js')) window.PIXI = { filters: {} }
      else window.PIXI.filters.KawaseBlurFilter = function () {}
      queueMicrotask(node.onload)
    } }
  } })
  for (const file of ['pixi-runtime.js', 'gal-effects.js']) {
    vm.runInContext(await readFile(new URL('../tavern-plugin/src/client/' + file, import.meta.url), 'utf8'), context)
  }
  const [first, second] = await Promise.all([
    vm.runInContext('loadPixiRuntime()', context), vm.runInContext('loadPixiRuntime()', context)
  ])
  assert.equal(first, second)
  await vm.runInContext('loadPixiFilters()', context)
  await vm.runInContext('loadPixiFilters()', context)
  assert.deepEqual(scripts, [
    '/api/dsh-tavern/vendor/runtime-assets/pixi/pixi.min.js',
    '/api/dsh-tavern/vendor/runtime-assets/pixi/pixi-filters.js'
  ])
  for (const file of ['pixi.min.js', 'pixi-filters.js']) {
    assert.ok((await readFile(new URL('../tavern-plugin/lib/vendor/runtime-assets/pixi/' + file, import.meta.url))).length > 0)
  }
})
