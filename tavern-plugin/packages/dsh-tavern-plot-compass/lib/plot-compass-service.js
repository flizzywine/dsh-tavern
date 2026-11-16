import {
  PLOT_COMPASS_BRAINSTORM_SYSTEM,
  PLOT_COMPASS_CHAT_SUBMIT_TOOL,
  PLOT_COMPASS_PROGRESS_SYSTEM,
  PLOT_COMPASS_SCOPES,
  PLOT_COMPASS_SUBMIT_TOOL,
  PLOT_COMPASS_SUBMIT_TOOL_NAME,
  appendPlotCompassChat,
  applyPlotCompassAutoProgress,
  applyPlotCompassCustomArchetypes,
  applyPlotCompassPin,
  applyPlotCompassPreferences,
  applyPlotCompassStepToggle,
  buildPlotCompassBrainstormPrompt,
  buildPlotCompassMaterial,
  buildPlotCompassProgressPrompt,
  clearPlotCompassChat,
  collectAssistantProseForGrounding,
  collectPendingCompassSteps,
  collectTrackableCompassRoutes,
  emptyPlotCompass,
  extractStoryProseForGrounding,
  isPlotCompassEnabled,
  mergePlotCompassUpdate,
  parsePlotCompassProgressOutcome,
  parsePlotCompassSubmission,
  readPlotCompass,
  setPlotCompassPin
} from './plot-compass.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function normalizePlotCompassModel(value) {
  if (value === 'background' || value === 'foreground') return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const provider = str(value.provider).trim()
    const model = str(value.model).trim()
    if (!provider || !model) return null
    const reasoningEffort = str(value.reasoningEffort).trim()
    return reasoningEffort ? { provider, model, reasoningEffort } : { provider, model }
  }
  return null
}

export function defaultGameRecord(defaults = {}) {
  const interval = Number.isSafeInteger(Number(defaults.autoUpdateInterval))
    ? Math.max(0, Math.min(100, Number(defaults.autoUpdateInterval)))
    : 0
  const baseCompass = emptyPlotCompass()
  if (interval > 0) baseCompass.autoUpdateInterval = interval
  return {
    version: 1,
    enabled: Boolean(defaults.enabled),
    modelSelection: normalizePlotCompassModel(defaults.modelSelection) || 'background',
    compass: baseCompass,
    task: { status: 'idle', scope: 'all', error: '', updatedAt: 0 }
  }
}

export function normalizeGameRecord(raw, defaults = {}) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
  if (!src) return defaultGameRecord(defaults)
  const taskRaw = src.task && typeof src.task === 'object' ? src.task : {}
  return {
    version: 1,
    enabled: typeof src.enabled === 'boolean' ? src.enabled : Boolean(defaults.enabled),
    modelSelection: normalizePlotCompassModel(src.modelSelection) || normalizePlotCompassModel(defaults.modelSelection) || 'background',
    compass: readPlotCompass(src.compass),
    task: {
      status: str(taskRaw.status) || 'idle',
      scope: str(taskRaw.scope) || 'all',
      error: str(taskRaw.error),
      updatedAt: Math.max(0, Number(taskRaw.updatedAt) || 0),
      ...(taskRaw.traceSessionId ? { traceSessionId: str(taskRaw.traceSessionId) } : {})
    }
  }
}

function latestTurnFromHistory(turns, turnState) {
  let latest = Math.max(0, Number(turnState?.turn) || 0)
  for (const item of Array.isArray(turns) ? turns : []) {
    latest = Math.max(latest, Number(item?.turn) || 0)
  }
  return latest
}

