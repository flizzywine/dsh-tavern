import { assertPluginJson } from './tavern-chat-plugin-data.js'
import { projectAgentContent } from './runtime-content-projection.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// 瘦身 2.0（R2）：历史楼变量读取器，由宿主（index.js）启动时注册一次。
// 签名 (chatId) => Map<turn, tree> | undefined——来自 SQLite 快照链的解析缓存。
// 投影时楼层 JSON 里没有树（已被瘦身清理）就从这里按 turn 补齐，喂给引擎/前端
// 的数据与瘦身前逐字节一致。树对象按共享只读约定出借，投影内部照旧 clone。
let variableHistoryReader = null
export function setVariableHistoryReader(fn) { variableHistoryReader = typeof fn === 'function' ? fn : null }
export function clearVariableHistoryReader() { variableHistoryReader = null }

function hasUsableTree(source) {
  if (!Array.isArray(source.variables) || source.variables.length === 0) return false
  return source.variables.some(value => value !== null && typeof value === 'object' && Object.keys(value).length > 0)
}

/** Fill the selected swipe's variables from the SQLite snapshot chain after slimming. */
function backfillVariablesFromHistory(source, swipeId, historyMap) {
  if (historyMap === null || historyMap === undefined) return
  if (hasUsableTree(source)) return
  const turn = Math.max(0, Number(source.turn) || 0)
  if (!Number.isSafeInteger(turn) || turn < 1) return
  const tree = historyMap.get(turn)
  if (tree === undefined || tree === null || typeof tree !== 'object') return
  if (!Array.isArray(source.variables)) source.variables = []
  while (source.variables.length <= swipeId) source.variables.push({})
  source.variables[swipeId] = clone(tree)
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function selectedSwipe(message) {
  const count = Math.max(
    Array.isArray(message && message.swipes) ? message.swipes.length : 0,
    Array.isArray(message && message.variables) ? message.variables.length : 0,
    1
  )
  return Math.max(0, Math.min(count - 1, Number(message && message.swipeId) || 0))
}

function normalizeMessageId(messages, value) {
  const rawId = value === undefined || value === null || value === 'latest' ? -1 : Number(value)
  const messageId = rawId < 0 ? messages.length + rawId : rawId
  if (!Number.isInteger(messageId) || messageId < 0 || messageId >= messages.length) {
    throw new Error('消息楼层不存在: ' + str(value))
  }
  return messageId
}

/** Read the selected variable snapshot from the latest message that has one. */
export function lastTavernHelperVariables(messages) {
  const source = Array.isArray(messages) ? messages : []
  for (let messageId = source.length - 1; messageId >= 0; messageId--) {
    const message = source[messageId]
    if (message && message.role === 'tavern-helper') continue
    if (!message || !Array.isArray(message.variables) || message.variables.length === 0) continue
    const swipeId = selectedSwipe(message)
    const variables = message.variables[swipeId]
    if (variables !== undefined) return clone(variables)
  }
  return undefined
}

/** How many trailing Helper floors keep full bodies on a cold getSession. */
export const HELPER_MESSAGE_COLD_WINDOW = 48

function tavernHelperRole(source) {
  return source.role === 'tavern-helper'
    ? (['system', 'assistant', 'user'].includes(source.tavernRole) ? source.tavernRole : 'assistant')
    : (source.role === 'user' ? 'user' : 'assistant')
}

/** Project one Chat floor into the synchronous Tavern Helper message shape. */
export function projectTavernHelperMessage(source, messageId, historyMap, allowBackfill = true) {
  const swipeId = selectedSwipe(source)
  if (allowBackfill) backfillVariablesFromHistory(source, swipeId, historyMap)
  const swipes = Array.isArray(source.swipes) && source.swipes.length > 0
    ? source.swipes.map(str)
    : [str(source.sourceText || source.text)]
  const variables = Array.isArray(source.variables) ? clone(source.variables) : []
  const projected = {
    pluginData: clone(source.tavernPluginData || {}),
    message_id: messageId,
    role: tavernHelperRole(source),
    message: swipes[swipeId] ?? swipes[0] ?? '',
    swipe_id: swipeId,
    swipes,
    swipes_data: variables,
    variables: clone(variables[swipeId] || {})
  }
  if (source.role === 'tavern-helper') {
    projected.is_hidden = source.tavernHidden === true
    if (str(source.name) !== '') projected.name = str(source.name)
  }
  return projected
}

/** Cold-start placeholder: keeps dense ids without cloning large variables. */
export function projectTavernHelperMessageSkeleton(source, messageId) {
  const swipeId = selectedSwipe(source)
  const projected = {
    pluginData: {},
    message_id: messageId,
    role: tavernHelperRole(source),
    message: '',
    swipe_id: swipeId,
    swipes: [''],
    swipes_data: [],
    variables: {},
    stub: true
  }
  if (source.role === 'tavern-helper') {
    projected.is_hidden = source.tavernHidden === true
    if (str(source.name) !== '') projected.name = str(source.name)
  }
  return projected
}

function rememberAssistantTurn(turnMessageIds, source, messageId, role) {
  if (role !== 'assistant') return
  const turn = Math.max(0, Number(source.turn) || (source.greeting === true ? 1 : 0))
  if (turn > 0) turnMessageIds[String(turn)] = messageId
}

/** Project authoritative Chat state into the synchronous Tavern Helper read API. */
export function projectTavernHelperContext(chat, options = {}) {
  const sources = Array.isArray(chat && chat.messages) ? chat.messages : []
  // R2：历史楼变量补数——楼里 JSON 有树照旧用 JSON（热楼零改动），没有才查快照缓存
  const historyMap = variableHistoryReader && chat && chat.id !== undefined && chat.id !== null
    ? variableHistoryReader(str(chat.id)) : null
  // R2.1 补数限窗：全量投影只补尾部窗口内的楼。深历史楼全补会让投影体积按
  // "楼数 × 树"线性爆炸（463 楼 ≈ 9MB/次），堵死前端连接与引擎资产下载。
  const backfillWindow = Math.max(0, sources.length - 48)
  const previousMessages = Array.isArray(options.previousMessages) ? options.previousMessages : null
  const dirtyIndices = options.dirtyIndices instanceof Set ? options.dirtyIndices : null
  const skeletonUntil = Number.isSafeInteger(options.skeletonUntil) ? Math.max(0, options.skeletonUntil) : 0
  const dirty = dirtyIndices ? new Set(dirtyIndices) : null
  if (dirty && previousMessages) {
    const previousCount = previousMessages.length
    const nextCount = sources.length
    for (let index = Math.min(previousCount, nextCount); index < nextCount; index++) dirty.add(index)
  }
  const messages = []
  const turnMessageIds = {}
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index]
    if (!source || typeof source !== 'object') continue
    const messageId = messages.length
    if (messageId !== index) {
      // Sparse/invalid floors break dirty reuse; finish with a full project.
      return projectTavernHelperContext(chat, { skeletonUntil })
    }
    let projected
    if (dirty && previousMessages && !dirty.has(index) && previousMessages[index] && previousMessages[index].message_id === index && previousMessages[index].stub !== true) {
      projected = previousMessages[index]
    } else if (index < skeletonUntil) {
      projected = projectTavernHelperMessageSkeleton(source, messageId)
    } else {
      projected = projectTavernHelperMessage(source, messageId, historyMap, index >= backfillWindow)
    }
    messages.push(projected)
    rememberAssistantTurn(turnMessageIds, source, messageId, projected.role)
  }
  const result = {
    version: 1,
    chatId: str(chat && chat.id),
    scriptPrompts: clone(chat && chat.tavernScriptPrompts || []),
    chatMetadata: clone(chat && chat.tavernPluginMetadata || {}),
    mvuEnabled: chat?.mvu?.enabled === true,
    stateRevision: Math.max(0, Number(chat && chat._storageRevision) || 0),
    lifecycleRevision: Math.max(0, Number(chat && chat.tavernHelperLifecycleRevision) || 0),
    messages,
    turnMessageIds,
    chatVariables: clone(chat && chat.variables && typeof chat.variables === 'object' ? chat.variables : {}),
    scriptVariables: clone(chat && chat.tavernHelperScriptVariables && typeof chat.tavernHelperScriptVariables === 'object' ? chat.tavernHelperScriptVariables : {})
  }
  if (skeletonUntil > 0 && messages.length > skeletonUntil) {
    result.messagesPending = { from: 0, to: skeletonUntil - 1 }
  }
  return result
}

