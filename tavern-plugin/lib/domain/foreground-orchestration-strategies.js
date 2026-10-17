import { createHash, randomBytes } from 'node:crypto'
import { inputAttachments, projectPlayerContent } from './player-input-content.js'
import { resolveRuntimePresetMacros } from './runtime-presets.js'
import { createEphemeralCompatibilityRequest, isCompatibilityConversationRequest } from './compatibility-request.js'
import { projectRuntimePresetRequest } from './runtime-preset-lifecycle.js'
import { STORY_SUBMIT_PROMPT, STORY_SUBMIT_TOOL_NAME } from './story-tool-submission.js'
import { markRequestHandled, requestHandledBy } from './request-lineage.js'
import { inputKind } from './session-turn-input.js'
import { isProducerSource, isSystemPromptSource } from './message-source.js'

const CARD_REFERENCE_SECTIONS = new Set(['tavern:character-card', 'tavern:card-system-prompt', 'tavern:constant-worldbook'])
// The card Agent resends its system prompt on every tool step and reads live
// files anyway; a large card's reference material would dominate each request.
export const CARD_REFERENCE_WORLDBOOK_LIMIT = 8000
export const CARD_REFERENCE_SECTION_LIMIT = 8000

function cardReferenceSection(section) {
  const text = str(section.text)
  if (section.name === 'tavern:constant-worldbook') {
    const chars = Array.from(text.replace(/^【常驻世界书】\n?/, '').trim()).length
    if (chars <= CARD_REFERENCE_WORLDBOOK_LIMIT) return section
    return { name: section.name, text: '【常驻世界书】\n共约 ' + chars + ' 字，超过预载上限，未放入参考资料。需要时用 tavern_read_worldbook 按关键词或编号读取相关条目。' }
  }
  const chars = Array.from(text).length
  if (chars <= CARD_REFERENCE_SECTION_LIMIT) return section
  const [title, name] = text.split('\n')
  if (section.name === 'tavern:character-card') {
    return { name: section.name, text: title + '\n' + (/^名字: /.test(name || '') ? name + '\n' : '') + '人物卡设定共约 ' + chars + ' 字，超过预载上限，未放入参考资料。需要时用 tavern_read_card 按字段读取。' }
  }
  return { name: section.name, text: title + '\n共约 ' + chars + ' 字，超过预载上限，未放入参考资料。需要时用 tavern_read_card 读取 system_prompt 字段。' }
}

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function contentText(message) {
  return (Array.isArray(message && message.content) ? message.content : [])
    .filter(function (item) { return item && item.type === 'text' })
    .map(function (item) { return str(item.text) })
    .join('\n')
}

// A provider request carries the player's input or a regenerate attempt;
// legacy replay inputs are resent as the player's own message and never appear here.
function isTurnInput(message) {
  return ['player', 'regenerate'].includes(inputKind(message))
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
      content: projectPlayerContent(message.content, str(text).trim())
    })
    break
  }
  return result
}

function isRegenerationInput(message) {
  return inputKind(message) === 'regenerate'
}

function isOriginalPlayerInput(message) {
  return Boolean(message && message.role === 'user' && inputKind(message) === 'player')
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
      kind: 'plugin:dsh-tavern', form: 'snapshot',
      sections: [{ name: 'tavern:turn', text: str(text) }]
    }
  }
}

function hasProviderContent(message) {
  if (!message || !['user', 'assistant'].includes(message.role) || !Array.isArray(message.content)) return true
  return message.content.some(block => block && (block.type !== 'text' || /\S/.test(str(block.text))))
}

