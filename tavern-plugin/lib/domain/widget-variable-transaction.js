// variable edits are Timeline intents, not a parallel variable store.
import {isDeepStrictEqual} from 'node:util'
import { widgetVariableDigest, auditWidgetVariableResult, prepareWidgetVariableOperations } from './widget-variables.js'
import { applyMvuSettlementEffect } from './mvu-settlement-effect.js'

const fail = reason => { throw Object.assign(new Error(reason), { code: 'WIDGET_VARIABLE_CONFLICT' }) }
const active = operation => operation.kind === 'variables.edit' && operation.status === 'running'
const selected = message => message?.variableEdits?.[message.swipeId || 0]
export function assertWidgetSettlementAdmission(chat) {
  if (Object.values(chat.timeline?.operations || {}).some(active)) fail('variable-edit-running')
  if (selected(chat.messages?.findLast(message => message?.role === 'assistant'))?.editedAfterSettlement) fail('edited-after-settlement')
}
export function widgetSettlementState(chat, message) {
  if (message?.mvu?.pending) return message.mvu.delivery?.prepared ? 'waiting-runtime' : 'pending'
  if (['error', 'failed', 'rejected'].includes(message?.mvu?.receipt?.status)) return 'failed'
  const operations = Object.values(chat.timeline?.operations || {}).filter(op => op.basedOn?.branchId === chat.timeline.branchId)
  if (operations.some(op => op.kind === 'agent' && op.role === 'settlement' && ['running', 'deferred'].includes(op.status)
    && (op.roundOperationId ? Number(chat.timeline.operations[op.roundOperationId]?.turn) === Number(message?.turn) : chat.messages.at(-1) === message))) return 'running'
  const body = operations.filter(op => op.kind === 'body' && op.status === 'completed').sort((a,b) => b.committedRevision-a.committedRevision)[0]
  if (body && Number(body.turn) === Number(message?.turn) && ['pending','running','failed'].includes(body.background?.phase)) return body.background.phase
  return 'idle'
}
export function verifiedWidgetSnapshot(chat, message) {
  return !message?.mvu?.pending && (selected(message)?.editedAfterSettlement === true
    || message?.mvuBaseline?.swipeId === Number(message?.swipeId || 0) && ['updated','unchanged'].includes(message?.mvu?.receipt?.status)
    || message?.greeting === true && chat.mvu?.openingInitialization?.version === 2
      && chat.mvu.openingInitialization.status === 'complete' && chat.mvu.openingInitialization.source !== 'chat-import')
}
export function widgetWriteReason(chat, messageId, { lastPage, revealed, live }, ownOperation) {
  const message = chat.messages?.[messageId]
  if (!['story','script'].includes(chat.mode || 'story') || !live || !lastPage || !revealed || messageId !== chat.messages.length-1 || message?.role !== 'assistant') return 'read-only-position'
  if (chat.regenInProgress || Object.values(chat.timeline?.operations || {}).some(op => op.id !== ownOperation && (active(op) || op.kind === 'body' && op.status === 'running'))) return 'generation-running'
  if (widgetSettlementState(chat,message) !== 'idle') return 'settlement-pending'
  if (!verifiedWidgetSnapshot(chat,message) || !message.variables?.[message.swipeId || 0]?.stat_data || message.variables[message.swipeId || 0].schema === undefined) return 'snapshot-unverified'
  return ''
}
export function cancelWidgetVariableEdits(chat) {
  for (const operation of Object.values(chat.timeline.operations)) if (active(operation)) operation.status = 'cancelled'
}

