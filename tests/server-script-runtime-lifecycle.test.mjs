import test from 'node:test'
import assert from 'node:assert/strict'
import {fork} from 'node:child_process'
import {EventEmitter} from 'node:events'
import {createServerScriptExecutor} from '../tavern-plugin/lib/domain/server-script-executor.js'
import {registerTavernHttpRoutes} from '../tavern-plugin/lib/http/routes.js'

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

// The sandbox exposes only what a card page needs. Reads and writes outside that
// set are refused before they reach the host handler.
test('the sandbox may reach its own allow-list and nothing else', async () => {
  const calls = []
  const h = harness({handle: async (req, res) => { calls.push(req.url); res.end('{"ok":true}') }})
  h.executor.demand('s1')
  const child = h.children[0]

  child.emit('message', {type: 'fetch', id: 1, path: '/api/dsh-tavern/getSession', method: 'POST', body: '{}'})
  await delay(5)
  const allowed = child.sent.find(message => message.type === 'fetch-result' && message.id === 1)
  assert.equal(allowed.status, 200)
  assert.equal('error' in allowed, false)
  assert.deepEqual(calls, ['/api/dsh-tavern/getSession'])

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

test('a worker reads the pinned session and streamed vendor assets without browser credentials', async t => {
  let internal, external, seen
  const webServer = { register(route) { if (route.path === '/api/dsh-tavern') external = route.handler; return () => {} } }
  const connection = { requestRejection: () => 403 }
  registerTavernHttpRoutes({
    ctx: { get: name => ({ webServer, connection })[name], effect: fn => fn() }, str: String,
    runtimeReadiness: { ok: true }, exposeHandler: fn => { internal = fn },
    dispatch: async (method, args, authority) => { seen = { method, args, authority }; return { view: {} } },
  })
  const h = harness({ handle: internal })
  t.after(() => h.executor.dispose())
  h.executor.demand('s1')
  const child = h.children[0]
  async function request(id, path, method = 'GET', body) {
    child.emit('message', { type: 'fetch', id, path, method, body })
    for (let tries = 0; tries < 100; tries++) {
      const reply = child.sent.find(row => row.type === 'fetch-result' && row.id === id)
      if (reply) return reply
      await delay(5)
    }
    throw new Error('No reply from service')
  }

  const publicStatus = await new Promise(resolve => external({
    url: '/api/dsh-tavern/getSession', method: 'POST', headers: { host: 'tavern.invalid' },
  }, { writeHead(code) { this.status = code }, end() { resolve(this.status) } }))
  assert.equal(publicStatus, 403)
  assert.equal(seen, undefined)
  assert.equal((await request(1, '/api/dsh-tavern/getSession', 'POST', '{"sessionId":"different"}')).status, 200)
  assert.deepEqual(seen, { method: 'getSession', args: { sessionId: 's1' }, authority: { origin: undefined } })
  const asset = await request(2, '/api/dsh-tavern/vendor/runtime-assets/zod/index.mjs')
  assert.equal(asset.status, 200)
  assert.equal(Number(asset.headers['content-length']), Buffer.from(asset.body, 'base64').length)
  assert.ok(Buffer.from(asset.body, 'base64').length > 0)
  assert.equal((await request(3, '/api/dsh-tavern/getSessionOther', 'POST')).status, 403)
})

test('an unhandled card promise rejection is reported and leaves the worker responsive', { timeout: 15_000 }, async t => {
  let handle, worker, ready = false, reported = false, written = false
  registerTavernHttpRoutes({
    ctx: { get: () => undefined }, str: String, runtimeReadiness: { ok: true }, exposeHandler: fn => { handle = fn },
    async dispatch(method, args) {
      if (method === 'getSession') return { view: { chatId: 'fixture',
        tavernHelper: { chatId: 'fixture', messages: [] }, tavernHelperScripts: [{ id: 'fixture', content: `
          void replaceVariables({fixture:'rejected'}, {type:'chat'});
          setTimeout(() => { void replaceVariables({fixture:'after'}, {type:'chat'}); }, 200);
        ` }] } }
      if (method === 'updateTavernHelperVariables') {
        if (JSON.stringify(args).includes('"rejected"')) throw new Error('fixture rejected write')
        written = true
      }
      if (method === 'recordMvuRuntimeDiagnostic' && args.diagnostic?.message === 'fixture rejected write') reported = true
      if (method === 'claimTavernScriptWork') {
        ready ||= args.ready === true
        return { active: true, ready: args.ready, event: null }
      }
      return {}
    },
  })
  const executor = createServerScriptExecutor({ handle, subscribeSignals: () => () => {}, logger: { log(){}, warn(){}, error(){} },
    spawn(file, args, options) {
      // Resolve dependencies from the test checkout even when its package store is symlinked.
      worker = fork(file, args, { ...options, execArgv: ['--experimental-vm-modules'], env: { ...options.env, NODE_OPTIONS: process.env.NODE_OPTIONS } })
      return worker
    },
  })
  t.after(() => executor.dispose())
  executor.demand('fixture-session')
  for (let attempt = 0; attempt < 100 && worker.exitCode === null && !(ready && reported && written); attempt++) await delay(100)
  assert.equal(worker.exitCode, null, 'the card error must not exit the worker')
  assert.deepEqual({ ready, reported, written }, { ready: true, reported: true, written: true })
})
