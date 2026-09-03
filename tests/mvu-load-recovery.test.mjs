import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

let descriptor
vm.runInNewContext(await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console, AbortController, setTimeout, clearTimeout, URL
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

test('HTTP 200 JSON error is observed before the unchanged execution error, without logging its body', async () => {
  const records = [], original = new SyntaxError("Unexpected token ':'")
  const body = JSON.stringify({ ok: false, error: 'local bundle checksum mismatch', secret: 'BODY_SECRET', source: 'FULL_SCRIPT' })
  const loader = client.createMvuBundleLoader({
    fetch: async () => ({ ok: true, status: 200, url: 'http://localhost/bundle.js?token=URL_SECRET',
      headers: new Headers({ 'content-type': 'application/json', 'content-length': String(body.length) }), text: async () => body }),
    evaluate: async text => { assert.equal(text, body); throw original }, onDiagnostic: record => records.push(record)
  })
  await assert.rejects(loader.load('http://localhost/bundle.js?token=URL_SECRET'), error => error === original)
  const response = records.find(record => record.phase === 'download-completed')
  assert.equal(response.httpStatus, 200)
  assert.equal(response.contentType, 'application/json')
  assert.equal(response.bodyKind, 'json-error')
  assert.equal(response.serverError, 'local bundle checksum mismatch')
  assert.equal(records.at(-1).phase, 'execution-failed')
  assert.equal(records.at(-1).attempt, 1)
  assert.equal(records.at(-1).cycle, 1)
  assert.doesNotMatch(JSON.stringify(records), /BODY_SECRET|FULL_SCRIPT|URL_SECRET/)
})

test('diagnostic observer rejection cannot turn successful execution into retry or failure', async () => {
  let downloads = 0, evaluations = 0
  const loader = client.createMvuBundleLoader({ fetch: async () => { downloads++; return ok() },
    evaluate: async () => { evaluations++ }, onDiagnostic: async () => { throw Error('disk full') } })
  await loader.load('/bundle.js')
  await tick()
  assert.equal(downloads, 1)
  assert.equal(evaluations, 1)
})

test('HTTP failures retain original timing: no diagnostic-only body read; retries carry cycle and attempt', async () => {
  const records = []
  let available = false
  const loader = client.createMvuBundleLoader({ retryDelays: [0, 0],
    fetch: async () => available ? ok() : { ok: false, status: 503, headers: new Headers({ 'content-type': 'application/json' }), text: () => assert.fail('must not read extra body') },
    evaluate: async () => {}, onDiagnostic: r => records.push(r) })
  const pending = loader.load('/bundle.js')
  while (!records.some(r => r.phase === 'retry-exhausted')) await tick()
  assert.deepEqual(records.filter(r => r.phase === 'download-failed').map(r => [r.cycle, r.attempt, r.httpStatus]), [[1,1,503],[1,2,503],[1,3,503]])
  available = true
  loader.retry()
  await pending
  assert.equal(records.find(r => r.phase === 'execution-completed').cycle, 2)
})

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