function isNativeStablePrefix(message) {
  const source = message && message.source
  return str(message && message.id).startsWith('tavern-session-prefix:') && message.role === 'user'
    && isProducerSource(source, 'dsh-tavern')
    && (source.form === 'snapshot' || source.form === 'session-prefix')
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

// Copies made by later hooks (workspace presentation) must still count as projected.
const PROJECTED = 'foreground-projection'

export function createCompatibilityOrchestrationStrategy(options) {
  const stagedRequests = new Map()

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
    const compiled = await options.compileTurn(chat, chat.runtimeInputs?.[String(payload.turn)]?.text ?? userText, inputAttachments(payload.messages.filter(isTurnInput).flatMap(message => message.content || [])))
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
    if (requestHandledBy(optionsValue, PROJECTED) || !isCompatibilityConversationRequest(optionsValue, staged, coordinates)) return null
    return markRequestHandled(createEphemeralCompatibilityRequest(optionsValue, staged.messages), PROJECTED)
  }

  function completeRequest(optionsValue, completed) {
    if (!completed || !requestHandledBy(optionsValue, PROJECTED)) return false
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

// The preset front phase is part of the native system prompt, so it is recorded in
// the session trajectory like the fixed card background. Every replay of that
// trajectory (manual, scheduled and native compaction) then starts with exactly
// the bytes the foreground sent, and keeps the provider's prefix cache. Projecting
// it only at request time made every compaction request diverge from token one.
// Request evidence only: mark where the front phase sits inside the native system
// message so the request viewer can still label it. Message sources never reach
// the provider, and the trajectory keeps its own unannotated message.
function labelPresetFront(messages, texts) {
  if (!Array.isArray(messages) || !texts?.length) return messages
  const index = messages.findIndex(message => message?.role === 'system' && isSystemPromptSource(message.source))
  const message = messages[index]
  const body = (message?.content || []).map(block => block?.type === 'text' ? block.text : '').join('')
  if (index < 0 || !texts.every(text => body.includes(text))) return messages
  const copy = messages.slice()
  copy[index] = { ...message, source: { ...message.source, sections: texts.map(text => ({ name: 'tavern:runtime-preset-front', text })) } }
  return copy
}

function presetFrontSections(snapshot) {
  const entries = Array.isArray(snapshot?.front?.entries) ? snapshot.front.entries : []
  // The front phase is resolved by Tavern's own macro engine; unknown extension macros (for example
  // "{{压缩相邻消息::...}}" from ecosystem preset tools) intentionally stay literal. DSH's strict
  // system-prompt variable scanner would reject any residual {{...}} as a malformed variable, so the
  // section must be non-interpolating to keep those macros verbatim instead of failing the turn.
  return entries.filter(entry => str(entry?.content).trim() !== '')
    .map(entry => ({ name: 'tavern:runtime-preset-front', text: str(entry.content), interpolate: false }))
}

export function createNativePlayOrchestrationStrategy(options) {
  const stagedRequests = options.stagedRequests instanceof Map ? options.stagedRequests : new Map()
  // Digest of the front rendered by the latest assembly, and of the one last entered into a step.
  const renderedFronts = new Map()
  const enteredFronts = new Map()
  // Front texts of the step being prepared, only to label the request evidence.
  const frontTexts = new Map()
  // Per-session dice seed: drawn on a turn's first step, so every step of one turn rolls
  // the same and a new turn or regeneration rolls again.
  const presetSeeds = new Map()
  function presetSeed(sessionId, turn, step) {
    const current = presetSeeds.get(sessionId)
    if (step > 1 && current && current.turn === turn) return current.seed
    const seed = randomBytes(16).toString('hex')
    presetSeeds.set(sessionId, { turn, seed })
    return seed
  }

  async function prepareStep(input) {
    const sessionId = input.sessionId
    const payload = input.payload
    const mode = await options.modeFor(sessionId)
    const visibleMessages = options.filterMessages(input.decision.messages, mode, {
      session: payload.agent?.session, disabledWritingSkills: input.chat?.disabledWritingSkills
    })
    let agentMessages = visibleMessages
    const rawSnapshot = mode === 'story' || mode === 'script' ? await options.resolvePreset(input.chat) : null
    // Render the three phases together; the persisted preset and prior messages stay authoritative.
    const randomSeed = rawSnapshot ? presetSeed(sessionId, Math.max(0, Number(payload.turn) || 0), Math.max(1, Number(payload.step) || 1)) : undefined
    const snapshot = resolveRuntimePresetMacros(rawSnapshot, { charName: input.chat?.cardName, macroState: input.chat?.macroState, randomSeed }).snapshot
    if (mode === 'story' || mode === 'script') {
      if (Number(payload.step) === 1 && typeof options.synchronizeTail === 'function') {
        await options.synchronizeTail({ sessionId, chat: input.chat, payload })
      }
      // Persist/migrate the fixed system snapshot before native request assembly.
      if (typeof options.ensureSessionPrefix === 'function') await options.ensureSessionPrefix(input)
      stagedRequests.set(sessionId, {
        turn: Math.max(0, Number(payload.turn) || 0),
        step: Math.max(1, Number(payload.step) || 1),
        scope: 'foreground',
        snapshot: snapshot || null
      })
    }
    if (Number(payload.step) === 1) {
      const prepared = await options.prepareTurn({ sessionId, turn: payload.turn, requestId: input.requestId, userText: userTextOf(payload.messages), runtimePresetSnapshot: snapshot })
      if (prepared && prepared.duplicate) throw new Error('该消息已由酒馆处理，请勿重复发送')
      if (mode === 'story' || mode === 'script') {
        agentMessages = replaceTurnInput(agentMessages, prepared.frame.userInput.projectedText)
        const adapted = options.appendFrame({ messages: agentMessages, frame: prepared.frame, step: payload.step, session: payload.agent?.session })
        agentMessages = adapted.messages
        options.recordFrame(sessionId, prepared.frame, adapted.receipt)
      } else if (str(prepared.text).trim() !== '') {
        agentMessages = agentMessages.concat([snapshotMessage(prepared.text)])
      }
    }
    if (mode !== 'story' && mode !== 'script') return { kind: 'enter', messages: agentMessages }
    // Models that update the system prompt in history would otherwise append the
    // new prompt after the old one, leaving a switched-out preset at the head.
    // A new request series makes DSH replace the head instead. Unknown history
    // (first step since startup) starts one too; it is a no-op when nothing changed.
    const front = renderedFronts.get(sessionId) ?? ''
    const switched = enteredFronts.get(sessionId) !== front
    enteredFronts.set(sessionId, front)
    return { kind: 'enter', messages: agentMessages, ...(switched ? { startsRequestSeries: true } : {}) }
  }

  function projectRequest(optionsValue) {
    const sessionId = str(optionsValue && optionsValue.sessionId)
    const staged = stagedRequests.get(sessionId)
    if (optionsValue === null || typeof optionsValue !== 'object' || optionsValue.purpose !== undefined || requestHandledBy(optionsValue, PROJECTED)) return null
    // Empty surface tombstones preserve append-only history, but are not messages
    // for the provider. Remove them before choosing a regeneration target.
    const visibleMessages = (optionsValue.messages || []).filter(hasProviderContent)
    if (staged === undefined) {
      // Card workbench turns are not staged, but they may still carry the empty
      // stable-prefix placeholder (the user preference lives in the system prompt).
      // Strict providers reject an empty user message with HTTP 400.
      const messages = visibleMessages.filter(message => !isNativeStablePrefix(message))
      if (messages.length === (optionsValue.messages || []).length) return null
      return markRequestHandled(Object.assign({}, optionsValue, { messages }), PROJECTED)
    }
    const regeneratedMessages = projectRegenerationRequestMessages(visibleMessages.length === optionsValue.messages?.length ? optionsValue.messages : visibleMessages)
    const nativeMessages = regeneratedMessages.some(isNativeStablePrefix) ? regeneratedMessages.filter(message => !isNativeStablePrefix(message)) : regeneratedMessages
    const baseRequest = nativeMessages === optionsValue.messages
      ? optionsValue : Object.assign({}, optionsValue, { messages: nativeMessages })
    // The front phase is already in the native system prompt (see presetFrontSections).
    const backOnly = staged.snapshot ? { ...staged.snapshot, front: null } : null
    let request = projectRuntimePresetRequest(baseRequest, backOnly, {
      systemAppend: options.systemAppend?.(),
      scope: staged.scope,
      turn: staged.turn,
      step: staged.step
    })
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
    const labelled = labelPresetFront(request.messages, frontTexts.get(sessionId))
    if (labelled !== request.messages) request = Object.assign({}, request, { messages: labelled })
    if (request === optionsValue) return null
    return markRequestHandled(request, PROJECTED)
  }

  function completeRequest(optionsValue, completed) {
    if (!completed || !requestHandledBy(optionsValue, PROJECTED)) return false
    stagedRequests.delete(str(optionsValue && optionsValue.sessionId))
    return true
  }

  function clearRequestState(sessionId) {
    stagedRequests.delete(str(sessionId))
    frontTexts.delete(str(sessionId))
  }

  async function assembleSystemPrompt(assembly, input) {
    const mode = await options.modeFor(input.sessionId)
    const visible = new Set(await options.visibleTools(input.sessionId))
    // Play rules arrive in the foreground frame. Still replace the inherited
    // sections explicitly so removing play-mode cannot restore DSH's persona.
    const cardEdit = mode === 'card' && input.chat?.cardEditContext?.version === 1
    const fixed = input.fixedSystemSections || []
    const sections = mode === 'card' && !cardEdit ? fixed.filter(section => section.name === 'tavern:user-preference') : fixed.slice()
    if (mode === 'card' && !cardEdit) {
      const text = typeof options.cardSystemPrompt === 'function' ? options.cardSystemPrompt().trim() : ''
      if (text) sections.push({ name: 'tavern:card-system', text })
      // Card material is reference data for the card Agent, not its persona.
      const reference = fixed.filter(section => CARD_REFERENCE_SECTIONS.has(section.name))
      if (reference.length) {
        const note = typeof options.cardReferencePrompt === 'function' ? options.cardReferencePrompt().trim() : ''
        if (note) sections.push({ name: 'tavern:card-reference', text: note })
        sections.push(...reference.map(cardReferenceSection))
      }
      const workspace = options.workspaceContext(input.cwd, input.workspaceProjection)
      if (workspace !== '') sections.push({ name: 'tavern:resource-workspace', text: workspace })
    }
    if (mode === 'story' || mode === 'script') {
      const raw = await options.resolvePreset(input.chat)
      const front = presetFrontSections(resolveRuntimePresetMacros(raw, { charName: input.chat?.cardName, macroState: input.chat?.macroState }).snapshot)
      sections.unshift(...front)
      frontTexts.set(input.sessionId, front.map(section => section.text))
      renderedFronts.set(input.sessionId, createHash('sha256').update(JSON.stringify(front.map(section => section.text))).digest('hex'))
      // The submission contract travels with the tool, not with the preset: it is
      // appended after the front so turning the switch off restores the saved prompt.
      if (visible.has(STORY_SUBMIT_TOOL_NAME)) sections.push({ name: 'tavern:story-tool-submission', text: STORY_SUBMIT_PROMPT })
    }
    assembly.sections = sections
    if (Array.isArray(assembly.contexts)) assembly.contexts = assembly.contexts.filter(section => section.name !== 'approval:policy')
    // A plugin's own tool shows everywhere unless the plugin scoped it (tavern.toolModes).
    const group = mode === 'card' ? 'card' : 'play'
    assembly.tools = assembly.tools.filter(function (schema) {
      if (options.controlledToolNames.has(schema.name)) return visible.has(schema.name)
      const modes = options.pluginToolModes ? options.pluginToolModes(schema.name) : null
      return !modes || modes.includes(group)
    })
    // DSH may expose both editor generations; the legacy schema alone costs
    // ~800 tokens on every card-Agent step and duplicates read/edit/write.
    if (assembly.tools.some(schema => schema.name === 'edit')) assembly.tools = assembly.tools.filter(schema => schema.name !== 'str_replace_editor')
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
    if (input.chat?.requestMode === 'sillytavern') throw new Error('silly 模式已停用')
    if (input.chat?.regenInProgress && Number(input.payload.step) === 1) {
      const inputs = (input.payload.messages || []).filter(isTurnInput)
      const saved = input.chat.regenRecovery
      if (saved?.phase === 'committed' || inputs.length !== 1 || !isRegenerationInput(inputs[0]) ||
          (saved?.id && inputs[0].source.regenerationId !== saved.id)) {
        throw new Error('上一次正文重新生成尚未完成：请点「重新生成正文」完成或恢复它，再发送消息')
      }
    }
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
