import { projectRuntimeContent } from './runtime-content-projection.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function messageText(message) {
  return str(message && message.sourceText) || str(message && message.text)
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
    return message !== null && typeof message === 'object' && message.role === 'assistant' && messageText(message) !== ''
  }).slice(-Math.max(1, Number(limit) || 6))
  const messages = []
  for (let index = 0; index < source.length; index++) {
    const message = source[index]
    messages.push({
      id: 'm' + index + '-' + now().toString(36),
      role: 'assistant',
      content: [{ type: 'text', text: messageText(message) }],
      source: { kind: 'model', provider: selection.provider, model: selection.model }
    })
  }
  return messages
}

const SCRIPT_READ_TOOL = Object.freeze({
  name: 'tavern_read_script',
  description: '只读剧本：用 position 读取任意剧本块，或用 query 检索整本剧本，两者都不移动游标。position、query 必须且只能提供一个。最多查询 6 次，用完后必须根据已有材料输出最终候选。',
  parameters: {
    type: 'object',
    properties: {
      position: { type: 'integer', minimum: 1, description: '要读取的 1 起始剧本块号；总块数加 1 表示剧本结束。' },
      query: { type: 'string', description: '要在整本剧本中检索的关键词。' }
    },
    additionalProperties: false
  }
})

const SCRIPT_POINT_TOOL = Object.freeze({
  name: 'tavern_point_script',
  description: '请求把下一轮剧本游标定位到指定块。只能保持当前位置或向前跳，不能后退；总块数加 1 表示剧本结束。调用只暂存请求，候选成功后才会一起提交。',
  countsTowardLimit: false,
  parameters: {
    type: 'object',
    properties: {
      position: { type: 'integer', minimum: 1, description: '要定位的 1 起始剧本块号；只能保持或向前跳，总块数加 1 表示剧本结束。' }
    },
    additionalProperties: false
  }
})

