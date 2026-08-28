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

/** Project authoritative Chat state into the synchronous Tavern Helper read API. */
export function projectTavernHelperContext(chat) {
  const messages = []
  const turnMessageIds = {}
  for (const source of Array.isArray(chat && chat.messages) ? chat.messages : []) {
    if (!source || typeof source !== 'object') continue
    const messageId = messages.length
    const swipeId = selectedSwipe(source)
    const swipes = Array.isArray(source.swipes) && source.swipes.length > 0
      ? source.swipes.map(str)
      : [str(source.sourceText || source.text)]
    const variables = Array.isArray(source.variables) ? clone(source.variables) : []
    const projected = {
      message_id: messageId,
      role: source.role === 'user' ? 'user' : 'assistant',
      message: swipes[swipeId] ?? swipes[0] ?? '',
      swipe_id: swipeId,
      swipes,
      swipes_data: variables,
      variables: clone(variables[swipeId] || {})
    }
    messages.push(projected)
    if (projected.role === 'assistant') {
      const turn = Math.max(0, Number(source.turn) || (source.greeting === true ? 1 : 0))
      if (turn > 0) turnMessageIds[String(turn)] = messageId
    }
  }
  return {
    version: 1,
    lifecycleRevision: Math.max(0, Number(chat && chat.tavernHelperLifecycleRevision) || 0),
    messages,
    turnMessageIds,
    chatVariables: clone(chat && chat.variables && typeof chat.variables === 'object' ? chat.variables : {}),
    scriptVariables: clone(chat && chat.tavernHelperScriptVariables && typeof chat.tavernHelperScriptVariables === 'object' ? chat.tavernHelperScriptVariables : {})
  }
}

/** Apply one explicit Helper variable write without exposing Chat internals. */
export function replaceTavernHelperVariables(chat, request = {}) {
  if (!chat || typeof chat !== 'object') throw new Error('聊天不存在')
  const option = request.option && typeof request.option === 'object' ? request.option : {}
  const value = clone(request.variables && typeof request.variables === 'object' ? request.variables : {})
  if (option.type === 'chat') {
    chat.variables = value
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
    const swipeId = Object.prototype.hasOwnProperty.call(patch, 'swipe_id')
      ? Math.max(0, Math.min(count - 1, Number(patch.swipe_id) || 0))
      : selectedSwipe(message)
    if (Object.prototype.hasOwnProperty.call(patch, 'message')) {
      const text = str(patch.message)
      if (!Array.isArray(message.swipes)) message.swipes = [str(message.sourceText || message.text)]
      while (message.swipes.length < count) message.swipes.push('')
      message.swipes[swipeId] = text
      message.sourceText = text
      message.projectionText = text
      message.text = text
      message.sessionText = text
      message.displayText = text
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'data')) {
      if (!Array.isArray(message.variables)) message.variables = []
      message.variables[swipeId] = clone(patch.data && typeof patch.data === 'object' ? patch.data : {})
    }
    message.swipeId = swipeId
    if (Array.isArray(message.swipes) && message.swipes[swipeId] !== undefined) {
      message.sourceText = message.swipes[swipeId]
      message.projectionText = message.swipes[swipeId]
      message.text = message.swipes[swipeId]
      message.sessionText = message.swipes[swipeId]
      message.displayText = message.swipes[swipeId]
    }
    updated.push({ messageId, swipeId })
  }
  return updated
}