/** Replace stub floors with full projections for a closed index range. */
export function hydrateTavernHelperMessages(chat, from, to) {
  const sources = Array.isArray(chat && chat.messages) ? chat.messages : []
  const historyMap = variableHistoryReader && chat && chat.id !== undefined && chat.id !== null
    ? variableHistoryReader(str(chat.id)) : null
  const start = Math.max(0, Number(from) || 0)
  const end = Math.min(sources.length - 1, Number.isSafeInteger(Number(to)) ? Number(to) : sources.length - 1)
  const messages = []
  for (let index = start; index <= end; index++) {
    const source = sources[index]
    if (!source || typeof source !== 'object') throw new Error('消息楼层不存在: ' + index)
    messages.push(projectTavernHelperMessage(source, index, historyMap))
  }
  return { from: start, to: end, messages }
}

/** Append Helper-owned floors without turning plugin records into story rounds. */
export function appendTavernHelperMessages(chat, values, option = {}) {
  if (!chat || typeof chat !== 'object') throw new Error('聊天不存在')
  const settings = option && typeof option === 'object' && !Array.isArray(option) ? option : {}
  if (settings.insert_before !== undefined && settings.insert_before !== 'end') {
    throw new Error('DSH 的 createChatMessages 只支持追加到末尾')
  }
  if (settings.refresh !== undefined && !['none', 'affected', 'all'].includes(settings.refresh)) {
    throw new Error('createChatMessages refresh 参数无效')
  }
  if (!Array.isArray(chat.messages)) chat.messages = []
  const created = []
  for (const value of Array.isArray(values) ? values : []) {
    if (!value || typeof value !== 'object') throw new TypeError('createChatMessages 消息必须是对象')
    const role = str(value.role)
    if (!['system', 'assistant', 'user'].includes(role)) throw new TypeError('createChatMessages role 无效: ' + role)
    const text = str(value.message)
    const message = {
      role: 'tavern-helper',
      tavernRole: role,
      tavernHidden: value.is_hidden === true,
      tavernHelperCreated: true,
      text,
      sourceText: text,
      projectionText: text,
      sessionText: text,
      displayText: text,
      displayMode: 'markdown',
      swipeId: 0,
      swipes: [text],
      variables: [clone(value.data && typeof value.data === 'object' && !Array.isArray(value.data) ? value.data : {})]
    }
    if (str(value.name) !== '') message.name = str(value.name)
    chat.messages.push(message)
    created.push({ messageId: chat.messages.length - 1 })
  }
  return created
}

