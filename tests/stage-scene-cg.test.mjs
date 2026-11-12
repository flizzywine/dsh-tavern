import test from 'node:test'
import assert from 'node:assert/strict'
import {createSceneCg} from '../tavern-plugin/packages/dsh-tavern-stage/lib/scene-cg.js'
import {validateAsset} from '../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/manifest.js'

// 场景生图: a finished plugin picture becomes a CG entry of the card's 自动素材 pack (made and bound when missing; never the owner's
// own pack, even one named after the card) and a 回想 unlock;
// 删除此 CG takes the entry, the unlock and the turn's picture away; relocate moves earlier pictures out of the owner's pack.
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
function fixture({stage = true, packs = [], bound = [], automatic = null, gallery = []} = {}) {
  const library = new Map(packs.map(pack => [pack.manifest.id, pack])), calls = []
  let revision = 0, cardRevision = 'c1', boundPackIds = bound, automaticId = automatic
  const service = {
    async getPackSnapshot({packId}) { return library.get(packId) || null },
    // the library's one rule for the card's 自动素材 pack (automatic-writes.js): made once, bound, null while unbound
    async cardAutomaticPack({path, create}) {
      assert.equal(path, 'cards/星.json')
      if (automaticId) return boundPackIds.includes(automaticId) ? {packId:automaticId} : null
      if (!create) return null
      const pack = {revision:'r' + ++revision, automatic:true, manifest:{id:'pack-' + revision, name:'星之卡 · 自动素材', assets:[], blobs:{}}}
      library.set(pack.manifest.id, pack); automaticId = pack.manifest.id; boundPackIds = [...boundPackIds, automaticId]; calls.push(['createAutomatic'])
      return {packId:automaticId}
    },
    async patchPack({packId, expectedRevision, patch, fileUpdates}) {
      const pack = library.get(packId)
      assert.equal(expectedRevision, pack.revision)
      const next = {...pack, revision:'r' + ++revision, manifest:{...pack.manifest, ...patch}}
      library.set(packId, next); calls.push(['patchPack', packId, fileUpdates ? [...fileUpdates.keys()] : []]); return {snapshot:next}
    },
    async copyItems({sourcePackId, itemRefs, target}) {
      const source = library.get(sourcePackId), into = library.get(target.packId), assets = [...into.manifest.assets], blobs = {...into.manifest.blobs}, copied = []
      assert.equal(target.expectedRevision, into.revision)
      for (const {kind, id} of itemRefs) {
        const asset = source.manifest.assets.find(row => row.kind === kind && row.id === id), toId = assets.some(row => row.id === id) ? id + '-2' : id
        assets.push({...structuredClone(asset), id:toId, extensions:{dsh_tavern:{...asset.extensions.dsh_tavern, copiedFrom:{packId:sourcePackId, kind, assetId:id}}}})
        for (const entry of asset.variants.entries) blobs[entry.content.media] = source.manifest.blobs[entry.content.media]
        copied.push({kind, fromId:id, toId})
      }
      library.set(target.packId, {...into, revision:'r' + ++revision, manifest:{...into.manifest, assets, blobs}}); calls.push(['copyItems', sourcePackId, target.packId])
      return {packId:target.packId, copied}
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
      async inspect({path}) { assert.equal(path, 'cards/星.json'); return {revision:cardRevision, effectiveStage:{stage}, extension:{assetBindings:{boundPackIds}}} }
    },
    resolveCard:async () => 'card-1',
    cgGallery:{async unlock(cardId, ref) { unlocked.push([cardId, ref]) }, async forget(cardId, ref) { calls.push(['forget', cardId, ref.assetId]) },
      async unlocked(cardId) { assert.equal(cardId, 'card-1'); return gallery },
      async move(cardId, pairs) { gallery = gallery.map(ref => pairs.find(([from]) => from.packId === ref.packId && from.assetId === ref.assetId)?.[1] || ref); calls.push(['move', pairs.length]) }},
    removePicture:async (...args) => { calls.push(['removePicture', ...args]) },
    log:{info() {}}
  }
  return {sceneCg:createSceneCg(deps), library, calls, unlocked, bound:() => boundPackIds, gallery:() => gallery}
}
const item = {id:'item-1', turn:3, caption:'雨夜的天台', attachment:{attachmentId:'att-1', mediaType:'image/png'}}

