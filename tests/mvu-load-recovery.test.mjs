import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

let descriptor
vm.runInNewContext(await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console, AbortController, setTimeout, clearTimeout
})
const client = descriptor.factory(() => ({}))
const tick = () => new Promise(resolve => setImmediate(resolve))
function harness(fetch, evaluate = async () => {}) {
  const states = [], evaluations = []
  const loader = client.createMvuBundleLoader({ fetch, timeoutMs: 30, retryDelays: [0, 0],
    onState: state => states.push(state), evaluate: async source => { evaluations.push(source); await evaluate(source) } })
  return { loader, states, evaluations }
}
const ok = () => ({ ok: true, text: async () => 'bundle' })

test('recovery UI offers retry only for download failures', () => {
  const ui = descriptor.factory(name => name === 'react' ? { createElement: (tag, props, ...children) => ({ tag, props, children }) } : {})
  let clicks = 0
  const render = state => ui.TavernMvuLoadRecovery({ state, retry: () => clicks++ })
  const failed = render({ phase: 'failed', canRetry: true, error: 'HTTP 503' })
  const button = failed.children.find(child => child?.tag === 'button')
  assert.equal(button.children[0], '重新加载 MVU')
  button.props.onClick()
  assert.equal(clicks, 1)
  assert.match(JSON.stringify(failed), /自动继续/)
  for (const phase of ['loading', 'evaluating', 'error']) assert.equal(render({ phase }).children.some(child => child?.tag === 'button'), false)
  assert.equal(render({ phase: 'ready' }), null)
})

test('MVU download retries twice before evaluating exactly once', async () => {
  let attempts = 0
  const h = harness(async () => { if (++attempts < 3) throw Error('offline'); return ok() })
  await h.loader.load('/bundle.js')
  assert.equal(attempts, 3)
  assert.deepEqual(h.evaluations, ['bundle'])
  assert.equal(h.states.at(-1).phase, 'evaluating')
  assert.equal(h.loader.retry(), false)
})

test('exhaustion pauses before evaluation; manual retry resumes the same load only once', async () => {
  let attempts = 0, available = false
  const h = harness(async () => { attempts++; return available ? ok() : { ok: false, status: 503 } })
  const pending = h.loader.load('/bundle.js')
  while (h.states.at(-1)?.phase !== 'failed') await tick()
  assert.equal(attempts, 3)
  assert.equal(h.evaluations.length, 0)
  assert.equal(h.states.at(-1).canRetry, true)
  available = true
  assert.equal(h.loader.retry(), true)
  assert.equal(h.loader.retry(), false)
  await pending
  assert.equal(attempts, 4)
  assert.equal(h.evaluations.length, 1)
})

test('execution failure is terminal, never evaluated or downloaded again', async () => {
  let attempts = 0
  const h = harness(async () => { attempts++; return ok() }, async () => { throw Error('partial initialization') })
  await assert.rejects(h.loader.load('/bundle.js'), /partial initialization/)
  assert.equal(attempts, 1)
  assert.equal(h.loader.retry(), false)
  assert.equal(h.evaluations.length, 1)
})

test('disposal aborts paused downloads and rejects late completion without evaluation', async () => {
  let finish, signal
  const h = harness((_url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve }) })
  const pending = h.loader.load('/bundle.js')
  await tick()
  h.loader.dispose()
  finish(ok())
  await assert.rejects(pending, /disposed/)
  assert.equal(signal.aborted, true)
  assert.equal(h.evaluations.length, 0)
  assert.equal(h.loader.retry(), false)
})

test('timed out body reads do not evaluate late data and remain manually recoverable', async () => {
  const h = harness(async () => ({ ok: true, text: () => new Promise(() => {}) }))
  const pending = h.loader.load('/bundle.js')
  while (h.states.at(-1)?.phase !== 'failed') await tick()
  assert.match(h.states.at(-1).error, /超时/)
  h.loader.dispose()
  await assert.rejects(pending, /disposed/)
  assert.equal(h.evaluations.length, 0)
})
