import assert from 'node:assert/strict'
import test from 'node:test'
import { imagePluginFixture } from './fixtures/image-plugin-runtime.mjs'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

test('settings progress polling skips hidden pages, prevents overlap, preserves drafts and refreshes once at completion', async () => {
  const source = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-image-bundled/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('// Poll only progress while a task runs.')
  const effect = source.slice(start, source.indexOf('// 画廊也列出', start))
  const dataRef = { current: { tasks: [{ state: 'running' }], definitions: { draft: true }, outfits: ['draft'] } }
  const listeners = new Map(), calls = [], errors = []
  let poll, cleanup, finish, refreshes = 0, cleared = false
  const document = { hidden: true, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
  vm.runInNewContext(effect, {
    React: { useEffect: setup => { cleanup = setup() } }, dataRef, document, BASE: '/plugin',
    setInterval(fn) { poll = fn; return 1 }, clearInterval() { cleared = true },
    jsonFetch: url => { calls.push(url); return new Promise(resolve => { finish = resolve }) },
    refresh: async () => { refreshes++ }, setData: update => { dataRef.current = update(dataRef.current) }, setNote: note => errors.push(note),
  })
  await poll()
  assert.equal(calls.length, 0)
  document.hidden = false
  const pending = poll()
  await poll()
  assert.equal(calls.length, 1)
  finish({ tasks: [{ state: 'running', label: 'next' }] })
  await pending
  assert.equal(dataRef.current.tasks[0].label, 'next')
  assert.equal(dataRef.current.definitions.draft, true)
  assert.deepEqual(dataRef.current.outfits, ['draft'])
  const complete = listeners.get('visibilitychange')()
  finish({ tasks: [{ state: 'done' }] })
  await complete
  assert.equal(refreshes, 1)
  const late = poll()
  cleanup()
  finish({ tasks: [{ state: 'running', label: 'late' }] })
  await late
  assert.equal(dataRef.current.tasks[0].label, 'next')
  assert.equal(cleared, true)
  assert.equal(listeners.size, 0)
  assert.deepEqual(errors, [])
})

test('progress polling omits libraries and diagnostics, and follows task completion without calling image APIs', async t => {
  let release, started
  const ready = new Promise(resolve => { started = resolve })
  const llm = { async *stream() {
    started()
    await new Promise(resolve => { release = resolve })
    yield { type: 'text-delta', text: '' }
  } }
  const fixture = await imagePluginFixture(t, { llm, definitions: {
    characters: Array.from({ length: 100 }, (_, i) => ({ id: 'c' + i, name: '角色' + i, traits: { face: '黑色长发。'.repeat(400) } })),
  } })
  globalThis.fetch = async () => { throw new Error('progress must not contact an image provider') }
  const runtime = await fixture.start()
  const initial = await runtime.request('runtime')
  assert.deepEqual(initial.body, { ok: true, tasks: [] })
  const full = await runtime.request('state')
  assert.equal(full.status, 200)
  assert.ok(full.bytes.length > initial.bytes.length * 1000)
  t.diagnostic(`100-character fixture: /state ${full.bytes.length} bytes; idle /runtime ${initial.bytes.length} bytes`)
  const design = runtime.request('design', { useCard: false, brief: '角色' })
  t.after(() => release?.())
  await ready
  const running = await runtime.request('runtime')
  assert.equal(running.body.tasks[0].state, 'running')
  assert.deepEqual(Object.keys(running.body).sort(), ['ok', 'tasks'])
  release()
  await design
  const finished = await runtime.request('runtime')
  assert.equal(finished.body.tasks[0].id, running.body.tasks[0].id)
  assert.equal(finished.body.tasks[0].state, 'done')
  assert.ok(finished.bytes.length < 1000)
  assert.equal((await runtime.request('runtime', {})).status, 405)
})