test('a finished picture goes to the card’s 自动素材 pack (made and bound once), not the owner’s card-named pack; a 绿灯 CG with its origin, unlocked', async () => {
  const own = {revision:'o1', manifest:{id:'own', name:'星之卡', assets:[], blobs:{}}}
  const f = fixture({packs:[own], bound:['own']})
  const [first, second] = await Promise.all([f.sceneCg.sync({gameId:'game', item}), f.sceneCg.sync({gameId:'game', item})])
  assert.equal(f.calls.filter(row => row[0] === 'createAutomatic').length, 1)
  assert.deepEqual(f.bound(), ['own', first.packId])
  assert.equal(f.library.get('own').manifest.assets.length, 0, 'the owner’s pack gets nothing')
  assert.equal(first.changed, true)
  assert.equal(second.changed, false)
  const pack = f.library.get(first.packId), asset = pack.manifest.assets[0]
  assert.equal(pack.automatic, true)
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
  // the library's own write checks accept it: a valid CG, with no trigger words until the player gives it some
  assert.doesNotThrow(() => validateAsset(asset))
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

test('an existing 自动素材 pack takes the picture; while the owner has it unbound nothing is written or unlocked', async () => {
  const auto = {revision:'a1', automatic:true, manifest:{id:'auto', name:'星之卡 · 自动素材', assets:[], blobs:{}}}
  const f = fixture({packs:[auto], bound:['auto'], automatic:'auto'})
  assert.equal((await f.sceneCg.sync({gameId:'game', item})).packId, 'auto')
  assert.equal(f.calls.filter(row => row[0] === 'createAutomatic').length, 0)
  const g = fixture({packs:[auto], bound:[], automatic:'auto'})
  assert.equal(await g.sceneCg.sync({gameId:'game', item}), null)
  assert.deepEqual([g.calls, g.unlocked], [[], []])
})

const scene = (id, attachmentId, media) => ({kind:'cg', id, name:id, enabled:true, recall:{mode:'keyword', keywords:[]},
  variants:{default:'v', entries:[{id:'v', name:id, content:{media}}]}, extensions:{dsh_tavern:{scenePicture:{chatId:'chat-1', turn:1, itemId:'i-' + id, attachmentId}}}})
const ownPack = () => ({revision:'o1', manifest:{id:'own', name:'星之卡', blobs:{h1:{ext:'png', size:10}, h2:{ext:'png', size:20}, h3:{ext:'png', size:5}},
  assets:[scene('s1', 'att-a', 'h1'), scene('s2', 'att-b', 'h2'), {kind:'cg', id:'drawn', name:'原作', enabled:true, variants:{default:'v', entries:[{id:'v', content:{media:'h3'}}]}}]}})
const unlockedOwn = [{packId:'own', kind:'cg', assetId:'drawn'}, {packId:'own', kind:'cg', assetId:'s1'}, {packId:'own', kind:'cg', assetId:'s2'}]

test('relocate --dry-run lists the unlocked 场景生图 CG of the owner’s pack and writes nothing', async () => {
  const f = fixture({packs:[ownPack()], bound:['own'], gallery:unlockedOwn})
  const plan = await f.sceneCg.relocate({cardPath:'cards/星.json'})
  assert.deepEqual(plan, {cardId:'card-1', cardPath:'cards/星.json', target:null, moves:[
    {packId:'own', packName:'星之卡', assetId:'s1', name:'s1', bytes:10}, {packId:'own', packName:'星之卡', assetId:'s2', name:'s2', bytes:20}]})
  assert.deepEqual([f.calls, f.bound()], [[], ['own']])
})

test('relocate makes the 自动素材 pack, copies the pictures, points 回想 at the copies, then takes them and their files out of the owner’s pack', async () => {
  const f = fixture({packs:[ownPack()], bound:['own'], gallery:unlockedOwn})
  const done = await f.sceneCg.relocate({cardPath:'cards/星.json', dryRun:false})
  assert.equal(done.moved, 2)
  const auto = f.library.get(done.target), own = f.library.get('own')
  assert.equal(auto.automatic, true); assert.deepEqual(f.bound(), ['own', done.target])
  assert.deepEqual(auto.manifest.assets.map(asset => asset.extensions.dsh_tavern.scenePicture.attachmentId), ['att-a', 'att-b'])
  assert.deepEqual(Object.keys(auto.manifest.blobs), ['h1', 'h2'])
  assert.deepEqual(own.manifest.assets.map(asset => asset.id), ['drawn'], 'the owner’s own CG stays')
  assert.deepEqual(Object.keys(own.manifest.blobs), ['h3'])
  assert.deepEqual(f.gallery(), [{packId:'own', kind:'cg', assetId:'drawn'}, {packId:done.target, kind:'cg', assetId:'s1'}, {packId:done.target, kind:'cg', assetId:'s2'}])
  assert.deepEqual((await f.sceneCg.relocate({cardPath:'cards/星.json'})).moves, [], 'nothing left to move')
})

test('relocate after a stop does not copy a picture twice, and keeps ids the 自动素材 pack already uses apart', async () => {
  const auto = {revision:'a1', automatic:true, manifest:{id:'auto', name:'星之卡 · 自动素材', blobs:{h1:{ext:'png', size:10}, h9:{ext:'png', size:1}},
    assets:[scene('s1', 'att-a', 'h1'), scene('s2', 'att-other', 'h9')]}}
  const f = fixture({packs:[ownPack(), auto], bound:['own', 'auto'], automatic:'auto', gallery:unlockedOwn})
  await f.sceneCg.relocate({cardPath:'cards/星.json', dryRun:false})
  const ids = f.library.get('auto').manifest.assets.map(asset => asset.id)
  assert.deepEqual(ids, ['s1', 's2', 's2-2'])
  assert.deepEqual(f.gallery().map(ref => ref.packId + '/' + ref.assetId), ['own/drawn', 'auto/s1', 'auto/s2-2'])
  assert.deepEqual(f.library.get('own').manifest.assets.map(asset => asset.id), ['drawn'])
})

test('relocate moves nothing while the owner has the 自动素材 pack unbound', async () => {
  const auto = {revision:'a1', automatic:true, manifest:{id:'auto', name:'星之卡 · 自动素材', assets:[], blobs:{}}}
  const f = fixture({packs:[ownPack(), auto], bound:['own'], automatic:'auto', gallery:unlockedOwn})
  const done = await f.sceneCg.relocate({cardPath:'cards/星.json', dryRun:false})
  assert.deepEqual([done.moved, done.skipped, f.calls], [0, 'unbound', []])
})
