import { promptSection, promptSectionBody } from './prompt-section.js'
import { createHash, randomBytes } from 'node:crypto'
import { projectPlayerContent } from './player-input-content.js'
import { resolveRuntimePresetMacros } from './runtime-presets.js'
import { projectRuntimePresetRequest } from './runtime-preset-lifecycle.js'
import { BODY_GENERATION_PROMPT } from './plugin-body-generation.js'
import { STORY_GENERATE_TOOL_NAME, STORY_INPUT_ONLY_PROMPT, STORY_SUBMIT_PROMPT, STORY_SUBMIT_PROMPT_STRICT, STORY_SUBMIT_TOOL_NAME, withStorySubmitAck } from './story-tool-submission.js'
import { NO_FOREGROUND_TOOLS_PROMPT, normalizeDisabledForegroundTools } from './foreground-tools.js'
import { projectHistoryAsToolCalls } from './history-tool-call.js'
import { markRequestHandled, requestHandledBy } from './request-lineage.js'
import { inputKind } from './session-turn-input.js'
import { isProducerSource, isSystemPromptSource } from './message-source.js'
import { virtualWorldbookPromptText } from './worldbook-virtual-surface.js'
import { frameUserInput } from './agent-input-frame.js'

const CARD_REFERENCE_SECTIONS = new Set(['tavern:character-card', 'tavern:card-system-prompt', 'tavern:constant-worldbook'])
// The card Agent resends its system prompt on every tool step and reads live
// files anyway; a large card's reference material would dominate each request.
export const CARD_REFERENCE_WORLDBOOK_LIMIT = 8000
export const CARD_REFERENCE_SECTION_LIMIT = 8000

