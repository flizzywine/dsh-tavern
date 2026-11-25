// A deleted card takes what it left outside its own file with it (「删干净」): its
// cast-assets record, the stored copies of the packs only it carried, its derived worldbook files, its projection revision
// and, through the presentation observers, per-card renderer state.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createCastAssets } from '../tavern-plugin/lib/domain/cast-assets.js'
import { createWorldbookFiles } from '../tavern-plugin/lib/domain/worldbook-files.js'
import { createWorldbookFileStore } from '../tavern-plugin/lib/domain/worldbook-file-store.js'
import { createCardLeftovers } from '../tavern-plugin/lib/card-leftovers.js'
import { createPresentationObservers } from '../tavern-plugin/lib/domain/presentation-observers.js'

const HASH = 'a'.repeat(64), SHARED = 'b'.repeat(64)
const exists = file => fs.stat(file).then(() => true, () => false)

async function profile(t) {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'card-leftovers-'))
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }))
  const profileData = createProfileDataStore({ dataRoot })
  const castAssets = createCastAssets({ store: profileData })
  await castAssets.bindPacks('cards/gone.json', [{ id: 'gone-pack', contentHash: HASH }, { id: 'shared-pack', contentHash: SHARED }])
  await castAssets.bindPacks('cards/kept.json', [{ id: 'shared-pack', contentHash: SHARED }])
  for (const [id, hash] of [['gone-pack', HASH], ['shared-pack', SHARED]]) await profileData.writeJson(`asset-packs/packs/${id}/${hash}.json`, { id, contentHash: hash, files: {} })
  await profileData.writeJson('card-projection-revisions.json', { version: 3, cards: { 'cards/gone.json': 2, 'cards/kept.json': 3 } })
  await profileData.writeJson('stage/cg-gallery/card-gone.json', { schemaVersion: 1, unlocked: [] })
  const state = { chat: { sessionId: 'game', cardPath: 'cards/gone.json' }, worldBook: { view: { entries: [
    { ref: 'a', title: '港口', content: '港口秘密' }, { ref: 'd', title: '天气', content: '<%= value %>' }] } } }
  const worldbookFiles = createWorldbookFiles({ directory: path.join(dataRoot, 'worldbook-files'), load: async () => state })
  await worldbookFiles.listFiles({}, { scope: { session: { id: 'game' } } })
  await fs.mkdir(path.join(dataRoot, 'worldbook-files', 'kept'), { recursive: true })
  return { dataRoot, profileData, castAssets, worldbookFiles }
}

test('a deleted card leaves no cast record, sole pack copy, worldbook files, projection row or gallery record', async t => {
  const { dataRoot, profileData, castAssets, worldbookFiles } = await profile(t)
  assert.equal(await exists(path.join(dataRoot, 'worldbook-files/gone')), true)
  const observers = createPresentationObservers(), removed = []
  observers.register('stage-cg', { cardRemoved: (cardPath, cardId) => { removed.push([cardPath, cardId]); return profileData.remove(`stage/cg-gallery/${cardId}.json`) } })
  const result = await createCardLeftovers({ dataRoot, profileData, castAssets, worldbookFiles, presentationObservers: observers }).remove({ cardPath: 'cards/gone.json', cardId: 'card-gone' })
  assert.deepEqual(result.storedPacks, [{ id: 'gone-pack', contentHash: HASH }])
  assert.deepEqual(removed, [['cards/gone.json', 'card-gone']])
  assert.equal(await exists(path.join(dataRoot, 'asset-packs/packs/gone-pack')), false)
  assert.equal(await exists(path.join(dataRoot, `asset-packs/packs/shared-pack/${SHARED}.json`)), true)
  assert.equal(await exists(path.join(dataRoot, 'worldbook-files/kept')), true)
  assert.deepEqual((await castAssets.read('cards/kept.json')).packs.map(pack => pack.id), ['shared-pack'])
  assert.deepEqual((await profileData.readJson('card-projection-revisions.json')).cards, { 'cards/kept.json': 3 })
  assert.equal(await exists(path.join(dataRoot, 'worldbook-files/gone')), false)
  assert.equal(await exists(path.join(dataRoot, 'worldbook-files/gone·动态快照')), false)
  assert.equal(await exists(path.join(dataRoot, 'cast-assets')) && (await fs.readdir(path.join(dataRoot, 'cast-assets'))).length, 1)
  assert.equal(await exists(path.join(dataRoot, 'stage/cg-gallery/card-gone.json')), false)
})

test('worldbook files of a card go by its label, versions included, and nothing else', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'worldbook-labels-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  for (const name of ['teyvat', 'teyvat·动态快照', 'teyvat（资料版本2）', 'teyvat·动态快照（资料版本3）', 'teyvat-2', 'teyvatx', '江湖']) await fs.mkdir(path.join(root, name))
  const removed = await createWorldbookFileStore(root).removeLabelled('teyvat')
  assert.deepEqual(removed.sort(), ['teyvat', 'teyvat·动态快照', 'teyvat·动态快照（资料版本3）', 'teyvat（资料版本2）'].sort())
  assert.deepEqual((await fs.readdir(root)).sort(), ['teyvat-2', 'teyvatx', '江湖'].sort())
})