/** Apply one explicit Helper variable write without exposing Chat internals. */
export function replaceTavernHelperVariables(chat, request = {}) {
  if (!chat || typeof chat !== 'object') throw new Error('聊天不存在')
  const option = request.option && typeof request.option === 'object' ? request.option : {}
  const value = clone(request.variables && typeof request.variables === 'object' ? request.variables : {})
  if (option.type === 'chat') {
    if (option.localMutation !== undefined) {
      const mutation = option.localMutation
      assertPluginJson(mutation, '聊天变量操作')
      if (typeof mutation.key !== 'string' || !mutation.key || mutation.key === '__proto__'
        || Object.keys(mutation).some(key => !['key', 'value', 'remove'].includes(key))
        || (mutation.remove !== true && !Object.hasOwn(mutation, 'value'))) throw new Error('聊天变量操作无效')
      const next = clone(chat.variables || {})
      if (mutation.remove === true) delete next[mutation.key]
      else Object.defineProperty(next, mutation.key, { value: clone(mutation.value), enumerable: true, writable: true, configurable: true })
      chat.variables = next
    } else chat.variables = value
    return { type: 'chat' }
  }
  if (option.type === 'script') {
    const scriptId = str(option.script_id).trim()
    if (scriptId === '') throw new Error('脚本变量缺少 script_id')
    if (!chat.tavernHelperScriptVariables || typeof chat.tavernHelperScriptVariables !== 'object') chat.tavernHelperScriptVariables = {}
    chat.tavernHelperScriptVariables[scriptId] = value
    return { type: 'script', scriptId }
  }
  if (option.type !== 'message') throw new Error('只支持 message、chat 或 script 变量')
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  const messageId = normalizeMessageId(messages, option.message_id)
  const message = messages[messageId]
  const swipeId = Object.prototype.hasOwnProperty.call(option, 'swipe_id')
    ? Math.max(0, Number(option.swipe_id) || 0)
    : selectedSwipe(message)
  if (!Array.isArray(message.variables)) message.variables = []
  message.variables[swipeId] = value
  return { type: 'message', messageId, swipeId }
}

