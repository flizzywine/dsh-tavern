import { legacyMessageUid } from './message-uid.js'

const clone = value => value === undefined ? undefined : structuredClone(value)
const validIndex = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0
const validTurn = value => Number.isSafeInteger(Number(value)) && Number(value) > 0

/**
 * The old prose leaves the visible story as soon as regeneration starts. The
 * source row is kept only as retry material; the placeholder carries no prose.
 */
export function createRegenerationDiscard(row, assistantIndex, inputIndex) {
  if (!row || row.role !== 'assistant' || !validIndex(assistantIndex)) return null
  const messageUid = legacyMessageUid(row, Number(assistantIndex))
  return {
    assistantIndex: Number(assistantIndex),
    inputIndex: Number.isSafeInteger(Number(inputIndex)) ? Number(inputIndex) : -1,
    assistant: { ...clone(row), messageUid },
    placeholder: {
      role: 'assistant',
      ...(row.native === true ? { native: true } : {}),
      ...(validTurn(row.turn) ? { turn: Number(row.turn) } : {}),
      ...(row.nativeAnchor ? { nativeAnchor: clone(row.nativeAnchor) } : {}),
      messageUid,
      text: '',
      placeholder: true,
      regenerationDiscarded: true
    }
  }
}

/** Messages expected while the candidate runs: same rows, but no old prose. */
export function regenerationAttemptMessages(messages, discarded) {
  const result = Array.isArray(messages) ? messages.slice() : []
  if (discarded && validIndex(discarded.assistantIndex) && discarded.placeholder) {
    result[Number(discarded.assistantIndex)] = clone(discarded.placeholder)
  }
  return result
}

/** Remove a previous failure's view filter before using its source for a retry. */
export function clearRegenerationFailure(chat) {
  const failed = chat?.failedRegenerationTarget
  if (failed && validTurn(failed.dshTurn) && Array.isArray(chat.replacingDshTurns)) {
    chat.replacingDshTurns = chat.replacingDshTurns.filter(turn => Number(turn) !== Number(failed.dshTurn))
    if (!chat.replacingDshTurns.length) delete chat.replacingDshTurns
  }
  if (chat) delete chat.failedRegenerationTarget
}

/** Install the empty generation row in the same update that writes the busy marker. */
export function installRegenerationDiscard(chat, discarded) {
  if (!chat || !discarded) return
  const index = Math.min(Number(discarded.assistantIndex), chat.messages.length)
  const alreadyDiscarded = chat.failedRegenerationTarget?.assistant?.messageUid === discarded.assistant.messageUid
  clearRegenerationFailure(chat)
  chat.messages.splice(index, alreadyDiscarded ? 0 : 1, clone(discarded.placeholder))
}

/** Rehydrate retry material without ever writing the old prose back to the save. */
export function restoreDiscardedRegeneration(chat) {
  const failed = chat?.failedRegenerationTarget
  if (!failed || !validIndex(failed.assistantIndex) || failed.assistant?.role !== 'assistant') return chat
  const uid = failed.assistant.messageUid
  const messages = chat.messages.slice()
  const existing = messages.findIndex(row => row?.role === 'assistant' && row?.messageUid === uid)
  if (existing >= 0) {
    if (messages[existing]?.regenerationDiscarded === true) messages[existing] = clone(failed.assistant)
    else return chat
  } else messages.splice(Math.min(Number(failed.assistantIndex), messages.length), 0, clone(failed.assistant))
  const next = { ...chat, messages }
  if (validTurn(failed.dshTurn) && Array.isArray(next.replacingDshTurns)) {
    next.replacingDshTurns = next.replacingDshTurns.filter(turn => Number(turn) !== Number(failed.dshTurn))
    if (!next.replacingDshTurns.length) delete next.replacingDshTurns
  }
  return next
}

/**
 * A failed/cancelled candidate leaves no old story row and no stale partial row.
 * Only retry material and the native-row filter survive; recovery never restores prose.
 */
export function retainRegenerationFailure(chat, recovery) {
  if (!chat) return
  clearRegenerationFailure(chat)
  const discarded = recovery?.discarded
  if (discarded?.assistant) {
    const uid = discarded.assistant.messageUid
    chat.messages = (Array.isArray(chat.messages) ? chat.messages : []).filter(row =>
      !(row?.regenerationDiscarded === true && row?.messageUid === uid))
    chat.failedRegenerationTarget = {
      assistantIndex: Number(discarded.assistantIndex),
      inputIndex: Number(discarded.inputIndex),
      assistant: clone(discarded.assistant),
      ...(validTurn(recovery?.temporaryReplacingTurn) ? { dshTurn: Number(recovery.temporaryReplacingTurn) } : {})
    }
  }
  if (validTurn(recovery?.temporaryReplacingTurn)) {
    chat.replacingDshTurns = [...new Set([...(chat.replacingDshTurns || []), Number(recovery.temporaryReplacingTurn)])]
      .sort((left, right) => left - right)
  }
}
