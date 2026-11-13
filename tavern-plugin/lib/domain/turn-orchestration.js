import { bodyGenerationFailure } from './body-generation-failure.js'
import { extractForegroundStoryChoices } from './candidate-generation.js'
import { createScopedMessages, isScopedMessages } from './scoped-messages.js'
import { captureChatHeader, chatStampPath } from './chat-persistence.js'
import { commitChatFields, rebaseChatChanges, sameChatMessageIdentity, sameChatMessageStory } from './chat-field-transaction.js'
import { validAnchor } from './round-anchor.js'
import { CARD_MEMORY_TOOLS } from '../../packages/dsh-tavern-card-memory/index.js'
import { inputAttachments } from './player-input-content.js'
import { resolveRuntimePresetMacros } from './runtime-presets.js'
import { composeTavernRegexScripts } from './card-extension-reading.js'
import { scriptPromptFrameInputs, consumeScriptPrompts } from './tavern-script-prompts.js'
import { ledgerFrameInputs } from './story-ledger.js'
import { projectBackgroundInput } from './runtime-content-projection.js'
import { lastTavernHelperVariables } from './tavern-helper-context.js'
import { normalizeResourcePath } from './file-resources.js'
import { applyJsonChangesShared, diffJson } from './json-mutation.js'
import { hasTavernCredit, withTavernCredit } from './card-credit.js'
import { projectPluginBody } from './st-contract-service.js'
import { STORY_CONTEXT_TOOL_NAME, STORY_GENERATE_TOOL_NAME, STORY_SUBMIT_TOOL_NAME, storyToolCallEnabled } from './story-tool-submission.js'
import { normalizeDisabledForegroundTools } from './foreground-tools.js'
import { variableUpdateFor } from './variable-update.js'
import { replyProse } from './reply-prose.js'
import { captureBodyRegenerationSource } from './body-regeneration-materials.js'
import { frameUserInput } from './agent-input-frame.js'
import { nextPlainDamperState, readDamperStateSnapshot } from './narrative-damper.js'
import { readRowsAt } from './bounded-history.js'
import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import { canonicalJson } from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'

export const cordisToolNames = Object.freeze([
  'cordis_inspect_list',
  'cordis_inspect_query',
  'cordis_inspect_self',
  'cordis_define',
  'cordis_run',
  'cordis_stop',
  'cordis_undefine'
])

// DSH's file-tool suite (dsh-tool-fs), treated as one capability boundary.
export const dshFileToolNames = Object.freeze([
  'read',
  'write',
  'edit',
  'read_image',
  'apply_patch'
])

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function cardPathOf(chat) { return str(chat && (chat.cardPath || chat.cardId)) }

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

// reason: what moved under the preparation; details for the host log (the player sees only the message),
// with writers: who committed meanwhile.
function preparationConflict(reason, details) {
  return Object.assign(new Error('存档在准备正文期间发生冲突，本轮已停止'), {
    code: 'TAVERN_PREPARE_CONFLICT', conflict: { reason, ...details }
  })
}

function storageStamp(change) {
  return change.path[0] === '_storageRevision' || change.path[0] === 'updatedAt'
}

const changedPaths = changes => [...new Set(changes.map(change => change.path.slice(0, 2).join('.')))].join(', ')

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function usesOfficialMvu(chat) {
  return Boolean(chat && chat.mvu && chat.mvu.enabled === true && chat.mvu.owner === 'official')
}

function commitFor(chat, turn) {
  if (!turn || chat.nativeCommits === null || typeof chat.nativeCommits !== 'object') return null
  const value = chat.nativeCommits[String(turn)]
  return value !== null && typeof value === 'object' ? value : null
}

function commitForRequest(chat, requestId) {
  const target = str(requestId).trim()
  if (target === '' || chat.nativeCommits === null || typeof chat.nativeCommits !== 'object') return null
  for (const value of Object.values(chat.nativeCommits)) {
    if (value !== null && typeof value === 'object' && str(value.requestId).trim() === target) return value
  }
  return null
}

function rememberCommit(chat, turn, value, before, now) {
  if (!turn) return
  if (chat.nativeCommits === null || typeof chat.nativeCommits !== 'object') chat.nativeCommits = {}
  const record = Object.assign({ turn, committedAt: now() }, value)
  if (before !== undefined && before !== null) record.before = before
  chat.nativeCommits[String(turn)] = record
  const keys = Object.keys(chat.nativeCommits).map(Number).filter(Number.isFinite).sort(function (a, b) { return b - a })
  for (const oldTurn of keys.slice(40)) delete chat.nativeCommits[String(oldTurn)]
}

function stagedMap(chat) {
  if (chat.pendingCardChanges === null || typeof chat.pendingCardChanges !== 'object' || Array.isArray(chat.pendingCardChanges)) chat.pendingCardChanges = {}
  return chat.pendingCardChanges
}

// The workbench's card was written during this native turn (a tool save is immediate).
// The commit reads it to tell plugins that this turn changed the card: the tool result is
// not part of the message, so `changed` alone would stay false for every `tavern_update_card`.
function rememberCardSave(chat, turn, value) {
  const nativeTurn = Math.max(0, Number(turn) || 0)
  if (!nativeTurn) return
  chat.lastCardSave = {
    turn: nativeTurn,
    path: str(value && value.path),
    createsCard: value && value.createsCard === true,
    changed: value && value.changed === true
  }
}

function clearStaleStages(chat, turn) {
  const stages = stagedMap(chat)
  let changed = false
  for (const key of Object.keys(stages)) {
    if (key === String(turn)) continue
    delete stages[key]
    changed = true
  }
  return changed
}

function takeStage(chat, turn) {
  const stages = stagedMap(chat)
  const stage = object(stages[String(turn)])
  delete stages[String(turn)]
  return stage
}

function mergeStage(previous, fields, rawOperations) {
  return {
    fields: Object.assign({}, object(previous.fields), clone(object(fields))),
    rawOperations: (Array.isArray(previous.rawOperations) ? clone(previous.rawOperations) : []).concat(Array.isArray(rawOperations) ? clone(rawOperations) : [])
  }
}

function rememberRuntimeInput(chat, turn, source, text) {
  if (chat.runtimeInputs === null || typeof chat.runtimeInputs !== 'object' || Array.isArray(chat.runtimeInputs)) chat.runtimeInputs = {}
  chat.runtimeInputs[String(turn)] = { source, text }
  const keys = Object.keys(chat.runtimeInputs).map(Number).filter(Number.isFinite).sort(function (a, b) { return b - a })
  for (const oldTurn of keys.slice(40)) delete chat.runtimeInputs[String(oldTurn)]
}

function requestUserIndex(messages, requestId) {
  return requestId ? messages.findLastIndex(row => row?.role === 'user' && str(row.source?.rpcId).trim() === requestId) : -1
}

function inputVariablesDigest(row) {
  return createHash('sha256').update(canonicalJson(clone(row?.variables ?? null), { admitted: true })).digest('hex')
}

function copyInputVariables(target, row) {
  if (Object.hasOwn(row, 'variables')) target.variables = clone(row.variables)
  else delete target.variables
}

function inputVariablesChanged(stage, row, baseline) {
  return row && (stage?.inputVariablesDigest
    ? stage.inputVariablesDigest !== inputVariablesDigest(row)
    : !isDeepStrictEqual(row.variables, baseline?.variables))
}

// Store what the template wrote alongside the old values so abort can undo
// its changes without reverting later writes.
function stageTemplateInput(chat, turn, source, projected, baselineDigest) {
  if (chat.promptTemplateInput && chat.promptTemplateInput.turn !== turn) restoreTemplateInput(chat)
  const before = chat.promptTemplateInput?.before || { variables: clone(chat.variables ?? null), initial: clone(chat.promptTemplateInitialVariables ?? null) }
  // The template input row inherits the previous floor; a blank opening has none, so it
  // inherits the chat-start MVU baseline instead.
  const inherited = chat.messages?.length ? undefined : lastTavernHelperVariables([], chat.variables)
  const message = inherited === undefined ? projected.message
    : { ...projected.message, variables: (projected.message.variables || [{}]).map(value => ({ ...inherited, ...value })) }
  const after = { variables: clone(projected.scopes.local ?? null), initial: clone(projected.scopes.initial ?? null) }
  chat.promptTemplateInput = { turn, source, message, before, after, inputVariablesDigest: baselineDigest }
  chat.variables = projected.scopes.local
  chat.promptTemplateInitialVariables = projected.scopes.initial
}

function undoTemplateValue(before, written, current) {
  if (isDeepStrictEqual(current, written)) return before
  if (isDeepStrictEqual(before, written) || !written || !current
    || typeof written !== 'object' || typeof current !== 'object' || Array.isArray(written) || Array.isArray(current)
    || (before !== undefined && (before === null || typeof before !== 'object' || Array.isArray(before)))) return current
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(written), ...Object.keys(current)])
  const entries = []
  for (const key of keys) {
    const own = (value) => value && Object.hasOwn(value, key) ? value[key] : undefined
    const value = undoTemplateValue(own(before), own(written), own(current))
    if (value !== undefined) entries.push([key, value])
  }
  return before === undefined && entries.length === 0 ? undefined : Object.fromEntries(entries)
}

function restoreTemplateInput(chat) {
  const { before, after } = chat.promptTemplateInput ?? {}
  if (before) {
    for (const [scope, field] of [['variables', 'variables'], ['initial', 'promptTemplateInitialVariables']]) {
      // Legacy stages stored only the pre-turn snapshot.
      const value = after ? undoTemplateValue(before[scope] ?? undefined, after[scope] ?? undefined, chat[field]) : before[scope] ?? undefined
      if (value === undefined) delete chat[field]
      else chat[field] = value
    }
  }
  delete chat.promptTemplateInput
}

