import { captureChatHeader } from './chat-persistence.js'
import { CARD_MEMORY_TOOLS } from '../../packages/dsh-tavern-card-memory/index.js'
import { inputAttachments } from './player-input-content.js'
import { resolveRuntimePresetMacros } from './runtime-presets.js'
import { composeTavernRegexScripts } from './card-extension-reading.js'
import { scriptPromptFrameInputs, consumeScriptPrompts } from './tavern-script-prompts.js'
import { projectBackgroundInput } from './runtime-content-projection.js'
import { lastTavernHelperVariables } from './tavern-helper-context.js'
import { bindSceneWorldbook } from './scene-worldbook.js'
import { normalizeResourcePath } from './file-resources.js'
import { diffJson } from './json-mutation.js'
import { hasTavernCredit, withTavernCredit } from './card-credit.js'

export const cordisToolNames = Object.freeze([
  'cordis_inspect_list',
  'cordis_inspect_query',
  'cordis_inspect_self',
  'cordis_define',
  'cordis_run',
  'cordis_stop',
  'cordis_undefine'
])

// DSH keeps the legacy editor package while the Web profile enables the newer
// file-tool suite. Treat both generations as one capability boundary.
export const dshFileToolNames = Object.freeze([
  'str_replace_editor',
  'read',
  'write',
  'edit',
  'read_image'
])

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function cardPathOf(chat) { return str(chat && (chat.cardPath || chat.cardId)) }

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

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
  guide: 'foreground.guide',
  card: 'foreground.card-context',
  'card-instruction': 'foreground.writing-rules',
  script: 'foreground.script-reference'
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

