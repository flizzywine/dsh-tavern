import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { logMvuRefreshDiagnostic, sanitizeMvuRefreshDiagnostic } from '../tavern-plugin/lib/domain/mvu-refresh-diagnostics.js'
import { createCoordinationEventPublisher } from '../tavern-plugin/lib/domain/coordination-event-publisher.js'

let descriptor
vm.runInNewContext(await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console })
const client = descriptor.factory(() => ({}))

test('diagnostics retain only bounded metadata and cannot break work when the logger fails', () => {
  const input = { stage: 'frame-receive', sessionId: 'session-test', token: 'token-1', revision: 3, currentRevision: -1, operationCount: Infinity, message: 'PRIVATE STORY', variables: { password: 'SECRET' }, event: 'private text', pageId: 'x'.repeat(161) }
  assert.deepEqual(sanitizeMvuRefreshDiagnostic(input), { stage: 'frame-receive', revision: 3, sessionId: 'session-test', token: 'token-1' })
  assert.equal(sanitizeMvuRefreshDiagnostic({ stage: 'PRIVATE STORY' }), null)
  const lines = []
  logMvuRefreshDiagnostic(input, { info(...args) { lines.push(args.join(' ')) } })
  assert.match(lines[0], /DEBUG-mvu-refresh-v1/)
  assert.doesNotMatch(lines[0], /PRIVATE|SECRET|password|variables/)
  assert.doesNotThrow(() => logMvuRefreshDiagnostic(input, { info() { throw Error('disk unavailable') } }))
})

test('client batches at most 100 events and a failed diagnostic request never retries', async () => {
  const timers = [], batches = [], fallback = []
  const trace = client.createMvuRefreshTrace({ schedule(run) { timers.push(run); return timers.length }, async send(batch) { batches.push(batch); throw Error('offline') }, fallback(batch) { fallback.push(batch) } })
  for (let revision = 0; revision < 150; revision++) trace('frame-send', { revision })
  assert.equal(timers.length, 1)
  await timers.shift()()
  assert.equal(batches.length, 1)
  assert.equal(batches[0].length, 100)
  assert.equal(batches[0][0].revision, 50)
  assert.equal(fallback.length, 1)
  assert.equal(timers.length, 0)
})

test('publisher diagnostics expose dedup without changing notification decisions', async () => {
  let revision = 1
  const stages = [], delivered = []
  const publisher = createCoordinationEventPublisher({ load: async () => ({ diagnosticRevision: revision, activity: { phase: 'idle' } }), startInterval() { return 1 }, stopInterval() {}, onTrace(entry) { stages.push(entry); throw Error('probe failure') } })
  const close = publisher.subscribe('session-test', snapshot => delivered.push(snapshot))
  await new Promise(resolve => setImmediate(resolve))
  revision = 2
  await publisher.publish('session-test')
  close()
  assert.equal(delivered.length, 1)
  assert.deepEqual(stages.map(entry => entry.stage), ['server-subscribe', 'server-publish', 'server-dedup', 'server-unsubscribe'])
  assert.equal(stages[2].revision, 2)
})

test('real iframe shim reports receive, apply, listeners, DOM changes, and mismatch without logging content', async () => {
  const before = { version: 1, stateRevision: 1, messages: [{ variables: { stat_data: { value: 'PRIVATE-A' } } }], turnMessageIds: { 1: 0 } }
  const after = structuredClone(before)
  after.stateRevision = 2
  after.messages[0].variables.stat_data.value = 'PRIVATE-B'
  const posts = [], handlers = {}
  let mutations
  const parent = { postMessage(data) { posts.push(data) } }
  const sandbox = { parent, structuredClone, console, document: { documentElement: {} }, addEventListener(name, callback) { handlers[name] = callback }, MutationObserver: class { constructor(callback) { mutations = callback } observe() {} disconnect() {} } }
  sandbox.window = sandbox
  const html = client.buildTavernFrameDocument({ content: '<p>status</p>', token: 'probe', helperContext: before, turn: 1, refreshDiagnostics: true })
  const shim = html.match(/<script data-dsh-tavern-helper>([\s\S]*?)<\/script>/)[1].replace(/import\("[^"]+"\)/, 'Promise.resolve({})')
  vm.runInNewContext(shim, sandbox)
  let displayed
  sandbox.eventOn('mag_variable_update_ended', () => { displayed = sandbox.Mvu.getMvuData().stat_data.value; mutations([{}]) })
  const update = client.createTavernHelperContextUpdate(before, after, 1, 1)
  const deliver = () => handlers.message({ source: parent, data: { type: 'dsh-tavern-helper-context-update', token: 'probe', update } })
  deliver()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(displayed, 'PRIVATE-B')
  assert.deepEqual(posts.filter(item => item.entry).map(item => item.entry.stage), ['frame-receive', 'frame-applied', 'frame-event-start', 'frame-event-end', 'frame-event-start', 'frame-dom', 'frame-event-end'])
  assert.equal(posts.find(item => item.entry?.stage === 'frame-event-start' && item.entry.event === 'mag_variable_update_ended').entry.listenerCount, 1)
  assert.doesNotMatch(JSON.stringify(posts), /PRIVATE|stat_data/)
  deliver()
  assert.equal(posts.at(-2).entry.stage, 'frame-reject')
  assert.equal(posts.at(-1).type, 'dsh-tavern-helper-context-request')
  assert.equal(posts.some(item => item.type === 'dsh-tavern-helper-call'), false)
})
