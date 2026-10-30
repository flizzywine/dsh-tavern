import {detectStageSetupCharacters} from './domain/stage-setup-characters.js'
import { effectiveCardStage } from './domain/card-stage-settings.js'
import { rawData } from './domain/card-preparation.js'
import { cardAssetRawOperations, readCardAssetExtension } from './domain/card-asset-bindings.js'
import { createHash } from 'node:crypto'
import { emptyCardVariableBindings, validateVariableSlots, validateVariableTarget, variableTargetKey, listCardVariableProviders } from './domain/card-variable-bindings.js'
import { check, shape, text, cloneJson, canonicalJson } from '../packages/dsh-presentation-protocol/src/asset-pack-json.js'
import { validateAssetRef, validateUuid } from '../packages/dsh-presentation-protocol/src/asset-packs.js'

export const cardAssetWorkspaceRevision = workspace => createHash('sha256').update(canonicalJson(workspace)).digest('hex')
export const hasCardAssetBindings = raw => Object.hasOwn(rawData(raw)?.extensions?.dsh_tavern || {}, 'assetBindings')
const diagnostic = code => ({code})
const optional = (ctx, name) => { try { return ctx.get(name) } catch { return undefined } }

// Fresh lookup on every operation: no retained service, lease, or v1 fallback.
export function createOptionalAssetPackConsumer(ctx) {
  async function negotiate() {
    const service = optional(ctx, 'assetLibrary')
    if (!service) return {diagnostics:[diagnostic('ASSET_LIBRARY_UNAVAILABLE')]}
    try {
      const capabilities = service.capabilities
      if (service.apiVersion !== 2 || !Array.isArray(capabilities) || !['packs','figures'].every(key => capabilities.includes(key)) || !['listPacks', 'getPackSnapshot', 'resolveFigures'].every(key => typeof service[key] === 'function')) {
        return {diagnostics:[diagnostic('API_INCOMPATIBLE')]}
      }
      if (optional(ctx, 'assetLibrary') !== service) return {diagnostics:[diagnostic('ASSET_LIBRARY_UNAVAILABLE')]}
      return {service, diagnostics:[]}
    } catch { return {diagnostics:[diagnostic('ASSET_LIBRARY_UNAVAILABLE')]} }
  }
  return Object.freeze({
    async inspect(extension) {
      if (!extension) return {active:false, live:false, available:false, figures:[], diagnostics:[]}
      const {service, diagnostics} = await negotiate(), figures = []
      if (!optional(ctx, 'tts')) diagnostics.push(diagnostic('TTS_UNAVAILABLE'))
      if (service) {
        for (const packId of extension.assetBindings.boundPackIds) {
          try {
            const snapshot = await service.getPackSnapshot({packId})
            check(snapshot?.manifest?.id === packId && Array.isArray(snapshot.manifest.figures), '$.snapshot')
            const candidates = snapshot.manifest.figures.map(figureId => { validateUuid(figureId); return {packId, figureId} })
            figures.push(...candidates)
          } catch { diagnostics.push({code:'PACK_UNAVAILABLE', packId}) }
        }
        // A provider unloaded during an await cannot leave stale selectable figures.
        if (optional(ctx, 'assetLibrary') !== service) return {active:true, live:false, available:false, figures:[], diagnostics:[...diagnostics, diagnostic('ASSET_LIBRARY_UNAVAILABLE')]}
      }
      return {active:true, live:!!service, available:!!service, figures, diagnostics}
    },
  })
}