export function foregroundFrameInputs(plan, sourceText, projectedText, presetSnapshot, chat, pluginSections = []) {
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
      required: section && section.required === true,
      source: { stage: 'context-plan', sectionKind, index }
    })
  }
  for (const section of plugins.filter(item => item.position !== 'before')) inputs.push(pluginInput(section))
  if (usesOfficialMvu(chat)) {
    inputs.push({
      kind: 'foreground.writing-rules',
      text: '变量更新由正文提交后的后台 Agent 独立结算。只输出剧情正文，不要输出 <UpdateVariable>、JSON Patch 或变量更新说明。',
      required: true,
      source: { stage: 'mvu-background-owner' }
    })
  }
  return inputs.concat(presetMiddleInstructions(presetSnapshot), scriptPromptFrameInputs(chat))
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
  const shellToolName = options.shellToolName === 'pwsh' ? 'pwsh' : 'bash'

  // Story preparation reads only the floors its world book and templates use.
  const contextForSession = typeof store.storyContextForSession === 'function' ? store.storyContextForSession : store.chatForSession

  async function prepare(input) {
    let chat = await contextForSession(input.sessionId)
    if (chat === undefined) {
      return {
        ready: false,
        mode: 'unbound',
        cardName: '',
        text: '【酒馆状态】\n尚未选择人物卡。请简短提示用户先在界面中选择人物卡。'
      }
    }
    let preparationBase = store.writeChatHeader ? captureChatHeader(chat) : null
    async function savePreparation(metadata) {
      if (store.writeChatHeader) preparationBase = await store.writeChatHeader(chat,preparationBase,metadata)
      else await store.writeChat(chat,metadata)
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
      const cachedFrame = rememberedFrame(chat, foregroundOperation.operationId)
      if (cachedFrame !== null) {
        if (chatChanged) await savePreparation({ source: 'foreground.prepare' })
        return {
          ready: true,
          mode,
          cardName: str(chat.cardName),
          userText: cachedFrame.userInput.projectedText,
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
      const extensions = typeof store.readCardExtensions === 'function'
        ? await store.readCardExtensions(cardPath, chat)
        : null
      const presetRegexScripts = await resolvePresetRegexScripts(chat)
      const regexScripts = composeTavernRegexScripts(extensions, presetRegexScripts)
      // As in SillyTavern, only permanent input rules change the stored player
      // message; prompt-only rules (e.g. a preset wrapping the input in tags)
      // reach the model and never the bubble, copy or saved history.
      const promptOnly = regexScripts.filter(script => script?.promptOnly === true)
      runtimeUserText = projectBackgroundInput(runtimeUserText, regexScripts.filter(script => script?.promptOnly !== true), 1).text
      if (typeof options.projectUserTemplate === 'function' && runtimeUserText !== '') {
        const projected = await options.projectUserTemplate({chat,card,turn,text:runtimeUserText})
        runtimeUserText = projected.message.text
        chat.promptTemplateInput = {turn,source:userText,message:projected.message}
        chat.variables = projected.scopes.local
        chat.promptTemplateInitialVariables = projected.scopes.initial
      }
      const prompted = projectBackgroundInput(runtimeUserText, promptOnly, 1)
      if (prompted.changed) {
        // A replacement may carry macros; SillyTavern substitutes them in the prompt.
        runtimeUserText = renderMacros !== null && prompted.text.includes('{{') ? renderMacros(prompted.text, chat) : prompted.text
      }
      rememberRuntimeInput(chat, turn, userText, runtimeUserText)
      chatChanged = true
      if (chat.promptTemplateInput?.turn === turn) await savePreparation({source:'prompt-template.input'})
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
      ? await options.projectForegroundWorldbook({ chat, card, turn, userText: runtimeUserText }) : null
    if (typeof options.projectForegroundWorldbook === 'function') {
      chat = await contextForSession(input.sessionId)
      if (chat && store.writeChatHeader) preparationBase = captureChatHeader(chat)
      const current = chat && timeline.inspect({ chat })
      if (!current || current.branchId !== foregroundOperation.basedOn.branchId || current.revision !== foregroundOperation.basedOn.revision ||
          current.operations[foregroundOperation.operationId]?.status !== 'running') throw new Error('剧情已变化，本次正文准备已过期')
    }
    const templateWorldBook = foregroundWorldBook || await projectWorldBookTemplates({ chat, card, turn, userText: runtimeUserText })
    const scriptWorldBook = !foregroundWorldBook && typeof options.projectScriptPromptWorldbook === 'function' ? await options.projectScriptPromptWorldbook({ chat, card, turn }) : null
    const worldBookContext = foregroundWorldBook ? str(foregroundWorldBook.context) : [str(chat.preparedWorldBookContext).trim(), str(scriptWorldBook && scriptWorldBook.context).trim(), templateWorldBook?.dynamicConstants ? '' : str(templateWorldBook && templateWorldBook.context).trim()].filter(Boolean).join('\n\n')
    if (foregroundWorldBook) {
      if (foregroundWorldBook.randomState) chat.worldBookRandomState = foregroundWorldBook.randomState
      if (foregroundWorldBook.reads) chat.worldBookReads = foregroundWorldBook.reads
      chat.preparedWorldBookContext = worldBookContext
      chat.preparedWorldBook = { ...foregroundWorldBook.activation, branchId: foregroundOperation.basedOn.branchId, revision: foregroundOperation.basedOn.revision }
      chat.lastWorldBookRecall = clone(chat.preparedWorldBook)
      chat.worldBookError = foregroundWorldBook.error
    }
    const sceneWorldbook = typeof options.captureSceneWorldbook === 'function' ? await options.captureSceneWorldbook(chat, card) : null
    const plan = await planner.plan({ purpose: 'body', card, chat: templateWorldBook?.macroState ? { ...chat, macroState: templateWorldBook.macroState } : chat, userText: runtimeUserText, sessionId: input.sessionId, nativeTurn: turn, scriptReference, worldBookContext })
    // Seam to the plugin layer; it never throws and drops a failing plugin's part.
    const pluginSections = typeof options.pluginTurnContext === 'function'
      ? await options.pluginTurnContext({ gameId: input.sessionId, turn, input: userText }).catch(() => []) : []
    const source = frameSource(chat, card, foregroundOperation)
    source.card.systemPromptText = plan.systemPromptText
    source.worldBook.scriptPromptRefs = Array.isArray(scriptWorldBook && scriptWorldBook.refs) ? clone(scriptWorldBook.refs) : []
    if (scriptWorldBook && typeof scriptWorldBook.recordReads === 'function') chat.worldBookReads = scriptWorldBook.recordReads(chat.worldBookReads)
    source.worldBook.templateRefs = Array.isArray(templateWorldBook && templateWorldBook.refs) ? clone(templateWorldBook.refs) : []
    source.worldBook.templateDiagnostics = Array.isArray(templateWorldBook && templateWorldBook.diagnostics) ? clone(templateWorldBook.diagnostics) : []
    const frameInput = {
      chatId: chat.id,
      branchId: foregroundOperation.basedOn.branchId,
      basedOnRevision: foregroundOperation.basedOn.revision,
      operationId: foregroundOperation.operationId,
      turn,
      inputs: foregroundFrameInputs(plan, userText, runtimeUserText,
        Object.hasOwn(input, 'runtimePresetSnapshot') ? input.runtimePresetSnapshot
          : resolveRuntimePresetMacros(chat.runtimePresetSnapshot, { charName: card.name, macroState: chat.macroState }).snapshot, chat, pluginSections),
      source: { ...source, ...(sceneWorldbook ? { sceneWorldbook } : {}) }
    }
    let frame = frameBuilder.build(frameInput)
    if (foregroundWorldBook?.log && typeof options.recordWorldbookRecall === 'function') {
      let receipt
      try { receipt = { recallLog: await options.recordWorldbookRecall({ chat, frame, log: foregroundWorldBook.log }) } }
      catch (error) { receipt = { recallLogError: String(error?.message || error) } }
      frame = frameBuilder.build({ ...frameInput, source: { ...source, worldBook: { ...source.worldBook, ...receipt } } })
    }
    consumeScriptPrompts(chat)
    rememberFrame(chat, frame)
    chatChanged = true
    if (chatChanged) await savePreparation({ source: 'foreground.prepare' })
    return { ready: true, mode, cardName: card.name, userText: runtimeUserText, frame }
  }

  async function beginCompatibility(input) {
    let chat = await store.chatForSession(input.sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    const mode = chat.mode || 'story'
    if (mode !== 'story' && mode !== 'script') throw new Error('酒馆兼容模式只适用于游玩对话')
    const turn = Math.max(0, Number(input.turn) || 0)
    const requestId = str(input.requestId).trim()
    const userText = str(input.userText).trim()
    const requestCommit = commitForRequest(chat, requestId)
    if (requestCommit !== null) {
      return {
        ready: false,
        duplicate: true,
        committedTurn: Math.max(0, Number(requestCommit.turn) || 0),
        mode
      }
    }
    const begun = timeline.apply({ chat, intent: { kind: 'body.begin', turn, userText } })
    chat = begun.chat
    const operation = chat.timeline.operations[begun.value.operationId]
    if (operation && !Object.hasOwn(operation, 'sceneWorldbook') && typeof options.captureSceneWorldbook === 'function') {
      operation.sceneWorldbook = await options.captureSceneWorldbook(chat, await store.readCard(cardPathOf(chat), chat))
    }
    chat.foregroundError = null
    let projectedText = runtimeInputFor(chat, turn, userText)
    if (projectedText === null) {
      projectedText = userText
      if (typeof options.projectUserTemplate === 'function' && userText !== '') {
        const projected = await options.projectUserTemplate({chat,card:await store.readCard(cardPathOf(chat), chat),turn,text:userText})
        projectedText = projected.message.text
        chat.promptTemplateInput = {turn,source:userText,message:projected.message}
        chat.variables = projected.scopes.local
        chat.promptTemplateInitialVariables = projected.scopes.initial
      }
      rememberRuntimeInput(chat, turn, userText, projectedText)
    }
    await store.writeChat(chat)
    return { ready: true, mode, userText: projectedText }
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
      const history = {
        async previousVariables() {
          for (let end = count, size = 8; end > 0; end -= size, size = Math.min(size * 8, 512)) {
            const start = Math.max(0, end - size)
            const rows = await store.readChatSlice(input.sessionId, Array.from({ length: end - start }, (_, i) => start + i), ['_storageRevision'])
            if (!rows?.denseMessages || rows.chat._storageRevision !== revision) { stale = true; return undefined }
            const found = lastTavernHelperVariables(rows.chat.messages)
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
      if (messages.length) changes.push({ op: 'splice', path: ['messages'], index: count, deleteCount: 0, items: messages })
      if (await store.patchChat(before.id, revision, changes, metadata)) return result
    }
    return null
  }

  async function finalizeSnapshot(input, chat, writeChat, expectedTimeline, history) {
    const turn = Math.max(0, Number(input.turn) || 0)
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
    if (expectedTimeline && (chat.timeline?.branchId !== expectedTimeline.branchId || chat.timeline?.revision !== expectedTimeline.revision)) {
      throw new Error('正文生成期间剧情状态已变化，本轮结果已作废')
    }
    const userText = str(input.userText).trim()
    const attachments = inputAttachments(input.userContent)
    const mode = chat.mode || 'story'
    const sourceText = str(input.assistantText).trim()
    let assistantText = sourceText
    let previousMvuVariables
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
      if (renderMacros !== null && assistantText.includes('{{')) assistantText = renderMacros(assistantText, chat)
      previousMvuVariables = chat.promptTemplateInput?.turn === turn ? lastTavernHelperVariables([chat.promptTemplateInput.message])
        : history ? await history.previousVariables() : lastTavernHelperVariables(chat.messages)
      const extensions = typeof store.readCardExtensions === 'function'
        ? await store.readCardExtensions(cardPathOf(chat), chat)
        : null
      const presetRegexScripts = await resolvePresetRegexScripts(chat)
      const projectionText = assistantText
      reply = projectReply(sourceText, {
        projectionText,
        regexScripts: composeTavernRegexScripts(extensions, presetRegexScripts),
        placement: 2,
        isEdit: false,
        depth: 0
      })
      assistantText = str(reply.sessionText).trim()
    }
    if (assistantText === '') throw new Error('本轮最终回复为空，无法保存酒馆状态')
    const stage = takeStage(chat, turn)

    const cardPath = cardPathOf(chat)
    if (mode === 'card' && cardPath === '') {
      const state = object(chat.workspace)
      let changed = false
      const hasCardChanges = Object.keys(object(stage.fields)).length > 0
      if (hasCardChanges) {
        const draftChange = cards.update({ kind: 'draft', card: object(state.draft), player: state.player, patch: stage.fields })
        state.draft = draftChange.card
        state.player = draftChange.player
        chat.workspace = state
        changed = draftChange.changed
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
      let changed = false
      let savedCard = { name: chat.cardName }
      if (Object.keys(object(stage.fields)).length > 0 || (Array.isArray(stage.rawOperations) && stage.rawOperations.length > 0)) {
        const result = await store.updateCard(cardPath, object(stage.fields), {
          ts: now(), instruction: userText, summary: '通过卡片模式设定对话更新人物卡'
        }, Array.isArray(stage.rawOperations) ? stage.rawOperations : [])
        changed = result.changed
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

    const operation = Object.values(timeline.inspect({ chat }).operations).find(function (item) {
      return item.kind === 'body' && item.status === 'running' && Number(item.turn) === turn
    })
    if (operation === undefined) throw new Error('找不到本轮正文 operation，请重新生成本轮正文')
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
          const userMessage = { role: 'user', text: userText, ts: now(), native: true, ...(attachments.length ? { inputAttachments: attachments } : {}) }
          if (previousMvuVariables !== undefined) Object.assign(userMessage, { swipeId: 0, swipes: [userText], variables: [clone(previousMvuVariables)] })
          if (draft.promptTemplateInput?.turn === turn) Object.assign(userMessage, clone(draft.promptTemplateInput.message), {templateInputSource:userText})
          draft.messages.push(userMessage)
        }
        delete draft.promptTemplateInput
        const assistantMessage = {
          role: 'assistant',
          text: assistantText,
          sourceText: str(reply.sourceText),
          projectionText: str(reply.projectionText),
          displayText: str(reply.displayText),
          displayMode: 'html',
          projectionVersion: 2,
          projectionWarnings: Array.isArray(reply.warnings) ? clone(reply.warnings) : [],
          ts: now(),
          native: true,
          turn: turn
        }
        if (usesOfficialMvu(draft)) Object.assign(assistantMessage, {
          swipeId: 0,
          swipes: [str(reply.projectionText)],
          variables: [clone(previousMvuVariables || {})],
          mvu: { pending: true, modified: false, diagnostics: [], events: [] }
        })
        bindSceneWorldbook(assistantMessage, rememberedFrame(chat, operation.id)?.source?.sceneWorldbook || operation.sceneWorldbook)
        draft.messages.push(assistantMessage)
        draft.settleStatus = 'pending'
        draft.settleError = null
        draft.foregroundError = null
        draft.presentationWarnings = Array.isArray(reply.warnings) ? clone(reply.warnings) : []
        rememberCommit(draft, turn, { mode, userText, requestId, scriptReference }, before, now)
      }
    })
    chat = completed.chat
    if (completed.value.status !== 'committed') throw new Error('正文生成期间剧情状态已变化，本轮结果已作废')
    await writeChat(chat, { source: 'foreground.commit', operationId: operation.id })
    return { saved: true, mode, changed: false, chatId: chat.id, cardName: chat.cardName, reply }
  }

  async function recordFailure(input) {
    const chat = await store.chatForSession(input.sessionId)
    if (chat === undefined) return false
    chat.foregroundError = {
      turn: Math.max(0, Number(input.turn) || 0),
      requestId: str(input.requestId).trim(),
      code: str(input.code).trim() || 'foreground-failed',
      message: str(input.message).trim() || '前台正文生成失败，请重新生成本轮正文。',
      at: now()
    }
    await store.writeChat(chat, { source: 'foreground.failure' })
    return true
  }

  async function discard(input) {
    const target = await store.chatForSession(input.sessionId)
    if (target === undefined) return false
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
      if ((chat.mode || 'story') === 'card' && chat.workspace && chat.workspace.prepared && Number(chat.workspace.prepared.nativeTurn) === turn) {
        chat.workspace.prepared = null
        changed = true
      }
      if ((chat.mode || 'story') === 'story' || (chat.mode || 'story') === 'script') {
        const operation = Object.values(timeline.inspect({ chat }).operations).find(function (item) {
          return item.kind === 'body' && item.status === 'running' && Number(item.turn) === turn
        })
        if (operation !== undefined) {
          const failed = timeline.complete({ chat, operationId: operation.id, basedOn: operation.basedOn, outcome: { status: 'failed' } })
          chat = failed.chat
          changed = true
        }
      }
      return changed ? chat : undefined
    }, { source: 'foreground.discard' })
    return changed
  }

  async function visibleTools(sessionId) {
    const chat = await (store.stateForSession || store.chatForSession)(sessionId)
    if (chat === undefined) return []
    const mode = chat.mode || 'story'
    const webTools = chat.webSearchEnabled === true ? ['web_search'] : []
    if (mode === 'script') return ['tavern_read_variables', 'skill', 'tavern_read_skill_reference', 'tavern_read_script', 'tavern_recall_history', 'worldbook_search', ...webTools]
    if (mode === 'card') return [...CARD_MEMORY_TOOLS, 'web_search', shellToolName, ...dshFileToolNames, 'skill', 'tavern_read_skill_reference', 'tavern_save_skill', ...cordisToolNames, 'tavern_user_profile_read', 'tavern_user_profile_save', 'tavern_read_card', 'tavern_read_card_raw', 'tavern_read_play_chat', 'tavern_read_worldbook', 'tavern_update_worldbook', 'tavern_read_preset', 'tavern_update_preset', 'tavern_read_regex_library', 'tavern_copy_card', 'tavern_update_card', 'tavern_restore_card', 'tavern_validate_card', 'tavern_test_response']
    return ['tavern_read_variables', 'skill', 'tavern_read_skill_reference', 'tavern_recall_history', 'worldbook_search', ...webTools]
  }

  async function modeFor(sessionId) {
    const chat = await (store.stateForSession || store.chatForSession)(sessionId)
    return chat === undefined ? null : (chat.mode || 'story')
  }

  return Object.freeze({ prepare, beginCompatibility, saveChanges, stageChanges, finalize, recordFailure, discard, visibleTools, modeFor })
}
