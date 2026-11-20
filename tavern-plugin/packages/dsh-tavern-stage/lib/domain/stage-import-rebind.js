import { captureStageTarget, stageDigest } from '../../../../lib/domain/stage-incremental.js'
import { assetPackDigest } from './stage-asset-pack-catalogue.js'

// A save imported under new chat and session ids. Every stage record is bound to its round by a digest of the round's
// identity (captureStageTarget: chat id, session id, message, source) and chained to the previous record's digest, so
// renaming the ids in the text leaves those digests naming the old game and the stage reads none of its rounds.
// Each record that was valid in the source is bound again to the imported chat and re-chained; the fields that quote
// a round's keys (its playback, items, failures) take the new keys. `imported` is the renamed copy of `source`,
// message for message; it is changed in place and returned.
export function rebindImportedStage(source, imported) {
  const keys = new Map()
  let previousOld = null, previousNew = null
  imported.messages.forEach((message, index) => {
    const original = source.messages[index]
    const anchor = message?.stageDirectionBaselineV1
    if (anchor && original.stageDirectionBaselineV1.sourceKey === captureStageTarget(source, index).sourceKey) {
      message.stageDirectionBaselineV1 = { ...anchor, sourceKey: captureStageTarget(imported, index).sourceKey, digest: stageDigest(anchor.state) }
    }
    const record = message?.stageDirectionAssetPacks, before = original?.stageDirectionAssetPacks
    if (!record || !before) return
    const old = before.binding.target
    if (old.sourceKey !== captureStageTarget(source, index).sourceKey || (old.predecessorDigest ?? null) !== previousOld) return
    const target = { ...record.binding.target, sourceKey: captureStageTarget(imported, index).sourceKey, predecessorDigest: previousNew }
    const binding = { ...record.binding, target }
    const digest = assetPackDigest({ binding, baseline: record.baseline, entries: record.entries, end: record.end })
    keys.set(old.sourceKey, target.sourceKey).set(before.digest, digest).set(assetPackDigest(before.binding), assetPackDigest(binding))
    message.stageDirectionAssetPacks = { ...record, binding, digest }
    previousOld = before.digest
    previousNew = digest
  })
  if (!keys.size) return imported
  const pattern = new RegExp([...keys.keys()].join('|'), 'g')
  imported.messages = JSON.parse(JSON.stringify(imported.messages).replace(pattern, key => keys.get(key)))
  return imported
}
