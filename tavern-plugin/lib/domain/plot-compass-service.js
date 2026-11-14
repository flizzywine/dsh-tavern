import { scriptForState } from './script-layout.js'
import {
  PLOT_COMPASS_PROGRESS_SYSTEM,
  PLOT_COMPASS_SCOPES,
  PLOT_COMPASS_SUBMIT_TOOL,
  PLOT_COMPASS_SUBMIT_TOOL_NAME,
  applyPlotCompassAutoProgress,
  applyPlotCompassCustomArchetypes,
  applyPlotCompassPin,
  applyPlotCompassStepToggle,
  buildPlotCompassMaterial,
  buildPlotCompassProgressPrompt,
  collectPendingCompassSteps,
  mergePlotCompassUpdate,
  parsePlotCompassProgressResponse,
  parsePlotCompassSubmission,
  readPlotCompass,
  setPlotCompassPin
} from './plot-compass.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function isPlayableChat(chat) {
  return Boolean(chat && ['story', 'script'].includes(chat.mode || 'story'))
}

function latestStoryTurnOf(chat) {
  let latest = 0
  for (const message of chat?.messages || []) {
    if (message?.role === 'assistant') latest = Math.max(latest, Number(message.turn) || 0)
  }
  return latest
}

export function createPlotCompassService({
  store,
  worldBooks,
  scripts,
  prompt,
  selection,
  runAgent,
  callModel = null,
  ensureSession = async () => {},
  onStatus = () => {},
  onError = error => console.error('dsh-tavern: 剧情罗盘后台任务异常', error),
  now = Date.now
}) {
  const jobs = new Map()
  const progressJobs = new Set()

  function projectTask(chat) {
    const raw = chat?.plotCompassTask && typeof chat.plotCompassTask === 'object'
      ? chat.plotCompassTask
      : { status: 'idle', scope: 'all', error: '' }
    const active = jobs.has(str(chat?.id))
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

  async function requirePlayChat(sessionId) {
    const chat = await store.chatForSession(str(sessionId))
    if (!isPlayableChat(chat)) throw new Error('请先打开游玩会话')
    return chat
  }

  async function setTaskState(chatId, sessionId, patch) {
    await store.updateChat(chatId, draft => {
      draft.plotCompassTask = {
        status: 'idle',
        scope: 'all',
        error: '',
        ...(draft.plotCompassTask || {}),
        ...patch,
        updatedAt: now()
      }
      return draft
    }, { source: 'plot-compass.task' })
    onStatus(str(sessionId))
  }

  async function executeGeneration({ chatId, sessionId, expectedBranchId, scope, guidance, model, controller }) {
    let submitted = null
    let submissionError = null
    let runResult = null
    try {
      await ensureSession(sessionId)
      const freshChat = await store.readChat(chatId)
      if (!isPlayableChat(freshChat)) throw new Error('游玩会话不存在或已关闭')
      const cardPath = str(freshChat.cardPath || freshChat.cardId)
      const card = await store.readCard(cardPath, freshChat)
      if (!card) throw new Error('人物卡不存在：' + cardPath)

      let worldbookEntries = []
      let constantWorldbookText = ''
      try {
        if (worldBooks?.bound) {
          const bound = await worldBooks.bound(cardPath, card, freshChat)
          worldbookEntries = Array.isArray(bound?.view?.entries) ? bound.view.entries : []
        }
        if (worldBooks?.constantContext) {
          constantWorldbookText = str(await worldBooks.constantContext(freshChat, card))
        }
      } catch {}

      let scriptWindow = null
      if ((freshChat.mode || 'story') === 'script' && scripts && typeof store.readScript === 'function') {
        try {
          const rawScript = await store.readScript(cardPath)
          const script = scriptForState(rawScript, freshChat.scriptState)
          if (script && Array.isArray(script.chunks) && script.chunks.length > 0) {
            scriptWindow = scripts.inspect({ script, state: freshChat.scriptState, request: { kind: 'choice' } })
          }
        } catch {}
      }

      const basedOnTurn = latestStoryTurnOf(freshChat)
      const material = buildPlotCompassMaterial({
        chat: freshChat,
        card,
        worldbookEntries,
        constantWorldbookText,
        scriptWindow,
        scope,
        guidance
      })

      runResult = await runAgent({
        task: 'plot-compass',
        persistent: false,
        ownPrefix: true,
        sessionId: str(sessionId),
        chatId: str(chatId),
        turn: basedOnTurn,
        selection: model,
        temperature: 0.85,
        signal: controller.signal,
        backgroundTasks: { variables: false, posture: false, characterDesign: false },
        system: prompt('plot-compass'),
        taskText: material,
        messages: [],
        tools: [PLOT_COMPASS_SUBMIT_TOOL],
        maxToolCalls: 4,
        stopToolsWhen: () => submitted !== null,
        acceptWithoutText: () => submitted !== null,
        onToolCall: async call => {
          if (!call || call.name !== PLOT_COMPASS_SUBMIT_TOOL_NAME) {
            return JSON.stringify({ ok: false, retryable: true, error: '当前任务只允许调用 ' + PLOT_COMPASS_SUBMIT_TOOL_NAME })
          }
          try {
            submitted = parsePlotCompassSubmission(call.arguments, { scope, card, chat: freshChat })
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
      await store.updateChat(chatId, current => {
        if (!isPlayableChat(current)) return undefined
        if (expectedBranchId && str(current.timeline?.branchId) && str(current.timeline?.branchId) !== expectedBranchId) {
          throw new Error('会话分支已变更，本次推演结果未写入')
        }
        current.plotCompass = mergePlotCompassUpdate(current.plotCompass, submitted, {
          scope,
          turn: latestStoryTurnOf(current) || basedOnTurn,
          now: now()
        })
        current.plotCompassTask = {
          status: 'done',
          scope,
          error: '',
          updatedAt: now(),
          ...(traceSessionId ? { traceSessionId } : {})
        }
        current.updatedAt = now()
        return current
      }, { source: 'plot-compass.commit' })
      onStatus(str(sessionId))
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        await setTaskState(chatId, sessionId, { status: 'idle', scope, error: '' }).catch(onError)
        return
      }
      await setTaskState(chatId, sessionId, {
        status: 'failed',
        scope,
        error: str(error?.message || error) || '剧情罗盘推演失败',
        ...(runResult?.traceSessionId ? { traceSessionId: str(runResult.traceSessionId) } : {})
      }).catch(onError)
    }
  }

  async function generate({ sessionId, scope = 'all', guidance = '', wait = false } = {}) {
    const normalizedScope = PLOT_COMPASS_SCOPES.includes(scope) ? scope : 'all'
    const chat = await requirePlayChat(sessionId)
    if (jobs.has(chat.id)) throw new Error('剧情罗盘正在推演中，请稍候或先取消当前推演')
    const model = selection(chat)
    if (!model) throw new Error('请先配置可用的后台模型')

    const controller = new AbortController()
    const expectedBranchId = str(chat.timeline?.branchId)
    const entry = { controller, promise: null }
    jobs.set(chat.id, entry)
    try {
      await setTaskState(chat.id, sessionId, { status: 'running', scope: normalizedScope, error: '' })
    } catch (err) {
      jobs.delete(chat.id)
      throw err
    }

    const promise = executeGeneration({
      chatId: chat.id,
      sessionId: str(sessionId),
      expectedBranchId,
      scope: normalizedScope,
      guidance: str(guidance).trim().slice(0, 800),
      model,
      controller
    }).catch(onError).finally(() => {
      if (jobs.get(chat.id) === entry) jobs.delete(chat.id)
    })
    entry.promise = promise

    if (wait === true) {
      await promise
      const updated = await store.readChat(chat.id)
      return {
        status: updated?.plotCompassTask?.status || 'done',
        scope: normalizedScope,
        plotCompass: readPlotCompass(updated?.plotCompass),
        plotCompassTask: projectTask(updated)
      }
    }
    return { status: 'running', scope: normalizedScope }
  }

  async function cancel({ sessionId } = {}) {
    const chat = await requirePlayChat(sessionId)
    const active = jobs.get(chat.id)
    if (active) {
      active.controller.abort(new Error('玩家已取消剧情罗盘推演'))
      jobs.delete(chat.id)
    }
    await setTaskState(chat.id, sessionId, { status: 'idle', error: '' })
    return { status: 'idle' }
  }

  async function pin({ sessionId, horizon, routeId, exact = false } = {}) {
    const chat = await requirePlayChat(sessionId)
    const saved = await store.updateChat(chat.id, current => {
      requirePlayChatSync(current)
      current.plotCompass = exact
        ? setPlotCompassPin(current.plotCompass, { horizon, routeId, now: now() })
        : applyPlotCompassPin(current.plotCompass, { horizon, routeId, now: now() })
      current.updatedAt = now()
      return current
    }, { source: 'plot-compass.pin' })
    onStatus(str(sessionId))
    return readPlotCompass(saved?.plotCompass)
  }

  async function toggleStep({ sessionId, horizon, routeId, stepIndex } = {}) {
    const chat = await requirePlayChat(sessionId)
    const saved = await store.updateChat(chat.id, current => {
      requirePlayChatSync(current)
      current.plotCompass = applyPlotCompassStepToggle(current.plotCompass, { horizon, routeId, stepIndex, now: now() })
      current.updatedAt = now()
      return current
    }, { source: 'plot-compass.step' })
    onStatus(str(sessionId))
    return readPlotCompass(saved?.plotCompass)
  }

  async function setArchetypes({ sessionId, archetypes } = {}) {
    const chat = await requirePlayChat(sessionId)
    const saved = await store.updateChat(chat.id, current => {
      requirePlayChatSync(current)
      current.plotCompass = applyPlotCompassCustomArchetypes(current.plotCompass, archetypes, { now: now() })
      current.updatedAt = now()
      return current
    }, { source: 'plot-compass.archetypes' })
    onStatus(str(sessionId))
    return readPlotCompass(saved?.plotCompass)
  }

  function requirePlayChatSync(current) {
    if (!isPlayableChat(current)) throw new Error('请先打开游玩会话')
  }

  // Trigger silent incremental evolution (e.g. after volume compaction when a route is pinned), never throwing.
  async function autoEvolveAfterCompaction(sessionId) {
    try {
      const chat = await store.chatForSession(str(sessionId))
      if (!isPlayableChat(chat) || jobs.has(chat.id)) return null
      const compass = readPlotCompass(chat.plotCompass)
      const hasPinned = Boolean(compass.pinned.shortTerm || compass.pinned.midTerm || compass.pinned.longTerm)
      if (!hasPinned) return null
      const latestTurn = latestStoryTurnOf(chat)
      if (latestTurn <= compass.basedOnTurn) return null
      return await generate({
        sessionId,
        scope: 'all',
        guidance: '本次为上下文归卷后的增量演进：请对照最新剧情勾选已完成节拍/里程碑，延续玩家已点亮路线并补充新分支。'
      })
    } catch {
      return null
    }
  }

  async function hasTrackableSteps(chatOrSlice, explicitTurn, sessionId) {
    if (typeof callModel !== 'function') return false
    let target = chatOrSlice
    if ((!target || target.plotCompass === undefined) && sessionId) {
      target = await store.chatForSession(str(sessionId))
    }
    if (!isPlayableChat(target)) return false
    const compass = readPlotCompass(target.plotCompass)
    const pending = collectPendingCompassSteps(compass)
    if (pending.length === 0) return false
    const latestTurn = Math.max(Number(explicitTurn) || 0, latestStoryTurnOf(target))
    return latestTurn > Math.max(compass.basedOnTurn, compass.lastCheckedTurn || 0)
  }

  /**
   * Automatically verify and check off fulfilled beats & milestones after each settled turn.
   * When a pinned short-term route finishes all its beats (e.g. 3/3), seamlessly roll out the next short-term routes!
   */
  async function syncTurnProgress({ sessionId, chat: hintChat, turn: hintTurn } = {}) {
    if (typeof callModel !== 'function') return null
    const targetSessionId = str(sessionId || hintChat?.sessionId)
    if (!targetSessionId) return null
    const baseChat = hintChat?.id ? hintChat : await store.chatForSession(targetSessionId)
    if (!isPlayableChat(baseChat) || progressJobs.has(baseChat.id) || jobs.has(baseChat.id)) return null

    const freshChat = await store.readChat(baseChat.id)
    if (!isPlayableChat(freshChat)) return null
    const compass = readPlotCompass(freshChat.plotCompass)
    const pending = collectPendingCompassSteps(compass)
    const latestTurn = Math.max(Number(hintTurn) || 0, latestStoryTurnOf(freshChat))
    const checkedFloor = Math.max(compass.basedOnTurn, compass.lastCheckedTurn || 0)
    if (pending.length === 0 || latestTurn <= checkedFloor) return null
    if (!selection(freshChat)) return null

    progressJobs.add(freshChat.id)
    try {
      const promptText = buildPlotCompassProgressPrompt(freshChat, pending, { fromTurn: checkedFloor + 1 })
      const rawReply = await callModel({
        sessionId: targetSessionId,
        background: true,
        temperature: 0.1,
        maxTokens: 512,
        system: PLOT_COMPASS_PROGRESS_SYSTEM,
        messages: [{ role: 'user', content: promptText }]
      })
      const outputText = typeof rawReply === 'string' ? rawReply : str(rawReply?.output ?? rawReply?.text)
      const completedKeys = parsePlotCompassProgressResponse(outputText, pending.map(item => item.key))

      let outcome = null
      await store.updateChat(freshChat.id, current => {
        if (!isPlayableChat(current)) return undefined
        outcome = applyPlotCompassAutoProgress(current.plotCompass, completedKeys, { turn: latestTurn, now: now() })
        current.plotCompass = outcome.compass
        if (outcome.newlyCompletedCount > 0) current.updatedAt = now()
        return current
      }, { source: 'plot-compass.auto-progress' })

      if (outcome?.newlyCompletedCount > 0) {
        onStatus(targetSessionId)
      }
      if (outcome?.pinnedShortCompleted && !jobs.has(freshChat.id)) {
        await generate({
          sessionId: targetSessionId,
          scope: 'shortTerm',
          guidance: `上一幕点亮的近期路线「${outcome.completedPinnedShortTitle}」全部节拍已在剧情中达成，请紧承最新回合结尾与已点亮的中长期方向，推演下一幕新的今期（2-5轮）多路线节拍。`
        }).catch(() => {})
      }
      return outcome
    } catch (err) {
      onError(err)
      return null
    } finally {
      progressJobs.delete(freshChat.id)
    }
  }

  return Object.freeze({
    projectTask,
    generate,
    cancel,
    pin,
    toggleStep,
    setArchetypes,
    hasTrackableSteps,
    syncTurnProgress,
    autoEvolveAfterCompaction,
    wait: chatId => jobs.get(str(chatId))?.promise || null
  })
}
