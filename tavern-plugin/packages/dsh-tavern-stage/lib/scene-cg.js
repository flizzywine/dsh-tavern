// Finished plugin pictures (the illustrator's 场景生图) become CG entries of the card's 自动素材 pack - the same pack 自动素材
// writes its figures to (the library's cardAutomaticPack), made and bound when missing; never a pack the owner made - and
// are unlocked in 回想 at once. While the owner has unbound that pack, pictures stay in the story only. Deleting one from 回想 takes it out of
// the pack, the gallery and the turn's plugin media; history pages then show nothing in its place.
import {createHash, randomBytes} from 'node:crypto'

const EXT = {'image/png':'png','image/jpeg':'jpeg','image/webp':'webp'}
// The entry's origin; only these entries offer 删除这张 CG in 回想.
export const scenePictureOf = asset => asset?.kind === 'cg' ? asset.extensions?.dsh_tavern?.scenePicture || null : null
const clip = (text, max) => [...String(text || '').trim()].slice(0, max).join('')

export function createSceneCg({library, attachments, chatForSession, cardAssetBindings, resolveCard, cgGallery, removePicture, log = console}) {
  const queues = new Map()
  // One card at a time: two pictures finishing together must not each create the card's pack.
  function serial(key, task) {
    const run = (queues.get(key) || Promise.resolve()).then(task, task)
    const tail = run.catch(() => {})
    queues.set(key, tail)
    void tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
    return run
  }
  async function cardOf(sessionId) {
    const chat = await chatForSession(sessionId)
    if (!chat?.cardPath || chat.mode === 'card') return null
    const card = await cardAssetBindings.inspect({path:chat.cardPath, metadataOnly:true})
    return {chat, card, boundPackIds:card.extension?.assetBindings?.boundPackIds || []}
  }
  async function cardPack(service, context) {
    const target = await service.cardAutomaticPack({path:context.chat.cardPath, create:true})
    return target && service.getPackSnapshot({packId:target.packId})
  }
  async function sync({gameId, item}) {
    const service = library(), files = attachments(), ext = EXT[item.attachment?.mediaType]
    if (!service || !files || !ext) return null
    const context = await cardOf(gameId)
    if (!context || context.card.effectiveStage?.stage !== true) return null
    return serial(context.chat.cardPath, async () => {
      const latest = await cardOf(gameId)
      const pack = latest && await cardPack(service, latest)
      if (!pack) return null
      const attachmentId = item.attachment.attachmentId
      const known = pack.manifest.assets.find(asset => scenePictureOf(asset)?.attachmentId === attachmentId)
      if (known) return {packId:pack.manifest.id, assetId:known.id, changed:false}
      const bytes = (await files.readImage(item.attachment)).data
      // The file name is the media's identity in the pack (content-addressed), not a check.
      const hash = createHash('sha256').update(bytes).digest('hex'), unique = () => 's' + Date.now().toString(36) + randomBytes(3).toString('hex')
      let assetId = unique()
      while (pack.manifest.assets.some(asset => asset.kind === 'cg' && asset.id === assetId)) assetId = unique()
      const name = clip(item.caption, 40) || '第 ' + item.turn + ' 轮 CG', variant = 'v' + assetId.slice(1)
      const asset = {kind:'cg', id:assetId, name, enabled:true, directorNote:'', recall:{mode:'keyword', keywords:[]},
        variants:{default:variant, entries:[{id:variant, name:clip(name, 32), content:{description:clip(name, 80), media:hash}}]},
        extensions:{dsh_tavern:{scenePicture:{chatId:latest.chat.id, turn:Number(item.turn) || 0, itemId:item.id, attachmentId}}}}
      await service.patchPack({packId:pack.manifest.id, expectedRevision:pack.revision,
        fileUpdates:new Map([['media/' + hash + '.' + ext, bytes]]),
        patch:{assets:[...pack.manifest.assets, asset], blobs:{...pack.manifest.blobs, [hash]:{ext, mime:item.attachment.mediaType, size:bytes.length}}}})
      const ref = {packId:pack.manifest.id, kind:'cg', assetId}
      await cgGallery.unlock(await resolveCard(latest.chat.cardPath), ref)
      return {...ref, changed:true}
    })
  }
  // Takes pictures out of a pack: the entries, then each file nothing else in the pack shows (removeBlob refuses a used one).
  async function drop(service, pack, ids) {
    const assets = pack.manifest.assets.filter(row => row.kind === 'cg' && ids.includes(row.id)), gone = new Set(assets), media = [...new Set(assets.flatMap(asset => (asset.variants?.entries || []).map(entry => entry.content?.media)).filter(Boolean))]
    let revision = (await service.patchPack({packId:pack.manifest.id, expectedRevision:pack.revision,
      patch:{assets:pack.manifest.assets.filter(row => !gone.has(row))}})).snapshot.revision
    for (const hash of media) {
      try { revision = (await service.removeBlob({packId:pack.manifest.id, expectedRevision:revision, hash})).snapshot.revision }
      catch (error) { log.info?.('dsh-tavern: scene CG media kept', error?.code || error?.message) }
    }
  }
  // 回想 › 删除这张 CG: only an entry this sync made, in a pack bound to the playing card.
  async function remove({sessionId, ref}) {
    const service = library(), context = await cardOf(sessionId)
    if (!service || !context) throw Object.assign(new Error('当前游戏不存在'), {code:'NOT_FOUND'})
    if (!context.boundPackIds.includes(ref?.packId)) throw Object.assign(new Error('这张 CG 不在本卡的素材包里'), {code:'NOT_FOUND'})
    return serial(context.chat.cardPath, async () => {
      const pack = await service.getPackSnapshot({packId:ref.packId})
      const asset = pack?.manifest.assets.find(row => row.kind === 'cg' && row.id === ref.assetId), origin = scenePictureOf(asset)
      if (!origin) throw Object.assign(new Error('这张 CG 不是自动配图'), {code:'NOT_FOUND'})
      await drop(service, pack, [asset.id])
      await cgGallery.forget(await resolveCard(context.chat.cardPath), {packId:ref.packId, kind:'cg', assetId:ref.assetId})
      if (origin.chatId === context.chat.id) await removePicture(sessionId, origin.itemId, origin.attachmentId)
      return {removed:true}
    })
  }
  // Pictures made before 11-12 went to the owner's pack named after the card. relocate moves the ones this card's 回想 unlocked
  // into its 自动素材 pack (cardAutomaticPack, made and bound when missing): copy (copyItems, ids kept unless taken), point 回想
  // at the copies, then take them and their files out of the old pack. A rerun after a stop finds what already arrived by its
  // attachment and does not copy it twice. Turns whose director showed one keep the old ref and show no CG there; the
  // picture in the story text is the plugin's and stays. dryRun lists and writes nothing.
  async function relocate({cardPath, dryRun = true}) {
    const service = library()
    if (!service) throw Object.assign(new Error('素材库不可用'), {code:'UNAVAILABLE'})
    const cardId = await resolveCard(cardPath)
    return serial(cardPath, async () => {
      const target = await service.cardAutomaticPack({path:cardPath, create:!dryRun}), packs = new Map(), moves = []
      for (const ref of await cgGallery.unlocked(cardId)) {
        if (ref.kind !== 'cg' || ref.packId === target?.packId) continue
        if (!packs.has(ref.packId)) packs.set(ref.packId, await service.getPackSnapshot({packId:ref.packId}))
        const pack = packs.get(ref.packId), asset = pack?.manifest.assets.find(row => row.kind === 'cg' && row.id === ref.assetId)
        if (scenePictureOf(asset)) moves.push({pack, asset})
      }
      const rows = moves.map(({pack, asset}) => ({packId:pack.manifest.id, packName:pack.manifest.name, assetId:asset.id, name:asset.name,
        bytes:(asset.variants?.entries || []).reduce((sum, entry) => sum + (pack.manifest.blobs[entry.content?.media]?.size || 0), 0)}))
      const result = {cardId, cardPath, target:target?.packId ?? null, moves:rows}
      if (dryRun || !rows.length) return result
      // the owner unbound the card's 自动素材 pack: nothing moves
      if (!target) return {...result, moved:0, skipped:'unbound'}
      for (const pack of new Set(moves.map(move => move.pack))) {
        const assets = moves.filter(move => move.pack === pack).map(move => move.asset), into = await service.getPackSnapshot({packId:target.packId})
        const arrived = new Map(into.manifest.assets.filter(scenePictureOf).map(asset => [scenePictureOf(asset).attachmentId, asset.id]))
        const pending = assets.filter(asset => !arrived.has(scenePictureOf(asset).attachmentId))
        const copied = pending.length ? (await service.copyItems({sourcePackId:pack.manifest.id, itemRefs:pending.map(asset => ({kind:'cg', id:asset.id})),
          target:{packId:target.packId, expectedRevision:into.revision}})).copied : []
        const toId = new Map(copied.map(row => [row.fromId, row.toId]))
        await cgGallery.move(cardId, assets.map(asset => [{packId:pack.manifest.id, kind:'cg', assetId:asset.id},
          {packId:target.packId, kind:'cg', assetId:toId.get(asset.id) ?? arrived.get(scenePictureOf(asset).attachmentId)}]))
        await drop(service, await service.getPackSnapshot({packId:pack.manifest.id}), assets.map(asset => asset.id))
      }
      return {...result, moved:rows.length}
    })
  }
  return {sync, remove, relocate}
}