function runtimeInputFor(chat, turn, source) {
  const value = chat.runtimeInputs && chat.runtimeInputs[String(turn)]
  return value !== null && typeof value === 'object' && str(value.source) === source ? str(value.text) : null
}

function rememberedFrame(chat, operationId) {
  const frames = object(chat && chat.foregroundFrames)
  const frame = frames[str(operationId)]
  return frame !== null && typeof frame === 'object' && frame.kind === 'foreground' ? clone(frame) : null
}

function rememberFrame(chat, frame) {
  if (chat.foregroundFrames === null || typeof chat.foregroundFrames !== 'object' || Array.isArray(chat.foregroundFrames)) chat.foregroundFrames = {}
  chat.foregroundFrames[frame.operationId] = clone(frame)
  const ids = Object.keys(chat.foregroundFrames)
  for (const operationId of ids.slice(0, Math.max(0, ids.length - 40))) delete chat.foregroundFrames[operationId]
}

const FRAME_INSTRUCTION_KIND = Object.freeze({
  base: 'foreground.writing-rules',
  'world-book': 'foreground.active-worldbook',
  posture: 'foreground.current-state',
  'variable-update': 'foreground.current-state',
  guide: 'foreground.guide',
  card: 'foreground.card-context',
  'card-instruction': 'foreground.writing-rules',
  script: 'foreground.script-reference',
  'style-reference': 'foreground.script-reference'
})

function presetMiddleInstructions(snapshot) {
  const entries = Array.isArray(snapshot && snapshot.middle && snapshot.middle.entries)
    ? snapshot.middle.entries
    : []
  return entries.map(function (entry, index) {
    return {
      kind: 'foreground.writing-rules',
      text: str(entry && entry.content),
      required: false,
      source: {
        stage: 'runtime-preset',
        phase: 'middle',
        role: str(entry && entry.role) || 'system',
        entryId: str(entry && (entry.id || entry.entryKey)),
        index
      }
    }
  })
}

export function foregroundFrameInputs(plan, sourceText, projectedText, presetSnapshot, chat, pluginSections = [], rosterAddendum = '') {
  const inputs = [{
    kind: 'foreground.user-input',
    sourceText,
    projectedText,
    source: { stage: 'player-input' }
  }]
  const sections = Array.isArray(plan && plan.sections) && plan.sections.length > 0
    ? plan.sections
    : [{ kind: 'legacy-plan-text', required: true, text: str(plan && plan.text) }]
  const plugins = Array.isArray(pluginSections) ? pluginSections : []
  const pluginInput = section => ({
    kind: section.worldbook ? 'foreground.active-worldbook' : 'foreground.current-state',
    text: str(section.text),
    required: false,
    source: { stage: 'plugin', plugin: str(section.owner), name: str(section.name) }
  })
  // Plugin contributions sit before or after Tavern's own context: worldbook entries beside
  // the recalled worldbook, other sections as current-turn state.
  for (const section of plugins.filter(item => item.position === 'before')) inputs.push(pluginInput(section))
  for (const [index, section] of sections.entries()) {
    const sectionKind = str(section && section.kind)
    inputs.push({
      kind: FRAME_INSTRUCTION_KIND[sectionKind] || (sectionKind === 'legacy-plan-text' ? 'foreground.writing-rules' : 'foreground.unsupported'),
      text: str(section && section.text),
      ...(section.entries ? { entries: section.entries } : {}),
      required: section && section.required === true,
      source: { stage: 'context-plan', sectionKind, index }
    })
  }
  // A speaker recalled after the frozen roster: this turn's tail only.
  if (rosterAddendum) inputs.push({ kind: 'foreground.current-state', text: rosterAddendum, required: true, source: { stage: 'speaker-roster-addendum' } })
  for (const section of plugins.filter(item => item.position !== 'before')) inputs.push(pluginInput(section))
  if (usesOfficialMvu(chat)) {
    inputs.push({
      kind: 'foreground.writing-rules',
      text: '变量更新由正文提交后的后台 Agent 独立结算。只输出剧情正文，不要输出 <UpdateVariable>、JSON Patch 或变量更新说明。',
      required: true,
      source: { stage: 'mvu-background-owner' }
    })
  }
  return inputs.concat(ledgerFrameInputs(chat), presetMiddleInstructions(presetSnapshot), scriptPromptFrameInputs(chat))
}

function frameSource(chat, card, operation) {
  const worldBook = object(chat && chat.preparedWorldBook)
  const preset = object(chat && chat.runtimePresetSnapshot)
  return {
    card: {
      path: cardPathOf(chat),
      name: str(card && card.name),
      revision: card === null || card === undefined || card.revision === undefined ? null : clone(card.revision)
    },
    worldBook: {
      branchId: str(worldBook.branchId) || null,
      revision: Number.isSafeInteger(Number(worldBook.revision)) ? Number(worldBook.revision) : null,
      refs: Array.isArray(worldBook.refs) ? clone(worldBook.refs) : [],
      diagnostics: Array.isArray(worldBook.diagnostics) ? clone(worldBook.diagnostics) : []
    },
    state: clone(operation.basedOn),
    preset: {
      id: str(preset.id) || null,
      digest: str(preset.digest) || null
    }
  }
}

/**
 * Own one Tavern turn from context preparation through final state commit.
 * DSH lifecycle adapters call this small interface; model tools only stage
 * optional card changes and never carry the generated reply back into storage.
 */
