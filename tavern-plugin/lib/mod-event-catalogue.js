import {recallAssetPacks} from '../packages/dsh-tavern-stage/lib/domain/stage-asset-pack-catalogue.js'
import {readCardAssetExtension} from './domain/card-asset-bindings.js'
import {modAssetCatalogue} from './domain/mods/catalogue.js'
import {isDeepStrictEqual as equal} from 'node:util'
import {assetRefKey} from '../packages/dsh-presentation-protocol/src/asset-packs.js'

// Reuse core blue/green admission, including the director's already-paid judge result.
// AGENTS.md rule 15: a mod's own built-in asset pack (the 弹幕 audience groups) is usable whenever the mod's global switch
// is on; the card adds nothing. It joins this recall as if globally enabled; its entries keep their own lights.
export function createModEventCatalogue({snapshot,builtinPacks=async()=>[]}) {
  const recalled=new Map()
  return {
    remember(sessionId,sourceKey,catalogue) {
      if(!catalogue)return
      recalled.set(sessionId,{sourceKey,catalogue})
      while(recalled.size>64)recalled.delete(recalled.keys().next().value)
    },
    clear(){recalled.clear()},
    async read(value,manifests) {
      const own=(await builtinPacks()).filter(row=>manifests.some(manifest=>manifest.id===row.modId)).map(row=>row.packId)
      const assets=await snapshot(value.head.cardPath,{extraPackIds:own})
      if(!assets)return Object.fromEntries(manifests.map(row=>[row.id,{packs:[],recalled:[]}]))
      const extension=readCardAssetExtension(assets.raw)
      const loaded=own.filter(id=>assets.snapshots.some(pack=>pack.manifest.id===id))
      // Event modules consume only their declared kinds; director-wide trigger work is unrelated.
      const kinds=[...new Set(manifests.flatMap(row=>row.admission.entryKinds))]
      const input={...assets,globalEnabledPackIds:[...new Set([...assets.globalEnabledPackIds,...loaded])],boundPackIds:extension.assetBindings.boundPackIds,units:value.units,
        modAssetKinds:kinds,kinds}
      let catalogue=recallAssetPacks(input)
      const saved=recalled.get(value.head.sessionId)
      if(saved?.sourceKey===value.source.sourceKey && equal(saved.catalogue.revisions,catalogue.revisions)) {
        const judgeRecall=new Set(saved.catalogue.rows.filter(row=>!row.excluded && row.reasons.includes('judge')).map(row=>assetRefKey(row.ref)))
        catalogue=recallAssetPacks({...input,judgeRecall})
      }
      if(!assets.current())throw Object.assign(new Error('Asset authority changed'),{code:'MOD_SOURCE_STALE'})
      return Object.fromEntries(manifests.map(manifest=>[manifest.id,modAssetCatalogue(manifest,catalogue)]))
    },
  }
}