function scriptResearchAttempt(script, scriptWindow, card, chat) {
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
    const projected = projectRuntimeContent(chunk.text, {
      policy: 'play',
      charName: str(card && card.name),
      macroState: chat && chat.macroState
    })
    return Object.assign({
      title: str(script.title), totalChunks: total, position: position + 1,
      ended: false, chunks: [{ id: chunk.id, number: position + 1, text: projected.agentText }]
    }, extra || {})
  }

  async function onToolCall(call) {
    if (call === null || typeof call !== 'object') throw new Error('未知候选项研究工具')
    const args = call.arguments !== null && typeof call.arguments === 'object'
      ? call.arguments
      : parseJsonLenient(call.arguments)
    if (call.name === SCRIPT_POINT_TOOL.name) {
      const requested = Number(args.position)
      if (!Number.isInteger(requested) || requested < 1 || requested > total + 1) throw new Error('剧本定位的 position 必须是 1 到 ' + (total + 1) + ' 的整数')
      const before = pointed === null ? initial : pointed
      pointed = Math.max(before, requested - 1)
      return JSON.stringify({
        title: str(script.title), totalChunks: total,
        requestedPosition: requested,
        pointedAt: pointed >= total ? null : pointed + 1,
        pointedToEnd: pointed >= total,
        ignoredBackward: requested - 1 < before,
        pending: true,
        message: '定位请求已暂存；候选成功后才会提交。'
      })
    }
    if (call.name !== SCRIPT_READ_TOOL.name) throw new Error('未知候选项研究工具')
    const query = str(args.query).trim()
    const hasQuery = query !== ''
    const hasPosition = args.position !== undefined
    if (Number(hasQuery) + Number(hasPosition) !== 1) throw new Error('读取剧本必须且只能提供 position 或 query')
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
  const timeline = options.timeline
  const waitUntilSettled = typeof options.waitUntilSettled === 'function' ? options.waitUntilSettled : async function () {}
  const now = typeof options.now === 'function' ? options.now : Date.now
  const logger = options.logger || console

  async function generate(input) {
    let chat = await store.chatForSession(input.sessionId)
    if (chat === undefined || chat === null) throw new Error('当前会话没有绑定人物卡')
    const mode = chat.mode || 'story'
    if (mode === 'card') throw new Error('卡片模式不生成剧情候选项')
    await waitUntilSettled(chat)
    chat = await store.readChat(chat.id)
    if (chat === undefined) throw new Error('聊天不存在')
    const cardPath = str(chat.cardPath || chat.cardId)
    const card = await store.readCard(cardPath)
    if (card === undefined) throw new Error('人物卡不存在: ' + cardPath)
    const selection = model.selection(input.sessionId)
    if (selection === null || selection === undefined) throw new Error('没有可用的模型配置')
    const scriptMode = mode === 'script'
    let script = null
    let scriptWindow = null
    if (scriptMode) {
      script = await store.readScript(cardPath)
      if (script === undefined || !Array.isArray(script.chunks) || script.chunks.length === 0) throw new Error('剧本文件不存在，请重新为人物卡导入剧本')
      scriptWindow = scripts.inspect({ script, state: chat.scriptState, request: { kind: 'choice' } })
    }
    const task = prompt(scriptMode ? 'candidate-script' : 'candidate-story')
    const context = await planner.plan({ purpose: 'candidate', card, chat, task, scriptWindow })
    const begun = timeline.apply({ chat, intent: { kind: 'agent.begin', role: 'candidate' } })
    chat = begun.chat
    await store.writeChat(chat)
    const participantRequest = begun.value.participant || {}
    const persistentSessionId = str(participantRequest.sessionId)
    const guidance = str(input.guidance).trim().slice(0, 600)
    let request = '请按上述规则生成候选项。'
    if (guidance !== '') request += '\n\n【用户额外要求】\n' + guidance + '\n\n额外要求不改变 ' + (scriptMode ? '剧本走向、' : '') + (scriptMode ? 1 : 5) + ' 个候选及类型约束。'
    const backgroundAlreadySynced = persistentSessionId !== '' && Number(participantRequest.syncedRevision) === Number(begun.value.basedOn.revision)
    const recentMessages = backgroundAlreadySynced ? [] : buildMessages(chat, selection, now, persistentSessionId !== '' ? 1 : 6)
    const messages = recentMessages.concat([{
      id: 'choices-' + now().toString(36),
      role: 'user',
      content: [{ type: 'text', text: request }],
      source: { kind: 'plugin', plugin: 'dsh-tavern' }
    }])
    const research = scriptMode ? scriptResearchAttempt(script, scriptWindow, card, chat) : null
    const callOptions = {
      sessionId: input.sessionId,
      task: 'candidate',
      selection,
      temperature: 0.8,
      system: scriptMode ? context.stableText : context.text,
      turnContext: scriptMode ? context.dynamicText : '',
      messages,
      persistent: true,
      persistentSessionId,
      rewindTo: participantRequest.rewindTo
    }
    let run
    try {
      run = await model.runCandidate(Object.assign({}, callOptions, scriptMode ? {
        tools: [SCRIPT_READ_TOOL, SCRIPT_POINT_TOOL],
        onToolCall: research.onToolCall,
        maxToolCalls: 6
      } : { tools: [] }))
    } catch (error) {
      const failedChat = await store.readChat(chat.id)
      if (failedChat !== undefined) {
        const failed = timeline.complete({ chat: failedChat, operationId: begun.value.operationId, basedOn: begun.value.basedOn, outcome: { status: 'failed' } })
        await store.writeChat(failed.chat)
      }
      if (logger && typeof logger.error === 'function') logger.error('dsh-tavern: 候选项生成失败:', str(error && error.message || error))
      throw error
    }
    const text = run.text
    const traceSessionId = str(run.traceSessionId)
    const participant = traceSessionId !== '' ? {
      sessionId: traceSessionId,
      lifetime: 'chat',
      boundary: Number.isSafeInteger(run.traceBoundary) ? run.traceBoundary : null
    } : null
    let choices
    try {
      choices = validatedChoices(parsedDecision(text).choices, scriptMode)
    } catch (error) {
      if (logger && typeof logger.error === 'function') {
        logger.error('dsh-tavern: 候选项输出无效:', str(error && error.message || error))
        logger.error('dsh-tavern: 候选项原始输出:', str(text).slice(0, 1200))
      }
      const invalidChat = await store.readChat(chat.id)
      if (invalidChat !== undefined) {
        const recorded = timeline.complete({
          chat: invalidChat,
          operationId: begun.value.operationId,
          basedOn: begun.value.basedOn,
          outcome: { status: 'success', stateChanged: false, participant }
        })
        await store.writeChat(recorded.chat)
      }
      throw error
    }
    const latest = await store.readChat(chat.id)
    if (latest === undefined) throw new Error('聊天不存在: ' + chat.id)
    let savedCandidates = null
    const completed = timeline.complete({
      chat: latest,
      operationId: begun.value.operationId,
      basedOn: begun.value.basedOn,
      outcome: { status: 'success', stateChanged: true, participant },
      apply(draft) {
        let scriptProjection
        if (scriptMode) {
          const pointed = research.pointedPosition()
          if (pointed === script.chunks.length) {
            draft.scriptState = scripts.transition({ script, state: draft.scriptState, event: { kind: 'end' } }).state
          } else if (Number.isInteger(pointed) && pointed >= 0) {
            draft.scriptState = scripts.transition({ script, state: draft.scriptState, event: { kind: 'focus', cursor: pointed + 1 } }).state
          }
          const progress = scripts.inspect({ script, state: draft.scriptState, request: { kind: 'progress' } })
          scriptProjection = { cursor: progress.cursor, ended: progress.cursor >= progress.totalChunks }
        }
        draft.candidates = {
          messageId: str(input.messageId), choices, generatedAt: now(), script: scriptProjection,
          traceSessionId, traceSessionIds: traceSessionId === '' ? [] : [traceSessionId],
          traceMode: 'continuable', basedOn: begun.value.basedOn
        }
        savedCandidates = draft.candidates
      }
    })
    if (completed.value.status !== 'committed') throw new Error('剧情状态已变化，本次候选项已作废，请重新生成')
    await store.writeChat(completed.chat)
    return {
      messageId: savedCandidates.messageId,
      choices: savedCandidates.choices,
      generatedAt: savedCandidates.generatedAt,
      traceSessionId: savedCandidates.traceSessionId,
      traceSessionIds: savedCandidates.traceSessionIds,
      traceMode: savedCandidates.traceMode
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
