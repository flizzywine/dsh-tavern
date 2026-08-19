function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

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

function mergeStage(previous, fields, worldBook) {
  return {
    fields: Object.assign({}, object(previous.fields), clone(object(fields))),
    worldBook: (Array.isArray(previous.worldBook) ? clone(previous.worldBook) : []).concat(Array.isArray(worldBook) ? clone(worldBook) : [])
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
  const extract = options.extract
  const timeline = options.timeline
  const now = typeof options.now === 'function' ? options.now : Date.now
  const queueSettlement = typeof options.queueSettlement === 'function' ? options.queueSettlement : function () {}

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
    const mode = chat.mode || 'story'
    let chatChanged = clearStaleStages(chat, turn)

    if (mode === 'story' || mode === 'script') {
      const begun = timeline.apply({ chat, intent: { kind: 'body.begin', turn, userText } })
      chat = begun.chat
      chatChanged = true
    }

    if (mode === 'extract') {
      const prepared = await extract.prepare(chat, turn)
      const plan = await planner.plan({ purpose: 'extract', chat, extractPrepared: prepared })
      await store.writeChat(chat)
      return {
        ready: true,
        mode,
        cardName: (chat.extract && chat.extract.draft ? str(chat.extract.draft.name) : '') || '未命名角色',
        text: plan.text
      }
    }

    const card = await store.readCard(chat.cardId)
    if (card === undefined) throw new Error('角色卡不存在: ' + chat.cardId)
    let scriptReference = null
    let scriptInfo = null
    let worldBookOverview = null

    if (mode === 'script') {
      const script = await store.readScript(chat.cardId)
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
        const prepared = scripts.transition({ script, state: chat.scriptState, event: { kind: 'prepare', userText, nativeTurn: turn } })
        chat.scriptState = prepared.state
        scriptReference = prepared.reference
        chatChanged = chatChanged || prepared.changed
      }
    }

    if (mode === 'revision') {
      const script = await store.readScript(chat.cardId)
      scriptInfo = scripts.inspect({ script, state: chat.scriptState, request: { kind: 'info' } })
      worldBookOverview = cards.present({ card, as: 'world-book-overview' })
    }

    const plan = mode === 'revision'
      ? await planner.plan({ purpose: 'revision', card, scriptInfo, worldBookOverview })
      : await planner.plan({ purpose: 'body', card, chat, userText, sessionId: input.sessionId, nativeTurn: turn, scriptReference })
    if (chatChanged) await store.writeChat(chat)
    return { ready: true, mode, cardName: card.name, text: plan.text }
  }

  async function stageChanges(input) {
    const chat = await store.chatForSession(input.sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    const mode = chat.mode || 'story'
    if (mode !== 'revision' && mode !== 'extract') throw new Error('人物卡只能在卡片模式中修改')
    const turn = Math.max(0, Number(input.turn) || 0)
    if (!turn) throw new Error('无法确定当前回合')
    clearStaleStages(chat, turn)
    const stages = stagedMap(chat)
    const combined = mergeStage(object(stages[String(turn)]), input.fields, input.worldBook)
    if (Object.keys(combined.fields).length === 0 && combined.worldBook.length === 0) throw new Error('没有提供需要修改的字段')

    let preview
    if (mode === 'extract') {
      if (combined.worldBook.length > 0) throw new Error('素材抽取阶段不能修改世界书')
      const state = object(chat.extract)
      preview = cards.update({ kind: 'draft', card: object(state.draft), player: state.player, patch: combined.fields })
      if (preview.player !== str(state.player).trim() && !preview.changedFields.includes('player')) preview.changedFields.push('player')
    } else {
      const card = await store.readCard(chat.cardId)
      if (card === undefined) throw new Error('角色卡不存在: ' + chat.cardId)
      preview = cards.update({ kind: 'card', card, patch: combined.fields, worldBookOperations: combined.worldBook })
    }

    stages[String(turn)] = combined
    await store.writeChat(chat)
    return { staged: true, mode, changed: preview.changed, changedFields: preview.changedFields }
  }

  async function finalize(input) {
    let chat = await store.chatForSession(input.sessionId)
    if (chat === undefined) return { saved: false, reason: 'unbound' }
    const turn = Math.max(0, Number(input.turn) || 0)
    const prior = commitFor(chat, turn)
    if (prior !== null) return { saved: true, duplicate: true, mode: chat.mode || 'story', changed: prior.changed === true }
    const userText = str(input.userText).trim()
    const assistantText = str(input.assistantText).trim()
    if (assistantText === '') throw new Error('本轮最终回复为空，无法保存酒馆状态')
    const mode = chat.mode || 'story'
    const stage = takeStage(chat, turn)

    if (mode === 'extract') {
      const state = object(chat.extract)
      let changed = false
      if (Object.keys(object(stage.fields)).length > 0) {
        const draftChange = cards.update({ kind: 'draft', card: object(state.draft), player: state.player, patch: stage.fields })
        state.draft = draftChange.card
        state.player = draftChange.player
        chat.extract = state
        changed = draftChange.changed
      }
      extract.commit(chat, turn)
      if (userText !== '') chat.messages.push({ role: 'user', text: userText, ts: now(), native: true })
      chat.messages.push({ role: 'assistant', text: assistantText, ts: now(), native: true, changed })
      chat.cardName = str(state.draft && state.draft.name) || '抽取中'
      rememberCommit(chat, turn, { mode, userText, changed }, null, now)
      await store.writeChat(chat)
      return { saved: true, mode, changed, chatId: chat.id, cardName: chat.cardName }
    }

    if (mode === 'revision') {
      let changed = false
      let savedCard = await store.readCard(chat.cardId)
      if (savedCard === undefined) throw new Error('角色卡不存在: ' + chat.cardId)
      if (Object.keys(object(stage.fields)).length > 0 || (Array.isArray(stage.worldBook) && stage.worldBook.length > 0)) {
        const result = await store.updateCard(chat.cardId, object(stage.fields), {
          ts: now(), instruction: userText, summary: '通过卡片模式设定对话更新人物卡'
        }, Array.isArray(stage.worldBook) ? stage.worldBook : [])
        changed = result.changed
        savedCard = result.card
      }
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
    const before = { posture: chat.posture || '' }
    let scriptReference = null
    let playScript = null
    if (mode === 'script') {
      playScript = await store.readScript(chat.cardId)
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
        draft.messages.push({ role: 'assistant', text: assistantText, ts: now(), native: true })
        draft.settleStatus = 'running'
        draft.settleError = null
        rememberCommit(draft, turn, { mode, userText, scriptReference }, before, now)
      }
    })
    chat = completed.chat
    if (completed.value.status !== 'committed') throw new Error('正文生成期间剧情状态已变化，本轮结果已作废')
    await store.writeChat(chat)
    if (chat.regenInProgress !== true) queueSettlement(chat.id)
    return { saved: true, mode, changed: false, chatId: chat.id, cardName: chat.cardName }
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
      const script = await store.readScript(chat.cardId)
      if (script !== undefined && Array.isArray(script.chunks)) {
        chat.scriptState = scripts.transition({ script, state: chat.scriptState, event: { kind: 'restore', revision: null, reference: chat.scriptState.prepared } }).state
        changed = true
      }
    }
    if ((chat.mode || 'story') === 'extract' && chat.extract && chat.extract.prepared && Number(chat.extract.prepared.nativeTurn) === turn) {
      chat.extract.prepared = null
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
    if (mode === 'revision') return ['tavern_read_script', 'tavern_read_worldbook', 'tavern_update_card']
    if (mode === 'extract') return ['tavern_update_card']
    return []
  }

  return Object.freeze({ prepare, stageChanges, finalize, discard, visibleTools })
}
