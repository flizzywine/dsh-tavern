import { replaceLastRound } from './last-round-replacement.js'

/** Commit the candidate to the authoritative timeline draft before touching DSH Session. */
export function commitRegeneratedRound({ timeline, chat, turn, userText, baseline, frame, frameTurn,
  replacement, projectionWarnings, conflict = () => new Error('正文提交条件已失效') }) {
  const begun = timeline.apply({ chat, detach: false, intent: { kind: 'body.begin', turn, userText } })
  const draft = begun.chat
  const operation = draft.timeline.operations[begun.value.operationId]
  operation.beforeRevision = baseline.revision
  operation.beforeParticipants = structuredClone(baseline.participants)
  if (frame) {
    draft.foregroundFrames = { ...draft.foregroundFrames, [operation.id]: { ...frame,
      frameId: 'foreground:' + draft.id + ':' + draft.timeline.branchId + ':' + operation.id,
      operationId: operation.id, branchId: draft.timeline.branchId, basedOnRevision: operation.basedOn.revision,
      ...(frameTurn === undefined ? {} : { turn: frameTurn }) } }
  }

  const completed = timeline.complete({ chat: draft, detach: false, operationId: operation.id, basedOn: operation.basedOn,
    outcome: { status: 'success' }, apply(current) {
      if (replacement.appendMessages) current.messages = replacement.appendMessages
      else {
        const { originalChat, row, assistantIndex, inputIndex, messageUid, dropNativeAnchor } = replacement
        const result = replaceLastRound({ originalChat, regeneratedChat: current, replacement: row, assistantIndex, inputIndex })
        if (messageUid) result.assistant.messageUid = messageUid
        if (dropNativeAnchor) delete result.assistant.nativeAnchor
        current.messages = result.chat.messages
      }
      delete current.promptTemplateInput
      current.settleStatus = 'pending'
      current.settleError = null
      current.lastSettle = null
      current.foregroundError = null
      current.presentationWarnings = structuredClone(projectionWarnings || [])
    } })
  if (completed.value.status !== 'committed') throw conflict()
  if (baseline.checkpointBefore !== undefined) {
    completed.chat.timeline.checkpoints.at(-1).before = structuredClone(baseline.checkpointBefore)
  }
  return { chat: completed.chat, operationId: operation.id }
}

/** Project a committed reply, notify readers, then settle its version. */
export function createRegeneratedRoundHandoff({ queueSettlement, readChat, updateChat, replyCommitted }) {
  return async function finish({ attempt, committed, notify, beforeSettlement, waitForSettlement,
    readSettled = readChat, failureSource, failureMessage }) {
    const { branchId, revision } = committed.timeline
    const projected = await attempt.project() || committed
    try { await notify?.(projected) } catch { /* A listener cannot undo a committed reply. */ }
    try { await replyCommitted?.(projected.sessionId, projected._storageRevision) } catch { /* Settlement still needs to run. */ }
    await beforeSettlement?.()

    function saveFailure(cause) {
      return updateChat(projected.id, current => {
        if (current?.timeline?.branchId !== branchId || current?.timeline?.revision !== revision) return current
        current.settleStatus = 'failed'
        current.settleError = failureMessage(cause)
        return current
      }, { source: failureSource })
    }

    const settlement = Promise.resolve().then(() => queueSettlement(projected.id))
    try {
      if (waitForSettlement && !await waitForSettlement(settlement)) {
        void settlement.catch(saveFailure).catch(error =>
          console.warn('dsh-tavern: 重新生成结算失败状态未保存', String(error?.message || error)))
        return projected
      }
      await settlement
    } catch (error) {
      return await saveFailure(error) || projected
    }
    return await readSettled(projected.id) || projected
  }
}
