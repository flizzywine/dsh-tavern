import { markTavernSectionsLiteral } from './literal-sections.js'
import { promptSection } from './prompt-section.js'
import { sessionStablePrefixSections, stableCardName, stableSectionBody } from './session-stable-prefix.js'
import { createHash, randomBytes } from 'node:crypto'
import { projectPlayerContent } from './player-input-content.js'
import { resolveRuntimePresetMacros } from './runtime-presets.js'
import { projectRuntimePresetRequest } from './runtime-preset-lifecycle.js'
import { BODY_GENERATION_PROMPT } from './plugin-body-generation.js'
import {
  STORY_CONTEXT_TOOL_NAME,
  STORY_GENERATE_TOOL_NAME,
  STORY_INPUT_ONLY_PROMPT,
  STORY_SUBMIT_PROMPT,
  STORY_SUBMIT_PROMPT_STRICT,
  STORY_SUBMIT_THINK_NOTE,
  STORY_SUBMIT_TOOL_NAME,
  buildStorySubmitWireSchema
} from './story-tool-submission.js'
import { NO_FOREGROUND_TOOLS_PROMPT, normalizeDisabledForegroundTools } from './foreground-tools.js'
import { projectEnvelopeRequest, projectHistoryAsToolCalls } from './history-tool-call.js'
import { isAutoToolOnlyModel } from './tool-protocol-enforcement.js'
import { markRequestHandled, requestHandledBy } from './request-lineage.js'
import { inputKind } from './session-turn-input.js'
import { isProducerSource, isSystemPromptSource } from './message-source.js'
import { virtualWorldbookPromptText } from './worldbook-virtual-surface.js'
import { frameUserInput } from './agent-input-frame.js'
import { hasProviderContent } from './provider-message-content.js'
import { appendSessionEvent } from './session-events.js'
import { projectPureWritingRequest, pureWritingContext, pureWritingFixedSections, pureWritingInjection, pureWritingSystemSections, pureWritingTools, PURE_WRITING_REQUEST } from './pure-writing-request.js'
import { foregroundStyleReferenceEnabled } from './style-reference.js'
import { projectWithoutStyleReference } from './style-reference-request.js'
import { STYLE_REFERENCE_SECTION, STYLE_REFERENCE_TOOL_NAME } from './style-reference-protocol.cjs'
import systemPromptSections from './system-prompt-sections.cjs'

const { buildSystemSectionSpans } = systemPromptSections

const CARD_REFERENCE_SECTIONS = new Set(['tavern:character-card', 'tavern:card-system-prompt', 'tavern:constant-worldbook'])
const CARD_PERSONA_SCOPE = '起始任务和 Skill 规定任务步骤、交付物与必要格式。人物卡的设定与提示词用于理解和编辑目标。向用户提问、介绍选项和汇报时，始终沿用以下身份、称呼和语气。回复语言优先遵循用户明确要求，其次沿用以下性格的语言约定。'
// The card Agent resends its system prompt on every tool step and reads live
// files anyway; a large card's reference material would dominate each request.
export const CARD_REFERENCE_WORLDBOOK_LIMIT = 8000
export const CARD_REFERENCE_SECTION_LIMIT = 8000
export const TOOL_PROTOCOL_DIRECTIVE = Symbol.for('dsh-tavern.tool-protocol-directive')

export function toolProtocolDirectiveOf(request) {
  return request && typeof request === 'object' ? request[TOOL_PROTOCOL_DIRECTIVE] || null : null
}

