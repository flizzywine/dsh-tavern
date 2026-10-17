import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

let descriptor
vm.runInNewContext(await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console, AbortController, setTimeout, clearTimeout, URL, TextDecoder
})
const client = descriptor.factory(() => ({}))
const tick = () => new Promise(resolve => setImmediate(resolve))
function harness(fetch, evaluate = async () => {}) {
  const states = [], evaluations = []
  const loader = client.createMvuBundleLoader({ fetch, timeoutMs: 30, retryDelays: [0, 0],
    onState: state => states.push(state), evaluate: async source => { evaluations.push(source); await evaluate(source) } })
  return { loader, states, evaluations }
}
const ok = () => ({ ok: true, headers: new Headers({ 'content-type': 'text/javascript' }), text: async () => 'bundle' })

test('HTTP 200 JSON error never executes; its cause is retained and manual recovery evaluates once', async () => {
  const records = []
  let available = false, evaluations = 0, paused
  const failed = new Promise(resolve => { paused = resolve })
  const body = JSON.stringify({ ok: false, error: 'local bundle checksum mismatch', secret: 'BODY_SECRET', source: 'FULL_SCRIPT' })
  const loader = client.createMvuBundleLoader({ retryDelays: [0, 0],
    fetch: async () => available ? ok() : ({ ok: true, status: 200, url: 'http://localhost/bundle.js?token=URL_SECRET',
      headers: new Headers({ 'content-type': 'application/json', 'content-length': String(body.length) }), text: async () => body }),
    evaluate: async text => { assert.equal(text, 'bundle'); evaluations++ }, onDiagnostic: record => records.push(record),
    onState: state => { if (state.phase === 'failed') paused(state) }
  })
  const pending = loader.load('http://localhost/bundle.js?token=URL_SECRET')
  const state = await Promise.race([failed, pending.then(() => assert.fail('must pause before execution'))])
  assert.match(state.error, /local bundle checksum mismatch/)
  const response = records.find(record => record.phase === 'download-completed')
  assert.equal(response.httpStatus, 200)
  assert.equal(response.contentType, 'application/json')
  assert.equal(response.bodyKind, 'json-error')
  assert.equal(response.serverError, 'local bundle checksum mismatch')
  assert.equal(records.at(-1).phase, 'retry-exhausted')
  assert.equal(records.at(-1).attempt, 3)
  assert.equal(records.at(-1).cycle, 1)
  assert.doesNotMatch(JSON.stringify(records), /BODY_SECRET|FULL_SCRIPT|URL_SECRET/)
  assert.equal(evaluations, 0)
  available = true
  loader.retry()
  await pending
  assert.equal(evaluations, 1)
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
  const h = harness(async () => ({ ...ok(), text: () => new Promise(() => {}) }))
  const pending = h.loader.load('/bundle.js')
  while (h.states.at(-1)?.phase !== 'failed') await tick()
  assert.match(h.states.at(-1).error, /超时/)
  h.loader.dispose()
  await assert.rejects(pending, /disposed/)
  assert.equal(h.evaluations.length, 0)
})
