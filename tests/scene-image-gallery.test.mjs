import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginMedia } from '../tavern-plugin/lib/domain/plugin-media.js'
import { createPluginMediaViews } from '../tavern-plugin/lib/domain/plugin-media-views.js'
import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'
import { registerTavernHttpRoutes } from '../tavern-plugin/lib/http/routes.js'
import { createMediaHandlers } from '../tavern-plugin/lib/rpc/media.js'

function memoryStore() {
  const files = new Map()
  return {
    async readJson(path) { return files.has(path) ? structuredClone(files.get(path)) : undefined },
    async updateJson(path, updater) {
      const next = await updater(files.has(path) ? structuredClone(files.get(path)) : undefined)
      if (next !== undefined) files.set(path, structuredClone(next))
      return next
    },
    async remove(path) { files.delete(path) }
  }
}

const str = value => value == null ? '' : String(value)

function productionGallery({ pluginMedia, pluginTurns, sessionSignals, ...options }) {
  return createPluginMediaViews({ pluginMedia, pluginTurns, sessionSignals, ...options, attachments: () => null })
}

function productionRemoveHistoryRpc({ removePluginGalleryItems }) {
  const handlers = createMediaHandlers({ removePluginGalleryItems, str })
  return args => handlers.removeSceneImageHistory(args)
}

test('production plugin gallery filters by game, current text version, ready image status, and removes only that game', async () => {
  const store = memoryStore(), media = createPluginMedia({ store })
  const current = new Map([['session-a:1', 'key-a-now'], ['session-a:2', 'key-a-2'], ['session-b:1', 'key-b-now']])
  const games = new Map([['session-a', { sessionId: 'session-a', chatId: 'chat-a' }], ['session-b', { sessionId: 'session-b', chatId: 'chat-b' }]])
  const notifications = []
  const pluginTurns = {
    async resolveGame(sessionId) { return games.get(sessionId) || null },
    async currentKey(sessionId, turn) { return current.get(`${sessionId}:${turn}`) || null }
  }
  const signals = { publish(...args) { notifications.push(args) } }
  const gallery = await productionGallery({ pluginMedia: media, pluginTurns, sessionSignals: signals,
    resolveGalleryContext: async sessionId => games.has(sessionId) ? { sessionId, cardPath: '/cards/a.json' } : null })
  let serial = 0
  async function add({ chatId, sessionId, turn = 1, key, status = 'ready', mediaType = 'image/png' }) {
    if (key !== await pluginTurns.currentKey(sessionId, turn)) await media.issue(chatId, turn, key)
    const isImage = mediaType.startsWith('image/')
    return media.attach({ chatId, sessionId, owner: 'image-plugin', turn, key,
      currentKey: await pluginTurns.currentKey(sessionId, turn), item: {
        kind: isImage ? 'image' : 'audio', status, caption: `item-${++serial}`,
        ...(status === 'ready' ? { attachment: isImage
          ? { attachmentId: `attachment-${serial}`, mediaType, bytes: 1 }
          : { attachmentId: `attachment-${serial}`, name: 'sound.mp3', bytes: 1 } } : {})
      } })
  }
  const visible = await add({ chatId: 'chat-a', sessionId: 'session-a', key: 'key-a-now' })
  const otherGame = await add({ chatId: 'chat-b', sessionId: 'session-b', key: 'key-b-now' })
  await add({ chatId: 'chat-a', sessionId: 'session-a', key: 'key-a-now', status: 'pending' })
  await add({ chatId: 'chat-a', sessionId: 'session-a', key: 'key-a-now', status: 'failed' })
  await add({ chatId: 'chat-a', sessionId: 'session-a', key: 'key-a-now', mediaType: 'audio/mpeg' })
  const stale = await add({ chatId: 'chat-a', sessionId: 'session-a', key: 'key-a-old' })
  const swipeOld = await add({ chatId: 'chat-a', sessionId: 'session-a', turn: 2, key: 'key-a-2' })
  current.set('session-a:2', 'key-a-swiped')

  const listed = await gallery.pluginGalleryItems('session-a')
  assert.deepEqual(listed.map(item => item.id), [visible.id])
  assert.deepEqual(await gallery.pluginGalleryItems('session-b').then(items => items.map(item => item.id)), [otherGame.id])
  assert.deepEqual(await gallery.pluginGalleryItems('missing'), [])

  const crossGame = await gallery.removePluginGalleryItems('session-a', [otherGame.id])
  assert.equal(crossGame[0].ok, false)
  assert.ok(await media.find('chat-b', otherGame.id), 'another session item remains intact')
  assert.equal(notifications.length, 0, 'failed cross-game removal does not notify')

  const results = await gallery.removePluginGalleryItems('session-a', ['missing-id', stale.id, swipeOld.id, visible.id])
  assert.deepEqual(results.map(item => item.ok), [false, true, true, true])
  assert.match(results[0].error, /不存在/)
  assert.equal(await media.find('chat-a', visible.id), null)
  assert.equal(await media.find('chat-a', stale.id), null)
  assert.equal(await media.find('chat-a', swipeOld.id), null)
  assert.equal(notifications.length, 1, 'successful removal batch publishes one gallery change')
  assert.deepEqual(notifications[0][0], 'session-a')
  assert.equal(notifications[0][1].kind, 'plugin-media')
})