function cardReferenceSection(section) {
  const text = str(section.text)
  if (section.name === 'tavern:constant-worldbook') {
    const chars = Array.from((stableSectionBody(section.name, text) ?? text).trim()).length
    if (chars <= CARD_REFERENCE_WORLDBOOK_LIMIT) return section
    return { name: section.name, text: promptSection('lorebook_constant', 'About ' + chars + ' characters exceed the preload limit. Read relevant entries with tavern_read_lorebook by keyword or number when needed.') }
  }
  const chars = Array.from(text).length
  if (chars <= CARD_REFERENCE_SECTION_LIMIT) return section
  if (section.name === 'tavern:character-card') {
    const name = stableCardName(text)
    return { name: section.name, text: (name ? promptSection('character_card_name', name) + '\n' : '') + promptSection('character_description', 'About ' + chars + ' characters exceed the preload limit. Read card fields with tavern_read_card when needed.') }
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
  if (!source.some(isRegenerationInput)) return source
  // Each regeneration attempt re-samples the player input before it. Anchor on
  // each original player input and fold through the latest regeneration attempt
  // before the next player input, rather than only the final attempt in the log:
  // historical failed-tail or save-only regenerations can leave earlier retry
  // carriers on the surface, and folding every such span keeps old bodies,
  // refusals and superseded retry context out of the provider request.
  const spans = []
  let index = 0
  while (index < source.length) {
    if (!isOriginalPlayerInput(source[index])) { index += 1; continue }
    let nextPlayer = index + 1
    let lastRegen = -1
    while (nextPlayer < source.length && !isOriginalPlayerInput(source[nextPlayer])) {
      if (isRegenerationInput(source[nextPlayer])) lastRegen = nextPlayer
      nextPlayer += 1
    }
    if (lastRegen > index) spans.push({ playerIndex: index, regenerationIndex: lastRegen, endIndex: nextPlayer })
    index = nextPlayer
  }
  if (spans.length === 0) return source
  const result = []
  let cursor = 0
  for (const { playerIndex, regenerationIndex, endIndex } of spans) {
    if (playerIndex > cursor) result.push(...source.slice(cursor, playerIndex))
    const projectedPlayer = Object.assign({}, source[playerIndex], {
      content: Array.isArray(source[regenerationIndex].content) ? structuredClone(source[regenerationIndex].content) : []
    })
    // Keep updates the frame adapter saw in the replaced turn if the new frame did not supersede them.
    const replaced = source.slice(playerIndex + 1, regenerationIndex)
    const tail = source.slice(regenerationIndex + 1, endIndex)
    const retained = ['writingRulesSnapshot', 'playerIdentity'].flatMap(field => {
      const isUpdate = message => message?.role === 'user' &&
        isProducerSource(message.source, 'dsh-tavern') && message.source.trace?.[field]?.schemaVersion === 1
      const last = tail.some(isUpdate) ? undefined : replaced.findLast(isUpdate)
      return last ? [last] : []
    })
    result.push(projectedPlayer, ...retained, ...tail)
    cursor = endIndex
  }
  if (cursor < source.length) result.push(...source.slice(cursor))
  return result
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
  // Digest of system sections that should replace their prior versions when changed.
  const renderedSeriesPrompts = new Map()
  const enteredSeriesPrompts = new Map()
  // Front texts of the step being prepared, only to label the request evidence.
  const frontTexts = new Map()
  // Per-session dice seed: drawn on a turn's first step, so every step of one turn rolls
  // the same and a new turn or regeneration rolls again.
  const presetSeeds = new Map()
  const assembledSystemSections = new Map()
  function recordSystemSections(sessionId, sections) {
    const key = str(sessionId)
    if (!key) return
    assembledSystemSections.delete(key)
    assembledSystemSections.set(key, Array.isArray(sections) ? sections.slice() : [])
    if (assembledSystemSections.size > 128) assembledSystemSections.delete(assembledSystemSections.keys().next().value)
  }
  function systemSectionsFor(sessionId, systemText) {
    const key = str(sessionId)
    if (!key || typeof systemText !== 'string' || !systemText) return []
    return buildSystemSectionSpans(systemText, assembledSystemSections.get(key))
  }
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
    const play = mode === 'story' || mode === 'script'
    const previous = stagedRequests.get(sessionId)
    const firstStep = Number(payload.step) === 1
    if (play && !firstStep && previous?.pureWriter) return { kind: 'enter', messages: input.decision.messages }
    const pureWriter = play && firstStep ? await options.writingPreparation?.forGame(sessionId) : null
    let agentMessages = pureWriter ? input.decision.messages : options.filterMessages(input.decision.messages, mode, {
      session: payload.agent?.session, disabledWritingSkills: input.chat?.disabledWritingSkills
    })
    const rawSnapshot = play ? await options.resolvePreset(input.chat) : null
    // Render the three phases together; the persisted preset and prior messages stay authoritative.
    const randomSeed = rawSnapshot ? presetSeed(sessionId, Math.max(0, Number(payload.turn) || 0), Math.max(1, Number(payload.step) || 1)) : undefined
    const snapshot = resolveRuntimePresetMacros(rawSnapshot, { charName: input.chat?.cardName, macroState: input.chat?.macroState, randomSeed }).snapshot
    const prepareTurn = () => options.prepareTurn({ sessionId, turn: payload.turn, requestId: input.requestId,
      userText: userTextOf(payload.messages), userContent: userContentOf(payload.messages), runtimePresetSnapshot: snapshot, signal: payload.signal })
    if (pureWriter) {
      enteredSeriesPrompts.delete(sessionId)
      const prepared = await prepareTurn()
      if (prepared?.duplicate) throw new Error('该消息已由酒馆处理，请勿重复发送')
      const frame = prepared.frame
      agentMessages = replaceTurnInput(agentMessages, frameUserInput(frame).projectedText)
      const fixed = [
        ...presetFrontSections(snapshot),
        ...pureWritingFixedSections(sessionStablePrefixSections(payload.agent.session), frame)
      ]
      const writingSections = pureWritingSystemSections(fixed, frame, snapshot?.back?.entries)
      recordSystemSections(sessionId, writingSections)
      const system = writingSections.map(section => section.text).filter(Boolean).join('\n\n')
      stagedRequests.set(sessionId, { pureWriter, frame, system, writingSections, chat: input.chat, session: payload.agent.session })
      return { kind: 'enter', messages: agentMessages, startsRequestSeries: true }
    }
    if (play) {
      if (firstStep && typeof options.synchronizeTail === 'function') {
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
      const thinkWanted = typeof options.storyToolThinking === 'function' ? (await options.storyToolThinking()) === true : false
      const visibleList = typeof options.visibleTools === 'function' ? await options.visibleTools(sessionId) : null
      const submitVisible = visibleList === null || visibleList.includes(STORY_SUBMIT_TOOL_NAME)
      const contextToolVisible = visibleList === null || visibleList.includes(STORY_CONTEXT_TOOL_NAME)
      const callableToolNames = Array.isArray(visibleList)
        ? visibleList.filter(name => name !== STORY_CONTEXT_TOOL_NAME)
        : [STORY_SUBMIT_TOOL_NAME]
      const submitOffered = historyWanted && submitVisible
      stagedRequests.set(sessionId, {
        turn: Math.max(0, Number(payload.turn) || 0),
        step: Math.max(1, Number(payload.step) || 1),
        scope: 'foreground',
        snapshot: snapshot || null,
        styleReferenceEnabled: foregroundStyleReferenceEnabled(input.chat),
        // Resolved here because the request projection below is synchronous.
        historyToolCall: submitOffered,
        storyOutputToolCall: outputWanted && submitVisible,
        storyToolThinking: thinkWanted,
        contextToolVisible,
        callableToolNames,
        historyLayout: typeof options.historyLayout === 'function' ? String(await options.historyLayout() || 'story') : 'story'
      })
    }
    if (firstStep) {
      const prepared = await prepareTurn()
      if (prepared && prepared.duplicate) throw new Error('该消息已由酒馆处理，请勿重复发送')
      if (play) {
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
    if (!play) return { kind: 'enter', messages: agentMessages }
    // Models that update the system prompt in history would otherwise append the
    // new prompt after the old one, leaving a switched-out preset at the head.
    // A new request series makes DSH replace the head instead. Unknown history
    // (first step since startup) starts one too; it is a no-op when nothing changed.
    const seriesPrompt = renderedSeriesPrompts.get(sessionId) ?? ''
    const switched = enteredSeriesPrompts.get(sessionId) !== seriesPrompt
    enteredSeriesPrompts.set(sessionId, seriesPrompt)
    return { kind: 'enter', messages: agentMessages, ...(switched ? { startsRequestSeries: true } : {}) }
  }

  async function prepareWritingRequest(request) {
    const sessionId = str(request.sessionId)
    const staged = stagedRequests.get(sessionId)
    if (!staged?.pureWriter) throw new Error('本轮写作上下文已失效')
    const { frame } = staged
    const messages = projectLegacyOpeningSources(projectRegenerationRequestMessages(request.messages))
    const context = pureWritingContext(staged.system, projectWithoutStyleReference({ messages }).messages, staged.writingSections)
    if (!staged.preparation) {
      const { provider, model, reasoningEffort } = request
      const foregroundSelection = provider && model ? { provider, model, reasoningEffort } : undefined
      staged.preparation = options.writingPreparation.prepare(staged.pureWriter, {
        gameId: sessionId, frame, chat: staged.chat, signal: request.signal, context, foregroundSelection
      }).then(material => {
        request.signal?.throwIfAborted()
        const injection = pureWritingInjection(frame, [frame.source?.worldBook?.automaticContext, material].filter(Boolean).join('\n\n'))
        // The player input is already on the native surface. Append the
        // receipt before the reply so later requests and forks keep its place.
        if (injection) appendSessionEvent(staged.session, 'user/message', injection, { surfaceOp: 'append' })
        return injection
      })
    }
    const preparation = staged.preparation
    let injection
    try {
      injection = await preparation
    } catch (error) {
      if (staged.preparation === preparation) staged.preparation = undefined
      throw error
    }
    options.recordFrame(sessionId, frame, { appended: Boolean(injection), reason: PURE_WRITING_REQUEST, frameId: frame.frameId })
    const projected = projectPureWritingRequest(request, { context, injection })
    return markRequestHandled(markRequestHandled(projected, PURE_WRITING_REQUEST), PROJECTED)
  }

  function projectRequest(optionsValue) {
    const sessionId = str(optionsValue && optionsValue.sessionId)
    const staged = stagedRequests.get(sessionId)
    if (optionsValue === null || typeof optionsValue !== 'object' || optionsValue.purpose !== undefined || requestHandledBy(optionsValue, PROJECTED)) return null
    if (staged?.pureWriter) return null
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
    const nativeRequest = nativeMessages === optionsValue.messages
      ? optionsValue : Object.assign({}, optionsValue, { messages: nativeMessages })
    const baseRequest = staged.scope === 'foreground' && staged.styleReferenceEnabled === false
      ? projectWithoutStyleReference(nativeRequest) : nativeRequest
    // 前台正文的 front 已由 assembleSystemPrompt 写入原生 system prompt；后台任务不走该钩子，须保留完整前／后段。
    const projectionSnapshot = staged.scope === 'background'
      ? staged.snapshot
      : (staged.snapshot ? { ...staged.snapshot, front: null } : null)
    let request = projectRuntimePresetRequest(baseRequest, projectionSnapshot, {
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
    const signaturesByCallId = {}
    const targetProvider = str(optionsValue.provider)
    const targetModel = str(optionsValue.model)
    const contextDeclared = !Array.isArray(request.tools)
      ? staged.contextToolVisible !== false
      : request.tools.some(tool => tool?.name === STORY_CONTEXT_TOOL_NAME)
    const useEnvelope = staged.historyToolCall === true && staged.historyLayout === 'envelope' && contextDeclared

    if (useEnvelope) {
      const labelledFirst = labelPresetFront(request.messages, frontTexts.get(sessionId))
      const source = labelledFirst
      let inputIndex = -1
      for (let index = source.length - 1; index >= 0; index--) {
        if (isTurnInput(source[index])) { inputIndex = index; break }
      }
      const enveloped = projectEnvelopeRequest({
        system: str(request.system),
        messages: source,
        toolName: STORY_SUBMIT_TOOL_NAME,
        contextToolName: STORY_CONTEXT_TOOL_NAME,
        includeThink: staged.storyToolThinking === true,
        outputToolCall: staged.storyOutputToolCall === true,
        turn: staged.turn,
        inputIndex,
        targetProvider,
        targetModel,
        signaturesByCallId
      })
      request = Object.assign({}, request, {
        system: enveloped.system,
        messages: enveloped.messages
      })
    } else {
      if (staged.historyToolCall === true) {
        const source = request.messages
        let inputIndex = -1
        for (let index = source.length - 1; index >= 0; index--) {
          if (isTurnInput(source[index])) { inputIndex = index; break }
        }
        const historyMessages = projectHistoryAsToolCalls(source, {
          toolName: STORY_SUBMIT_TOOL_NAME,
          layout: staged.historyLayout,
          includeThink: staged.storyToolThinking === true,
          targetProvider,
          targetModel,
          signaturesByCallId,
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
    }

    if (staged.storyOutputToolCall === true || staged.historyToolCall === true) {
      const requestToolNames = Array.isArray(request.tools)
        ? request.tools.map(tool => str(tool?.name)).filter(name => name !== '' && name !== STORY_CONTEXT_TOOL_NAME)
        : staged.callableToolNames || [STORY_SUBMIT_TOOL_NAME]
      const forceToolChoice = staged.storyOutputToolCall === true && !isAutoToolOnlyModel(targetModel)
      const directive = Object.freeze({
        provider: targetProvider,
        model: targetModel,
        forceToolChoice,
        storyOutputToolCall: staged.storyOutputToolCall === true,
        storyToolThinking: staged.storyToolThinking === true,
        allowedToolNames: requestToolNames.length > 0 ? requestToolNames : [STORY_SUBMIT_TOOL_NAME],
        signaturesByCallId,
        resolveToolSchema(toolName, ctx) {
          if (toolName !== STORY_SUBMIT_TOOL_NAME) return null
          // 已开启原生思考（且未被强制工具剥离）时不再叠加工具内思考槽，避免双倍思考；
          // Gemini 原生接口按字段名字母序解码，思考字段使用 'analysis' 确保严格排在 'content' 之前。
          const includeThink = ctx?.anthropicThinkingStripped === true || (staged.storyToolThinking === true && ctx?.hasNativeThinking !== true)
          const thinkField = ctx?.protocol === 'gemini-native' ? 'analysis' : 'think'
          return buildStorySubmitWireSchema({ includeThink, thinkField })
        }
      })
      request = Object.assign({}, request, {
        ...(forceToolChoice ? { toolChoice: 'any' } : {}),
        [TOOL_PROTOCOL_DIRECTIVE]: directive
      })
    }
    if (request === optionsValue) return null
    return markRequestHandled(request, PROJECTED)
  }

  function completeRequest(optionsValue, completed) {
    if (!completed || !requestHandledBy(optionsValue, PROJECTED)) return false
    if (requestHandledBy(optionsValue, PURE_WRITING_REQUEST)) return false
    stagedRequests.delete(str(optionsValue && optionsValue.sessionId))
    return true
  }

  function clearRequestState(sessionId) {
    stagedRequests.delete(str(sessionId))
    frontTexts.delete(str(sessionId))
    assembledSystemSections.delete(str(sessionId))
  }

  async function assembleSystemPrompt(assembly, input) {
    if (input.pureWriter) return markTavernSectionsLiteral({
      ...assembly,
      sections: pureWritingFixedSections(input.fixedSystemSections || []),
      contexts: [],
      tools: pureWritingTools(input.toolDefinitions ?? assembly.tools)
    })
    const mode = await options.modeFor(input.sessionId)
    const visible = new Set(await options.visibleTools(input.sessionId))
    const playMode = mode === 'story' || mode === 'script'
    const disabled = new Set(playMode ? normalizeDisabledForegroundTools(input.chat?.disabledForegroundTools) : [])
    // Play rules arrive in the foreground frame. Still replace the inherited
    // sections explicitly so removing play-mode cannot restore DSH's persona.
    const cardEdit = mode === 'card' && input.chat?.cardEditContext?.version === 1
    const fixed = input.fixedSystemSections || []
    const sections = mode === 'card' && !cardEdit ? fixed.filter(section => section.name === 'tavern:user-preference') : fixed.slice()
    if (mode === 'card') {
      const text = typeof options.cardPersonaText === 'function' ? options.cardPersonaText().trim() : ''
      if (text) sections.push({ name: 'tavern:card-system', text: promptSection('card_agent_persona', CARD_PERSONA_SCOPE + '\n\n' + text) })
    }
    if (mode === 'card' && !cardEdit) {
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
      const front = presetFrontSections(resolveRuntimePresetMacros(raw, { charName: input.chat?.cardName, macroState: input.chat?.macroState, phases: ['front'] }).snapshot)
      sections.unshift(...front)
      frontTexts.set(input.sessionId, front.map(section => section.text))
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
    const mountedResources = input.chat?.workspace?.mountedResources
    if (mode === 'card' && finalTools.some(tool => tool.name === 'tavern_read_play_chat') &&
      Array.isArray(mountedResources) && mountedResources.some(resource => resource?.kind === 'play-chat')) {
      sections.push({ name: 'tavern:play-chat-diagnostics',
        text: '排查已关联的游玩记录时，先调用 tavern_read_play_chat，参数 layer 填 overview。存在多个引用时填对应的 ref。' })
    }
    // The submission contract follows the tools that actually survived the
    // per-game switches and the plugin scopes. When only input replay is on, the
    // tool is declared for the history but the model must write prose directly.
    // The strict wording is only true when submit_story is the single tool.
    if (playMode) {
      const toolNames = new Set(finalTools.map(schema => schema.name))
      const callableCount = [...toolNames].filter(name => name !== STORY_CONTEXT_TOOL_NAME).length
      const outputToolCall = typeof options.storyOutputToolCall === 'function' ? (await options.storyOutputToolCall()) === true : false
      const toolThinking = typeof options.storyToolThinking === 'function' ? (await options.storyToolThinking()) === true : false
      const pluginGeneration = visible.has(STORY_GENERATE_TOOL_NAME)
      if (pluginGeneration) {
        sections.push({ name: 'tavern:plugin-body-generation', text: BODY_GENERATION_PROMPT })
      } else if (toolNames.has(STORY_SUBMIT_TOOL_NAME)) {
        if (outputToolCall) {
          const basePrompt = callableCount === 1 ? STORY_SUBMIT_PROMPT_STRICT : STORY_SUBMIT_PROMPT
          const text = toolThinking
            ? basePrompt.replace('</output_method>', STORY_SUBMIT_THINK_NOTE + '\n</output_method>')
            : basePrompt
          sections.push({ name: 'tavern:story-tool-submission', text })
        } else {
          sections.push({ name: 'tavern:story-tool-submission', text: STORY_INPUT_ONLY_PROMPT })
        }
      } else if (knownTools && toolNames.size === 0) {
        sections.push({ name: 'tavern:no-foreground-tools', text: NO_FOREGROUND_TOOLS_PROMPT })
      }
    }
    if (playMode) {
      const styleReference = finalTools.some(tool => tool.name === STYLE_REFERENCE_TOOL_NAME)
        ? options.styleReferencePrompt?.(input.chat) : ''
      if (styleReference) sections.push({ name: STYLE_REFERENCE_SECTION, text: styleReference })
      const seriesPrompt = JSON.stringify([frontTexts.get(input.sessionId), styleReference || ''])
      renderedSeriesPrompts.set(input.sessionId, createHash('sha256').update(seriesPrompt).digest('hex'))
    }
    if (mode === 'story' && options.foregroundCandidatePrompt) {
      const text = await options.foregroundCandidatePrompt(input.chat)
      if (text) sections.push({ name: 'tavern:foreground-candidates', text })
    }
    assembly.sections = sections
    return assembly
  }

  const pureWritingTurn = sessionId => Boolean(stagedRequests.get(sessionId)?.pureWriter)
  return Object.freeze({ kind: 'native-play', prepareStep, prepareWritingRequest, projectRequest, completeRequest, clearRequestState, assembleSystemPrompt, stageWorldbookSection, recordSystemSections, systemSectionsFor, pureWritingTurn })
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

  return Object.freeze({ prepareStep, prepareWritingRequest: nativePlay.prepareWritingRequest, projectRequest, completeRequest, clearRequestState, assembleSystemPrompt, stageWorldbookSection: nativePlay.stageWorldbookSection, recordSystemSections: nativePlay.recordSystemSections, systemSectionsFor: nativePlay.systemSectionsFor, pureWritingTurn: nativePlay.pureWritingTurn })
}
