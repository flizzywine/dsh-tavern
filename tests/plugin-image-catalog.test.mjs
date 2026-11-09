import assert from 'node:assert/strict'
import test from 'node:test'
import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'

function harness() {
  const scopes = new Map(), errors = [], requests = []
  const api = createTavernPluginApi({
    logger: { warn: message => errors.push(message) },
    cardScope: async () => scopes,
    cardPathOf: async gameId => gameId === 'a' ? 'cards/a.json' : 'cards/b.json',
    resolveGalleryContext: async sessionId => ({ sessionId, cardPath: sessionId === 'a' ? 'cards/a.json' : 'cards/b.json' }),
    generateImage: async (input, source) => { requests.push(input); return source.generate(input) },
  })
  const plugin = owner => {
    const disposers = []
    const service = Object.create(api.service)
    service.ctx = { fiber: { name: owner }, effect(setup) { const off = setup(); disposers.push(off); return off } }
    return { service, dispose() { disposers.splice(0).reverse().forEach(off => off()) } }
  }
  return { api, scopes, errors, requests, plugin }
}

test('model discovery and explicit selection preserve legacy providers and never fall back from a removed model', async () => {
  const h = harness(), provider = h.plugin('images'), consumer = h.plugin('consumer').service
  let saved = [{ id: 'channel-a', label: '我的模型', model: 'm', ready: true, apiKey: 'secret' }]
  const generated = []
  provider.service.imageProvider({ id: 'online', label: '配图', models: () => saved,
    status: ({ modelId } = {}) => ({ ready: true, model: modelId || 'default', maxReferences: 4 }),
    generate: async input => { generated.push(input); return { data: new Uint8Array([1]), mediaType: 'image/png' } },
  })
  const legacy = h.plugin('legacy')
  legacy.service.imageProvider({ id: 'old', label: '旧渠道', status: () => ({ ready: true, model: 'old', maxReferences: 0 }), generate: async () => ({}) })
  const models = await consumer.listImageModels()
  assert.equal(models.length, 2)
  assert.equal(models[0].providerId, 'images/online')
  assert.equal(models[0].modelId, 'channel-a')
  assert.equal(models[1].modelId, '')
  assert.equal(JSON.stringify(models).includes('secret'), false)
  await consumer.generateImage({ providerId: models[0].providerId, modelId: models[0].modelId, prompt: 'cat' })
  assert.equal(generated[0].modelId, 'channel-a')
  await consumer.generateImage({ prompt: 'default' })
  assert.equal(Object.hasOwn(generated[1], 'modelId'), false)
  saved = []
  await assert.rejects(consumer.generateImage({ providerId: 'images/online', modelId: 'channel-a' }), { code: 'NOT_CONFIGURED' })
  await assert.rejects(consumer.generateImage({ modelId: 'channel-a' }), { code: 'INVALID_ARGUMENT' })
  assert.equal(generated.length, 2)
  provider.dispose()
  await assert.rejects(consumer.generateImage({ providerId: 'images/online' }), { code: 'NOT_CONFIGURED' })
})

test('character and outfit libraries use projections, search, pagination, scoped identities and independent failures', async () => {
  const h = harness(), provider = h.plugin('images'), consumer = h.plugin('consumer').service
  const definitions = [{ id: 'c', name: '小雨', aliases: ['rain'],
    traits: { face: 'blue eyes', lowerSFW: 'lower', bodySFWBack: 'back', fullNSFW: 'legacy', privatePath: 'C:/secret' },
    referenceImage: '/private/file' }, { id: 'd', name: '小雪' }]
  provider.service.registerImageLibrary({ id: 'library', label: '角色', characters: () => definitions,
    outfits: ({ characterId }) => [{ id: 'o', name: '常服', characterId, parts: { upper: 'shirt', apiKey: 'secret' } }] })
  assert.throws(() => provider.service.registerImageLibrary({ id: 'library', label: '重复', characters: () => [] }), /已注册/)
  h.plugin('broken').service.registerImageLibrary({ id: 'library', label: '错误', characters: () => [{ id: 'same' }, { id: 'same' }] })
  const found = await consumer.listImageCharacters({ query: 'RAIN', limit: 1 })
  assert.equal(found.total, 1)
  assert.equal(found.items[0].providerId, 'images/library')
  assert.deepEqual(
    [found.items[0].traits.lowerSFW, found.items[0].traits.fullSFW, found.items[0].traits.bodySFWBack, found.items[0].traits.lowerNSFW],
    ['lower', 'lower', 'back', 'legacy'],
  )
  assert.deepEqual(found.errors, [{ providerId: 'broken/library', code: 'PROVIDER_FAILED' }])
  found.items[0].traits.face = 'changed'
  assert.equal(definitions[0].traits.face, 'blue eyes')
  assert.equal(JSON.stringify(found).includes('private'), false)
  const page = await consumer.listImageCharacters({ providerId: 'images/library', offset: 1, limit: 1 })
  assert.equal(page.items[0].id, 'd')
  assert.equal(page.total, 2)
  assert.equal(page.hasMore, false)
  const outfits = await consumer.listImageOutfits({ providerId: 'images/library', characterId: 'c' })
  assert.equal(outfits.items[0].characterId, 'c')
  assert.equal(outfits.items[0].parts.upper, 'shirt')
  assert.equal(JSON.stringify(outfits).includes('secret'), false)
  await assert.rejects(consumer.listImageCharacters({ limit: 0 }), /limit/)
  await assert.rejects(consumer.listImageOutfits({ characterId: 'c' }), /providerId/)
})

test('card-scoped callers and providers cannot read or use a different card, including global queries', async () => {
  const h = harness(), provider = h.plugin('card-images'), consumer = h.plugin('consumer').service
  h.scopes.set('card-images', { cards: ['cards/a.json'] })
  provider.service.registerImageLibrary({ id: 'lib', label: '卡内角色', characters: () => [{ id: 'c', name: 'A' }] })
  provider.service.imageProvider({ id: 'online', label: '卡内生图', status: () => ({ ready: true }), generate: async () => ({}) })
  assert.equal((await consumer.listImageCharacters()).total, 0)
  assert.equal((await consumer.listImageCharacters({ gameId: 'b' })).total, 0)
  assert.equal((await consumer.listImageCharacters({ gameId: 'a' })).total, 1)
  assert.equal((await consumer.listImageModels({ card: 'cards/a.json' })).length, 1)
  await assert.rejects(consumer.generateImage({ gameId: 'b', providerId: 'card-images/online' }), { code: 'NOT_CONFIGURED' })
  await assert.rejects(provider.service.listImageCharacters(), { code: 'TAVERN_PLUGIN_SCOPE' })
  await assert.rejects(provider.service.listImageCharacters({ card: 'cards/b.json' }), { code: 'TAVERN_PLUGIN_SCOPE' })
  await assert.rejects(consumer.listImageCharacters({ gameId: 'a', card: 'cards/b.json' }), /不匹配/)
})
