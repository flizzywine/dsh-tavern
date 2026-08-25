import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadFactory() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console, AbortController }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} }).createTavernCoordinationEventModule
}

const createTavernCoordinationEventModule = await loadFactory()

test('协调事件把人物卡投影修订交给实时视图刷新入口', function () {
  let handlers
  const seen = []
  const module = createTavernCoordinationEventModule({
    connect(_sessionId, nextHandlers) { handlers = nextHandlers; return { close() {} } },
    onView(sessionId, view) { seen.push({ sessionId, revision: view.projectionRevision }) }
  })
  const stop = module.subscribe('session-play', function () {})

  handlers.message({ projectionRevision: 7 })

  assert.deepEqual(seen, [{ sessionId: 'session-play', revision: 7 }])
  stop()
})
