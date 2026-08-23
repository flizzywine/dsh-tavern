import { rememberTavernResources } from './workspace-resources.js'

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

function commitFor(chat, turn) {
  if (!turn || chat.nativeCommits === null || typeof chat.nativeCommits !== 'object') return null
  const value = chat.nativeCommits[String(turn)]
  return value !== null && typeof value === 'object' ? value : null
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

function mergeStage(previous, fields, worldBook, rawOperations) {
  return {
    fields: Object.assign({}, object(previous.fields), clone(object(fields))),
    worldBook: (Array.isArray(previous.worldBook) ? clone(previous.worldBook) : []).concat(Array.isArray(worldBook) ? clone(worldBook) : []),
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
    const userText = str(input.userText).trim()
    let runtimeUserText = userText
    const mode = chat.mode || 'story'
    let chatChanged = clearStaleStages(chat, turn)

    if (mode === 'story' || mode === 'script') {
      const begun = timeline.apply({ chat, intent: { kind: 'body.begin', turn, userText } })
      chat = begun.chat
      chatChanged = true
      const cachedRuntimeInput = runtimeInputFor(chat, turn, userText)
      if (cachedRuntimeInput !== null) {
        runtimeUserText = cachedRuntimeInput
      } else {
        if (renderMacros !== null && userText.includes('{{')) runtimeUserText = renderMacros(userText, chat)
        rememberRuntimeInput(chat, turn, userText, runtimeUserText)
        chatChanged = true
      }
    }

    const cardPath = cardPathOf(chat)
    const card = cardPath === '' ? null : await store.readCard(cardPath)
    if (cardPath !== '' && card === undefined) throw new Error('人物卡不存在: ' + cardPath)
    let scriptReference = null
    let scriptInfo = null
    let worldBookOverview = null

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
      if (card !== null) {
        const script = await store.readScript(cardPathOf(chat))
        scriptInfo = scripts.inspect({ script, state: chat.scriptState, request: { kind: 'info' } })
        worldBookOverview = cards.present({ card, as: 'world-book-overview' })
      }
      const plan = await planner.plan({ purpose: 'card', card, workspace: state, sourcePrepared: prepared, scriptInfo, worldBookOverview })
      await store.writeChat(chat)
      return { ready: true, mode, cardName: card === null ? (str(state.draft && state.draft.name) || '卡片工作台') : card.name, text: plan.text }
    }

    // 世界书召回属于上一轮正文后的后台结算。正文准备只读取已经
    // 保存好的下一轮上下文，玩家输入和候选项选择都不能在此触发召回。
    const worldBookContext = str(chat.preparedWorldBookContext).trim()
    const plan = await planner.plan({ purpose: 'body', card, chat, userText: runtimeUserText, sessionId: input.sessionId, nativeTurn: turn, scriptReference, worldBookContext })
    if (chatChanged) await store.writeChat(chat)
    return { ready: true, mode, cardName: card.name, text: plan.text, userText: runtimeUserText }
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
    const combined = mergeStage(object(stages[String(turn)]), input.fields, input.worldBook, input.rawOperations)
    if (Object.keys(combined.fields).length === 0 && combined.worldBook.length === 0 && combined.rawOperations.length === 0) throw new Error('没有提供需要修改的字段')

    let preview
    const cardPath = cardPathOf(chat)
    if (cardPath === '') {
      if (combined.worldBook.length > 0 || combined.rawOperations.length > 0) throw new Error('新人物卡创建前不能修改世界书或 raw，请先创建人物卡')
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
      preview = cards.update({ kind: 'card', card, patch: combined.fields, worldBookOperations: combined.worldBook, rawOperations: combined.rawOperations })
    }

    stages[String(turn)] = combined
    await store.writeChat(chat)
    return { staged: true, mode, changed: preview.changed, createsCard: cardPath === '', changedFields: preview.changedFields }
  }

  async function finalize(input) {
    let chat = await store.chatForSession(input.sessionId)
    if (chat === undefined) return { saved: false, reason: 'unbound' }
    const turn = Math.max(0, Number(input.turn) || 0)
    const prior = commitFor(chat, turn)
    if (prior !== null) return { saved: true, duplicate: true, mode: chat.mode || 'story', changed: prior.changed === true }
    const userText = str(input.userText).trim()
    const mode = chat.mode || 'story'
    let assistantText = str(input.assistantText).trim()
    let reply = { bodyText: assistantText, presentationHtml: '', warnings: [] }
    if (mode === 'story' || mode === 'script') {
      if (renderMacros !== null && assistantText.includes('{{')) assistantText = renderMacros(assistantText, chat)
      const extensions = typeof store.readCardExtensions === 'function'
        ? await store.readCardExtensions(cardPathOf(chat))
        : null
      const presetRegexScripts = await resolvePresetRegexScripts(chat)
      reply = projectReply(assistantText, {
        regexScripts: (Array.isArray(extensions && extensions.regexScripts) ? extensions.regexScripts : []).concat(presetRegexScripts),
        placement: 2,
        isMarkdown: true,
        isEdit: false,
        depth: 0
      })
      assistantText = str(reply.bodyText).trim()
    }
    if (assistantText === '' && str(reply.presentationHtml) !== '') assistantText = '\u00a0'
    if (assistantText === '') throw new Error('本轮最终回复为空，无法保存酒馆状态')
    const presentation = str(reply.presentationHtml) === '' ? {} : { html: reply.presentationHtml, warnings: reply.warnings }
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
      chat.cardName = created === null ? (str(state.draft && state.draft.name) || '卡片工作台') : created.card.name
      rememberCommit(chat, turn, { mode, userText, changed }, null, now)
      await store.writeChat(chat)
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
      if (Object.keys(object(stage.fields)).length > 0 || (Array.isArray(stage.worldBook) && stage.worldBook.length > 0) || (Array.isArray(stage.rawOperations) && stage.rawOperations.length > 0)) {
        const result = await store.updateCard(cardPath, object(stage.fields), {
          ts: now(), instruction: userText, summary: '通过卡片模式设定对话更新人物卡'
        }, Array.isArray(stage.worldBook) ? stage.worldBook : [], Array.isArray(stage.rawOperations) ? stage.rawOperations : [])
        changed = result.changed
        savedCard = result.card
      }
      workspace.commit(chat, turn)
      if (userText !== '') chat.messages.push({ role: 'user', text: userText, ts: now(), native: true })
      chat.messages.push({ role: 'assistant', text: assistantText, ts: now(), native: true, changed })
      chat.cardName = savedCard.name
      rememberCommit(chat, turn, { mode, userText, changed }, null, now)
      await store.writeChat(chat)
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
        if (userText !== '') draft.messages.push({ role: 'user', text: userText, ts: now(), native: true })
        const assistantMessage = { role: 'assistant', text: assistantText, ts: now(), native: true, turn: turn }
        if (str(reply.sourceText) !== assistantText) assistantMessage.sourceText = str(reply.sourceText)
        draft.messages.push(assistantMessage)
        if (str(presentation.html) !== '') {
          draft.presentation = {
            html: str(presentation.html), source: 'reply', turn,
            warnings: Array.isArray(presentation.warnings) ? clone(presentation.warnings) : [],
            updatedAt: now()
          }
        }
        draft.presentationWarnings = Array.isArray(reply.warnings) ? clone(reply.warnings) : []
        draft.settleStatus = 'running'
        draft.settleError = null
        rememberCommit(draft, turn, { mode, userText, scriptReference }, before, now)
      }
    })
    chat = completed.chat
    if (completed.value.status !== 'committed') throw new Error('正文生成期间剧情状态已变化，本轮结果已作废')
    await store.writeChat(chat)
    return { saved: true, mode, changed: false, chatId: chat.id, cardName: chat.cardName, reply }
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
    if (changed) await store.writeChat(chat)
    return changed
  }

  async function visibleTools(sessionId) {
    const chat = await store.chatForSession(sessionId)
    if (chat === undefined) return []
    const mode = chat.mode || 'story'
    if (mode === 'script') return ['tavern_read_script']
    if (mode === 'card') return [shellToolName, 'str_replace_editor', 'skill', 'tavern_save_skill', 'tavern_read_card', 'tavern_read_card_raw', 'tavern_read_worldbook', 'tavern_update_card', 'tavern_restore_card']
    return []
  }

  async function modeFor(sessionId) {
    const chat = await store.chatForSession(sessionId)
    return chat === undefined ? null : (chat.mode || 'story')
  }

  return Object.freeze({ prepare, stageChanges, finalize, discard, visibleTools, modeFor })
}