export function applyWidgetVariableIntent(chat, intent, now) {
  const operations = chat.timeline.operations, message = chat.messages[intent.messageId]
  const swipeId = Number(message?.swipeId || 0)
  if (intent.kind === 'variables.edit.apply') {
    applyWidgetVariableIntent(chat,{...intent,kind:'variables.edit.begin'},now)
    operations[intent.operationId].admittedRevision=chat._storageRevision
    const result=applyWidgetVariableIntent(chat,{...intent,kind:'variables.edit.commit',atomic:true},now)
    const receipt={...result,operationId:intent.request.operationId}
    Object.assign(operations[intent.operationId],{modRequest:intent.request,modSource:intent.source,modReceipt:receipt})
    return receipt
  }
  if (intent.kind === 'variables.edit.begin') {
    if (operations[intent.operationId]) fail('operation-id-reused')
    const reason = widgetWriteReason(chat,intent.messageId,intent.position)
    if (reason) fail(reason)
    if (intent.baseline !== undefined) {
      if (!intent.baseline || typeof intent.baseline.revision !== 'string' || intent.baseline.revision !== String(chat._storageRevision)
        || !isDeepStrictEqual(message.variables[swipeId],intent.baseline.value)) fail('baseline-changed')
    } else if (widgetVariableDigest(message.variables[swipeId]) !== intent.baselineDigest) fail('baseline-changed')
    operations[intent.operationId] = {
      id:intent.operationId, kind:'variables.edit', status:'running', basedOn:{branchId:chat.timeline.branchId,revision:chat.timeline.revision},
      messageId:intent.messageId, swipeId, lifecycleRevision:chat.tavernHelperLifecycleRevision || 0,
      ...(intent.baseline !== undefined ? {baselineRevision:intent.baseline.revision,mod:intent.mod} : {baselineDigest:intent.baselineDigest,widget:intent.widget}),
      requestDigest:intent.requestDigest,
      owner:intent.owner, createdAt:now(), admittedRevision:chat._storageRevision+1
    }
    return {status:'running',operationId:intent.operationId}
  }
  const operation = operations[intent.operationId]
  if (!operation || !active(operation)) fail('operation-expired')
  if (intent.kind === 'variables.edit.cancel') {
    operation.status = 'cancelled'
    return {status:'cancelled',operationId:operation.id}
  }
  if (operation.messageId !== intent.messageId || operation.swipeId !== swipeId
    || operation.basedOn.branchId !== chat.timeline.branchId || operation.basedOn.revision !== chat.timeline.revision
    || operation.lifecycleRevision !== (chat.tavernHelperLifecycleRevision || 0)
    || operation.admittedRevision !== chat._storageRevision
    || (operation.baselineRevision !== undefined
      ? intent.baseline?.revision !== operation.baselineRevision || !isDeepStrictEqual(message?.variables?.[swipeId],intent.baseline?.value)
      : widgetVariableDigest(message?.variables?.[swipeId]) !== operation.baselineDigest)) fail('baseline-changed')
  const reason = widgetWriteReason(chat,intent.messageId,intent.position,operation.id)
  if (reason) fail(reason)
  const before = message.variables[swipeId].stat_data
  const prepared = prepareWidgetVariableOperations(intent.declarations,before,intent.operations)
  // Effects are produced only by the trusted adapter, but the commit seam also confines their write set.
  if (intent.effect.operationId !== operation.id || intent.effect.changes.some(change => change.path[0] !== 'messages'
    || change.path[1] !== intent.messageId || change.path[2] !== 'variables' || change.path[3] !== swipeId
    || !['stat_data','schema','display_data','delta_data'].includes(change.path[4]))) fail('invalid-effect')
  applyMvuSettlementEffect(chat,intent.effect,{messageIndices:[intent.messageId]})
  const target = chat.messages[intent.messageId], audit = auditWidgetVariableResult(intent.declarations,before,target.variables[swipeId].stat_data,prepared.expected)
  if (audit.status === 'unchanged') {
    if(!intent.atomic || intent.effect.changes.length)fail('empty-effect')
    operation.status='completed';operation.completedAt=now()
    return {status:'unchanged',operationId:operation.id,revision:String(chat._storageRevision+1)}
  }
  const previous = selected(target) || {}, feedbackPaths = [...new Set([...(previous.feedbackPaths || []),...audit.paths])]
  if (feedbackPaths.length > 64 || Buffer.byteLength(JSON.stringify(feedbackPaths)) > 8192) fail('feedback-budget-exhausted')
  const receipt = {operationId:operation.id,requestDigest:operation.requestDigest,
    ...(operation.baselineRevision !== undefined ? {mod:operation.mod} : {widget:operation.widget}),
    beforeRevision:chat._storageRevision,afterRevision:chat._storageRevision+1,status:'committed',normalized:audit.normalized}
  const receipts = [...(previous.receipts || []),receipt].slice(-16)
  const block = {editedAfterSettlement:true,feedbackPaths,receipts}
  while (Buffer.byteLength(JSON.stringify(block)) > 32768 && receipts.length > 1) receipts.shift()
  if (Buffer.byteLength(JSON.stringify(block)) > 32768) fail('receipt-budget-exhausted')
  target.variableEdits ||= {}; target.variableEdits[swipeId] = block
  operation.status = 'completed'; operation.completedAt = now()
  chat.timeline.revision++
  const round = Object.values(operations).findLast(op => op.kind === 'body' && op.status === 'completed' && Number(op.turn) === Number(target.turn))
  if (round) round.committedRevision = chat.timeline.revision
  chat.candidates = null
  // These are future writer inputs, never authoritative prose or stage snapshots.
  delete chat.promptTemplateInput; delete chat.promptTemplateInitialVariables; delete chat.runtimeInputs
  chat.preparedWorldBookContext = ''; chat.preparedWorldBook = null
  return {status:'committed',operationId:operation.id,normalized:audit.normalized,revision:String(chat._storageRevision+1)}
}
