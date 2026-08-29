import { createEphemeralCompatibilityRequest, isCompatibilityConversationRequest } from './compatibility-request.js'
import { projectRuntimePresetRequest } from './runtime-preset-lifecycle.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function contentText(message) {
  return (Array.isArray(message && message.content) ? message.content : [])
    .filter(function (item) { return item && item.type === 'text' })
    .map(function (item) { return str(item.text) })
    .join('\n')
}

function isTurnInput(message) {
  const source = message && message.source
  return source && (source.kind === 'user' || (source.kind === 'plugin' && source.plugin === 'dsh-tavern-regen'))
}

function userTextOf(messages) {
  return (Array.isArray(messages) ? messages : []).filter(isTurnInput).map(contentText).filter(Boolean).join('\n').trim()
}

function replaceTurnInput(messages, text) {
  const result = Array.isArray(messages) ? messages.slice() : []
  for (let index = result.length - 1; index >= 0; index--) {
    const message = result[index]
    if (!isTurnInput(message)) continue
    result[index] = Object.assign({}, message, {
      content: [{ type: 'text', text: str(text).trim() || '（玩家已更新酒馆运行状态）' }]
    })
    break
  }
  return result
}

function snapshotMessage(text) {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: str(text) }],
    source: {
      kind: 'plugin', plugin: 'dsh-tavern', form: 'snapshot',
      sections: [{ name: 'tavern:turn', text: str(text) }]
    }
  }
}

export function createCompatibilityOrchestrationStrategy(options) {
  const stagedRequests = new Map()
  const redispatches = new WeakSet()

  async function prepareStep(input) {
    const sessionId = input.sessionId
    const payload = input.payload
    let chat = input.chat
    const userText = userTextOf(payload.messages)
    if (Number(payload.step) === 1) {
      await options.beforeTurn({ sessionId, chat, userText })
      await options.beginTurn({ sessionId, turn: payload.turn, userText })
      chat = await options.chatForSession(sessionId)
    }
    const compiled = await options.compileTurn(chat, userText)
    await options.persistCompiled({ chat, compiled, turn: payload.turn })
    stagedRequests.set(sessionId, {
      turn: Number(payload.turn) || 0,
      step: Number(payload.step) || 0,
      messages: options.projectMessages(compiled)
    })
    return { kind: 'enter', messages: payload.messages }
  }

  function projectRequest(optionsValue, coordinates) {
    const sessionId = str(optionsValue && optionsValue.sessionId)
    const staged = stagedRequests.get(sessionId)
    if (redispatches.has(optionsValue) || !isCompatibilityConversationRequest(optionsValue, staged, coordinates)) return null
    const request = createEphemeralCompatibilityRequest(optionsValue, staged.messages)
    redispatches.add(request)
    return request
  }

  function completeRequest(optionsValue, completed) {
    if (!completed || !redispatches.has(optionsValue)) return false
    stagedRequests.delete(str(optionsValue && optionsValue.sessionId))
    return true
  }

  function endTurn(sessionId) {
    stagedRequests.delete(str(sessionId))
  }

  async function assembleSystemPrompt(assembly) {
    assembly.sections = []
    assembly.contexts = []
    assembly.tools = []
    return assembly
  }

  return Object.freeze({ kind: 'compatibility', prepareStep, projectRequest, completeRequest, endTurn, assembleSystemPrompt })
}

