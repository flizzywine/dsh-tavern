import { assetPackDigest } from '../../packages/dsh-presentation-protocol/src/asset-pack-digest.js'
import { captureStageTarget, stageDigest } from './stage-incremental.js'

const recordField = 'stageDirectionAssetPacks', failureField = 'stageDirectionAssetPacksFailure', anchorField = 'stageDirectionBaselineV1'

function replaceRef(holder, field, from, to) {
  if (holder?.[field] === from) holder[field] = to
}

function rebindPlayback(playback, before, after, oldDigest, newDigest) {
  if (!playback) return
  const oldKey = assetPackDigest(before), newKey = assetPackDigest(after)
  for (const ref of [playback.source, playback.acceptedPrefix]) {
    if (ref?.bindingKey !== oldKey || ref.sourceKey !== before.target.sourceKey) continue
    ref.bindingKey = newKey
    ref.sourceKey = after.target.sourceKey
    replaceRef(ref, 'digest', oldDigest, newDigest)
  }
}

function rebindPerformances(message, oldKey, newKey) {
  for (const store of [message.modCorrections, message.stageItems]) {
    replaceRef(store?.source, 'sourceKey', oldKey, newKey)
    replaceRef(store?.source, 'textVersion', oldKey, newKey)
    if (!Array.isArray(store?.performances)) continue
    for (const row of store.performances) {
      replaceRef(row?.source, 'sourceKey', oldKey, newKey)
      replaceRef(row?.source, 'textVersion', oldKey, newKey)
      // Core item ids are tuples of [sourceKey, generation, entryIndex, opIndex].
      if (store === message.stageItems && typeof row?.id === 'string' && row.id.startsWith('["' + oldKey + '",')) {
        row.id = row.id.replace(oldKey, newKey)
      }
    }
  }
}

// Work on the renamed copy only. A failure/preview belongs to its round but never advances the record chain.
export function rebindImportedStage(source, imported, reportSkip) {
  return rebindStage(() => source, imported, reportSkip)
}

// sourceAt(index): the chat a round was directed in (its own text and the story before it), so rounds directed
// before and after a rewrite of an earlier message can each be read against what they saw.
// keepUnbound leaves a field that cannot be bound as it is instead of dropping it (a repair in place).
// predecessorAt(index): the record digest a round's binding chained to when it was directed, when the rounds were
// directed against different sources; by default the chain of the rounds already carried over.
export function rebindStage(sourceAt, imported, reportSkip, { keepUnbound = false, predecessorAt = null } = {}) {
  let previousOld = null, previousNew = null
  imported.messages.forEach((message, index) => {
    const source = sourceAt(index), original = source.messages[index]
    if (![anchorField, recordField, failureField].some(field => original?.[field] != null)) return
    function skip(holder, field, label) {
      if (!keepUnbound) delete holder[field]
      reportSkip(index, label)
    }
    let old, current
    try {
      old = captureStageTarget(source, index)
      current = captureStageTarget(imported, index)
    } catch {
      for (const [field, label] of [[anchorField, '舞台起点'], [recordField, '演出记录'], [failureField, '失败记录']]) {
        if (message[field] != null) skip(message, field, label)
      }
      return
    }
    const rebind = binding => ({ ...binding, target: { ...binding.target, chatId: current.chatId, sessionId: current.sessionId,
      sourceKey: current.sourceKey, prefixDigest: current.prefixDigest, sourceDigest: current.sourceDigest, predecessorDigest: previousNew } })
    const expected = predecessorAt ? predecessorAt(index) : previousOld
    const matches = target => target.sourceKey === old.sourceKey && target.predecessorDigest === expected
    const anchor = message[anchorField]
    if (anchor != null) {
      if (!anchor.sourceKey || !anchor.state || !anchor.digest) skip(message, anchorField, '舞台起点')
      else if (anchor.sourceKey === old.sourceKey) {
        anchor.sourceKey = current.sourceKey
        anchor.digest = stageDigest(anchor.state)
      }
    }
    const failure = message[failureField]
    if (failure != null) {
      if (!failure.sourceKey) skip(message, failureField, '失败记录')
      else if (failure.sourceKey === old.sourceKey) {
        failure.sourceKey = current.sourceKey
        const preview = failure.preview
        if (preview != null) {
          const before = original[failureField].preview
          if (!preview.binding?.target?.sourceKey || !preview.prefixDigest || !preview.baseline || !Array.isArray(preview.entries) || !Array.isArray(preview.units) ||
              preview.sourceKey !== old.sourceKey || !matches(preview.binding.target)) skip(failure, 'preview', '分段预览')
          else {
            const { prefixDigest, ...body } = preview
            body.binding = rebind(body.binding)
            body.sourceKey = current.sourceKey
            failure.preview = { ...body, prefixDigest: assetPackDigest(body) }
            rebindPlayback(message.stagePlaybackV1, before.binding, body.binding, prefixDigest, failure.preview.prefixDigest)
          }
        }
      }
    }
    const record = message[recordField]
    if (record == null) return
    if (!record.binding?.target?.sourceKey || !record.digest || !record.baseline || !Array.isArray(record.entries) || !record.end) {
      skip(message, recordField, '演出记录')
      return
    }
    const before = original[recordField]
    if (!matches(before.binding.target)) return // A stale record in the source is not made current by importing it.
    record.binding = rebind(record.binding)
    const { binding, baseline, entries, end } = record
    record.digest = assetPackDigest({ binding, baseline, entries, end })
    rebindPlayback(message.stagePlaybackV1, before.binding, binding, before.digest, record.digest)
    replaceRef(message.stageItems, 'directionDigest', before.digest, record.digest)
    replaceRef(message.stageItems, 'sourceKey', old.sourceKey, current.sourceKey)
    rebindPerformances(message, old.sourceKey, current.sourceKey)
    previousOld = before.digest
    previousNew = record.digest
  })
  return imported
}