export function createTurnOrchestrator(options) {
  if (options === null || typeof options !== 'object') throw new Error('缺少回合编排依赖')
  const store = options.store
  const planner = options.planner
  const scripts = options.scripts
  const cards = options.cards
  const workspace = options.workspace
  const timeline = options.timeline
  const frameBuilder = options.frameBuilder
  if (!frameBuilder || typeof frameBuilder.build !== 'function') throw new Error('缺少 ForegroundFrameBuilder')
  const now = typeof options.now === 'function' ? options.now : Date.now
  const renderMacros = typeof options.renderMacros === 'function' ? options.renderMacros : null
  const resolvePresetRegexScripts = typeof options.resolvePresetRegexScripts === 'function'
    ? options.resolvePresetRegexScripts
    : async function (chat) {
        return Array.isArray(chat.runtimePresetSnapshot && chat.runtimePresetSnapshot.regexScripts)
          ? chat.runtimePresetSnapshot.regexScripts
          : []
      }
  const projectReply = typeof options.projectReply === 'function'
    ? options.projectReply
    : function (text) { return { bodyText: str(text), presentationHtml: '', warnings: [] } }
  const projectWorldBookTemplates = typeof options.projectWorldBookTemplates === 'function'
    ? options.projectWorldBookTemplates
    : async function () { return { context: '', refs: [], diagnostics: [] } }
  const resolvePreset = typeof options.resolvePreset === 'function'
    ? options.resolvePreset
    : async function (chat) { return chat?.runtimePresetSnapshot ?? null }
  const shellToolName = options.shellToolName === 'pwsh' ? 'pwsh' : 'bash'

  // Story preparation reads only the floors its world book and templates use.
  const contextForSession = typeof store.storyContextForSession === 'function' ? store.storyContextForSession : store.chatForSession

  function validMessageIndex(value) {
    return Number.isSafeInteger(value) && value >= 0
  }

  // A prepared body owns its logical rows from the first token until the final
  // render. Scoped append commits hold only this turn's rows, so an absolute
  // placeholder index naturally falls through to push there; a complete Chat
  // instead replaces the existing placeholder in place.
  function commitMessageRow(draft, index, message) {
    const matches = row => row?.placeholder === true && row.role === message.role
      && (message.role !== 'assistant' || Number(row.turn) === Number(message.turn))
    let target = validMessageIndex(index) && index < draft.messages.length && matches(draft.messages[index]) ? index : -1
    if (target < 0) target = draft.messages.findLastIndex(matches)
    if (target >= 0) draft.messages[target] = message
    else draft.messages.push(message)
  }

  function commitUserMessageRow(draft, placeholder, message) {
    // A failed turn retires its assistant placeholder but keeps the player's
    // durable request row. If that native round is adopted later (#196), no live
    // placeholder remains to find it by index. Reuse the request id before falling
    // back to insertion, or the recovery writes the same player input twice.
    const requestId = str(message.source?.rpcId).trim()
    if (requestId) {
      const existing = draft.messages.findLastIndex(row => row?.role === 'user' && str(row.source?.rpcId).trim() === requestId)
      if (existing >= 0) {
        draft.messages[existing] = message
        return
      }
    }
    const assistantIndex = placeholder?.assistantIndex
    if (!validMessageIndex(placeholder?.userIndex) && validMessageIndex(assistantIndex)
      && assistantIndex < draft.messages.length && draft.messages[assistantIndex]?.placeholder === true) {
      draft.messages.splice(assistantIndex, 0, message)
      return
    }
    commitMessageRow(draft, placeholder?.userIndex, message)
  }

  // Player input is story data, not an optimistic Session echo. Persist it before
  // generation and let prepare/finalize update this same absolute message index.
  async function appendUser(input) {
    const sessionId = str(input && input.sessionId).trim()
    const requestId = str(input && input.requestId).trim()
    const userText = str(input && (input.userText !== undefined ? input.userText : input.text)).trim()
    const attachments = inputAttachments(input && input.userContent)
    if (!sessionId || !requestId || (!userText && attachments.length === 0)) throw new Error('玩家输入缺少会话、请求号或内容')
    const chat = await store.chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    const mode = chat.mode || 'story'
    if (!['story', 'script'].includes(mode)) return { saved: false, mode }
    let result = null
    await store.updateChat(chat.id, current => {
      const messages = Array.isArray(current.messages) ? current.messages : []
      const existing = messages.findLastIndex(row => row?.role === 'user' && str(row.source?.rpcId).trim() === requestId)
      if (existing >= 0) {
        if (str(messages[existing].sourceText ?? messages[existing].text).trim() !== userText) throw new Error('同一请求号的玩家输入内容不一致')
        result = { saved: true, mode, requestId, messageIndex: existing, duplicate: true }
        return undefined
      }
      const messageIndex = messages.length
      messages.push({ role: 'user', text: userText, sourceText: userText, ts: now(), native: true, placeholder: true,
        source: { kind: 'user', rpcId: requestId }, ...(attachments.length ? { inputAttachments: attachments } : {}) })
      current.messages = messages
      result = { saved: true, mode, requestId, messageIndex, duplicate: false }
      return current
    }, { source: 'player.input', requestId })
    if (!result) throw new Error('玩家输入保存未完成')
    return result
  }

  async function prepare(input) {
    let chat = await contextForSession(input.sessionId)
    // Regeneration asks for the same preparation a normal send would do, but
    // owns no story rows yet. Build that request from the live save and current
    // preset/worldbook without writing placeholders, checkpoints or frame state.
    if (chat === undefined) {
      return {
        ready: false,
        mode: 'unbound',
        cardName: '',
        text: '【酒馆状态】\n尚未选择人物卡。请简短提示用户先在界面中选择人物卡。'
      }
    }
    const preview = input.preview === true
    if (preview) {
      // A bounded window hands out `messages` as a Proxy facade and structuredClone
      // refuses any Proxy ("[object Array] could not be cloned."): materialize the
      // visible rows before the planning copy.
      chat = structuredClone(isScopedMessages(chat.messages) ? { ...chat, messages: Array.from(chat.messages) } : chat)
      if (Object.hasOwn(input, 'runtimePresetSnapshot')) chat.runtimePresetSnapshot = clone(input.runtimePresetSnapshot)
      else input = { ...input, runtimePresetSnapshot: await resolvePreset(chat, { preview: true }) }
    }
    // Candidate-first regeneration reuses the frozen frame captured for it.
    // A preview must always plan from current state, never from a remembered one.
    if (!preview && chat.regenInProgress === true && chat.regenRecovery?.candidateFrame?.kind === 'foreground') {
      const frame = clone(chat.regenRecovery.candidateFrame)
      return {
        ready: true,
        mode: chat.mode || 'story',
        cardName: str(chat.cardName),
        userText: str(frame.userInput?.projectedText),
        frame
      }
    }
    let preparationBase = captureChatHeader(chat)
    async function savePreparation(metadata) {
      if (preview) return
      if (store.writeChatHeader) preparationBase = await store.writeChatHeader(chat,preparationBase,metadata)
      else {
        await store.writeChat(chat,metadata)
        preparationBase = captureChatHeader(chat)
      }
    }
    async function saveStoryPreparation(refreshFrame) {
      if (preview) return
      const operation = foregroundOperation && chat.timeline?.operations?.[foregroundOperation.operationId]
      if (!operation) return savePreparation({ source: 'foreground.prepare' })
      // A repeated prepare reuses both its frame and the rows created by the
      // first one. Header-only retries never append a second logical turn.
      if (operation.placeholder) return savePreparation({ source: 'foreground.prepare' })
      const attachments = inputAttachments(input.userContent)
      const withUser = userText !== '' || attachments.length > 0
      const savedUserIndex = withUser ? requestUserIndex(chat.messages, requestId) : -1
      const savedUser = savedUserIndex >= 0 ? chat.messages[savedUserIndex] : null
      const userFields = {
        role: 'user', text: runtimeUserText, sourceText: userText, ts: savedUser?.ts ?? now(), native: true,
        ...(attachments.length ? { inputAttachments: attachments } : {}),
        ...(requestId ? { source: { kind: 'user', rpcId: requestId } } : {})
      }
      const template = chat.promptTemplateInput?.turn === turn ? chat.promptTemplateInput : null
      if (template) Object.assign(userFields, clone(template.message), { templateInputSource: userText })
      userFields.placeholder = true
      userFields.native = true
      const user = { ...savedUser, ...userFields }
      const assistant = {
        role: 'assistant', text: '', sourceText: '', displayText: '', displayMode: 'html',
        ts: now(), native: true, turn, placeholder: true
      }
      // An already saved player row is updated in place; only the assistant is appended.
      const rows = savedUser ? [assistant] : withUser ? [user, assistant] : [assistant]
      let selected = store.readChatSlice ? await store.readChatSlice(input.sessionId, []) : null
      if (selected?.denseMessages && store.patchChat && Number.isSafeInteger(selected.messageCount)) {
        const baseline = preparationBase
        const revision = Number(baseline?._storageRevision)
        const count = chat.messages.length
        if (!Number.isSafeInteger(revision)) throw preparationConflict('invalid-base-revision')
        const conflict = (reason, details) => preparationConflict(reason, { ...details, writers: store.writersSince?.(chat.id, revision) })
        const userIndex = savedUserIndex >= 0 ? savedUserIndex : withUser ? count : null
        const assistantIndex = count + rows.length - 1
        operation.placeholder = { userIndex, assistantIndex }
        const header = captureChatHeader(chat)
        const prepared = diffJson(baseline, header).filter(change => !storageStamp(change))
        let refreshedFrame
        const receipt = await commitChatFields(store.patchChat, chat.id, { source: 'foreground.prepare' }, async attempt => {
          if (attempt > 0) selected = await store.readChatSlice(input.sessionId, [])
          if (!selected?.denseMessages || selected.chat.id !== chat.id || selected.messageCount !== count) {
            throw conflict('message-layout-changed', { revision, count, currentCount: selected?.messageCount })
          }
          const currentRevision = selected.chat._storageRevision
          const versions = { revision, currentRevision }
          let latestUser = savedUser
          let changes = [...prepared]
          const changedRows = new Map()
          let refreshNeeded = false
          refreshedFrame = undefined
          if (currentRevision !== revision) {
            // Other parts of Tavern keep writing while a turn is prepared (settlement, candidates, template
            // display, stage direction, card scripts). Like any header write, their fields merge with the
            // preparation's own; only an edit of the same field, or a story that moved, stops the turn.
            const concurrent = diffJson(baseline, captureChatHeader(selected.chat)).filter(change => !chatStampPath(change.path))
            if (concurrent.some(({ path }) => path[0] === 'timeline' && (path.length === 1 || path[1] === 'branchId' || path[1] === 'revision'))) {
              throw conflict('timeline-moved', versions)
            }
            refreshNeeded = concurrent.some(change => change.path[0] !== 'rollbackUndo')
            changes = rebaseChatChanges(prepared, concurrent)
            if (!changes) throw conflict('overlapping-header-changes', { ...versions, fields: changedPaths(concurrent) })
            const changed = await store.readChangedSlice?.(chat.id, revision)
            if (!changed?.denseMessages) throw conflict('missing-change-history', versions)
            if (changed.layoutChanged || changed.messageCount !== count) {
              throw conflict('message-layout-changed', { ...versions, count, currentCount: changed.messageCount })
            }
            if (changed.chat._storageRevision !== currentRevision) return undefined
            const unloaded = changed.indices.filter(index => !chat.messages[index])
            const historical = unloaded.length && store.readWindow ? await readRowsAt(store.readWindow, chat.id, revision, unloaded) : null
            const historicalRows = new Map(unloaded.map((index, offset) => [index, historical?.chat.messages[offset]]))
            for (const [offset, index] of changed.indices.entries()) {
              const before = chat.messages[index] ?? historicalRows.get(index)
              const after = changed.chat.messages[offset]
              if (!before || !after) throw conflict('missing-message', { ...versions, index })
              // A floor's own story must stay; what others write beside it (variables, template display,
              // stage direction, settlement checkpoints, display captures) does not change this turn.
              if (!sameChatMessageIdentity(before, after, index) || !sameChatMessageStory(before, after)) {
                throw conflict('message-changed', { ...versions, index })
              }
              changedRows.set(index, after)
              if (!isDeepStrictEqual(before.variables, after.variables)) refreshNeeded = true
              if (index === savedUserIndex) latestUser = after
            }
          }
          const nextUser = { ...latestUser, ...userFields }
          if (inputVariablesChanged(template, latestUser, savedUser)) {
            copyInputVariables(nextUser, latestUser)
            if (template) {
              const staged = { ...template.message }
              copyInputVariables(staged, latestUser)
              changes.push(...diffJson(template.message, staged).map(change => ({
                ...change, path: ['promptTemplateInput', 'message', ...change.path]
              })))
            }
          }
          if (template && withUser) changes.push({ op: 'set',
            path: ['timeline', 'operations', foregroundOperation.operationId, 'placeholder', 'inputVariablesDigest'],
            value: inputVariablesDigest(nextUser) })
          if (refreshNeeded) {
            if (savedUser) changedRows.set(savedUserIndex, nextUser)
            const latest = applyJsonChangesShared(captureChatHeader(selected.chat), changes)
            latest.messages = createScopedMessages(count, changedRows, index => chat.messages[index])
            refreshedFrame = await refreshFrame(latest)
            if (refreshedFrame) changes.push({ op: 'set', path: ['foregroundFrames', foregroundOperation.operationId], value: refreshedFrame })
          }
          if (savedUser) {
            changes.push(...diffJson(latestUser, nextUser).map(change => ({
              ...change, path: ['messages', savedUserIndex, ...change.path]
            })))
          }
          changes.push({ op: 'splice', path: ['messages'], index: count, deleteCount: 0, items: rows })
          return { revision: currentRevision, changes }
        })
        if (!receipt) throw conflict('revision-retries-exhausted', { revision, currentRevision: selected?.chat._storageRevision })
        return refreshedFrame
      }
      // Legacy/flat saves use the same identity rule as the scoped patch path.
      operation.placeholder = { userIndex: savedUserIndex >= 0 ? savedUserIndex : withUser ? chat.messages.length : null,
        assistantIndex: chat.messages.length + rows.length - 1 }
      if (template && withUser) {
        if (inputVariablesChanged(template, savedUser, savedUser)) {
          copyInputVariables(user, savedUser)
          copyInputVariables(template.message, savedUser)
        }
        operation.placeholder.inputVariablesDigest = inputVariablesDigest(user)
      }
      if (savedUser) chat.messages[savedUserIndex] = user
      chat.messages.push(...rows)
      await store.writeChat(chat, { source: 'foreground.prepare' })
    }
    const turn = Math.max(0, Number(input.turn) || 0)
    const requestId = str(input.requestId).trim()
    const userText = str(input.userText).trim()
    const requestCommit = commitForRequest(chat, requestId)
    if (requestCommit !== null) {
      return {
        ready: false,
        duplicate: true,
        committedTurn: Math.max(0, Number(requestCommit.turn) || 0),
        mode: chat.mode || 'story',
        cardName: str(chat.cardName)
      }
    }
    let runtimeUserText = userText
    let reusedRuntimeInput = false
    let foregroundOperation = null
    const mode = chat.mode || 'story'
    // Native composer submissions arrive here without the page's pre-generate RPC.
    // Persist their input before planning too; an existing RPC row is a no-op.
    if (!preview && ['story', 'script'].includes(mode) && requestId && (userText || inputAttachments(input.userContent).length)) {
      const exists = chat.messages.some(row => row?.role === 'user' && str(row.source?.rpcId).trim() === requestId)
      if (!exists) {
        await appendUser({ sessionId: input.sessionId, requestId, userText, userContent: input.userContent })
        chat = await contextForSession(input.sessionId)
        preparationBase = captureChatHeader(chat)
      }
    }
    let chatChanged = clearStaleStages(chat, turn)
    if (chat.foregroundError !== null && chat.foregroundError !== undefined) {
      chat.foregroundError = null
      chatChanged = true
    }

    if (mode === 'story' || mode === 'script') {
      // body.begin (including legacy timeline normalization) only edits metadata.
      // Keep the history already detached by chatForSession; full timeline.apply
      // remains deeply isolated for callers that edit or restore message bodies.
      const begun = timeline.apply({ chat: { ...chat, messages: [] }, intent: { kind: 'body.begin', turn, userText } })
      chat = { ...begun.chat, messages: chat.messages }
      foregroundOperation = begun.value
      const cachedFrame = preview ? null : rememberedFrame(chat, foregroundOperation.operationId)
      if (cachedFrame !== null) {
        if (chatChanged) await savePreparation({ source: 'foreground.prepare' })
        return {
          ready: true,
          mode,
          cardName: str(chat.cardName),
          userText: frameUserInput(cachedFrame).projectedText,
          frame: cachedFrame
        }
      }
      chatChanged = true
      const cachedRuntimeInput = runtimeInputFor(chat, turn, userText)
      if (cachedRuntimeInput !== null) {
        runtimeUserText = cachedRuntimeInput
        reusedRuntimeInput = true
      } else {
        if (renderMacros !== null && userText.includes('{{')) runtimeUserText = renderMacros(userText, chat)
      }
    }

    const cardPath = cardPathOf(chat)
    if ((mode === 'story' || mode === 'script') && cardPath === '') throw new Error('当前游玩缺少人物卡绑定，无法继续本轮。请先恢复人物卡或救援存档。')
    // Workbench tools must remain available when the file being repaired is invalid.
    const card = cardPath === '' ? null : mode === 'card' ? { name: chat.cardName } : await store.readCard(cardPath, chat)
    if (cardPath !== '' && card === undefined) throw new Error('人物卡不存在: ' + cardPath)
    if ((mode === 'story' || mode === 'script') && !reusedRuntimeInput) {
      const extensions = Object.hasOwn(input, 'cardExtensions')
        ? clone(input.cardExtensions)
        : typeof store.readCardExtensions === 'function'
          ? await store.readCardExtensions(cardPath, chat)
          : null
      const presetRegexScripts = await resolvePresetRegexScripts(chat)
      const regexScripts = composeTavernRegexScripts(extensions, presetRegexScripts, chat.regexOverrides && chat.regexOverrides.preset)
      // As in SillyTavern, only permanent input rules change the stored player
      // message; prompt-only rules (e.g. a preset wrapping the input in tags)
      // reach the model and never the bubble, copy or saved history.
      const promptOnly = regexScripts.filter(script => script?.promptOnly === true)
      runtimeUserText = projectBackgroundInput(runtimeUserText, regexScripts.filter(script => script?.promptOnly !== true), 1).text
      if (typeof options.projectUserTemplate === 'function' && runtimeUserText !== '') {
        const baselineDigest = inputVariablesDigest(chat.messages[requestUserIndex(chat.messages, requestId)])
        const projected = await options.projectUserTemplate({ chat, card, turn, text: runtimeUserText, preview })
        runtimeUserText = projected.message.text
        stageTemplateInput(chat, turn, userText, projected, baselineDigest)
      }
      const prompted = projectBackgroundInput(runtimeUserText, promptOnly, 1)
      if (prompted.changed) {
        // A replacement may carry macros; SillyTavern substitutes them in the prompt.
        runtimeUserText = renderMacros !== null && prompted.text.includes('{{') ? renderMacros(prompted.text, chat) : prompted.text
      }
      rememberRuntimeInput(chat, turn, userText, runtimeUserText)
      chatChanged = true
      // The staged template input must be saved before anything reads the save (the worldbook
      // projection runs templates); with that projection, its save just below carries it.
      if (chat.promptTemplateInput?.turn === turn && typeof options.projectForegroundWorldbook !== 'function') await savePreparation({source:'prompt-template.input'})
    }
    let scriptReference = null

    if (mode === 'script') {
      const script = await store.readScript(cardPath)
      if (script === undefined || !Array.isArray(script.chunks) || script.chunks.length === 0) throw new Error('剧本文件不存在，请重新为人物卡导入剧本')
      const existing = chat.scriptState && chat.scriptState.prepared
      if (existing !== null && existing !== undefined && Number(existing.nativeTurn) !== turn) {
        chat.scriptState = scripts.transition({ script, state: chat.scriptState, event: { kind: 'restore', revision: null, reference: existing } }).state
        chatChanged = true
      }
      const prior = commitFor(chat, turn)
      if (prior && prior.scriptReference) {
        scriptReference = prior.scriptReference
      } else {
        const prepared = scripts.transition({ script, state: chat.scriptState, event: { kind: 'prepare', userText: runtimeUserText, nativeTurn: turn } })
        chat.scriptState = prepared.state
        scriptReference = prepared.reference
        chatChanged = chatChanged || prepared.changed
      }
    }

    if (mode === 'card') {
      // An @ mention only names the file to work on in this message; it is not
      // remembered as a session resource. Only linked play records persist.
      const state = object(chat.workspace)
      chat.workspace = state
      const prepared = (Array.isArray(state.sourcePaths) ? state.sourcePaths : state.sourceIds || []).length > 0 ? await workspace.prepare(chat, turn) : null
      const plan = await planner.plan({ purpose: 'card', sourcePrepared: prepared })
      await store.writeChat(chat, { source: 'card.prepare' })
      return { ready: true, mode, cardName: card === null ? (str(state.draft && state.draft.name) || '卡片工作台') : card.name, text: plan.text }
    }

    // Screening can persist a shared background task. Save the pending body and
    // input first, then continue from its latest timeline instead of overwriting it.
    if (typeof options.projectForegroundWorldbook === 'function') await savePreparation({ source: 'foreground.prepare-worldbook' })
    const foregroundWorldBook = typeof options.projectForegroundWorldbook === 'function'
      ? await options.projectForegroundWorldbook({ chat, card, turn, userText: runtimeUserText, requestKey: foregroundOperation.operationId }) : null
    if (typeof options.projectForegroundWorldbook === 'function') {
      const screenedFrom = Number(preparationBase?._storageRevision)
      if (!preview) {
        chat = await contextForSession(input.sessionId)
        if (chat) preparationBase = captureChatHeader(chat)
      }
      const current = chat && timeline.inspect({ chat })
      if (!current || current.branchId !== foregroundOperation.basedOn.branchId || current.revision !== foregroundOperation.basedOn.revision ||
          current.operations[foregroundOperation.operationId]?.status !== 'running') {
        throw preparationConflict('timeline-changed-during-worldbook', { writers: chat ? store.writersSince?.(chat.id, screenedFrom) : [] })
      }
      const stage = chat.promptTemplateInput
      const row = chat.messages[requestUserIndex(chat.messages, requestId)]
      if (stage?.turn === turn && inputVariablesChanged(stage, row, row)) copyInputVariables(stage.message, row)
    }
    const templateWorldBook = foregroundWorldBook || await projectWorldBookTemplates({ chat, card, turn, userText: runtimeUserText })
    const scriptWorldBook = !foregroundWorldBook && typeof options.projectScriptPromptWorldbook === 'function' ? await options.projectScriptPromptWorldbook({ chat, card, turn }) : null
    const worldBookContext = foregroundWorldBook ? str(foregroundWorldBook.context) : [str(scriptWorldBook && scriptWorldBook.context).trim(), templateWorldBook?.dynamicConstants ? '' : str(templateWorldBook && templateWorldBook.context).trim()].filter(Boolean).join('\n\n')
    if (foregroundWorldBook) {
      if (foregroundWorldBook.randomState) chat.worldBookRandomState = foregroundWorldBook.randomState
      if (foregroundWorldBook.virtualState) chat.worldBookVirtualState = foregroundWorldBook.virtualState
      if (foregroundWorldBook.reads) chat.worldBookReads = foregroundWorldBook.reads
      chat.preparedWorldBookContext = worldBookContext
      chat.preparedWorldBook = { ...foregroundWorldBook.activation, branchId: foregroundOperation.basedOn.branchId, revision: foregroundOperation.basedOn.revision }
      chat.lastWorldBookRecall = clone(chat.preparedWorldBook)
      chat.worldBookError = foregroundWorldBook.error
    }
    const plannedUserName = chat.macroState?.userName
    const planBody = state => {
      const templateMacros = templateWorldBook?.macroState
      const macroState = templateMacros && state.macroState?.userName !== plannedUserName
        ? { ...templateMacros, userName: state.macroState?.userName } : templateMacros
      return planner.plan({ purpose: 'body', card, chat: macroState ? { ...state, macroState } : state, userText: runtimeUserText,
        sessionId: input.sessionId, nativeTurn: turn, scriptReference, styleReference: null, variableUpdate: variableUpdateFor(state), worldBookContext })
    }
    const plan = await planBody(chat)
    // Seam to the plugin layer; it never throws and drops a failing plugin's part.
    const pluginSections = Object.hasOwn(input, 'pluginSections') && Array.isArray(input.pluginSections)
      ? clone(input.pluginSections)
      : typeof options.pluginTurnContext === 'function'
        ? await options.pluginTurnContext({ gameId: input.sessionId, turn, input: userText }).catch(() => []) : []
    const rosterAddendum = foregroundWorldBook && typeof options.foregroundRosterAddendum === 'function'
      ? await options.foregroundRosterAddendum({ chat, userText: runtimeUserText }) : ''
    const source = frameSource(chat, card, foregroundOperation)
    if (typeof options.bodyGeneration === 'function') source.bodyGeneration = await (options.prepareBodyGeneration || options.bodyGeneration)(input.sessionId)
    if (typeof options.activeDamperRuling === 'function') {
      const activeDamper = options.activeDamperRuling(chat.id, turn)
      if (activeDamper?.ruling) source.narrativeDamper = clone(activeDamper.ruling)
    }
    source.worldBook.scriptPromptRefs = Array.isArray(scriptWorldBook && scriptWorldBook.refs) ? clone(scriptWorldBook.refs) : []
    if (scriptWorldBook && typeof scriptWorldBook.recordReads === 'function') chat.worldBookReads = scriptWorldBook.recordReads(chat.worldBookReads)
    source.worldBook.templateRefs = Array.isArray(templateWorldBook && templateWorldBook.refs) ? clone(templateWorldBook.refs) : []
    if (foregroundWorldBook?.virtualState) source.worldBook.virtualWorldbook = {
      scope: foregroundWorldBook.virtualState.scope,
      texts: Object.fromEntries((foregroundWorldBook.changedVirtualRefs || []).map(ref => [ref, foregroundWorldBook.virtualState.entries[ref]?.contextText ?? foregroundWorldBook.virtualState.entries[ref]?.text])),
      entries: Object.fromEntries((foregroundWorldBook.changedVirtualRefs || []).map(ref => [ref, foregroundWorldBook.virtualState.entries[ref]?.renderHash]))
    }
    source.worldBook.templateDiagnostics = Array.isArray(templateWorldBook && templateWorldBook.diagnostics) ? clone(templateWorldBook.diagnostics) : []
    const regeneration = (state, systemPromptText) => captureBodyRegenerationSource({ chat: state, card,
      worldbookPrefix: foregroundWorldBook?.prefixContext ?? templateWorldBook?.prefixContext, systemPromptText })
    const preparedState = regeneration(chat, plan.systemPromptText)
    const buildFrame = (state, contextPlan, regenerationState) => frameBuilder.build({
      chatId: state.id,
      branchId: foregroundOperation.basedOn.branchId,
      basedOnRevision: foregroundOperation.basedOn.revision,
      operationId: foregroundOperation.operationId,
      turn,
      inputs: foregroundFrameInputs(contextPlan, userText, runtimeUserText,
        Object.hasOwn(input, 'runtimePresetSnapshot') ? input.runtimePresetSnapshot
          : resolveRuntimePresetMacros(state.runtimePresetSnapshot, { charName: card.name, macroState: state.macroState }).snapshot, state, pluginSections, rosterAddendum),
      source: { ...source, card: { ...source.card, systemPromptText: contextPlan.systemPromptText }, ...regenerationState }
    })
    let frame = buildFrame(chat, plan, preparedState)
    if (!preview && foregroundWorldBook?.log && typeof options.recordWorldbookRecall === 'function') {
      let receipt
      try { receipt = { recallLog: await options.recordWorldbookRecall({ chat, frame, log: foregroundWorldBook.log }) } }
      catch (error) { receipt = { recallLogError: String(error?.message || error) } }
      Object.assign(source.worldBook, receipt)
      frame = buildFrame(chat, plan, preparedState)
    }
    const { ledgerInjection, tavernScriptPrompts } = chat
    consumeScriptPrompts(chat)
    // The ledger is read once after a consolidation; this turn's frame keeps it for retries.
    delete chat.ledgerInjection
    rememberFrame(chat, frame)
    chatChanged = true
    // The frame is already built, so these logical rows cannot leak into the
    // current model request. They become visible immediately and are replaced
    // in place by foreground.commit.
    if (chatChanged && (mode === 'story' || mode === 'script')) {
      frame = await saveStoryPreparation(async latest => {
        // The staged scripts and worldbook controllers already ran for this
        // turn. Refresh the frame's variable inputs without executing them again.
        if (tavernScriptPrompts !== undefined) latest.tavernScriptPrompts = tavernScriptPrompts
        latest.ledgerInjection = ledgerInjection
        const current = regeneration(latest, plan.systemPromptText)
        if (isDeepStrictEqual(current.regenerationMaterials.generationState, preparedState.regenerationMaterials.generationState)
          && isDeepStrictEqual(latest.macroState?.userName, plannedUserName)
          && isDeepStrictEqual(current.regenerationState.tavernHelperScriptVariables, preparedState.regenerationState.tavernHelperScriptVariables)) return undefined
        const refreshed = await planBody(latest)
        return buildFrame(latest, refreshed, regeneration(latest, refreshed.systemPromptText))
      }) || frame
    }
    else if (chatChanged) await savePreparation({ source: 'foreground.prepare' })
    return { ready: true, mode, cardName: card.name, userText: runtimeUserText, frame }
  }

  // Tool writes are immediate, so a subsequent validation reads these bytes.
  // Finalize still records the conversation; it must not replay this change.
  async function saveChanges(input) {
    const chat = await store.chatForSession(input.sessionId)
    if (!chat || chat.mode !== 'card') throw new Error('人物卡只能在卡片模式中修改')
    const cardPath = cardPathOf(chat)
    const fields = object(input.fields), rawOperations = Array.isArray(input.rawOperations) ? input.rawOperations : []
    if (!Object.keys(fields).length && !rawOperations.length) throw new Error('没有提供需要修改的字段')
    // Like editing code: any card file can be targeted by path; the workbench's own
    // card is only the default.
    const target = str(input.path).trim() === '' ? '' : normalizeResourcePath(str(input.path).trim(), 'card')
    // A card the Agent actually changed gets the Tavern credit once, in a follow-up save.
    async function updateWithCredit(path) {
      const change = await store.updateCard(path, fields, { ts: now(), summary: '卡片 Agent 直接保存' }, rawOperations)
      if (!change.changed || hasTavernCredit(change.card?.creator_notes)) return change
      await store.updateCard(path, { creator_notes: withTavernCredit(change.card?.creator_notes) }, { ts: now(), summary: '标注 DSH Tavern 合著' }, [])
      return change
    }
    if (target !== '' && target !== cardPath) {
      const other = await updateWithCredit(target)
      return { saved: true, mode: 'card', path: target, changed: other.changed, createsCard: false, changedFields: other.changedFields || [] }
    }
    let result
    if (!cardPath) {
      if (rawOperations.length) throw new Error('新人物卡创建前不能修改 raw，请先创建人物卡')
      const state = object(chat.workspace)
      const change = cards.update({ kind: 'draft', card: object(state.draft), player: state.player, patch: fields })
      const next = { ...state, draft: change.card, player: change.player }
      const created = await store.createCard(chat, next)
      chat.workspace = { ...next, done: true }
      chat.cardPath = created.path; chat.cardName = created.card.name
      result = { changed: true, changedFields: change.changedFields }
    } else {
      result = await updateWithCredit(cardPath)
      chat.cardName = result.card.name
    }
    if (chat.pendingCardChanges) delete chat.pendingCardChanges[String(input.turn)]
    rememberCardSave(chat, input.turn, { path: chat.cardPath, createsCard: !cardPath, changed: result.changed })
    await store.writeChat(chat, { source: 'card.save' })
    return { saved: true, mode: 'card', changed: result.changed, createsCard: !cardPath, changedFields: result.changedFields || [] }
  }

  async function stageChanges(input) {
    const chat = await store.chatForSession(input.sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    const mode = chat.mode || 'story'
    if (mode !== 'card') throw new Error('人物卡只能在卡片模式中修改')
    const turn = Math.max(0, Number(input.turn) || 0)
    if (!turn) throw new Error('无法确定当前回合')
    clearStaleStages(chat, turn)
    const stages = stagedMap(chat)
    const combined = mergeStage(object(stages[String(turn)]), input.fields, input.rawOperations)
    if (Object.keys(combined.fields).length === 0 && combined.rawOperations.length === 0) throw new Error('没有提供需要修改的字段')

    let preview
    const cardPath = cardPathOf(chat)
    if (cardPath === '') {
      if (combined.rawOperations.length > 0) throw new Error('新人物卡创建前不能修改 raw，请先创建人物卡')
      const state = object(chat.workspace)
      preview = cards.update({ kind: 'draft', card: object(state.draft), player: state.player, patch: combined.fields })
      if (preview.player !== str(state.player).trim() && !preview.changedFields.includes('player')) preview.changedFields.push('player')
      cards.create({
        kind: 'draft',
        draft: preview.card,
        player: preview.player,
        sourcePaths: state.sourcePaths || state.sourceIds || []
      })
    } else {
      const card = await store.readCard(cardPath, chat)
      if (card === undefined) throw new Error('人物卡不存在: ' + cardPath)
      preview = cards.update({ kind: 'card', card, patch: combined.fields, rawOperations: combined.rawOperations })
    }

    stages[String(turn)] = combined
    await store.writeChat(chat, { source: 'card.stage' })
    return { staged: true, mode, changed: preview.changed, createsCard: cardPath === '', changedFields: preview.changedFields }
  }

  async function finalize(input) {
    const scoped = await finalizeAppend(input)
    if (scoped !== null) return scoped
    const chat = await store.chatForSession(input.sessionId)
    if (chat === undefined) return { saved: false, reason: 'unbound' }
    if (!['story', 'script'].includes(chat.mode || 'story') || typeof store.updateChat !== 'function') {
      return finalizeSnapshot(input, chat, (value, metadata) => store.writeChat(value, metadata))
    }
    // Consume the current template input and append its messages in one write.
    // Display rendering can enrich that input after our initial session lookup.
    const expectedTimeline = { branchId: chat.timeline?.branchId, revision: chat.timeline?.revision }
    const metadata = { source: 'foreground.commit' }
    let result = { saved: false, reason: 'unbound' }
    await store.updateChat(chat.id, async current => {
      let next
      result = await finalizeSnapshot(input, current, async (value, details) => {
        next = value
        Object.assign(metadata, details)
      }, expectedTimeline)
      return next
    }, metadata)
    return result
  }

  // A story commit only edits header fields and appends this turn's floors.
  // Read the header and the floors it needs, then append in one revision-checked
  // patch: cost stays flat as the history grows. Null keeps the complete path.
  async function finalizeAppend(input) {
    if (typeof store.readChatSlice !== 'function' || typeof store.patchChat !== 'function') return null
    let expectedTimeline
    for (let attempt = 0; attempt < 3; attempt++) {
      const selected = await store.readChatSlice(input.sessionId, [])
      const before = selected?.chat
      if (!before || !selected.denseMessages || !['story', 'script'].includes(before.mode || 'story')
        || before.timeline?.schemaVersion !== 1 || !Array.isArray(before.timeline.checkpoints)
        || Object.values(before.timeline.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed')) return null
      const revision = before._storageRevision, count = selected.messageCount
      expectedTimeline ??= { branchId: before.timeline.branchId, revision: before.timeline.revision }
      let stale = false
      async function readRows(indices) {
        const rows = await store.readChatSlice(input.sessionId, indices, ['id', '_storageRevision'])
        if (!rows?.denseMessages || rows.chat.id !== before.id || rows.chat._storageRevision !== revision) {
          stale = true
          return []
        }
        return rows.chat.messages
      }
      const history = {
        async userMessage(index) { return (await readRows([index]))[0] },
        async previousVariables() {
          for (let end = count, size = 8; end > 0; end -= size, size = Math.min(size * 8, 512)) {
            const start = Math.max(0, end - size)
            const rows = await readRows(Array.from({ length: end - start }, (_, i) => start + i))
            if (stale) return undefined
            const found = lastTavernHelperVariables(rows)
            if (found !== undefined) return found
          }
          return undefined
        }
      }
      const chat = { ...captureChatHeader(before), messages: [] }
      let next, metadata
      const result = await finalizeSnapshot(input, chat, async (value, details) => { next = value; metadata = details }, expectedTimeline, history)
      if (stale) continue
      if (next === undefined) return result
      const { messages, ...head } = next
      const changes = diffJson({ ...before, messages: [] }, { ...head, messages: [] })
        .filter(change => !['_storageRevision', 'updatedAt'].includes(change.path[0]))
      if (changes.some(change => change.path[0] === 'messages' || change.path[0] === 'id')) return null
      const placeholder = before.timeline?.operations?.[metadata?.operationId]?.placeholder
      if (placeholder) {
        const withUser = validMessageIndex(placeholder.userIndex)
        if (!validMessageIndex(placeholder.assistantIndex) || messages.length !== (withUser ? 2 : 1)) return null
        if (withUser) changes.push({ op: 'set', path: ['messages', placeholder.userIndex], value: messages[0] })
        changes.push({ op: 'set', path: ['messages', placeholder.assistantIndex], value: messages[messages.length - 1] })
      } else if (messages.length) {
        // Saves prepared before placeholder support, and adopted native rounds,
        // retain the original append-only commit contract.
        // A discarded attempt keeps the player's durable input row in the save, so
        // its补写 arrives here without a placeholder while that input is already
        // stored. Appending it again paints two identical input bubbles in the
        // story; the same request id may only ever own one row.
        let items = messages
        const inputRequestId = messages[0]?.role === 'user' ? str(messages[0].source?.rpcId).trim() : ''
        if (inputRequestId) {
          const start = Math.max(0, count - 8)
          const tail = await readRows(Array.from({ length: count - start }, (_, offset) => start + offset))
          if (stale) continue
          if (tail.some(row => row?.role === 'user' && str(row.source?.rpcId).trim() === inputRequestId)) items = messages.slice(1)
        }
        if (items.length) changes.push({ op: 'splice', path: ['messages'], index: count, deleteCount: 0, items })
      }
      if (await store.patchChat(before.id, revision, changes, metadata)) return result
    }
    return null
  }

  async function finalizeSnapshot(input, chat, writeChat, expectedTimeline, history) {
    const turn = Math.max(0, Number(input.turn) || 0)
    // The native turn owns only a candidate in the Session log. round-history
    // validates it and performs the sole story commit; ordinary finalization is
    // deliberately a no-op while that candidate is being generated.
    if (chat.regenInProgress === true && chat.regenRecovery?.candidateFrame?.kind === 'foreground') {
      return { saved: false, detached: true, mode: chat.mode || 'story', changed: false }
    }
    const requestId = str(input.requestId).trim()
    const requestCommit = commitForRequest(chat, requestId)
    if (requestCommit !== null) {
      return {
        saved: true,
        duplicate: true,
        committedTurn: Math.max(0, Number(requestCommit.turn) || 0),
        mode: chat.mode || 'story',
        changed: requestCommit.changed === true
      }
    }
    const prior = commitFor(chat, turn)
    if (prior !== null) return { saved: true, duplicate: true, mode: chat.mode || 'story', changed: prior.changed === true }
    // 同一分支上后台写入可以推进 revision（结算、候选、世界书），那不是本轮失效；
    // 换分支或 revision 倒退（回退/重置）才作废这次结果。
    if (expectedTimeline && (chat.timeline?.branchId !== expectedTimeline.branchId
      || Number(chat.timeline?.revision || 0) < Number(expectedTimeline.revision || 0))) {
      throw new Error('正文生成期间剧情状态已变化，本轮结果已作废')
    }
    const userText = str(input.userText).trim()
    const attachments = inputAttachments(input.userContent)
    const mode = chat.mode || 'story'
    const rawAssistantText = str(input.assistantText).trim()
    const frame = Object.values(chat.foregroundFrames || {}).findLast(item => Number(item.turn) === turn)
    const pluginBody = input.pluginBodyGeneration === true || frame?.source?.bodyGeneration?.mode?.startsWith('plugin-')
    const hostRegex = pluginBody && frame?.source?.bodyGeneration?.hostRegex === true
    const generated = pluginBody ? chat.timeline?.operations?.[frame?.operationId]?.bodyGeneration : null
    if (pluginBody) {
      if (generated?.status !== 'ready' || generated.receipt?.text?.trim() !== rawAssistantText) throw new Error('本轮未取得有效的插件正文，不能保存或自动补记')
    }
    const extractedForegroundChoices = mode === 'story'
      ? extractForegroundStoryChoices(rawAssistantText, { card: { name: chat.cardName }, chat })
      : { proseText: rawAssistantText, choices: null, hadTag: false }
    const sourceText = str(extractedForegroundChoices.proseText).trim()
    let assistantText = sourceText
    let previousMvuVariables
    let operation
    let currentUser
    let preserveInputVariables = false
    let reply = {
      sourceText,
      projectionText: sourceText,
      sessionText: sourceText,
      displayText: sourceText,
      displayMode: 'markdown',
      displayParts: [{ kind: 'markdown', text: sourceText }],
      warnings: []
    }
    if (mode === 'story' || mode === 'script') {
      operation = Object.values(timeline.inspect({ chat }).operations).find(item =>
        item.kind === 'body' && item.status === 'running' && Number(item.turn) === turn)
      const placeholder = chat.timeline?.operations?.[operation?.id]?.placeholder
      const userIndex = placeholder?.userIndex
      const template = chat.promptTemplateInput?.turn === turn ? chat.promptTemplateInput : null
      if (validMessageIndex(userIndex)) {
        const row = history ? await history.userMessage(userIndex) : chat.messages[userIndex]
        if (row?.role === 'user' && row.placeholder === true && (!requestId || row.source?.rpcId === requestId)) currentUser = row
      }
      preserveInputVariables = Boolean(currentUser && (placeholder.inputVariablesDigest
        ? inputVariablesDigest(currentUser) !== placeholder.inputVariablesDigest
        : Array.isArray(currentUser.variables)))
      if (!pluginBody && renderMacros !== null && assistantText.includes('{{')) assistantText = renderMacros(assistantText, chat)
      if (preserveInputVariables) previousMvuVariables = lastTavernHelperVariables([currentUser])
      else if (template) previousMvuVariables = lastTavernHelperVariables([template.message])
      else previousMvuVariables = history ? await history.previousVariables() ?? lastTavernHelperVariables([], chat.variables)
        : lastTavernHelperVariables(chat.messages, chat.variables)
      const extensions = typeof store.readCardExtensions === 'function'
        ? await store.readCardExtensions(cardPathOf(chat), chat)
        : null
      const presetRegexScripts = await resolvePresetRegexScripts(chat)
      const projectionText = assistantText
      const regexScripts = composeTavernRegexScripts(extensions, presetRegexScripts, chat.regexOverrides && chat.regexOverrides.preset)
      reply = pluginBody ? await projectPluginBody(sourceText, { hostRegex, regexScripts, pluginRegexScripts: generated?.regexScripts, projectionWarning: generated?.projectionWarning }) : projectReply(sourceText, {
        projectionText,
        regexScripts,
        placement: 2,
        isEdit: false,
        depth: 0
      })
      assistantText = str(reply.sessionText).trim()
    }
    if (assistantText === '') throw new Error('本轮最终回复为空，无法保存酒馆状态')
    const stage = takeStage(chat, turn)
    // A direct tool save earlier in this turn (tavern_update_card) leaves no staged fields,
    // so the commit has to read the record it left behind or every save looks unchanged.
    const savedThisTurn = Number(chat.lastCardSave?.turn) === turn ? chat.lastCardSave : null
    const savedChanged = savedThisTurn !== null && (savedThisTurn.changed === true || savedThisTurn.createsCard === true)

    const cardPath = cardPathOf(chat)
    if (mode === 'card' && cardPath === '') {
      const state = object(chat.workspace)
      let changed = savedChanged
      const hasCardChanges = Object.keys(object(stage.fields)).length > 0
      if (hasCardChanges) {
        const draftChange = cards.update({ kind: 'draft', card: object(state.draft), player: state.player, patch: stage.fields })
        state.draft = draftChange.card
        state.player = draftChange.player
        chat.workspace = state
        changed = draftChange.changed || changed
      }
      const created = hasCardChanges ? await store.createCard(chat, state) : null
      if (created !== null) {
        chat.cardPath = created.path
        chat.cardName = created.card.name
        state.done = true
        changed = true
      }
      workspace.commit(chat, turn)
      if (userText !== '') chat.messages.push({ role: 'user', text: userText, ts: now(), native: true })
      chat.messages.push({ role: 'assistant', text: assistantText, ts: now(), native: true, changed })
      chat.foregroundError = null
      chat.cardName = created === null ? (str(state.draft && state.draft.name) || '卡片工作台') : created.card.name
      rememberCommit(chat, turn, { mode, userText, requestId, changed }, null, now)
      await writeChat(chat, { source: 'card.commit' })
      return {
        saved: true,
        mode,
        changed,
        chatId: chat.id,
        cardName: chat.cardName,
        createdCard: created === null ? null : { path: created.path, name: created.card.name }
      }
    }

    if (mode === 'card') {
      let changed = savedChanged
      let savedCard = { name: chat.cardName }
      if (Object.keys(object(stage.fields)).length > 0 || (Array.isArray(stage.rawOperations) && stage.rawOperations.length > 0)) {
        const result = await store.updateCard(cardPath, object(stage.fields), {
          ts: now(), instruction: userText, summary: '通过卡片模式设定对话更新人物卡'
        }, Array.isArray(stage.rawOperations) ? stage.rawOperations : [])
        changed = result.changed || changed
        savedCard = result.card
      }
      workspace.commit(chat, turn)
      if (userText !== '') chat.messages.push({ role: 'user', text: userText, ts: now(), native: true })
      chat.messages.push({ role: 'assistant', text: assistantText, ts: now(), native: true, changed })
      chat.foregroundError = null
      chat.cardName = savedCard.name
      rememberCommit(chat, turn, { mode, userText, requestId, changed }, null, now)
      await writeChat(chat, { source: 'card.commit' })
      return { saved: true, mode, changed, chatId: chat.id, cardName: savedCard.name }
    }

    // Adopting a round the save missed (#196): its own operation is long gone,
    // so record it the way a fresh turn would have begun.
    if (operation === undefined && input.adopt === true) {
      const begun = timeline.apply({ chat, intent: { kind: 'body.begin', turn, userText } })
      chat = begun.chat
      operation = chat.timeline.operations[begun.value.operationId]
    }
    if (operation === undefined) throw new Error('找不到本轮正文 operation，请重新生成本轮正文')
    const liveOperation = chat.timeline?.operations?.[operation.id]
    const placeholder = liveOperation?.placeholder || null
    if (liveOperation) delete liveOperation.placeholder
    const before = {
      posture: chat.posture || '',
      ledger: chat.ledger ? structuredClone(chat.ledger) : null,
      preparedWorldBookContext: str(chat.preparedWorldBookContext),
      preparedWorldBook: clone(chat.preparedWorldBook === undefined ? null : chat.preparedWorldBook)
    }
    let scriptReference = null
    let playScript = null
    if (mode === 'script') {
      playScript = await store.readScript(cardPathOf(chat))
      if (playScript === undefined || !Array.isArray(playScript.chunks) || playScript.chunks.length === 0) throw new Error('剧本文件不存在，请重新为人物卡导入剧本')
    }
    const completed = timeline.complete({
      chat,
      operationId: operation.id,
      basedOn: operation.basedOn,
      outcome: { status: 'success' },
      apply(draft) {
        if (mode === 'script') {
          const committed = scripts.transition({ script: playScript, state: draft.scriptState, event: { kind: 'commit', userText, nativeTurn: turn } })
          draft.scriptState = committed.state
          scriptReference = committed.reference
          before.scriptRevision = committed.revision
        }
        if (userText !== '' || attachments.length) {
          const userMessage = { role: 'user', text: userText, ts: now(), native: true,
            ...(requestId ? { source: { kind: 'user', rpcId: requestId } } : {}), ...(attachments.length ? { inputAttachments: attachments } : {}) }
          if (previousMvuVariables !== undefined) Object.assign(userMessage, { swipeId: 0, swipes: [userText], variables: [clone(previousMvuVariables)] })
          if (draft.promptTemplateInput?.turn === turn) Object.assign(userMessage, clone(draft.promptTemplateInput.message), {templateInputSource:userText})
          if (preserveInputVariables) copyInputVariables(userMessage, currentUser)
          if (currentUser?.messageUid) userMessage.messageUid = currentUser.messageUid
          // A wizard wrote its opening record into the floor it sent before the game
          // existed; this is that floor arriving, so the record travels with it.
          if (draft.pendingOpeningMessageVariables) {
            const saved = clone(draft.pendingOpeningMessageVariables)
            const base = userMessage.variables && typeof userMessage.variables[0] === 'object' && userMessage.variables[0] !== null ? clone(userMessage.variables[0]) : {}
            const merged = { ...base, ...saved }
            if (base.stat_data || saved.stat_data) merged.stat_data = { ...(base.stat_data || {}), ...(saved.stat_data || {}) }
            userMessage.swipeId = 0
            userMessage.swipes = [userText]
            userMessage.variables = [merged]
            delete draft.pendingOpeningMessageVariables
          }
          commitUserMessageRow(draft, placeholder, userMessage)
        }
        delete draft.promptTemplateInput
        const assistantMessage = {
          role: 'assistant',
          ...replyProse(reply.sourceText, { ...reply, sessionText: assistantText }),
          displayMode: 'html',
          ...(input.adopt === true ? {} : {stagePageVersion: 2}),
          ts: now(),
          native: true,
          ...(pluginBody ? { bodyRegenerationProcessed: true } : {}),
          ...(hostRegex ? { bodyHostRegexApplied: true } : {}),
          ...(generated?.regexScripts !== undefined || generated?.projectionWarning ? { bodyPluginProjection: true } : {}),
          ...(input.incomplete === true ? { incomplete: true,
            incompleteReason: str(input.incompleteReason) || '这次生成被中断，保留了已生成的部分正文' } : {}),
          turn: turn,
          // Where this round entered the native session; see round-anchor.js.
          ...(validAnchor(input.nativeAnchor) && input.nativeAnchor.turn === turn ? { nativeAnchor: { ...input.nativeAnchor } } : {})
        }
        // An adopted round (#196) is recorded long after it ran: it keeps the
        // variables it started from and is not settled now, which would wait on
        // the turn that is about to start. Later rounds settle as usual.
        const adopted = input.adopt === true
        if (usesOfficialMvu(draft)) Object.assign(assistantMessage, {
          swipeId: 0,
          swipes: [str(reply.projectionText)],
          variables: [clone(previousMvuVariables || {})],
          mvu: adopted ? { pending: false, modified: false, diagnostics: [{ message: '这一轮补记自模型上下文，当时的变量变化未结算' }], events: [] }
            : { pending: true, modified: false, diagnostics: [], events: [] }
        })
        else if (!adopted) {
          const activeDamper = typeof options.activeDamperRuling === 'function' ? options.activeDamperRuling(draft.id, turn)?.ruling : null
          const persistedDamper = activeDamper || Object.values(draft.foregroundFrames || {})
            .filter(item => item && item.kind === 'foreground' && Number(item.turn) === Number(turn))
            .at(-1)?.source?.narrativeDamper || null
          if (persistedDamper && persistedDamper.fallbackStateForPlainCards !== false) {
            const priorPlain = readDamperStateSnapshot(draft, {
              excludeAssistantIndex: Number.isInteger(placeholder?.assistantIndex) ? placeholder.assistantIndex : -1,
              fallbackForPlain: true
            })
            if (priorPlain.kind === 'plain-fallback') {
              assistantMessage.damperState = [nextPlainDamperState(priorPlain.data, persistedDamper)]
            }
          }
        }
        commitMessageRow(draft, placeholder?.assistantIndex, assistantMessage)
        if (!adopted) {
          draft.settleStatus = 'pending'
          draft.settleError = null
        }
        draft.foregroundError = null
        draft.presentationWarnings = Array.isArray(reply.warnings) ? clone(reply.warnings) : []
        rememberCommit(draft, turn, { mode, userText, requestId, scriptReference,
          ...(placeholder ? { messageIndex: placeholder.assistantIndex, userIndex: placeholder.userIndex } : {}) }, before, now)
      }
    })
    chat = completed.chat
    if (completed.value.status !== 'committed') throw new Error('正文生成期间剧情状态已变化，本轮结果已作废')
    // 这一局只留最近一轮的候选项：没有的一轮必须把上一轮清掉，否则旧选项会被
    // 当成这一轮的选项显示出来（页面按「最近一轮」读，不靠消息 id 对齐）。
    if (input.adopt !== true) {
      const messageId = str(input.replyMessageId)
      if (extractedForegroundChoices.choices && messageId !== '') {
        chat.candidates = {
          messageId,
          choices: extractedForegroundChoices.choices,
          generatedAt: now(),
          script: undefined,
          requestId: requestId ? 'fg-choices-' + requestId : 'fg-choices-' + turn,
          operationId: operation.id,
          traceSessionId: str(input.sessionId),
          traceSessionIds: str(input.sessionId) ? [str(input.sessionId)] : [],
          traceMode: 'one-shot',
          basedOn: { branchId: chat.timeline.branchId, revision: chat.timeline.revision }
        }
      } else if (chat.candidates) delete chat.candidates
    }
    await writeChat(chat, { source: 'foreground.commit', operationId: operation.id })
    return { saved: true, mode, changed: false, chatId: chat.id, cardName: chat.cardName, reply, candidates: chat.candidates || null }
  }

  async function recordFailure(input) {
    const chat = await store.chatForSession(input.sessionId)
    if (chat === undefined) return false
    // A failed candidate is not a failure of the visible story round. Its native
    // attempt is cleaned by regenerationRecovery.abort(), without touching the
    // old body, later inputs or their variables.
    if (chat.regenInProgress === true && chat.regenRecovery?.candidateFrame?.kind === 'foreground') return false
    const turn = Math.max(0, Number(input.turn) || 0)
    // The turn's own check names its failure first; the turn end then reports the same one.
    if (chat.foregroundError && Number(chat.foregroundError.turn) === turn) return false
    chat.foregroundError = {
      turn,
      requestId: str(input.requestId).trim(),
      code: str(input.code).trim() || 'foreground-failed',
      message: str(input.message).trim() || '前台正文生成失败，请重新生成本轮正文。',
      ...(input.failure ? { failure: bodyGenerationFailure(input.failure) } : {}),
      at: now()
    }
    await store.writeChat(chat, { source: 'foreground.failure' })
    return true
  }

  async function discard(input) {
    const target = await store.chatForSession(input.sessionId)
    if (target === undefined) return false
    // No story operation or placeholder was created for a detached candidate.
    // In particular, never run the ordinary failed-turn cleanup against it.
    if (target.regenInProgress === true && target.regenRecovery?.candidateFrame?.kind === 'foreground') return false
    const turn = Math.max(0, Number(input.turn) || 0)
    let changed = false
    // Re-evaluate the operation under the same lock as its persistence. A late
    // failure signal must not overwrite a completed or rolled-back body.
    await store.updateChat(target.id, async function (chat) {
      const stages = stagedMap(chat)
      if (Object.prototype.hasOwnProperty.call(stages, String(turn))) {
        delete stages[String(turn)]
        changed = true
      }
      if ((chat.mode || 'story') === 'script' && chat.scriptState && chat.scriptState.prepared && Number(chat.scriptState.prepared.nativeTurn) === turn) {
        const script = await store.readScript(cardPathOf(chat))
        if (script !== undefined && Array.isArray(script.chunks)) {
          chat.scriptState = scripts.transition({ script, state: chat.scriptState, event: { kind: 'restore', revision: null, reference: chat.scriptState.prepared } }).state
          changed = true
        }
      }
      if (chat.promptTemplateInput?.turn === turn) {
        restoreTemplateInput(chat)
        changed = true
      }
      if ((chat.mode || 'story') === 'card' && chat.workspace && chat.workspace.prepared && Number(chat.workspace.prepared.nativeTurn) === turn) {
        chat.workspace.prepared = null
        changed = true
      }
      if ((chat.mode || 'story') === 'story' || (chat.mode || 'story') === 'script') {
        const operation = Object.values(timeline.inspect({ chat }).operations).find(function (item) {
          return item.kind === 'body' && item.status === 'running' && Number(item.turn) === turn
        })
        if (operation !== undefined) {
          const placeholder = operation.placeholder
          const failed = timeline.complete({ chat, operationId: operation.id, basedOn: operation.basedOn, outcome: { status: 'failed' } })
          chat = failed.chat
          changed = true
          if (placeholder) {
            const rows = [
              { index: placeholder.assistantIndex, role: 'assistant' },
              { index: placeholder.userIndex, role: 'user' }
            ].filter(row => validMessageIndex(row.index)).sort((a, b) => b.index - a.index)
            for (const row of rows) {
              const message = chat.messages[row.index]
              if (message?.placeholder === true && message.role === row.role
                && (row.role !== 'assistant' || Number(message.turn) === turn)) {
                if (row.role === 'user' && str(message.source?.rpcId).trim()) {
                  // Generation failure retires only its assistant. The player's
                  // durable input stays at the same index and can be prepared again.
                  chat.messages[row.index] = { ...message }
                  delete chat.messages[row.index].placeholder
                } else chat.messages.splice(row.index, 1)
              }
            }
          }
        }
      }
      return changed ? chat : undefined
    }, { source: 'foreground.discard' })
    return changed
  }

  async function visibleTools(sessionId) {
    // Every model call asks: mode, the web-search switch and the disabled tools live in the header.
    const chat = store.headerForSession ? await store.headerForSession(sessionId, ['mode', 'cardPath', 'usedModTools', 'webSearchEnabled', 'disabledForegroundTools', 'worldbookStrategy', 'backgroundTasks'])
      : await (store.stateForSession || store.chatForSession)(sessionId)
    if (chat === undefined || chat === null) return []
    const mode = chat.mode || 'story'
    const webTools = chat.webSearchEnabled === true ? ['web_search', 'web_fetch'] : []
    // Input replay names the submission tool in history, so either direction
    // requires it to be declared in this request.
    const pluginGeneration = (await options.bodyGeneration?.(sessionId))?.mode?.startsWith('plugin-')
    const outputToolCall = !pluginGeneration && (await options.storyToolCall?.()) === true
    const inputToolCall = (await options.storyInputToolCall?.()) === true
    const storyTools = storyToolCallEnabled(chat, outputToolCall || inputToolCall) ? [STORY_SUBMIT_TOOL_NAME] : []
    if (storyToolCallEnabled(chat, inputToolCall) && (await options.historyLayout?.()) === 'envelope') {
      storyTools.push(STORY_CONTEXT_TOOL_NAME)
    }
    if (pluginGeneration && ['story', 'script'].includes(mode)) storyTools.push(STORY_GENERATE_TOOL_NAME)
    // Card workbenches keep their fixed editing tools; the per-game switches are play-only.
    if (mode === 'card') return [...CARD_MEMORY_TOOLS, 'web_search', 'web_fetch', shellToolName, ...dshFileToolNames, 'skill', 'tavern_read_skill_reference', 'tavern_save_skill', ...cordisToolNames, 'tavern_user_profile_read', 'tavern_user_profile_save', 'tavern_read_card', 'tavern_read_card_raw', 'tavern_search_card', 'tavern_replace_card_text', 'tavern_mvu_overview', 'tavern_apply_mvu', 'tavern_read_play_chat', 'tavern_read_runtime_health', 'tavern_read_worldbook', 'tavern_update_worldbook', 'tavern_read_preset', 'tavern_update_preset', 'tavern_read_regex_library', 'tavern_copy_card', 'tavern_set_card_cover', 'tavern_export_card_png', 'tavern_update_card', 'tavern_restore_card', 'tavern_validate_card', 'tavern_test_response']
    // Search and browse expose current real files; native read is restricted
    // to the calling game's effective static worldbook generation.
    const worldbookTools = ['read', 'worldbook_list', 'worldbook_grep']
    // A mod's foreground tool (options.modTools: [{modId, name}]) is offered where the card has its mod on, or where
    // this game's history already calls it (a replayed call needs its tool declared).
    const modTools = []
    for (const tool of options.modTools || []) {
      if ((chat.usedModTools || []).includes(tool.name) || await options.modEnabled?.(tool.modId, chat.cardPath) === true) modTools.push(tool.name)
    }
    const names = mode === 'script'
      ? [...modTools, 'tavern_read_variables', 'skill', 'tavern_read_skill_reference', 'tavern_read_script', 'tavern_recall_history', ...worldbookTools, ...webTools, ...storyTools]
      : [...modTools, 'tavern_read_variables', 'skill', 'tavern_read_skill_reference', 'tavern_recall_history', ...worldbookTools, ...webTools, ...storyTools]
    if (mode === 'story' && chat.backgroundTasks?.styleReference === true) names.push('style_reference_submit')
    const disabled = new Set(normalizeDisabledForegroundTools(chat.disabledForegroundTools))
    if (pluginGeneration && disabled.has(STORY_GENERATE_TOOL_NAME)) throw new Error('已选择插件生成正文，但本局禁用了正文生成工具')
    return names.filter(name => !disabled.has(name))
  }

  // Asked by request hooks on every model call: the header answers it, not the history.
  async function modeFor(sessionId) {
    const chat = store.headerForSession ? await store.headerForSession(sessionId, ['mode'])
      : await (store.stateForSession || store.chatForSession)(sessionId)
    return chat === undefined || chat === null ? null : (chat.mode || 'story')
  }

  async function preview(input) {
    return await prepare({ ...(input || {}), preview: true })
  }

  return Object.freeze({ appendUser, prepare, preview, saveChanges, stageChanges, finalize, recordFailure, discard, visibleTools, modeFor })
}
