import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { endpointHistory, ENDPOINT_HISTORY_LIMIT } from '../src/endpoint-history.js'
import { createServiceSettings } from '../src/settings.js'
import { handleControl } from '../src/routes.js'

// An in-memory DSH credential store (resolve / set / unset / describe), counting writes.
function store(initial = {}) {
  const refs = new Map(Object.entries(initial)), log = { writes: 0 }
  return { refs, log, api: {
    resolve: async ref => refs.has(ref) ? { value: refs.get(ref) } : undefined,
    set: async (ref, value) => { log.writes++; refs.set(ref, value) },
    unset: async ref => { log.writes++; refs.delete(ref) },
    describe: async ref => ({ configured: refs.has(ref), writable: true }),
  } }
}

test('最近用过的连接: latest first, at most 5, one rename / forget / clear, keys shown as their last 4 characters', async () => {
  const s = store(), clock = { t: 0 }, ids = { n: 0 }
  const h = endpointHistory(() => s.api, 'DSH_TAVERN_TTS_FISH_RECENT', { now: () => ++clock.t, newId: () => 'e' + ++ids.n })
  assert.deepEqual(await h.list(), [])
  await h.remember({ url: 'http://127.0.0.1:9884', key: '' })
  await h.remember({ url: 'https://api.fish.audio', key: 'sk-cloud-0000-1234' })
  let list = await h.list({ url: 'https://api.fish.audio', key: 'sk-cloud-0000-1234' })
  assert.deepEqual(list.map(e => [e.label, e.keyTail, e.keyed, !!e.current]), [['api.fish.audio', '1234', true, true], ['127.0.0.1:9884', '', false, false]])
  assert.equal(JSON.stringify(list).includes('sk-cloud'), false)
  // the latest again: nothing written
  const writes = s.log.writes
  assert.equal(await h.remember({ url: 'https://api.fish.audio', key: 'sk-cloud-0000-1234' }), false)
  assert.equal(s.log.writes, writes)
  // an older pair used again moves to the front with its name
  await h.rename('e1', ' 本地 ')
  await h.remember({ url: 'http://127.0.0.1:9884', key: '' })
  assert.deepEqual((await h.list()).map(e => e.label), ['本地', 'api.fish.audio'])
  // same address, another key: a pair of its own
  await h.remember({ url: 'https://api.fish.audio', key: 'sk-other-9999-5678' })
  for (const n of [1, 2, 3, 4]) await h.remember({ url: 'https://relay' + n + '.example', key: 'relay-key-000' + n })
  list = await h.list()
  assert.equal(list.length, ENDPOINT_HISTORY_LIMIT)
  assert.deepEqual(list.map(e => e.url), ['https://relay4.example', 'https://relay3.example', 'https://relay2.example', 'https://relay1.example', 'https://api.fish.audio'])
  assert.deepEqual(await h.take(list[4].id), { url: 'https://api.fish.audio', key: 'sk-other-9999-5678' })
  await h.forget(list[0].id)
  assert.equal((await h.list()).length, 4)
  await assert.rejects(h.take('missing'), { code: 'ENDPOINT_NOT_FOUND' })
  await h.rename(list[1].id, '')
  assert.equal((await h.list())[0].label, 'relay3.example')
  await h.clear()
  assert.deepEqual(await h.list(), [])
  assert.equal(s.refs.has('DSH_TAVERN_TTS_FISH_RECENT'), false)
})