// The host supplies its existing Card Preparation writer and card queue. No asset I/O.
export function createCardAssetBoundary({ctx, getEngine, listCards, readWorkspace, updateCard, syncBubbles = async () => {}, readVariableSources = async () => ({}), readCharacterBook = async () => null, modManifests = async () => [], modConfig = false}) {
  const consumer = createOptionalAssetPackConsumer(ctx)
  async function workspace(path) {
    check(typeof path === 'string' && (await listCards()).some(card => card.path === path), '$.path', 'Card not found', 'NOT_FOUND')
    const value = await readWorkspace(path)
    check(!!value, '$.path', 'Card not found', 'NOT_FOUND')
    return value
  }
  async function snapshot(path) {
    const card = await workspace(path)
    const extension = hasCardAssetBindings(card.raw) ? readCardAssetExtension(card.raw) : null
    return {path, ...(card.meta?.id?{cardId:card.meta.id}:{}), revision:cardAssetWorkspaceRevision(card), extension, effectiveStage:effectiveCardStage(extension, getEngine?.())}
  }
  async function snapshots(ids) {
    const service = optional(ctx,'assetLibrary'), packs = []
    for (const packId of new Set(ids)) {
      const pack = await service?.getPackSnapshot({packId}).catch(() => null)
      if (pack && !pack.privateConfig) packs.push(pack)
    }
    return packs
  }
  async function readVariables({path}) {
    const value = await snapshot(path)
    return {path,revision:value.revision,variableBindings:value.extension?.variableBindings || emptyCardVariableBindings()}
  }
  async function writeVariable({path,expectedRevision,target,variable}, clear = false) {
    validateVariableTarget(target)
    check(!modConfig || target.kind !== 'mods','$.target','Use mod config for mod bindings','UNKNOWN_FIELD')
    if(modConfig && target.kind==='widgets')check((await snapshots([target.ref.packId]))[0]?.widgets?.[target.ref.assetId]?.namespace!=='phone','$.target','Use mod config for phone bindings','UNKNOWN_FIELD')
    const current = await readVariables({path})
    check(current.revision === expectedRevision,'$.expectedRevision','Card changed','REVISION_CONFLICT')
    const entries = current.variableBindings.entries.filter(row => variableTargetKey(row.target) !== variableTargetKey(target))
    if (!clear) entries.push({target,variable})
    const value = await snapshot(path)
    await api.update({path,expectedRevision,patch:{...(!value.extension ? {assetBindings:{boundPackIds:[]}} : {}),variableBindings:{version:1,entries}}})
    return readVariables({path})
  }
  const api = {
    async detectCharacters({path}) {
      const card = await workspace(path)
      return {path,revision:cardAssetWorkspaceRevision(card),candidates:detectStageSetupCharacters(card.raw,[await readCharacterBook(path)])}
    },
    readVariables,
    setVariable:input => writeVariable(input),
    clearVariable:input => writeVariable(input,true),
    async listVariableSlots({path,sessionId}) {
      const card = await workspace(path), extension = readCardAssetExtension(card.raw)
      const global = optional(ctx,'assetPackSettings')?.read().values.globalEnabledPackIds || []
      const packs = await snapshots([...(extension?.assetBindings?.boundPackIds || []),...global])
      const sources = sessionId ? await readVariableSources({path,sessionId}) : {}
      const providers = listCardVariableProviders({raw:card.raw,packs,sources,modConfig,modManifests:await modManifests(),boundPackIds:extension?.assetBindings?.boundPackIds || [],allowedPackIds:[...(extension?.assetBindings?.boundPackIds || []),...global],widgetsEnabled:effectiveCardStage(extension, getEngine?.()).widgets})
      return {path,revision:cardAssetWorkspaceRevision(card),providers}
    },
    async readCardVariables({path,sessionId,targets}) {
      check(typeof sessionId === 'string','$.sessionId')
      if (targets !== undefined) {
        check(Array.isArray(targets) && targets.length <= 64,'$.targets')
        targets.forEach(validateVariableTarget)
      }
      const result = await api.listVariableSlots({path,sessionId})
      if (targets) {
        const keys = new Set(targets.map(variableTargetKey))
        result.providers = result.providers.map(provider => ({...provider,slots:provider.slots.filter(slot => keys.has(variableTargetKey(slot.target)))})).filter(provider => provider.slots.length)
      }
      return result
    },
    async copyWidget({path,expectedRevision,ref,target}) {
      validateAssetRef(ref); check(ref.kind === 'widgets','$.ref.kind')
      const current = await snapshot(path)
      check(current.revision === expectedRevision,'$.expectedRevision','Card changed','REVISION_CONFLICT')
      const boundPackIds = current.extension?.assetBindings.boundPackIds || []
      check(!target?.packId || boundPackIds.includes(target.packId),'$.target.packId','Target pack must belong to this card','UNBOUND_PACK')
      const service = optional(ctx,'assetLibrary')
      check(typeof service?.copyItems === 'function','$.service','Asset library unavailable','ASSET_UNAVAILABLE')
      const copy = await service.copyItems({sourcePackId:ref.packId,itemRefs:[{kind:'widgets',id:ref.assetId}],target})
      try {
        const result = await api.update({path,expectedRevision,patch:{assetBindings:{boundPackIds:[...new Set([...boundPackIds,copy.packId])]}}})
        return {...result,copy}
      } catch (error) { error.copiedPack = copy; error.message += ' (copied pack: ' + copy.packId + ')'; throw error }
    },
    snapshot,
    async inspect({path, metadataOnly = false}) {
      check(typeof metadataOnly === 'boolean', '$.metadataOnly')
      const value = await snapshot(path)
      // Library rows need binding/CAS state, not every bound figure's documents.
      return metadataOnly ? value : {...value, ...await consumer.inspect(value.extension)}
    },
    async update({path, patch, expectedRevision}) {
      const card = await workspace(path)
      check(typeof expectedRevision === 'string' && expectedRevision === cardAssetWorkspaceRevision(card), '$.expectedRevision', 'Card changed', 'REVISION_CONFLICT')
      patch = cloneJson(patch)
      check(!Object.hasOwn(patch,'modConfigPackId'),'$.patch.modConfigPackId','Config pack identity is managed by its owner','UNKNOWN_FIELD')
      if(modConfig && patch.variableBindings)check(!patch.variableBindings.entries.some(row=>row.target.kind==='mods'),'$.patch.variableBindings','Use mod config for mod bindings','UNKNOWN_FIELD')
      const rawOperations = cardAssetRawOperations(card.raw, patch, {skinPackIds:optional(ctx,'assetPackSettings')?.read().values.globalEnabledPackIds || []})
      if (patch.variableBindings !== undefined) {
        const packs = await snapshots(patch.variableBindings.entries.map(row => row.target.ref?.packId).filter(Boolean))
        if(modConfig)check(!patch.variableBindings.entries.some(row=>row.target.kind==='widgets' && packs.find(pack=>pack.manifest.id===row.target.ref.packId)?.widgets?.[row.target.ref.assetId]?.namespace==='phone'),'$.patch.variableBindings','Use mod config for phone bindings','UNKNOWN_FIELD')
        validateVariableSlots(patch.variableBindings,packs,readCardAssetExtension(card.raw)?.variableBindings,await modManifests())
      }
      // The writer rechecks this token *inside* the existing queue before committing.
      await updateCard(path, {}, undefined, rawOperations, { expectedAssetRevision: expectedRevision })
      await syncBubbles(path)
      return snapshot(path)
    },
    async dependencies({packId}) {
      validateUuid(packId)
      try {
        const cards = await listCards(), revisions = [], affected = []
        for (const item of cards) {
          const card = await readWorkspace(item.path)
          check(!!card, '$.card')
          revisions.push([item.path, cardAssetWorkspaceRevision(card)])
          if (hasCardAssetBindings(card.raw) && readCardAssetExtension(card.raw).assetBindings.boundPackIds.includes(packId)) affected.push({path:item.path, name:rawData(card.raw).name || ''})
        }
        check(JSON.stringify(cards.map(card => card.path).sort()) === JSON.stringify((await listCards()).map(card => card.path).sort()), '$.cards')
        for (const [path, revision] of revisions) check(cardAssetWorkspaceRevision(await readWorkspace(path)) === revision, '$.revision')
        return {available:true, packId, count:affected.length, cards:cloneJson(affected), diagnostics:[]}
      } catch { return {available:false, packId, count:null, cards:[], diagnostics:[diagnostic('DEPENDENCY_INDEX_UNAVAILABLE')]} }
    },
  }
  return Object.freeze(api)
}