function cardReferenceSection(section) {
  const text = str(section.text)
  if (section.name === 'tavern:constant-worldbook') {
    const chars = Array.from(promptSectionBody('constant_worldbook', text).replace(/^【常驻世界书】\n?/, '').trim()).length
    if (chars <= CARD_REFERENCE_WORLDBOOK_LIMIT) return section
    return { name: section.name, text: promptSection('constant_worldbook', 'About ' + chars + ' characters exceed the preload limit. Read relevant entries with tavern_read_worldbook by keyword or number when needed.') }
  }
  const chars = Array.from(text).length
  if (chars <= CARD_REFERENCE_SECTION_LIMIT) return section
  const [title, name] = text.split('\n')
  if (section.name === 'tavern:character-card') {
    return { name: section.name, text: promptSection('character_card', (/^(?:Name: |名字: )/.test(name || '') ? name + '\n' : '') + 'About ' + chars + ' characters exceed the preload limit. Read card fields with tavern_read_card when needed.') }
  }
  return { name: section.name, text: promptSection('card_system', 'About ' + chars + ' characters exceed the preload limit. Read system_prompt with tavern_read_card when needed.') }
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

function userContentOf(messages) {
  const input = (Array.isArray(messages) ? messages : []).findLast(isTurnInput)
  return Array.isArray(input?.content) ? input.content : []
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
  // The attempt replaces the input of the turn it re-samples. Anchor on that
  // input — the last player message before the attempt — not on the newest
  // assistant: a turn whose reply never landed (error, stop, rolled back) has no
  // assistant of its own, and walking back from the previous turn's reply would
  // then take the previous input and drop everything after it, erasing the whole
  // transcript between the two turns.
  let playerIndex = -1
  for (let index = regenerationIndex - 1; index >= 0; index--) {
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

/**
 * Anthropic binds each thinking signature to the exact conversation before it.
 * Tavern retires the previous turn's frame to save tokens, which changes that
 * prefix, so a replayed signature from an earlier turn is rejected (400 "Invalid
 * `signature` in `thinking` block"). Anthropic accepts history without earlier
 * turns' thinking; only the turn in progress (its tool loop) must keep its own.
 * Drop those blocks from replies before this turn's input, nothing else.
 */
export function projectAnthropicPriorThinking(messages) {
  const source = Array.isArray(messages) ? messages : []
  let inputIndex = -1
  for (let index = source.length - 1; index >= 0; index--) {
    if (isTurnInput(source[index])) { inputIndex = index; break }
  }
  if (inputIndex <= 0) return messages
  let changed = false
  const projected = source.map(function (message, index) {
    const origin = message && message.source
    const replay = origin && origin.kind === 'model' ? origin.replayState : undefined
    if (index >= inputIndex || !message || message.role !== 'assistant' || !Array.isArray(message.content)
      || str(replay && replay.response && replay.response.api) !== 'anthropic-messages'
      || !message.content.some(function (block) { return block && block.type === 'reasoning' })) return message
    const blocks = Array.isArray(replay.blocks) && replay.blocks.length === message.content.length ? replay.blocks : null
    const kept = message.content.map(function (block, at) { return block && block.type === 'reasoning' ? -1 : at }).filter(function (at) { return at >= 0 })
    changed = true
    // A reply that was nothing but thinking leaves no message to send.
    if (kept.length === 0) return null
    return Object.assign({}, message, {
      content: kept.map(function (at) { return message.content[at] }),
      // The replay envelope lists one entry per content block; keep it aligned,
      // or drop it when it cannot be (the host then sends the plain content).
      source: Object.assign({}, origin, { replayState: blocks === null ? undefined
        : Object.assign({}, replay, { blocks: kept.map(function (at) { return blocks[at] }) }) })
    })
  })
  return changed ? projected.filter(Boolean) : messages
}

// Copies made by later hooks (workspace presentation) must still count as projected.
const PROJECTED = 'foreground-projection'

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
    .map(entry => ({ name: 'tavern:runtime-preset-front', text: str(entry.content) }))
}

export function createNativePlayOrchestrationStrategy(options) {
  const stagedRequests = options.stagedRequests instanceof Map ? options.stagedRequests : new Map()
  // DSH renders the assembled system sections after pre-step. Keep the empty
  // section for this signal only, so the turn can fill it from its own frame.
  const pendingWorldbookSections = new WeakMap()
  function stageWorldbookSection({ agent, signal }, section) {
    if (section && signal && !signal.aborted) pendingWorldbookSections.set(signal, { agent, section })
  }
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
    const pending = pendingWorldbookSections.get(payload.signal)
    const worldbookSection = pending && pending.agent === payload.agent ? pending.section : undefined
    if (worldbookSection) pendingWorldbookSections.delete(payload.signal)
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
      // A replayed transcript calls a tool. Strict providers reject a call whose
      // declaration is missing, so replay only when this turn offers submit_story;
      // the per-game tool switch can still remove it after the global settings say on.
      const historyWanted = typeof options.historyToolCall === 'function' ? (await options.historyToolCall()) === true : false
      const pluginGeneration = (await options.bodyGeneration?.(sessionId))?.mode?.startsWith('plugin-')
      const outputWanted = !pluginGeneration && typeof options.storyOutputToolCall === 'function' ? (await options.storyOutputToolCall()) === true : false
      const submitVisible = typeof options.visibleTools !== 'function'
        || (await options.visibleTools(sessionId)).includes(STORY_SUBMIT_TOOL_NAME)
      const submitOffered = historyWanted && submitVisible
      stagedRequests.set(sessionId, {
        turn: Math.max(0, Number(payload.turn) || 0),
        step: Math.max(1, Number(payload.step) || 1),
        scope: 'foreground',
        snapshot: snapshot || null,
        // Resolved here because the request projection below is synchronous.
        historyToolCall: submitOffered,
        storyOutputToolCall: outputWanted && submitVisible,
        historyLayout: typeof options.historyLayout === 'function' ? String(await options.historyLayout() || 'story') : 'story'
      })
    }
    if (Number(payload.step) === 1) {
      const prepared = await options.prepareTurn({ sessionId, turn: payload.turn, requestId: input.requestId,
        userText: userTextOf(payload.messages), userContent: userContentOf(payload.messages), runtimePresetSnapshot: snapshot })
      if (prepared && prepared.duplicate) throw new Error('该消息已由酒馆处理，请勿重复发送')
      if (mode === 'story' || mode === 'script') {
        const source = prepared.frame.source
        const worldbookPrefix = source?.regenerationMaterials?.worldbookPrefix
        if (worldbookSection && !input.chat?.regenInProgress && source?.worldBook?.virtualWorldbook && typeof worldbookPrefix === 'string') {
          worldbookSection.text = virtualWorldbookPromptText(worldbookPrefix)
        }
        agentMessages = replaceTurnInput(agentMessages, frameUserInput(prepared.frame).projectedText)
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
    const thinkingMessages = projectAnthropicPriorThinking(request.messages)
    if (thinkingMessages !== request.messages) request = Object.assign({}, request, { messages: thinkingMessages })
    // Past bodies replayed as the submission tool's arguments instead of prose the
    // model wrote. Runs last so the earlier passes see the shape the host built;
    // the save, the view and every floor control keep the plain text. Only this
    // turn's own input stays a message — it is the prompt being answered.
    if (staged.historyToolCall === true) {
      const source = request.messages
      let inputIndex = -1
      for (let index = source.length - 1; index >= 0; index--) {
        if (isTurnInput(source[index])) { inputIndex = index; break }
      }
      const historyMessages = projectHistoryAsToolCalls(source, {
        toolName: STORY_SUBMIT_TOOL_NAME,
        layout: staged.historyLayout,
        // `everything` deliberately replays the input too, leaving a receipt last.
        preserve: staged.historyLayout === 'everything' ? null : (_message, index) => index === inputIndex
      })
      if (historyMessages !== request.messages) request = Object.assign({}, request, { messages: historyMessages })
    }
    // DSH's renderer returns '' for no sections; adapters otherwise serialize
    // it as an empty system message. Preserve any explicit non-empty prompt.
    if (request.system === '') {
      request = Object.assign({}, request)
      delete request.system
    }
    const labelled = labelPresetFront(request.messages, frontTexts.get(sessionId))
    if (labelled !== request.messages) request = Object.assign({}, request, { messages: labelled })
    // A real assistant turn placed before the current player input, not after
    // it: providers still see the player's message last, and the model reads its
    // own submission commitment right before answering.
    if (staged.storyOutputToolCall === true) {
      const acknowledged = withStorySubmitAck(request.messages, staged.turn)
      if (acknowledged !== request.messages) request = Object.assign({}, request, { messages: acknowledged })
    }
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
    const playMode = mode === 'story' || mode === 'script'
    const disabled = new Set(playMode ? normalizeDisabledForegroundTools(input.chat?.disabledForegroundTools) : [])
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
    if (playMode) {
      const raw = await options.resolvePreset(input.chat)
      const front = presetFrontSections(resolveRuntimePresetMacros(raw, { charName: input.chat?.cardName, macroState: input.chat?.macroState }).snapshot)
      sections.unshift(...front)
      frontTexts.set(input.sessionId, front.map(section => section.text))
      renderedFronts.set(input.sessionId, createHash('sha256').update(JSON.stringify(front.map(section => section.text))).digest('hex'))
    }
    if (Array.isArray(assembly.contexts)) assembly.contexts = assembly.contexts.filter(section => section.name !== 'approval:policy')
    // A plugin's own tool shows everywhere unless the plugin scoped it (tavern.toolModes).
    const group = mode === 'card' ? 'card' : 'play'
    // Some hosts supply tool schemas separately from the waterfall assembly.
    // Missing metadata must not assert that the host offers no tools.
    const knownTools = Array.isArray(assembly.tools) || Array.isArray(input.toolDefinitions)
    const tools = Array.isArray(input.toolDefinitions) ? input.toolDefinitions : assembly.tools || []
    // A plugin tool gated by tavern.toolSkills() waits for its Skill like Tavern's own.
    const pluginNames = tools.map(schema => schema.name).filter(name => !options.controlledToolNames.has(name))
    const unlocked = new Set(options.pluginToolsUnlocked ? await options.pluginToolsUnlocked(input.sessionId, pluginNames) : pluginNames)
    const filteredTools = tools.filter(function (schema) {
      if (options.controlledToolNames.has(schema.name)) return visible.has(schema.name)
      if (!unlocked.has(schema.name)) return false
      const modes = options.pluginToolModes ? options.pluginToolModes(schema.name) : null
      return !modes || modes.includes(group)
    })
    // Record the plugin/extra tools before applying the per-game switches: the
    // settings panel must keep listing a tool the player has switched off.
    if (playMode && typeof options.recordTools === 'function') {
      try {
        options.recordTools(input.sessionId, filteredTools
          .filter(schema => !options.controlledToolNames.has(schema.name))
          .map(schema => ({ name: schema.name, description: String(schema.description || '') })))
      } catch { /* the tool catalog must never fail the request */ }
    }
    const finalTools = playMode ? filteredTools.filter(schema => options.controlledToolNames.has(schema.name) || !disabled.has(schema.name)) : filteredTools
    if (knownTools) {
      assembly.tools = finalTools
    }
    // The submission contract follows the tools that actually survived the
    // per-game switches and the plugin scopes. When only input replay is on, the
    // tool is declared for the history but the model must write prose directly.
    // The strict wording is only true when submit_story is the single tool.
    if (playMode) {
      const toolNames = new Set(finalTools.map(schema => schema.name))
      const outputToolCall = typeof options.storyOutputToolCall === 'function' ? (await options.storyOutputToolCall()) === true : false
      // Hosts that overwrite assembly.tools deliver every registered tool,
      // including tavern_generate_body when plugin generation is off. The
      // output contract follows Tavern's own tool gate, not those raw
      // declarations: otherwise the model is told to write no prose, the tool
      // replies "plugin generation is not enabled" and the turn ends empty.
      const pluginGeneration = visible.has(STORY_GENERATE_TOOL_NAME)
      if (pluginGeneration) {
        sections.push({ name: 'tavern:plugin-body-generation', text: BODY_GENERATION_PROMPT })
      } else if (toolNames.has(STORY_SUBMIT_TOOL_NAME)) {
        if (outputToolCall) {
          sections.push({ name: 'tavern:story-tool-submission', text: toolNames.size === 1 ? STORY_SUBMIT_PROMPT_STRICT : STORY_SUBMIT_PROMPT })
        } else {
          sections.push({ name: 'tavern:story-tool-submission', text: STORY_INPUT_ONLY_PROMPT })
        }
      } else if (knownTools && toolNames.size === 0) {
        sections.push({ name: 'tavern:no-foreground-tools', text: NO_FOREGROUND_TOOLS_PROMPT })
      }
    }
    if (playMode && finalTools.some(tool => tool.name === 'style_reference_submit') && options.styleReferencePrompt) {
      const text = options.styleReferencePrompt(input.chat)
      if (text) sections.push({ name: 'tavern:foreground-style-reference', text })
    }
    if (mode === 'story' && options.foregroundCandidatePrompt) {
      const text = options.foregroundCandidatePrompt(input.chat)
      if (text) sections.push({ name: 'tavern:foreground-candidates', text })
    }
    assembly.sections = sections
    return assembly
  }

  return Object.freeze({ kind: 'native-play', prepareStep, projectRequest, completeRequest, clearRequestState, assembleSystemPrompt, stageWorldbookSection })
}

export function createForegroundOrchestrationStrategies(options) {
  const nativePlay = createNativePlayOrchestrationStrategy(options.nativePlay)
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
    return await nativePlay.prepareStep(input)
  }

  function projectRequest(optionsValue, coordinates) {
    return nativePlay.projectRequest(optionsValue, coordinates)
  }

  function completeRequest(optionsValue, completed) {
    nativePlay.completeRequest(optionsValue, completed)
  }

  function clearRequestState(sessionId) {
    nativePlay.clearRequestState(sessionId)
  }

  async function assembleSystemPrompt(assembly, input) {
    if (input.chat?.requestMode === 'sillytavern') throw new Error('silly 模式已停用')
    return await nativePlay.assembleSystemPrompt(assembly, input)
  }

  return Object.freeze({ prepareStep, projectRequest, completeRequest, clearRequestState, assembleSystemPrompt, stageWorldbookSection: nativePlay.stageWorldbookSection })
}
