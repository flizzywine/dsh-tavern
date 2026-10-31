import { defaultAssetEngineSettings } from '../../../lib/domain/asset-engine-settings.js'
import { syncPreparedCardBubbles } from './card-stage.js'
import { rawData } from '../../../lib/domain/card-preparation.js'
import { readCardAssetExtension,cardAssetRawOperations } from '../../../lib/domain/card-asset-bindings.js'
import { validateVariableSlots } from '../../../lib/domain/card-variable-bindings.js'
import { validateModCardBindings } from '../../../lib/domain/mods/card-bindings.js'
import { cardAssetWorkspaceRevision } from '../../../lib/card-asset-bindings.js'
import { check, cloneJson } from '../../dsh-presentation-protocol/src/asset-pack-json.js'

import {withoutPlayerChoices} from '../../../lib/domain/card-export-settings.js'
export {withoutPlayerChoices} from '../../../lib/domain/card-export-settings.js'

// Binding-only commits must not reopen every linked chat to synchronize an unchanged name.
export function createCardBundleWriter({readWorkspace,cardPreparation,publish,bumpCardProjectionRevision,syncCardName}) {
  return async (path,workspace,cover) => {
    const before = await readWorkspace(path)
    const name = cardPreparation.project(workspace).name
    await publish(path,workspace,cover)
    await bumpCardProjectionRevision(path)
    if (!before || cardPreparation.project(before).name !== name) await syncCardName(path,name)
  }
}

