import { createMvuWorkingCopy, projectMvuReceipt } from './mvu-working-copy.js'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { projectTavernHelperContext } from './tavern-helper-context.js'
import { createMvuSettlementEffect } from './mvu-settlement-effect.js'
import { REPLY_PROSE_FIELDS } from './reply-prose.js'

const str = value => value == null ? '' : String(value)
// Pinned upstream src/function/update/index.ts throttles MESSAGE_RECEIVED at
// 3000ms. Re-entering sooner returns the old Promise and schedules a late write.
const MVU_RETRY_AFTER_MS = 3100

export function mutationIsCurrent(chat, expectedLifecycleRevision) {
  if (expectedLifecycleRevision === undefined || expectedLifecycleRevision === null) return true
  return Math.max(0, Number(chat && chat.tavernHelperLifecycleRevision) || 0) === Math.max(0, Number(expectedLifecycleRevision) || 0)
}

// Owns settlement reservation, isolated drafts and lazy history readers. Host
// mutations join through this interface; the transaction registry stays private.
export function createMvuSettlementTransactions({ resolveChat, resolveSettlementBase, resolveChatSlice,
  resolveChangedChatSlice, scriptDispatch, diagnostics, context, readGlobalVariables }) {
  const settlementTransactions = new Map()
  const settlementReaders = new WeakMap()
  async function ensureRows(chat, indices) { await settlementReaders.get(chat)?.ensure?.(indices) }
  async function fullContext(chat) {
    await ensureRows(chat)
    return projectTavernHelperContext(chat)
  }
  // One detached base, never writable or exposed to callers. Incremental storage
  // reads replace changed rows; cache eviction only costs a cold full read.
  let settlementBase = null
  const settlementSizes = new WeakMap()
  function rememberSettlementBase(chat) {
    const limit = 64 * 1024 * 1024
    function size(value) {
      if (typeof value === 'string') return value.length * 2 + 24
      if (!value || typeof value !== 'object') return 16
      if (settlementSizes.has(value)) return settlementSizes.get(value)
      let bytes = 32
      for (const key of Object.keys(value)) {
        bytes += key.length * 2 + 24 + size(value[key])
        if (bytes > limit) break
      }
      settlementSizes.set(value, bytes)
      return bytes
    }
    settlementBase = size(chat) <= limit ? chat : null
    return chat
  }
  async function readSettlementChat(sessionId) {
    const selectedBase = await resolveSettlementBase?.(sessionId)
    if (selectedBase) {
      settlementReaders.set(selectedBase.chat, selectedBase)
      return selectedBase.chat
    }
    const cached = settlementBase
    if (cached?.sessionId === sessionId && resolveChatSlice && resolveChangedChatSlice) {
      const selected = await resolveChatSlice(sessionId, [])
      if (selected?.denseMessages && selected.chat.id === cached.id) {
        if (selected.chat._storageRevision === cached._storageRevision) return cached
        const changed = await resolveChangedChatSlice(sessionId, cached._storageRevision)
        if (changed?.denseMessages && changed.chat.id === cached.id && changed.chat.sessionId === sessionId
          && changed.baseRevision === cached._storageRevision) {
          const messages = cached.messages.slice(0, changed.messageCount)
          changed.indices.forEach((index,i) => { messages[index] = changed.chat.messages[i] })
          if (messages.length === changed.messageCount && Array.from({length:messages.length},(_,i)=>Boolean(messages[i])).every(Boolean)) {
            return rememberSettlementBase({ ...changed.chat, messages })
          }
        }
      }
    }
    const chat = await resolveChat(sessionId)
    if (resolveChatSlice && resolveChangedChatSlice) rememberSettlementBase(chat)
    return chat
  }

  function assertMvuEnabled(chat) {
    if (!chat || !chat.mvu || chat.mvu.enabled !== true) throw new Error('当前人物卡未启用 MVU 兼容运行时')
  }

  function assertTransactionEvent(transaction, eventId) {
    const id = str(eventId)
    // Scripts lose the event identity after an await or timer. SillyTavern applies
    // such writes to the current state, so they join the running settlement too.
    if (transaction !== undefined && id !== '' && transaction.eventId !== id) {
      const error = new Error('脚本写入不属于当前 MVU 结算事件')
      error.code = 'MVU_SETTLEMENT_EVENT_MISMATCH'
      throw error
    }
    if (transaction === undefined && id.startsWith('mvu-work:')) {
      const error = new Error('结算已结束，迟到的结算写入已忽略')
      error.code = 'MVU_SETTLEMENT_EVENT_MISMATCH'
      throw error
    }
  }

  async function mutationChat(sessionId, eventId) {
    const transaction = settlementTransactions.get(str(sessionId))
    assertTransactionEvent(transaction, eventId)
    return transaction === undefined ? await resolveChat(sessionId) : transaction.draft
  }

  async function transactionResult(sessionId, target, multiple = false, eventId = '') {
    const transaction = settlementTransactions.get(str(sessionId))
    assertTransactionEvent(transaction, eventId)
    if (transaction === undefined) return null
    transaction.mutations++
    return {
      updated: true,
      transactional: true,
      ...(multiple ? { targets: target } : { target }),
      ...(transaction.compact ? { contextDelta: projectMvuReceipt(transaction.work, multiple ? target : [target]) }
        : { context: await fullContext(transaction.draft) })
    }
  }

  /** Run one internal MVU command against an isolated draft and commit once. */
  async function settleMvuUpdate(input = {}) {
    const sessionId = str(input.sessionId)
    async function record(stage, details = {}) {
      try { await diagnostics?.record(sessionId, { diagnosticId: input.diagnosticId, messageId: input.messageId, swipeId: input.swipeId, stage, ...details }) } catch {}
    }
    if (settlementTransactions.has(sessionId)) throw new Error('当前对话已有 MVU 变量结算正在执行')
    const current = await readSettlementChat(sessionId)
    assertMvuEnabled(current)
    const operationId = str(input.operationId).trim()
    if (operationId === '') throw new Error('MVU 变量结算缺少 operationId')
    const expectedLifecycleRevision = Math.max(0, Number(input.expectedLifecycleRevision) || 0)
    if (!mutationIsCurrent(current, expectedLifecycleRevision)) return { updated: false, stale: true, context: await fullContext(current) }
    const messageId = Number(input.messageId)
    if (!Number.isInteger(messageId) || messageId < 0 || messageId >= current.messages.length) throw new Error('MVU 变量结算楼层不存在')
    await ensureRows(current, [messageId])
    const message = current.messages[messageId]
    const swipeId = Number(input.swipeId)
    if (!Number.isInteger(swipeId) || swipeId < 0 || swipeId !== Math.max(0, Number(message.swipeId) || 0)) {
      return { updated: false, stale: true, context: await fullContext(current) }
    }
    const command = str(input.command).trim()
    if (command === '') throw new Error('MVU 变量结算命令为空')
    // resolveChat awaited above: another attempt may have reserved this session
    // in the meantime. Never overwrite its draft or release its ownership.
    if (settlementTransactions.has(sessionId)) throw new Error('当前对话已有 MVU 变量结算正在执行')
    // An earlier lifecycle event still owns the executor. Installing an MVU
    // transaction now would reject its legitimate writes during context loading,
    // even though dispatch would eventually return busy and defer this attempt.
    const beforeDispatch = scriptDispatch.status?.(sessionId)
    if (beforeDispatch?.busy) {
      await record('runtime-deferred', { availability: beforeDispatch })
      return { updated: false, deferred: true, deferredReason: 'runtime-busy', context: await fullContext(current) }
    }
    const originalText = str((message.swipes && message.swipes[swipeId]) ?? message.sourceText ?? message.text)
    const eventId = 'mvu-work:' + randomUUID()
    const work = createMvuWorkingCopy(current, eventId, {ensure: indices => ensureRows(current, indices)})
    const reader = settlementReaders.get(current)
    if (reader) settlementReaders.set(work.chat, reader)
    work.touch(messageId)
    const transaction = {
      work, compact: input.compactContext === true,
      draft: work.chat,
      eventId,
      messageId,
      swipeId,
      mutations: 0
    }
    if (input.baselineVariables) {
      const target = transaction.draft.messages[messageId]
      if (!Array.isArray(target.variables)) target.variables = []
      target.variables[swipeId] = structuredClone(input.baselineVariables)
    }
    settlementTransactions.set(sessionId, transaction)
    try {
      const internalText = str(input.storyText).trim() + '\n\n' + command
      const hasMvuSnapshot = value => value && value.stat_data !== undefined && value.schema !== undefined
      const indexedBase = settlementReaders.get(current)
      let priorId = indexedBase ? await indexedBase.previousMvu(messageId) : -1
      for (let i=indexedBase ? -1 : messageId-1;i>=0;i--) {
        const row=current.messages[i]
        if (hasMvuSnapshot(row.variables?.[row.swipeId || 0])) { priorId=i; break }
      }
      async function executionContext(baseline) {
        transaction.compact = input.compactContext === true || baseline?.workContextVersion === 1
        let indices, appended = false
        if (baseline?.workContextVersion === 1 && (baseline.complete === true || baseline.historyWindowVersion === 1) && !baseline.full
          && baseline.chatId === current.id && baseline.lifecycleRevision === (current.tavernHelperLifecycleRevision || 0)
          && Number.isSafeInteger(baseline.stateRevision) && !baseline.transaction) {
          if (baseline.stateRevision === current._storageRevision && baseline.messageCount === current.messages.length) indices=[]
          else {
            const changed = await resolveChangedChatSlice?.(sessionId, baseline.stateRevision, 'settlement')
            if (changed?.denseMessages && changed.baseRevision === baseline.stateRevision && changed.chat.id === current.id && changed.chat._storageRevision === current._storageRevision) {
              appended = baseline.appendContextVersion === 1 && Number.isSafeInteger(baseline.messageCount) && baseline.messageCount >= 0
                && current.messages.length > baseline.messageCount && Number.isSafeInteger(changed.layoutFrom) && changed.layoutFrom >= baseline.messageCount
              if (changed.layoutChanged === false || appended) indices=changed.indices
            }
          }
        }
        if (indices) indices=[...new Set([...indices,messageId,...(priorId>=0 && input.baselineVariables ? [priorId] : [])])].filter(i=>i<current.messages.length)
        const projected = await context(sessionId, transaction.draft, '', indices)
        const target = indices ? projected.messages.find(row=>row.message_id===messageId) : projected.messages[messageId]
        if (input.baselineVariables && priorId>=0) {
          const prior=indices ? projected.messages.find(row=>row.message_id===priorId) : projected.messages[priorId]
          prior.variables=structuredClone(input.baselineVariables)
        }
        target.message=internalText
        if (!Array.isArray(target.swipes)) target.swipes=[originalText]
        target.swipes[swipeId]=internalText
        if (transaction.compact) projected.transaction={eventId,sequence:work.sequence}
        if (!indices) return projected
        const {messages,...header}=projected
        const turnMessageIdChanges = []
        if (appended) for (const id of [...indices].sort((a,b)=>a-b)) {
          if (id < baseline.messageCount) continue
          const source = current.messages[id]
          const role = source.role === 'tavern-helper' ? (['system','assistant','user'].includes(source.tavernRole) ? source.tavernRole : 'assistant') : ['system','user'].includes(source.role) ? source.role : 'assistant'
          const turn = Math.max(0, Number(source.turn) || (source.greeting === true ? 1 : 0))
          if (role === 'assistant' && turn > 0) turnMessageIdChanges.push([String(turn),id])
        }
        return {contextDelta:{version:2,kind:'dispatch',chatId:current.id,
          lifecycleRevision:current.tavernHelperLifecycleRevision||0,baseRevision:baseline.stateRevision,
          stateRevision:current._storageRevision,eventId,messageCount:current.messages.length,header,messages,turnMessageIdChanges}}
      }
      transaction.executionContext = executionContext
      const lazy = scriptDispatch.supportsContextProjection === true
      const eventContext = lazy ? null : await executionContext()
      const availability = scriptDispatch.status?.(sessionId)
      const currentSnapshot=hasMvuSnapshot(transaction.draft.messages[messageId].variables?.[swipeId])
      await record('runtime-dispatch', { availability, baseline: { currentSnapshot, priorSnapshot:priorId>=0, usesCurrentFallback:currentSnapshot && priorId<0 } })
      async function initializationRejected(error) {
        const validation = { changes: [], sideEffects: [], failures: [{ message: error }] }
        await record('runtime-initialization-failed', { error })
        return { updated: false, rejected: true, retryable: false, validation,
          diagnostics: [{ kind: 'initialization', level: 'error', initializationFailed: true, message: error }],
          context: await fullContext(current) }
      }
      if (availability?.initializationError) return await initializationRejected(availability.initializationError)
      // MVU is a local capability of the chat. A temporarily absent browser
      // executor is scheduling state, not a failed settlement. Return the
      // prepared transaction immediately so the caller can persist and resume
      // it when the executor registers again.
      if (availability && availability.ready !== true) {
        await record('runtime-deferred', { availability })
        return { updated: false, deferred: true, deferredReason: 'runtime-not-ready', context: await fullContext(current) }
      }
      const dispatched = await scriptDispatch.dispatch(sessionId, 'MESSAGE_RECEIVED', [messageId], eventContext, { eventId: transaction.eventId, signal: input.signal, ...(lazy ? { contextForBaseline: executionContext } : {}) })
      await record('runtime-completed', { handled: dispatched.handled === true, timedOut: dispatched.timedOut === true, executionLost: dispatched.executionLost === true, claimTimedOut: dispatched.claimTimedOut === true, phase: dispatched.phase, disposed: dispatched.disposed === true, error: dispatched.error, diagnostics: dispatched.diagnostics || [] })
      if (dispatched.handled !== true) {
        if (dispatched.initializationFailed === true) return await initializationRejected(str(dispatched.error))
        if (dispatched.unavailable === true || (input.durable === true && (dispatched.disposed === true || dispatched.timedOut === true || /超时|timed?\s*out|timeout/i.test(str(dispatched.error))))) {
          await record('runtime-deferred', { availability: scriptDispatch.status?.(sessionId) })
          return { updated: false, deferred: true, deferredReason: dispatched.claimTimedOut === true ? 'claim-timeout' : 'delivery-interrupted', context: await fullContext(current) }
        }
        if (str(dispatched.error).trim() !== '' && !dispatched.timedOut && !dispatched.disposed
          && !/超时|timed?\s*out|timeout/i.test(str(dispatched.error))) {
          const validation = { changes: [], sideEffects: [], failures: [{ message: str(dispatched.error) }] }
          await record('validation-rejected', { failures: validation.failures, externalEffects: transaction.externalEffects === true })
          return { updated: false, rejected: true, retryable: transaction.externalEffects !== true, retryAfterMs: MVU_RETRY_AFTER_MS,
            validation, diagnostics: dispatched.diagnostics || [], context: await fullContext(current) }
        }
        if (dispatched.timedOut === true) throw new Error('MVU 脚本执行回执超时，本轮结算未确认完成，请重试结算')
        if (dispatched.disposed === true) throw new Error('MVU 浏览器执行器已断开，本轮结算中断，请重试结算')
        throw new Error(str(dispatched.error).trim() || '官方 MVU 浏览器运行时尚未就绪，本轮未执行变量结算')
      }
      const settled = transaction.draft.messages[messageId]
      if (!settled || Math.max(0, Number(settled.swipeId) || 0) !== swipeId) {
        return { updated: false, stale: true, context: await fullContext(current) }
      }
      // Settlement writes variables only. The prose stays as the round saved it: text is
      // the prompt-regex projection the native surface holds, not the raw reply; turning it
      // back into the raw reply made every later reconcile see drift and repair (#306).
      for (const key of [...REPLY_PROSE_FIELDS, 'sessionText']) {
        if (Object.hasOwn(message, key)) settled[key] = structuredClone(message[key])
        else delete settled[key]
      }
      if (!Array.isArray(settled.swipes)) settled.swipes = [originalText]
      const beforeVariables = input.baselineVariables || current.messages[messageId].variables?.[swipeId] || {}
      const afterVariables = transaction.draft.messages[messageId].variables?.[swipeId] || {}
      const validation = typeof input.validate === 'function'
        ? await input.validate({ before: beforeVariables, after: afterVariables })
        : null
      if (validation && validation.failures.length > 0) {
        await record('validation-rejected', { failures: validation.failures, externalEffects: transaction.externalEffects === true })
        return {
          updated: false, rejected: true, retryable: transaction.externalEffects !== true, retryAfterMs: MVU_RETRY_AFTER_MS,
          validation, diagnostics: dispatched.diagnostics || [], context: await fullContext(current)
        }
      }
      // The browser event can take time; recheck the target before committing its draft.
      const selected = await resolveChatSlice?.(sessionId, [messageId], 'settlement')
      const latest = selected ? { ...selected.chat, messages: Object.assign([], { [messageId]: selected.chat.messages[0] }) } : await resolveChat(sessionId)
      if (!mutationIsCurrent(latest, expectedLifecycleRevision)
        || Number(latest.messages[messageId]?.swipeId || 0) !== swipeId) return { updated:false, stale:true }
      const effect = createMvuSettlementEffect({
        operationId, chatId: current.id, sessionId,
        branchId: input.branchId, basedOnRevision: input.basedOnRevision,
        expectedLifecycleRevision, messageId, swipeId,
        before: current, after: transaction.draft, messageIndices: work.dirty, guardChanges: Boolean(reader?.ensure)
      })
      await record('prepared', { mutations: transaction.mutations })
      return {
        updated: true,
        validation,
        diagnostics: dispatched.diagnostics || [],
        mutations: transaction.mutations,
        messageId,
        swipeId,
        effect,
        variables: structuredClone(afterVariables),
        ...(input.compactResult === true ? {} : { context: await fullContext(transaction.draft) })
      }
    } catch (error) {
      await record('runtime-or-persistence-failed', { error: str(error && error.message || error) })
      throw error
    } finally {
      settlementTransactions.delete(sessionId)
    }
  }

  function assertEvent(sessionId, eventId) {
    assertTransactionEvent(settlementTransactions.get(str(sessionId)), eventId)
  }
  async function touchMessage(sessionId, messageId, eventId) {
    const transaction = settlementTransactions.get(str(sessionId))
    assertTransactionEvent(transaction, eventId)
    if (!transaction) return
    await transaction.work.touchAsync(messageId)
    assertEvent(sessionId, eventId)
  }
  async function prepareMessages(sessionId, messages, eventId) {
    const transaction = settlementTransactions.get(str(sessionId))
    assertTransactionEvent(transaction, eventId)
    const chat = transaction?.draft
    const patches = transaction === undefined ? messages : (Array.isArray(messages) ? messages : []).map(function (raw) {
      const patch = raw && typeof raw === 'object' ? structuredClone(raw) : raw
      if (!patch || Number(patch.message_id) !== transaction.messageId) return patch
      const swipeId = Object.prototype.hasOwnProperty.call(patch, 'swipe_id') ? Number(patch.swipe_id) : transaction.swipeId
      if (swipeId !== transaction.swipeId) return patch
      delete patch.message
      return patch
    })
    if (transaction) {
      for (const patch of patches) if (patch && typeof patch === 'object') await transaction.work.touchAsync(patch.message_id)
      if (chat.messages.length) await transaction.work.ensure([0])
      assertEvent(sessionId, eventId)
    }
    return patches
  }
  async function updateGlobals(sessionId, variables) {
    const transaction = settlementTransactions.get(str(sessionId))
    if (transaction) {
      const previous = transaction.globalVariables || await readGlobalVariables()
      const next = variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {}
      // Official MVU uses this global as an execution flag, not shared game
      // state. Keep it local to the settlement and retain cross-chat guards.
      const withoutRuntimeFlag = value => { const copy = { ...value }; delete copy.extra_analysis; return copy }
      if (!isDeepStrictEqual(withoutRuntimeFlag(previous), withoutRuntimeFlag(next))) throw new Error('MVU 结算事务不能修改跨对话的全局变量')
      transaction.globalVariables = structuredClone(next)
      return { updated: true, transactional: true, target: { type: 'global' }, globalVariables: structuredClone(next) }
    }
    return null
  }
  async function transactionContext(sessionId, eventId) {
    const transaction=settlementTransactions.get(str(sessionId))
    assertTransactionEvent(transaction,eventId)
    if (!transaction) return context(sessionId)
    if (transaction.work.sequence === 0) return transaction.executionContext({workContextVersion:1,full:true})
    return {...await context(sessionId,transaction.draft),transaction:{eventId:transaction.eventId,sequence:transaction.work.sequence}}
  }
  return Object.freeze({
    settle: settleMvuUpdate, has: sessionId => settlementTransactions.has(str(sessionId)),
    assertEvent, mutationChat, result: transactionResult, touchMessage, prepareMessages, updateGlobals,
    ensureRows, fullContext, context: transactionContext
  })
}
