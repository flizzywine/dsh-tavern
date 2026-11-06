import {assetRefKey} from '../../../../dsh-presentation-protocol/src/asset-packs.js'
import {assetContent} from '../../../../dsh-presentation-protocol/src/asset-variant-content.js'
import {readCardAssetExtension} from '../../../../../lib/domain/card-asset-bindings.js'
import {listEffectiveAssets} from '../../../../../lib/domain/effective-assets.js'
import contract from '../../../../dsh-presentation-protocol/src/mod-contract.cjs'
const {modCheck:check}=contract

// Presentation payload ownership is checked by performance-media before entering this host-only reader.
// readChat(sessionId, turn) supplies the card of the performance's round.
export function createModCoreMedia({readChat,snapshot,service}) {
  return {
    async describe(context,ref) {
      const chat=await readChat(context.gameId,context.turn),view=chat && await snapshot(chat.cardPath)
      check(view?.current(),'$.source','Asset authority changed','MOD_SOURCE_STALE')
      const bindings=readCardAssetExtension(view.raw).assetBindings
      const row=listEffectiveAssets({snapshots:view.snapshots,boundPackIds:bindings.boundPackIds,globalEnabledPackIds:view.globalEnabledPackIds})
        .find(row=>!row.ref.figureId && assetRefKey(row.ref)===assetRefKey(ref))
      check(row?.asset.enabled && view.assetStatus[assetRefKey(ref)]?.available,'$.ref','Prop is unavailable for this card','MOD_PERMISSION_DENIED')
      const pack=view.snapshots.find(pack=>pack.manifest.id===ref.packId),hash=assetContent(row.asset).media,blob=pack.manifest.blobs[hash]
      check(blob?.mime.startsWith('image/'),'$.ref','Prop has no image','MOD_RESOURCE_UNAVAILABLE')
      return {packId:ref.packId,hash,expectedRevision:pack.revision,mime:blob.mime}
    },
    async read(source) {
      const owner=service()
      check(owner?.apiVersion===2,'$.ref','Asset service unavailable','MOD_RESOURCE_UNAVAILABLE')
      const {bytes,descriptor}=await owner.readMedia({packId:source.packId,hash:source.hash,expectedRevision:source.expectedRevision})
      check(owner===service() && descriptor.mime===source.mime,'$.source','Asset authority changed','MOD_SOURCE_STALE')
      return {mime:descriptor.mime,data:Buffer.from(bytes).toString('base64')}
    },
  }
}
