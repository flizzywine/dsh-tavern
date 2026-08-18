function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clampInt(value, min, max, fallback) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
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
  let scriptCursor = Number(parsed !== null && typeof parsed === 'object' ? parsed.scriptCursor : NaN)
  if (!Number.isFinite(scriptCursor) || scriptCursor < 1) {
    const match = /"scriptCursor"\s*:\s*(\d+)/.exec(str(text))
    if (match !== null) scriptCursor = Number(match[1])
  }
  return { choices, scriptCursor }
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
  const source = (chat.messages || []).slice(-30)
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

export function createCandidateGenerator(options) {
  if (options === null || typeof options !== 'object') throw new Error('缺少候选项生成依赖')
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
    const task = scriptMode
      ? '你是剧本候选项生成器，只输出 JSON：{"choices":[{"type":"action|scene","text":"选项内容"}],"scriptCursor":1}。恰好生成 1 个候选；action 是人物行为，scene 是场景变化；text 限 10~80 字，不预写行动结果。阅读人物卡、最近剧情与剧本块，必要时用 tavern_script_peek 查看前后文；候选应自然承接最近正文，不重复已发生内容，并推动剧情进入下一处关键场面、冲突或转折。scriptCursor 填下一轮正文应重点参考的实际块号，可保持、前移或后移。'
      : '你是剧情候选项生成器，只输出 JSON：{"choices":[{"type":"action|scene","text":"选项内容"}]}。恰好生成 5 个候选：4 个各有侧重、彼此不重复的 action（人物行为），1 个 scene（场景变化）。每项 10~80 字，不预写行动结果。候选必须自然承接最近正文，不跳到无关动作，不重复已发生内容。'
    const context = await planner.plan({ purpose: 'candidate', card, chat, task, scriptWindow })
    const guidance = str(input.guidance).trim().slice(0, 600)
    let request = '请按上述规则生成候选项。'
    if (guidance !== '') request += '\n\n【用户额外要求】\n' + guidance + '\n\n额外要求不改变 ' + (scriptMode ? 1 : 5) + ' 个候选及类型约束。'
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
        const callOptions = {
          sessionId: input.sessionId,
          temperature: temperatures[attempt],
          maxTokens: 2400,
          system: context.text,
          messages
        }
        let text
        if (scriptMode) {
          let peekCalls = 0
          text = await model.callWithTool(Object.assign({}, callOptions, {
            tools: [{
              name: 'tavern_script_peek',
              description: '只读查看剧本分块，可向前或向后看任意位置；默认读当前游标块，可用 scriptOffset 指定块号（1 起始）或 scriptQuery 检索关键词。最多调用 4 次。',
              parameters: {
                type: 'object',
                properties: {
                  scriptOffset: { type: 'number' },
                  scriptLimit: { type: 'number' },
                  scriptQuery: { type: 'string' }
                },
                additionalProperties: false
              }
            }],
            onToolCall: async function (call) {
              peekCalls++
              if (peekCalls > 4) return 'peek 次数已用尽，请直接输出 JSON 结果。'
              const args = parseJsonLenient(str(call.arguments))
              const window = scripts.inspect({
                script,
                state: chat.scriptState,
                request: { kind: 'read', query: args.scriptQuery, offset: args.scriptOffset, limit: clampInt(Number(args.scriptLimit), 1, 4, 1) }
              })
              if (window.notFound === true) return '没有找到包含该关键词的剧本分块。'
              if (window.chunks.length === 0) return '没有可读的剧本分块。'
              return window.chunks.map(function (chunk) { return '[' + chunk.id + ' · 第 ' + (Number(chunk.order) + 1) + ' 块]\n' + chunk.text }).join('\n\n')
            }
          }))
        } else {
          text = await model.call(callOptions)
        }
        lastRaw = text
        const decision = parsedDecision(text)
        const choices = validatedChoices(decision.choices, scriptMode)
        const latest = await store.readChat(chat.id)
        if (latest === undefined) throw new Error('聊天不存在: ' + chat.id)
        let scriptProjection
        if (scriptMode) {
          if (Number.isFinite(decision.scriptCursor) && decision.scriptCursor >= 1) {
            latest.scriptState = scripts.transition({ script, state: latest.scriptState, event: { kind: 'focus', cursor: decision.scriptCursor } }).state
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
