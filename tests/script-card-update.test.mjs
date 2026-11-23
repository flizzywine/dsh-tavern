import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createScriptCardUpdate } from '../tavern-plugin/lib/domain/script-card-update.js'

const source = await readFile(new URL('../tavern-plugin/src/client/modules/script-card-update.js', import.meta.url), 'utf8')
const api = vm.runInNewContext(source + ';({ installTavernScriptCardUpdate, tavernScriptCardSource, tavernScriptCardVersions, tavernScriptCardChanges })', { URL })

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])
const world = { entries: { 0: { uid: 0, comment: '默认user（玩家）', key: [], content: '我', disable: false }, 1: { uid: 1, comment: '学校', key: ['校园'], content: '旧' } } }
const card = () => ({ spec: 'chara_card_v3', data: { name: 'Self Update', character_version: '', description: 'old', extensions: { world: 'Book', card_update: { version: '4.2.0' }, tavern_helper: { scripts: [{ id: 'a', content: '1' }] } } } })

function harness() {
  const calls = [], asked = []
  let current = card()
  const original = async url => { calls.push(['fetch', url]); return new Response(new Blob([PNG]), { status: 200, headers: { 'Content-Type': 'image/png' } }) }
  const win = { fetch: original, location: { href: 'dsh-app://app/', origin: 'dsh-app://app', protocol: 'dsh-app:', host: 'app' }, URL, Response, Blob, atob, btoa, __dshTavernSelectedSessionId: 's1' }
  const rpc = async (method, args, sessionId) => {
    calls.push([method, sessionId])
    if (method === 'getScriptCard') return structuredClone({ path: 'cards/self-update.json', card: current, worldName: current.data.extensions.world, world: current.data.extensions.world === 'Book' ? world : args.world })
    if (method === 'replaceScriptCard') { current = args.card; calls.push(['replaced', args]); return { card: { path: 'cards/self-update.json', backupPath: 'b.dshcard' } } }
  }
  const updated = []
  const stop = api.installTavernScriptCardUpdate({ window: win, rpc, ask: async request => { asked.push(request); return request.apply().then(() => true) }, onUpdated: id => updated.push(id) })
  const post = async (path, body) => {
    const form = body instanceof FormData
    const response = await win.fetch(new URL(path, win.location.origin).href, { method: 'POST', headers: form ? {} : { 'Content-Type': 'application/json' }, body: form ? body : JSON.stringify(body) })
    return { status: response.status, text: await response.text() }
  }
  const write = (id, value, cover) => { const form = new FormData(); form.set('avatar_url', id); form.set('json_data', JSON.stringify(value)); if (cover) form.set('avatar', new Blob([cover]), id); return post('/api/characters/edit', form) }
  return { win, calls, asked, updated, stop, post, write, original }
}

test('a self-updating card script backs up, writes its new world book and card, and lands as one confirmed DSH card update', async () => {
  const h = harness(), id = 'Self Update.png'
  const before = JSON.parse((await h.post('/api/characters/get', { avatar_url: id })).text)
  assert.equal(before.data.extensions.world, 'Book')
  assert.equal(JSON.parse((await h.post('/api/worldinfo/get', { name: 'Book' })).text).entries[1].content, '旧')
  assert.deepEqual(JSON.parse((await h.post('/api/settings/get', {})).text).world_names, ['Book'])
  // The script's own backup stays a pending copy: no DSH card is created for it.
  await h.post('/api/worldinfo/edit', { name: '【旧】Book', data: world })
  const copy = JSON.parse((await h.post('/api/characters/duplicate', { avatar_url: id })).text).path
  assert.match(copy, /\.png$/); assert.notEqual(copy, id)
  assert.equal((await h.write(copy, { ...before, data: { ...before.data, name: '【旧】Book' } }, PNG)).status, 200)
  assert.equal(JSON.parse((await h.post('/api/characters/get', { avatar_url: copy })).text).data.name, '【旧】Book')
  // The new book reads back exactly as written, before the card is.
  const fresh = { entries: { 0: world.entries[0], 1: { ...world.entries[1], content: '新' }, 2: { uid: 2, comment: '车站', key: [], content: '新增' } } }
  await h.post('/api/worldinfo/edit', { name: 'Book', data: fresh })
  assert.deepEqual(JSON.parse((await h.post('/api/worldinfo/get', { name: 'Book' })).text), fresh)
  assert.equal(h.calls.filter(call => call[0] === 'replaced').length, 0)
  const after = structuredClone(before); after.data.description = 'new'; after.data.extensions.card_update = { version: '4.3.0' }; after.data.extensions.tavern_helper.scripts[0].content = '2'
  assert.equal((await h.write(id, after, new Uint8Array([...PNG, 2]))).status, 200)
  const [request] = h.asked
  assert.equal(request.current.version, '4.2.0'); assert.equal(request.incoming.version, '4.3.0')
  assert.deepEqual([...request.changes], ['改写：人物描述', '世界书：新增 1、改动 1 条', '卡内脚本：改动 1 条', '换封面图'])
  const replaced = h.calls.find(call => call[0] === 'replaced')[1]
  assert.deepEqual(JSON.parse(JSON.stringify(replaced.world)), fresh); assert.equal(replaced.card.data.description, 'new'); assert.ok(replaced.cover)
  assert.deepEqual(h.updated, ['s1'])
  assert.equal(JSON.parse((await h.post('/api/characters/get', { avatar_url: id })).text).data.extensions.card_update.version, '4.3.0')
  // Writing back what the card already is (a script's rollback) asks nothing.
  const now = JSON.parse((await h.post('/api/characters/get', { avatar_url: id })).text)
  assert.equal((await h.write(id, now)).status, 200)
  assert.equal(h.asked.length, 1)
})