test('a working check records the pair; picking a recorded pair saves its Base URL and API Key together; nothing leaks', async t => {
  const auth = []
  const server = createServer((req, res) => { auth.push(req.headers.authorization || ''); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ models: [{ id: 'drama-3', label: 'Drama 3' }], state: 'ready' })) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const local = `http://127.0.0.1:${server.address().port}`, relay = `http://localhost:${server.address().port}`
  const s = store({ DSH_TAVERN_TTS_FISH_LOCAL_KEY: 'relay-secret-key-4321' })
  let settings = { enabled: true, providers: [{ id: 'fish-local', kind: 'fish-audio', label: '本地 Drama3', config: { url: relay } }], voices: [], cacheMaxGB: 1, cacheMaxAgeDays: 30 }
  const warnings = []
  const services = createServiceSettings({ get: () => settings, replace: async value => { settings = value }, credentials: () => s.api, warn: m => warnings.push(m), tts: { registerVoiceSource: () => ({ dispose() {} }), registerProvider: () => () => {}, providerVoiceSources: () => [], listServiceVoices: () => [], exportVoicePresets: () => [] } })
  t.after(() => services.dispose())
  assert.equal((await services.test({ id: 'fish-local' })).ok, true)
  // the local worker, typed in with no key, then checked
  let row = (await services.list())[0]
  row = await services.save({ id: 'fish-local', kind: 'fish-audio', label: row.label, config: { url: local }, secrets: { key: '' }, expectedRevision: row.revision })
  assert.equal((await services.test({ id: 'fish-local' })).ok, true)
  row = (await services.list())[0]
  assert.deepEqual(row.recent.map(e => [e.url, e.keyTail, !!e.current]), [[local, '', true], [relay, '4321', false]])
  // a switch: one save of both, and the next request goes to that address with that key
  auth.length = 0
  row = await services.useEndpoint({ id: 'fish-local', entry: row.recent[1].id, expectedRevision: row.revision })
  assert.equal(row.config.url, relay)
  assert.equal(row.label, '本地 Drama3')
  assert.deepEqual(row.recent.map(e => [e.url, !!e.current]), [[relay, true], [local, false]])
  assert.equal(s.refs.get('DSH_TAVERN_TTS_FISH_LOCAL_KEY'), 'relay-secret-key-4321')
  await services.test({ id: 'fish-local' })
  assert.ok(auth.length && auth.every(a => a === 'Bearer relay-secret-key-4321'))
  // and back: the keyless pair clears the stored key
  row = await services.useEndpoint({ id: 'fish-local', entry: row.recent[1].id, expectedRevision: row.revision })
  assert.equal(row.config.url, local); assert.equal(s.refs.has('DSH_TAVERN_TTS_FISH_LOCAL_KEY'), false)
  // a stale revision is refused like any save
  await assert.rejects(services.useEndpoint({ id: 'fish-local', entry: row.recent[1].id, expectedRevision: 'stale' }), { code: 'REVISION_CONFLICT' })
  // the key never reaches settings, the services list or a log line
  const listed = JSON.stringify(await services.list())
  assert.equal(listed.includes('relay-secret'), false)
  assert.equal(JSON.stringify(settings).includes('relay-secret'), false)
  const lines = []
  const request = body => new Request('http://127.0.0.1/api/dsh-tts/v1/control', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1', Host: '127.0.0.1' }, body: JSON.stringify(body) })
  await handleControl(request({ method: 'useEndpoint', args: { id: 'fish-local', entry: 'missing', key: 'relay-secret-key-4321' } }), async () => { throw Object.assign(new Error('relay-secret-key-4321'), { code: 'ENDPOINT_NOT_FOUND' }) }, { warn: (...a) => lines.push(a.join(' ')) })
  assert.equal(lines.length, 1); assert.equal(lines[0].includes('relay-secret'), false)
  assert.equal(warnings.join().includes('relay-secret'), false)
  // 清空记录 / one entry
  await services.forgetEndpoint({ id: 'fish-local', entry: row.recent[1].id })
  assert.equal((await services.list())[0].recent.length, 1)
  assert.deepEqual(await services.clearEndpoints({ id: 'fish-local' }), { recent: [] })
  // a service without a Base URL keeps no list
  settings = { ...settings, providers: [...settings.providers, { id: 'qwen', kind: 'qwen', label: '通义千问', config: { region: 'cn' } }] }
  assert.equal(Object.hasOwn((await services.list()).find(p => p.id === 'qwen'), 'recent'), false)
  await assert.rejects(services.useEndpoint({ id: 'qwen', entry: 'x' }), { code: 'INVALID_INPUT' })
})
