import {createAssetPackSpeech} from './asset-pack-speech.js'
import {figureCatalogue, resolution} from './figure-catalogue.js'
import {readCardAssetExtension} from './card-asset-bindings.js'
import {cardAssetWorkspaceRevision, hasCardAssetBindings} from '../card-asset-bindings.js'
import {resolveFigureSnapshot} from '../../packages/dsh-presentation-protocol/src/asset-packs.js'

// The chat and stage RPCs use the same scoped voice registrations. Speaker lookup
// only needs the card's asset bindings and figure packs, including global packs.
export function createCardDialogueSpeech({readWorkspace, getEngine, getLibrary, getGlobalEnabledPackIds, getTts}) {
  const entries = new Map()
  let active = true
  function invalidate(path, event) {
    for (const [id, entry] of entries) {
      if (path && entry.cardPath !== path) continue
      if (event?.scope?.authority) {
        entries.delete(id)
        entry.speech.dispose()
      } else {
        entry.snapshots.clear()
        for (const listener of entry.listeners) listener(event)
      }
    }
  }
  async function forGame({cardPath, sessionId}, origin) {
    if (!origin) throw new Error('Authenticated same-origin carrier required')
    const workspace = await readWorkspace(cardPath)
    if (!active) return null
    let entry = entries.get(sessionId)
    const raw = workspace?.raw
    const revision = raw && hasCardAssetBindings(raw) ? cardAssetWorkspaceRevision(workspace) : null
    if (entry && (entry.cardPath !== cardPath || entry.origin !== origin || entry.revision !== revision)) {
      entries.delete(sessionId)
      entry.speech.dispose()
      entry = null
    }
    if (!revision) return null
    if (entry) return entry.speech
    const extension = readCardAssetExtension(raw)
    const listeners = new Set(), snapshots = new Map()
    const allowedPacks = () => [...new Set([...extension.assetBindings.boundPackIds, ...getGlobalEnabledPackIds()])]
    const snapshot = packId => {
      if (!snapshots.has(packId)) {
        const read = Promise.resolve().then(() => getLibrary()?.getPackSnapshot({packId}))
        snapshots.set(packId, read)
        read.catch(() => { if (snapshots.get(packId) === read) snapshots.delete(packId) })
      }
      return snapshots.get(packId)
    }
    const figureRows = async () => {
      const allowed = allowedPacks()
      const packs = await Promise.all(allowed.map(snapshot))
      return figureCatalogue({snapshots:packs.filter(Boolean), bindings:extension.assetBindings, globalEnabledPackIds:allowed})
    }
    const presentation = {extension, figureRows,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      async resolveName(segment) { return resolution.resolveFigureName(await figureRows(), segment) },
      async resolveFigure(ref) { return resolveFigureSnapshot(await snapshot(ref.packId), ref) },
      async readReference(ref, revision, hash) {
        const pack = await snapshot(ref.packId)
        const limit = 32 * 1024 ** 2
        if (pack?.manifest.blobs?.[hash]?.size > limit) throw Object.assign(new Error('REFERENCE_UNAVAILABLE'), {code:'REFERENCE_UNAVAILABLE'})
        const result = await getLibrary().readMedia({packId:ref.packId, expectedRevision:revision, hash})
        if (result.bytes.length > limit) throw Object.assign(new Error('REFERENCE_UNAVAILABLE'), {code:'REFERENCE_UNAVAILABLE'})
        return result.bytes
      }
    }
    const speech = createAssetPackSpeech({presentation, getEngine, getLibrary, getTts, scope:'dsh-browser'})
    entries.set(sessionId, {cardPath, origin, revision, snapshots, listeners, speech})
    return speech
  }
  return {forGame, invalidate, dispose() {
    active = false
    invalidate(undefined, {scope:{authority:true}})
  }}
}
