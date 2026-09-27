import { createScopedMessages } from './scoped-messages.js'
import { createMvuWorkingCopy, projectMvuReceipt } from './mvu-working-copy.js'
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
  projectTavernHelperMessage,
  replaceTavernHelperMessages,
  replaceTavernHelperVariables
} from './tavern-helper-context.js'
import {
  projectTavernHelperWorldbook,
  replaceTavernHelperWorldbookOperations
} from './tavern-helper-worldbook.js'
import { createMvuSettlementEffect } from './mvu-settlement-effect.js'
import * as mvuUpdateCore from './mvu/mvu-update-core.js'
import { projectTavernHelperScripts, classifyCardScript } from './tavern-helper-scripts.js'
import { getOrCreateRuntime, disposeRuntime } from './mvu/mvu-card-runtime.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// Pinned upstream src/function/update/index.ts throttles MESSAGE_RECEIVED at
// 3000ms. Re-entering sooner returns the old Promise and schedules a late write.
const MVU_RETRY_AFTER_MS = 3100

// ---------- M2 卡脚本服务端沙箱（派生值重算） ----------
// 卡片自带的辅助脚本在 node:vm 沙箱常驻：结算事务内触发 mag_variable_update_ended
// （钩子就地修改变量树，随事务一起提交）；提交完成后派发 MESSAGE_RECEIVED 兜底重算
// （脚本延迟读最新变量→重算→经宿主变量 API 写回，事务外 patch 落盘并镜像 SQLite）。
// MVU 核心 bundle 已由进程内引擎执行（isHostOwnedMvu 过滤），ESM import 型脚本缺远程
// 模块系统，两者都不进沙箱。
const MVU_SANDBOX_SLEEP = ms => new Promise(resolve => setTimeout(resolve, ms))

// Pinned upstream src/variable_def.ts variable_events.
const MVU_SANDBOX_EVENTS = {
  VARIABLE_INITIALIZED: 'mag_variable_initialized',
  VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
  COMMAND_PARSED: 'mag_command_parsed',
  VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
  BEFORE_MESSAGE_UPDATE: 'mag_before_message_update',
  SINGLE_VARIABLE_UPDATED: 'mag_variable_updated'
}

function deepMergeTavernVariables(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...(base && typeof base === 'object' ? base : {}) }
  for (const [key, value] of Object.entries(patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {})) {
    const current = out[key]
    out[key] = value !== null && typeof value === 'object' && !Array.isArray(value)
      && current !== null && typeof current === 'object' && !Array.isArray(current)
      ? deepMergeTavernVariables(current, value)
      : (value === undefined ? current : value)
  }
  return out
}

function sandboxMessageId(messages, value, fallback) {
  const raw = value === undefined || value === null || value === 'latest' ? -1 : Number(value)
  const messageId = raw < 0 ? messages.length + raw : raw
  if (!Number.isInteger(messageId) || messageId < 0 || messageId >= messages.length) return fallback
  return messageId
}

/**
 * Translate the Tavern-shaped host API exposed to card scripts into mutations
 * of dsh-tavern's authoritative chat and worldbook state.
 */