export function createNativePlayOrchestrationStrategy(options) {
  const stagedRequests = options.stagedRequests instanceof Map ? options.stagedRequests : new Map()
  const redispatches = new WeakSet()

  async function prepareStep(input) {
    const sessionId = input.sessionId
    const payload = input.payload
    const mode = await options.modeFor(sessionId)
    const visibleMessages = options.filterMessages(input.decision.messages, mode)
    const decision = visibleMessages === input.decision.messages ? input.decision : Object.assign({}, input.decision, { messages: visibleMessages })
    let agentMessages = decision.messages
    const snapshot = mode === 'story' || mode === 'script' ? await options.resolvePreset(input.chat) : null
    if (mode === 'story' || mode === 'script') {
      stagedRequests.set(sessionId, {
        turn: Math.max(0, Number(payload.turn) || 0),
        step: Math.max(1, Number(payload.step) || 1),
        scope: 'foreground',
        snapshot: snapshot || null
      })
    }
    if (Number(payload.step) === 1) {
      const prepared = await options.prepareTurn({ sessionId, turn: payload.turn, userText: userTextOf(payload.messages) })
      if (mode === 'story' || mode === 'script') {
        agentMessages = replaceTurnInput(decision.messages, prepared.frame.userInput.projectedText)
        const adapted = options.appendFrame({ messages: agentMessages, frame: prepared.frame, step: payload.step })
        agentMessages = adapted.messages
        options.recordFrame(sessionId, prepared.frame, adapted.receipt)
      } else {
        agentMessages = decision.messages.concat([snapshotMessage(prepared.text)])
      }
    }
    return { kind: 'enter', messages: agentMessages }
  }

  function projectRequest(optionsValue) {
    const sessionId = str(optionsValue && optionsValue.sessionId)
    const staged = stagedRequests.get(sessionId)
    if (optionsValue === null || typeof optionsValue !== 'object' || optionsValue.purpose !== undefined || staged === undefined || redispatches.has(optionsValue)) return null
    const request = projectRuntimePresetRequest(optionsValue, staged.snapshot, {
      scope: staged.scope,
      turn: staged.turn,
      step: staged.step
    })
    if (request === optionsValue) return null
    redispatches.add(request)
    return request
  }

  function completeRequest(optionsValue, completed) {
    if (!completed || !redispatches.has(optionsValue)) return false
    stagedRequests.delete(str(optionsValue && optionsValue.sessionId))
    return true
  }

  function clearRequestState(sessionId) {
    stagedRequests.delete(str(sessionId))
  }

  async function assembleSystemPrompt(assembly, input) {
    const mode = await options.modeFor(input.sessionId)
    const visible = new Set(await options.visibleTools(input.sessionId))
    const sections = [{ name: 'tavern:mode-persona', text: options.modePrompt(mode) }]
    if (mode === 'card') {
      const workspace = options.workspaceContext(input.cwd)
      if (workspace !== '') sections.push({ name: 'tavern:resource-workspace', text: workspace })
    } else {
      const cardSnapshot = await options.ensureCardSnapshot(input.chat)
      if (cardSnapshot !== '') sections.push({ name: 'tavern:card-snapshot', text: cardSnapshot })
    }
    assembly.sections = sections
    assembly.tools = assembly.tools.filter(function (schema) {
      return !options.controlledToolNames.has(schema.name) || visible.has(schema.name)
    })
    return assembly
  }

  return Object.freeze({ kind: 'native-play', prepareStep, projectRequest, completeRequest, clearRequestState, assembleSystemPrompt })
}

export function createForegroundOrchestrationStrategies(options) {
  const nativePlay = createNativePlayOrchestrationStrategy(options.nativePlay)
  const compatibility = createCompatibilityOrchestrationStrategy(options.compatibility)

  function select(chat) {
    return chat && chat.requestMode === 'sillytavern' ? compatibility : nativePlay
  }

  async function prepareStep(input) {
    return await select(input.chat).prepareStep(input)
  }

  function projectRequest(optionsValue, coordinates) {
    return compatibility.projectRequest(optionsValue, coordinates) || nativePlay.projectRequest(optionsValue, coordinates)
  }

  function completeRequest(optionsValue, completed) {
    compatibility.completeRequest(optionsValue, completed)
    nativePlay.completeRequest(optionsValue, completed)
  }

  function clearRequestState(sessionId) {
    nativePlay.clearRequestState(sessionId)
  }

  function endTurn(sessionId) {
    compatibility.endTurn(sessionId)
  }

  async function assembleSystemPrompt(assembly, input) {
    return await select(input.chat).assembleSystemPrompt(assembly, input)
  }

  return Object.freeze({ prepareStep, projectRequest, completeRequest, clearRequestState, endTurn, assembleSystemPrompt })
}
