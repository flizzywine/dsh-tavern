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

function isRegenerationInput(message) {
  const source = message && message.source
  return source && source.kind === 'plugin' && source.plugin === 'dsh-tavern-regen'
}

function isOriginalPlayerInput(message) {
  const source = message && message.source
  return message && message.role === 'user' && source && source.kind === 'user'
}

/**
 * A body replacement is executed as a new append-only Agent turn, but the
 * provider request must look like a fresh sample of the replaced story turn.
 * Keep the original player-message identity, replace only its projected text,
 * and remove the old turn frame/assistant plus the internal retry carrier.
 */
export function projectRegenerationRequestMessages(messages) {
  const source = Array.isArray(messages) ? messages : []
  let regenerationIndex = -1
  for (let index = source.length - 1; index >= 0; index--) {
    if (isRegenerationInput(source[index])) { regenerationIndex = index; break }
  }
  if (regenerationIndex < 0) return source
  let assistantIndex = -1
  for (let index = regenerationIndex - 1; index >= 0; index--) {
    if (source[index] && source[index].role === 'assistant') { assistantIndex = index; break }
  }
  if (assistantIndex < 0) return source
  let playerIndex = -1
  for (let index = assistantIndex - 1; index >= 0; index--) {
    if (isOriginalPlayerInput(source[index])) { playerIndex = index; break }
  }
  if (playerIndex < 0) return source
  const projectedPlayer = Object.assign({}, source[playerIndex], {
    content: Array.isArray(source[regenerationIndex].content) ? structuredClone(source[regenerationIndex].content) : []
  })
  return source.slice(0, playerIndex).concat([projectedPlayer], source.slice(regenerationIndex + 1))
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

function projectLegacyTemplatePrefix(messages, text) {
  const replacement = str(text).trim()
  if (replacement === '' || !Array.isArray(messages)) return messages
  let changed = false
  const projected = messages.map(function (message) {
    const source = message && message.source
    const current = contentText(message)
    if (!source || source.kind !== 'plugin' || source.plugin !== 'dsh-tavern' || source.form !== 'snapshot' || !/<%[=_-]?[\s\S]*?%>/.test(current)) return message
    changed = true
    return Object.assign({}, message, {
      content: [{ type: 'text', text: replacement }],
      source: Object.assign({}, source, { sections: [{ name: 'tavern:session-context', text: replacement }] })
    })
  })
  return changed ? projected : messages
}

function projectLegacyOpeningSources(messages) {
  let changed = false
  const projected = (Array.isArray(messages) ? messages : []).map(function (message) {
    const source = message && message.source
    const text = contentText(message)
    if (!str(message && message.id).startsWith('tavern-opening:') || message.role !== 'assistant'
      || !source || source.kind !== 'model' || text === '') return message
    changed = true
    return Object.assign({}, message, {
      source: { kind: 'model', provider: 'dsh-tavern', model: 'character-card' }
    })
  })
  return changed ? projected : messages
}

function legacyDeepSeekReplayBlocks(content) {
  if (!Array.isArray(content) || !content.some(function (block) { return block && block.type === 'reasoning' })) return null
  const blocks = []
  for (const block of content) {
    if (block && block.type === 'reasoning') blocks.push({ type: 'reasoning', thinkingSignature: 'reasoning_content' })
    else if (block && block.type === 'text') blocks.push({ type: 'text' })
    else if (block && block.type === 'tool-call') blocks.push({ type: 'tool-call' })
    else return null
  }
  return blocks
}

/** Restore the provider replay envelope that pre-0.1.2 DSH Sessions lack. */
function projectLegacyDeepSeekReasoningReplay(messages, request) {
  const provider = str(request && request.provider)
  const model = str(request && request.model)
  if (!/^deepseek(?:-|$)/i.test(provider) || str(request && request.reasoningEffort) === 'off') return messages
  let changed = false
  const projected = (Array.isArray(messages) ? messages : []).map(function (message) {
    const source = message && message.source
    if (!source || source.kind !== 'model' || source.replayState !== undefined || str(source.provider) !== provider || str(source.model) !== model) return message
    const blocks = legacyDeepSeekReplayBlocks(message.content)
    if (blocks === null) return message
    changed = true
    return Object.assign({}, message, {
      source: Object.assign({}, source, {
        replayState: {
          response: {
            kind: 'pi-ai', version: 2, api: 'openai-completions', provider, model,
            stopReason: blocks.some(function (block) { return block.type === 'tool-call' }) ? 'toolUse' : 'stop'
          },
          blocks
        }
      })
    })
  })
  return changed ? projected : messages
}

function projectDeepSeekThinkingPassback(messages, request) {
  const provider = str(request && request.provider)
  if (!/^deepseek(?:-|$)/i.test(provider) || str(request && request.reasoningEffort) === 'off') return messages
  let changed = false
  const projected = (Array.isArray(messages) ? messages : []).map(function (message) {
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)
      || message.content.some(function (block) { return block && block.type === 'reasoning' })) return message
    changed = true
    const source = message.source && message.source.kind === 'model' && message.source.replayState !== undefined
      ? Object.assign({}, message.source, { replayState: undefined }) : message.source
    // DeepSeek thinking requires reasoning_content on every assistant history
    // message. Synthetic Tavern context has no private reasoning to replay, so
    // use a whitespace carrier instead of inventing chain-of-thought content.
    return Object.assign({}, message, {
      content: [{ type: 'reasoning', text: ' ' }].concat(message.content),
      ...(source === message.source ? {} : { source })
    })
  })
  return changed ? projected : messages
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
      const begun = await options.beginTurn({ sessionId, turn: payload.turn, requestId: input.requestId, userText })
      if (begun && begun.duplicate) throw new Error('该消息已由酒馆处理，请勿重复发送')
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

  async function assembleSystemPrompt(assembly, input) {
    assembly.sections = []
    assembly.contexts = []
    assembly.tools = input && input.chat && input.chat.webSearchEnabled === true
      ? assembly.tools.filter(function (tool) { return tool && tool.name === 'web_search' })
      : []
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
    let agentMessages = visibleMessages
    const snapshot = mode === 'story' || mode === 'script' ? await options.resolvePreset(input.chat) : null
    if (mode === 'story' || mode === 'script') {
      if (Number(payload.step) === 1 && typeof options.synchronizeTail === 'function') {
        await options.synchronizeTail({ sessionId, chat: input.chat, payload })
      }
      // ensureSessionPrefix writes the fixed context directly to the DSH
      // Session surface. Returning it in this incoming batch would make the
      // Agent loop append the same message ID a second time and break Chat's
      // node index; request derivation reads the newly written surface itself.
      const stablePrefix = typeof options.ensureSessionPrefix === 'function' ? await options.ensureSessionPrefix(input) : null
      stagedRequests.set(sessionId, {
        turn: Math.max(0, Number(payload.turn) || 0),
        step: Math.max(1, Number(payload.step) || 1),
        scope: 'foreground',
        snapshot: snapshot || null,
        stablePrefixText: str(stablePrefix && stablePrefix.projectedText)
      })
    }
    if (Number(payload.step) === 1) {
      const prepared = await options.prepareTurn({ sessionId, turn: payload.turn, requestId: input.requestId, userText: userTextOf(payload.messages) })
      if (prepared && prepared.duplicate) throw new Error('该消息已由酒馆处理，请勿重复发送')
      if (mode === 'story' || mode === 'script') {
        agentMessages = replaceTurnInput(agentMessages, prepared.frame.userInput.projectedText)
        const adapted = options.appendFrame({ messages: agentMessages, frame: prepared.frame, step: payload.step })
        agentMessages = adapted.messages
        options.recordFrame(sessionId, prepared.frame, adapted.receipt)
      } else if (str(prepared.text).trim() !== '') {
        agentMessages = agentMessages.concat([snapshotMessage(prepared.text)])
      }
    }
    return { kind: 'enter', messages: agentMessages }
  }

  function projectRequest(optionsValue) {
    const sessionId = str(optionsValue && optionsValue.sessionId)
    const staged = stagedRequests.get(sessionId)
    if (optionsValue === null || typeof optionsValue !== 'object' || optionsValue.purpose !== undefined || staged === undefined || redispatches.has(optionsValue)) return null
    const regeneratedMessages = projectRegenerationRequestMessages(optionsValue.messages)
    const baseRequest = regeneratedMessages === optionsValue.messages
      ? optionsValue : Object.assign({}, optionsValue, { messages: regeneratedMessages })
    let request = projectRuntimePresetRequest(baseRequest, staged.snapshot, {
      scope: staged.scope,
      turn: staged.turn,
      step: staged.step
    })
    const projectedMessages = projectLegacyTemplatePrefix(request.messages, staged.stablePrefixText)
    if (projectedMessages !== request.messages) request = Object.assign({}, request, { messages: projectedMessages })
    const openingMessages = projectLegacyOpeningSources(request.messages)
    if (openingMessages !== request.messages) request = Object.assign({}, request, { messages: openingMessages })
    const replayMessages = projectLegacyDeepSeekReasoningReplay(request.messages, request)
    if (replayMessages !== request.messages) request = Object.assign({}, request, { messages: replayMessages })
    const passbackMessages = projectDeepSeekThinkingPassback(request.messages, request)
    if (passbackMessages !== request.messages) request = Object.assign({}, request, { messages: passbackMessages })
    // DSH's renderer returns '' for no sections; adapters otherwise serialize
    // it as an empty system message. Preserve any explicit non-empty prompt.
    if (request.system === '') {
      request = Object.assign({}, request)
      delete request.system
    }
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
    // Play rules arrive in the foreground frame. Still replace the inherited
    // sections explicitly so removing play-mode cannot restore DSH's persona.
    const sections = []
    if (mode === 'card') {
      sections.push({ name: 'tavern:mode-persona', text: options.modePrompt(mode) })
      const workspace = options.workspaceContext(input.cwd, input.workspaceProjection)
      if (workspace !== '') sections.push({ name: 'tavern:resource-workspace', text: workspace })
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
    if (chat && chat.requestMode === 'sillytavern') throw new Error('兼容模式已停用，原对话存档保留，请新建游玩对话')
    return nativePlay
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
