import { isDeepStrictEqual } from 'node:util'
import { applyChatPluginData, validateChatPluginRequest } from './tavern-chat-plugin-data.js'
import {
  lastTavernHelperVariables,
  projectTavernHelperContext,
  replaceTavernHelperMessages,
  replaceTavernHelperVariables
} from './tavern-helper-context.js'
import {
  projectTavernHelperWorldbook,
  replaceTavernHelperWorldbookOperations
} from './tavern-helper-worldbook.js'
import { createMvuSettlementEffect } from './mvu-settlement-effect.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function isOfficialMvuData(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && value.stat_data !== undefined && value.schema !== undefined
}

// Pinned upstream src/function/update/index.ts throttles MESSAGE_RECEIVED at
// 3000ms. Re-entering sooner returns the old Promise and schedules a late write.
const MVU_RETRY_AFTER_MS = 3100

/**
 * Translate the Tavern-shaped host API exposed to card scripts into mutations
 * of dsh-tavern's authoritative chat and worldbook state.
 */
export function createTavernScriptHostAdapter(options = {}) {
  const mutationTails = new Map()
  const settlementTransactions = new Map()

  function assertDependencies() {
    for (const name of ['resolveChat', 'writeChat', 'readCard', 'worldBooks', 'scriptDispatch']) {
      if (!options[name]) throw new Error('Tavern Script Host Adapter 缺少依赖: ' + name)
    }
  }
  assertDependencies()

  function assertMvuEnabled(chat) {
    if (!chat || !chat.mvu || chat.mvu.enabled !== true) throw new Error('当前人物卡未启用 MVU 兼容运行时')
  }

  async function assertScriptEnabled(chat) {
    if (typeof options.isPlayChat === 'function' && !options.isPlayChat(chat)) throw new Error('当前会话没有绑定游玩对话')
    if (chat?.mvu?.enabled === true) return
    if (typeof options.hasScripts !== 'function' || !await options.hasScripts(chat)) throw new Error('当前人物卡没有启用脚本运行时')
  }

  function mutationIsCurrent(chat, expectedLifecycleRevision) {
    if (expectedLifecycleRevision === undefined || expectedLifecycleRevision === null) return true
    return Math.max(0, Number(chat && chat.tavernHelperLifecycleRevision) || 0) === Math.max(0, Number(expectedLifecycleRevision) || 0)
  }

  function staleMutation(chat) {
    return { updated: false, stale: true, context: projectTavernHelperContext(chat) }
  }

  async function resolveChat(sessionId) {
    const chat = await options.resolveChat(str(sessionId))
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    return chat
  }

  async function mutationChat(sessionId) {
    const transaction = settlementTransactions.get(str(sessionId))
    return transaction === undefined ? await resolveChat(sessionId) : transaction.draft
  }

  function transactionResult(sessionId, target, multiple = false) {
    const transaction = settlementTransactions.get(str(sessionId))
    if (transaction === undefined) return null
    transaction.mutations++
    return {
      updated: true,
      transactional: true,
      ...(multiple ? { targets: target } : { target }),
      context: projectTavernHelperContext(transaction.draft)
    }
  }

  async function updateVariables(sessionId, option, variables, expectedLifecycleRevision) {
    const chat = await mutationChat(sessionId)
    await assertScriptEnabled(chat)
    if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(chat)
    if (option && option.type === 'global') {
      if (!options.globalVariables || typeof options.globalVariables.save !== 'function') throw new Error('全局变量存储未连接')
      const transaction = settlementTransactions.get(str(sessionId))
      if (transaction) throw new Error('MVU 结算事务不能修改跨对话的全局变量')
      const saved = await options.globalVariables.save(variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {})
      return { updated: true, target: { type: 'global' }, globalVariables: structuredClone(saved) }
    }
    const updated = replaceTavernHelperVariables(chat, { option, variables })
    const transactional = transactionResult(sessionId, updated)
    if (transactional !== null) return transactional
    try { await options.writeChat(chat, { source: 'tavern-helper.variables' }) }
    catch (error) {
      if (error && error.code === 'DSH_TAVERN_CHAT_CONFLICT') {
        const latest = await options.resolveChat(str(sessionId))
        if (latest !== undefined && !mutationIsCurrent(latest, expectedLifecycleRevision)) return staleMutation(latest)
      }
      throw error
    }
    return { updated: true, target: updated, context: projectTavernHelperContext(chat) }
  }

  async function updateMessages(sessionId, messages, expectedLifecycleRevision) {
    const transaction = settlementTransactions.get(str(sessionId))
    const chat = transaction === undefined ? await resolveChat(sessionId) : transaction.draft
    await assertScriptEnabled(chat)
    if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(chat)
    const patches = transaction === undefined ? messages : (Array.isArray(messages) ? messages : []).map(function (raw) {
      const patch = raw && typeof raw === 'object' ? structuredClone(raw) : raw
      if (!patch || Number(patch.message_id) !== transaction.messageId) return patch
      const swipeId = Object.prototype.hasOwnProperty.call(patch, 'swipe_id') ? Number(patch.swipe_id) : transaction.swipeId
      if (swipeId !== transaction.swipeId) return patch
      delete patch.message
      return patch
    })
    const updated = replaceTavernHelperMessages(chat, patches)
    if (chat.mvu && chat.mvu.owner === 'official') {
      const opening = Array.isArray(chat.messages) ? chat.messages[0] : null
      const snapshots = opening && Array.isArray(opening.variables) ? opening.variables : []
      if (snapshots.length > 0 && snapshots.every(isOfficialMvuData)) {
        chat.mvu.openingInitialization = { version: 2, status: 'complete', completedAt: Date.now() }
      }
    }
    const transactional = transactionResult(sessionId, updated, true)
    if (transactional !== null) return transactional
    try { await options.writeChat(chat, { source: 'tavern-helper.messages' }) }
    catch (error) {
      if (error && error.code === 'DSH_TAVERN_CHAT_CONFLICT') {
        const latest = await options.resolveChat(str(sessionId))
        if (latest !== undefined && !mutationIsCurrent(latest, expectedLifecycleRevision)) return staleMutation(latest)
      }
      throw error
    }
    return { updated: true, targets: updated, context: projectTavernHelperContext(chat) }
  }

  async function worldbookRecord(sessionId, requestedName) {
    const chat = await resolveChat(sessionId)
    await assertScriptEnabled(chat)
    const card = await options.readCard(chat)
    const record = await options.worldBooks.bound(chat.cardPath, card)
    if (record === null) throw new Error('当前人物卡没有绑定世界书')
    const name = str(requestedName).trim()
    if (name !== '' && name !== 'current' && name !== str(record.view.displayName)) {
      throw new Error('当前兼容层只能访问人物卡绑定的世界书: ' + name)
    }
    return { chat, record }
  }

  async function serializeWorldbook(cardPath, work) {
    const key = str(cardPath)
    const previous = mutationTails.get(key) || Promise.resolve()
    const current = previous.catch(function () {}).then(work)
    mutationTails.set(key, current)
    try { return await current }
    finally { if (mutationTails.get(key) === current) mutationTails.delete(key) }
  }

  async function getWorldbook(sessionId, name) {
    const resolved = await worldbookRecord(sessionId, name)
    return { worldbook: projectTavernHelperWorldbook(resolved.record.view) }
  }

  async function replaceWorldbook(sessionId, name, entries, expectedEntries) {
    const initial = await worldbookRecord(sessionId, name)
    return await serializeWorldbook(worldbookKey(initial.record), async function () {
      const resolved = await worldbookRecord(sessionId, name)
      if (worldbookKey(resolved.record) !== worldbookKey(initial.record)) throw new Error('世界书绑定已变化，请重新读取后重试')
      if (expectedEntries !== undefined && JSON.stringify(projectTavernHelperWorldbook(resolved.record.view).entries) !== JSON.stringify(expectedEntries)) {
        throw new Error('世界书已被其他操作修改，请重新读取后重试')
      }
      const operations = replaceTavernHelperWorldbookOperations(resolved.record.view, entries)
      const transaction = settlementTransactions.get(str(sessionId))
      if (transaction && operations.length > 0) throw new Error('MVU 结算事务不能修改跨存储的世界书')
      const updated = operations.length === 0
        ? resolved.record
        : await options.worldBooks.update(resolved.record.source, { operations })
      return { updated: operations.length > 0, worldbook: projectTavernHelperWorldbook(updated.view) }
    })
  }

  function worldbookKey(record) {
    return record.source.kind === 'card' ? 'card:' + record.source.cardPath : 'standalone:' + record.source.path
  }

  async function loadWorldInfo(sessionId, name) {
    const resolved = await worldbookRecord(sessionId, name)
    return { worldInfo: (await options.worldBooks.export(resolved.record.source)).document }
  }

  async function saveWorldInfo(sessionId, name, worldInfo, expectedWorldInfo) {
    if (!expectedWorldInfo) throw new Error('保存前请先读取世界书')
    const initial = await worldbookRecord(sessionId, name)
    return await serializeWorldbook(worldbookKey(initial.record), async function () {
      const resolved = await worldbookRecord(sessionId, name)
      if (worldbookKey(resolved.record) !== worldbookKey(initial.record)) throw new Error('世界书绑定已变化，请重新读取后重试')
      const current = (await options.worldBooks.export(resolved.record.source)).document
      if (!isDeepStrictEqual(current, expectedWorldInfo)) throw new Error('世界书已被其他操作修改，请重新读取后重试')
      const transaction = settlementTransactions.get(str(sessionId))
      if (transaction) throw new Error('MVU 结算事务不能修改跨存储的世界书')
      const updated = await options.worldBooks.replaceNative(resolved.record.source, worldInfo)
      return { updated: true, worldbook: projectTavernHelperWorldbook(updated.view), worldInfo: (await options.worldBooks.export(resolved.record.source)).document }
    })
  }

  async function saveChatData(sessionId, request) {
    const revisions = validateChatPluginRequest(request)
    const chat = await resolveChat(sessionId)
    await assertScriptEnabled(chat)
    if (chat.id !== request.chatId) throw new Error('聊天已切换，插件数据未保存')
    if (!options.readChatRevision || !options.updateChat) throw new Error('插件聊天存储未连接')
    if (settlementTransactions.has(str(sessionId))) throw new Error('临时 MVU 结算期间不能保存聊天插件数据，请稍后重试')
    const baselines = new Map(await Promise.all(revisions.map(async revision => [revision, await options.readChatRevision(chat.id, revision)])))
    const saved = await options.updateChat(chat.id, async function (latest) {
      await assertScriptEnabled(latest)
      if (latest.sessionId && str(latest.sessionId) !== str(sessionId)) throw new Error('聊天绑定已变化，插件数据未保存')
      return applyChatPluginData(latest, baselines, request)
    }, { source: 'tavern-helper.chat-plugin-data' })
    if (!saved) throw new Error('聊天已不存在，插件数据未保存')
    return { updated: true, context: projectTavernHelperContext(saved) }
  }

  async function saveExtensionSettings(sessionId, settings, expectedSettings) {
    await assertScriptEnabled(await resolveChat(sessionId))
    if (!options.extensionSettings) throw new Error('插件设置存储未连接')
    return { updated: true, extensionSettings: await options.extensionSettings.save(settings, expectedSettings) }
  }

  async function context(sessionId, chatValue, transientUserText = '') {
    const chat = chatValue || await resolveChat(sessionId)
    const draft = structuredClone(chat)
    const userText = str(transientUserText).trim()
    if (userText !== '') {
      const previousVariables = lastTavernHelperVariables(draft.messages)
      const message = { role: 'user', text: userText, swipeId: 0, swipes: [userText], variables: [] }
      if (previousVariables !== undefined) message.variables = [structuredClone(previousVariables)]
      draft.messages.push(message)
    }
    const projected = projectTavernHelperContext(draft)
    if (options.globalVariables && typeof options.globalVariables.read === 'function') {
      projected.globalVariables = await options.globalVariables.read()
    }
    try {
      const resolved = await worldbookRecord(sessionId, 'current')
      projected.worldbook = projectTavernHelperWorldbook(resolved.record.view)
    } catch {}
    return projected
  }

  async function dispatchEvent(input = {}) {
    const eventContext = input.context || await context(input.sessionId, input.chat, input.transientUserText)
    return await options.scriptDispatch.dispatch(input.sessionId, input.name, input.args, eventContext)
  }

  /** Run one internal MVU command against an isolated draft and commit once. */
  async function settleMvuUpdate(input = {}) {
    const sessionId = str(input.sessionId)
    async function record(stage, details = {}) {
      try { await options.diagnostics?.record(sessionId, { diagnosticId: input.diagnosticId, messageId: input.messageId, swipeId: input.swipeId, stage, ...details }) } catch {}
    }
    if (settlementTransactions.has(sessionId)) throw new Error('当前对话已有 MVU 变量结算正在执行')
    const current = await resolveChat(sessionId)
    assertMvuEnabled(current)
    const operationId = str(input.operationId).trim()
    if (operationId === '') throw new Error('MVU 变量结算缺少 operationId')
    const expectedLifecycleRevision = Math.max(0, Number(input.expectedLifecycleRevision) || 0)
    if (!mutationIsCurrent(current, expectedLifecycleRevision)) return { updated: false, stale: true, context: projectTavernHelperContext(current) }
    const messageId = Number(input.messageId)
    if (!Number.isInteger(messageId) || messageId < 0 || messageId >= current.messages.length) throw new Error('MVU 变量结算楼层不存在')
    const message = current.messages[messageId]
    const swipeId = Number(input.swipeId)
    if (!Number.isInteger(swipeId) || swipeId < 0 || swipeId !== Math.max(0, Number(message.swipeId) || 0)) {
      return { updated: false, stale: true, context: projectTavernHelperContext(current) }
    }
    const command = str(input.command).trim()
    if (command === '') throw new Error('MVU 变量结算命令为空')
    const originalText = str((message.swipes && message.swipes[swipeId]) ?? message.sourceText ?? message.text)
    const transaction = {
      draft: structuredClone(current),
      messageId,
      swipeId,
      mutations: 0
    }
    settlementTransactions.set(sessionId, transaction)
    try {
      const eventContext = await context(sessionId, transaction.draft)
      const projected = eventContext.messages[messageId]
      if (!projected) throw new Error('MVU 变量结算投影楼层不存在')
      const internalText = str(input.storyText).trim() + '\n\n' + command
      projected.message = internalText
      if (!Array.isArray(projected.swipes)) projected.swipes = [originalText]
      projected.swipes[swipeId] = internalText
      const availability = options.scriptDispatch.status?.(sessionId)
      await record('runtime-dispatch', { availability })
      async function initializationRejected(error) {
        const validation = { changes: [], sideEffects: [], failures: [{ message: error }] }
        await record('runtime-initialization-failed', { error })
        return { updated: false, rejected: true, retryable: false, validation,
          diagnostics: [{ kind: 'initialization', level: 'error', initializationFailed: true, message: error }],
          context: projectTavernHelperContext(current) }
      }
      if (availability?.initializationError) return await initializationRejected(availability.initializationError)
      // MVU is a local capability of the chat. A temporarily absent browser
      // executor is scheduling state, not a failed settlement. Return the
      // prepared transaction immediately so the caller can persist and resume
      // it when the executor registers again.
      if (availability && availability.ready !== true) {
        await record('runtime-deferred', { availability })
        return { updated: false, deferred: true, context: projectTavernHelperContext(current) }
      }
      const dispatched = await options.scriptDispatch.dispatch(sessionId, 'MESSAGE_RECEIVED', [messageId], eventContext)
      await record('runtime-completed', { handled: dispatched.handled === true, timedOut: dispatched.timedOut === true, claimTimedOut: dispatched.claimTimedOut === true, phase: dispatched.phase, disposed: dispatched.disposed === true, error: dispatched.error, diagnostics: dispatched.diagnostics || [] })
      if (dispatched.handled !== true) {
        if (dispatched.initializationFailed === true) return await initializationRejected(str(dispatched.error))
        if (dispatched.unavailable === true) {
          await record('runtime-deferred', { availability: options.scriptDispatch.status?.(sessionId) })
          return { updated: false, deferred: true, context: projectTavernHelperContext(current) }
        }
        if (str(dispatched.error).trim() !== '' && !dispatched.timedOut && !dispatched.disposed
          && !/超时|timed?\s*out|timeout/i.test(str(dispatched.error))) {
          const validation = { changes: [], sideEffects: [], failures: [{ message: str(dispatched.error) }] }
          await record('validation-rejected', { failures: validation.failures, externalEffects: transaction.externalEffects === true })
          return { updated: false, rejected: true, retryable: transaction.externalEffects !== true, retryAfterMs: MVU_RETRY_AFTER_MS,
            validation, diagnostics: dispatched.diagnostics || [], context: projectTavernHelperContext(current) }
        }
        if (dispatched.timedOut === true) throw new Error('MVU 脚本执行回执超时，本轮结算未确认完成，请重试结算')
        if (dispatched.disposed === true) throw new Error('MVU 浏览器执行器已断开，本轮结算中断，请重试结算')
        throw new Error(str(dispatched.error).trim() || '官方 MVU 浏览器运行时尚未就绪，本轮未执行变量结算')
      }
      const settled = transaction.draft.messages[messageId]
      if (!settled || Math.max(0, Number(settled.swipeId) || 0) !== swipeId) {
        return { updated: false, stale: true, context: projectTavernHelperContext(current) }
      }
      if (!Array.isArray(settled.swipes)) settled.swipes = [originalText]
      settled.swipes[swipeId] = originalText
      settled.sourceText = originalText
      settled.projectionText = originalText
      settled.text = originalText
      settled.sessionText = originalText
      settled.displayText = originalText
      const beforeVariables = projectTavernHelperContext(current).messages[messageId].variables
      const proposedContext = projectTavernHelperContext(transaction.draft)
      const validation = typeof input.validate === 'function'
        ? await input.validate({ before: beforeVariables, after: proposedContext.messages[messageId].variables })
        : null
      if (validation && validation.failures.length > 0) {
        await record('validation-rejected', { failures: validation.failures, externalEffects: transaction.externalEffects === true })
        return {
          updated: false, rejected: true, retryable: transaction.externalEffects !== true, retryAfterMs: MVU_RETRY_AFTER_MS,
          validation, diagnostics: dispatched.diagnostics || [], context: projectTavernHelperContext(current)
        }
      }
      // The browser event can take time; recheck the target before committing its draft.
      const latest = await resolveChat(sessionId)
      if (!mutationIsCurrent(latest, expectedLifecycleRevision)
        || Number(latest.messages[messageId]?.swipeId || 0) !== swipeId) return staleMutation(latest)
      const effect = createMvuSettlementEffect({
        operationId, chatId: current.id, sessionId,
        branchId: input.branchId, basedOnRevision: input.basedOnRevision,
        expectedLifecycleRevision, messageId, swipeId,
        before: current, after: transaction.draft
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
        context: projectTavernHelperContext(transaction.draft)
      }
    } catch (error) {
      await record('runtime-or-persistence-failed', { error: str(error && error.message || error) })
      throw error
    } finally {
      settlementTransactions.delete(sessionId)
    }
  }

  return Object.freeze({
    context,
    dispatchEvent,
    settleMvuUpdate,
    updateVariables,
    updateMessages,
    getWorldbook,
    replaceWorldbook,
    saveExtensionSettings,
    saveChatData,
    loadWorldInfo,
    saveWorldInfo,
    claimWork: function (sessionId, runtimeId, ready, initializationError) { return options.scriptDispatch.claim(sessionId, runtimeId, ready, initializationError) },
    startWork: function (sessionId, eventId, leaseToken, runtimeId) { return options.scriptDispatch.start(sessionId, eventId, leaseToken, runtimeId) },
    heartbeatRuntime: function (sessionId, runtimeId, ready, initializationError) { return { active: options.scriptDispatch.touch(sessionId, runtimeId, ready, initializationError) } },
    completeEvent: function (sessionId, eventId, args, runtimeId, leaseToken, error, diagnostics) { return options.scriptDispatch.complete(sessionId, eventId, args, runtimeId, leaseToken, error, diagnostics) },
    releaseRuntime: function (sessionId, runtimeId) { return options.scriptDispatch.dispose(sessionId, runtimeId) }
  })
}
