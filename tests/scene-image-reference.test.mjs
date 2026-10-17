import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneImageReferences, imageReferenceCapability } from '../tavern-plugin/lib/domain/scene-image-reference.js'
import { channelSettings } from '../tavern-plugin/lib/domain/scene-image-channels.js'

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
