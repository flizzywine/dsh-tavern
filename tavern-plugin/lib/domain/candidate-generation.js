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
    if (type === null || text.length < 10 || text.length > 80 || choices.some(function (choice) { return choice.text === text })) continue
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

function buildMessages(chat, selection, now) {
  const source = (chat.messages || []).slice(-12)
  const messages = []
  for (let index = 0; index < source.length; index++) {
    const message = source[index]
    if (message === null || typeof message !== 'object' || str(message.text) === '') continue
    messages.push({
      id: 'm' + index + '-' + now().toString(36),
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'text', text: str(message.text) }],
      source: message.role === 'assistant'
        ? { kind: 'model', provider: selection.provider, model: selection.model }
        : { kind: 'plugin', plugin: 'dsh-tavern' }
    })
  }
  return messages
}

const SCRIPT_RESEARCH_TOOL = Object.freeze({
  name: 'tavern_read_script',
  description: '用 next 或 prev 逐块阅读，或用 search 随机检索剧本；用 point 把当前阅读位置选为下一轮正式游标。所有操作都先暂存，候选生成成功后才提交。',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['next', 'prev', 'search', 'point'], description: 'next 后一块；prev 前一块；search 按关键词随机检索；point 选择当前阅读位置。' },
      query: { type: 'string', description: 'search 时必填的关键词；其他动作不需要。' }
    },
    required: ['action'],
    additionalProperties: false
  }
})

function scriptResearchAttempt(script, scriptWindow) {
  const total = script.chunks.length
  let position = Math.max(0, Math.min(total, Number(scriptWindow.cursor) || 0))
  let pointed = null

  function positionResult(extra) {
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
    if (call === null || typeof call !== 'object' || call.name !== SCRIPT_RESEARCH_TOOL.name) throw new Error('未知候选项研究工具')
    const args = call.arguments !== null && typeof call.arguments === 'object'
      ? call.arguments
      : parseJsonLenient(call.arguments)
    if (args.action === 'next') {
      if (position < total) position++
      return JSON.stringify(positionResult())
    }
    if (args.action === 'prev') {
      if (position > 0) position--
      return JSON.stringify(positionResult(position === 0 ? { atStart: true } : null))
    }
    if (args.action === 'search') {
      const query = str(args.query).trim()
      if (query === '') throw new Error('候选项随机检索必须提供关键词')
      const needle = query.toLocaleLowerCase()
      const found = script.chunks.findIndex(function (chunk) { return str(chunk.text).toLocaleLowerCase().includes(needle) })
      if (found < 0) {
        return JSON.stringify({
          title: str(script.title), totalChunks: total, position: position >= total ? total + 1 : position + 1,
          ended: position >= total, notFound: true, message: '没有找到包含该关键词的剧本块。', chunks: []
        })
      }
      position = found
      return JSON.stringify(positionResult({ matchedQuery: query }))
    }
    if (args.action === 'point') {
      pointed = position
      return JSON.stringify(positionResult({ pointedAt: position >= total ? null : position + 1, pointedToEnd: position >= total }))
    }
    throw new Error('候选项剧本研究动作只能是 next、prev、search 或 point')
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
  const sleep = typeof options.sleep === 'function' ? options.sleep : function (milliseconds) { return new Promise(function (resolve) { setTimeout(resolve, milliseconds) }) }
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
    const guidance = str(input.guidance).trim().slice(0, 600)
    let request = '请按上述规则生成候选项。'
    if (guidance !== '') request += '\n\n【用户额外要求】\n' + guidance + '\n\n额外要求不改变 ' + (scriptMode ? '剧本走向、' : '') + (scriptMode ? 1 : 5) + ' 个候选及类型约束。'
    const messages = buildMessages(chat, selection, now).concat([{
      id: 'choices-' + now().toString(36),
      role: 'user',
      content: [{ type: 'text', text: request }],
      source: { kind: 'plugin', plugin: 'dsh-tavern' }
    }])
    const temperatures = [0.8, 1.0, 1.1]
    let lastError = null
    let lastRaw = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(800)
      try {
        const research = scriptMode ? scriptResearchAttempt(script, scriptWindow) : null
        const callOptions = {
          sessionId: input.sessionId,
          temperature: temperatures[attempt],
          maxTokens: 2400,
          system: context.text,
          messages
        }
        const text = scriptMode
          ? await model.callWithTools(Object.assign({}, callOptions, {
              tools: [SCRIPT_RESEARCH_TOOL],
              onToolCall: research.onToolCall,
              maxToolCalls: 8,
              maxRounds: 10
            }))
          : await model.call(callOptions)
        lastRaw = text
        const decision = parsedDecision(text)
        const choices = validatedChoices(decision.choices, scriptMode)
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
          script: scriptProjection
        }
        await store.writeChat(latest)
        return { messageId: latest.candidates.messageId, choices: latest.candidates.choices, generatedAt: latest.candidates.generatedAt }
      } catch (error) {
        lastError = error
        if (logger && typeof logger.error === 'function') {
          logger.error('dsh-tavern: 候选项生成第 ' + (attempt + 1) + ' 次失败:', str(error && error.message || error))
          if (lastRaw !== '') logger.error('dsh-tavern: 候选项原始输出:', lastRaw.slice(0, 1200))
        }
      }
    }
    throw lastError || new Error('候选项生成失败')
  }

  async function find(input) {
    const chat = await store.chatForSession(input.sessionId)
    if (chat === undefined || chat.candidates === null || typeof chat.candidates !== 'object' || str(chat.candidates.messageId) !== str(input.messageId)) return null
    const limit = (chat.mode || 'story') === 'script' ? 1 : 5
    const choices = Array.isArray(chat.candidates.choices) ? chat.candidates.choices.map(function (item) {
      return { type: item.type === 'scene' || item.type === 'scene2' ? 'scene' : 'action', text: str(item.text).trim() }
    }).filter(function (item) { return item.text !== '' }).slice(0, limit) : []
    if (choices.length === 0) return null
    return { messageId: str(chat.candidates.messageId), choices, generatedAt: Number(chat.candidates.generatedAt) || 0 }
  }

  return Object.freeze({ generate, find })
}
