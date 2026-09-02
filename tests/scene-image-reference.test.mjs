import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneImageReferences, imageReferenceCapability, imageReferencePeople } from '../tavern-plugin/lib/domain/scene-image-reference.js'
import { imageChannelRequest, channelSettings } from '../tavern-plugin/lib/domain/scene-image-channels.js'
import { redactSceneDiagnostic } from '../tavern-plugin/lib/domain/scene-image-diagnostics.js'

function fixture() {
  const data = new Map()
  const store = { async readJson(path) { return structuredClone(data.get(path)) }, async updateJson(path, apply) { data.set(path, await apply(data.get(path))) } }
  const config = channelSettings({ provider: 'gemini' })
  const api = createSceneImageReferences({ store })
  const source = { key: 'body-1', turn: 1 }, activation = { key: 'body-2', turn: 2 }
  const version = { id: 'image-1', attachment: { attachmentId: 'pic', mediaType: 'image/png' }, plan: { subjects: ['alice'], people: [{ id: 'alice', name: 'Alice', identity: { quote: 'Alice' } }] } }
  const image = { data: new Uint8Array(Buffer.from('test-image')), ref: version.attachment }
  const bind = (extra = {}) => api.bind({ chatId: 'chat', source, activation, version, image, config, consent: imageReferenceCapability(config).gateway, ...extra })
  const select = (extra = {}) => api.select({ chatId: 'chat', lineage: [source, activation], config, ...extra })
  return { store, config, api, bind, select, source, activation, version, image }
}

test('host-assigned scene identity supports explicit reference selection without quotes', async () => {
  const f = fixture()
  f.version.plan.people[0].identity = { kind: 'scene-person', targetKey: f.source.key }
  assert.equal(imageReferencePeople(f.version)[0].name, 'Alice')
  await f.bind()
  assert.equal((await f.select()).records.length, 1)
})

test('reference requires explicit current-service consent and single-person identity, never previous picture automatically', async () => {
  const f = fixture()
  assert.deepEqual((await f.select()).records, [])
  await assert.rejects(f.bind({ consent: undefined }), /确认/)
  await assert.rejects(f.bind({ config: channelSettings({ provider: 'openai' }) }), /确认/)
  await assert.rejects(f.bind({ version: { ...f.version, plan: { subjects: ['alice', 'bob'], people: [{ id: 'alice' }, { id: 'bob' }] } } }), /单人/)
  await f.bind()
  assert.equal((await f.select()).records.length, 1)
  assert.equal((await f.select({ chatId: 'other' })).records.length, 0)
  assert.equal((await f.select({ lineage: [f.source] })).records.length, 0, 'activation is later than the requested historic turn')
  assert.equal((await f.select({ lineage: [f.source, { key: 'other-branch', turn: 2 }] })).records.length, 0)
  const switched = await f.select({ config: { ...f.config, baseURL: 'https://other.example/v1' } })
  assert.equal(switched.records.length, 0)
  assert.equal(switched.active.length, 1, 'revocation remains available after changing services')
  assert.match(switched.warning, /未授权/)
  assert.match((await f.select({ config: channelSettings({ provider: 'openai' }) })).warning, /仅使用文字/)
})

test('references survive restart; load checks membership, deletion, bytes and revocation even after queue selection', async () => {
  const f = fixture(); await f.bind()
  const restarted = createSceneImageReferences({ store: f.store })
  const selected = await restarted.select({ chatId: 'chat', lineage: [f.source, f.activation], config: f.config })
  const load = (extra = {}) => restarted.load({ selected, plan: { subjects: ['alice'] }, readImage: async () => f.image, readVersion: async () => f.version, ...extra })
  assert.equal((await load()).images.length, 1)
  assert.equal((await load({ plan: { subjects: ['bob'] } })).images.length, 0)
  assert.equal((await load({ readVersion: async () => null })).images.length, 0)
  assert.equal((await load({ readImage: async () => ({ ...f.image, data: Buffer.from('changed') }) })).images.length, 0)
  await f.bind({ enabled: false })
  assert.equal((await load()).images.length, 0)
  assert.equal((await f.select()).records.length, 0)
})

test('Gemini reference uses documented image input, not chat images or text-model data; logs omit base64', () => {
  const config = channelSettings({ provider: 'gemini' })
  const referenceImages = [{ name: 'Alice', personId: 'alice', data: Buffer.from('image-body-marker'), mediaType: 'image/png' }]
  const request = imageChannelRequest({ ...config, apiKey: 'secret', prompt: 'red coat in the park', referenceImages })
  assert.equal(request.body.input[0].text, 'red coat in the park')
  assert.match(request.body.input[1].text, /do not copy the old composition or outfit/)
  assert.deepEqual(request.body.input[2], { type: 'image', mime_type: 'image/png', data: referenceImages[0].data.toString('base64') })
  assert.doesNotMatch(JSON.stringify(redactSceneDiagnostic(request.body)), new RegExp(referenceImages[0].data.toString('base64')))
  assert.throws(() => imageChannelRequest({ provider: 'openai', apiKey: 'key', prompt: 'test', referenceImages }), /不支持/)
  assert.equal(imageReferenceCapability({ ...config, model: 'unknown-model' }).supported, false)
})

test('multi-person image requires explicit stable identity and revokes each person separately', async () => {
  const f = fixture()
  const version = { ...f.version, plan: { subjects: ['alice', 'bob'], people: [
    { id: 'alice', name: '同名', identity: { quote: '左边同名' }, fields: { position: { text: '图中左侧' }, appearance: { text: '黑发' } } },
    { id: 'bob', name: '同名', identity: { quote: '右边同名' }, fields: { position: { text: '图中右侧' }, appearance: { text: '红发' } } },
    { id: 'offscreen', name: '不在图中', identity: { quote: '背景设定' } }
  ] } }
  assert.deepEqual(imageReferencePeople(version).map(person => person.id), ['alice', 'bob'])
  const adjusted = { ...version, plan: { ...version.plan, blocks: [
    { owner: 'bob', field: 'position', text: '改到中央' }, { owner: 'bob', field: 'appearance', text: '' }
  ] } }
  assert.equal(imageReferencePeople(adjusted)[1].description, '改到中央', 'source cues use the actual image overlay, including cleared fields')
  await assert.rejects(f.bind({ version }), /请选择/)
  await assert.rejects(f.bind({ version, personId: '同名' }), /请选择/)
  await assert.rejects(f.bind({ version, personId: 'offscreen' }), /请选择/)
  await assert.rejects(f.bind({ version, personId: ['alice', 'bob'] }), /请选择/)
  await f.bind({ version, personId: 'bob' })
  const selected = await f.select()
  assert.deepEqual(selected.records.map(record => record.person.id), ['bob'])
  assert.equal(selected.records[0].person.description, '图中右侧；红发')
  const loaded = await f.api.load({ selected, plan: { subjects: ['bob'] }, readVersion: async () => version, readImage: async () => f.image })
  const body = imageChannelRequest({ ...f.config, apiKey: 'test', referenceImages: loaded.images, prompt: 'current scene' }).body
  assert.match(body.input[1].text, /identity bob.*图中右侧；红发/)
  assert.match(body.input[1].text, /not other people/)
  await f.bind({ version, personId: 'alice' })
  await f.bind({ version, personId: 'bob', enabled: false })
  assert.deepEqual((await f.select()).records.map(record => record.person.id), ['alice'])
})
