import { createMvuSettlementTransactions, mutationIsCurrent } from './mvu-settlement-transactions.js'
import { applyRegexOverrides } from './regex-manager.js'
import { templateStateFields } from './template-window-reader.js'
import { createScopedMessages } from './scoped-messages.js'
import { diffJson } from './json-mutation.js'
import { createFullPromptTemplateSync } from './full-prompt-template-sync.js'
import { createJsonValueProjectionCache } from './immutable-json-projection.js'
import { resourceSaveSummary, observeResourceSave } from './resource-save-summary.js'
import { projectFullPromptTemplateState, applyFullPromptTemplateState, validateFullPromptTemplateSave, expandFullPromptTemplatePatch } from './full-prompt-template-state.js'
import { mutateScriptPrompts } from './tavern-script-prompts.js'
import { exportSillyTavernWorldBook, inspectWorldBookDocument, updateWorldBookDocument } from './worldbook-resource.js'
import { worldbookContentDigest } from './worldbook-version.js'
import { isDeepStrictEqual } from 'node:util'
import { applyChatPluginData, validateChatPluginRequest, assertPluginJson } from './tavern-chat-plugin-data.js'
import {
  appendTavernHelperMessages,
  lastTavernHelperVariables,
  projectTavernHelperContext,
  projectTavernHelperMessage,
  replaceTavernHelperMessages,
  replaceTavernHelperVariables
} from './tavern-helper-context.js'
import {
  patchTavernHelperWorldbookEntries,
  projectTavernHelperWorldbook,
  replaceTavernHelperWorldbookOperations,
  tavernHelperWorldbookChanges,
  tavernHelperWorldbookVersion
} from './tavern-helper-worldbook.js'

// The fast template patch lost its revision race to another write: worth retrying.
const TEMPLATE_PATCH_CONFLICT = Symbol('template patch conflict')

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function isOfficialMvuData(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && value.stat_data !== undefined && value.schema !== undefined
}

/**
 * Translate the Tavern-shaped host API exposed to card scripts into mutations
 * of dsh-tavern's authoritative chat and worldbook state.
 */
