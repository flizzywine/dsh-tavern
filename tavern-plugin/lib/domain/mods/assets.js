import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {validateAssetRef,validateFigureRef} from '../../../packages/dsh-presentation-protocol/src/asset-packs.js'
import {assertModCurrent,modBoundary} from './permissions.js'
const {modShape:shape,modCheck:check,modJson} = contract
const same = (a,b) => a.packId===b.packId && a.kind===b.kind && a.assetId===b.assetId && a.figureId===b.figureId

export function createModAssets({manifest,context,current,service,authorized,lease,release}) {
  return Object.freeze({read:input=>modBoundary(async()=>{
    modJson(input);shape(input,['ref','role'],['ref'])
    const {ref,role}=structuredClone(input),figure=Object.hasOwn(ref,'figureId'),kind=figure?'figures':ref.kind
    if(figure)validateFigureRef(ref);else validateAssetRef(ref)
    check(role===undefined || typeof role==='string' && role.length<=80,'$.role')
    const declaration=manifest.permissions.mainAssets?.find(read=>read.kinds.includes(kind) && (read.refs ? read.refs.some(value=>same(value,ref)) : manifest.dependencies.assets?.some(slot=>slot.slot===read.slot && slot.packId===ref.packId && slot.kinds.includes(kind))))
    check(declaration,'$.ref','Resource is outside mod declaration','MOD_PERMISSION_DENIED')
    assertModCurrent(context,current)
    check(await authorized(context,ref,role),'$.ref','Resource is not authorized for this card','MOD_PERMISSION_DENIED')
    const [row]=figure?await service.resolveFigures({refs:[ref]}):await service.resolveAssets({refs:[ref]})
    assertModCurrent(context,current)
    if(!row?.value || row.value.enabled===false)return null
    const mediaHandle=await lease(context,ref,role)
    const stillAuthorized=await authorized(context,ref,role)
    if (!current(context) || !stillAuthorized) {
      if(mediaHandle)await release(mediaHandle)
      check(false,'$.ref','Resource authority changed','MOD_SOURCE_STALE')
    }
    return {identity:ref,kind,metadata:structuredClone(row.value),mediaHandle}
  })})
}
