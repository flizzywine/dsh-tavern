// transient projection provenance, not a stored playback certificate.
import {assetPackDigest as digest} from './stage-asset-pack-catalogue.js'
import {canonicalJson} from '../../../dsh-presentation-protocol/src/asset-pack-json.js'
import {foldAssetPackEntries} from './stage-asset-pack-director.js'
import {stageProjectionPage} from './stage-projection.js'
import {stagePageIndex} from '../../../../src/client/stage-page-index.cjs'
// deep equality compares canonical JSON directly; hashing both sides first adds nothing.
const same = (a,b) => canonicalJson(a) === canonicalJson(b)
const stale = () => {throw Object.assign(new Error('CG presentation expired'),{code:'REVISION_CONFLICT'})}

export function verifyCgPlayedReceipt(direction, receipt, ref, variant) {
  if (!receipt?.page || !direction.token || !receipt.expectedDirectionToken || direction.status === 'error' || direction.error) stale()
  const {page,through,binding,expectedDirectionToken:token} = receipt
  const coordinate = stageProjectionPage(direction,page.para,page)
  if (!coordinate || page.para > through || through > direction.through || !Number.isSafeInteger(through)) stale()
  const checked = direction.record || direction.preview
  if (!checked) stale()
  if (!same(direction.token,token)) {
    // Sealed stream prefixes survive append/final commit, but never an epoch rewrite.
    const stream = binding?.stream, current = direction.binding?.stream
    if (!binding || token.generation !== direction.generation) stale()
    if (stream ? !current || stream.committed || stream.operationId !== current.operationId || stream.epoch !== current.epoch || stream.epoch !== token.generation : current || !same(binding,direction.binding)) stale()
    const authority = value => {
      // Recall and the paragraph-bounded tool schema are recomputed at final commit.
      // Card/engine/pack/character authority and the accepted semantic prefix are not.
      const {target,stream,unitsDigest,pageDigest,generation,registryDigest,catalogueDigest,...rest} = value
      return {...rest,target:{sessionId:target.sessionId,chatId:target.chatId,turn:target.turn,branchId:target.branchId,predecessorDigest:target.predecessorDigest}}
    }
    if (!same(authority(binding),authority(direction.binding))) stale()
    const display = stream ? direction.displayUnits.slice(0,through) : direction.displayUnits, units = stream ? direction.units.slice(0,through) : direction.units
    if (stream && (binding.target.sourceKey !== digest([stream.operationId,stream.epoch]) || binding.target.sourceDigest !== digest(display)) || binding.unitsDigest !== digest(units) || binding.pageDigest !== digest(stagePageIndex(display))) stale()
    const prefixRevision = stream ? through : token.prefixRevision
    if (!Number.isSafeInteger(prefixRevision) || prefixRevision < 1) stale()
    const body = {binding,sourceKey:binding.target.sourceKey,generation:token.generation,prefixRevision,through,units,baseline:checked.baseline,entries:checked.entries.filter(entry => entry.at <= through),complete:false}
    const expected = {sourceKey:binding.target.sourceKey,branchId:binding.target.branchId,generation:token.generation,bindingKey:digest(binding),prefixRevision,digest:digest(body)}
    if (!same(expected,token)) stale()
  }
  const cg = foldAssetPackEntries(checked,page.para).cg
  if (!cg || !same(cg.ref,ref) || variant !== null && typeof variant !== 'string') stale()
  return cg
}