function historyToMessages(turns = [], latestTurnObj = null) {
  const messages = []
  for (const row of Array.isArray(turns) ? turns : []) {
    if (!row) continue
    const turn = Number(row.turn) || 0
    const userText = str(row.input).trim()
    const assistantText = str(row.rawText ?? row.text).trim()
    if (userText) messages.push({ role: 'user', turn, text: userText, sourceText: userText })
    if (assistantText) messages.push({ role: 'assistant', turn, text: assistantText, sourceText: assistantText })
  }
  if (messages.length === 0 && latestTurnObj) {
    const turn = Number(latestTurnObj.turn) || 0
    const text = str(latestTurnObj.rawText ?? latestTurnObj.text).trim()
    if (text) messages.push({ role: 'assistant', turn, text, sourceText: text })
  }
  return messages
}

function extractSectionsFallback(requestContext) {
  const sections = Array.isArray(requestContext?.sections) ? requestContext.sections : []
  let posture = ''
  const guides = []
  let scriptText = ''
  for (const item of sections) {
    if (!item || !item.text) continue
    if (item.origin === 'tavern:posture') posture = str(item.text)
    else if (item.origin === 'tavern:guide') guides.push(str(item.text))
    else if (item.origin === 'tavern:script') scriptText = str(item.text)
  }
  return { posture, guides, scriptText }
}

