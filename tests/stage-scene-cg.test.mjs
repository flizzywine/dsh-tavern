import test from 'node:test'
import assert from 'node:assert/strict'
import {createSceneCg} from '../tavern-plugin/packages/dsh-tavern-stage/lib/scene-cg.js'

// 场景生图: a finished plugin picture becomes a CG entry of the card's own pack (made and bound when missing) and a 回想 unlock;
// 删除此 CG takes the entry, the unlock and the turn's picture away.
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
function fixture({stage = true, packs = [], bound = []} = {}) {
  const library = new Map(packs.map(pack => [pack.manifest.id, pack])), calls = []
  let revision = 0, cardRevision = 'c1', boundPackIds = bound
  const service = {
    async getPackSnapshot({packId}) { return library.get(packId) || null },
    async createPack({name}) {
      const pack = {revision:'r' + ++revision, manifest:{id:'pack-' + revision, name, assets:[], blobs:{}}}
      library.set(pack.manifest.id, pack); calls.push(['createPack', name]); return {snapshot:pack}
    },
    async patchPack({packId, expectedRevision, patch, fileUpdates}) {
      const pack = library.get(packId)
      assert.equal(expectedRevision, pack.revision)
      const next = {...pack, revision:'r' + ++revision, manifest:{...pack.manifest, ...patch}}
      library.set(packId, next); calls.push(['patchPack', packId, fileUpdates ? [...fileUpdates.keys()] : []]); return {snapshot:next}
    },
    async removeBlob({packId, hash}) {
      const pack = library.get(packId), blobs = {...pack.manifest.blobs}; delete blobs[hash]
      const next = {...pack, revision:'r' + ++revision, manifest:{...pack.manifest, blobs}}
      library.set(packId, next); calls.push(['removeBlob', hash]); return {snapshot:next}
    }
  }
  const unlocked = []
  const deps = {
    library:() => service,
    attachments:() => ({async readImage(ref) { assert.equal(ref.attachmentId, 'att-1'); return {data:PNG} }}),
    chatForSession:async id => id === 'game' ? {id:'chat-1', cardPath:'cards/星.json', cardName:'星之卡', mode:'play'} : null,
    cardAssetBindings:{
      async inspect({path}) { assert.equal(path, 'cards/星.json'); return {revision:cardRevision, effectiveStage:{stage}, extension:{assetBindings:{boundPackIds}}} },
      async update({expectedRevision, patch}) { assert.equal(expectedRevision, cardRevision); boundPackIds = patch.assetBindings.boundPackIds; cardRevision = 'c2'; calls.push(['bind', boundPackIds]) }
    },
    resolveCard:async () => 'card-1',
    cgGallery:{async unlock(cardId, ref) { unlocked.push([cardId, ref]) }, async forget(cardId, ref) { calls.push(['forget', cardId, ref.assetId]) }},
    removePicture:async (...args) => { calls.push(['removePicture', ...args]) },
    log:{info() {}}
  }
  return {sceneCg:createSceneCg(deps), library, calls, unlocked, bound:() => boundPackIds}
}
const item = {id:'item-1', turn:3, caption:'雨夜的天台', attachment:{attachmentId:'att-1', mediaType:'image/png'}}

test('a finished picture creates and binds the card-named pack once, adds a 绿灯 CG with its origin and unlocks it', async () => {
  const f = fixture()
  const [first, second] = await Promise.all([f.sceneCg.sync({gameId:'game', item}), f.sceneCg.sync({gameId:'game', item})])
  assert.equal(f.calls.filter(row => row[0] === 'createPack').length, 1)
  assert.deepEqual(f.bound(), [first.packId])
  assert.equal(first.changed, true)
  assert.equal(second.changed, false)
  const pack = f.library.get(first.packId), asset = pack.manifest.assets[0]
  assert.equal(pack.manifest.name, '星之卡')
  assert.equal(pack.manifest.assets.length, 1)
  assert.equal(asset.kind, 'cg')
  assert.equal(asset.name, '雨夜的天台')
  assert.equal(asset.enabled, true)
  assert.deepEqual(asset.recall, {mode:'keyword', keywords:[]})
  assert.deepEqual(asset.extensions.dsh_tavern.scenePicture, {chatId:'chat-1', turn:3, itemId:'item-1', attachmentId:'att-1'})
  const media = asset.variants.entries[0].content.media
  assert.deepEqual(pack.manifest.blobs[media], {ext:'png', mime:'image/png', size:PNG.length})
  assert.deepEqual(f.calls.find(row => row[0] === 'patchPack')[2], ['media/' + media + '.png'])
  assert.deepEqual(f.unlocked, [['card-1', {packId:first.packId, kind:'cg', assetId:asset.id}]])
})

test('an existing card-named pack is reused; a card without the stage gets nothing', async () => {
  const pack = {revision:'r0', manifest:{id:'own', name:'星之卡', assets:[], blobs:{}}}
  const f = fixture({packs:[pack], bound:['own']})
  assert.equal((await f.sceneCg.sync({gameId:'game', item})).packId, 'own')
  assert.equal(f.calls.some(row => row[0] === 'createPack' || row[0] === 'bind'), false)
  const off = fixture({stage:false})
  assert.equal(await off.sceneCg.sync({gameId:'game', item}), null)
  assert.equal(off.calls.length, 0)
})

test('删除此 CG removes the entry, its file, the unlock and the turn picture; other entries are refused', async () => {
  const f = fixture()
  const made = await f.sceneCg.sync({gameId:'game', item})
  const authored = {kind:'cg', id:'authored', name:'原作', enabled:true, directorNote:'', recall:{mode:'keyword', keywords:[]}}
  const pack = f.library.get(made.packId)
  f.library.set(made.packId, {...pack, manifest:{...pack.manifest, assets:[...pack.manifest.assets, authored]}})
  await assert.rejects(f.sceneCg.remove({sessionId:'game', ref:{packId:made.packId, kind:'cg', assetId:'authored'}}), /不是自动配图/)
  assert.deepEqual(await f.sceneCg.remove({sessionId:'game', ref:{packId:made.packId, kind:'cg', assetId:made.assetId}}), {removed:true})
  const after = f.library.get(made.packId)
  assert.deepEqual(after.manifest.assets.map(asset => asset.id), ['authored'])
  assert.deepEqual(after.manifest.blobs, {})
  assert.deepEqual(f.calls.filter(row => ['forget', 'removePicture'].includes(row[0])), [['forget', 'card-1', made.assetId], ['removePicture', 'game', 'item-1', 'att-1']])
  await assert.rejects(f.sceneCg.remove({sessionId:'game', ref:{packId:'elsewhere', kind:'cg', assetId:made.assetId}}), /不在本卡/)
})
