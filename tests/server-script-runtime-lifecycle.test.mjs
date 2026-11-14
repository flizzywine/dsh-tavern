import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createServerScriptExecutor} from '../tavern-plugin/lib/domain/server-script-executor.js'

class FakeChild extends EventEmitter {
  constructor(){ super(); this.connected = true; this.sent = []; this.killed = false; this.stderr = { setEncoding(){}, on(){} } }
  send(message, callback){ this.sent.push(message); if (callback) callback(); return true }
  kill(){ this.killed = true; this.connected = false; return true }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function harness({lingerMs = 50, reapIntervalMs = 5, busy = () => false, handle} = {}){
  const children = []
  let clock = 0
  const executor = createServerScriptExecutor({
    handle: handle || (async (req, res) => { res.end('{"ok":true}') }),
    subscribeSignals: () => () => {},
    busy,
    lingerMs,
    reapIntervalMs,
    spawn: () => { const child = new FakeChild(); children.push(child); return child },
    logger: { log(){}, warn(){}, error(){} },
    now: () => clock
  })
  return {executor, children, advance: ms => { clock += ms }}
}

// The child boots jsdom and the whole client bundle, so a player who pauses to
// read must not lose it: thirty seconds reaped it mid-play and every later
// card-script event paid a cold boot first.
test('an idle runtime outlives short pauses and only the configured window reaps it', async () => {
  const h = harness({lingerMs: 60 * 1000, reapIntervalMs: 5})
  h.executor.demand('s1')
  assert.equal(h.children.length, 1)
  assert.equal(h.executor.has('s1'), true)

  h.advance(55 * 1000)
  await delay(25)
  assert.equal(h.executor.has('s1'), true, 'a pause past the old 30s window keeps the runtime')

  h.executor.demand('s1')
  assert.equal(h.children.length, 1, 'demanding again reuses the live runtime')

  h.advance(61 * 1000)
  await delay(25)
  assert.equal(h.executor.has('s1'), false, 'the configured idle window still reaps it')
  assert.equal(h.children[0].killed, true)

  h.executor.demand('s1')
  assert.equal(h.children.length, 2, 'a later demand starts a fresh runtime')
  h.executor.dispose()
})

test('a busy session is never reaped under a running settlement', async () => {
  let busy = true
  const h = harness({lingerMs: 1000, reapIntervalMs: 5, busy: () => busy})
  h.executor.demand('s1')
  h.advance(5000)
  await delay(25)
  assert.equal(h.executor.has('s1'), true)
  busy = false
  await delay(25)
  assert.equal(h.executor.has('s1'), false)
  h.executor.dispose()
})

// The headless page loads the ordinary client bundle, and that bundle reads the
// game's settings. Refusing it made every boot log a 403 and left the page's
// own bootstrap to fail; the route is read-only and already session-pinned.
test('the sandbox may read settings but nothing outside its allow-list', async () => {
  const calls = []
  const h = harness({handle: async (req, res) => { calls.push(req.url); res.end('{"ok":true}') }})
  h.executor.demand('s1')
  const child = h.children[0]

  child.emit('message', {type: 'fetch', id: 1, path: '/api/dsh-tavern/getTavernSettings', method: 'POST', body: '{}'})
  await delay(5)
  const allowed = child.sent.find(message => message.type === 'fetch-result' && message.id === 1)
  assert.equal(allowed.status, 200)
  assert.equal('error' in allowed, false)
  assert.deepEqual(calls, ['/api/dsh-tavern/getTavernSettings'])

  child.emit('message', {type: 'fetch', id: 2, path: '/api/dsh-tavern/updateTavernSettings', method: 'POST', body: '{}'})
  await delay(5)
  const refused = child.sent.find(message => message.type === 'fetch-result' && message.id === 2)
  assert.equal(refused.status, 403)
  assert.equal(calls.length, 1, 'the refused route never reached the host handler')

  child.emit('message', {type: 'fetch', id: 3, path: '/api/dsh-tavern/vendor/polyfill.js', method: 'GET'})
  await delay(5)
  assert.equal(child.sent.find(message => message.type === 'fetch-result' && message.id === 3).status, 200)
  h.executor.dispose()
})
