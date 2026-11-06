// Frozen input preparation for the existing background runner. No task/session ownership.
import { createHash } from 'node:crypto'
import { projectAgentMessageText } from './runtime-content-projection.js'

const clone = value => structuredClone(value)
const text = value => typeof value === 'string' ? value : ''
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function fail(code, message) { throw Object.assign(new Error(message), { code }) }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}
function latestTurn(chat) {
  const message = (chat.messages || []).findLast(item => item?.role === 'assistant')
  return Number(message?.turn || (message?.greeting ? 1 : 0))
}
function hasTemplate(value) {
  return /<%|%>|(?:^|\n)\s*@@|\[(?:GENERATE:|RENDER:|InitialVariables|Preprocessing)|@INJECT/i.test(value)
}
function assertPlainProjection(values) {
  for (const value of values) {
    if (hasTemplate(text(value))) fail('STAGE_FROZEN_TEMPLATE_UNAVAILABLE', '导演上下文仍含未冻结的提示词模板；当前模板接口不能按该任务快照安全执行，未使用后来的会话状态替代。')
  }
}

// The same historical source rule used by the scene-image adapter: the following
// body's beforeRevision contains this target's settled card/Guide/posture state.
export async function readStageStateAtTarget(chat, target, { readRevision, targetOf }) {
  const next = (chat.timeline?.checkpoints || []).find(item => Number(item.turn) > target.turn && Number.isSafeInteger(item.beforeRevision))
  if (!next) return undefined
  const historical = await readRevision(chat.id, next.beforeRevision)
  if (!historical || latestTurn(historical) !== target.turn || historical.settleStatus !== 'done') return undefined
  try { return targetOf(historical, target.turn).key === target.key ? historical : undefined }
  catch { return undefined }
}

export function createStageSharedContext({ planner, readCard, ensureStablePrefix, currentWorldbook, foregroundReads, stateAtTarget, worldbookAtTarget, targetOf }) {
  return async function prepareStageSharedContext(chat, target, { readOnly = false } = {}) {
    // Detach before any async adapter. A concurrent MVU/Guide edit cannot mutate
    // the sources already selected for this one-shot background request.
    const snapshot = clone(chat)
    if (targetOf(snapshot, target.turn).key !== target.key) fail('STAGE_CONTEXT_TARGET_STALE', '导演上下文对应的正文已经变化。')
    if (latestTurn(snapshot) !== target.turn) {
      const historical = await stateAtTarget(snapshot, target)
      if (!historical?.cardDefinitionSnapshot || !text(historical.cardContextSnapshot)
        || latestTurn(historical) !== target.turn || targetOf(historical, target.turn).key !== target.key) {
        fail('STAGE_HISTORICAL_CONTEXT_UNAVAILABLE', '这段历史正文缺少完整的人物卡、Guide 与姿势快照，未读取当前状态补齐。')
      }
      const worldbook = await worldbookAtTarget(historical, target)
      if (!worldbook || worldbook.unavailable || Number(worldbook.omittedCount) > 0 || worldbook.omitted?.length) {
        fail('STAGE_HISTORICAL_CONTEXT_UNAVAILABLE', '这段历史正文缺少完整世界书快照，未读取当前世界书补齐。')
      }
      // Scene snapshots are auxiliary setting data, not an archived complete
      // request/template environment. Do not relabel them as full background parity.
      fail('STAGE_FROZEN_TEMPLATE_UNAVAILABLE', '历史演出的完整提示词模板投影尚无快照接口；本次生成已停止，已有历史演出仍可只读回放。')
    }
    const branchId = snapshot.timeline?.branchId, revision = snapshot.timeline?.revision
    const dynamicSource = value => digest({ messages: value.messages, guides: value.guides, posture: value.posture,
      macroState: value.macroState, variables: value.variables, openingWorldbookSnapshot: value.openingWorldbookSnapshot })
    const capturedDynamicSource = dynamicSource(snapshot)
    if (readOnly && (!text(snapshot.cardContextSnapshot).trim() || Number(snapshot.cardContextSnapshotVersion) < 7)) fail('STAGE_CONTEXT_PREVIEW_NOT_READY', '先恢复本局固定上下文后再预览；本次只读预览未创建或迁移存档。')
    const stablePrefix = readOnly ? snapshot.cardContextSnapshot : await ensureStablePrefix(snapshot)
    if (snapshot.timeline?.branchId !== branchId || snapshot.timeline?.revision !== revision || targetOf(snapshot, target.turn).key !== target.key
      || dynamicSource(snapshot) !== capturedDynamicSource) {
      fail('STAGE_CONTEXT_TARGET_STALE', '准备导演固定上下文时剧情已经变化。')
    }
    if (!text(stablePrefix).trim()) fail('STAGE_CONTEXT_UNAVAILABLE', '导演缺少上游人物卡固定上下文，未改用缩减提示词。')
    const card = await readCard(snapshot)
    const worldbook = await currentWorldbook(snapshot, card)
    // Whole-worldbook failures stay fatal. A single entry whose template fails is skipped by
    // the foreground prompt too (same projection), so the director keeps parity and records it.
    const wholeFailure = (worldbook?.diagnostics || []).some(item => !item?.ref)
    if (!worldbook || worldbook.unavailable || wholeFailure) {
      fail('STAGE_CONTEXT_UNAVAILABLE', '导演世界书投影不完整，未静默省略失败的世界书内容。')
    }
    const skippedEntries = (worldbook.diagnostics || []).map(item => ({ ref: String(item.ref), code: String(item.code || '') }))
    const reads = await foregroundReads(snapshot)
    const planned = await planner.plan({ purpose: 'stage-director', card, chat: snapshot,
      task: '', constantWorldBookContext: worldbook.context || '' })
    const targetIndex = snapshot.messages.findIndex(message => message?.role === 'assistant' && Number(message.turn || (message.greeting ? 1 : 0)) === target.turn)
    // same window as posture settlement (settleUserText): the player's input before
    // this reply. The reply itself is the numbered paragraphs; the previous turn's performance is the
    // carried stage state. No story backlog: other background tasks never resend the whole history.
    const previous = snapshot.messages.slice(0, targetIndex).findLast(message => message?.role === 'user' || message?.role === 'assistant')
    const backlogMessages = previous?.role === 'user' ? [{
      id: 'stage-context-input', role: 'user', regexPlacement: 1,
      content: [{ type: 'text', text: projectAgentMessageText(previous, { charName: card?.name, macroState: snapshot.macroState }) }],
      source: { kind: 'plugin:dsh-tavern', form: 'stage-player-input' }
    }].filter(message => message.content[0].text.trim()) : []
    assertPlainProjection([stablePrefix, worldbook.context, worldbook.prefixContext, worldbook.foregroundContext, reads,
      planned.dynamicText, planned.systemPromptText, planned.postHistoryText,
      ...backlogMessages.flatMap(message => message.content.map(block => block.text))])
    const binding = { chatId: snapshot.id, sessionId: snapshot.sessionId, targetKey: target.key, turn: target.turn,
      branchId, revision, storageRevision: snapshot._storageRevision, cardContextRevision: Number(snapshot.cardContextRevision) || 0 }
    const frozenBackground = { policy: 'frozen-context', historical: false, binding,
      stablePrefix, stablePrefixRevision: binding.cardContextRevision, worldbook: clone(worldbook), foregroundWorldbookReads: text(reads) }
    const result = { dynamicText: planned.dynamicText, systemPromptText: planned.systemPromptText, postHistoryText: planned.postHistoryText,
      backlogMessages, readTools: [], frozenBackground,
      audit: { ...clone(planned.audit), source: binding, policy: 'frozen-context', historical: false,
        templateProjection: 'upstream-source-projections; no live request re-render', backlogMessages: backlogMessages.length,
        ...(skippedEntries.length ? { skippedWorldbookEntries: skippedEntries } : {}),
        runtimeSections: ['stable-prefix', 'current-worldbook', 'foreground-worldbook-reads', 'background-task-prompt'] } }
    result.audit.contextDigest = digest(result)
    return freeze(result)
  }
}

/** Resolver access must never fall back to the live chat for the frozen policy. */
export function frozenStageBackground(input) {
  if (input?.task !== 'stage-director' || input.contextPolicy !== 'shared-background') return null
  const frozen = input.frozenBackground
  if (frozen?.policy !== 'frozen-context' || frozen.historical !== false || frozen.binding?.sessionId !== input.sessionId
    || typeof frozen.stablePrefix !== 'string' || !frozen.worldbook || typeof frozen.foregroundWorldbookReads !== 'string') {
    fail('STAGE_CONTEXT_UNAVAILABLE', '导演共享上下文未完整冻结，未回退读取当前会话。')
  }
  return frozen
}

/** This receives only the request-context metadata, never a second copy of source text. */
export function assertFrozenStageRequest(context, request) {
  if (context?.task !== 'stage-director' || context.contextPolicy !== 'shared-background') return
  const frozen = context.frozenBackground
  if (frozen?.policy !== 'frozen-context' || frozen.historical !== false || frozen.binding?.sessionId !== context.parentSessionId) {
    fail('STAGE_CONTEXT_UNAVAILABLE', '导演请求缺少已验证的冻结上下文绑定。')
  }
  assertPlainProjection([typeof request.system === 'string' ? request.system : JSON.stringify(request.system || ''),
    ...(request.messages || []).flatMap(message => typeof message.content === 'string' ? [message.content] : (message.content || []).filter(block => block?.type === 'text').map(block => block.text))])
}
