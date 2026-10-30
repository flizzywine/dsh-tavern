import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { deferred } from './fixtures/sync-clock.mjs'
const source = fs.readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
function harness() {
  const reads = [], generations = []
  const scope = vm.createContext({ window: { setTimeout: fn => setTimeout(fn, 0) }, performance, Date, Math, AbortController,
    performanceReportAt: Date.now(), pagePerformanceStarted: Date.now(), pagePerformance: {},
    performanceRequests: [], performanceActiveRequests: 0, historyFromSessions: new Map(), rememberHistoryWindow() {},
    tavernRuntimeGenerationMonitor: { observe(value) { generations.push(value) } },
    readTavernJsonResponse: response => response.json(),
    // The startup trace only records; rpc() also consults its per-key counts.
    roundLoadCounts: new Map(), roundLoadTrace: { mark() {} },
    expandTavernOpeningWindow: view => view,
    fetch(url, request) { const task = deferred(); reads.push({ ...task, url, request,
      reply(value, status = 200) { task.resolve({ status, json: async () => value }) } }); return task.promise }
  })
  const modules = ['../tavern-plugin/lib/domain/indexed-array.js', '../tavern-plugin/src/client/modules/session-view-sync.js', '../tavern-plugin/src/client/rpc-transport.cjs']
  vm.runInContext(modules.map(path => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^export .*$/gm, '')).join('\n') + '\nconst beginSessionViewRead = createSessionViewReader(1);', scope)
  // Take exactly rpc(): from its declaration to its own closing brace, independent of neighbours.
  const start = source.indexOf('\t\tfunction rpc(method,')
  const end = source.indexOf('\n\t\t}\n', start)
  assert.ok(start >= 0 && end > start, 'client rpc() boundaries exist')
  vm.runInContext(source.slice(start, end + 4), scope)
  return { rpc: scope.rpc, reads, generations }
}
for (const outcome of ['old success', 'network error', 'server error']) test(`real RPC suppresses ${outcome} after a newer accepted session response`, async () => {
  const h = harness(), old = h.rpc('getSession', {}, 'A'), next = h.rpc('getSession', {}, 'A')
  h.reads[1].reply({ ok: true, runtimeGeneration: 'new', viewCursor: 'v2', view: { done: true } })
  const latest = await next
  if (outcome === 'network error') h.reads[0].reject(new Error('late network failure'))
  else h.reads[0].reply(outcome === 'old success'
    ? { ok: true, runtimeGeneration: 'old', viewCursor: 'v1', view: { busy: true } }
    : { ok: false, runtimeGeneration: 'old', error: 'late server failure' })
  const result = await old
  assert.equal(result.view, latest.view); assert.equal(result.viewCursor, 'v2')
  assert.equal(result.viewDelta, undefined); assert.equal(result.viewBase, undefined)
  assert.ok(!h.generations.includes('old'), 'obsolete responses cannot roll runtime generation back')
})

for (const method of ['getSession', 'submitTask']) test(`cancelled ${method} preserves AbortError and cannot observe or cache a late success`, async () => {
  const h = harness(), controller = new AbortController()
  const task = h.rpc(method, {}, 'A', { signal: controller.signal })
  controller.abort()
  h.reads[0].reply({ ok: true, runtimeGeneration: 'retired', viewCursor: 'old', view: { old: true } })
  await assert.rejects(task, error => error.name === 'AbortError')
  assert.deepEqual(h.generations, [])
  const next = h.rpc('getSession', {}, 'A')
  assert.equal(JSON.parse(h.reads[1].request.body).viewCursor, undefined)
  h.reads[1].reply({ ok: true, viewCursor: 'fresh', view: { fresh: true } }); await next
})

test('abort releases a hung reader watermark even before its carrier settles', async () => {
  const h = harness(), controller = new AbortController()
  const old = h.rpc('getSession', {}, 'A', { signal: controller.signal })
  const next = h.rpc('getSession', {}, 'A')
  h.reads[1].reply({ ok: true, viewCursor: 'A2', view: {} }); await next
  const other = h.rpc('getSession', {}, 'B')
  h.reads[2].reply({ ok: true, viewCursor: 'B1', view: {} }); await other
  controller.abort()
  const back = h.rpc('getSession', {}, 'A')
  assert.equal(JSON.parse(h.reads[3].request.body).viewCursor, undefined)
  h.reads[3].reply({ ok: true, viewCursor: 'A3', view: { fresh: true } }); await back
  h.reads[0].reply({ ok: true, viewCursor: 'A1', view: {} })
  await assert.rejects(old, error => error.name === 'AbortError')
})

// DSH accepts requests a moment before Tavern's routes are mounted after a restart (update).
test('a request during the restart window waits for the routes instead of failing', async () => {
  const h = harness(), task = h.rpc('listSessions', {})
  h.reads[0].reply({}, 404)
  await new Promise(resolve => setTimeout(resolve, 5))
  h.reads[1].reply({}, 401)
  await new Promise(resolve => setTimeout(resolve, 5))
  h.reads[2].reply({ ok: true, sessions: [] })
  assert.deepEqual((await task).sessions, [])
  assert.equal(h.reads.length, 3)
})
