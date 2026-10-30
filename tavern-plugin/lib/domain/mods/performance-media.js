import {isDeepStrictEqual as equal} from 'node:util'
import projection from '../../../src/client/mod-projection.cjs'
import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {validateAssetRef} from '../../../packages/dsh-presentation-protocol/src/asset-packs.js'
const {modCheck:check,modShape:shape,modJson}=contract
const contains=(value,ref)=>!!value && typeof value==='object' && (equal(value,ref) || Object.values(value).some(child=>contains(child,ref)))

// A stage caller cannot turn a persisted performance into an arbitrary pack-file reader.
export function createModPerformanceMedia({library,readPresentation,media,coreMedia,isCurrent=()=>true}) {
  return async function read({context,performanceId,ref,slot}) {
    modJson({context,performanceId,ref,slot},8192)
    shape(context,['gameId','turn','source']);shape(context.source,['branchId','sourceKey','generation','textVersion'])
    check(typeof context.gameId==='string' && Number.isSafeInteger(context.turn) && context.turn>0,'$.context')
    check(typeof performanceId==='string' && typeof slot==='string','$.performanceId')
    const core=ref?.kind==='props'
    if(core)validateAssetRef(ref,'$.ref','props')
    else shape(ref,['modId','packId','kind','entryId'])
    const first=await readPresentation(context),revision=library.snapshot().revision
    async function authorize(value) {
      check(isCurrent() && value?.cardId && value.cardId===first.cardId && equal(value.store?.source,context.source),'$.source','Presentation source changed','MOD_SOURCE_STALE')
      const performance=projection.projectModPerformances(value.store).find(row=>row.id===performanceId)
      check(performance && (core || performance.modId===ref.modId) && contains(performance.payload,ref),'$.ref','Reference is not owned by this performance','MOD_PERMISSION_DENIED')
      const manifest=library.active(value.cardId).find(row=>row.id===performance.modId)
      check(manifest?.permissions.stage.includes('place'),'$.modId','Mod is no longer authorized','MOD_PERMISSION_DENIED')
      if(core) {
        const allowed=manifest.permissions.mainAssets?.some(row=>{
          const dependency=manifest.dependencies?.assets?.find(slot=>slot.slot===row.slot)
          return row.kinds.includes('props') && (!row.refs || row.refs.some(value=>equal(value,ref))) &&
            (!dependency || dependency.packId===ref.packId && dependency.kinds.includes('props'))
        })
        check(slot==='image' && coreMedia && allowed,'$.slot','Core props media permission required','MOD_PERMISSION_DENIED')
        return {...await coreMedia.describe(context,ref),core:true,type:'image',performanceRevision:performance.revision}
      }
      const scope=library.listModPacks({modId:ref.modId,cardId:value.cardId}).packs.find(row=>row.id===ref.packId)
      check(scope && scope.scope!=='off','$.packId','Pack is disabled','MOD_PERMISSION_DENIED')
      const pack=library.snapshot().mods[ref.modId].packs[ref.packId],entry=pack.entries.find(row=>row.id===ref.entryId && row.kind===ref.kind)
      const declared=manifest.assetKinds.find(row=>row.id===ref.kind)?.mediaSlots?.find(row=>row.id===slot)
      check(entry?.enabled && declared && Object.hasOwn(entry.media,slot),'$.slot','Media entry is unavailable','MOD_RESOURCE_UNAVAILABLE')
      const file=pack.files.find(row=>row.path===entry.media[slot])
      check(file,'$.slot','Media is not declared by its owner','MOD_RESOURCE_UNAVAILABLE')
      return {file,type:declared.type,performanceRevision:performance.revision}
    }
    const source=await authorize(first),result=source.core?await coreMedia.read(source):await media.read(ref.modId,ref.packId,source.file.path,source.file.size)
    const current=await authorize(await readPresentation(context))
    check(library.snapshot().revision===revision && equal(current,source),'$.source','Media authority changed while loading','MOD_SOURCE_STALE')
    check(result.mime.startsWith(source.type+'/'),'$.slot','Media type differs from its declared slot','MOD_RESOURCE_UNAVAILABLE')
    return {...result,performanceId,revision:source.performanceRevision}
  }
}