export function createTavernScriptHostAdapter(options = {}) {
  const syncTemplateState = createFullPromptTemplateSync()
  const templateCharacters = createJsonValueProjectionCache({ capacity: 8, maxBytes: 64 * 1024 * 1024 })
  const mutationTails = new Map()
  // A library book reaches the game's view of it a little after a write. Until the game's
  // save moves past the revision the write started from, reads and writes start from what was written.
  const writtenWorldbooks = new Map()
  const settlement = createMvuSettlementTransactions({
    resolveChat, resolveSettlementBase: options.resolveSettlementBase,
    resolveChatSlice: options.resolveChatSlice, resolveChangedChatSlice: options.resolveChangedChatSlice,
    scriptDispatch: options.scriptDispatch, diagnostics: options.diagnostics, context,
    readGlobalVariables: () => options.globalVariables.read()
  })
  const { ensureRows, fullContext, mutationChat, result: transactionResult } = settlement
  // The regex a saved reply's text was projected with; Helper rewrites reuse it (reply-prose.js).
  const replyProjection = async chat => ({ regexScripts: options.replyRegexScripts ? await options.replyRegexScripts(chat) : [] })
  function assertDependencies() {
    for (const name of ['resolveChat', 'writeChat', 'readCard', 'worldBooks', 'scriptDispatch']) {
      if (!options[name]) throw new Error('Tavern Script Host Adapter 缺少依赖: ' + name)
    }
  }
  assertDependencies()

  async function assertScriptEnabled(chat) {
    if (typeof options.isPlayChat === 'function' && !options.isPlayChat(chat)) throw new Error('当前会话没有绑定游玩对话')
    if (chat?.mvu?.enabled === true) return
    if (typeof options.hasScripts !== 'function' || !await options.hasScripts(chat)) throw new Error('当前人物卡没有启用脚本运行时')
  }

  async function staleMutation(chat) {
    return { updated: false, stale: true, context: await fullContext(chat) }
  }

  async function resolveChat(sessionId) {
    const chat = await options.resolveChat(str(sessionId))
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    return chat
  }

  async function updatePrompts(sessionId, operation, expectedLifecycleRevision, eventId) {
    return serializeWorldbook('script-prompts:' + sessionId, async function () {
      const chat = await mutationChat(sessionId, eventId)
      await assertScriptEnabled(chat)
      if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(chat)
      if (!mutateScriptPrompts(chat, operation)) return { updated: false, context: await fullContext(chat) }
      const transactional = await transactionResult(sessionId, { type: 'prompts' }, false, eventId)
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
      return { updated: true, context: await fullContext(chat) }
    })
  }

  async function updateVariables(sessionId, option, variables, expectedLifecycleRevision, eventId, contextBaseline) {
    return serializeWorldbook('variables:' + sessionId, () => updateVariablesNow(sessionId, option, variables, expectedLifecycleRevision, eventId, contextBaseline))
  }

  async function variableMutationSlice(sessionId, option, expectedLifecycleRevision, eventId, baseline) {
    settlement.assertEvent(sessionId, eventId)
    if (!baseline || !options.patchChat || !options.resolveChatSlice || !options.readChatRevision || settlement.has(str(sessionId))
      || !['message','chat','script'].includes(option?.type)) return null
    const fields = ['id','sessionId','_storageRevision','tavernHelperLifecycleRevision','mode','cardPath','mvu',
      ...(option.type === 'chat' ? ['variables', 'macroState'] : option.type === 'script' ? ['tavernHelperScriptVariables'] : [])]
    let selected = await options.resolveChatSlice(str(sessionId), [], fields)
    const matches = value => value?.denseMessages && value.chat.id === baseline.chatId
      && value.chat._storageRevision === baseline.stateRevision
      && (value.chat.tavernHelperLifecycleRevision || 0) === baseline.lifecycleRevision
      && mutationIsCurrent(value.chat, expectedLifecycleRevision) && value.chat.mvu?.enabled === true
    if (!matches(selected)) return null
    let messageId
    if (option.type === 'message') {
      const raw = option.message_id === undefined || option.message_id === null || option.message_id === 'latest' ? -1 : Number(option.message_id)
      messageId = raw < 0 ? selected.messageCount + raw : raw
      if (!Number.isInteger(messageId) || messageId < 0 || messageId >= selected.messageCount) return null
      const count = selected.messageCount
      selected = await options.resolveChatSlice(str(sessionId), [messageId], fields)
      if (!matches(selected) || selected.messageCount !== count || !selected.chat.messages?.[0]) return null
    }
    if (settlement.has(str(sessionId))) return null
    selected.chat.messages = createScopedMessages(selected.messageCount, messageId === undefined ? [] : [[messageId,selected.chat.messages[0]]])
    return { chat:selected.chat, messageId }
  }

  async function updateVariablesNow(sessionId, option, variables, expectedLifecycleRevision, eventId, contextBaseline, allowSlice = true, fallbackChat) {
    const scoped = allowSlice ? await variableMutationSlice(sessionId, option, expectedLifecycleRevision, eventId, contextBaseline) : null
    // Global/card variables live outside Chat history. Validate the same
    // lifecycle and script permissions from the header, without decoding messages.
    let resourceHeader
    if (['global','character'].includes(option?.type) && !settlement.has(str(sessionId))) {
      settlement.assertEvent(sessionId, eventId)
      resourceHeader = await options.resolveChatSlice?.(str(sessionId), [], 'settlement')
    }
    const chat = scoped?.chat || resourceHeader?.chat || fallbackChat || await mutationChat(sessionId, eventId)
    await assertScriptEnabled(chat)
    if (scoped && settlement.has(str(sessionId))) return updateVariablesNow(sessionId, option, variables, expectedLifecycleRevision, eventId, contextBaseline, false)
    if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(resourceHeader ? await resolveChat(sessionId) : chat)
    if (option && option.type === 'global') {
      if (!options.globalVariables || typeof options.globalVariables.save !== 'function') throw new Error('全局变量存储未连接')
      const transactional = await settlement.updateGlobals(sessionId, variables)
      if (transactional) return transactional
      const saved = await options.globalVariables.save(variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {})
      return { updated: true, target: { type: 'global' }, globalVariables: structuredClone(saved) }
    }
    if (option && option.type === 'character') {
      if (!options.characterVariables || typeof options.characterVariables.save !== 'function') throw new Error('人物卡变量存储未连接')
      if (settlement.has(sessionId)) throw new Error('MVU 结算事务不能修改跨对话的人物卡变量')
      const saved = await serializeWorldbook('card-variables:' + str(chat.cardPath), function () {
        return options.characterVariables.save(chat.cardPath, variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {}, str(sessionId))
      })
      return { updated: true, target: { type: 'character' }, characterVariables: structuredClone(saved) }
    }
    const canPatch = options.patchChat && Number.isSafeInteger(chat._storageRevision) && chat._storageRevision > 0
      && !settlement.has(str(sessionId))
    // Capture references to replaced values, not copies of the entire history.
    // Message variable arrays are mutated in place by the compatibility API.
    const before = canPatch ? {
      variables: chat.variables,
      macroState: chat.macroState,
      scripts: chat.tavernHelperScriptVariables && { ...chat.tavernHelperScriptVariables },
      messages: scoped ? (scoped.messageId === undefined ? {} : { [scoped.messageId]: Array.isArray(chat.messages[scoped.messageId].variables) ? chat.messages[scoped.messageId].variables.slice() : chat.messages[scoped.messageId].variables }) : option?.type === 'message' ? (chat.messages || []).map(message =>
        Array.isArray(message?.variables) ? message.variables.slice() : message?.variables) : []
    } : null
    const baseRevision = chat._storageRevision
    const compact = canPatch && contextBaseline?.chatId === chat.id
      && contextBaseline.stateRevision === baseRevision
      && contextBaseline.lifecycleRevision === (chat.tavernHelperLifecycleRevision || 0)
      && (scoped || (chat.messages || []).every(message => message && typeof message === 'object'))
    let patched = false
    if (!option?.type || option.type === 'message') await settlement.touchMessage(sessionId, option?.message_id, eventId)
    const updated = replaceTavernHelperVariables(chat, { option, variables })
    const transactional = await transactionResult(sessionId, updated, false, eventId)
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
        if (updated.type === 'chat' && chat.macroState !== before.macroState) {
          changes.push(...diffJson(before.macroState, chat.macroState).map(change => ({ ...change, path: ['macroState', ...change.path] })))
        }
        saved = await options.patchChat(chat.id, chat._storageRevision, changes, {
          source: 'tavern-helper.variables',
          assertCurrent: () => settlement.assertEvent(sessionId, eventId)
        })
        if (saved) {
          patched = true
          const { messages: _messages, ...header } = saved
          Object.assign(chat, header)
          if (updated.type === 'message') chat.messages[updated.messageId].variables = normalized
        }
      }
      // A competing revision needs the existing three-way merge/conflict checks.
      if (!saved && scoped) {
        settlement.assertEvent(sessionId, eventId)
        const baseline = await options.readChatRevision(chat.id, baseRevision)
        if (!baseline) { const error = new Error('变量写入基线已失效');error.code = 'DSH_TAVERN_CHAT_CONFLICT';throw error }
        return updateVariablesNow(sessionId, option, variables, expectedLifecycleRevision, eventId, contextBaseline, false, baseline)
      }
      if (!saved) await options.writeChat(chat, { source: 'tavern-helper.variables' })
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
    return { updated: true, target: updated, context: await fullContext(chat) }
  }

  async function updateMessages(sessionId, messages, expectedLifecycleRevision, eventId) {
    const chat = await mutationChat(sessionId, eventId)
    await assertScriptEnabled(chat)
    if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(chat)
    const patches = await settlement.prepareMessages(sessionId, messages, eventId)
    const updated = replaceTavernHelperMessages(chat, patches, await replyProjection(chat))
    if (chat.mvu && chat.mvu.owner === 'official') {
      const opening = Array.isArray(chat.messages) ? chat.messages[0] : null
      const snapshots = opening && Array.isArray(opening.variables) ? opening.variables : []
      if (snapshots.length > 0 && snapshots.every(isOfficialMvuData)) {
        chat.mvu.openingInitialization = { version: 2, status: 'complete', completedAt: Date.now() }
      }
    }
    const transactional = await transactionResult(sessionId, updated, true, eventId)
    if (transactional !== null) return transactional
    try { await options.writeChat(chat, { source: 'tavern-helper.messages' }) }
    catch (error) {
      if (error && error.code === 'DSH_TAVERN_CHAT_CONFLICT') {
        const latest = await options.resolveChat(str(sessionId))
        if (latest !== undefined && !mutationIsCurrent(latest, expectedLifecycleRevision)) return staleMutation(latest)
      }
      throw error
    }
    return { updated: true, targets: updated, context: await fullContext(chat) }
  }

  async function createMessages(sessionId, messages, option, expectedLifecycleRevision, eventId) {
    settlement.assertEvent(sessionId, eventId)
    if (settlement.has(sessionId)) throw new Error('MVU 结算事务不能创建额外聊天楼层')
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
    return { updated: true, targets: created, context: await fullContext(chat) }
  }

  async function worldbookRecord(sessionId, requestedName, template = false, suppliedChat, readOnly = false) {
    const selected = readOnly && !suppliedChat && await options.resolveChatSlice?.(sessionId, [], 'settlement')
    const chat = suppliedChat || selected?.chat || await resolveChat(sessionId)
    if (template) assertTemplateChat(chat); else await assertScriptEnabled(chat)
    const card = await options.readCard(chat)
    const record = await options.worldBooks.bound(chat.cardPath, card, chat)
    if (record === null) throw new Error('当前人物卡没有绑定世界书')
    const name = str(requestedName).trim()
    if (name !== '' && name !== 'current' && name !== str(record.view.displayName)) {
      throw new Error('当前兼容层只能访问人物卡绑定的世界书: ' + name)
    }
    const written = writtenWorldbooks.get(str(sessionId))
    if (written === undefined) return { chat, record }
    if (written.key === worldbookKey(record) && Number(chat._storageRevision) <= written.revision) return { chat, record: written.record }
    writtenWorldbooks.delete(str(sessionId))
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

  // The book's own entries as scripts see them; plugin entries the game adds per turn are not part of it.
  function scriptWorldbookVersion(record) {
    return tavernHelperWorldbookVersion(projectTavernHelperWorldbook({ entries: record.view.entries.filter(entry => !entry.plugin) }).entries)
  }

  async function getWorldbook(sessionId, name, template = false, knownVersion) {
    const resolved = await worldbookRecord(sessionId, name, template, undefined, true)
    const version = scriptWorldbookVersion(resolved.record)
    const worldbook = projectTavernHelperWorldbook(resolved.record.view)
    // A script that already holds this version keeps its copy; a large book is not sent again.
    if (knownVersion !== undefined && knownVersion === version) return { worldbook: { name: worldbook.name, version, unchanged: true } }
    return { worldbook: { ...worldbook, version } }
  }

  async function writeWorldbook(sessionId, name, template, requestedFrom) {
    const initial = await worldbookRecord(sessionId, name, template)
    return await serializeWorldbook(worldbookKey(initial.record), async function () {
      const resolved = await worldbookRecord(sessionId, name, template)
      if (worldbookKey(resolved.record) !== worldbookKey(initial.record)) throw new Error('世界书绑定已变化，请重新读取后重试')
      const before = projectTavernHelperWorldbook(resolved.record.view).entries
      const entries = requestedFrom(before, scriptWorldbookVersion(resolved.record))
      const operations = replaceTavernHelperWorldbookOperations(resolved.record.view, entries)
      if (settlement.has(sessionId) && operations.length > 0) throw new Error('MVU 结算事务不能修改跨存储的世界书')
      const updated = operations.length === 0
        ? resolved.record
        : await observeResourceSave(resourceSaveSummary('worldbook', resolved.record.localChatId ? 'session' : resolved.record.source.kind === 'card' ? 'card' : 'worldbook', before, entries), () => updateBoundWorldbook(resolved, { operations }), summary => options.recordResourceSave?.(sessionId, summary))
      // A saved book comes back without the plugin entries the game adds on top; keep them as a read shows them.
      const plugins = updated === resolved.record ? [] : resolved.record.view.entries.filter(entry => entry.plugin)
      const version = scriptWorldbookVersion(updated)
      const revision = Number(resolved.chat?._storageRevision)
      if (operations.length > 0 && Number.isFinite(revision)) writtenWorldbooks.set(str(sessionId), { key: worldbookKey(updated), revision, record: { ...updated, view: { ...updated.view, entries: [...updated.view.entries, ...plugins] } } })
      return { updated: operations.length > 0, before, version, worldbook: projectTavernHelperWorldbook({ ...updated.view, entries: [...updated.view.entries, ...plugins] }) }
    })
  }

  async function replaceWorldbook(sessionId, name, entries, expectedEntries, template = false) {
    const result = await writeWorldbook(sessionId, name, template, function (before) {
      if (expectedEntries !== undefined && JSON.stringify(before) !== JSON.stringify(expectedEntries)) throw new Error('世界书已被其他操作修改，请重新读取后重试')
      return entries
    })
    return { updated: result.updated, worldbook: result.worldbook }
  }

  /** Write only the changed entries; the version read earlier stands in for the whole expected book. */
  async function patchWorldbook(sessionId, name, patch, template = false) {
    const result = await writeWorldbook(sessionId, name, template, function (before, version) {
      if (version !== str(patch && patch.version)) throw new Error('世界书已被其他操作修改，请重新读取后重试')
      return patchTavernHelperWorldbookEntries(before, patch)
    })
    const after = result.worldbook.entries
    return { updated: result.updated, worldbook: { name: result.worldbook.name, version: result.version, ...tavernHelperWorldbookChanges(result.before, after) } }
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
    const snapshot = {
      ...(resolved.chat.openingWorldbookSnapshot || { version: 1, source: structuredClone(resolved.record.source) }), document
    }
    // Pin the library version this write started from. Automatic refresh must not
    // treat the script's own entry as a library edit and undo it next turn.
    if (snapshot.libraryDigest === undefined) {
      snapshot.libraryDigest = worldbookContentDigest({ source: resolved.record.source, document: resolved.record.document })
    }
    resolved.chat.openingWorldbookSnapshot = snapshot
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
    const resolved = await worldbookRecord(sessionId, name, false, undefined, true)
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
      if (settlement.has(sessionId)) throw new Error('MVU 结算事务不能修改跨存储的世界书')
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
    if (settlement.has(str(sessionId))) throw new Error('临时 MVU 结算期间不能保存聊天插件数据，请稍后重试')
    const baselines = new Map(await Promise.all(revisions.map(async revision => [revision, await options.readChatRevision(chat.id, revision)])))
    const saved = await options.updateChat(chat.id, async function (latest) {
      await assertScriptEnabled(latest)
      if (latest.sessionId && str(latest.sessionId) !== str(sessionId)) throw new Error('聊天绑定已变化，插件数据未保存')
      if (settlement.has(str(sessionId))) throw new Error('临时 MVU 结算期间不能保存聊天插件数据，请稍后重试')
      return applyChatPluginData(latest, baselines, request)
    }, { source: 'tavern-helper.chat-plugin-data' })
    if (!saved) throw new Error('聊天已不存在，插件数据未保存')
    return { updated: true, context: await fullContext(saved) }
  }

  function assertTemplateChat(chat) {
    if (!chat || !['story', 'script'].includes(chat.mode) || (typeof options.isPlayChat === 'function' && !options.isPlayChat(chat))) throw new Error('当前会话没有绑定游玩对话')
  }

  async function readFullPromptTemplateState(sessionId, cursor, windowed = false) {
    const window = windowed ? await options.resolveTemplateWindow?.(sessionId) : undefined
    const selected=!window && await (options.resolveChatMetadataSlice?.(sessionId) ?? options.resolveChatSlice?.(sessionId,[]))
    const reuse=selected?.denseMessages && syncTemplateState.matches(cursor,selected.chat)
    const reader = syncTemplateState.reader(cursor)
    let changed = !reuse && selected?.denseMessages && reader?.chatId === selected.chat.id
      && reader.sessionId === selected.chat.sessionId
      && reader.lifecycle === (selected.chat.tavernHelperLifecycleRevision || 0)
      ? await options.resolveChangedChatSlice?.(sessionId, reader.revision, templateStateFields) : undefined
    if (!changed?.denseMessages || changed.chat.id !== reader?.chatId
      || changed.chat.sessionId !== reader?.sessionId
      || (changed.chat.tavernHelperLifecycleRevision || 0) !== reader?.lifecycle) changed = undefined
    const chat = window?.chat || (reuse ? selected.chat : changed ? changed.chat : await resolveChat(sessionId))
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
        dsh: { settling: settlement.has(str(sessionId)) || ['pending', 'running'].includes(chat.settleStatus), cardPath: chat.cardPath, model: options.modelFor ? await options.modelFor(chat) : chat.model?.model || chat.model || '', regexScripts: [...applyRegexOverrides(await options.presetRegexScripts?.(chat) || [], chat.regexOverrides && chat.regexOverrides.preset, 'preset'), ...applyRegexOverrides(card.extensions?.regex_scripts || [], chat.regexOverrides && chat.regexOverrides.card, 'card')] } }
    }
    if (window) return {...snapshot,historyWindow:window.historyWindow}
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
    assertTemplateChat(await resourcePermissionChat(sessionId))
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
    assertTemplateChat(await resourcePermissionChat(sessionId))
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
    if(!head?.denseMessages)return undefined
    const revision=head.chat._storageRevision, stale=revision!==request.stateRevision
    // A reader behind the latest revision merges only the floors it edits plus the
    // floors changed since its read, against those floors as they were then. The
    // receipt then carries every change since its read, as a complete merge would.
    const changed=stale ? await options.resolveChangedIndices?.(sessionId,request.stateRevision) : {indices:[],revision}
    if(!changed || changed.revision!==revision)return undefined
    const virtual=head.chat.promptTemplateInput?.message ? head.messageCount : -1
    const lengthConflict=async()=>{
      // The complete merge refuses a reader whose history length differs; say so
      // without reading the whole history first.
      const read=await options.resolveChatSliceAt?.(sessionId,request.stateRevision,[])
      const length=chat=>chat.messageCount+(chat.chat.promptTemplateInput?.message?1:0)
      if(!read || read.chat._storageRevision!==request.stateRevision || length(read)===length(head))return false
      const error=new Error('聊天楼层已变化，模板存档未保存')
      error.code='PROMPT_TEMPLATE_STATE_CONFLICT'
      throw error
    }
    if(indices.some(i=>i>=head.messageCount && i!==virtual) || changed.indices.some(i=>i>=head.messageCount)){
      if(stale)await lengthConflict()
      return undefined
    }
    const storedIndices=[...new Set([...indices.filter(i=>i<head.messageCount),...changed.indices])].sort((a,b)=>a-b)
    const selected=storedIndices.length ? await options.resolveChatSlice(sessionId,storedIndices) : head
    if(!selected?.denseMessages || selected.chat._storageRevision!==revision)return undefined
    const before=stale ? await options.resolveChatSliceAt?.(sessionId,request.stateRevision,storedIndices) : selected
    if(!before?.denseMessages || before.chat._storageRevision!==request.stateRevision)return undefined
    if(stale && before.messageCount!==head.messageCount){
      await lengthConflict()
      return undefined
    }
    const projectedIndices=[...storedIndices,...(virtual>=0?[virtual]:[])]
    const baseline=before.chat, latest=selected.chat
    assertTemplateChat(latest)
    if(settlement.has(str(sessionId)))throw new Error('MVU 结算进行中，模板存档不能覆盖结算事务')
    const compact={...request,changes:request.changes.map(c=>c.path[0]==='chat'?{...c,path:['chat',projectedIndices.indexOf(c.path[1]),...c.path.slice(2)]}:c)}
    const expanded=expandFullPromptTemplatePatch(baseline,compact)
    const next=applyFullPromptTemplateState(latest,baseline,expanded,await replyProjection(latest))
    // No body rewrites on this path: native message history needs no resynchronization.
    const changes=diffJson(latest,next).map(c=>c.path[0]==='messages'?{...c,path:['messages',storedIndices[c.path[1]],...c.path.slice(2)]}:c)
    const saved=await options.patchChat(latest.id,revision,changes,{source:'prompt-template.state',assertCurrent:()=>{if(settlement.has(str(sessionId)))throw new Error('MVU 结算进行中，模板存档不能覆盖结算事务')}})
    if(!saved)return TEMPLATE_PATCH_CONFLICT
    const receipt=diffJson(expanded,{...projectFullPromptTemplateState(next),stateRevision:saved._storageRevision})
    return {updated:true,statePatch:receipt.map(c=>c.path[0]==='chat'?{...c,path:['chat',projectedIndices[c.path[1]],...c.path.slice(2)]}:c)}
  }

  async function saveFullPromptTemplateState(sessionId, request) {
    // A background write landing between the fast path's read and its patch only moves the
    // revision: the fast path merges from the reader's revision, so retry it before falling
    // back to the complete merge, which reads the whole history.
    for(let attempt=0;attempt<3;attempt++){
      const fast=await saveTemplatePatch(sessionId,request)
      if(fast!==TEMPLATE_PATCH_CONFLICT){if(fast)return fast;break}
    }
    const patch = Array.isArray(request?.changes)
    if (!patch) validateFullPromptTemplateSave(request)
    const chat = await resolveChat(sessionId)
    assertTemplateChat(chat)
    if (!options.readChatRevision || !options.updateChat) throw new Error('模板原生存储未连接')
    if (settlement.has(str(sessionId))) throw new Error('MVU 结算进行中，模板存档不能覆盖结算事务')
    const baseline = await options.readChatRevision(chat.id, request.stateRevision)
    if (patch) request = expandFullPromptTemplatePatch(baseline, request)
    const projection = await replyProjection(chat)
    const saved = await options.updateChat(chat.id, async latest => {
      assertTemplateChat(latest)
      if (settlement.has(str(sessionId))) throw new Error('MVU 结算进行中，模板存档不能覆盖结算事务')
      if (str(latest.sessionId) !== str(sessionId)) throw new Error('模板聊天已切换')
      const next = applyFullPromptTemplateState(latest, baseline, request, projection)
      return options.prepareTemplateHistory ? await options.prepareTemplateHistory(latest, next) : next
    }, { source: 'prompt-template.state' })
    if (!saved) throw new Error('模板聊天已不存在')
    await options.synchronizeTemplateHistory?.(saved)
    const state = projectFullPromptTemplateState(saved)
    return patch ? {updated:true,statePatch:diffJson(request,state)} : {updated:true,state}
  }

  async function resourcePermissionChat(sessionId) {
    return (await options.resolveChatSlice?.(str(sessionId), [], 'settlement'))?.chat || await resolveChat(sessionId)
  }

  async function saveExtensionSettings(sessionId, settings, expectedSettings) {
    await assertScriptEnabled(await resourcePermissionChat(sessionId))
    if (!options.extensionSettings) throw new Error('插件设置存储未连接')
    const extensionSettings = await observeResourceSave(resourceSaveSummary('regex', 'global', expectedSettings?.regex, settings?.regex, true), () => options.extensionSettings.save(settings, expectedSettings), summary => options.recordResourceSave?.(sessionId, summary))
    if (typeof options.extensionSettingsChanged === 'function') await options.extensionSettingsChanged(str(sessionId))
    return { updated: true, extensionSettings }
  }

  async function context(sessionId, chatValue, transientUserText = '', indices) {
    const selected = !chatValue && !transientUserText && !indices ? await options.resolveHelperContext?.(sessionId) : undefined
    const chat = chatValue || selected?.chat || await resolveChat(sessionId)
    await ensureRows(chat, transientUserText ? undefined : indices)
    const draft = { ...chat, messages: chat.messages || [] }
    const userText = str(transientUserText).trim()
    if (userText !== '') {
      const previousVariables = lastTavernHelperVariables(draft.messages)
      const message = { role: 'user', text: userText, swipeId: 0, swipes: [userText], variables: [] }
      if (previousVariables !== undefined) message.variables = [structuredClone(previousVariables)]
      draft.messages = draft.messages.concat(message)
    }
    const projected = selected?.context || projectTavernHelperContext(indices ? { ...draft, messages: [] } : draft)
    if (indices) {
      projected.messages = indices.map(i => projectTavernHelperMessage(draft.messages[i], i))
      // An indexed dispatch is allowed only when floor identity/turn mapping
      // did not change. Keep the browser's already complete turn index.
      delete projected.turnMessageIds
    }
    if (options.globalVariables && typeof options.globalVariables.read === 'function') {
      projected.globalVariables = await options.globalVariables.read()
    }
    try {
      const resolved = await worldbookRecord(sessionId, 'current', false, chat)
      projected.worldbook = projectTavernHelperWorldbook(resolved.record.view)
    } catch {}
    return projected
  }

  async function dispatchEvent(input = {}) {
    // `recent`: the browser keeps its history lease, so send the recent window
    // instead of projecting every floor into the event.
    const recent = !input.context && input.recent === true ? await options.resolveHelperWindow?.(input.sessionId) : undefined
    const eventContext = input.context || (recent ? { contextWindow: recent } : await context(input.sessionId, input.chat, input.transientUserText))
    // Context preparation can await I/O before MVU has queued its dispatch.
    // Respect that reservation just as dispatch respects an executing event.
    if (settlement.has(str(input.sessionId))) return { handled: false, busy: true, args: structuredClone(input.args || []) }
    return await options.scriptDispatch.dispatch(input.sessionId, input.name, input.args, eventContext)
  }

  return Object.freeze({
    context,
    dispatchEvent,
    settleMvuUpdate: settlement.settle,
    updatePrompts,
    updateVariables,
    updateMessages,
    createMessages,
    getWorldbook,
    replaceWorldbook,
    patchWorldbook,
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
    claimWork: function (sessionId, runtimeId, ready, initializationError, baseline) { return options.scriptDispatch.claimWithContext ? options.scriptDispatch.claimWithContext(sessionId, runtimeId, ready, initializationError, baseline) : options.scriptDispatch.claim(sessionId, runtimeId, ready, initializationError) },
    transactionContext: settlement.context,
    startWork: function (sessionId, eventId, leaseToken, runtimeId) { return options.scriptDispatch.start(sessionId, eventId, leaseToken, runtimeId) },
    workState: function (sessionId, eventId, leaseToken, runtimeId, keepAlive) { return options.scriptDispatch.workState(sessionId, eventId, leaseToken, runtimeId, keepAlive) },
    heartbeatRuntime: function (sessionId, runtimeId, ready, initializationError) { return { active: options.scriptDispatch.touch(sessionId, runtimeId, ready, initializationError) } },
    completeEvent: function (sessionId, eventId, args, runtimeId, leaseToken, error, diagnostics) { return options.scriptDispatch.complete(sessionId, eventId, args, runtimeId, leaseToken, error, diagnostics) },
    releaseRuntime: function (sessionId, runtimeId) { return options.scriptDispatch.dispose(sessionId, runtimeId) }
  })
}
