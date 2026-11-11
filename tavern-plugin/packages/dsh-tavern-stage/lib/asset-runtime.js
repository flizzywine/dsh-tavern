import { createAssetPackPresentation } from './domain/asset-pack-presentation.js'
import { createAssetPackSpeech } from '../../../lib/domain/asset-pack-speech.js'
import { readCardAssetExtension } from '../../../lib/domain/card-asset-bindings.js'
import { cardAssetWorkspaceRevision, hasCardAssetBindings } from '../../../lib/card-asset-bindings.js'
import { cardEngineSettings, effectiveCardStage } from '../../../lib/domain/card-stage-settings.js'
import { assetRefKey, resolveAssetSnapshot } from '../../dsh-presentation-protocol/src/asset-packs.js'

import { assetVoiceBinding } from '../../../lib/domain/figure-voice.js'
import { migrateServiceSourceModels } from './service-model-migration.js'
import { migrateReadingVoices } from './reading-voice-migration.js'
export { assetVoiceBinding } from '../../../lib/domain/figure-voice.js'

// The authenticated Tavern carrier owns sessions; pack services own bytes and leases.
export function createAssetRuntime({ctx, readWorkspace, engineSettings, onInvalidate = () => {},
  getBinding = (_ref, voice, options) => assetVoiceBinding(ctx.get('tts'), voice, options)}) {
  const getTts = () => ctx.get('tts')
  const consumers = new Map(), listeners = new Set()
  let generation = 0, disposed = false
  const service = () => { const value = ctx.get('assetLibrary'); return value?.apiVersion === 2 ? value : undefined }
  function clear(cardPath, event = {kind:'refresh', scope:{}, reason:'configuration'}) {
    generation++
    for (const [id, entry] of consumers) if (!cardPath || entry.cardPath === cardPath) {
      if (event.kind === 'revoked' && event.scope.authority) {
        consumers.delete(id); entry.speech?.dispose(); entry.presentation?.dispose()
      } else entry.presentation?.refresh(event)
    }
    for (const listener of listeners) listener(cardPath,event)
    onInvalidate(cardPath,event)
  }
  // the Fish / MiniMax model moves once from 配音后端 to each figure's source (service-model-migration.js).
  ctx.inject(['assetLibrary', 'tts'], child => { migrateServiceSourceModels({library:child.get('assetLibrary'), tts:child.get('tts')})
    .then(done => done && ctx.logger.info('service model migration %s', JSON.stringify(done)), error => ctx.logger.warn('service model migration failed: %s', error?.code || error?.message))
    // 通用声音 / 旁白's voices kept in the library move once onto figures they then point at (reading-voice-migration.js).
    migrateReadingVoices({library:child.get('assetLibrary'), tts:child.get('tts')})
      .then(done => done && ctx.logger.info('reading voice migration %s', JSON.stringify(done)), error => ctx.logger.warn('reading voice migration failed: %s', error?.code || error?.message)) })
  for (const name of ['assetLibrary', 'assetPackSettings', 'tts']) ctx.inject([name], child => {
    const lifecycle = reason => {
      if (name === 'tts') for (const entry of consumers.values()) {entry.speech?.dispose(); entry.speech = null}
      clear(undefined,{kind:name === 'assetLibrary' ? 'revoked' : 'refresh',scope:name === 'assetLibrary' ? {authority:true} : {},reason})
    }
    lifecycle('service-installed')
    const off = child.get(name)?.subscribe?.(event => {
      // A pack 通用声音 / 旁白 point at changed: the same as a readingChanged (their figure may be in no card's packs).
      if (name !== 'tts') {
        if (name === 'assetLibrary' && pointsAt(event.packId)) for (const entry of consumers.values()) {entry.speech?.dispose(); entry.speech = null}
        clear(undefined,{kind:event.revision === null ? 'revoked' : 'refresh',scope:{packId:event.packId},reason:'service-event'})
      }
      // readingChanged: tts.reading changed (旁白配音's global layer, or the figure 通用声音 / 旁白 point at), so each card's
      // config.voice.general / config.narrator is projected again.
      else if (['providerChanged','providerRemoved','disposed','cacheInvalidated','readingChanged'].includes(event.type)) {
        for (const entry of consumers.values()) {entry.speech?.dispose(); entry.speech = null}
        clear()
      }
    })
    child.effect(() => () => { off?.(); lifecycle('service-unloaded') })
  })
  const pointsAt = packId => { const reading = getTts()?.reading?.(); return !!packId && [reading?.general.figure, reading?.narrator.figure].some(ref => ref?.packId === packId) }
  const offEngine = engineSettings.subscribe(() => clear())
  // extraPackIds: packs a caller adds on top of the card's own (an enabled mod's built-in pack); the caller decides their state.
  async function snapshot(cardPath, {extraPackIds = []} = {}) {
    if (disposed) throw new Error('Asset runtime disposed')
    const epoch = generation, workspace = await readWorkspace(cardPath), raw = workspace?.raw
    if (!raw || !hasCardAssetBindings(raw)) return null
    const extension = readCardAssetExtension(raw)
    if (!effectiveCardStage(extension, engineSettings.read().values).stage) return null
    const owner = service(), settings = engineSettings.read()
    const globalEnabledPackIds = ctx.get('assetPackSettings')?.read().values.globalEnabledPackIds || []
    const snapshots = [], assetStatus = {}
    if (owner) {
      const packIds = [...new Set([...extension.assetBindings.boundPackIds, ...globalEnabledPackIds, ...extraPackIds])]
      const reads = await Promise.allSettled(packIds.map(packId => owner.getPackSnapshot({packId})))
      for (const result of reads) {
        if (result.status === 'rejected') throw result.reason
        if (result.value) snapshots.push(result.value)
      }
      for (const pack of snapshots) for (const asset of pack.manifest.assets) {
        const row = resolveAssetSnapshot(pack,{packId:pack.manifest.id,kind:asset.kind,assetId:asset.id})
        assetStatus[assetRefKey(row.ref)] = {available:!!row.value && (row.ref.kind === 'props' || row.value.pendingMedia !== true) && !row.diagnostics.length}
      }

    }
    // A change landing while the packs were read makes the read mixed: read them again, so a pack
    // write never fails the director that asked.
    if (epoch !== generation || owner !== service()) return snapshot(cardPath, {extraPackIds})
    const values = cardEngineSettings(settings.values, extension)
    return {raw, cardRevision:cardAssetWorkspaceRevision(workspace), snapshots, globalEnabledPackIds, assetStatus,
      engine:{...values, widgetsEnabled:values.dimensions.widgets},
      current:() => !disposed && epoch === generation && owner === service() && settings.revision === engineSettings.read().revision}
  }
  async function consumer(chat, origin) {
    const workspace = await readWorkspace(chat.cardPath), id = chat.sessionId
    if (disposed) throw new Error('Asset runtime disposed')
    let entry = consumers.get(id)
    if (!workspace?.raw || !hasCardAssetBindings(workspace.raw)) {
      consumers.delete(id); entry?.speech?.dispose(); entry?.presentation.dispose()
      return null
    }
    if (!origin) throw new Error('Authenticated same-origin carrier required')
    const revision = cardAssetWorkspaceRevision(workspace)
    if (entry && (entry.origin !== origin || entry.cardPath !== chat.cardPath)) {
      entry.speech?.dispose(); entry.presentation.dispose(); consumers.delete(id); entry = null
    }
    if (entry && entry.revision !== revision) {entry.presentation.rebind(workspace.raw); entry.revision = revision}
    if (!entry) {
      const presentation = createAssetPackPresentation({raw:workspace.raw, getEngine:() => engineSettings.read().values, getService:service, getAllowedPackIds:() => entry?.allowedPackIds || [], origin, scope:'dsh-browser', onInvalidate:event => {
        // external same-UUID publications must also invalidate the
        // director envelope and browser warm timeline, not just server descriptors.
        if (event.reason === 'pack-revision-observed') {
          generation++
          for (const listener of listeners) listener(chat.cardPath,event)
        }
        onInvalidate(chat.cardPath,event)
      }})
      const speech = createAssetPackSpeech({getLibrary:service,presentation, getEngine:() => engineSettings.read().values, getTts, getBinding, scope:'dsh-browser'})
      entry = {cardPath:chat.cardPath, revision, origin, presentation, speech}
      consumers.set(id, entry)
    }
    if (!entry.speech) entry.speech = createAssetPackSpeech({getLibrary:service,presentation:entry.presentation,getEngine:() => engineSettings.read().values,getTts,getBinding,scope:'dsh-browser'})
    entry.allowedPackIds = [...new Set([...entry.presentation.extension.assetBindings.boundPackIds,
      ...(ctx.get('assetPackSettings')?.read().values.globalEnabledPackIds || [])])]
    return entry
  }
  return {snapshot, consumer, invalidate:clear, get revision() {return generation},
    async hasBindings(cardPath) {const raw = (await readWorkspace(cardPath))?.raw; return !!raw && hasCardAssetBindings(raw) && effectiveCardStage(readCardAssetExtension(raw), engineSettings.read().values).stage},
    subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn)},
    dispose() {disposed = true; offEngine(); clear(undefined,{kind:'revoked',scope:{authority:true},reason:'disposed'}); listeners.clear()}}
}
