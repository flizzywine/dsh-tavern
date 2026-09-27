import { randomUUID } from 'node:crypto'
import { diffJson } from './json-mutation.js'
import { createFullPromptTemplateSync } from './full-prompt-template-sync.js'
import { createJsonValueProjectionCache } from './immutable-json-projection.js'
import { resourceSaveSummary, observeResourceSave } from './resource-save-summary.js'
import { projectFullPromptTemplateState, applyFullPromptTemplateState, validateFullPromptTemplateSave, expandFullPromptTemplatePatch } from './full-prompt-template-state.js'
import { mutateScriptPrompts } from './tavern-script-prompts.js'
import { exportSillyTavernWorldBook, inspectWorldBookDocument, updateWorldBookDocument } from './worldbook-resource.js'
import { isDeepStrictEqual } from 'node:util'
import { applyChatPluginData, validateChatPluginRequest, assertPluginJson } from './tavern-chat-plugin-data.js'
import {
  appendTavernHelperMessages,
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
import * as mvuUpdateCore from './mvu/mvu-update-core.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

  function isOfficialMvuData(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && value.stat_data !== undefined && value.schema !== undefined
  }

  // P1 双写：MVU 树级别的变量写同步进 SQLite state（小对象与 chat/script/global 变量不进）。
  // 此阶段读尚未切换，失败只告警；读切换后由同一幂等语义兜底。
  function mirrorVariableWrite(chat, updated, variables) {
    const store = options.variableStore
    if (!store || !updated || updated.type !== 'message') return
    try {
      const message = (chat.messages || [])[updated.messageId]
      const tree = Array.isArray(variables) ? variables[Math.max(0, Number(message && message.swipeId) || 0)] : null
      if (isOfficialMvuData(tree) || (tree !== null && typeof tree === 'object' && tree.stat_data !== undefined)) {
        store.updateState(chat.id, { turn: Math.max(0, Number(message && message.turn) || 0), tree })
      }
    } catch (error) { console.warn('dsh-tavern: 变量 SQLite 双写失败（JSON 已落盘）:', str(error && error.message || error)) }
  }

// Pinned upstream src/function/update/index.ts throttles MESSAGE_RECEIVED at
// 3000ms. Re-entering sooner returns the old Promise and schedules a late write.
const MVU_RETRY_AFTER_MS = 3100

/**
 * Translate the Tavern-shaped host API exposed to card scripts into mutations
 * of dsh-tavern's authoritative chat and worldbook state.
 */
export function createTavernScriptHostAdapter(options = {}) {
  const syncTemplateState = createFullPromptTemplateSync()
  const templateCharacters = createJsonValueProjectionCache({ capacity: 8, maxBytes: 16 * 1024 * 1024 })
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

  function assertTransactionEvent(transaction, eventId) {
    const id = str(eventId)
    if (transaction !== undefined && transaction.eventId !== id) {
      const error = new Error(id === ''
        ? '脚本异步写入未携带当前 MVU 结算事件身份，已拒绝'
        : '脚本写入不属于当前 MVU 结算事件')
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

  function transactionResult(sessionId, target, multiple = false, eventId = '') {
    const transaction = settlementTransactions.get(str(sessionId))
    assertTransactionEvent(transaction, eventId)
    if (transaction === undefined) return null
    transaction.mutations++
    return {
      updated: true,
      transactional: true,
      ...(multiple ? { targets: target } : { target }),
      context: projectTavernHelperContext(transaction.draft)
    }
  }

  async function updatePrompts(sessionId, operation, expectedLifecycleRevision, eventId) {
    return serializeWorldbook('script-prompts:' + sessionId, async function () {
      const chat = await mutationChat(sessionId, eventId)
      await assertScriptEnabled(chat)
      if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(chat)
      if (!mutateScriptPrompts(chat, operation)) return { updated: false, context: projectTavernHelperContext(chat) }
      const transactional = transactionResult(sessionId, { type: 'prompts' }, false, eventId)
      if (transactional !== null) return transactional
      let saved
      if (options.patchChat && Number.isSafeInteger(chat._storageRevision) && chat._storageRevision > 0) {
        saved = await options.patchChat(chat.id, chat._storageRevision, [
          { op: 'set', path: ['tavernScriptPrompts'], value: chat.tavernScriptPrompts }
        ], { source: 'tavern-helper.prompts' })
      }
      // A concurrent write must use the existing three-way merge, never retry
      // this stale replacement against a newer revision.
      if (!saved) await options.writeChat(chat, { source: 'tavern-helper.prompts' })
      else {
        chat._storageRevision = saved._storageRevision
        chat.updatedAt = saved.updatedAt
      }
      return { updated: true, context: projectTavernHelperContext(chat) }
    })
  }

  async function updateVariables(sessionId, option, variables, expectedLifecycleRevision, eventId, contextBaseline) {
    return serializeWorldbook('variables:' + sessionId, () => updateVariablesNow(sessionId, option, variables, expectedLifecycleRevision, eventId, contextBaseline))
  }

  async function updateVariablesNow(sessionId, option, variables, expectedLifecycleRevision, eventId, contextBaseline) {
    const chat = await mutationChat(sessionId, eventId)
    await assertScriptEnabled(chat)
    if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(chat)
    if (option && option.type === 'global') {
      if (!options.globalVariables || typeof options.globalVariables.save !== 'function') throw new Error('全局变量存储未连接')
      const transaction = settlementTransactions.get(str(sessionId))
      if (transaction) throw new Error('MVU 结算事务不能修改跨对话的全局变量')
      const saved = await options.globalVariables.save(variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {})
      return { updated: true, target: { type: 'global' }, globalVariables: structuredClone(saved) }
    }
    if (option && option.type === 'character') {
      if (!options.characterVariables || typeof options.characterVariables.save !== 'function') throw new Error('人物卡变量存储未连接')
      const transaction = settlementTransactions.get(str(sessionId))
      if (transaction) throw new Error('MVU 结算事务不能修改跨对话的人物卡变量')
      const saved = await serializeWorldbook('card-variables:' + str(chat.cardPath), function () {
        return options.characterVariables.save(chat.cardPath, variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {}, str(sessionId))
      })
      return { updated: true, target: { type: 'character' }, characterVariables: structuredClone(saved) }
    }
    const canPatch = options.patchChat && Number.isSafeInteger(chat._storageRevision) && chat._storageRevision > 0
      && !settlementTransactions.has(str(sessionId))
    // Capture references to replaced values, not copies of the entire history.
    // Message variable arrays are mutated in place by the compatibility API.
    const before = canPatch ? {
      variables: chat.variables,
      scripts: chat.tavernHelperScriptVariables && { ...chat.tavernHelperScriptVariables },
      messages: option?.type === 'message' ? (chat.messages || []).map(message =>
        Array.isArray(message?.variables) ? message.variables.slice() : message?.variables) : []
    } : null
    const baseRevision = chat._storageRevision
    const compact = canPatch && contextBaseline?.chatId === chat.id
      && contextBaseline.stateRevision === baseRevision
      && contextBaseline.lifecycleRevision === (chat.tavernHelperLifecycleRevision || 0)
      && (chat.messages || []).every(message => message && typeof message === 'object')
    let patched = false
    const updated = replaceTavernHelperVariables(chat, { option, variables })
    const transactional = transactionResult(sessionId, updated, false, eventId)
    if (transactional !== null) return transactional
    try {
      let saved
      if (canPatch) {
        const path = updated.type === 'message' ? ['messages', updated.messageId, 'variables']
          : [updated.type === 'chat' ? 'variables' : 'tavernHelperScriptVariables']
        const previous = updated.type === 'message' ? before.messages[updated.messageId]
          : updated.type === 'chat' ? before.variables : before.scripts
        const current = updated.type === 'message' ? chat.messages[updated.messageId].variables
          : updated.type === 'chat' ? chat.variables : chat.tavernHelperScriptVariables
        // Match the existing JSON store's normalization (including sparse swipes).
        const normalized = JSON.parse(JSON.stringify(current))
        const changes = diffJson(previous, normalized).map(change => ({ ...change, path: [...path, ...change.path] }))
        saved = await options.patchChat(chat.id, chat._storageRevision, changes, {
          source: 'tavern-helper.variables',
          assertCurrent: () => assertTransactionEvent(settlementTransactions.get(str(sessionId)), eventId)
        })
        if (saved) {
          patched = true
          const { messages: _messages, ...header } = saved
          Object.assign(chat, header)
          if (updated.type === 'message') {
            chat.messages[updated.messageId].variables = normalized
            mirrorVariableWrite(chat, updated, normalized)
          }
        }
      }
      // A competing revision needs the existing three-way merge/conflict checks.
      if (!saved) {
        await options.writeChat(chat, { source: 'tavern-helper.variables' })
        mirrorVariableWrite(chat, updated, updated.type === 'message' && Array.isArray(chat.messages[updated.messageId]?.variables) ? chat.messages[updated.messageId].variables : null)
      }
    }
    catch (error) {
      if (error && error.code === 'DSH_TAVERN_CHAT_CONFLICT') {
        const latest = await options.resolveChat(str(sessionId))
        if (latest !== undefined && !mutationIsCurrent(latest, expectedLifecycleRevision)) return staleMutation(latest)
      }
      throw error
    }
    if (compact && patched) {
      // Project only the affected floor, never the complete history. Keep the
      // selected swipe semantics of the full compatibility projection.
      const changes = updated.type === 'message'
        ? { messageId: updated.messageId, message: { ...projectTavernHelperContext({ messages: [chat.messages[updated.messageId]] }).messages[0], message_id: updated.messageId } }
        : updated.type === 'chat' ? { chatVariables: structuredClone(chat.variables || {}) }
          : { scriptVariables: structuredClone(chat.tavernHelperScriptVariables || {}) }
      return { updated: true, target: updated, contextDelta: {
        version: 1, chatId: chat.id, lifecycleRevision: chat.tavernHelperLifecycleRevision || 0,
        baseRevision, stateRevision: chat._storageRevision, ...changes
      } }
    }
    return { updated: true, target: updated, context: projectTavernHelperContext(chat) }
  }

  async function updateMessages(sessionId, messages, expectedLifecycleRevision, eventId) {
    const transaction = settlementTransactions.get(str(sessionId))
    assertTransactionEvent(transaction, eventId)
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
    const transactional = transactionResult(sessionId, updated, true, eventId)
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

  async function createMessages(sessionId, messages, option, expectedLifecycleRevision, eventId) {
    const transaction = settlementTransactions.get(str(sessionId))
    assertTransactionEvent(transaction, eventId)
    if (transaction !== undefined) throw new Error('MVU 结算事务不能创建额外聊天楼层')
    const chat = await resolveChat(sessionId)
    await assertScriptEnabled(chat)
    if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(chat)
    const created = appendTavernHelperMessages(chat, messages, option)
    try { await options.writeChat(chat, { source: 'tavern-helper.messages.create' }) }
    catch (error) {
      if (error && error.code === 'DSH_TAVERN_CHAT_CONFLICT') {
        const latest = await options.resolveChat(str(sessionId))
        if (latest !== undefined && !mutationIsCurrent(latest, expectedLifecycleRevision)) return staleMutation(latest)
      }
      throw error
    }
    if (typeof options.publishCreatedMessages === 'function') await options.publishCreatedMessages(chat, created)
    return { updated: true, targets: created, context: projectTavernHelperContext(chat) }
  }

  async function worldbookRecord(sessionId, requestedName, template = false) {
    const chat = await resolveChat(sessionId)
    if (template) assertTemplateChat(chat); else await assertScriptEnabled(chat)
    const card = await options.readCard(chat)
    const record = await options.worldBooks.bound(chat.cardPath, card, chat)
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

  async function getWorldbook(sessionId, name, template = false) {
    const resolved = await worldbookRecord(sessionId, name, template)
    return { worldbook: projectTavernHelperWorldbook(resolved.record.view) }
  }

  async function replaceWorldbook(sessionId, name, entries, expectedEntries, template = false) {
    const initial = await worldbookRecord(sessionId, name, template)
    return await serializeWorldbook(worldbookKey(initial.record), async function () {
      const resolved = await worldbookRecord(sessionId, name, template)
      if (worldbookKey(resolved.record) !== worldbookKey(initial.record)) throw new Error('世界书绑定已变化，请重新读取后重试')
      if (expectedEntries !== undefined && JSON.stringify(projectTavernHelperWorldbook(resolved.record.view).entries) !== JSON.stringify(expectedEntries)) {
        throw new Error('世界书已被其他操作修改，请重新读取后重试')
      }
      const operations = replaceTavernHelperWorldbookOperations(resolved.record.view, entries)
      const transaction = settlementTransactions.get(str(sessionId))
      if (transaction && operations.length > 0) throw new Error('MVU 结算事务不能修改跨存储的世界书')
      const updated = operations.length === 0
        ? resolved.record
        : await observeResourceSave(resourceSaveSummary('worldbook', resolved.record.localChatId ? 'session' : resolved.record.source.kind === 'card' ? 'card' : 'worldbook', projectTavernHelperWorldbook(resolved.record.view).entries, entries), () => updateBoundWorldbook(resolved, { operations }), summary => options.recordResourceSave?.(sessionId, summary))
      return { updated: operations.length > 0, worldbook: projectTavernHelperWorldbook(updated.view) }
    })
  }

  async function updateBoundWorldbook(resolved, request, nativeDocument) {
    if (!resolved.record.localChatId) return nativeDocument === undefined
      ? await options.worldBooks.update(resolved.record.source, request)
      : await options.worldBooks.replaceNative(resolved.record.source, nativeDocument)
    if (nativeDocument !== undefined) {
      if (!nativeDocument || typeof nativeDocument !== 'object' || !nativeDocument.entries ||
          typeof nativeDocument.entries !== 'object' || Array.isArray(nativeDocument.entries)) throw new Error('原生世界书需要 entries 对象')
      for (const [key, entry] of Object.entries(nativeDocument.entries)) {
        if (!entry || !Number.isSafeInteger(entry.uid) || entry.uid < 0 || String(entry.uid) !== key) throw new Error('世界书条目编号无效或重复')
      }
    }
    const document = nativeDocument === undefined
      ? updateWorldBookDocument(resolved.record.document, request).document
      : structuredClone(nativeDocument)
    // Reuse native worldbook validation before publishing the chat-local version.
    const view = inspectWorldBookDocument(document)
    replaceTavernHelperWorldbookOperations(view, projectTavernHelperWorldbook(view).entries)
    // Legacy chats have no opening snapshot; first merged-book write makes a private copy.
    resolved.chat.openingWorldbookSnapshot = {
      ...(resolved.chat.openingWorldbookSnapshot || { version: 1, source: structuredClone(resolved.record.source) }), document
    }
    await options.writeChat(resolved.chat, { source: 'tavern-helper.local-worldbook' })
    return { ...resolved.record, document, view }
  }

  async function exportBoundWorldbook(record) {
    return record.document ? exportSillyTavernWorldBook(record.document)
      : (await options.worldBooks.export(record.source)).document
  }

  function worldbookKey(record) {
    if (record.localChatId) return 'chat:' + record.localChatId
    return record.source.kind === 'card' ? 'card:' + record.source.cardPath : 'standalone:' + record.source.path
  }

  async function loadWorldInfo(sessionId, name) {
    const resolved = await worldbookRecord(sessionId, name)
    return { worldInfo: await exportBoundWorldbook(resolved.record) }
  }

  async function saveWorldInfo(sessionId, name, worldInfo, expectedWorldInfo) {
    if (!expectedWorldInfo) throw new Error('保存前请先读取世界书')
    const initial = await worldbookRecord(sessionId, name)
    return await serializeWorldbook(worldbookKey(initial.record), async function () {
      const resolved = await worldbookRecord(sessionId, name)
      if (worldbookKey(resolved.record) !== worldbookKey(initial.record)) throw new Error('世界书绑定已变化，请重新读取后重试')
      const current = await exportBoundWorldbook(resolved.record)
      if (!isDeepStrictEqual(current, expectedWorldInfo)) throw new Error('世界书已被其他操作修改，请重新读取后重试')
      const transaction = settlementTransactions.get(str(sessionId))
      if (transaction) throw new Error('MVU 结算事务不能修改跨存储的世界书')
      const updated = await observeResourceSave(resourceSaveSummary('worldbook', resolved.record.localChatId ? 'session' : resolved.record.source.kind === 'card' ? 'card' : 'worldbook', current.entries, worldInfo.entries, true), () => updateBoundWorldbook(resolved, {}, worldInfo), summary => options.recordResourceSave?.(sessionId, summary))
      return { updated: true, worldbook: projectTavernHelperWorldbook(updated.view), worldInfo: await exportBoundWorldbook(updated) }
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

  function assertTemplateChat(chat) {
    if (!chat || !['story', 'script'].includes(chat.mode) || (typeof options.isPlayChat === 'function' && !options.isPlayChat(chat))) throw new Error('当前会话没有绑定游玩对话')
  }

  async function readFullPromptTemplateState(sessionId, cursor) {
    const selected=await (options.resolveChatMetadataSlice?.(sessionId) ?? options.resolveChatSlice?.(sessionId,[]))
    const reuse=selected?.denseMessages && syncTemplateState.matches(cursor,selected.chat)
    const reader = syncTemplateState.reader(cursor)
    let changed = !reuse && selected?.denseMessages && reader?.chatId === selected.chat.id
      && reader.sessionId === selected.chat.sessionId
      && reader.lifecycle === (selected.chat.tavernHelperLifecycleRevision || 0)
      ? await options.resolveChangedChatSlice?.(sessionId, reader.revision) : undefined
    if (!changed?.denseMessages || changed.chat.id !== reader?.chatId
      || changed.chat.sessionId !== reader?.sessionId
      || (changed.chat.tavernHelperLifecycleRevision || 0) !== reader?.lifecycle) changed = undefined
    const chat = reuse ? selected.chat : changed ? changed.chat : await resolveChat(sessionId)
    assertTemplateChat(chat)
    const card = await options.readCard(chat)
    let templateBook
    if (options.worldBooks.templateSnapshot) templateBook = await options.worldBooks.templateSnapshot(chat.cardPath, card, chat)
    else {
      const record = await options.worldBooks.bound(chat.cardPath, card, chat)
      const book = record ? await exportBoundWorldbook(record) : null
      const worldName = str(record?.view?.displayName)
      templateBook = { worldName, worldbooks: worldName && book ? { [worldName]: book } : {} }
    }
    const { worldName, worldbooks } = templateBook
    const extensionSettings = options.fullExtensionSettings ? await options.fullExtensionSettings.read() : {}
    extensionSettings.variables = { ...extensionSettings.variables, global: options.globalVariables ? await options.globalVariables.read() : {} }
    if (!Array.isArray(extensionSettings.regex)) extensionSettings.regex = []
    const characters = templateCharacters(JSON.stringify([chat.cardPath, worldName]), card, source => {
      return [{ ...source, data: { ...source, extensions: { ...source.extensions, ...(worldName ? { world: worldName } : {}) } } }]
    })
    const snapshot = {
      capabilities: {statePatch:1},
      state: projectFullPromptTemplateState(chat),
      environment: { characters, name1: str(chat.macroState?.userName) || '你', name2: str(card.name),
        this_chid: '0', extension_settings: extensionSettings,
        world_names: worldName ? [worldName] : [], selected_world_info: [],
        worldbooks,
        dsh: { settling: settlementTransactions.has(str(sessionId)) || ['pending', 'running'].includes(chat.settleStatus), cardPath: chat.cardPath, model: options.modelFor ? await options.modelFor(chat) : chat.model?.model || chat.model || '', regexScripts: card.extensions?.regex_scripts || [] } }
    }
    if (changed) {
      const indices = [...changed.indices]
      if (chat.promptTemplateInput?.message) indices.push(changed.messageCount)
      return syncTemplateState.selected(snapshot,cursor,indices,changed.messageCount+(chat.promptTemplateInput?.message?1:0),changed.baseRevision)
        || await readFullPromptTemplateState(sessionId)
    }
    if (!reuse) return syncTemplateState(snapshot,cursor)
    // A concurrent reader may have consumed the same cursor while resources loaded.
    return syncTemplateState.unchanged(snapshot,cursor,selected.messageCount+(chat.promptTemplateInput?.message?1:0))
      || await readFullPromptTemplateState(sessionId)
  }

  async function saveFullPromptTemplateGlobals(sessionId, variables, expectedVariables) {
    assertTemplateChat(await resolveChat(sessionId))
    if (!expectedVariables || typeof expectedVariables !== 'object' || Array.isArray(expectedVariables)) throw new Error('缺少全局变量读取版本')
    if (!options.globalVariables) throw new Error('全局变量存储未连接')
    const saved = await options.globalVariables.save(variables, expectedVariables)
    return { updated: true, variables: saved }
  }

  async function readGlobalPromptTemplateSettings() {
    if (!options.fullExtensionSettings) throw new Error('完整模板设置存储未连接')
    return { settings: (await options.fullExtensionSettings.read()).EjsTemplate }
  }

  async function saveFullPromptTemplateSettings(sessionId, settings, expectedSettings) {
    assertTemplateChat(await resolveChat(sessionId))
    return saveGlobalPromptTemplateSettings(settings, expectedSettings)
  }

  async function saveGlobalPromptTemplateSettings(settings, expectedSettings) {
    assertPluginJson(settings, '模板设置')
    if (expectedSettings !== undefined) assertPluginJson(expectedSettings, '模板设置读取版本')
    if (!options.fullExtensionSettings) throw new Error('完整模板设置存储未连接')
    const current = await options.fullExtensionSettings.read()
    const base = { ...current }
    if (expectedSettings === undefined) delete base.EjsTemplate
    else base.EjsTemplate = expectedSettings
    const saved = await options.fullExtensionSettings.save({ ...current, EjsTemplate: settings }, base)
    return { updated: true, settings: saved.EjsTemplate }
  }

  // Common variable/display writes keep their native row indices and exact revision.
  // Stale versions and body/swipe edits retain the full three-way merge below.
  async function saveTemplatePatch(sessionId, request) {
    if(!options.resolveChatSlice || !options.patchChat || !Array.isArray(request?.changes))return undefined
    const allowed=['variables','variables_initialized','is_ejs_processed','template_display','template_rendered']
    if(request.changes.some(c=>!Array.isArray(c.path) || !(c.path[0]==='chat_metadata' || c.path[0]==='chat' && Number.isSafeInteger(c.path[1]) && c.path[1]>=0 && allowed.includes(c.path[2]))))return undefined
    const indices=[...new Set(request.changes.filter(c=>c.path[0]==='chat').map(c=>c.path[1]))].sort((a,b)=>a-b)
    const head=await options.resolveChatSlice(sessionId,[])
    if(!head?.denseMessages || head.chat._storageRevision!==request.stateRevision)return undefined
    const virtual=head.chat.promptTemplateInput?.message ? head.messageCount : -1
    if(indices.some(i=>i>=head.messageCount && i!==virtual))return undefined
    const storedIndices=indices.filter(i=>i<head.messageCount)
    const selected=storedIndices.length ? await options.resolveChatSlice(sessionId,storedIndices) : head
    if(!selected?.denseMessages || selected.chat._storageRevision!==request.stateRevision)return undefined
    const projectedIndices=[...storedIndices,...(virtual>=0?[virtual]:[])]
    const baseline=selected.chat
    assertTemplateChat(baseline)
    if(settlementTransactions.has(str(sessionId)))throw new Error('MVU 结算进行中，模板存档不能覆盖结算事务')
    const compact={...request,changes:request.changes.map(c=>c.path[0]==='chat'?{...c,path:['chat',projectedIndices.indexOf(c.path[1]),...c.path.slice(2)]}:c)}
    const expanded=expandFullPromptTemplatePatch(baseline,compact)
    const next=applyFullPromptTemplateState(baseline,baseline,expanded)
    // No body rewrites on this path: native message history needs no resynchronization.
    const changes=diffJson(baseline,next).map(c=>c.path[0]==='messages'?{...c,path:['messages',storedIndices[c.path[1]],...c.path.slice(2)]}:c)
    const saved=await options.patchChat(baseline.id,request.stateRevision,changes,{source:'prompt-template.state',assertCurrent:()=>{if(settlementTransactions.has(str(sessionId)))throw new Error('MVU 结算进行中，模板存档不能覆盖结算事务')}})
    if(!saved)return undefined
    const receipt=diffJson(expanded,{...projectFullPromptTemplateState(next),stateRevision:saved._storageRevision})
    return {updated:true,statePatch:receipt.map(c=>c.path[0]==='chat'?{...c,path:['chat',projectedIndices[c.path[1]],...c.path.slice(2)]}:c)}
  }

  async function saveFullPromptTemplateState(sessionId, request) {
    const fast=await saveTemplatePatch(sessionId,request)
    if(fast)return fast
    const patch = Array.isArray(request?.changes)
    if (!patch) validateFullPromptTemplateSave(request)
    const chat = await resolveChat(sessionId)
    assertTemplateChat(chat)
    if (!options.readChatRevision || !options.updateChat) throw new Error('模板原生存储未连接')
    if (settlementTransactions.has(str(sessionId))) throw new Error('MVU 结算进行中，模板存档不能覆盖结算事务')
    const baseline = await options.readChatRevision(chat.id, request.stateRevision)
    if (patch) request = expandFullPromptTemplatePatch(baseline, request)
    const saved = await options.updateChat(chat.id, async latest => {
      assertTemplateChat(latest)
      if (settlementTransactions.has(str(sessionId))) throw new Error('MVU 结算进行中，模板存档不能覆盖结算事务')
      if (str(latest.sessionId) !== str(sessionId)) throw new Error('模板聊天已切换')
      const next = applyFullPromptTemplateState(latest, baseline, request)
      return options.prepareTemplateHistory ? await options.prepareTemplateHistory(latest, next) : next
    }, { source: 'prompt-template.state' })
    if (!saved) throw new Error('模板聊天已不存在')
    await options.synchronizeTemplateHistory?.(saved)
    const state = projectFullPromptTemplateState(saved)
    return patch ? {updated:true,statePatch:diffJson(request,state)} : {updated:true,state}
  }

  async function saveExtensionSettings(sessionId, settings, expectedSettings) {
    await assertScriptEnabled(await resolveChat(sessionId))
    if (!options.extensionSettings) throw new Error('插件设置存储未连接')
    const extensionSettings = await observeResourceSave(resourceSaveSummary('regex', 'global', expectedSettings?.regex, settings?.regex, true), () => options.extensionSettings.save(settings, expectedSettings), summary => options.recordResourceSave?.(sessionId, summary))
    if (typeof options.extensionSettingsChanged === 'function') await options.extensionSettingsChanged(str(sessionId))
    return { updated: true, extensionSettings }
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
    // Context preparation can await I/O before MVU has queued its dispatch.
    // Respect that reservation just as dispatch respects an executing event.
    if (settlementTransactions.has(str(input.sessionId))) return { handled: false, busy: true, args: structuredClone(input.args || []) }
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
    // resolveChat awaited above: another attempt may have reserved this session
    // in the meantime. Never overwrite its draft or release its ownership.
    if (settlementTransactions.has(sessionId)) throw new Error('当前对话已有 MVU 变量结算正在执行')
    const originalText = str((message.swipes && message.swipes[swipeId]) ?? message.sourceText ?? message.text)
    const transaction = {
      draft: structuredClone(current),
      eventId: 'mvu-work:' + randomUUID(),
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
      const eventContext = await context(sessionId, transaction.draft)
      const projected = eventContext.messages[messageId]
      if (!projected) throw new Error('MVU 变量结算投影楼层不存在')
      // Upstream MVU reads the previous valid floor as its update baseline.
      // Override only the dispatch projection; historical floors stay untouched.
      if (input.baselineVariables) {
        const prior = eventContext.messages.slice(0, messageId).findLast(item => item.variables?.stat_data !== undefined && item.variables?.schema !== undefined)
        if (prior) prior.variables = structuredClone(input.baselineVariables)
      }
      const internalText = str(input.storyText).trim() + '\n\n' + command
      // 第二阶段（M2/M3）：变量应用进程内执行——官方核心移植版（mvu-update-core）直接
      // 应用到事务草稿的目标楼层，浏览器引擎的认领/租约/回执跨公网链路整体退役。
      await record('runtime-dispatch', { mode: 'server' })
      const draftMessage = transaction.draft.messages[messageId]
      if (!draftMessage || typeof draftMessage !== 'object') throw new Error('MVU 变量结算楼层不存在')
      if (!Array.isArray(draftMessage.variables)) draftMessage.variables = []
      while (draftMessage.variables.length <= swipeId) draftMessage.variables.push({})
      const priorFloorVariables = draftMessage.variables[swipeId]
      const mvuData = {
        initialized_lorebooks:
          (input.baselineVariables && input.baselineVariables.initialized_lorebooks) ||
          (priorFloorVariables && priorFloorVariables.initialized_lorebooks) || {},
        stat_data:
          (input.baselineVariables && input.baselineVariables.stat_data !== undefined)
            ? structuredClone(input.baselineVariables.stat_data)
            : (priorFloorVariables && priorFloorVariables.stat_data !== undefined
                ? structuredClone(priorFloorVariables.stat_data)
                : {}),
        schema:
          (input.baselineVariables && input.baselineVariables.schema !== undefined)
            ? structuredClone(input.baselineVariables.schema)
            : (priorFloorVariables && priorFloorVariables.schema !== undefined
                ? structuredClone(priorFloorVariables.schema)
                : { type: 'object', properties: {}, extensible: true }),
      }
      try {
        await mvuUpdateCore.updateVariables(command, mvuData)
      } catch (error) {
        await record('runtime-error', { error: str(error && error.message || error) })
        const validation = { changes: [], sideEffects: [], failures: [{ message: str(error && error.message || error) }] }
        return { updated: false, rejected: true, retryable: false, validation,
          diagnostics: [{ kind: 'server-engine', level: 'error', message: str(error && error.message || error) }],
          context: projectTavernHelperContext(current) }
      }
      // 应用结果（含 display_data/delta_data 镜像）写回事务草稿的目标楼层
      draftMessage.variables[swipeId] = mvuData
      const dispatched = { handled: true, mode: 'server' }
      await record('runtime-completed', { handled: true, mode: 'server' })
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
      if (input.preserveForeground === true) {
        for (const key of ['swipes', 'sourceText', 'projectionText', 'text', 'sessionText', 'displayText']) {
          if (Object.hasOwn(message, key)) settled[key] = structuredClone(message[key])
          else delete settled[key]
        }
      }
      const beforeVariables = input.baselineVariables || projectTavernHelperContext(current).messages[messageId].variables
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
    updatePrompts,
    updateVariables,
    updateMessages,
    createMessages,
    getWorldbook,
    replaceWorldbook,
    readFullPromptTemplateState,
    saveFullPromptTemplateState,
    saveFullPromptTemplateSettings,
    readGlobalPromptTemplateSettings,
    saveGlobalPromptTemplateSettings,
    saveFullPromptTemplateGlobals,
    saveExtensionSettings,
    saveChatData,
    loadWorldInfo,
    saveWorldInfo,
    claimWork: function (sessionId, runtimeId, ready, initializationError) { return options.scriptDispatch.claim(sessionId, runtimeId, ready, initializationError) },
    startWork: function (sessionId, eventId, leaseToken, runtimeId) { return options.scriptDispatch.start(sessionId, eventId, leaseToken, runtimeId) },
    workState: function (sessionId, eventId, leaseToken, runtimeId, keepAlive) { return options.scriptDispatch.workState(sessionId, eventId, leaseToken, runtimeId, keepAlive) },
    heartbeatRuntime: function (sessionId, runtimeId, ready, initializationError) { return { active: options.scriptDispatch.touch(sessionId, runtimeId, ready, initializationError) } },
    completeEvent: function (sessionId, eventId, args, runtimeId, leaseToken, error, diagnostics) { return options.scriptDispatch.complete(sessionId, eventId, args, runtimeId, leaseToken, error, diagnostics) },
    releaseRuntime: function (sessionId, runtimeId) { return options.scriptDispatch.dispose(sessionId, runtimeId) }
  })
}