export function createTavernScriptHostAdapter(options = {}) {
  const syncTemplateState = createFullPromptTemplateSync()
  const templateCharacters = createJsonValueProjectionCache({ capacity: 8, maxBytes: 16 * 1024 * 1024 })
  const mutationTails = new Map()
  const settlementTransactions = new Map()
  const settlementReaders = new WeakMap()
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
    const selectedBase = await options.resolveSettlementBase?.(sessionId)
    if (selectedBase) {
      settlementReaders.set(selectedBase.chat, selectedBase)
      return selectedBase.chat
    }
    const cached = settlementBase
    if (cached?.sessionId === sessionId && options.resolveChatSlice && options.resolveChangedChatSlice) {
      const selected = await options.resolveChatSlice(sessionId, [])
      if (selected?.denseMessages && selected.chat.id === cached.id) {
        if (selected.chat._storageRevision === cached._storageRevision) return cached
        const changed = await options.resolveChangedChatSlice(sessionId, cached._storageRevision)
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
    if (options.resolveChatSlice && options.resolveChangedChatSlice) rememberSettlementBase(chat)
    return chat
  }

  function assertDependencies() {
    for (const name of ['resolveChat', 'writeChat', 'readCard', 'worldBooks', 'scriptDispatch']) {
      if (!options[name]) throw new Error('Tavern Script Host Adapter 缺少依赖: ' + name)
    }
  }
  assertDependencies()

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

  // 卡脚本沙箱：cardPath → { key, runtime }；cardPath → 派发期读写绑定。
  // 绑定覆盖 VARIABLE_UPDATE_ENDED（事务草稿）与 MESSAGE_RECEIVED 兜底（已提交快照）
  // 两个窗口；同卡新一轮结算会覆盖旧绑定（脚本重算幂等，语义无害）。
  const cardSandboxRuntimes = new Map()
  const sandboxBindings = new Map()
  // 玩家可见诊断缓冲（A.6.1）：沙箱加载/钩子/分派错误按卡收集，view 组装时并入
  // tavernHelperScriptDiagnostics 透出——服务端静默失败对玩家不再不可见。
  const cardScriptDiagnostics = new Map()
  function recordCardScriptDiagnostic(cardPath, entry) {
    const key = str(cardPath)
    if (key === '') return
    const list = cardScriptDiagnostics.get(key) || []
    list.push(Object.assign({ at: Date.now() }, entry))
    cardScriptDiagnostics.set(key, list.slice(-20))
  }

  function makeSandboxHostApi(cardPath) {
    const cloneJson = value => {
      try { return structuredClone(value) } catch { return value === undefined ? {} : JSON.parse(JSON.stringify(value)) }
    }
    const bindingOf = () => sandboxBindings.get(cardPath) || null
    // 未注入实现的酒馆助手 API：按空操作降级（不炸脚本），记录进玩家可见诊断（A.6.1 #4）。
    const unsupportedSeen = new Set()
    const unsupportedApi = name => (..._args) => {
      if (!unsupportedSeen.has(name)) {
        unsupportedSeen.add(name)
        recordCardScriptDiagnostic(cardPath, { scriptId: '', name: '卡脚本', status: 'warning', message: '卡脚本调用了暂不支持的宿主 API "' + name + '"，已按空操作处理，相关功能可能缺失' })
        console.warn('[mvu-sandbox] 卡脚本调用了未注入的宿主 API "' + name + '"，已按空操作处理')
      }
      return undefined
    }
    const variablesOf = (option = {}) => {
      const binding = bindingOf()
      if (!binding) return {}
      const chat = binding.chat
      const type = (option && option.type) || 'message'
      if (type === 'global') return {}
      if (type === 'chat') return cloneJson(chat.variables || {})
      if (type === 'script') {
        const id = str(option && option.script_id).trim()
        const saved = chat.tavernHelperScriptVariables
        return cloneJson(saved && Object.hasOwn(saved, id) && saved[id] && typeof saved[id] === 'object' ? saved[id] : {})
      }
      const messages = Array.isArray(chat.messages) ? chat.messages : []
      const wanted = option && option.message_id !== undefined ? option.message_id : binding.messageId
      const messageId = sandboxMessageId(messages, wanted, binding.messageId)
      if (messageId < 0 || messageId >= messages.length) return {}
      const message = messages[messageId]
      const swipeId = option && Object.hasOwn(option, 'swipe_id') ? Math.max(0, Number(option.swipe_id) || 0) : Math.max(0, Number(message.swipeId) || 0)
      const variables = Array.isArray(message.variables) ? message.variables[swipeId] : undefined
      return cloneJson(variables && typeof variables === 'object' ? variables : {})
    }
    const replaceVariables = async (variables, option = {}) => {
      const binding = bindingOf()
      if (!binding) throw new Error('卡脚本变量写窗口未开启（不在结算或兜底派发期）')
      const optionOut = { type: (option && option.type) || 'message' }
      if (optionOut.type === 'message') {
        optionOut.message_id = option && option.message_id !== undefined ? option.message_id : binding.messageId
        if (option && option.swipe_id !== undefined) optionOut.swipe_id = option.swipe_id
      } else if (optionOut.type === 'script') {
        optionOut.script_id = str(option && option.script_id).trim()
      }
      return updateVariables(binding.sessionId, optionOut, variables && typeof variables === 'object' ? variables : {}, undefined, '')
    }
    // 酒馆助手 getChatMessages 的 range 语义：缺省=当前楼；'latest'=最后一楼；负数=从尾数；
    // [start,end] 闭区间；'all'=全部。投影字段与酒馆助手对齐（message_id/role/is_user/content/data）。
    const chatMessagesProjection = (binding, range) => {
      const chat = binding.chat
      const messages = Array.isArray(chat.messages) ? chat.messages : []
      let indices
      if (range === undefined || range === null) indices = [binding.messageId]
      else if (range === 'all') indices = messages.map((_value, index) => index)
      else if (Array.isArray(range)) {
        const start = Math.max(0, Number(range[0]) || 0)
        const end = Math.min(messages.length - 1, Number(range[1]) || 0)
        indices = []
        for (let index = start; index <= end; index++) indices.push(index)
      } else {
        const id = sandboxMessageId(messages, range, binding.messageId)
        indices = [id]
      }
      return indices.filter(index => index >= 0 && index < messages.length).map(index => {
        const message = messages[index]
        const swipeId = Math.max(0, Number(message.swipeId) || 0)
        const variables = Array.isArray(message.variables) ? message.variables[swipeId] : undefined
        return {
          message_id: index,
          role: message.role === 'user' || message.tavernRole === 'user' ? 'user' : 'assistant',
          is_user: message.role === 'user' || message.tavernRole === 'user',
          is_system: message.role === 'system' || message.tavernRole === 'system',
          swipe_id: swipeId,
          content: str(message.sourceText || message.text),
          data: cloneJson(variables && typeof variables === 'object' ? variables : {})
        }
      })
    }
    const getVariables = option => variablesOf(option)
    const insertOrAssignVariables = async (variables, option = {}) =>
      replaceVariables(deepMergeTavernVariables(variablesOf(option), variables), option)
    return {
      // ---- 变量 ----
      getVariables,
      replaceVariables,
      insertOrAssignVariables,
      deleteVariable: async (option = {}) => replaceVariables({}, option),
      // ---- 楼层 ----
      getCurrentMessageId: () => { const binding = bindingOf(); return binding ? binding.messageId : -1 },
      getLastMessageId: () => { const binding = bindingOf(); return binding ? Math.max(0, (Array.isArray(binding.chat.messages) ? binding.chat.messages.length : 1) - 1) : -1 },
      getChatMessages: async (range, _type) => {
        const binding = bindingOf()
        if (!binding) return []
        return chatMessagesProjection(binding, range)
      },
      getAllChatMessages: async () => {
        const binding = bindingOf()
        if (!binding) return []
        return chatMessagesProjection(binding, 'all')
      },
      setChatMessages: async (range, patches) => {
        const binding = bindingOf()
        if (!binding) throw new Error('卡脚本楼层写窗口未开启')
        const list = Array.isArray(patches) ? patches : [patches]
        const base = chatMessagesProjection(binding, range)
        if (base.length === 0) return { updated: false }
        return updateMessages(binding.sessionId, base.map((projected, offset) => {
          const patch = list[offset] !== undefined ? list[offset] : list[0]
          return patch && typeof patch === 'object'
            ? { message_id: projected.message_id, ...(patch.message !== undefined ? { message: patch.message } : {}), ...(patch.data !== undefined ? { data: patch.data } : {}), ...(patch.swipe_id !== undefined ? { swipe_id: patch.swipe_id } : {}) }
            : { message_id: projected.message_id }
        }), undefined, '')
      },
      createChatMessages: async (messages, option = {}) => {
        const binding = bindingOf()
        if (!binding) throw new Error('卡脚本楼层写窗口未开启')
        return createMessages(binding.sessionId, Array.isArray(messages) ? messages : [messages], option, undefined, '')
      },
      deleteChatMessages: unsupportedApi('deleteChatMessages'),
      // ---- 脚本变量 ----
      getScriptVariables: async (option = {}) => variablesOf({ type: 'script', script_id: option && option.script_id }),
      replaceScriptVariables: async (variables, option = {}) => replaceVariables(variables, { type: 'script', script_id: option && option.script_id }),
      insertOrAssignScriptVariables: async (variables, option = {}) => replaceVariables(deepMergeTavernVariables(variablesOf({ type: 'script', script_id: option && option.script_id }), variables), { type: 'script', script_id: option && option.script_id }),
      // ---- 世界书 ----
      getWorldbook: async (name) => {
        const binding = bindingOf()
        if (!binding) return []
        return getWorldbook(binding.sessionId, str(name), false)
      },
      replaceWorldbook: async (name, entries) => {
        const binding = bindingOf()
        if (!binding) throw new Error('卡脚本世界书写窗口未开启')
        return replaceWorldbook(binding.sessionId, str(name), Array.isArray(entries) ? entries : [], undefined, false)
      },
      // ---- 人物卡 ----
      getCharData: () => {
        const binding = bindingOf()
        const snapshot = binding && binding.chat.cardDefinitionSnapshot
        if (!snapshot || typeof snapshot !== 'object') return {}
        return {
          name: str(snapshot.name), description: str(snapshot.description), personality: str(snapshot.personality),
          scenario: str(snapshot.scenario), first_mes: str(snapshot.first_mes), mes_example: str(snapshot.mes_example),
          creator_notes: str(snapshot.creator_notes), character_version: str(snapshot.character_version),
          tags: cloneJson(Array.isArray(snapshot.tags) ? snapshot.tags : [])
        }
      },
      // ---- 事件与环境 ----
      waitGlobalInitialized: async () => {},
      $: fn => { if (typeof fn === 'function') Promise.resolve().then(fn).catch(() => {}) },
      Mvu: { events: MVU_SANDBOX_EVENTS },
      // ---- 未实现（按需补）：UI/LLM/正则/斜杠命令等 ----
      triggerSlash: unsupportedApi('triggerSlash'),
      generate: unsupportedApi('generate'),
      generateRaw: unsupportedApi('generateRaw'),
      getTavernRegexes: unsupportedApi('getTavernRegexes'),
      replaceTavernRegexes: unsupportedApi('replaceTavernRegexes'),
      getWorldbookNames: unsupportedApi('getWorldbookNames'),
      createLorebook: unsupportedApi('createLorebook'),
      deleteLorebook: unsupportedApi('deleteLorebook')
    }
  }

  async function ensureCardSandboxRuntime(chat) {
    if (!chat || !chat.cardPath || !chat.mvu || chat.mvu.enabled !== true) return null
    if (typeof options.readCardExtensions !== 'function') return null
    const store = options.cardScriptDispatchStore
    const cardPath = str(chat.cardPath)
    // 卡级标记（事件钩子期探针触发、无法定位脚本时的粗粒度兜底）：整卡转浏览器
    if (store && store.lookupCard(cardPath)) return null
    const extensions = await options.readCardExtensions(chat.cardPath, chat)
    const projected = projectTavernHelperScripts(extensions && extensions.helperScripts, chat.tavernHelperScriptVariables)
    const sources = projected.scripts
      .map(script => ({ id: script.id, name: script.name || script.id, code: str(script.content) }))
      .filter(source => classifyCardScript(source.code) === 'server-compute'
        && !(store && store.lookupScript(cardPath, source.id, source.code)))
    if (sources.length === 0) return null
    const key = sources.map(source => source.name + ':' + source.code.length).join('|')
    const cached = cardSandboxRuntimes.get(cardPath)
    if (cached && cached.key === key) return cached.runtime
    if (cached) { try { disposeRuntime(cardPath) } catch {} }
    // 探针回调：加载期携带脚本名 → 精确标记；事件钩子期 scriptName 为空 → 卡级标记。
    // 标记后使该卡沙箱缓存失效，下一次分派自动把命中脚本下发浏览器（A.6.2 自愈）。
    const onDomAccess = scriptName => {
      try {
        const store2 = options.cardScriptDispatchStore
        if (store2) {
          const source = scriptName ? sources.find(item => item.name === scriptName) : null
          if (source) store2.markScript(cardPath, source.id, source.code, 'dom-probe')
          else store2.markCard(cardPath, 'dom-probe-hook')
        }
        recordCardScriptDiagnostic(cardPath, {
          scriptId: '', name: scriptName || '卡脚本', status: 'info',
          message: '已自动识别为界面脚本并转浏览器执行（下次刷新生效）'
        })
        cardSandboxRuntimes.delete(cardPath)
        disposeRuntime(cardPath)
        console.warn('[mvu-sandbox] DOM 探针触发:', cardPath, scriptName || '(事件钩子期，整卡转浏览器)')
      } catch {}
    }
    const runtime = getOrCreateRuntime(cardPath, sources, makeSandboxHostApi(cardPath), 8000, onDomAccess)
    cardSandboxRuntimes.set(cardPath, { key, runtime })
    // 脚本顶层的钩子注册是异步链（$(init) → await waitGlobalInitialized → eventOn），
    // 且 vm 跨 realm 微任务时序不保证在宿主 await 恢复前排空——等一个宏任务边界。
    await MVU_SANDBOX_SLEEP(60)
    // 加载期错误透出（A.6.1 #1）：排除探针触发的预期转浏览器条目
    for (const item of runtime.errors) {
      recordCardScriptDiagnostic(cardPath, item.domProbe
        ? { scriptId: '', name: item.source, status: 'info', message: item.error }
        : { scriptId: '', name: item.source, status: 'error', message: '在服务端加载失败：' + item.error })
    }
    if (runtime.domAccessed) { cardSandboxRuntimes.delete(cardPath); disposeRuntime(cardPath); return null }
    return runtime
  }

  function bindSandboxSession(cardPath, chat, sessionId, messageId, swipeId) {
    sandboxBindings.set(str(cardPath), { chat, sessionId: str(sessionId), messageId, swipeId })
  }

  function releaseSandboxBinding(cardPath) {
    sandboxBindings.delete(str(cardPath))
  }

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
      ...(transaction.compact ? { contextDelta: projectMvuReceipt(transaction.work, multiple ? target : [target]) }
        : { context: projectTavernHelperContext(transaction.draft) })
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

  async function variableMutationSlice(sessionId, option, expectedLifecycleRevision, eventId, baseline) {
    assertTransactionEvent(settlementTransactions.get(str(sessionId)), eventId)
    if (!baseline || !options.patchChat || !options.resolveChatSlice || !options.readChatRevision || settlementTransactions.has(str(sessionId))
      || !['message','chat','script'].includes(option?.type)) return null
    const fields = ['id','sessionId','_storageRevision','tavernHelperLifecycleRevision','mode','cardPath','mvu',
      ...(option.type === 'chat' ? ['variables'] : option.type === 'script' ? ['tavernHelperScriptVariables'] : [])]
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
    if (settlementTransactions.has(str(sessionId))) return null
    selected.chat.messages = createScopedMessages(selected.messageCount, messageId === undefined ? [] : [[messageId,selected.chat.messages[0]]])
    return { chat:selected.chat, messageId }
  }

  async function updateVariablesNow(sessionId, option, variables, expectedLifecycleRevision, eventId, contextBaseline, allowSlice = true, fallbackChat) {
    const scoped = allowSlice ? await variableMutationSlice(sessionId, option, expectedLifecycleRevision, eventId, contextBaseline) : null
    const chat = scoped?.chat || fallbackChat || await mutationChat(sessionId, eventId)
    await assertScriptEnabled(chat)
    if (scoped && settlementTransactions.has(str(sessionId))) return updateVariablesNow(sessionId, option, variables, expectedLifecycleRevision, eventId, contextBaseline, false)
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
      messages: scoped ? (scoped.messageId === undefined ? {} : { [scoped.messageId]: Array.isArray(chat.messages[scoped.messageId].variables) ? chat.messages[scoped.messageId].variables.slice() : chat.messages[scoped.messageId].variables }) : option?.type === 'message' ? (chat.messages || []).map(message =>
        Array.isArray(message?.variables) ? message.variables.slice() : message?.variables) : []
    } : null
    const baseRevision = chat._storageRevision
    const compact = canPatch && contextBaseline?.chatId === chat.id
      && contextBaseline.stateRevision === baseRevision
      && contextBaseline.lifecycleRevision === (chat.tavernHelperLifecycleRevision || 0)
      && (scoped || (chat.messages || []).every(message => message && typeof message === 'object'))
    let patched = false
    const transaction = settlementTransactions.get(str(sessionId))
    if (transaction && (!option?.type || option.type === 'message')) transaction.work.touch(option?.message_id)
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
      if (!saved && scoped) {
        assertTransactionEvent(settlementTransactions.get(str(sessionId)), eventId)
        const baseline = await options.readChatRevision(chat.id, baseRevision)
        if (!baseline) { const error = new Error(String.fromCharCode(21464,37327,20889,20837,22522,32447,24050,22833,25928)); error.code = "DSH_TAVERN_CHAT_CONFLICT"; throw error }
        return updateVariablesNow(sessionId, option, variables, expectedLifecycleRevision, eventId, contextBaseline, false, baseline)
      }
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
    if (transaction) for (const patch of patches) if (patch && typeof patch === 'object') transaction.work.touch(patch.message_id)
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

  async function worldbookRecord(sessionId, requestedName, template = false, suppliedChat) {
    const chat = suppliedChat || await resolveChat(sessionId)
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

  async function context(sessionId, chatValue, transientUserText = '', indices) {
    const chat = chatValue || await resolveChat(sessionId)
    const draft = { ...chat, messages: chat.messages || [] }
    const userText = str(transientUserText).trim()
    if (userText !== '') {
      const previousVariables = lastTavernHelperVariables(draft.messages)
      const message = { role: 'user', text: userText, swipeId: 0, swipes: [userText], variables: [] }
      if (previousVariables !== undefined) message.variables = [structuredClone(previousVariables)]
      draft.messages = draft.messages.concat(message)
    }
    const projected = projectTavernHelperContext(indices ? { ...draft, messages: [] } : draft)
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
    const current = await readSettlementChat(sessionId)
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
    const eventId = 'mvu-work:' + randomUUID()
    const work = createMvuWorkingCopy(current, eventId)
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
    let cardSandboxRuntime = null
    let settlementPrepared = false
    settlementTransactions.set(sessionId, transaction)
    try {
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
      // 卡脚本钩子（派生值重算）：变量命令应用完成后触发 mag_variable_update_ended，
      // 钩子就地修改 mvuData（脚本内 250ms 防抖，等待其 flush 后再写回草稿）。
      try {
        cardSandboxRuntime = await ensureCardSandboxRuntime(current)
        console.warn('[mvu-hook-debug] runtime=', Boolean(cardSandboxRuntime), 'events=', cardSandboxRuntime ? cardSandboxRuntime.events.length : -1)
        if (cardSandboxRuntime && cardSandboxRuntime.events.length > 0) {
          bindSandboxSession(current.cardPath, transaction.draft, sessionId, messageId, swipeId)
          await cardSandboxRuntime.dispatchEvent(MVU_SANDBOX_EVENTS.VARIABLE_UPDATE_ENDED, mvuData, structuredClone(mvuData))
          await MVU_SANDBOX_SLEEP(320)
          await record('card-hook-applied', { hooks: cardSandboxRuntime.events.length })
        }
      } catch (hookError) {
        recordCardScriptDiagnostic(cardPath, { scriptId: '', name: '卡脚本', status: 'error', message: '脚本钩子在结算中执行失败：' + str(hookError && hookError.message || hookError) })
        await record('card-hook-error', { phase: 'update-ended', error: str(hookError && hookError.message || hookError) })
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
      const beforeVariables = input.baselineVariables || current.messages[messageId].variables?.[swipeId] || {}
      const afterVariables = transaction.draft.messages[messageId].variables?.[swipeId] || {}
      const validation = typeof input.validate === 'function'
        ? await input.validate({ before: beforeVariables, after: afterVariables })
        : null
      if (validation && validation.failures.length > 0) {
        await record('validation-rejected', { failures: validation.failures, externalEffects: transaction.externalEffects === true })
        return {
          updated: false, rejected: true, retryable: transaction.externalEffects !== true, retryAfterMs: MVU_RETRY_AFTER_MS,
          validation, diagnostics: dispatched.diagnostics || [], context: projectTavernHelperContext(current)
        }
      }
      // The browser event can take time; recheck the target before committing its draft.
      const selected = await options.resolveChatSlice?.(sessionId, [messageId], 'settlement')
      const latest = selected ? { ...selected.chat, messages: Object.assign([], { [messageId]: selected.chat.messages[0] }) } : await resolveChat(sessionId)
      if (!mutationIsCurrent(latest, expectedLifecycleRevision)
        || Number(latest.messages[messageId]?.swipeId || 0) !== swipeId) return { updated:false, stale:true }
      const effect = createMvuSettlementEffect({
        operationId, chatId: current.id, sessionId,
        branchId: input.branchId, basedOnRevision: input.basedOnRevision,
        expectedLifecycleRevision, messageId, swipeId,
        before: current, after: transaction.draft, messageIndices: work.dirty
      })
      await record('prepared', { mutations: transaction.mutations })
      settlementPrepared = true
      return {
        updated: true,
        validation,
        diagnostics: dispatched.diagnostics || [],
        mutations: transaction.mutations,
        messageId,
        swipeId,
        effect,
        variables: structuredClone(afterVariables),
        ...(input.compactResult === true ? {} : { context: projectTavernHelperContext(transaction.draft) })
      }
    } catch (error) {
      await record('runtime-or-persistence-failed', { error: str(error && error.message || error) })
      throw error
    } finally {
      settlementTransactions.delete(sessionId)
      // 卡脚本 MESSAGE_RECEIVED 兜底派发：脚本会延迟 1.5s 读取最新变量重算并经宿主
      // 变量 API 写回（事务外 patch 落盘 + 镜像 SQLite）。此处只负责派发，等待与写回
      // 全部在后台完成，不阻塞结算返回。
      if (cardSandboxRuntime && cardSandboxRuntime.events.length > 0 && settlementPrepared) {
        const runtime = cardSandboxRuntime
        const cardPath = str(current.cardPath)
        void MVU_SANDBOX_SLEEP(1200).then(async () => {
          try {
            const latest = await resolveChat(sessionId)
            bindSandboxSession(cardPath, latest, sessionId, messageId, swipeId)
            await runtime.dispatchEvent('MESSAGE_RECEIVED', messageId)
            // 覆盖脚本内 1500ms 延迟 + 重算 + 写回，再释放读写绑定。
            await MVU_SANDBOX_SLEEP(6500)
            await record('card-hook-message-received', { phase: 'dispatched' })
          } catch (hookError) {
            recordCardScriptDiagnostic(cardPath, { scriptId: '', name: '卡脚本', status: 'error', message: '脚本钩子在浏览器事件兜底中失败：' + str(hookError && hookError.message || hookError) })
            await record('card-hook-error', { phase: 'message-received', error: str(hookError && hookError.message || hookError) })
          } finally {
            releaseSandboxBinding(cardPath)
          }
        })
      }
    }
  }

  return Object.freeze({
    context,
    dispatchEvent,
    settleMvuUpdate,
    /** 玩家可见诊断（A.6.1）：指定卡的分派/沙箱/钩子错误，view 组装时并入 tavernHelperScriptDiagnostics */
    collectCardScriptDiagnostics: function (cardPath) {
      const list = cardScriptDiagnostics.get(str(cardPath)) || []
      return list.map(entry => ({ scriptId: entry.scriptId || '', name: entry.name || '卡脚本', status: entry.status || 'warning', message: entry.message }))
    },
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
    claimWork: function (sessionId, runtimeId, ready, initializationError, baseline) { return options.scriptDispatch.claimWithContext ? options.scriptDispatch.claimWithContext(sessionId, runtimeId, ready, initializationError, baseline) : options.scriptDispatch.claim(sessionId, runtimeId, ready, initializationError) },
    async transactionContext(sessionId, eventId) {
      const transaction=settlementTransactions.get(str(sessionId))
      assertTransactionEvent(transaction,eventId)
      if (!transaction) return context(sessionId)
      if (transaction.work.sequence === 0) return transaction.executionContext({workContextVersion:1,full:true})
      return {...await context(sessionId,transaction.draft),transaction:{eventId:transaction.eventId,sequence:transaction.work.sequence}}
    },
    startWork: function (sessionId, eventId, leaseToken, runtimeId) { return options.scriptDispatch.start(sessionId, eventId, leaseToken, runtimeId) },
    workState: function (sessionId, eventId, leaseToken, runtimeId, keepAlive) { return options.scriptDispatch.workState(sessionId, eventId, leaseToken, runtimeId, keepAlive) },
    heartbeatRuntime: function (sessionId, runtimeId, ready, initializationError) { return { active: options.scriptDispatch.touch(sessionId, runtimeId, ready, initializationError) } },
    completeEvent: function (sessionId, eventId, args, runtimeId, leaseToken, error, diagnostics) { return options.scriptDispatch.complete(sessionId, eventId, args, runtimeId, leaseToken, error, diagnostics) },
    releaseRuntime: function (sessionId, runtimeId) { return options.scriptDispatch.dispose(sessionId, runtimeId) }
  })
}
