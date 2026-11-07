import { mkdir } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'

/** One-way legacy admission, full-history verification and native cutover. */
export function createChatStorageMigration({ native, compatible, journal, serialize, flushMaintenance,
  materialize, forgetState, layout, safeChatId }) {
  const { read: materializeLegacy, version: legacyVersion } = journal
  const missingRevision = error => error?.code === 'DSH_TAVERN_REVISION_NOT_FOUND'
  async function readLegacy(chatId, revision = Number.POSITIVE_INFINITY, cache) {
    return await compatible?.read(chatId, revision) || materializeLegacy(chatId, revision, cache)
  }
  async function legacySourceVersion(chatId) {
    const marker = await compatible?.status(chatId)
    return JSON.stringify({ marker, compatible: await compatible?.version(chatId), legacy: await legacyVersion(chatId) })
  }
  async function readLegacyHistory(chatId, beforeRevision, current) {
    const marker = await compatible?.status(chatId)
    // A flat Chat has exactly one revision. Avoid rereading its whole JSON once
    // for every integer below that revision merely to rediscover that fact.
    if (!current && !marker?.target && !(marker?.historyTargets?.length)) return []
    if (current?.legacy && !current.snapshot && !current.open && !marker?.target && !(marker?.historyTargets?.length)) return []
    const history = [], cache = { rows: new Map(), parsed: new Map(), snapshots: new Map(), flat: new Map(), roots: new Map() }
    for (let revision = 0; revision < beforeRevision; revision++) {
      try {
        const state = await readLegacy(chatId, revision, cache)
        if (state) history.push(state.chat)
      } catch (error) {
        if (!missingRevision(error)) throw error
      }
    }
    return history
  }
  // Original files remain untouched as backups. Every readable pre-cutover
  // revision becomes native before publication; partial migrations resume in place.
  async function upgradeStorage(chatId,{onProgress=()=>{},assertCanMigrate=()=>{}}={}){
    safeChatId(chatId)
    await flushMaintenance()
    return serialize(chatId,async()=>{
      onProgress('reading')
      const state = await materialize(chatId)
      if (!state) return {status:'missing'}
      const legacyInitialRevision = state.native?.view?.metadata?.settings?.legacyInitialRevision
      if (state.native && legacyInitialRevision === undefined) return {status:'native',alreadyActive:true,historyImported:0}
      await mkdir(layout(chatId).root,{recursive:true})
      const captured = await legacySourceVersion(chatId)
      const legacyCurrent = await readLegacy(chatId)
      if (!state.native && !legacyCurrent) return {status:'missing'}
      const current = state.native ? state.chat : legacyCurrent.chat
      if (!Number.isSafeInteger(current._storageRevision) || current._storageRevision < 0) throw new Error('Legacy Chat has no valid storage revision')
      const cutoff = state.native ? Number(legacyInitialRevision) : current._storageRevision
      if (!Number.isSafeInteger(cutoff) || cutoff < 0) throw new Error('Native migration has no valid legacy revision boundary')
      if (state.native && legacyCurrent && legacyCurrent.revision > cutoff) {
        const error = new Error('Legacy storage advanced after the native cutover; keep both sources unchanged for diagnosis')
        error.code = 'DSH_TAVERN_LEGACY_DIVERGED'
        throw error
      }
      const history = await readLegacyHistory(chatId, cutoff, legacyCurrent)
      await assertCanMigrate(current)
      onProgress('converting')
      const verifyBeforePublish = async restored => {
        onProgress('verifying')
        if (!isDeepStrictEqual(restored, current)) throw new Error('Native migration round-trip verification failed')
        if (await legacySourceVersion(chatId) !== captured) throw new Error('Source changed during native migration')
      }
      if (state.native) await native.importHistory(chatId, history, { verifyBeforePublish })
      else await native.create(chatId,current,undefined,{migration:true,history,verifyBeforePublish})
      forgetState(chatId)
      return {status:'native',alreadyActive:Boolean(state.native),sourceRevision:legacyCurrent?.revision ?? cutoff,retainedLegacy:true,historyImported:history.length}
    })
  }

  return Object.freeze({ upgradeStorage })
}
