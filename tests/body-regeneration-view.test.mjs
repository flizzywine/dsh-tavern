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

test('正文重生成在恢复原楼层前发布返回的新 Swipe 视图', function () {
  let currentView = { tavernSwipes: [{ turn: 17, swipeId: 0, count: 1 }] }
  let viewWhenShown = null
  const regeneratedView = { tavernSwipes: [{ turn: 17, swipeId: 1, count: 2 }] }

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

  assert.equal(viewWhenShown.tavernSwipes[0].swipeId, 1)
  assert.equal(viewWhenShown.tavernSwipes[0].count, 2)
})
