import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadApplyResult() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} }).applyBodyRegenerationResult
}

const applyBodyRegenerationResult = await loadApplyResult()

test('正文重生成先发布整轮成功后的新视图，再恢复原楼层', function () {
  let currentView = { marker: 'old' }
  let viewWhenShown = null
  const regeneratedView = { marker: 'replacement' }

  applyBodyRegenerationResult({
    sessionId: 'session-1',
    view: regeneratedView,
    tail: {},
    liveTavernView: {
      setView(_sessionId, view) { currentView = view }
    },
    historyProjection: {
      regenerated() { viewWhenShown = currentView }
    }
  })

  assert.equal(viewWhenShown.marker, 'replacement')
})
