import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { parse } from 'acorn'

const source = await readFile(new URL('../tavern-plugin/src/client/runtime/helper-event-api.js', import.meta.url), 'utf8')
const install = vm.runInNewContext(source + '\ninstallTavernHelperEventApi')
const sharedSource = await readFile(new URL('../tavern-plugin/src/client/runtime/helper-facade.js', import.meta.url), 'utf8')
const sharedDeclaration = parse(sharedSource, { ecmaVersion: 'latest' }).body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'createTavernHelperEventBus')
const createSharedBus = vm.runInNewContext('(' + sharedSource.slice(sharedDeclaration.start, sharedDeclaration.end) + ')')
const tick = () => new Promise(resolve => setImmediate(resolve))
function local(extra = {}) {
  const window = { ...extra }
  const lifecycle = install(window, { localEvents: true })
  return { window, ...lifecycle }
}
function shared() {
  let owner = 'a'
  const bus = createSharedBus({
    currentScript: () => ({ id: owner }),
    withScript: async (id, fn) => { const before = owner; owner = id; try { return await fn() } finally { owner = before } },
    reportSubscriptions() {}, post() {}
  })
  const window = {
    eventOn: (name, listener) => bus.listen(name, listener),
    eventOnce: (name, listener) => bus.listen(name, listener, null, true),
    eventMakeFirst: (name, listener) => bus.listen(name, listener, 'first'),
    eventMakeLast: (name, listener) => bus.listen(name, listener, 'last'),
    eventOff: bus.off, eventRemoveListener: bus.off,
    eventClearEvent: bus.clearEvent, eventClearListener: bus.clearListener, eventClearAll: bus.clearAll,
    eventEmit: bus.emit
  }
  const before = { ...window }, lifecycle = install(window)
  return { window, before, bus, ...lifecycle, owner: () => owner, setOwner(value) { owner = value } }
}

test('local subscriptions deduplicate, reorder and expose stable idempotent stop handles', async () => {
  const { window: api } = local(), seen = []
  const a = () => seen.push('a'), b = () => seen.push('b'), c = () => seen.push('c')
  const first = api.eventOn('order', a)
  api.eventOn('order', a)
  api.eventOn('order', b)
  api.eventMakeFirst('order', c)
  api.eventMakeLast('order', a)
  await api.eventEmitAndWait('order')
  assert.deepEqual(seen, ['c', 'b', 'a'])
  first.stop(); first.stop()
  api.eventMakeFirst('order', b)
  seen.length = 0
  await api.eventEmit('order')
  assert.deepEqual(seen, ['b', 'c'])
  assert.throws(() => api.eventOn('order', null), /监听器必须是函数/)
})

for (const kind of ['local', 'shared']) test(kind + ' eventEmitAndWait awaits ordered async callbacks and preserves thrown errors', async () => {
  const { window: api } = kind === 'local' ? local() : shared()
  const seen = [], original = new Error('original failure')
  let release, completed = false
  api.eventOn('save', async (value) => { seen.push(value); await new Promise(resolve => { release = resolve }); seen.push('saved') })
  api.eventOn('save', () => seen.push('next'))
  const pending = api.eventEmitAndWait('save', 'start').then(() => { completed = true })
  await tick()
  assert.equal(completed, false)
  assert.deepEqual(seen, ['start'])
  release(); await pending
  assert.deepEqual(seen, ['start', 'saved', 'next'])
  api.eventOn('sync-error', () => { throw original })
  api.eventOn('async-error', async () => { throw original })
  await assert.rejects(api.eventEmitAndWait('sync-error'), error => error === original)
  await assert.rejects(api.eventEmitAndWait('async-error'), error => error === original)
})

for (const kind of ['local', 'shared']) test(kind + ' eventWaitOnce registers immediately, resolves arguments and unsubscribes', async () => {
  const run = kind === 'local' ? local() : shared(), api = run.window
  const value = { retained: true }, pending = api.eventWaitOnce('next')
  await api.eventEmitAndWait('next', value, 2)
  const result = await pending
  assert.equal(result[0], value)
  assert.equal(result[1], 2)
  assert.equal(result.length, 2)
  if (run.bus) assert.deepEqual(Array.from(run.bus.names()), [])
  await api.eventEmitAndWait('next', 'again')
  assert.equal((await pending)[0], value)
})

for (const kind of ['local', 'shared']) test(kind + ' global wait really waits, skips bootstrap objects and returns the published value', async () => {
  const run = kind === 'local' ? local() : shared(), api = run.window
  let ready = false
  api.Mvu = { __dshBootstrap: true }
  const pending = api.waitGlobalInitialized('Mvu').then(value => { ready = true; return value })
  await tick()
  assert.equal(ready, false)
  await api.eventEmitAndWait('global_Mvu_initialized')
  await api.initializeGlobal('unrelated', {})
  assert.equal(ready, false)
  const real = { getMvuData() {} }
  await api.initializeGlobal('Mvu', real)
  assert.equal(await pending, real)
  assert.equal(await api.waitGlobalInitialized('Mvu'), real)
  for (const value of [null, false, 0, '']) {
    await api.initializeGlobal('value', value)
    assert.equal(await api.waitGlobalInitialized('value'), value)
  }
  if (run.bus) assert.deepEqual(Array.from(run.bus.names()), [])
})

test('pagehide rejects pending waits and releases their subscriptions without later callbacks', async () => {
  let onPagehide, removed = false
  const run = local({ addEventListener(name, listener) { assert.equal(name, 'pagehide'); onPagehide = listener },
    removeEventListener(name, listener) { removed = name === 'pagehide' && listener === onPagehide } })
  const waitingEvent = assert.rejects(run.window.eventWaitOnce('never'), error => error.name === 'AbortError')
  const waitingGlobal = assert.rejects(run.window.waitGlobalInitialized('never'), error => error.name === 'AbortError')
  onPagehide(); run.dispose()
  await Promise.all([waitingEvent, waitingGlobal])
  assert.equal(removed, true)
  assert.throws(() => run.window.eventOn('late', () => {}), error => error.name === 'AbortError')
  await assert.rejects(run.window.eventEmitAndWait('late'), error => error.name === 'AbortError')
  await assert.rejects(run.window.eventWaitOnce('late'), error => error.name === 'AbortError')
  await assert.rejects(run.window.waitGlobalInitialized('late'), error => error.name === 'AbortError')
})
