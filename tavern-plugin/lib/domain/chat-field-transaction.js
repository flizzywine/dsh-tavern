import { isDeepStrictEqual } from 'node:util'
import { legacyMessageUid } from './message-uid.js'

function overlaps(left, right) {
  const length = Math.min(left.path.length, right.path.length)
  for (let index = 0; index < length; index++) {
    if (left.path[index] !== right.path[index]) return false
  }
  // The JSON diff emits tail splices. Positions before the splice stay valid.
  if (left.op === 'splice' && left.path.length < right.path.length && right.path[length] < left.index) return false
  if (right.op === 'splice' && right.path.length < left.path.length && left.path[length] < right.index) return false
  return true
}

/** Replay only fields still safe to change on the current version. */
export function rebaseChatChanges(changes, concurrent) {
  const pending = []
  for (const change of changes) {
    let alreadyApplied = false
    for (const other of concurrent) {
      if (!overlaps(change, other)) continue
      if (!isDeepStrictEqual(change, other)) return null
      alreadyApplied = true
    }
    if (!alreadyApplied) pending.push(change)
  }
  return pending
}

export function sameChatMessageIdentity(before, current, index) {
  // Native storage assigns this deterministic UID on the first variable write.
  return Boolean(before && current && (before.messageUid
    ? before.messageUid === current.messageUid
    : !current.messageUid || current.messageUid === legacyMessageUid(before, index)))
}

/** The caller prepares and validates its targets. Persistence retries only the
 * compare-and-swap, so callers need not repeat script or model work. */
export async function commitChatFields(patchChat, chatId, metadata, plan) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const mutation = await plan(attempt)
    if (!mutation) continue
    const saved = await patchChat(chatId, mutation.revision, mutation.changes, metadata)
    if (saved) return { saved, rebased: attempt > 0 }
  }
  return null
}