test('production removeSceneImageHistory deletes only plugin pictures, at most 500, in the given game', async () => {
  const pluginCalls = []
  const removePluginGalleryItems = async (sessionId, ids) => { pluginCalls.push({ sessionId, ids }); return ids.map(id => ({ versionId: id, ok: true })) }
  const rpc = productionRemoveHistoryRpc({ removePluginGalleryItems })
  await assert.rejects(rpc({ sessionId: 'session-a', pluginItems: Array(501).fill('plugin-id') }), /最多删除 500/)
  await assert.rejects(rpc({ sessionId: 'session-a', pluginItems: 'plugin-id' }), /最多删除 500/)
  assert.deepEqual(pluginCalls, [], 'invalid input is rejected before any deletion')
  const scoped = await rpc({ sessionId: 'session-a', pluginItems: ['plugin-a'] })
  assert.deepEqual(scoped.results.map(result => result.versionId), ['plugin-a'])
  assert.deepEqual(pluginCalls, [{ sessionId: 'session-a', ids: ['plugin-a'] }])
})

test('real HTTP routes serve plugin pictures, reject hostile origins, and dispatch gallery RPCs', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
  const calls = [], registered = new Map()
  let handler
  const webServer = { register(route) { registered.set(route.path, route.handler); return () => registered.delete(route.path) } }
  const ctx = { get: name => name === 'webServer' ? webServer : { requestRejection: () => undefined }, effect(callback) { callback() } }
  const dispatch = async (method, args) => { calls.push(['rpc', method, args]); return method === 'listSceneImageHistory' ? { items: [], pluginItems: [] } : { results: [] } }
  registerTavernHttpRoutes({ ctx, dispatch,
    readPluginMediaFile: async (sessionId, id) => { calls.push(['plugin-media', sessionId, id]); return { data: png, length: png.byteLength, mediaType: 'image/png' } },
    readPluginGalleryImage: async (sessionId, id) => { calls.push(['plugin-gallery-media', sessionId, id]); return { data: png, length: png.byteLength, mediaType: 'image/png' } },
    performanceDiagnostics: { http() {} }, runtimeGeneration: 'test', runtimeReadiness: Promise.resolve({ ok: true }), str })
  handler = registered.get('/api/dsh-tavern')
  assert.equal(typeof handler, 'function')

  async function request(url, { method = 'GET', origin, body } = {}) {
    const response = {}
    const req = { url, method, headers: { host: 'localhost:3081', ...(origin ? { origin } : {}) },
      async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(body) } }
    await handler(req, { writeHead(status, headers = {}) { response.status = status; response.headers = headers }, end(value) { response.body = value } })
    return response
  }

  const denied = await request('/api/dsh-tavern/plugin-media?sessionId=s&id=image-id', { origin: 'https://evil.example' })
  assert.equal(denied.status, 403)
  const pluginImage = await request('/api/dsh-tavern/plugin-media?sessionId=s&id=image-id')
  assert.equal(pluginImage.status, 200)
  assert.equal(pluginImage.headers['Content-Type'], 'image/png')
  assert.deepEqual(pluginImage.body, png)
  assert.equal(calls.filter(call => call[0] === 'plugin-media').length, 1, 'hostile-origin read never reaches plugin media')
  const deniedGallery = await request('/api/dsh-tavern/plugin-gallery-media?sessionId=s&id=gallery%3Aopaque', { origin: 'https://evil.example' })
  assert.equal(deniedGallery.status, 403)
  const galleryImage = await request('/api/dsh-tavern/plugin-gallery-media?sessionId=s&id=gallery%3Aopaque')
  assert.equal(galleryImage.status, 200)
  assert.equal(galleryImage.headers['Content-Type'], 'image/png')
  assert.deepEqual(calls.filter(call => call[0] === 'plugin-gallery-media'), [['plugin-gallery-media', 's', 'gallery:opaque']])

  for (const method of ['listSceneImageHistory', 'removeSceneImageHistory']) {
    const response = await request('/api/dsh-tavern/' + method, { method: 'POST', body: JSON.stringify({ sessionId: 's', pluginItems: [] }) })
    assert.equal(response.status, 200)
    assert.equal(JSON.parse(response.body).ok, true)
  }
  assert.deepEqual(calls.filter(call => call[0] === 'rpc').map(call => call[1]), ['listSceneImageHistory', 'removeSceneImageHistory'])
})

