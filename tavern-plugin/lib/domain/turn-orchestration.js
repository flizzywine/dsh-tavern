import { rememberTavernResources } from './workspace-resources.js'
import { projectBackgroundInput } from './runtime-content-projection.js'
import { lastTavernHelperVariables } from './tavern-helper-context.js'
import { bindSceneWorldbook } from './scene-worldbook.js'

export const cordisToolNames = Object.freeze([
  'cordis_inspect_list',
  'cordis_inspect_query',
  'cordis_inspect_self',
  'cordis_define',
  'cordis_run',
  'cordis_stop',
  'cordis_undefine'
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

function foregroundFrameInputs(plan, sourceText, projectedText, presetSnapshot, chat) {
  const inputs = [{
    kind: 'foreground.user-input',
    sourceText,
    projectedText,
    source: { stage: 'player-input' }
  }]
  const sections = Array.isArray(plan && plan.sections) && plan.sections.length > 0
    ? plan.sections
    : [{ kind: 'legacy-plan-text', required: true, text: str(plan && plan.text) }]
  for (const [index, section] of sections.entries()) {
    const sectionKind = str(section && section.kind)
    inputs.push({
      kind: FRAME_INSTRUCTION_KIND[sectionKind] || (sectionKind === 'legacy-plan-text' ? 'foreground.writing-rules' : 'foreground.unsupported'),
      text: str(section && section.text),
      required: section && section.required === true,
      source: { stage: 'context-plan', sectionKind, index }
    })
  }
  if (usesOfficialMvu(chat)) {
    inputs.push({
      kind: 'foreground.writing-rules',
      text: '变量更新由正文提交后的后台 Agent 独立结算。只输出剧情正文，不要输出 <UpdateVariable>、JSON Patch 或变量更新说明。',
      required: true,
      source: { stage: 'mvu-background-owner' }
    })
  }
  return inputs.concat(presetMiddleInstructions(presetSnapshot))
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
      refs: Array.isArray(worldBook.refs) ? clone(worldBook.refs) : []
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
  const shellToolName = options.shellToolName === 'pwsh' ? 'pwsh' : 'bash'

  async function prepare(input) {
    let chat = await store.chatForSession(input.sessionId)
    if (chat === undefined) {
      return {
        ready: false,
        mode: 'unbound',
        cardName: '',
        text: '【酒馆状态】\n尚未选择人物卡。请简短提示用户先在界面中选择人物卡。'
      }
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
      const begun = timeline.apply({ chat, intent: { kind: 'body.begin', turn, userText } })
      chat = begun.chat
      foregroundOperation = begun.value
      const cachedFrame = rememberedFrame(chat, foregroundOperation.operationId)
      if (cachedFrame !== null) {
        if (chatChanged) await store.writeChat(chat, { source: 'foreground.prepare' })
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
    const card = cardPath === '' ? null : await store.readCard(cardPath)
    if (cardPath !== '' && card === undefined) throw new Error('人物卡不存在: ' + cardPath)
    if ((mode === 'story' || mode === 'script') && !reusedRuntimeInput) {
      const extensions = typeof store.readCardExtensions === 'function'
        ? await store.readCardExtensions(cardPath)
        : null
      const presetRegexScripts = await resolvePresetRegexScripts(chat)
      const regexScripts = (Array.isArray(extensions && extensions.regexScripts) ? extensions.regexScripts : []).concat(presetRegexScripts)
      runtimeUserText = projectBackgroundInput(runtimeUserText, regexScripts, 1).text
      rememberRuntimeInput(chat, turn, userText, runtimeUserText)
      chatChanged = true
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
      const state = object(chat.workspace)
      state.mountedResources = rememberTavernResources(state.mountedResources, userText)
      chat.workspace = state
      const prepared = (Array.isArray(state.sourcePaths) ? state.sourcePaths : state.sourceIds || []).length > 0 ? await workspace.prepare(chat, turn) : null
      const plan = await planner.plan({ purpose: 'card', sourcePrepared: prepared })
      await store.writeChat(chat, { source: 'card.prepare' })
      return { ready: true, mode, cardName: card === null ? (str(state.draft && state.draft.name) || '卡片工作台') : card.name, text: plan.text }
    }

    // 世界书关键词匹配在上一轮正文提交后本地完成。正文准备只读取已经
    // 保存好的下一轮上下文，玩家输入和候选项选择都不能在此重新触发匹配。
    const worldBookContext = str(chat.preparedWorldBookContext).trim()
    const sceneWorldbook = typeof options.captureSceneWorldbook === 'function' ? await options.captureSceneWorldbook(chat, card) : null
    const plan = await planner.plan({ purpose: 'body', card, chat, userText: runtimeUserText, sessionId: input.sessionId, nativeTurn: turn, scriptReference, worldBookContext })
    const frame = frameBuilder.build({
      chatId: chat.id,
      branchId: foregroundOperation.basedOn.branchId,
      basedOnRevision: foregroundOperation.basedOn.revision,
      operationId: foregroundOperation.operationId,
      turn,
      inputs: foregroundFrameInputs(plan, userText, runtimeUserText, chat.runtimePresetSnapshot, chat),
      source: { ...frameSource(chat, card, foregroundOperation), ...(sceneWorldbook ? { sceneWorldbook } : {}) }
    })
    rememberFrame(chat, frame)
    chatChanged = true
    if (chatChanged) await store.writeChat(chat, { source: 'foreground.prepare' })
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
      operation.sceneWorldbook = await options.captureSceneWorldbook(chat, await store.readCard(cardPathOf(chat)))
    }
    chat.foregroundError = null
    rememberRuntimeInput(chat, turn, userText, userText)
    await store.writeChat(chat)
    return { ready: true, mode, userText }
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
      const card = await store.readCard(cardPath)
      if (card === undefined) throw new Error('人物卡不存在: ' + cardPath)
      preview = cards.update({ kind: 'card', card, patch: combined.fields, rawOperations: combined.rawOperations })
    }

    stages[String(turn)] = combined
    await store.writeChat(chat, { source: 'card.stage' })
    return { staged: true, mode, changed: preview.changed, createsCard: cardPath === '', changedFields: preview.changedFields }
  }

  async function finalize(input) {
    let chat = await store.chatForSession(input.sessionId)
    if (chat === undefined) return { saved: false, reason: 'unbound' }
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
    const userText = str(input.userText).trim()
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
      previousMvuVariables = lastTavernHelperVariables(chat.messages)
      const extensions = typeof store.readCardExtensions === 'function'
        ? await store.readCardExtensions(cardPathOf(chat))
        : null
      const presetRegexScripts = await resolvePresetRegexScripts(chat)
      const projectionText = assistantText
      reply = projectReply(sourceText, {
        projectionText,
        regexScripts: (Array.isArray(extensions && extensions.regexScripts) ? extensions.regexScripts : []).concat(presetRegexScripts),
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
      await store.writeChat(chat, { source: 'card.commit' })
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
      let savedCard = await store.readCard(cardPath)
      if (savedCard === undefined) throw new Error('人物卡不存在: ' + cardPath)
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
      await store.writeChat(chat, { source: 'card.commit' })
      return { saved: true, mode, changed, chatId: chat.id, cardName: savedCard.name }
    }

    const operation = Object.values(timeline.inspect({ chat }).operations).find(function (item) {
      return item.kind === 'body' && item.status === 'running' && Number(item.turn) === turn
    })
    if (operation === undefined) throw new Error('找不到本轮正文 operation，请重新生成本轮正文')
    const before = {
      posture: chat.posture || '',
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
        if (userText !== '') {
          const userMessage = { role: 'user', text: userText, ts: now(), native: true }
          if (previousMvuVariables !== undefined) Object.assign(userMessage, { swipeId: 0, swipes: [userText], variables: [clone(previousMvuVariables)] })
          draft.messages.push(userMessage)
        }
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
        draft.foregroundError = null
        draft.presentationWarnings = Array.isArray(reply.warnings) ? clone(reply.warnings) : []
        rememberCommit(draft, turn, { mode, userText, requestId, scriptReference }, before, now)
      }
    })
    chat = completed.chat
    if (completed.value.status !== 'committed') throw new Error('正文生成期间剧情状态已变化，本轮结果已作废')
    await store.writeChat(chat, { source: 'foreground.commit', operationId: operation.id })
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
    let chat = await store.chatForSession(input.sessionId)
    if (chat === undefined) return false
    const turn = Math.max(0, Number(input.turn) || 0)
    let changed = false
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
    if (changed) await store.writeChat(chat, { source: 'foreground.discard' })
    return changed
  }

  async function visibleTools(sessionId) {
    const chat = await store.chatForSession(sessionId)
    if (chat === undefined) return []
    const mode = chat.mode || 'story'
    if (mode === 'script') return ['tavern_read_script']
    if (mode === 'card') return [shellToolName, 'str_replace_editor', 'skill', 'tavern_save_skill', ...cordisToolNames, 'tavern_user_profile_read', 'tavern_user_profile_save_draft', 'tavern_user_profile_confirm', 'tavern_read_card', 'tavern_read_card_raw', 'tavern_read_play_chat', 'tavern_read_worldbook', 'tavern_update_worldbook', 'tavern_read_preset', 'tavern_update_preset', 'tavern_update_card', 'tavern_restore_card']
    return []
  }

  async function modeFor(sessionId) {
    const chat = await store.chatForSession(sessionId)
    return chat === undefined ? null : (chat.mode || 'story')
  }

  return Object.freeze({ prepare, beginCompatibility, stageChanges, finalize, recordFailure, discard, visibleTools, modeFor })
}
