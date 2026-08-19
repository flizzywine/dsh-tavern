function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function parseJsonLenient(text) {
  if (text === undefined || text === null || text === '') return {}
  let source = str(text).trim()
  if (source.startsWith('```')) {
    const newline = source.indexOf('\n')
    if (newline >= 0) source = source.slice(newline + 1)
    if (source.endsWith('```')) source = source.slice(0, -3)
    source = source.trim()
  }
  try {
    const value = JSON.parse(source)
    if (value !== null && typeof value === 'object') return value
  } catch (error) {}
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const value = JSON.parse(source.slice(start, end + 1))
      if (value !== null && typeof value === 'object') return value
    } catch (error) {}
  }
  return {}
}

function extractChoicesArray(text) {
  const source = str(text)
  const keyAt = source.indexOf('"choices"')
  if (keyAt < 0) return null
  const start = source.indexOf('[', keyAt)
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < source.length; index++) {
    const character = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '[') depth++
    else if (character === ']') {
      depth--
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return null
}

function parseChoiceObjects(text) {
  const result = []
  const expression = /\{\s*"type"\s*:\s*"([^"]+)"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g
  let match
  while ((match = expression.exec(str(text))) !== null) {
    let content = match[2]
    try { content = JSON.parse('"' + content + '"') } catch (error) { content = content.replace(/\\"/g, '"').replace(/\\n/g, '\n') }
    result.push({ type: match[1], text: str(content) })
  }
  return result
}

function parsedDecision(text) {
  const parsed = parseJsonLenient(text)
  let choices = Array.isArray(parsed.choices) ? parsed.choices : (Array.isArray(parsed.options) ? parsed.options : [])
  if (choices.length === 0) {
    const arrayText = extractChoicesArray(text)
    if (arrayText !== null) {
      try {
        const value = JSON.parse(arrayText)
        if (Array.isArray(value)) choices = value
      } catch (error) {}
    }
  }
  if (choices.length === 0) choices = parseChoiceObjects(text)
  return { choices }
}

function choiceType(value) {
  const type = str(value).trim().toLowerCase()
  if (type === 'action' || type === '人物行为' || type === '行动') return 'action'
  if (type === 'scene' || type === 'scene2' || type === 'newscene' || type === '场景' || type === '新场景' || type === '场景变化') return 'scene'
  return null
}

function validatedChoices(source, scriptMode) {
  const choices = []
  for (const item of Array.isArray(source) ? source : []) {
    if (item === null || typeof item !== 'object') continue
    const type = choiceType(item.type)
    const text = str(item.text).trim()
    if (type === null || text === '' || choices.some(function (choice) { return choice.text === text })) continue
    choices.push({ type, text })
  }
  if (scriptMode) {
    if (choices.length !== 1) throw new Error('模型没有返回恰好 1 个有效候选项')
    return choices
  }
  if (choices.length !== 5 || choices.filter(function (choice) { return choice.type === 'action' }).length !== 4 || choices.filter(function (choice) { return choice.type === 'scene' }).length !== 1) {
    throw new Error('模型没有返回恰好 4 个行动候选和 1 个场景候选')
  }
  return choices
}

function buildMessages(chat, selection, now, limit = 6) {
  const source = (chat.messages || []).filter(function (message) {
    return message !== null && typeof message === 'object' && message.role === 'assistant' && str(message.text) !== ''
  }).slice(-Math.max(1, Number(limit) || 6))
  const messages = []
  for (let index = 0; index < source.length; index++) {
    const message = source[index]
    messages.push({
      id: 'm' + index + '-' + now().toString(36),
      role: 'assistant',
      content: [{ type: 'text', text: str(message.text) }],
      source: { kind: 'model', provider: selection.provider, model: selection.model }
    })
  }
  return messages
}

const SCRIPT_READ_TOOL = Object.freeze({
  name: 'tavern_read_script',
  description: '用 position 读取任意剧本块，用 query 检索整本剧本，两者都不移动游标。只有 point 会把下一轮游标向前定位；总块数加 1 表示剧本结束。position、query、point 必须且只能提供一个。最多查询 6 次，用完后必须根据已有材料输出最终候选。',
  parameters: {
    type: 'object',
    properties: {
      position: { type: 'integer', minimum: 1, description: '要读取的 1 起始剧本块号；总块数加 1 表示剧本结束。' },
      query: { type: 'string', description: '要在整本剧本中检索的关键词。' },
      point: { type: 'integer', minimum: 1, description: '要定位的 1 起始剧本块号；只能保持或向前跳，总块数加 1 表示剧本结束。' }
    },
    additionalProperties: false
  }
})

function scriptResearchAttempt(script, scriptWindow) {
  const total = script.chunks.length
  const initial = Math.max(0, Math.min(total, Number(scriptWindow && scriptWindow.cursor) || 0))
  let pointed = null

  function positionResult(position, extra) {
    if (position >= total) {
      return Object.assign({
        title: str(script.title), totalChunks: total, position: total + 1,
        ended: true, message: '已经到达剧本结尾。', chunks: []
      }, extra || {})
    }
    const chunk = script.chunks[position]
    return Object.assign({
      title: str(script.title), totalChunks: total, position: position + 1,
      ended: false, chunks: [{ id: chunk.id, number: position + 1, text: str(chunk.text) }]
    }, extra || {})
  }

  async function onToolCall(call) {
    if (call === null || typeof call !== 'object' || call.name !== SCRIPT_READ_TOOL.name) throw new Error('未知候选项研究工具')
    const args = call.arguments !== null && typeof call.arguments === 'object'
      ? call.arguments
      : parseJsonLenient(call.arguments)
    const query = str(args.query).trim()
    const hasQuery = query !== ''
    const hasPosition = args.position !== undefined
    const hasPoint = args.point !== undefined
    if (Number(hasQuery) + Number(hasPosition) + Number(hasPoint) !== 1) throw new Error('读取剧本必须且只能提供 position、query 或 point')
    if (hasPoint) {
      const requested = Number(args.point)
      if (!Number.isInteger(requested) || requested < 1 || requested > total + 1) throw new Error('剧本 point 必须是 1 到 ' + (total + 1) + ' 的整数')
      pointed = Math.max(pointed === null ? initial : pointed, requested - 1)
      return JSON.stringify(positionResult(pointed, {
        pointedAt: pointed >= total ? null : pointed + 1,
        pointedToEnd: pointed >= total,
        ignoredBackward: requested - 1 < initial
      }))
    }
    if (hasQuery) {
      const needle = query.toLocaleLowerCase()
      const found = script.chunks.findIndex(function (chunk) { return str(chunk.text).toLocaleLowerCase().includes(needle) })
      if (found < 0) {
        return JSON.stringify({
          title: str(script.title), totalChunks: total,
          ended: false, notFound: true, message: '没有找到包含该关键词的剧本块。', chunks: []
        })
      }
      return JSON.stringify(positionResult(found, { matchedQuery: query }))
    }
    const requested = Number(args.position)
    if (!Number.isInteger(requested) || requested < 1 || requested > total + 1) throw new Error('读取剧本的 position 必须是 1 到 ' + (total + 1) + ' 的整数')
    return JSON.stringify(positionResult(requested - 1))
  }

  return { onToolCall, pointedPosition: function () { return pointed } }
}

export function createCandidateGenerator(options) {
  if (options === null || typeof options !== 'object') throw new Error('缺少候选项生成依赖')
  if (typeof options.prompt !== 'function') throw new Error('缺少提示词目录')
  const prompt = options.prompt
  const store = options.store
  const model = options.model
  const planner = options.planner
  const scripts = options.scripts
  const waitUntilSettled = typeof options.waitUntilSettled === 'function' ? options.waitUntilSettled : async function () {}
  const now = typeof options.now === 'function' ? options.now : Date.now
  const logger = options.logger || console

  async function generate(input) {
    const chat = await store.chatForSession(input.sessionId)
    if (chat === undefined || chat === null) throw new Error('当前会话没有绑定人物卡')
    const mode = chat.mode || 'story'
    if (mode === 'revision' || mode === 'extract') throw new Error('卡片模式不生成剧情候选项')
    await waitUntilSettled(chat)
    const card = await store.readCard(chat.cardId)
    if (card === undefined) throw new Error('角色卡不存在: ' + chat.cardId)
    const selection = model.selection(input.sessionId)
    if (selection === null || selection === undefined) throw new Error('没有可用的模型配置')
    const scriptMode = mode === 'script'
    let script = null
    let scriptWindow = null
    if (scriptMode) {
      script = await store.readScript(chat.cardId)
      if (script === undefined || !Array.isArray(script.chunks) || script.chunks.length === 0) throw new Error('剧本文件不存在，请重新为人物卡导入剧本')
      scriptWindow = scripts.inspect({ script, state: chat.scriptState, request: { kind: 'choice' } })
    }
    const task = prompt(scriptMode ? 'candidate-script' : 'candidate-story')
    const context = await planner.plan({ purpose: 'candidate', card, chat, task, scriptWindow })
    const candidateAgent = chat.candidateAgent !== null && typeof chat.candidateAgent === 'object' ? chat.candidateAgent : {}
    const persistentSessionId = scriptMode ? str(candidateAgent.sessionId) : ''
    const guidance = str(input.guidance).trim().slice(0, 600)
    let request = '请按上述规则生成候选项。'
    if (guidance !== '') request += '\n\n【用户额外要求】\n' + guidance + '\n\n额外要求不改变 ' + (scriptMode ? '剧本走向、' : '') + (scriptMode ? 1 : 5) + ' 个候选及类型约束。'
    const messages = buildMessages(chat, selection, now, scriptMode && persistentSessionId !== '' ? 1 : 6).concat([{
      id: 'choices-' + now().toString(36),
      role: 'user',
      content: [{ type: 'text', text: request }],
      source: { kind: 'plugin', plugin: 'dsh-tavern' }
    }])
    const research = scriptMode ? scriptResearchAttempt(script, scriptWindow) : null
    const callOptions = {
      sessionId: input.sessionId,
      selection,
      temperature: 0.8,
      maxTokens: 4000,
      system: scriptMode ? context.stableText : context.text,
      turnContext: scriptMode ? context.dynamicText : '',
      messages,
      persistent: scriptMode,
      persistentSessionId
    }
    let run
    try {
      run = await model.runCandidate(Object.assign({}, callOptions, scriptMode ? {
        tools: [SCRIPT_READ_TOOL],
        onToolCall: research.onToolCall,
        maxToolCalls: 6
      } : { tools: [] }))
    } catch (error) {
      const failedSessionId = scriptMode ? str(error && error.traceSessionId) : ''
      if (failedSessionId !== '') {
        const failedChat = await store.readChat(chat.id)
        if (failedChat !== undefined) {
          failedChat.candidateAgent = { sessionId: failedSessionId, mode: 'continuable', updatedAt: now() }
          await store.writeChat(failedChat)
        }
      }
      if (logger && typeof logger.error === 'function') logger.error('dsh-tavern: 候选项生成失败:', str(error && error.message || error))
      throw error
    }
    const text = run.text
    const traceSessionId = str(run.traceSessionId)
    if (scriptMode && traceSessionId !== '') {
      const agentChat = await store.readChat(chat.id)
      if (agentChat !== undefined) {
        agentChat.candidateAgent = { sessionId: traceSessionId, mode: 'continuable', updatedAt: now() }
        await store.writeChat(agentChat)
      }
    }
    let choices
    try {
      choices = validatedChoices(parsedDecision(text).choices, scriptMode)
    } catch (error) {
      if (logger && typeof logger.error === 'function') {
        logger.error('dsh-tavern: 候选项输出无效:', str(error && error.message || error))
        logger.error('dsh-tavern: 候选项原始输出:', str(text).slice(0, 1200))
      }
      throw error
    }
    const latest = await store.readChat(chat.id)
    if (latest === undefined) throw new Error('聊天不存在: ' + chat.id)
    let scriptProjection
    if (scriptMode) {
      const pointed = research.pointedPosition()
      if (pointed === script.chunks.length) {
        latest.scriptState = scripts.transition({ script, state: latest.scriptState, event: { kind: 'end' } }).state
      } else if (Number.isInteger(pointed) && pointed >= 0) {
        latest.scriptState = scripts.transition({ script, state: latest.scriptState, event: { kind: 'focus', cursor: pointed + 1 } }).state
      }
      const progress = scripts.inspect({ script, state: latest.scriptState, request: { kind: 'progress' } })
      scriptProjection = { cursor: progress.cursor, ended: progress.cursor >= progress.totalChunks }
    }
    latest.candidates = {
      messageId: str(input.messageId),
      choices,
      generatedAt: now(),
      script: scriptProjection,
      traceSessionId,
      traceSessionIds: traceSessionId === '' ? [] : [traceSessionId],
      traceMode: scriptMode ? 'continuable' : 'one-shot'
    }
    await store.writeChat(latest)
    return {
      messageId: latest.candidates.messageId,
      choices: latest.candidates.choices,
      generatedAt: latest.candidates.generatedAt,
      traceSessionId: latest.candidates.traceSessionId,
      traceSessionIds: latest.candidates.traceSessionIds,
      traceMode: latest.candidates.traceMode
    }
  }

  async function find(input) {
    const chat = await store.chatForSession(input.sessionId)
    if (chat === undefined || chat.candidates === null || typeof chat.candidates !== 'object' || str(chat.candidates.messageId) !== str(input.messageId)) return null
    const limit = (chat.mode || 'story') === 'script' ? 1 : 5
    const choices = Array.isArray(chat.candidates.choices) ? chat.candidates.choices.map(function (item) {
      return { type: item.type === 'scene' || item.type === 'scene2' ? 'scene' : 'action', text: str(item.text).trim() }
    }).filter(function (item) { return item.text !== '' }).slice(0, limit) : []
    if (choices.length === 0) return null
    const traceSessionIds = Array.isArray(chat.candidates.traceSessionIds) ? chat.candidates.traceSessionIds.map(str).filter(function (id) { return id !== '' }) : []
    const traceSessionId = str(chat.candidates.traceSessionId) || traceSessionIds[traceSessionIds.length - 1] || ''
    return { messageId: str(chat.candidates.messageId), choices, generatedAt: Number(chat.candidates.generatedAt) || 0, traceSessionId, traceSessionIds, traceMode: chat.candidates.traceMode === 'continuable' ? 'continuable' : 'one-shot' }
  }

  return Object.freeze({ generate, find })
}