export function createPlotCompassService({
  store,
  contextReader,
  promptText,
  resolveModel,
  runAgent,
  callModel = null,
  onStatus = () => {},
  onError = error => console.error('dsh-tavern-plot-compass: 后台任务异常', error),
  now = Date.now
}) {
  const jobs = new Map()
  const progressJobs = new Set()

  function projectTask(record, gameId) {
    const raw = record?.task && typeof record.task === 'object'
      ? record.task
      : { status: 'idle', scope: 'all', error: '' }
    const active = jobs.has(str(gameId))
    if (raw.status === 'running' && !active) {
      return {
        status: 'failed',
        scope: str(raw.scope) || 'all',
        error: '剧情罗盘推演已中断，请点击重试。',
        updatedAt: Number(raw.updatedAt) || 0
      }
    }
    return {
      status: str(raw.status) || 'idle',
      scope: str(raw.scope) || 'all',
      error: str(raw.error),
      updatedAt: Number(raw.updatedAt) || 0,
      ...(raw.traceSessionId ? { traceSessionId: str(raw.traceSessionId) } : {})
    }
  }

  async function setTaskState(gameId, patch) {
    await store.updateGame(gameId, draft => {
      draft.task = {
        status: 'idle',
        scope: 'all',
        error: '',
        ...(draft.task || {}),
        ...patch,
        updatedAt: now()
      }
      return draft
    })
    onStatus(str(gameId))
  }

  async function loadGenerationContext(gameId, record) {
    const raw = await contextReader.load(gameId, record)
    if (!raw?.card) throw new Error('当前对局缺少人物卡信息')
    return raw
  }

  async function executeGeneration({ gameId, scope, guidance, model, controller, fresh = false }) {
    let submitted = null
    let submissionError = null
    let runResult = null
    try {
      const freshRecord = await store.readGame(gameId)
      if (!isPlotCompassEnabled(freshRecord)) throw new Error('剧情罗盘已关闭')
      const ctxData = await loadGenerationContext(gameId, freshRecord)
      const basedOnTurn = ctxData.basedOnTurn

      const material = buildPlotCompassMaterial({
        card: ctxData.card,
        messages: ctxData.messages,
        variables: ctxData.variables,
        posture: ctxData.posture,
        ledger: ctxData.ledger,
        guides: ctxData.guides,
        compass: freshRecord.compass,
        worldbookEntries: ctxData.worldbookEntries,
        constantWorldbookText: ctxData.constantWorldbookText,
        activatedWorldbookTitles: ctxData.activatedWorldbookTitles,
        scriptWindow: ctxData.scriptWindow,
        scope,
        guidance,
        fresh
      })

      controller.signal.throwIfAborted()
      runResult = await runAgent({
        gameId: str(gameId),
        selection: model,
        temperature: 0.85,
        signal: controller.signal,
        system: typeof promptText === 'function' ? promptText() : str(promptText),
        prompt: material,
        tools: [PLOT_COMPASS_SUBMIT_TOOL],
        maxToolCalls: 4,
        stopToolsWhen: () => submitted !== null,
        acceptWithoutText: () => submitted !== null,
        onToolCall: async call => {
          if (!call || call.name !== PLOT_COMPASS_SUBMIT_TOOL_NAME) {
            return JSON.stringify({ ok: false, retryable: true, error: '当前任务只允许调用 ' + PLOT_COMPASS_SUBMIT_TOOL_NAME })
          }
          try {
            submitted = parsePlotCompassSubmission(call.arguments, {
              scope,
              card: ctxData.card,
              playerName: ctxData.playerName
            })
            submissionError = null
            return JSON.stringify({
              ok: true,
              shortTerm: submitted.shortTerm.length,
              midTerm: submitted.midTerm.length,
              longTerm: submitted.longTerm.length
            })
          } catch (err) {
            submitted = null
            submissionError = err
            return JSON.stringify({ ok: false, retryable: true, error: str(err?.message || err) })
          }
        }
      })

      controller.signal.throwIfAborted()
      if (!submitted) {
        throw submissionError || new Error('模型未调用 plot_compass_submit 提交有效剧情规划，请检查后台模型是否支持工具调用后重试')
      }

      const traceSessionId = str(runResult?.traceSessionId)
      const latestTurn = await contextReader.latestTurn(gameId).catch(() => basedOnTurn)
      await store.updateGame(gameId, current => {
        if (!isPlotCompassEnabled(current)) return undefined
        current.compass = mergePlotCompassUpdate(current.compass, submitted, {
          scope,
          turn: latestTurn || basedOnTurn,
          now: now(),
          fresh
        })
        current.task = {
          status: 'done',
          scope,
          error: '',
          updatedAt: now(),
          ...(traceSessionId ? { traceSessionId } : {})
        }
        return current
      })
      onStatus(str(gameId))
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        await setTaskState(gameId, { status: 'idle', scope, error: '' }).catch(onError)
        return
      }
      await setTaskState(gameId, {
        status: 'failed',
        scope,
        error: str(error?.message || error) || '剧情罗盘推演失败',
        ...(runResult?.traceSessionId ? { traceSessionId: str(runResult.traceSessionId) } : {})
      }).catch(onError)
    }
  }

  async function executeBrainstormChat({ gameId, userMsgId, message, model, controller }) {
    let submitted = null
    let submissionError = null
    let runResult = null
    try {
      const freshRecord = await store.readGame(gameId)
      if (!isPlotCompassEnabled(freshRecord)) throw new Error('剧情罗盘已关闭')
      const ctxData = await loadGenerationContext(gameId, freshRecord)
      const basedOnTurn = ctxData.basedOnTurn

      const compassNow = readPlotCompass(freshRecord.compass)
      const priorHistory = compassNow.chatHistory.filter(item => item.id !== userMsgId)

      const brainstormPrompt = buildPlotCompassBrainstormPrompt({
        card: ctxData.card,
        messages: ctxData.messages,
        variables: ctxData.variables,
        posture: ctxData.posture,
        ledger: ctxData.ledger,
        guides: ctxData.guides,
        compass: { ...compassNow, chatHistory: priorHistory },
        worldbookEntries: ctxData.worldbookEntries,
        constantWorldbookText: ctxData.constantWorldbookText,
        activatedWorldbookTitles: ctxData.activatedWorldbookTitles,
        scriptWindow: ctxData.scriptWindow,
        message
      })

      controller.signal.throwIfAborted()
      runResult = await runAgent({
        gameId: str(gameId),
        selection: model,
        temperature: 0.85,
        signal: controller.signal,
        system: PLOT_COMPASS_BRAINSTORM_SYSTEM,
        prompt: brainstormPrompt,
        tools: [PLOT_COMPASS_CHAT_SUBMIT_TOOL],
        maxToolCalls: 2,
        acceptWithoutText: () => submitted !== null,
        onToolCall: async call => {
          if (!call || call.name !== PLOT_COMPASS_SUBMIT_TOOL_NAME) {
            return JSON.stringify({ ok: false, retryable: true, error: '只允许调用 ' + PLOT_COMPASS_SUBMIT_TOOL_NAME })
          }
          try {
            submitted = parsePlotCompassSubmission(call.arguments, {
              scope: 'chat',
              card: ctxData.card,
              playerName: ctxData.playerName
            })
            submissionError = null
            return JSON.stringify({
              ok: true,
              targetScope: submitted.targetScope,
              shortTerm: submitted.shortTerm.length,
              midTerm: submitted.midTerm.length,
              longTerm: submitted.longTerm.length
            })
          } catch (err) {
            submitted = null
            submissionError = err
            return JSON.stringify({ ok: false, retryable: true, error: str(err?.message || err) })
          }
        }
      })

      controller.signal.throwIfAborted()
      const rawReplyText = extractStoryProseForGrounding(runResult?.text || '').trim()
      const scopeApplied = submitted ? submitted.targetScope : ''
      const scopeLabel = scopeApplied === 'shortTerm' ? '今期' : scopeApplied === 'midTerm' ? '中期' : scopeApplied === 'longTerm' ? '长期' : '全部层级'
      const assistantText = rawReplyText || (submitted
        ? `已根据我们的讨论为你更新「${scopeLabel}」路线卡片，你可以在下方查看或直接点亮使用。`
        : '')
      if (!assistantText) {
        throw submissionError || new Error('剧情罗盘脑暴助手未返回有效回复，请重试')
      }

      const traceSessionId = str(runResult?.traceSessionId)
      const latestTurn = await contextReader.latestTurn(gameId).catch(() => basedOnTurn)
      await store.updateGame(gameId, current => {
        if (!isPlotCompassEnabled(current)) return undefined
        let nextCompass = readPlotCompass(current.compass)
        if (submitted) {
          nextCompass = mergePlotCompassUpdate(nextCompass, submitted, {
            scope: submitted.targetScope,
            turn: latestTurn || basedOnTurn,
            now: now()
          })
        }
        nextCompass = appendPlotCompassChat(nextCompass, {
          role: 'assistant',
          text: assistantText,
          scopeApplied,
          turn: latestTurn || basedOnTurn,
          createdAt: now()
        }, { now: now() })
        current.compass = nextCompass
        current.task = {
          status: 'done',
          scope: 'chat',
          error: '',
          updatedAt: now(),
          ...(traceSessionId ? { traceSessionId } : {})
        }
        return current
      })
      onStatus(str(gameId))
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        await setTaskState(gameId, { status: 'idle', scope: 'chat', error: '' }).catch(onError)
        return
      }
      await setTaskState(gameId, {
        status: 'failed',
        scope: 'chat',
        error: str(error?.message || error) || '剧情罗盘对话失败',
        ...(runResult?.traceSessionId ? { traceSessionId: str(runResult.traceSessionId) } : {})
      }).catch(onError)
    }
  }

  async function generate({ gameId, scope = 'all', guidance = '', wait = false, fresh = false } = {}) {
    const id = str(gameId)
    if (!id) throw new Error('请先打开游玩会话')
    const normalizedScope = PLOT_COMPASS_SCOPES.includes(scope) ? scope : 'all'
    const record = await store.readGame(id)
    if (!isPlotCompassEnabled(record)) throw new Error('剧情罗盘已关闭，请先开启后再推演')
    if (jobs.has(id)) throw new Error('剧情罗盘正在推演中，请稍候或先取消当前推演')
    const model = await resolveModel(id, record)
    if (!model) throw new Error('请先配置可用的剧情罗盘模型（或前台/后台模型）')

    const controller = new AbortController()
    const entry = { controller, promise: null }
    jobs.set(id, entry)
    try {
      await setTaskState(id, { status: 'running', scope: normalizedScope, error: '' })
    } catch (err) {
      jobs.delete(id)
      throw err
    }

    const promise = executeGeneration({
      gameId: id,
      scope: normalizedScope,
      guidance: str(guidance).trim().slice(0, 800),
      model,
      controller,
      fresh: fresh === true
    }).catch(onError).finally(() => {
      if (jobs.get(id) === entry) jobs.delete(id)
    })
    entry.promise = promise

    if (wait === true) {
      await promise
      const updated = await store.readGame(id)
      return {
        status: updated?.task?.status || 'done',
        scope: normalizedScope,
        plotCompass: readPlotCompass(updated?.compass),
        plotCompassTask: projectTask(updated, id)
      }
    }
    return { status: 'running', scope: normalizedScope }
  }

  async function chat({ gameId, message, wait = false } = {}) {
    const id = str(gameId)
    if (!id) throw new Error('请先打开游玩会话')
    const trimmed = str(message).trim().slice(0, 800)
    if (!trimmed) throw new Error('请输入想讨论的剧情方向或点子')
    const record = await store.readGame(id)
    if (!isPlotCompassEnabled(record)) throw new Error('剧情罗盘已关闭，请先开启后再使用脑暴对话')
    if (jobs.has(id)) throw new Error('剧情罗盘正在推演或回复中，请稍候或先取消')
    const model = await resolveModel(id, record)
    if (!model) throw new Error('请先配置可用的剧情罗盘模型（或前台/后台模型）')

    const userMsgId = `compass-u-${now()}-${Math.random().toString(36).slice(2, 6)}`
    const turn = await contextReader.latestTurn(id).catch(() => 0)
    const controller = new AbortController()
    const entry = { controller, promise: null }
    jobs.set(id, entry)
    try {
      await store.updateGame(id, current => {
        if (!isPlotCompassEnabled(current)) throw new Error('剧情罗盘已关闭，请先开启')
        current.compass = appendPlotCompassChat(current.compass, {
          id: userMsgId,
          role: 'user',
          text: trimmed,
          turn,
          createdAt: now()
        }, { now: now() })
        current.task = {
          ...(current.task || {}),
          status: 'running',
          scope: 'chat',
          error: '',
          updatedAt: now()
        }
        return current
      })
      onStatus(id)
    } catch (err) {
      jobs.delete(id)
      throw err
    }

    const promise = executeBrainstormChat({
      gameId: id,
      userMsgId,
      message: trimmed,
      model,
      controller
    }).catch(onError).finally(() => {
      if (jobs.get(id) === entry) jobs.delete(id)
    })
    entry.promise = promise

    if (wait === true) {
      await promise
      const updated = await store.readGame(id)
      return {
        status: updated?.task?.status || 'done',
        scope: 'chat',
        plotCompass: readPlotCompass(updated?.compass),
        plotCompassTask: projectTask(updated, id)
      }
    }
    return { status: 'running', scope: 'chat' }
  }

  async function clearChat({ gameId } = {}) {
    const id = str(gameId)
    if (!id) throw new Error('请先打开游玩会话')
    const saved = await store.updateGame(id, current => {
      current.compass = clearPlotCompassChat(current.compass, { now: now() })
      return current
    })
    onStatus(id)
    return readPlotCompass(saved?.compass)
  }

  async function cancel({ gameId } = {}) {
    const id = str(gameId)
    if (!id) throw new Error('请先打开游玩会话')
    const active = jobs.get(id)
    if (active) {
      active.controller.abort(new Error('玩家已取消剧情罗盘推演'))
      jobs.delete(id)
    }
    await setTaskState(id, { status: 'idle', error: '' })
    return { status: 'idle' }
  }

  async function setEnabled({ gameId, enabled } = {}) {
    const id = str(gameId)
    if (!id) throw new Error('请先打开游玩会话')
    if (typeof enabled !== 'boolean') throw new Error('剧情罗盘开关必须为布尔值')
    if (!enabled) {
      const active = jobs.get(id)
      if (active) {
        active.controller.abort(new Error('玩家已关闭剧情罗盘'))
        jobs.delete(id)
      }
    }
    const saved = await store.updateGame(id, current => {
      current.enabled = enabled
      if (!enabled && current.task?.status === 'running') {
        current.task = {
          status: 'idle',
          scope: str(current.task.scope) || 'all',
          error: '',
          updatedAt: now()
        }
      }
      return current
    })
    onStatus(id)
    return {
      enabled: isPlotCompassEnabled(saved),
      plotCompass: readPlotCompass(saved?.compass),
      plotCompassTask: projectTask(saved, id)
    }
  }

  async function setModel({ gameId, model } = {}) {
    const id = str(gameId)
    if (!id) throw new Error('请先打开游玩会话')
    const normalized = normalizePlotCompassModel(model)
    if (!normalized) throw new Error('剧情罗盘模型配置无效')
    const saved = await store.updateGame(id, current => {
      current.modelSelection = normalized
      return current
    })
    onStatus(id)
    return { plotCompassModel: saved.modelSelection }
  }

  async function pin({ gameId, horizon, routeId, exact = false } = {}) {
    const id = str(gameId)
    if (!id) throw new Error('请先打开游玩会话')
    const record = await store.readGame(id)
    if (!isPlotCompassEnabled(record)) throw new Error('剧情罗盘已关闭，请先开启')
    const saved = await store.updateGame(id, current => {
      if (!isPlotCompassEnabled(current)) throw new Error('剧情罗盘已关闭，请先开启')
      current.compass = exact
        ? setPlotCompassPin(current.compass, { horizon, routeId, now: now() })
        : applyPlotCompassPin(current.compass, { horizon, routeId, now: now() })
      return current
    })
    onStatus(id)
    return readPlotCompass(saved?.compass)
  }

  async function toggleStep({ gameId, horizon, routeId, stepIndex } = {}) {
    const id = str(gameId)
    if (!id) throw new Error('请先打开游玩会话')
    const record = await store.readGame(id)
    if (!isPlotCompassEnabled(record)) throw new Error('剧情罗盘已关闭，请先开启')
    const saved = await store.updateGame(id, current => {
      if (!isPlotCompassEnabled(current)) throw new Error('剧情罗盘已关闭，请先开启')
      current.compass = applyPlotCompassStepToggle(current.compass, { horizon, routeId, stepIndex, now: now() })
      return current
    })
    onStatus(id)
    return readPlotCompass(saved?.compass)
  }

  async function setArchetypes({ gameId, archetypes } = {}) {
    const id = str(gameId)
    if (!id) throw new Error('请先打开游玩会话')
    const record = await store.readGame(id)
    if (!isPlotCompassEnabled(record)) throw new Error('剧情罗盘已关闭，请先开启')
    const saved = await store.updateGame(id, current => {
      if (!isPlotCompassEnabled(current)) throw new Error('剧情罗盘已关闭，请先开启')
      current.compass = applyPlotCompassCustomArchetypes(current.compass, archetypes, { now: now() })
      return current
    })
    onStatus(id)
    return readPlotCompass(saved?.compass)
  }

  async function setPreferences({ gameId, pace, blindBox, customDirective, autoUpdateInterval } = {}) {
    const id = str(gameId)
    if (!id) throw new Error('请先打开游玩会话')
    const record = await store.readGame(id)
    if (!isPlotCompassEnabled(record)) throw new Error('剧情罗盘已关闭，请先开启')
    const saved = await store.updateGame(id, current => {
      if (!isPlotCompassEnabled(current)) throw new Error('剧情罗盘已关闭，请先开启')
      current.compass = applyPlotCompassPreferences(current.compass, {
        pace,
        blindBox,
        customDirective,
        autoUpdateInterval,
        now: now()
      })
      return current
    })
    onStatus(id)
    return readPlotCompass(saved?.compass)
  }

  async function autoEvolveAfterCompaction(gameId) {
    try {
      const id = str(gameId)
      if (!id || jobs.has(id)) return null
      const record = await store.readGame(id)
      if (!isPlotCompassEnabled(record)) return null
      const compass = readPlotCompass(record.compass)
      const hasPinned = Boolean(compass.pinned.shortTerm || compass.pinned.midTerm || compass.pinned.longTerm)
      if (!hasPinned) return null
      const latestTurn = await contextReader.latestTurn(id)
      if (latestTurn <= compass.basedOnTurn) return null
      return await generate({
        gameId: id,
        scope: 'all',
        guidance: '本次为上下文归卷后的增量演进：请对照最新剧情勾选已完成节拍/里程碑，延续玩家已点亮路线并补充新分支。'
      })
    } catch {
      return null
    }
  }

  function isAutoUpdateDue(record, latestTurn) {
    if (typeof runAgent !== 'function') return false
    if (!isPlotCompassEnabled(record)) return false
    const compass = readPlotCompass(record.compass)
    const interval = compass.autoUpdateInterval || 0
    if (interval <= 0) return false
    return latestTurn > 0 && (latestTurn - compass.basedOnTurn) >= interval
  }

  async function autoUpdateOnTurn({ gameId, turn = 0, wait = true } = {}) {
    const id = str(gameId)
    if (!id || typeof runAgent !== 'function' || jobs.has(id)) return null
    const record = await store.readGame(id)
    if (!isPlotCompassEnabled(record)) return null
    const latestTurn = Math.max(Number(turn) || 0, await contextReader.latestTurn(id).catch(() => 0))
    if (!isAutoUpdateDue(record, latestTurn)) return null
    const model = await resolveModel(id, record)
    if (!model) return null

    const compass = readPlotCompass(record.compass)
    const interval = compass.autoUpdateInterval || 0
    const hasExisting = compass.shortTerm.length > 0 || compass.midTerm.length > 0 || compass.longTerm.length > 0
    const guidance = hasExisting
      ? `本次为每 ${interval} 楼定时自动演进刷新（当前第 ${latestTurn} 轮，距上次推演已过 ${latestTurn - compass.basedOnTurn} 轮）：请对照最新剧情勾选已完成节拍/里程碑，延续玩家已点亮路线并补充新分支。`
      : `本次为每 ${interval} 楼定时自动推演（当前第 ${latestTurn} 轮）：请结合当前剧情、人物卡与世界书暗线，生成今期、中期、长期的多路线剧情发展规划。`
    return await generate({
      gameId: id,
      scope: 'all',
      guidance,
      wait
    }).catch(err => {
      onError(err)
      return null
    })
  }

  async function syncTurnProgress({ gameId, turn = 0 } = {}) {
    const id = str(gameId)
    if (!id || typeof callModel !== 'function' || progressJobs.has(id) || jobs.has(id)) return null
    const record = await store.readGame(id)
    if (!isPlotCompassEnabled(record)) return null
    const compass = readPlotCompass(record.compass)
    const pending = collectPendingCompassSteps(compass)
    const trackableRoutes = collectTrackableCompassRoutes(compass)
    const latestTurn = Math.max(Number(turn) || 0, await contextReader.latestTurn(id).catch(() => 0))
    const checkedFloor = Math.max(compass.basedOnTurn, compass.lastCheckedTurn || 0)
    if (pending.length === 0 || latestTurn <= checkedFloor) return null
    const model = await resolveModel(id, record)
    if (!model) return null

    progressJobs.add(id)
    try {
      const messages = await contextReader.recentMessages(id, 6)
      const promptTextInput = buildPlotCompassProgressPrompt(messages, pending, { fromTurn: checkedFloor + 1, compass })
      const proseText = collectAssistantProseForGrounding(messages)
      const rawReply = await callModel({
        gameId: id,
        selection: model,
        temperature: 0.1,
        maxTokens: 512,
        system: PLOT_COMPASS_PROGRESS_SYSTEM,
        messages: [{ role: 'user', content: promptTextInput }]
      })
      const outputText = typeof rawReply === 'string' ? rawReply : str(rawReply?.output ?? rawReply?.text)
      const parsedProgress = parsePlotCompassProgressOutcome(outputText, pending.map(item => item.key), trackableRoutes, { proseText })

      let outcome = null
      let stillEnabled = true
      await store.updateGame(id, current => {
        if (!isPlotCompassEnabled(current)) {
          stillEnabled = false
          return undefined
        }
        outcome = applyPlotCompassAutoProgress(current.compass, parsedProgress, { turn: latestTurn, now: now() })
        current.compass = outcome.compass
        return current
      })

      if (!stillEnabled) return null
      if (outcome && (outcome.newlyCompletedCount > 0 || outcome.newlyLapsedCount > 0)) {
        onStatus(id)
      }
      if (outcome?.pinnedShortCompleted && !jobs.has(id)) {
        await generate({
          gameId: id,
          scope: 'shortTerm',
          guidance: `上一幕点亮的近期路线「${outcome.completedPinnedShortTitle}」全部节拍已在剧情中达成，请紧承最新回合结尾与已点亮的中长期方向，推演下一幕新的今期（2-5轮）多路线节拍。`
        }).catch(() => {})
      } else if (outcome?.pinnedShortLapsed && !jobs.has(id)) {
        await generate({
          gameId: id,
          scope: 'shortTerm',
          guidance: `原定近期路线「${outcome.lapsedPinnedShortTitle}」因玩家行动或局势变化已不再成立（${outcome.lapsedPinnedShortReason}），请严格依据最新场面定格与已有中长期基调，重新推演符合当前因果与处境的今期（2-5轮）新分支。`
        }).catch(() => {})
      }
      return outcome
    } catch (err) {
      onError(err)
      return null
    } finally {
      progressJobs.delete(id)
    }
  }

  async function onTurnSettled({ gameId, turn } = {}) {
    const id = str(gameId)
    if (!id) return null
    const record = await store.readGame(id)
    if (!isPlotCompassEnabled(record)) return null
    const latestTurn = Math.max(Number(turn) || 0, await contextReader.latestTurn(id).catch(() => 0))
    if (isAutoUpdateDue(record, latestTurn)) {
      return await autoUpdateOnTurn({ gameId: id, turn: latestTurn, wait: true })
    }
    return await syncTurnProgress({ gameId: id, turn: latestTurn })
  }

  function viewState(record, gameId, latestTurn = 0) {
    return {
      enabled: isPlotCompassEnabled(record),
      modelSelection: normalizePlotCompassModel(record?.modelSelection) || 'background',
      plotCompass: readPlotCompass(record?.compass),
      plotCompassTask: projectTask(record, gameId),
      latestAssistantTurn: Math.max(0, Number(latestTurn) || 0)
    }
  }

  return Object.freeze({
    projectTask,
    viewState,
    generate,
    chat,
    clearChat,
    cancel,
    setEnabled,
    setModel,
    pin,
    toggleStep,
    setArchetypes,
    setPreferences,
    isAutoUpdateDue,
    autoUpdateOnTurn,
    syncTurnProgress,
    onTurnSettled,
    autoEvolveAfterCompaction,
    wait: gameId => jobs.get(str(gameId))?.promise || null,
    clearMemory(gameId) {
      const id = str(gameId)
      const active = jobs.get(id)
      if (active) {
        active.controller.abort(new Error('会话已移除'))
        jobs.delete(id)
      }
      progressJobs.delete(id)
    }
  })
}

export { historyToMessages, latestTurnFromHistory, extractSectionsFallback }