// No routes or arbitrary filesystem port. P6 supplies authorized resource identities,
// the existing card queue and the durable Card Preparation workspace writer.
export function createCardBundleAdapter({cardPreparation, authorizeTarget, readWorkspace, writeWorkspace, withCardLock, dependencies, readCover = async () => undefined, getEngine = defaultAssetEngineSettings}) {
  async function target(path) {
    const value = await authorizeTarget(path)
    check(value && typeof value.cardId === 'string', '$.path', 'Card target unavailable', 'NOT_FOUND')
    return value
  }
  const revision = workspace => workspace ? cardAssetWorkspaceRevision(workspace) : null
  function inspectRaw(raw) {
    // Validate through the same import boundary, including V2/V3 location and unknown raw preservation.
    const workspace = cardPreparation.create({kind:'import', payload:withoutPlayerChoices(cloneJson(raw))})
    validateModCardBindings(rawData(workspace.raw).extensions?.dsh_tavern?.modBindings)
    const extension = rawData(workspace.raw).extensions?.dsh_tavern?.assetBindings ? readCardAssetExtension(workspace.raw) : null
    return {raw:cloneJson(workspace.raw), boundPackIds:[...(extension?.assetBindings.boundPackIds || [])],modConfigPackId:extension?.modConfigPackId, name:rawData(workspace.raw).name || 'Card'}
  }
  async function state(path, record) {
    const current = revision(await readWorkspace(path))
    if (current === record.afterRevision) return 'after'
    if (current === record.beforeRevision) return 'before'
    return 'unknown'
  }
  return Object.freeze({
    inspectRaw,
    remapRaw(raw, mappings) {
      const value = inspectRaw(raw).raw, ext = rawData(value).extensions?.dsh_tavern
      if (!ext?.assetBindings) return value
      const mappingById = new Map()
      // Keep the first match, as the original mapping lookup did.
      for (const mapping of mappings) if (!mappingById.has(mapping.from)) mappingById.set(mapping.from, mapping)
      ext.assetBindings.boundPackIds = ext.assetBindings.boundPackIds.map(id => mappingById.get(id)?.packId || id)
      if(ext.modConfigPackId)ext.modConfigPackId=mappingById.get(ext.modConfigPackId)?.packId || ext.modConfigPackId
      // only opening references need figure remapping; cards have no cast.
      const refs = [ext.openings?.lead,...Object.values(ext.openings?.scenes || {}).flatMap(scene=>scene.cast.map(row=>row.figure))].filter(Boolean)
      for (const ref of refs) {
        const mapping = mappingById.get(ref.packId)
        if (mapping) {ref.packId=mapping.packId;ref.figureId=mapping.figures[ref.figureId] || ref.figureId}
      }
      for (const row of ext.variableBindings?.entries || []) {
        const mapping = mappingById.get(row.target.ref?.packId)
        if (mapping) row.target.ref.packId = mapping.packId
      }
      if (ext.stage?.defaultSkin?.packId) {
        const ref=ext.stage.defaultSkin, mapping=mappingById.get(ref.packId);
        if(mapping)ref.packId=mapping.packId;
      }
      for (const scene of Object.values(ext.openings?.scenes || {})) for (const key of ['background','music']) {
        const mapping = scene[key] && mappingById.get(scene[key].packId)
        if (mapping) scene[key] = {...scene[key], packId:mapping.packId}
      }
      return inspectRaw(value).raw
    },
    // card export of a globally enabled pack binds it to the exported card (green lamp).
    bindRaw(raw, packIds) {
      const value = inspectRaw(raw).raw, ext = rawData(value).extensions?.dsh_tavern
      check(ext?.assetBindings, '$.card', 'Card has no stage settings', 'UNBOUND_PACK')
      check(Array.isArray(packIds), '$.packIds')
      const boundIds = new Set(ext.assetBindings.boundPackIds)
      ext.assetBindings.boundPackIds = [...ext.assetBindings.boundPackIds, ...packIds.filter(id => !boundIds.has(id))]
      return inspectRaw(value).raw
    },
    async snapshot({path}) {
      const item = await target(path)
      return withCardLock(item.cardId, async () => {
        const workspace = await readWorkspace(path)
        return {path, cardId:item.cardId, cover:workspace ? await readCover(path) : undefined, revision:revision(workspace), raw:workspace ? cardPreparation.present({card:workspace,as:'raw'}) : null}
      })
    },
    async unbindPack({packId}) {
      const affected = await dependencies({packId})
      check(affected.available, '$.cards', 'Card bindings unavailable', 'ASSET_UNAVAILABLE')
      for (const {path} of affected.cards) {
        const item = await target(path)
        await withCardLock(item.cardId,async () => {
          const before = await readWorkspace(path), ext = readCardAssetExtension(before.raw)
          const boundPackIds = ext.assetBindings.boundPackIds.filter(id => id !== packId)
          if (boundPackIds.length === ext.assetBindings.boundPackIds.length) return
          const change = cardPreparation.update({kind:'card',card:before,patch:{},rawOperations:cardAssetRawOperations(before.raw,{assetBindings:{boundPackIds}})})
          await writeWorkspace(path,change.card)
        })
      }
    },
    async withBoundPack({path,expectedRevision,packId},publish) {
      const item = await target(path)
      return withCardLock(item.cardId,async () => {
        const before = await readWorkspace(path)
        check(before && revision(before) === expectedRevision,'$.expectedRevision','卡片刚刚被改过，请重新载入后再试','REVISION_CONFLICT')
        const ext = readCardAssetExtension(before.raw)
        const boundPackIds = [...new Set([...(ext?.assetBindings?.boundPackIds || []),packId])]
        const change = cardPreparation.update({kind:'card',card:before,patch:{},rawOperations:cardAssetRawOperations(before.raw,{assetBindings:{boundPackIds}})})
        const after = structuredClone(change.card)
        after.meta.updatedAt = Math.max(Date.now(),Number(before.meta.updatedAt || 0)+1)
        const record = {path,cardId:item.cardId,beforeRevision:revision(before),afterRevision:revision(after)}
        return publish({record,status:() => state(path,record),commit:() => writeWorkspace(path,after)})
      })
    },
    async withConfigPack({path,expectedRevision,packId},publish) {
      const item=await target(path)
      return withCardLock(item.cardId,async()=>{
        const before=await readWorkspace(path)
        check(revision(before)===expectedRevision,'$.expectedRevision','Card changed','REVISION_CONFLICT')
        const ext=readCardAssetExtension(before.raw),boundPackIds=[...new Set([...(ext?.assetBindings?.boundPackIds || []),packId])]
        const change=cardPreparation.update({kind:'card',card:before,patch:{},rawOperations:cardAssetRawOperations(before.raw,{assetBindings:{boundPackIds},modConfigPackId:packId})})
        const after=structuredClone(change.card)
        after.meta.updatedAt=Math.max(Date.now(),Number(before.meta.updatedAt || 0)+1)
        const record={path,cardId:item.cardId,beforeRevision:revision(before),afterRevision:revision(after)}
        return publish({record,status:()=>state(path,record),commit:()=>writeWorkspace(path,after)})
      })
    },
    async withPrepared({path, expectedRevision, raw, cover, packSnapshots = [], globalEnabledPackIds = [], disableWidgets = false}, publish) {
      const item = await target(path)
      return withCardLock(item.cardId, async () => {
        const before = await readWorkspace(path)
        check(revision(before) === expectedRevision, '$.expectedRevision', 'Card changed after preview', 'REVISION_CONFLICT')
        const checkedRaw = inspectRaw(raw).raw
        // rejecting third-party widgets is the normal card toggle, not a pack permission.
        if(disableWidgets) {
          const extension=rawData(checkedRaw).extensions?.dsh_tavern
          if(extension?.assetBindings) extension.stage={...extension.stage,widgets:false}
        }
        const variableBindings = rawData(checkedRaw).extensions?.dsh_tavern?.variableBindings
        if (variableBindings) validateVariableSlots({entries:variableBindings.entries.filter(row => !row.target.ref || packSnapshots.some(pack => pack.manifest.id === row.target.ref.packId))},packSnapshots)
        const imported = cardPreparation.create({kind:'import', payload:checkedRaw})
        imported.meta.id = item.cardId
        await syncPreparedCardBubbles(imported, path, getEngine(), packSnapshots, globalEnabledPackIds)
        // The commit proof must differ even for identical raw imported in the same clock tick.
        const previousStamp = before?.meta?.updatedAt
        imported.meta.updatedAt = Number.isSafeInteger(previousStamp) && previousStamp >= Date.now() ? previousStamp + 1 : Date.now()
        const record = {path, cardId:item.cardId, beforeRevision:revision(before), afterRevision:revision(imported)}
        check(record.beforeRevision !== record.afterRevision, '$.revision', 'Card commit proof did not advance', 'REVISION_CONFLICT')
        return publish({record, status:() => state(path, record), commit:() => writeWorkspace(path, imported, cover)})
      })
    },
    async recover(record) {
      check(record && typeof record.afterRevision === 'string', '$.record', 'Invalid card recovery record', 'RECOVERY_REQUIRED')
      // A rolled-back new-card transaction has no durable reservation to recover.
      if (record.beforeRevision === null && !await readWorkspace(record.path)) {
        return withCardLock(record.cardId, () => state(record.path, record))
      }
      const item = await target(record.path)
      check(item.cardId === record.cardId, '$.cardId', 'Card recovery identity changed', 'RECOVERY_REQUIRED')
      return withCardLock(item.cardId, () => state(record.path, record))
    }
  })
}