test('gallery providers are available to valid card and story sessions, scoped by card, and verified for list/read/delete', async () => {
  const contexts = new Map([
    ['card-a', { sessionId: 'card-a', cardPath: '/cards/a.json' }],
    ['card-b', { sessionId: 'card-b', cardPath: '/cards/b.json' }],
    ['story-a', { sessionId: 'story-a', cardPath: '/cards/a.json' }],
  ])
  const scopes = new Map([['card-only-image', { cards: ['/cards/a.json'] }]])
  let owner = ''
  const ctx = { get fiber() { return { name: owner } }, effect(register) { return register() } }
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])
  const calls = { globalList: 0, cardList: 0, reads: [], removes: [] }
  const runningUserPlugins = new Map([
    ...['global-image', 'broken-image', 'unsupported-image', 'late-provider', 'late-read-provider', 'late-remove-provider'].map(name => [name, { runtimeName: name, origin: 'global' }]),
    ['card-only-image', { runtimeName: 'card-only-image', origin: 'card' }],
  ])
  const api = createTavernPluginApi({ ctx,
    resolveGalleryContext: async sessionId => contexts.get(sessionId) || null,
    cardScope: async () => scopes,
    runningUserPlugins,
    logger: { warn() {} }
  })
  assert.equal(api.service.capabilities.galleryProvider, 1)
  owner = 'global-image'
  api.service.registerGalleryProvider({
    async list() { calls.globalList++; return [{ id: 'global-1', caption: '本地图库', createdAt: 10 }, { id: 'global-2', caption: '本地图库 2', createdAt: 11 }] },
    async read({ sessionId, id }) { calls.reads.push([sessionId, id]); return { data: png, mediaType: 'image/png' } },
    async remove({ sessionId, id }) { calls.removes.push([sessionId, id]); return true }
  })
  owner = 'card-only-image'
  api.service.registerGalleryProvider({
    async list({ sessionId }) { calls.cardList++; return [{ id: 'card-' + sessionId, caption: '卡内图片' }] },
    async read({ sessionId, id }) { calls.reads.push([sessionId, id]); return { data: png, mediaType: 'image/png' } },
    async remove() { return true }
  })
  owner = 'broken-image'
  api.service.registerGalleryProvider({
    async list() { throw new Error('provider list failed') }, async read() { throw new Error('unreachable') }, async remove() { return false }
  })

  const nativeItems = createPluginMedia({ store: memoryStore() })
  const pluginTurns = {
    async resolveGame(sessionId) { return sessionId === 'story-a' ? { sessionId, chatId: 'story-chat' } : null },
    async currentKey() { return 'story-key' }
  }
  await nativeItems.issue('story-chat', 1, 'story-key')
  const nativeImage = await nativeItems.attach({ chatId: 'story-chat', sessionId: 'story-a', owner: 'story-image', turn: 1,
    key: 'story-key', currentKey: 'story-key', item: { kind: 'image', status: 'ready', caption: '原生轨迹图片',
      attachment: { attachmentId: 'story-attachment', mediaType: 'image/png', bytes: png.byteLength } } })
  const signals = { publish() {} }
  const gallery = productionGallery({ pluginMedia: nativeItems, pluginTurns, sessionSignals: signals,
    resolveGalleryContext: async sessionId => contexts.get(sessionId) || null,
    listGalleryProviderItems: api.listGalleryProviderItems,
    readGalleryProviderImage: api.readGalleryProviderImage,
    removeGalleryProviderItems: api.removeGalleryProviderItems
  })

  const cardItems = await gallery.pluginGalleryItems('card-a')
  assert.equal(cardItems.length, 3, 'card session gets its own provider plus the global provider items')
  assert.equal(cardItems.some(item => item.provider === 'broken-image'), false, 'one failing provider is skipped without hiding healthy sources')
  const cardItem = cardItems.find(item => item.provider === 'card-only-image')
  assert.ok(cardItem)
  assert.equal((await gallery.pluginGalleryItems('card-b')).some(item => item.provider === 'card-only-image'), false, 'other card cannot list card provider')
  const storyItems = await gallery.pluginGalleryItems('story-a')
  assert.equal(storyItems.length, 4, 'story session also lists providers for its card alongside attached media')
  assert.ok(storyItems.some(item => item.id === nativeImage.id), 'a broken provider does not hide existing story media')
  assert.deepEqual(await gallery.pluginGalleryItems('unknown-session'), [])

  await assert.rejects(gallery.readPluginGalleryImage('card-b', cardItem.id), /不存在|不可用/)
  await assert.rejects(gallery.readPluginGalleryImage('unknown-session', cardItem.id), /不存在|不可用/)
  const image = await gallery.readPluginGalleryImage('card-a', cardItem.id)
  assert.deepEqual(image.data, png)
  assert.deepEqual(calls.reads, [['card-a', 'card-card-a']])
  const forgedId = 'gallery:' + Buffer.from(JSON.stringify(['global-image', 'not-listed']), 'utf8').toString('base64url')
  await assert.rejects(api.readGalleryProviderImage('card-a', forgedId), /不存在|不可用/)
  assert.equal(calls.reads.length, 1, 'unlisted IDs never reach provider read')

  calls.globalList = 0
  const globalIds = cardItems.filter(item => item.provider === 'global-image').map(item => item.id)
  const removed = await gallery.removePluginGalleryItems('card-a', globalIds)
  assert.deepEqual(removed.map(item => item.ok), [true, true])
  assert.equal(calls.globalList, 1, 'one list call per provider for a delete batch')
  assert.deepEqual(calls.removes, [['card-a', 'global-1'], ['card-a', 'global-2']])
  await assert.rejects(api.readGalleryProviderImage('unknown-session', cardItem.id), /不存在|不可用/)

  owner = 'unsupported-image'
  api.service.registerGalleryProvider({
    async list() { return [{ id: 'svg' }] }, async read() { return { data: Buffer.from('<svg></svg>'), mediaType: 'image/svg+xml' } }, async remove() { return true }
  })
  const unsupported = (await api.listGalleryProviderItems('card-a')).find(item => item.provider === 'unsupported-image')
  await assert.rejects(api.readGalleryProviderImage('card-a', unsupported.id), /PNG、JPEG、WebP 或 GIF/)

  let finishLateList
  owner = 'late-provider'
  const disposeLate = api.service.registerGalleryProvider({
    list: () => new Promise(resolve => { finishLateList = resolve }), read: async () => ({ data: png }), remove: async () => true
  })
  const lateList = api.listGalleryProviderItems('card-a')
  await new Promise(resolve => setImmediate(resolve))
  disposeLate()
  finishLateList([{ id: 'late' }])
  assert.equal((await lateList).some(item => item.provider === 'late-provider'), false, 'an unloaded provider cannot publish a late list result')

  let finishLateRead
  owner = 'late-read-provider'
  const disposeLateRead = api.service.registerGalleryProvider({
    list: async () => [{ id: 'late-read' }], read: () => new Promise(resolve => { finishLateRead = resolve }), remove: async () => true
  })
  const lateReadId = 'gallery:' + Buffer.from(JSON.stringify(['late-read-provider', 'late-read']), 'utf8').toString('base64url')
  const lateRead = api.readGalleryProviderImage('card-a', lateReadId)
  await new Promise(resolve => setImmediate(resolve))
  disposeLateRead()
  finishLateRead({ data: png, mediaType: 'image/png' })
  await assert.rejects(lateRead, /卸载或不可用/)

  let finishLateRemove
  owner = 'late-remove-provider'
  const disposeLateRemove = api.service.registerGalleryProvider({
    list: async () => [{ id: 'late-remove' }], read: async () => ({ data: png, mediaType: 'image/png' }),
    remove: () => new Promise(resolve => { finishLateRemove = resolve })
  })
  const lateRemoveId = 'gallery:' + Buffer.from(JSON.stringify(['late-remove-provider', 'late-remove']), 'utf8').toString('base64url')
  const lateRemove = api.removeGalleryProviderItems('card-a', [lateRemoveId])
  await new Promise(resolve => setImmediate(resolve))
  disposeLateRemove()
  finishLateRemove(true)
  assert.deepEqual((await lateRemove).map(item => item.ok), [false], 'an unloaded provider cannot report a late removal as successful')
})
