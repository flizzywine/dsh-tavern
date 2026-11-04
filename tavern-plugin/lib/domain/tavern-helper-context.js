import { createIndexedArrayApi } from './indexed-array.js'
import { freezeJson, createImmutableTurnFields } from './freeze-json.js'
const helperTurns = createImmutableTurnFields()
const helperIndex = createIndexedArrayApi({valid: row => Boolean(row && !row.stub)})
import { assertPluginJson } from './tavern-chat-plugin-data.js'
import { projectAgentContent } from './runtime-content-projection.js'
import { projectProcessedReply } from './reply-presentation.js'
import { plainReplyProse, writeReplyProse } from './reply-prose.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
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
    : (['system', 'user'].includes(source.role) ? source.role : 'assistant')
}

/** Project one Chat floor into the synchronous Tavern Helper message shape. */
export function projectTavernHelperMessage(source, messageId) {
  const swipeId = selectedSwipe(source)
  const swipes = Array.isArray(source.swipes) && source.swipes.length > 0
    ? source.swipes.map(str)
    : [str(source.projectionText ?? source.sourceText ?? source.text)]
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
  const previousMessages = Array.isArray(options.previousMessages) ? options.previousMessages : null
  const dirtyIndices = options.dirtyIndices instanceof Set ? options.dirtyIndices : null
  const skeletonUntil = Number.isSafeInteger(options.skeletonUntil) ? Math.max(0, options.skeletonUntil) : 0
  const dirty = dirtyIndices ? new Set(dirtyIndices) : null
  if (dirty && previousMessages) {
    const previousCount = previousMessages.length
    const nextCount = sources.length
    for (let index = Math.min(previousCount, nextCount); index < nextCount; index++) dirty.add(index)
  }
  let messages = []
  let turnMessageIds = {}
  const tailAppend = previousMessages && Number.isSafeInteger(options.layoutFrom)
    && options.layoutFrom >= previousMessages.length && sources.length > previousMessages.length
  const indexedReuse = options.indexed && (options.layoutChanged === false || tailAppend) && dirty && options.previousContext
    && helperIndex.info(previousMessages)?.complete && (previousMessages.length === sources.length || tailAppend)
    && options.previousContext.chatId === str(chat.id)
    && options.previousContext.lifecycleRevision === Math.max(0,Number(chat.tavernHelperLifecycleRevision)||0)
  if (indexedReuse) {
    const turns = []
    messages = helperIndex.update(previousMessages,[...dirty].sort((a,b)=>a-b).map(id => {
      const source = sources[id]
      const projected = freezeJson(projectTavernHelperMessage(source,id))
      if (id >= previousMessages.length) {
        const mapping = {}
        rememberAssistantTurn(mapping, source, id, projected.role)
        turns.push(...Object.entries(mapping))
      }
      return [id,projected]
    }), sources.length)
    turnMessageIds = options.previousContext.turnMessageIds
    if (turns.length) turnMessageIds = helperTurns.update(turnMessageIds, turns)
  }
  for (let index = 0; !indexedReuse && index < sources.length; index++) {
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
      projected = projectTavernHelperMessage(source, messageId)
    }
    messages.push(projected)
    rememberAssistantTurn(turnMessageIds, source, messageId, projected.role)
  }
  if (options.indexed && !indexedReuse) {
    messages = helperIndex.from(messages.map(freezeJson))
    turnMessageIds = helperTurns.from(turnMessageIds)
  }
  const result = {
    version: 1,
    chatId: str(chat && chat.id),
    scriptPrompts: clone(chat && chat.tavernScriptPrompts || []),
    chatMetadata: clone(chat && chat.tavernPluginMetadata || {}),
    mvuEnabled: chat?.mvu?.enabled === true,
    // The background agent submits official MVU updates; card-side MVU must not parse again.
    mvuSettlement: chat?.mvu?.enabled === true && chat.mvu.owner === 'official' ? 'host' : 'script',
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

/** Complete one immutable cold projection only with its entire advertised range. */
export function completeTavernHelperContext(context, payload) {
  const pending = context?.messagesPending, source = context?.messages
  if (!pending || !Array.isArray(source) || !Array.isArray(payload?.messages)
    || payload.from !== pending.from || payload.to !== pending.to
    || payload.messages.length !== pending.to - pending.from + 1) return null
  const entries = []
  for (let offset = 0; offset < payload.messages.length; offset++) {
    const row = payload.messages[offset], id = pending.from + offset
    if (!row || row.message_id !== id || row.stub || id < 0 || id >= source.length) return null
    entries.push([id, freezeJson(structuredClone(row))])
  }
  const messages = helperIndex.update(helperIndex.info(source) ? source : helperIndex.from(source.map(freezeJson)), entries, source.length)
  if (!helperMessagesComplete(messages)) return null
  const {messagesPending, ...previous} = context
  return {...previous, messages}
}

/** Replace stub floors with full projections for a closed index range. */
export function hydrateTavernHelperMessages(chat, from, to) {
  const sources = Array.isArray(chat && chat.messages) ? chat.messages : []
  const start = Math.max(0, Number(from) || 0)
  const end = Math.min(sources.length - 1, Number.isSafeInteger(Number(to)) ? Number(to) : sources.length - 1)
  const messages = []
  for (let index = start; index <= end; index++) {
    const source = sources[index]
    if (!source || typeof source !== 'object') throw new Error('消息楼层不存在: ' + index)
    messages.push(projectTavernHelperMessage(source, index))
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
      ...plainReplyProse(text),
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

/**
 * Apply the subset of setChatMessages used by card UI and greeting-index scripts.
 * regexScripts are the ones the round was saved with, so a rewritten or switched
 * swipe reaches the model context as a fresh round would (reply-prose.js).
 */
export function replaceTavernHelperMessages(chat, patches, { regexScripts = [] } = {}) {
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
      if (!Array.isArray(message.swipes)) message.swipes = [str(message.projectionText ?? message.sourceText ?? message.text)]
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
      const projection = message.bodyRegenerationProcessed === true ? projectProcessedReply(sourceText) : projectAgentContent(sourceText, { charName: chat.cardName, macroState: chat.macroState,
        regexScripts, regexPlacement: 2, isEdit: false, depth: 0 })
      writeReplyProse(message, sourceText, projection)
      delete message.displayRuntime
      if (message.bodyRegenerationProcessed !== true) chat.macroState = projection.macroState
    }
    updated.push({ messageId, swipeId })
  }
  return updated
}

// Indexed production projections have a cached completeness aggregate.
export function helperMessagesComplete(messages) {
  return helperIndex.info(messages)?.complete ?? !messages.some(message=>message?.stub === true)
}
