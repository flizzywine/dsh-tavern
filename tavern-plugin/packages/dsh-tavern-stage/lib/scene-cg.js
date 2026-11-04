// Finished plugin pictures (the illustrator's 场景生图) become CG entries of the card's own pack - the pack named after the
// card, created and lit green for it when missing - and are unlocked in 回想 at once. Deleting one from 回想 takes it out of
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
    const name = String(context.chat.cardName || '').trim()
    for (const packId of context.boundPackIds) {
      const pack = await service.getPackSnapshot({packId}).catch(() => null)
      if (pack && !pack.privateConfig && pack.manifest.name === name) return pack
    }
    if (!name) return null
    const made = await service.createPack({name, expectedRevision:null}), packId = made.snapshot.manifest.id
    const bindings = context.card.extension?.assetBindings || {}
    await cardAssetBindings.update({path:context.chat.cardPath, expectedRevision:context.card.revision,
      patch:{assetBindings:{...bindings, boundPackIds:[...context.boundPackIds, packId]}}})
    return made.snapshot
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
  // 回想 › 删除这张 CG: only an entry this sync made, in a pack bound to the playing card.
  async function remove({sessionId, ref}) {
    const service = library(), context = await cardOf(sessionId)
    if (!service || !context) throw Object.assign(new Error('当前游戏不存在'), {code:'NOT_FOUND'})
    if (!context.boundPackIds.includes(ref?.packId)) throw Object.assign(new Error('这张 CG 不在本卡的素材包里'), {code:'NOT_FOUND'})
    return serial(context.chat.cardPath, async () => {
      const pack = await service.getPackSnapshot({packId:ref.packId})
      const asset = pack?.manifest.assets.find(row => row.kind === 'cg' && row.id === ref.assetId), origin = scenePictureOf(asset)
      if (!origin) throw Object.assign(new Error('这张 CG 不是自动配图'), {code:'NOT_FOUND'})
      const media = [...new Set((asset.variants?.entries || []).map(entry => entry.content?.media).filter(Boolean))]
      let revision = (await service.patchPack({packId:ref.packId, expectedRevision:pack.revision,
        patch:{assets:pack.manifest.assets.filter(row => row !== asset)}})).snapshot.revision
      // The picture's file goes too when nothing else in the pack shows it (removeBlob refuses a used one).
      for (const hash of media) {
        try { revision = (await service.removeBlob({packId:ref.packId, expectedRevision:revision, hash})).snapshot.revision }
        catch (error) { log.info?.('dsh-tavern: scene CG media kept', error?.code || error?.message) }
      }
      await cgGallery.forget(await resolveCard(context.chat.cardPath), {packId:ref.packId, kind:'cg', assetId:ref.assetId})
      if (origin.chatId === context.chat.id) await removePicture(sessionId, origin.itemId, origin.attachmentId)
      return {removed:true}
    })
  }
  return {sync, remove}
}
