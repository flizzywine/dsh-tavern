import { scriptForState } from './script-layout.js'
import { projectAgentContent, projectAgentMessageText } from './runtime-content-projection.js'
import { createBackgroundTaskCoordinator } from './background-task-coordinator.js'
import { CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL } from './character-design-document.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function candidateFailure(stage, message, cause) {
  const detail = str(cause && cause.message || cause).trim()
  const error = new Error(detail === '' ? message : `${message}：${detail}`, cause instanceof Error ? { cause } : undefined)
  error.code = 'CANDIDATE_' + stage.toUpperCase() + '_FAILED'
  error.stage = stage
  return error
}

function messageText(message, card, chat) {
  return projectAgentMessageText(message, {
    charName: str(card && card.name),
    macroState: chat && chat.macroState
  })
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

function choiceType(value) {
  const type = str(value).trim().toLowerCase()
  if (type === 'action' || type === '人物行为' || type === '行动') return 'action'
  if (type === 'scene' || type === 'scene2' || type === 'newscene' || type === '场景' || type === '新场景' || type === '场景变化') return 'scene'
  return null
}

function projectCandidateIdentityMacros(value, card, chat) {
  const userName = str(chat && chat.macroState && chat.macroState.userName) || '你'
  const charName = str(card && card.name)
  return str(value).replace(/\{\{\s*(user|char)\s*\}\}/gi, function (_match, name) {
    return String(name).toLowerCase() === 'user' ? userName : charName
  })
}

// Some models double-escape tool arguments: literal "\\u7a97" text becomes the character.
export function decodeLiteralUnicodeEscapes(value) {
  const text = str(value)
  if (!/\\u[0-9a-fA-F]{4}/.test(text)) return text
  return text.replace(/(?:\\u[0-9a-fA-F]{4})+/g, run => {
    try {
      const decoded = JSON.parse('"' + run + '"')
      return decoded.isWellFormed() ? decoded : run
    } catch { return run }
  })
}

function validatedChoices(source, scriptMode, logger) {
  const choices = []
  for (const item of Array.isArray(source) ? source : []) {
    if (item === null || typeof item !== 'object') continue
    const type = choiceType(item.type)
    const text = decodeLiteralUnicodeEscapes(item.text).trim()
    if (type === null || text === '' || choices.some(function (choice) { return choice.text === text })) continue
    choices.push({ type, text })
  }
  if (scriptMode) {
    if (choices.length === 0) throw new Error('模型没有返回至少 1 个有效候选项')
    if (choices.length > 1 && logger && typeof logger.warn === 'function') {
      logger.warn(`dsh-tavern: 模型候选项返回 ${choices.length} 个剧本候选，已裁剪为 1 个。`)
    }
    return choices.slice(0, 1)
  }
  const actions = choices.filter(function (choice) { return choice.type === 'action' })
  const scenes = choices.filter(function (choice) { return choice.type === 'scene' })
  if (actions.length < 4 || scenes.length < 1) {
    throw new Error('模型没有返回至少 4 个行动候选和 1 个场景候选')
  }
  if ((actions.length > 4 || scenes.length > 1) && logger && typeof logger.warn === 'function') {
    logger.warn(`dsh-tavern: 模型候选项返回 ${actions.length} 个行动候选和 ${scenes.length} 个场景候选，已裁剪为 4 + 1。`)
  }
  return actions.slice(0, 4).concat(scenes.slice(0, 1))
}

function buildMessages(chat, card, selection, now, limit = 6) {
  const source = [], history=chat.messages || []
  for(let index=history.length-1;index>=0 && source.length<Math.max(1,Number(limit)||6);index--){
    const message=history[index]
    if(message?.role!=='assistant')continue
    const text=messageText(message,card,chat)
    if(text!=='')source.unshift({message,text})
  }
  const messages = []
  for (let index = 0; index < source.length; index++) {
    const item = source[index]
    messages.push({
      id: 'm' + index + '-' + now().toString(36),
      role: 'assistant',
      content: [{ type: 'text', text: item.text }],
      source: { kind: 'model', provider: selection.provider, model: selection.model }
    })
  }
  return messages
}

export const CANDIDATE_SUBMIT_TOOL_NAME = 'candidate_submit_choices'

export const CANDIDATE_SUBMIT_TOOL = Object.freeze({
  name: CANDIDATE_SUBMIT_TOOL_NAME,
  description: '提交本轮候选项。自由故事必须提交 4 个行动候选和 1 个场景候选；剧本模式只提交 1 项变化，填入 actions 或 scene，另一项留空。',
  parameters: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      actions: { type: 'array', minItems: 0, maxItems: 4, items: { type: 'string', minLength: 1 } },
      scene: { type: 'string' }
    },
    required: ['actions', 'scene']
  })
})

