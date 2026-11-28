import {
  PLOT_COMPASS_BRAINSTORM_SYSTEM,
  PLOT_COMPASS_DEFAULT_MAX_ROUTES,
  PLOT_COMPASS_GOAL_HORIZON_LABELS,
  PLOT_COMPASS_PROGRESS_SYSTEM,
  PLOT_COMPASS_SCOPES,
  PLOT_COMPASS_SUBMIT_TOOL_NAME,
  activePlotCompassGoal,
  appendPlotCompassChat,
  applyPlotCompassAutoProgress,
  applyPlotCompassCustomArchetypes,
  applyPlotCompassGoal,
  applyPlotCompassNovelRef,
  applyPlotCompassPin,
  applyPlotCompassPreferences,
  applyPlotCompassStepToggle,
  buildPlotCompassBrainstormPrompt,
  buildPlotCompassChatSubmitTool,
  buildPlotCompassMaterial,
  buildPlotCompassProgressPrompt,
  buildPlotCompassSubmitTool,
  clearPlotCompassChat,
  collectAssistantProseForGrounding,
  collectPendingCompassSteps,
  collectTrackableCompassRoutes,
  emptyPlotCompass,
  extractStoryProseForGrounding,
  isPlotCompassEnabled,
  mergePlotCompassUpdate,
  normalizePlotCompassMaxRoutes,
  parsePlotCompassProgressOutcome,
  parsePlotCompassSubmission,
  readPlotCompass,
  setPlotCompassPin
} from './plot-compass.js'
import {
  DEFAULT_ANALYZE_BATCH_CHUNKS,
  MAX_PASTE_TEXT_CHARS,
  MIN_PASTE_TEXT_CHARS,
  NOVEL_BLUEPRINT_ANALYZE_SYSTEM,
  NOVEL_BLUEPRINT_SUBMIT_TOOL,
  NOVEL_BLUEPRINT_SUBMIT_TOOL_NAME,
  NOVEL_EXCERPT_TOOL_NAME,
  NOVEL_INSPECT_TOOL_NAME,
  advanceNovelCursorOnComplete,
  buildNovelAnalyzePrompt,
  buildNovelExcerptTool,
  buildNovelInspectTool,
  computeTextHash,
  executeNovelToolCall,
  mergeNovelBlueprintBatch,
  normalizeNovelBlueprint,
  parseNovelBlueprintSubmission,
  projectBlueprintForClient,
  splitPasteTextToChunks
} from './novel-reference.js'

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
  const maxRoutes = normalizePlotCompassMaxRoutes(defaults.maxRoutes) ?? PLOT_COMPASS_DEFAULT_MAX_ROUTES
  const baseCompass = emptyPlotCompass()
  if (interval > 0) baseCompass.autoUpdateInterval = interval
  baseCompass.maxRoutes = maxRoutes
  if (typeof defaults.strength === 'string' && ['soft', 'guided', 'strict'].includes(defaults.strength)) {
    baseCompass.strength = defaults.strength
  }
  return {
    version: 1,
    enabled: Boolean(defaults.enabled),
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
  blueprintStore = null,
  scriptLibrary = null,
  onGlobalChange = () => {},
  onStatus = () => {},
  onError = error => console.error('dsh-tavern-plot-compass: 后台任务异常', error),
  now = Date.now
}) {
  const jobs = new Map()
  const progressJobs = new Set()
  let fallbackModelSelection = 'background'
  let blueprintJob = null
  let blueprintTaskState = {
    status: 'idle',
    blueprintId: '',
    title: '',
    progressText: '',
    error: '',
    updatedAt: 0
  }

  function projectBlueprintTask() {
    if (blueprintTaskState.status === 'running' && !blueprintJob) {
      return {
        ...blueprintTaskState,
        status: 'failed',
        error: blueprintTaskState.error || '小说拆书任务已中断，请重试。'
      }
    }
    return { ...blueprintTaskState }
  }

  function setBlueprintTask(patch) {
    blueprintTaskState = {
      ...blueprintTaskState,
      ...patch,
      updatedAt: now()
    }
    onGlobalChange()
  }

  async function resolveActiveNovelContext(compass) {
    const ref = compass?.novelRef
    if (!ref?.enabled || !ref?.blueprintId || !blueprintStore) return null
    const list = await blueprintStore.list().catch(() => [])
    const found = (Array.isArray(list) ? list : []).find(item => item && item.id === ref.blueprintId)
    const blueprint = found ? normalizeNovelBlueprint(found) : null
    return blueprint ? { blueprint, novelRef: ref } : null
  }

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

      const compassConfig = readPlotCompass(freshRecord.compass)
      const maxRoutes = compassConfig.maxRoutes
      const novelCtx = await resolveActiveNovelContext(compassConfig)
      const trackArc = Boolean(novelCtx && compassConfig.novelRef?.mode === 'track_arc')
      const material = buildPlotCompassMaterial({
        card: ctxData.card,
        messages: ctxData.messages,
        variables: ctxData.variables,
        posture: ctxData.posture,
        ledger: ctxData.ledger,
        guides: ctxData.guides,
        compass: compassConfig,
        worldbookEntries: ctxData.worldbookEntries,
        constantWorldbookText: ctxData.constantWorldbookText,
        activatedWorldbookTitles: ctxData.activatedWorldbookTitles,
        scriptWindow: ctxData.scriptWindow,
        novelContext: novelCtx,
        scope,
        guidance,
        fresh
      })

      const tools = [
        buildPlotCompassSubmitTool(maxRoutes, { includeNovelCursorUpdate: trackArc }),
        ...(novelCtx
          ? [buildNovelInspectTool(novelCtx.blueprint), buildNovelExcerptTool(novelCtx.blueprint)]
          : [])
      ]

      controller.signal.throwIfAborted()
      runResult = await runAgent({
        gameId: str(gameId),
        selection: model,
        temperature: 0.85,
        signal: controller.signal,
        system: typeof promptText === 'function' ? promptText() : str(promptText),
        prompt: material,
        tools,
        maxToolCalls: novelCtx ? 7 : 4,
        stopToolsWhen: () => submitted !== null,
        acceptWithoutText: () => submitted !== null,
        onToolCall: async call => {
          if (call && (call.name === NOVEL_INSPECT_TOOL_NAME || call.name === NOVEL_EXCERPT_TOOL_NAME) && novelCtx) {
            return await executeNovelToolCall({
              call,
              blueprint: novelCtx.blueprint,
              readScriptRange: scriptLibrary?.readRange
            })
          }
          if (!call || call.name !== PLOT_COMPASS_SUBMIT_TOOL_NAME) {
            return JSON.stringify({ ok: false, retryable: true, error: '当前任务只允许调用 ' + PLOT_COMPASS_SUBMIT_TOOL_NAME })
          }
          try {
            submitted = parsePlotCompassSubmission(call.arguments, {
              scope,
              card: ctxData.card,
              playerName: ctxData.playerName,
              maxRoutes
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
          fresh,
          novelTotalUnits: novelCtx?.blueprint?.units?.length || 0
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
      const novelCtx = await resolveActiveNovelContext(compassNow)
      const trackArc = Boolean(novelCtx && compassNow.novelRef?.mode === 'track_arc')

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
        novelContext: novelCtx,
        message
      })

      const maxRoutes = compassNow.maxRoutes
      const tools = [
        buildPlotCompassChatSubmitTool(maxRoutes, { includeNovelCursorUpdate: trackArc }),
        ...(novelCtx ? [buildNovelInspectTool(novelCtx.blueprint)] : [])
      ]
      controller.signal.throwIfAborted()
      runResult = await runAgent({
        gameId: str(gameId),
        selection: model,
        temperature: 0.85,
        signal: controller.signal,
        system: PLOT_COMPASS_BRAINSTORM_SYSTEM,
        prompt: brainstormPrompt,
        tools,
        maxToolCalls: novelCtx ? 4 : 2,
        acceptWithoutText: () => submitted !== null,
        onToolCall: async call => {
          if (call && (call.name === NOVEL_INSPECT_TOOL_NAME || call.name === NOVEL_EXCERPT_TOOL_NAME) && novelCtx) {
            return await executeNovelToolCall({
              call,
              blueprint: novelCtx.blueprint,
              readScriptRange: scriptLibrary?.readRange
            })
          }
          if (!call || call.name !== PLOT_COMPASS_SUBMIT_TOOL_NAME) {
            return JSON.stringify({ ok: false, retryable: true, error: '只允许调用 ' + PLOT_COMPASS_SUBMIT_TOOL_NAME })
          }
          try {
            submitted = parsePlotCompassSubmission(call.arguments, {
              scope: 'chat',
              card: ctxData.card,
              playerName: ctxData.playerName,
              maxRoutes
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
            now: now(),
            novelTotalUnits: novelCtx?.blueprint?.units?.length || 0
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
    const normalized = normalizePlotCompassModel(model)
    if (!normalized) throw new Error('剧情罗盘模型配置无效')
    const savedModel = typeof store?.saveModel === 'function'
      ? (normalizePlotCompassModel(await store.saveModel(normalized, gameId)) || normalized)
      : (fallbackModelSelection = normalized)
    if (typeof store?.saveModel !== 'function') {
      const id = str(gameId)
      if (id) onStatus(id)
    }
    return { modelSelection: savedModel, plotCompassModel: savedModel }
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

  async function setGoal({ gameId, text, horizon, enabled } = {}) {
    const id = str(gameId)
    if (!id) throw new Error('请先打开游玩会话')
    const record = await store.readGame(id)
    if (!isPlotCompassEnabled(record)) throw new Error('剧情罗盘已关闭，请先开启')
    const saved = await store.updateGame(id, current => {
      if (!isPlotCompassEnabled(current)) throw new Error('剧情罗盘已关闭，请先开启')
      current.compass = applyPlotCompassGoal(current.compass, { text, horizon, enabled, now: now() })
      return current
    })
    onStatus(id)
    return readPlotCompass(saved?.compass)
  }

  async function setPreferences({ gameId, strength, pace, blindBox, customDirective, autoUpdateInterval, maxRoutes, goal } = {}) {
    const id = str(gameId)
    if (!id) throw new Error('请先打开游玩会话')
    const record = await store.readGame(id)
    if (!isPlotCompassEnabled(record)) throw new Error('剧情罗盘已关闭，请先开启')
    const saved = await store.updateGame(id, current => {
      if (!isPlotCompassEnabled(current)) throw new Error('剧情罗盘已关闭，请先开启')
      current.compass = applyPlotCompassPreferences(current.compass, {
        strength,
        pace,
        blindBox,
        customDirective,
        autoUpdateInterval,
        maxRoutes,
        goal,
        now: now()
      })
      return current
    })
    onStatus(id)
    return readPlotCompass(saved?.compass)
  }

  function goalGuidanceSuffix(compass) {
    const activeGoal = activePlotCompassGoal(compass)
    if (!activeGoal) return ''
    const label = PLOT_COMPASS_GOAL_HORIZON_LABELS[activeGoal.horizon] || '短期'
    return `同时必须严格保持目标导向收束：所有生成或演进的路线均须导向达成玩家设定的${label}目标结果「${activeGoal.text}」。`
  }

  async function autoEvolveAfterCompaction(gameId) {
    try {
      const id = str(gameId)
      if (!id || jobs.has(id)) return null
      const record = await store.readGame(id)
      if (!isPlotCompassEnabled(record)) return null
      const compass = readPlotCompass(record.compass)
      const activeGoal = activePlotCompassGoal(compass)
      const hasPinned = Boolean(compass.pinned.shortTerm || compass.pinned.midTerm || compass.pinned.longTerm)
      if (!hasPinned && !activeGoal) return null
      const latestTurn = await contextReader.latestTurn(id)
      if (latestTurn <= compass.basedOnTurn) return null
      return await generate({
        gameId: id,
        scope: 'all',
        guidance: '本次为上下文归卷后的增量演进：请对照最新剧情勾选已完成节拍/里程碑，延续玩家已点亮路线并补充新分支。' + goalGuidanceSuffix(compass)
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
    const baseGuidance = hasExisting
      ? `本次为每 ${interval} 楼定时自动演进刷新（当前第 ${latestTurn} 轮，距上次推演已过 ${latestTurn - compass.basedOnTurn} 轮）：请对照最新剧情勾选已完成节拍/里程碑，延续玩家已点亮路线并补充新分支。`
      : `本次为每 ${interval} 楼定时自动推演（当前第 ${latestTurn} 轮）：请结合当前剧情、人物卡与世界书暗线，生成今期、中期、长期的多路线剧情发展规划。`
    const guidance = baseGuidance + goalGuidanceSuffix(compass)
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
        let trackGuidance = ''
        const novelCtx = await resolveActiveNovelContext(outcome.compass)
        if (novelCtx && outcome.compass.novelRef?.mode === 'track_arc') {
          const units = novelCtx.blueprint.units || []
          const advancedRef = advanceNovelCursorOnComplete(outcome.compass.novelRef, units.length)
          await store.updateGame(id, current => {
            if (!isPlotCompassEnabled(current)) return undefined
            const c = readPlotCompass(current.compass)
            c.novelRef = advancedRef
            current.compass = c
            return current
          })
          onStatus(id)
          if (
            units.length > 0 &&
            advancedRef.cursorUnit >= units.length - 2 &&
            novelCtx.blueprint.indexedChunks < novelCtx.blueprint.totalChunks &&
            !blueprintJob
          ) {
            await continueNovel({ gameId: id, blueprintId: novelCtx.blueprint.id, wait: true }).catch(() => null)
          }
          trackGuidance = `同时参考小说处于顺轨改编模式，游标已顺延至第 ${advancedRef.cursorUnit + 1} 单元，请自然嫁接当前局势并继续向下推演。`
        }
        await generate({
          gameId: id,
          scope: 'shortTerm',
          guidance: `上一幕点亮的近期路线「${outcome.completedPinnedShortTitle}」全部节拍已在剧情中达成，请紧承最新回合结尾与已点亮的中长期方向，推演下一幕新的今期（2-5轮）多路线节拍。` + trackGuidance + goalGuidanceSuffix(outcome.compass)
        }).catch(() => {})
      } else if (outcome?.pinnedShortLapsed && !jobs.has(id)) {
        let trackGuidance = ''
        const novelCtx = await resolveActiveNovelContext(outcome.compass)
        if (novelCtx && outcome.compass.novelRef?.mode === 'track_arc') {
          trackGuidance = `同时参考小说处于顺轨改编模式（当前游标为第 ${outcome.compass.novelRef.cursorUnit + 1} 单元）：由于局势已发生偏离，请对照最新场面审查当前与后续 2–3 个单元，将新局势因果嫁接到最贴合的后续单元（或跳过已失效单元），并在 plot_compass_submit 的 novelCursorUpdate 中更新 nextCursorUnit 与 graftNote。`
        }
        await generate({
          gameId: id,
          scope: 'shortTerm',
          guidance: `原定近期路线「${outcome.lapsedPinnedShortTitle}」因玩家行动或局势变化已不再成立（${outcome.lapsedPinnedShortReason}），请严格依据最新场面定格与已有中长期基调，重新推演符合当前因果与处境的今期（2-5轮）新分支。` + trackGuidance + goalGuidanceSuffix(outcome.compass)
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

  async function listScriptSources() {
    if (!scriptLibrary?.available || typeof scriptLibrary.listSources !== 'function') {
      return { available: false, sources: [] }
    }
    const sources = await scriptLibrary.listSources()
    return { available: true, sources: Array.isArray(sources) ? sources : [] }
  }

  async function setNovelRef({ gameId, enabled, blueprintId, mode, weight, cursorUnit, resetProgress } = {}) {
    const id = str(gameId)
    if (!id) throw new Error('请先打开游玩会话')
    const record = await store.readGame(id)
    if (!isPlotCompassEnabled(record)) throw new Error('剧情罗盘已关闭，请先开启')

    let targetBlueprint = null
    if (blueprintId !== undefined) {
      const cleanId = str(blueprintId).trim()
      if (cleanId) {
        if (!blueprintStore) throw new Error('当前环境不支持全局小说骨架库')
        targetBlueprint = await blueprintStore.get(cleanId)
        if (!targetBlueprint) throw new Error('全局骨架库中已找不到该参考小说，请刷新列表')
      }
    } else {
      const currentBpId = readPlotCompass(record.compass).novelRef?.blueprintId
      if (currentBpId && blueprintStore) {
        targetBlueprint = await blueprintStore.get(currentBpId)
      }
    }

    const totalUnits = targetBlueprint?.units?.length || 0
    const saved = await store.updateGame(id, current => {
      if (!isPlotCompassEnabled(current)) throw new Error('剧情罗盘已关闭，请先开启')
      current.compass = applyPlotCompassNovelRef(
        current.compass,
        { enabled, blueprintId, mode, weight, cursorUnit, resetProgress },
        { totalUnits, now: now() }
      )
      return current
    })
    onStatus(id)
    return readPlotCompass(saved?.compass)
  }

  async function runBlueprintExtraction({
    gameId,
    model,
    targetId,
    title,
    sourceKind,
    sourcePath,
    sourceHash,
    totalChunks,
    sourceChars,
    pasteChunks,
    batchChunks,
    sampledChunks,
    existingBlueprint,
    startChunk,
    bindToGame,
    controller
  }) {
    let submitted = null
    let submissionError = null
    try {
      const firstOrder = Number(batchChunks[0]?.order ?? startChunk) || 0
      const lastOrder = Number(batchChunks[batchChunks.length - 1]?.order ?? firstOrder) || firstOrder
      const startIndex = existingBlueprint?.units?.length || 0
      const prompt = buildNovelAnalyzePrompt({
        title,
        chunks: batchChunks,
        totalChunks,
        startChunk: firstOrder,
        existingBlueprint,
        sampledChunks
      })

      controller.signal.throwIfAborted()
      await runAgent({
        gameId: str(gameId),
        selection: model,
        temperature: 0.35,
        signal: controller.signal,
        system: NOVEL_BLUEPRINT_ANALYZE_SYSTEM,
        prompt,
        tools: [NOVEL_BLUEPRINT_SUBMIT_TOOL],
        maxToolCalls: 4,
        stopToolsWhen: () => submitted !== null,
        acceptWithoutText: () => submitted !== null,
        onToolCall: async call => {
          if (!call || call.name !== NOVEL_BLUEPRINT_SUBMIT_TOOL_NAME) {
            return JSON.stringify({ ok: false, retryable: true, error: '当前任务只允许调用 ' + NOVEL_BLUEPRINT_SUBMIT_TOOL_NAME })
          }
          try {
            submitted = parseNovelBlueprintSubmission(call.arguments, {
              startIndex,
              minChunkOrder: firstOrder,
              maxChunkOrder: lastOrder
            })
            submissionError = null
            return JSON.stringify({
              ok: true,
              units: submitted.units.length,
              startIndex
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
        throw submissionError || new Error('模型未调用 novel_blueprint_submit 提交有效叙事骨架')
      }

      const nextIndexedChunks = Math.min(totalChunks, firstOrder + batchChunks.length)
      const merged = mergeNovelBlueprintBatch(existingBlueprint, submitted, {
        id: targetId,
        title,
        sourceKind,
        sourcePath,
        sourceHash,
        totalChunks,
        nextIndexedChunks,
        sourceChars,
        pasteChunks,
        now: now()
      })
      const savedBp = await blueprintStore.upsert(merged)

      if (bindToGame) {
        const rec = await store.readGame(gameId).catch(() => null)
        if (isPlotCompassEnabled(rec)) {
          await setNovelRef({ gameId, blueprintId: savedBp.id, enabled: true }).catch(() => {})
        }
      }

      if (blueprintJob?.controller === controller) blueprintJob = null
      setBlueprintTask({
        status: 'done',
        blueprintId: savedBp.id,
        title: savedBp.title,
        progressText: `已拆解 ${savedBp.indexedChunks}/${savedBp.totalChunks} 块（共 ${savedBp.units.length} 个单元）`,
        error: ''
      })
      return savedBp
    } catch (error) {
      if (blueprintJob?.controller === controller) blueprintJob = null
      if (controller.signal.aborted || error?.name === 'AbortError') {
        setBlueprintTask({ status: 'idle', progressText: '', error: '' })
        return null
      }
      setBlueprintTask({
        status: 'failed',
        blueprintId: targetId,
        title,
        progressText: '',
        error: str(error?.message || error) || '小说叙事骨架拆解失败'
      })
      return null
    }
  }

  async function analyzeNovel({
    gameId,
    sourceKind = 'script',
    sourcePath = '',
    title = '',
    text = '',
    force = false,
    wait = false,
    bindToGame = false
  } = {}) {
    const id = str(gameId)
    if (!id) throw new Error('请先打开游玩会话')
    if (!blueprintStore) throw new Error('当前环境未配置全局小说骨架存储')
    if (blueprintJob) throw new Error('正在拆解小说骨架中，请稍候或先取消当前拆书任务')
    const record = await store.readGame(id)
    const model = await resolveModel(id, record)
    if (!model) throw new Error('请先配置可用的剧情罗盘模型（或前台/后台模型）')

    let cleanPath = ''
    let finalTitle = ''
    let sourceHash = ''
    let totalChunks = 1
    let sourceChars = 0
    let pasteChunks
    let batchChunks = []
    let sampledChunks = []

    if (sourceKind === 'script') {
      if (!scriptLibrary?.available) throw new Error('当前宿主版本暂不支持从剧本库顺序读取')
      cleanPath = str(sourcePath).trim()
      if (!cleanPath) throw new Error('请先选择剧本库中的小说')
      const info = await scriptLibrary.getInfo(cleanPath)
      if (!info) throw new Error('剧本库中已找不到该小说，请刷新列表')
      sourceHash = str(info.contentHash)
      totalChunks = Math.max(1, Number(info.chunkCount) || 1)
      sourceChars = Math.max(0, Number(info.sourceChars) || 0)
      finalTitle = str(title).trim() || str(info.title) || cleanPath.split('/').pop() || '参考小说'

      const existingList = await blueprintStore.list()
      const duplicate = existingList.find(item =>
        item.sourceKind === 'script' && item.sourcePath === cleanPath && item.sourceHash === sourceHash
      )
      if (duplicate && !force) {
        if (bindToGame && isPlotCompassEnabled(record)) {
          await setNovelRef({ gameId: id, blueprintId: duplicate.id, enabled: true })
        }
        return {
          status: 'done',
          reused: true,
          blueprint: projectBlueprintForClient(duplicate),
          novelBlueprintTask: projectBlueprintTask()
        }
      }

      const rangeRes = await scriptLibrary.readRange({ path: cleanPath, start: 0, count: DEFAULT_ANALYZE_BATCH_CHUNKS })
      batchChunks = Array.isArray(rangeRes?.chunks) ? rangeRes.chunks : []
      if (batchChunks.length === 0) throw new Error('剧本文件为空，无法拆解')

      if (totalChunks > 24 && typeof scriptLibrary.search === 'function') {
        const sampled = await scriptLibrary.search({ path: cleanPath, query: '', limit: 6 }).catch(() => null)
        const firstIds = new Set(batchChunks.map(c => c.id))
        sampledChunks = (Array.isArray(sampled?.chunks) ? sampled.chunks : []).filter(c => c && !firstIds.has(c.id))
      }

      const targetId = duplicate && force ? duplicate.id : `bp-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const controller = new AbortController()
      const entry = { controller, promise: null }
      blueprintJob = entry
      setBlueprintTask({
        status: 'running',
        blueprintId: targetId,
        title: finalTitle,
        progressText: `正在拆解「${finalTitle}」前 ${batchChunks.length}/${totalChunks} 块…`,
        error: ''
      })

      entry.promise = runBlueprintExtraction({
        gameId: id,
        model,
        targetId,
        title: finalTitle,
        sourceKind: 'script',
        sourcePath: cleanPath,
        sourceHash,
        totalChunks,
        sourceChars,
        batchChunks,
        sampledChunks,
        existingBlueprint: null,
        startChunk: 0,
        bindToGame,
        controller
      }).catch(onError).finally(() => {
        if (blueprintJob === entry) blueprintJob = null
      })

      if (wait === true) {
        await entry.promise
        const saved = await blueprintStore.get(targetId)
        return {
          status: blueprintTaskState.status,
          blueprint: saved ? projectBlueprintForClient(saved) : null,
          novelBlueprintTask: projectBlueprintTask()
        }
      }
      return { status: 'running', blueprintId: targetId, novelBlueprintTask: projectBlueprintTask() }
    }

    if (sourceKind === 'paste') {
      const cleaned = str(text).replace(/\r\n?/g, '\n').trim()
      if (cleaned.length < MIN_PASTE_TEXT_CHARS) {
        throw new Error(`粘贴的小说片段至少需要 ${MIN_PASTE_TEXT_CHARS} 字`)
      }
      if (cleaned.length > MAX_PASTE_TEXT_CHARS) {
        throw new Error(`单次粘贴片段最多 ${MAX_PASTE_TEXT_CHARS} 字，更长小说请导入剧本库后拆书`)
      }
      pasteChunks = splitPasteTextToChunks(cleaned)
      if (pasteChunks.length === 0) throw new Error('未能切分出有效文本片段')
      sourceHash = computeTextHash(cleaned)
      totalChunks = pasteChunks.length
      sourceChars = cleaned.length
      finalTitle = str(title).trim() || '粘贴小说片段'

      const existingList = await blueprintStore.list()
      const duplicate = existingList.find(item => item.sourceKind === 'paste' && item.sourceHash === sourceHash)
      if (duplicate && !force) {
        if (bindToGame && isPlotCompassEnabled(record)) {
          await setNovelRef({ gameId: id, blueprintId: duplicate.id, enabled: true })
        }
        return {
          status: 'done',
          reused: true,
          blueprint: projectBlueprintForClient(duplicate),
          novelBlueprintTask: projectBlueprintTask()
        }
      }

      batchChunks = pasteChunks.slice(0, DEFAULT_ANALYZE_BATCH_CHUNKS)
      const targetId = duplicate && force ? duplicate.id : `bp-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const controller = new AbortController()
      const entry = { controller, promise: null }
      blueprintJob = entry
      setBlueprintTask({
        status: 'running',
        blueprintId: targetId,
        title: finalTitle,
        progressText: `正在拆解「${finalTitle}」前 ${batchChunks.length}/${totalChunks} 块…`,
        error: ''
      })

      entry.promise = runBlueprintExtraction({
        gameId: id,
        model,
        targetId,
        title: finalTitle,
        sourceKind: 'paste',
        sourcePath: '',
        sourceHash,
        totalChunks,
        sourceChars,
        pasteChunks,
        batchChunks,
        sampledChunks: [],
        existingBlueprint: null,
        startChunk: 0,
        bindToGame,
        controller
      }).catch(onError).finally(() => {
        if (blueprintJob === entry) blueprintJob = null
      })

      if (wait === true) {
        await entry.promise
        const saved = await blueprintStore.get(targetId)
        return {
          status: blueprintTaskState.status,
          blueprint: saved ? projectBlueprintForClient(saved) : null,
          novelBlueprintTask: projectBlueprintTask()
        }
      }
      return { status: 'running', blueprintId: targetId, novelBlueprintTask: projectBlueprintTask() }
    }

    throw new Error('无效的小说来源类型：' + str(sourceKind))
  }

  async function continueNovel({ gameId, blueprintId, batchChunks: requestedCount = DEFAULT_ANALYZE_BATCH_CHUNKS, wait = false } = {}) {
    const id = str(gameId)
    if (!id) throw new Error('请先打开游玩会话')
    if (!blueprintStore) throw new Error('当前环境未配置全局小说骨架存储')
    const bpId = str(blueprintId).trim()
    if (!bpId) throw new Error('缺少参考小说骨架 ID')
    const existing = await blueprintStore.get(bpId)
    if (!existing) throw new Error('未找到指定的参考小说骨架')
    if (existing.indexedChunks >= existing.totalChunks) {
      return {
        status: 'done',
        alreadyComplete: true,
        blueprint: projectBlueprintForClient(existing),
        novelBlueprintTask: projectBlueprintTask()
      }
    }
    if (blueprintJob) throw new Error('正在拆解小说骨架中，请稍候或先取消当前拆书任务')
    const record = await store.readGame(id)
    const model = await resolveModel(id, record)
    if (!model) throw new Error('请先配置可用的剧情罗盘模型（或前台/后台模型）')

    const count = Math.max(1, Math.min(20, Math.trunc(Number(requestedCount) || DEFAULT_ANALYZE_BATCH_CHUNKS)))
    const start = Math.max(0, existing.indexedChunks)
    let nextBatch = []
    let actualTotal = existing.totalChunks
    let actualChars = existing.sourceChars

    if (existing.sourceKind === 'script') {
      if (!scriptLibrary?.available) throw new Error('当前宿主版本暂不支持从剧本库顺序读取')
      const rangeRes = await scriptLibrary.readRange({ path: existing.sourcePath, start, count })
      if (!rangeRes) throw new Error('参考小说源文件已从剧本库移除')
      nextBatch = Array.isArray(rangeRes.chunks) ? rangeRes.chunks : []
      actualTotal = Math.max(1, Number(rangeRes.totalChunks) || actualTotal)
      actualChars = Math.max(0, Number(rangeRes.sourceChars) || actualChars)
    } else {
      const list = Array.isArray(existing.pasteChunks) ? existing.pasteChunks : []
      nextBatch = list.slice(start, start + count)
      actualTotal = Math.max(1, list.length || actualTotal)
    }

    if (nextBatch.length === 0) {
      const finished = await blueprintStore.upsert({ ...existing, indexedChunks: actualTotal, totalChunks: actualTotal, updatedAt: now() })
      onGlobalChange()
      return {
        status: 'done',
        alreadyComplete: true,
        blueprint: projectBlueprintForClient(finished),
        novelBlueprintTask: projectBlueprintTask()
      }
    }

    const controller = new AbortController()
    const entry = { controller, promise: null }
    blueprintJob = entry
    setBlueprintTask({
      status: 'running',
      blueprintId: existing.id,
      title: existing.title,
      progressText: `正在续拆「${existing.title}」第 ${start + 1}–${Math.min(actualTotal, start + nextBatch.length)}/${actualTotal} 块…`,
      error: ''
    })

    entry.promise = runBlueprintExtraction({
      gameId: id,
      model,
      targetId: existing.id,
      title: existing.title,
      sourceKind: existing.sourceKind,
      sourcePath: existing.sourcePath,
      sourceHash: existing.sourceHash,
      totalChunks: actualTotal,
      sourceChars: actualChars,
      pasteChunks: existing.pasteChunks,
      batchChunks: nextBatch,
      sampledChunks: [],
      existingBlueprint: existing,
      startChunk: start,
      bindToGame: false,
      controller
    }).catch(onError).finally(() => {
      if (blueprintJob === entry) blueprintJob = null
    })

    if (wait === true) {
      await entry.promise
      const saved = await blueprintStore.get(existing.id)
      return {
        status: blueprintTaskState.status,
        blueprint: saved ? projectBlueprintForClient(saved) : null,
        novelBlueprintTask: projectBlueprintTask()
      }
    }
    return { status: 'running', blueprintId: existing.id, novelBlueprintTask: projectBlueprintTask() }
  }

  async function cancelNovel() {
    if (blueprintJob) {
      blueprintJob.controller.abort(new Error('玩家已取消小说拆书'))
      blueprintJob = null
    }
    setBlueprintTask({ status: 'idle', progressText: '', error: '' })
    return { status: 'idle', novelBlueprintTask: projectBlueprintTask() }
  }

  async function deleteNovel({ blueprintId } = {}) {
    const bpId = str(blueprintId).trim()
    if (!bpId) throw new Error('缺少参考小说骨架 ID')
    if (!blueprintStore) throw new Error('当前环境未配置全局小说骨架存储')
    if (blueprintJob && blueprintTaskState.blueprintId === bpId) {
      await cancelNovel()
    }
    const removed = await blueprintStore.remove(bpId)
    if (removed) onGlobalChange()
    return { removed }
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

  function viewState(record, gameId, latestTurn = 0, modelSelection, globalExtras = {}) {
    const rawList = Array.isArray(globalExtras?.novelBlueprints) ? globalExtras.novelBlueprints : []
    return {
      enabled: isPlotCompassEnabled(record),
      modelSelection: normalizePlotCompassModel(modelSelection)
        || normalizePlotCompassModel(record?.modelSelection)
        || normalizePlotCompassModel(fallbackModelSelection)
        || 'background',
      plotCompass: readPlotCompass(record?.compass),
      plotCompassTask: projectTask(record, gameId),
      latestAssistantTurn: Math.max(0, Number(latestTurn) || 0),
      novelBlueprints: rawList.map(projectBlueprintForClient).filter(Boolean),
      novelBlueprintTask: projectBlueprintTask(),
      scriptLibraryAvailable: Boolean(scriptLibrary?.available)
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
    setGoal,
    setPreferences,
    setNovelRef,
    listScriptSources,
    analyzeNovel,
    continueNovel,
    cancelNovel,
    deleteNovel,
    isAutoUpdateDue,
    autoUpdateOnTurn,
    syncTurnProgress,
    onTurnSettled,
    autoEvolveAfterCompaction,
    wait: gameId => jobs.get(str(gameId))?.promise || null,
    waitNovel: () => blueprintJob?.promise || null,
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
