// card-derived monotonic unlocks; never card/pack/story content.
import {randomBytes} from 'node:crypto'
import {CARD_ID} from '../../../lib/card-storage.js'
import {assetRefKey,validateAssetRef} from '../../dsh-presentation-protocol/src/asset-packs.js'
import {assetContent} from '../../dsh-presentation-protocol/src/asset-variant-content.js'
import {assetPackDigest as digest} from '../../../lib/domain/stage-asset-pack-catalogue.js'
import {verifyCgPlayedReceipt} from '../../../lib/domain/cg-played-receipt.js'
const conflict = () => {throw Object.assign(new Error('CG gallery changed; reload'),{code:'REVISION_CONFLICT'})}
const file = id => {
  if (!CARD_ID.test(id || '')) throw new Error('Invalid card identity')
  return `stage/cg-gallery/${id}.json`
}
export function createCgGallery({profileData,cardStorage,resolveCard,chatForSession,assets,readDirection,readSettings,now=Date.now}) {
  // ephemeral display capabilities, never serialized into story/playback.
  const receipts = new Map()
  const identity = value => [value.cardId,value.chat.id,value.chat.cardPath]
  async function session(sessionId) {
    const chat = await chatForSession(sessionId)
    if (!chat?.cardPath || chat.mode === 'card') throw new Error('A playing session is required')
    return {chat,cardId:await resolveCard(chat.cardPath)}
  }
  async function read(cardId) {
    const data = await profileData.readJson(file(cardId))
    if (!data) return []
    if (data.schemaVersion !== 1 || !Array.isArray(data.unlocked)) throw new Error('Invalid CG gallery data')
    for (const ref of data.unlocked) validateAssetRef(ref,'$.unlocked','cg')
    return data.unlocked
  }
  return {
    async project({sessionId,turn,cgDisplay},project) {
      if (!cgDisplay) return project()
      const initial = await session(sessionId), stamp = digest(identity(initial)), revision = assets.revision, settings = readSettings().revision
      const result = await project()
      if (result.status !== 'ready' || !result.cgReceipt || !result.value.scene.cg) return result
      const latest = await session(sessionId)
      if (stamp !== digest(identity(latest)) || revision !== assets.revision || settings !== readSettings().revision) conflict()
      const token = randomBytes(32).toString('hex'), image = result.value.scene.cg
      for (const [key,value] of receipts) if (value.expires <= now()) receipts.delete(key)
      while (receipts.size >= 512) receipts.delete(receipts.keys().next().value)
      const receipt = {...result.cgReceipt,displayToken:token,visit:cgDisplay}
      receipts.set(token,{scope:digest([sessionId,Number(turn),stamp,receipt,image.ref,image.variant]),expires:now()+300000,revision,settings})
      return {...result,cgReceipt:receipt}
    },
    async list({sessionId,cursor,limit=48},origin) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid gallery limit')
      const {chat,cardId} = await session(sessionId), revision = assets.revision
      const unlocked = await read(cardId), keys = new Set(unlocked.map(assetRefKey))
      const snapshot = await assets.snapshot(chat.cardPath), rows = []
      for (const pack of snapshot?.snapshots || []) for (const asset of pack.manifest.assets) {
        if (asset.kind !== 'cg' || !asset.enabled || snapshot.assetStatus[assetRefKey({packId:pack.manifest.id,kind:'cg',assetId:asset.id})]?.available !== true) continue
        const ref = {packId:pack.manifest.id,kind:'cg',assetId:asset.id}
        rows.push({ref,unlocked:keys.has(assetRefKey(ref)),available:true,asset})
      }
      const present = new Set(rows.map(row => assetRefKey(row.ref)))
      for (const ref of unlocked) if (!present.has(assetRefKey(ref))) rows.push({ref,unlocked:true,available:false})
      const stamp = digest([cardId,snapshot?.cardRevision,snapshot?.snapshots.map(pack => [pack.manifest.id,pack.revision]),unlocked])
      let start = 0
      if (cursor) {
        const parts = String(cursor).split(':'); start = Number(parts[1])
        if (parts.length !== 2 || parts[0] !== stamp || !Number.isSafeInteger(start) || start < 0 || start > rows.length) conflict()
      }
      const items = [], consumer = rows.slice(start,start+limit).some(row => row.available && row.unlocked) ? await assets.consumer(chat,origin) : null
      for (const {asset,...row} of rows.slice(start,start+limit)) {
        if (row.available && row.unlocked) {
          if (!consumer?.presentation.available() || !consumer.allowedPackIds.includes(row.ref.packId)) conflict()
          row.label = asset.name; row.defaultVariant = asset.variants?.default ?? null; row.focusHints = assetContent(asset).focusHints || []
          row.variants = []
          for (const variant of asset.variants?.entries || [{id:null,name:asset.name}]) row.variants.push({key:variant.id,label:variant.name,image:await consumer.presentation.cg({ref:row.ref,variant:variant.id,focus:'full'},{descriptors:true})})
        }
        items.push(row)
      }
      if (revision !== assets.revision || snapshot && !snapshot.current()) conflict()
      return {schemaVersion:1,items,nextCursor:start+limit < rows.length ? `${stamp}:${start+limit}` : null}
    },
    async ack({sessionId,turn,receipt,ref,variant},origin) {
      validateAssetRef(ref,'$.ref','cg')
      const initial = await session(sessionId), permit = receipts.get(receipt?.displayToken)
      if (!permit || permit.expires <= now() || permit.revision !== assets.revision || permit.settings !== readSettings().revision ||
        permit.scope !== digest([sessionId,Number(turn),digest(identity(initial)),receipt,ref,variant])) conflict()
      // Consume before awaiting the lock; concurrent/replayed acknowledgements cannot reuse it.
      receipts.delete(receipt.displayToken)
      return cardStorage.withCardLock(initial.cardId,async () => {
        const {chat,cardId} = await session(sessionId)
        if (cardId !== initial.cardId || chat.id !== initial.chat.id) conflict()
        const revision = assets.revision, settings = readSettings()
        // CG on / off is 舞台引擎 › 可用演出; no card override.
        if (settings.values.dimensions.cg === false || revision !== permit.revision || settings.revision !== permit.settings || permit.expires <= now()) conflict()
        const snapshot = await assets.snapshot(chat.cardPath)
        if (!snapshot || snapshot.engine.dimensions.cg === false || snapshot.assetStatus[assetRefKey(ref)]?.available !== true) conflict()
        const direction = await readDirection(chat,turn), requested = verifyCgPlayedReceipt(direction,receipt,ref,variant)
        const consumer = await assets.consumer(chat,origin)
        if (!consumer?.presentation.available() || !consumer.allowedPackIds.includes(ref.packId)) conflict()
        const image = await consumer.presentation.cg(requested,{descriptors:true})
        if (!image || image.variant !== variant) conflict()
        const unlocked = await read(cardId), key = assetRefKey(ref), changed = !unlocked.some(item => assetRefKey(item) === key)
        const latest = await session(sessionId), finalDirection = await readDirection(latest.chat,turn)
        if (permit.expires <= now() || latest.cardId !== cardId || latest.chat.id !== chat.id || assets.revision !== revision || readSettings().revision !== settings.revision || !snapshot.current()) conflict()
        verifyCgPlayedReceipt(finalDirection,receipt,ref,variant)
        if (changed) {
          unlocked.push(ref); unlocked.sort((a,b) => assetRefKey(a).localeCompare(assetRefKey(b),'en'))
          try {await profileData.writeJson(file(cardId),{schemaVersion:1,unlocked})}
          catch (cause) {throw Object.assign(new Error('回想进度未保存'),{code:'CG_GALLERY_WRITE_FAILED',cause})}
        }
        return {ok:true,unlocked:true,changed}
      })
    },
    remove:cardId => cardStorage.withCardLock(cardId,() => profileData.remove(file(cardId)))
  }
}