test('a declined update reaches the script as a failed write and changes nothing', async () => {
  const h = harness()
  h.stop()
  const win = h.win, calls = []
  win.fetch = h.original
  api.installTavernScriptCardUpdate({ window: win, rpc: async method => { calls.push(method); return { path: 'cards/self-update.json', card: card(), worldName: 'Book', world } }, ask: async () => false })
  const next = card(); next.data.description = 'x'
  const form = new FormData(); form.set('avatar_url', 'Self Update.png'); form.set('json_data', JSON.stringify(next))
  const response = await win.fetch('/api/characters/edit', { method: 'POST', body: form })
  assert.equal(response.status, 409)
  assert.ok(!calls.includes('replaceScriptCard'))
})

test('only the card of the conversation on screen answers; other routes and other cards pass through or are not found', async () => {
  const h = harness()
  await h.win.fetch('/api/dsh-tavern/listCards', {})
  assert.deepEqual(h.calls[0], ['fetch', '/api/dsh-tavern/listCards'])
  assert.equal((await h.post('/api/characters/get', { avatar_url: 'Other.png' })).status, 404)
  h.win.__dshTavernSelectedSessionId = ''
  await h.win.fetch('/api/characters/get', {})
  assert.deepEqual(h.calls.at(-1), ['fetch', '/api/characters/get'])
})

test('the confirmation names the script the update comes from', () => {
  const stack = 'Error\n    at fetch (dsh-app://app/api/dsh-tavern/client.js:1:2)\n    at post (https://updates.example/ui/full-update.mjs:28:120)'
  assert.equal(api.tavernScriptCardSource(stack, 'dsh-app://app'), 'https://updates.example')
  assert.equal(api.tavernScriptCardSource('Error\n at x (dsh-app://app/a.js:1:1)', 'dsh-app://app'), '')
  assert.deepEqual([...api.tavernScriptCardVersions({ data: { character_version: '1' } }, { data: { character_version: '2' } })], ['1', '2'])
})

test('the server keeps the player\'s DSH settings of the card and carries the written world book into it', async () => {
  let replaced
  const update = createScriptCardUpdate({
    presentCardText: async () => ({ document: { spec: 'chara_card_v3', data: { name: 'A', extensions: {}, character_book: { name: 'Book', entries: [{ id: 0, keys: ['k'], content: 'c', enabled: true, insertion_order: 100, extensions: {} }, { id: 1, keys: [], content: 'bubbles', enabled: true, extensions: { dsh_tavern_helper_extra: { forkDialogueBubbles: { version: 1 } } } }] } } } }),
    readCardWorkspace: async () => ({ raw: { spec: 'chara_card_v3', data: { name: 'A', extensions: { dsh_tavern: { assetBindings: { boundPackIds: ['p'] } } } } } }),
    readCardImage: async () => Buffer.from('old'),
    replaceCard: async (path, input) => { replaced = { path, input }; return { path } }
  })
  const read = await update.read('cards/a.json')
  assert.equal(read.worldName, 'Book'); assert.equal(read.card.data.extensions.world, 'Book')
  assert.equal(read.world.entries[0].content, 'c'); assert.equal(Object.keys(read.world.entries).length, 1); assert.equal(read.world.originalData, undefined)
  const next = { spec: 'chara_card_v3', data: { name: 'A', extensions: { world: 'Book2', dsh_tavern: { injected: true } } } }
  await update.replace('cards/a.json', { card: next, world: { entries: { 0: { uid: 0, key: ['k2'], content: 'c2', comment: '' } } }, cover: '' })
  assert.equal(replaced.path, 'cards/a.json')
  const stored = JSON.parse(Buffer.from(replaced.input.payload.b64, 'base64').toString('utf8'))
  assert.deepEqual(stored.data.extensions.dsh_tavern, { assetBindings: { boundPackIds: ['p'] } })
  assert.equal(stored.data.character_book.name, 'Book2'); assert.equal(stored.data.character_book.entries[0].content, 'c2')
  assert.equal(Buffer.from(replaced.input.payload.fileB64, 'base64').toString(), 'old')
})