/** Apply the subset of setChatMessages used by card UI and greeting-index scripts. */
export function replaceTavernHelperMessages(chat, patches) {
  if (!chat || typeof chat !== 'object') throw new Error('聊天不存在')
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  const updated = []
  for (const patch of Array.isArray(patches) ? patches : []) {
    if (!patch || typeof patch !== 'object') continue
    const messageId = normalizeMessageId(messages, patch.message_id)
    const message = messages[messageId]
    const count = Math.max(
      Array.isArray(message.swipes) ? message.swipes.length : 0,
      Array.isArray(message.variables) ? message.variables.length : 0,
      1
    )
    const previousSwipeId = selectedSwipe(message)
    const swipeId = Object.prototype.hasOwnProperty.call(patch, 'swipe_id')
      ? Math.max(0, Math.min(count - 1, Number(patch.swipe_id) || 0))
      : previousSwipeId
    const writesText = Object.prototype.hasOwnProperty.call(patch, 'message')
    if (writesText) {
      const text = str(patch.message)
      if (!Array.isArray(message.swipes)) message.swipes = [str(message.sourceText || message.text)]
      while (message.swipes.length < count) message.swipes.push('')
      message.swipes[swipeId] = text
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'data')) {
      if (!Array.isArray(message.variables)) message.variables = []
      message.variables[swipeId] = clone(patch.data && typeof patch.data === 'object' ? patch.data : {})
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'swipes_data')) {
      const values = Array.isArray(patch.swipes_data) ? patch.swipes_data : []
      message.variables = values.map(function (value) {
        return clone(value && typeof value === 'object' ? value : {})
      })
    }
    message.swipeId = swipeId
    // MVU initialization writes swipes_data only. Never replace an already
    // rendered message with raw swipe text or replay stateful macros for it.
    if ((writesText || swipeId !== previousSwipeId) && Array.isArray(message.swipes) && message.swipes[swipeId] !== undefined) {
      const sourceText = message.swipes[swipeId]
      const projection = projectAgentContent(sourceText, { charName: chat.cardName, macroState: chat.macroState })
      message.sourceText = sourceText
      message.projectionText = projection.renderedText
      message.text = projection.sessionText
      message.sessionText = projection.sessionText
      message.displayText = projection.displayText
      message.displayMode = projection.displayMode
      message.projectionVersion = 2
      message.projectionWarnings = projection.warnings
      delete message.displayRuntime
      chat.macroState = projection.macroState
    }
    updated.push({ messageId, swipeId })
  }
  return updated
}