export const SCRIPT_READ_TOOL = Object.freeze({
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

export const SCRIPT_POINT_TOOL = Object.freeze({
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
    const projected = projectAgentContent(chunk.text, {
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
  const tasks = options.tasks || createBackgroundTaskCoordinator({ store, timeline })
  const characterDesign = options.characterDesign
  const waitUntilSettled = typeof options.waitUntilSettled === 'function' ? options.waitUntilSettled : async function () {}
  const now = typeof options.now === 'function' ? options.now : Date.now
  const logger = options.logger || console

  async function prepare(input) {
    async function reportStage(stage) {
      if (typeof input.onStage !== 'function') return
      try {
        await input.onStage(stage)
      } catch (error) {
        if (logger && typeof logger.warn === 'function') logger.warn(`dsh-tavern: 候选任务阶段 ${stage} 发布失败，将继续执行并由持久状态恢复：${str(error && error.message || error)}`)
      }
    }
    let chat = await store.chatForSession(input.sessionId)
    if (chat === undefined || chat === null) throw new Error('当前会话没有绑定人物卡')
    const mode = chat.mode || 'story'
    if (mode === 'card') throw new Error('卡片模式不生成剧情候选项')
    const requestId = str(input.requestId).trim().slice(0, 160)
    let taskRun = null
    const activity = tasks.activity(chat)
    if (activity.busy) {
      try { taskRun = await tasks.begin(chat, 'candidate', { requestId, bindExistingSession: true, prepareCommit: input.prepareCommit }) }
      catch (_error) { throw new Error('后台 Agent 正在执行 ' + activity.role + '，请等待完成后再生成候选项') }
    }
    function preparedValue() {
      if (typeof input.onStarted === 'function') input.onStarted({ operationId: taskRun.operationId, basedOn: taskRun.basedOn })
      if (taskRun.created !== false) return null
      return Object.freeze({
        operationId: taskRun.operationId,
        basedOn: taskRun.basedOn,
        created: false,
        async execute() { throw new Error('重复的候选启动请求不能再次执行') }
      })
    }
    if (taskRun !== null) {
      const duplicate = preparedValue()
      if (duplicate !== null) return duplicate
    }
    await waitUntilSettled(chat)
    chat = await store.readChat(chat.id)
    if (chat === undefined) throw new Error('聊天不存在')
    const expectedTimeline = { branchId: str(chat.timeline?.branchId), revision: Number(chat.timeline?.revision) || 0 }
    const cardPath = str(chat.cardPath || chat.cardId)
    const card = await store.readCard(cardPath, chat)
    if (card === undefined) throw new Error('人物卡不存在: ' + cardPath)
    const selection = model.selection(chat)
    if (selection === null || selection === undefined) throw new Error('没有可用的模型配置')
    const scriptMode = mode === 'script'
    let script = null
    let scriptWindow = null
    if (scriptMode) {
      script = scriptForState(await store.readScript(cardPath), chat.scriptState)
      if (script === undefined || !Array.isArray(script.chunks) || script.chunks.length === 0) throw new Error('剧本文件不存在，请重新为人物卡导入剧本')
      scriptWindow = scripts.inspect({ script, state: chat.scriptState, request: { kind: 'choice' } })
    }
    const backgroundTasks = await options.backgroundTasks?.(chat)
    const designEnabled = backgroundTasks?.characterDesign !== false
    const task = prompt(scriptMode ? 'candidate-script' : 'candidate-story')
    const preparedWorldbook = typeof options.worldBookContext === 'function' ? await options.worldBookContext(chat, card) : undefined
    const constantWorldBookContext = preparedWorldbook !== undefined ? preparedWorldbook.context : typeof options.stableWorldBookContext === 'function'
      ? await options.stableWorldBookContext(chat, card) : ''
    const context = await planner.plan({ purpose: 'candidate', card, chat, task, scriptWindow, constantWorldBookContext })
    taskRun = await tasks.begin(chat, 'candidate', { requestId, bindExistingSession: true, prepareCommit: input.prepareCommit, expectedTimeline })
    chat = taskRun.chat
    const duplicate = preparedValue()
    if (duplicate !== null) return duplicate
    const currentScriptWindow = scriptMode ? scripts.inspect({ script, state: chat.scriptState, request: { kind: 'choice' } }) : null
    if (scriptMode && (currentScriptWindow.cursor !== scriptWindow.cursor || currentScriptWindow.sourceOffset !== scriptWindow.sourceOffset || currentScriptWindow.chunkSize !== scriptWindow.chunkSize)) {
      const error = new Error('剧本游标已变化，请重新生成候选项')
      await taskRun.fail(error)
      throw error
    }
    const participantRequest = taskRun.participantRequest
    const persistentSessionId = str(participantRequest.sessionId)
    const guidance = str(input.guidance).trim().slice(0, 600)
    let request = '请按上述规则生成候选项。'
    if (guidance !== '') request += '\n\n【用户额外要求】\n' + guidance + '\n\n额外要求不改变 ' + (scriptMode ? '剧本走向、' : '') + (scriptMode ? 1 : 5) + ' 个候选及类型约束。'
    const backgroundAlreadySynced = persistentSessionId !== '' && Number(participantRequest.syncedRevision) === Number(taskRun.basedOn.revision)
    const recentMessages = backgroundAlreadySynced ? [] : buildMessages(chat, card, selection, now, persistentSessionId !== '' ? 1 : 6)
    const messages = recentMessages.concat([{
      id: 'choices-' + now().toString(36),
      role: 'user',
      content: [{ type: 'text', text: request }],
      source: { kind: 'plugin:dsh-tavern' }
    }])
    const research = scriptMode ? scriptResearchAttempt(script, scriptWindow, card, chat) : null
    let submittedChoices = null
    let submissionError = null
    async function onToolCall(call) {
      if (call && (call.name === CHARACTER_DESIGN_READ_TOOL.name || call.name === CHARACTER_DESIGN_SAVE_TOOL.name)) {
        if (!designEnabled) return JSON.stringify({ ok: false, error: '人物设计已关闭' })
        if (!characterDesign || typeof characterDesign.execute !== 'function') {
          return JSON.stringify({ ok: false, retryable: false, error: '人物设计存储不可用，请继续完成候选生成' })
        }
        return await characterDesign.execute(chat.id, call)
      }
      if (call && call.name === CANDIDATE_SUBMIT_TOOL_NAME) {
        try {
          const args = call.arguments !== null && typeof call.arguments === 'object' ? call.arguments : parseJsonLenient(call.arguments)
          const actions = Array.isArray(args.actions) ? args.actions.map(function (text) {
            return projectCandidateIdentityMacros(text, card, chat).trim()
          }).filter(Boolean) : []
          const scene = projectCandidateIdentityMacros(args.scene, card, chat).trim()
          const source = actions.map(function (text) { return { type: 'action', text } })
          if (scene !== '') source.push({ type: 'scene', text: scene })
          submittedChoices = validatedChoices(source, scriptMode, logger)
          submissionError = null
          return JSON.stringify({ ok: true, accepted: submittedChoices.length })
        } catch (error) {
          submittedChoices = null
          submissionError = error
          return JSON.stringify({ ok: false, retryable: true, error: str(error && error.message || error) })
        }
      }
      if (research !== null) return research.onToolCall(call)
      return JSON.stringify({ ok: false, retryable: true, error: '当前候选任务只允许调用 candidate_submit_choices' })
    }
    const callOptions = {
      onPersistentSessionReady: id => taskRun.bindSession(id, { stateOnly: true }),
      preparedWorldbook,
      sessionId: input.sessionId,
      task: 'candidate',
      backgroundTasks,
      selection,
      temperature: 0.8,
      system: [
        context.taskText,
        ...(designEnabled ? ['若确实需要建立、补全或修订长期人物设计，在当前后台 Agent 内调用 skill 加载 character-design，并按 Skill 使用人物档案工具；无需也不得创建另一个 Agent。完成后继续提交候选项。'] : [])
      ].join('\n\n'),
      backgroundContext: context.stableText,
      turnContext: context.dynamicText,
      candidateScriptWindow: context.candidateScriptWindow,
      systemPromptText: context.systemPromptText,
      postHistoryText: context.postHistoryText,
      messages,
      persistent: true,
      persistentSessionId,
      rewindTo: participantRequest.rewindTo,
      rewindFormatVersion: participantRequest.formatVersion,
      webSearchEnabled: chat.webSearchEnabled === true
    }
    async function execute() {
      let run
      try {
        await reportStage('generating')
        run = await model.runCandidate(Object.assign({}, callOptions, {
          tools: [...(scriptMode ? [SCRIPT_READ_TOOL, SCRIPT_POINT_TOOL] : []), ...(designEnabled ? [CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL] : []), CANDIDATE_SUBMIT_TOOL],
          onToolCall,
          maxToolCalls: scriptMode ? 15 : 10,
          stopToolsWhen: function () { return submittedChoices !== null },
          acceptWithoutText: function () { return submittedChoices !== null }
        }))
      } catch (error) {
        await taskRun.fail(error).catch(function (persistError) {
          if (logger && typeof logger.warn === 'function') logger.warn(`dsh-tavern: 候选模型失败后无法持久化终态：${str(persistError && persistError.message || persistError)}`)
        })
        if (logger && typeof logger.error === 'function') logger.error('dsh-tavern: 候选项生成失败:', str(error && error.message || error))
        throw candidateFailure('generating', '候选 Agent 生成失败', error)
      }
      const text = run.text
      const traceSessionId = str(run.traceSessionId)
      const participant = taskRun.participant(run)
      let choices
      try {
        await reportStage('validating')
        if (submittedChoices === null) throw submissionError || new Error('模型未调用 candidate_submit_choices 提交有效候选项')
        choices = submittedChoices
      } catch (error) {
        if (logger && typeof logger.error === 'function') {
          logger.error('dsh-tavern: 候选项输出无效:', str(error && error.message || error))
          logger.error('dsh-tavern: 候选项原始输出:', str(text).slice(0, 1200))
        }
        await taskRun.commit({ stateChanged: false, participant }).catch(function (persistError) {
          if (logger && typeof logger.warn === 'function') logger.warn(`dsh-tavern: 候选输出无效后无法持久化终态：${str(persistError && persistError.message || persistError)}`)
        })
        throw candidateFailure('validating', '候选输出无效', error)
      }
      let savedCandidates = null
      let completed
      try {
        await reportStage('committing')
        completed = await taskRun.commit({
          // Choices change no story: only a script's cursor moves the story revision, which
          // would otherwise void work fenced on it, like this turn's stage director.
          stateChanged: scriptMode,
          headerOnly: true,
          participant,
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
              requestId, operationId: taskRun.operationId,
              traceSessionId, traceSessionIds: traceSessionId === '' ? [] : [traceSessionId],
              traceMode: 'continuable', basedOn: taskRun.basedOn
            }
            savedCandidates = draft.candidates
          }
        })
      } catch (error) {
        throw candidateFailure('committing', '候选已经生成，但保存失败', error)
      }
      if (completed.status === 'missing') throw new Error('聊天不存在: ' + chat.id)
      if (completed.status !== 'committed') throw new Error('剧情状态已变化，本次候选项已作废，请重新生成')
      await reportStage('publishing')
      return {
        messageId: savedCandidates.messageId,
        choices: savedCandidates.choices,
        generatedAt: savedCandidates.generatedAt,
        requestId: savedCandidates.requestId,
        operationId: savedCandidates.operationId,
        traceSessionId: savedCandidates.traceSessionId,
        traceSessionIds: savedCandidates.traceSessionIds,
        traceMode: savedCandidates.traceMode,
        basedOn: savedCandidates.basedOn
      }
    }
    return Object.freeze({ operationId: taskRun.operationId, basedOn: taskRun.basedOn, created: true, startCommitted: taskRun.startCommitted === true, execute })
  }

  async function generate(input) {
    const prepared = await prepare(input)
    return await prepared.execute()
  }

  async function find(input) {
    const chat = await (store.stateForSession || store.chatForSession)(input.sessionId)
    if (chat === undefined || chat.candidates === null || typeof chat.candidates !== 'object' || str(chat.candidates.messageId) !== str(input.messageId)) return null
    const limit = (chat.mode || 'story') === 'script' ? 1 : 5
    const choices = Array.isArray(chat.candidates.choices) ? chat.candidates.choices.map(function (item) {
      return { type: item.type === 'scene' || item.type === 'scene2' ? 'scene' : 'action', text: str(item.text).trim() }
    }).filter(function (item) { return item.text !== '' }).slice(0, limit) : []
    if (choices.length === 0) return null
    const traceSessionIds = Array.isArray(chat.candidates.traceSessionIds) ? chat.candidates.traceSessionIds.map(str).filter(function (id) { return id !== '' }) : []
    const traceSessionId = str(chat.candidates.traceSessionId) || traceSessionIds[traceSessionIds.length - 1] || ''
    return {
      messageId: str(chat.candidates.messageId), choices, generatedAt: Number(chat.candidates.generatedAt) || 0,
      requestId: str(chat.candidates.requestId), operationId: str(chat.candidates.operationId),
      traceSessionId, traceSessionIds, traceMode: chat.candidates.traceMode === 'continuable' ? 'continuable' : 'one-shot',
      basedOn: chat.candidates.basedOn || null
    }
  }

  return Object.freeze({ prepare, generate, find })
}
