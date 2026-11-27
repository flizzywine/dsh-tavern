// card-derived monotonic unlocks; never card/pack/story content.
import {randomBytes} from 'node:crypto'
import {CARD_ID} from '../../../lib/card-storage.js'
import {assetRefKey,validateAssetRef} from '../../dsh-presentation-protocol/src/asset-packs.js'
import {assetContent} from '../../dsh-presentation-protocol/src/asset-variant-content.js'
import scenePictureOf from '../../dsh-presentation-protocol/src/scene-picture.cjs'
import {assetPackDigest as digest} from './domain/stage-asset-pack-catalogue.js'
import {verifyCgPlayedReceipt} from './domain/cg-played-receipt.js'
const conflict = () => {throw Object.assign(new Error('CG gallery changed; reload'),{code:'REVISION_CONFLICT'})}
const file = id => {
  if (!CARD_ID.test(id || '')) throw new Error('Invalid card identity')
  return `stage/cg-gallery/${id}.json`
}
// An entry deleted from its pack (the pack still exists, the entry does not) is gone for good; an entry that is only
// disabled, unbound or in an uninstalled pack may come back, so its unlock stays.
const holds = (pack,ref) => !!pack?.manifest.assets.some(asset => asset.kind === 'cg' && asset.id === ref.assetId)
const entryDeleted = (pack,ref) => !!pack && !holds(pack,ref)
// an unlock is of the CG wherever it is now: a CG moved to another pack (素材库「移动到…」) keeps its id and its unlock
const unlockKey = ref => validateAssetRef(ref).assetId
// 回想's filter: a 场景生图 picture is 自动 (scene), every other CG the card's own (card).
const SOURCES = ['all','card','scene'], ORDERS = ['newest','oldest']
const sourceOf = asset => asset ? scenePictureOf(asset) ? 'scene' : 'card' : null
export function createCgGallery({profileData,cardStorage,resolveCard,chatForSession,assets,readDirection,readSettings,now=Date.now}) {
  // ephemeral display capabilities, never serialized into story/playback.
  const receipts = new Map()
  const identity = value => [value.cardId,value.chat.id,value.chat.cardPath]
  async function session(sessionId) {
    const chat = await chatForSession(sessionId)
    if (!chat?.cardPath || chat.mode === 'card') throw new Error('A playing session is required')
    return {chat,cardId:await resolveCard(chat.cardPath)}
  }
  // unlockedAt: when each CG was unlocked (ms, by unlockKey); unlocks written before it was recorded have none.
  async function load(cardId) {
    const data = await profileData.readJson(file(cardId))
    if (!data) return {unlocked:[],unlockedAt:{}}
    if (data.schemaVersion !== 1 || !Array.isArray(data.unlocked)) throw new Error('Invalid CG gallery data')
    // Each ref was checked when ack wrote it; a read keeps fields this version does not know.
    return {unlocked:data.unlocked,unlockedAt:data.unlockedAt && typeof data.unlockedAt === 'object' ? data.unlockedAt : {}}
  }
  const read = async cardId => (await load(cardId)).unlocked
  // every write: refs in key order, times only for the refs still unlocked.
  function save(cardId,unlocked,unlockedAt) {
    unlocked.sort((a,b) => assetRefKey(a).localeCompare(assetRefKey(b),'en'))
    const times = Object.fromEntries(unlocked.map(ref => [unlockKey(ref),unlockedAt[unlockKey(ref)]]).filter(([,at]) => Number.isSafeInteger(at)))
    return profileData.writeJson(file(cardId),{schemaVersion:1,unlocked,...(Object.keys(times).length ? {unlockedAt:times} : {})})
  }
  // one unlock, stamped now; false when the CG was already unlocked.
  async function add(cardId,ref) {
    const {unlocked,unlockedAt} = await load(cardId), key = unlockKey(ref)
    if (unlocked.some(item => unlockKey(item) === key)) return false
    unlocked.push(ref)
    await save(cardId,unlocked,{...unlockedAt,[key]:now()})
    return true
  }
  // A pack the library no longer has keeps its unlocks (it may be installed again); only entries gone from an existing pack are dropped.
  async function prune(service,packId) {
    const pack = await service.getPackSnapshot({packId}).catch(() => null)
    if (!pack) return
    const library = (await service.listPacks()).filter(row => row.manifest)
    for (const {name,directory} of await profileData.list('stage/cg-gallery')) if (!directory && name.endsWith('.json')) {
      const cardId = name.slice(0,-5)
      await cardStorage.withCardLock(cardId,async () => {
        const {unlocked,unlockedAt} = await load(cardId), rest = unlocked.filter(ref => ref.packId !== packId || !entryDeleted(pack,ref) || library.some(row => holds(row,ref)))
        if (rest.length !== unlocked.length) await save(cardId,rest,unlockedAt)
      })
    }
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
    async list({sessionId,cursor,limit=48,source='all',order='newest'},origin) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid gallery limit')
      if (!SOURCES.includes(source)) throw new Error('Invalid gallery source')
      if (!ORDERS.includes(order)) throw new Error('Invalid gallery order')
      const {chat,cardId} = await session(sessionId), revision = assets.revision
      const {unlocked,unlockedAt} = await load(cardId), keys = new Set(unlocked.map(unlockKey))
      const snapshot = await assets.snapshot(chat.cardPath), rows = [], packs = new Map(snapshot?.snapshots.map(pack => [pack.manifest.id,pack]))
      for (const pack of snapshot?.snapshots || []) for (const asset of pack.manifest.assets) {
        if (asset.kind !== 'cg') continue
        const ref = {packId:pack.manifest.id,kind:'cg',assetId:asset.id}, key = assetRefKey(ref), isUnlocked = keys.has(unlockKey(ref))
        if ((!asset.enabled && !isUnlocked) || snapshot.assetStatus[key]?.available !== true) continue
        rows.push({ref,unlocked:isUnlocked,available:true,asset,source:sourceOf(asset)})
      }
      const present = new Set(rows.map(row => unlockKey(row.ref))), found = rows.length
      for (const ref of unlocked) if (!present.has(unlockKey(ref)) && !entryDeleted(packs.get(ref.packId),ref))
        rows.push({ref,unlocked:true,available:false,source:sourceOf(packs.get(ref.packId)?.manifest.assets.find(asset => asset.kind === 'cg' && asset.id === ref.assetId))})
      // newest first: by unlock time; unlocks without one, and locked cells, after them, later pack entries first (a pack
      // appends what it gains); 素材不可用 cells without a time last.
      const rank = rows.map((row,i) => [unlockedAt[unlockKey(row.ref)] ?? -Infinity,i < found ? i : i - rows.length])
      const sorted = rows.map((row,i) => i).sort((a,b) => rank[b][0] - rank[a][0] || rank[b][1] - rank[a][1]).map(i => rows[i])
      // 旧的在前 is the same list read backwards, locked cells still last
      if (order === 'oldest') sorted.reverse().sort((a,b) => !a.unlocked - !b.unlocked)
      // the filter only exists while both kinds do; otherwise every cell shows.
      const mixed = rows.some(row => row.source === 'scene') && rows.some(row => row.source === 'card'), shown = mixed ? source : 'all'
      const listed = shown === 'all' ? sorted : sorted.filter(row => row.source === shown)
      const stamp = digest([cardId,snapshot?.cardRevision,snapshot?.snapshots.map(pack => [pack.manifest.id,pack.revision]),unlocked,unlockedAt,shown,order])
      let start = 0
      if (cursor) {
        const parts = String(cursor).split(':'); start = Number(parts[1])
        if (parts.length !== 2 || parts[0] !== stamp || !Number.isSafeInteger(start) || start < 0 || start > listed.length) conflict()
      }
      const page = listed.slice(start,start+limit), items = [], consumer = page.some(row => row.available && row.unlocked) ? await assets.consumer(chat,origin) : null
      for (const {asset,source:_,...row} of page) {
        if (row.available && row.unlocked) {
          if (!consumer?.presentation.available() || !consumer.allowedPackIds.includes(row.ref.packId)) conflict()
          row.label = asset.name; row.defaultVariant = asset.variants?.default ?? null; row.focusHints = assetContent(asset).focusHints || []
          // a 场景生图 picture (scene-cg.js): 回想 offers its edit and delete shortcuts.
          if (scenePictureOf(asset)) row.scene = true
          row.variants = []
          for (const variant of asset.variants?.entries || [{id:null,name:asset.name}]) row.variants.push({key:variant.id,label:variant.name,image:await consumer.presentation.cg({ref:row.ref,variant:variant.id,focus:'full'},{descriptors:true})})
        }
        items.push(row)
      }
      if (revision !== assets.revision || snapshot && !snapshot.current()) conflict()
      return {schemaVersion:1,items,nextCursor:start+limit < listed.length ? `${stamp}:${start+limit}` : null,mixed,source:shown,order}
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
        const changed = !(await read(cardId)).some(item => unlockKey(item) === unlockKey(ref))
        const latest = await session(sessionId), finalDirection = await readDirection(latest.chat,turn)
        if (permit.expires <= now() || latest.cardId !== cardId || latest.chat.id !== chat.id || assets.revision !== revision || readSettings().revision !== settings.revision || !snapshot.current()) conflict()
        verifyCgPlayedReceipt(finalDirection,receipt,ref,variant)
        if (changed) {
          try {await add(cardId,ref)}
          catch (cause) {throw Object.assign(new Error('回想进度未保存'),{code:'CG_GALLERY_WRITE_FAILED',cause})}
        }
        return {ok:true,unlocked:true,changed}
      })
    },
    // A 场景生图 picture is the player's own: unlocked when it is made (scene-cg.js), never by a played receipt.
    unlock:(cardId,ref) => cardStorage.withCardLock(cardId,() => add(cardId,ref)),
    forget:(cardId,ref) => cardStorage.withCardLock(cardId,async () => {
      const {unlocked,unlockedAt} = await load(cardId), key = unlockKey(ref), rest = unlocked.filter(item => unlockKey(item) !== key)
      if (rest.length !== unlocked.length) await save(cardId,rest,unlockedAt)
    }),
    unlocked:read,
    // Every library write that removes a CG entry (an editor delete, an import, a pack replace) drops that entry's unlock on every card; returns the unsubscribe.
    watch:service => service.subscribe(event => {
      if (event.revision !== null && event.kinds.includes('cg')) prune(service,event.packId).catch(error => console.warn('dsh-tavern: 回想解锁清理失败:',error.message))
    }),
    // scene-cg.js relocate: unlocks follow pictures that moved to another pack ([from, to] ref pairs).
    move:(cardId,pairs) => cardStorage.withCardLock(cardId,async () => {
      const to = new Map(pairs.map(([from,next]) => [assetRefKey(from),next])), seen = new Set(), unlocked = [], prior = await load(cardId), unlockedAt = {...prior.unlockedAt}
      for (const old of prior.unlocked) {
        const ref = to.get(assetRefKey(old)) || old
        // a moved picture keeps when it was unlocked
        if (ref !== old && unlockedAt[unlockKey(old)] !== undefined) unlockedAt[unlockKey(ref)] ??= unlockedAt[unlockKey(old)]
        if (!seen.has(assetRefKey(ref))) { seen.add(assetRefKey(ref)); unlocked.push(ref) }
      }
      await save(cardId,unlocked,unlockedAt)
    }),
    remove:cardId => cardStorage.withCardLock(cardId,() => profileData.remove(file(cardId)))
  }
}
