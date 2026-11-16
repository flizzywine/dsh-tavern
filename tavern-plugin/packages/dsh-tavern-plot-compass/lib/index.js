import { readFileSync } from 'node:fs'
import {
  plotCompassBodyText,
  plotCompassCandidateText,
  plotCompassCompactionNote,
  plotCompassWorldbookScanText,
  readPlotCompass
} from './plot-compass.js'
import {
  createPlotCompassService,
  extractSectionsFallback,
  historyToMessages,
  latestTurnFromHistory,
  normalizeGameRecord,
  normalizePlotCompassModel
} from './plot-compass-service.js'

export const name = 'dsh-tavern-plot-compass'
export const inject = ['tavern']
export const PLUGIN_VERSION = '1.0.0'

const DEFAULT_PROMPT_URL = new URL('../prompts/plot-compass.md', import.meta.url)

function loadDefaultPrompt() {
  try {
    return readFileSync(DEFAULT_PROMPT_URL, 'utf8')
  } catch {
    return '<plot_compass_planner>\nYou are the Plot Compass & Narrative Architect. Call `plot_compass_submit` with shortTerm, midTerm, and longTerm routes.\n</plot_compass_planner>'
  }
}

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function normalizeGlobalDefaults(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const interval = Number.isSafeInteger(Number(src.autoUpdateInterval))
    ? Math.max(0, Math.min(100, Number(src.autoUpdateInterval)))
    : 0
  return {
    version: 1,
    enabled: typeof src.enabled === 'boolean' ? src.enabled : false,
    autoUpdateInterval: interval,
    modelSelection: normalizePlotCompassModel(src.modelSelection) || 'background'
  }
}

export function apply(ctx, options = {}) {
  const tavern = ctx?.tavern
  if (!tavern || typeof tavern !== 'object') return

  let runtimeLlm = options?.llm || null
  if (!runtimeLlm && typeof ctx?.inject === 'function') {
    try {
      ctx.inject(['llm'], scoped => {
        runtimeLlm = scoped?.llm || null
        return () => { runtimeLlm = null }
      })
    } catch {}
  }

  const plannerPrompt = typeof options?.prompt === 'string' ? options.prompt : loadDefaultPrompt()
  const gameLocks = new Map()
  const gameCache = new Map()
  let globalCache = null
  let syncingGameSettings = false

  function serializeGame(gameId, work) {
    const id = str(gameId)
    const run = (gameLocks.get(id) || Promise.resolve()).then(work, work)
    gameLocks.set(id, run.catch(() => {}))
    return run
  }

  async function readDefaults() {
    if (globalCache) return globalCache
    let raw = null
    try {
      if (typeof tavern.readPluginData === 'function') raw = await tavern.readPluginData()
    } catch {
      raw = null
    }
    const payload = raw && typeof raw === 'object' && raw.data !== undefined ? raw.data : raw
    globalCache = normalizeGlobalDefaults(payload)
    return globalCache
  }

  async function saveDefaults(patch = {}) {
    const prev = await readDefaults()
    const next = normalizeGlobalDefaults({ ...prev, ...patch })
    globalCache = next
    try {
      if (typeof tavern.savePluginData === 'function') await tavern.savePluginData({ data: next })
    } catch {}
    return next
  }

  async function readGame(gameId) {
    const id = str(gameId)
    if (!id) return normalizeGameRecord(null, await readDefaults())
    if (gameCache.has(id)) return structuredClone(gameCache.get(id))
    const defaults = await readDefaults()
    let raw = null
    try {
      if (typeof tavern.readGameData === 'function') raw = await tavern.readGameData({ gameId: id })
    } catch {
      raw = null
    }
    const payload = raw && typeof raw === 'object' && raw.data !== undefined ? raw.data : raw
    let record = normalizeGameRecord(payload, defaults)
    if (!payload && typeof tavern.getGameSettings === 'function') {
      try {
        const gs = await tavern.getGameSettings({ gameId: id })
        if (gs && typeof gs === 'object') {
          if (typeof gs.enabled === 'boolean') record.enabled = gs.enabled
          if (Number.isSafeInteger(Number(gs.autoUpdateInterval))) {
            record.compass.autoUpdateInterval = Math.max(0, Math.min(100, Number(gs.autoUpdateInterval)))
          }
        }
      } catch {}
    }
    gameCache.set(id, record)
    return structuredClone(record)
  }

  async function updateGame(gameId, mutator) {
    const id = str(gameId)
    return serializeGame(id, async () => {
      const defaults = await readDefaults()
      gameCache.delete(id)
      const current = await readGame(id)
      const draft = structuredClone(current)
      const mutated = await mutator(draft)
      if (mutated === undefined) return current
      const next = normalizeGameRecord(mutated, defaults)
      gameCache.set(id, next)
      if (typeof tavern.saveGameData === 'function') {
        await tavern.saveGameData({ gameId: id, data: next })
      }
      return structuredClone(next)
    })
  }

  async function latestTurnOf(gameId) {
    try {
      const state = await tavern.getTurnState?.({ gameId })
      return Math.max(0, Number(state?.turn) || 0)
    } catch {
      return 0
    }
  }

  async function publishCompassState(gameId) {
    const id = str(gameId)
    if (!id || typeof tavern.publishState !== 'function') return
    try {
      const [record, turn] = await Promise.all([readGame(id), latestTurnOf(id)])
      await tavern.publishState({
        gameId: id,
        name: 'compass',
        data: service.viewState(record, id, turn)
      })
    } catch {}
  }

  async function resolveModel(gameId, record) {
    const spec = normalizePlotCompassModel(record?.modelSelection) || 'background'
    if (typeof spec === 'object') return spec
    if (spec === 'foreground' && typeof tavern.foregroundModel === 'function') {
      try {
        const fg = await tavern.foregroundModel({ gameId })
        if (fg?.provider && fg?.model) return fg
      } catch {}
    }
    if (typeof tavern.backgroundModel === 'function') {
      try {
        const bg = await tavern.backgroundModel({ gameId })
        if (bg?.provider && bg?.model) return bg
      } catch {}
    }
    return null
  }

  const contextReader = {
    latestTurn: latestTurnOf,
    async recentMessages(gameId, count = 6) {
      const turn = await latestTurnOf(gameId)
      if (turn <= 0) return []
      const from = Math.max(1, turn - Math.max(1, count) + 1)
      const [turns, turnSnap] = await Promise.all([
        tavern.getHistory?.({ gameId, from, to: turn }).catch(() => []) ?? [],
        tavern.getTurn?.({ gameId, turn }).catch(() => null) ?? null
      ])
      return historyToMessages(turns, turnSnap)
    },
    async load(gameId) {
      const turn = await latestTurnOf(gameId)
      const from = Math.max(1, turn - 7)
      const [card, playerName, turns, turnSnap, reqContext, cardContext, playMaterial] = await Promise.all([
        tavern.getCard?.({ gameId }).catch(() => null),
        tavern.getPlayerName?.({ gameId }).catch(() => '你'),
        turn > 0 ? tavern.getHistory?.({ gameId, from, to: turn }).catch(() => []) : [],
        turn > 0 ? tavern.getTurn?.({ gameId, turn }).catch(() => null) : null,
        turn > 0 ? tavern.getRequestContext?.({ gameId, turn }).catch(() => null) : null,
        turn > 0 ? tavern.getCardContext?.({ gameId, turn }).catch(() => null) : null,
        typeof tavern.getPlayMaterial === 'function' ? tavern.getPlayMaterial({ gameId }).catch(() => null) : null
      ])
      const messages = historyToMessages(turns, turnSnap)
      const fallbackSections = extractSectionsFallback(reqContext)
      const loreList = Array.isArray(cardContext?.lore) ? cardContext.lore : []
      const worldbookEntries = Array.isArray(playMaterial?.worldbookEntries)
        ? playMaterial.worldbookEntries
        : loreList.map(entry => ({
            title: entry.title,
            keys: entry.keys || [],
            constant: entry.constant === true,
            content: entry.content
          }))
      const constantWorldbookText = typeof playMaterial?.constantWorldbookText === 'string'
        ? playMaterial.constantWorldbookText
        : loreList.filter(entry => entry?.constant === true).map(entry => `[${entry.title || '设定'}]\n${entry.content}`).join('\n\n')
      const posture = typeof playMaterial?.posture === 'string' ? playMaterial.posture : fallbackSections.posture
      const guides = Array.isArray(playMaterial?.guides) ? playMaterial.guides : fallbackSections.guides
      const scriptWindow = playMaterial?.scriptWindow || (fallbackSections.scriptText
        ? { cursor: 0, total: 1, chunks: [{ id: 'current', text: fallbackSections.scriptText }] }
        : null)

      return {
        card: card || { name: '角色' },
        playerName: str(playerName).trim() || '你',
        messages,
        variables: turnSnap?.variables || null,
        posture,
        ledger: playMaterial?.ledger || null,
        guides,
        worldbookEntries,
        constantWorldbookText,
        activatedWorldbookTitles: Array.isArray(playMaterial?.activatedWorldbookTitles) ? playMaterial.activatedWorldbookTitles : [],
        scriptWindow,
        basedOnTurn: latestTurnFromHistory(turns, { turn })
      }
    }
  }

  async function runAgent({ gameId, selection, temperature, signal, system, prompt, tools, maxToolCalls, stopToolsWhen, acceptWithoutText, onToolCall }) {
    if (typeof tavern.runTask !== 'function') {
      throw new Error('当前宿主不支持插件后台任务 runTask')
    }
    const wrappedTools = (Array.isArray(tools) ? tools : []).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: async args => {
        if (typeof onToolCall === 'function') {
          return await onToolCall({ name: tool.name, arguments: args })
        }
        return JSON.stringify({ ok: true })
      }
    }))
    return await tavern.runTask({
      gameId,
      prompt,
      system,
      selection,
      temperature,
      maxToolCalls,
      stopToolsWhen,
      acceptWithoutText,
      tools: wrappedTools,
      signal
    })
  }

  async function callModel({ gameId, selection, temperature = 0.1, maxTokens = 512, system, messages, signal }) {
    if (runtimeLlm && typeof runtimeLlm.prepareCall === 'function') {
      const cfg = { provider: selection.provider, model: selection.model }
      if (selection.reasoningEffort) cfg.reasoningEffort = selection.reasoningEffort
      if (typeof temperature === 'number' && selection.provider !== 'openai-codex') cfg.temperature = temperature
      if (typeof maxTokens === 'number') cfg.maxTokens = maxTokens
      const prepared = await runtimeLlm.prepareCall(cfg, signal)
      const formattedMessages = (Array.isArray(messages) ? messages : []).map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content
      }))
      const optionsObj = { ...prepared.config, system, messages: formattedMessages, ...(signal ? { signal } : {}) }
      let text = ''
      for await (const chunk of prepared.stream(optionsObj)) {
        signal?.throwIfAborted()
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        else if (chunk?.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
          throw new Error(chunk.reason?.failure?.message || '模型调用失败')
        }
      }
      return text.trim()
    }
    if (runtimeLlm && typeof runtimeLlm.stream === 'function') {
      const formattedMessages = (Array.isArray(messages) ? messages : []).map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content
      }))
      const streamed = await runtimeLlm.stream({
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
        system,
        temperature,
        maxTokens,
        messages: formattedMessages
      })
      if (typeof streamed === 'string') return streamed.trim()
      let out = ''
      if (streamed && typeof streamed[Symbol.asyncIterator] === 'function') {
        for await (const chunk of streamed) {
          if (typeof chunk === 'string') out += chunk
          else if (typeof chunk?.text === 'string') out += chunk.text
          else if (typeof chunk?.delta === 'string') out += chunk.delta
        }
      } else if (typeof streamed?.text === 'string') {
        out = streamed.text
      }
      return out.trim()
    }
    if (typeof tavern.runTask === 'function') {
      const userPrompt = (Array.isArray(messages) ? messages : []).map(m => str(m.content)).join('\n\n')
      const res = await tavern.runTask({ gameId, system, prompt: userPrompt, selection, temperature, signal })
      return str(res?.text).trim()
    }
    throw new Error('没有可用的语言模型服务')
  }

  const service = createPlotCompassService({
    store: { readGame, updateGame },
    contextReader,
    promptText: () => plannerPrompt,
    resolveModel,
    runAgent,
    callModel,
    onStatus: gameId => { void publishCompassState(gameId) }
  })

  // ── 提示词与世界书扩展点 ──────────────────────────────────────────
  if (typeof tavern.turnSection === 'function') {
    tavern.turnSection({
      name: 'plot-compass',
      position: 'after',
      target: 'story',
      async text({ gameId } = {}) {
        if (!gameId) return ''
        const record = await readGame(gameId)
        if (!record.enabled) return ''
        return plotCompassBodyText(record.compass)
      }
    })
  }

  if (typeof tavern.candidateSection === 'function') {
    tavern.candidateSection({
      name: 'plot-compass',
      async text({ gameId } = {}) {
        if (!gameId) return ''
        const record = await readGame(gameId)
        if (!record.enabled) return ''
        return plotCompassCandidateText(record.compass)
      }
    })
  }

  if (typeof tavern.compactionSection === 'function') {
    tavern.compactionSection({
      name: 'plot-compass',
      async text({ gameId } = {}) {
        if (!gameId) return ''
        const record = await readGame(gameId)
        if (!record.enabled) return ''
        return plotCompassCompactionNote(record)
      }
    })
  }

  if (typeof tavern.worldbookScanText === 'function') {
    tavern.worldbookScanText({
      name: 'plot-compass',
      async text({ gameId } = {}) {
        if (!gameId) return ''
        const record = await readGame(gameId)
        if (!record.enabled) return ''
        return plotCompassWorldbookScanText(record)
      }
    })
  }

  // ── 回合结算、压缩与生命周期监听 ───────────────────────────────────
  if (typeof tavern.onTurnSettled === 'function') {
    tavern.onTurnSettled(async ({ gameId, turn } = {}) => {
      if (!gameId) return
      await service.onTurnSettled({ gameId, turn })
    })
  }

  if (typeof tavern.on === 'function') {
    try {
      tavern.on('context-compacted', async ({ gameId } = {}) => {
        if (!gameId) return
        await service.autoEvolveAfterCompaction(gameId)
      })
    } catch {}
  }

  if (typeof tavern.onTimelineChanged === 'function') {
    tavern.onTimelineChanged(({ gameId } = {}) => {
      if (!gameId) return
      gameCache.delete(str(gameId))
      void publishCompassState(gameId)
    })
  }

  if (typeof tavern.onGameRemoved === 'function') {
    tavern.onGameRemoved(({ gameId } = {}) => {
      if (!gameId) return
      const id = str(gameId)
      service.clearMemory(id)
      gameCache.delete(id)
      gameLocks.delete(id)
    })
  }

  if (typeof tavern.gameSettings === 'function') {
    try {
      tavern.gameSettings({
        title: '剧情罗盘',
        fields: [
          {
            key: 'enabled',
            type: 'boolean',
            label: '启用剧情罗盘',
            description: '推演短期、中期、长期多路线剧情发展灵感；关闭后不注入提示词且不自动演进，已保存的路线数据会保留。',
            default: false
          },
          {
            key: 'autoUpdateInterval',
            type: 'number',
            label: '自动更新间隔（楼数）',
            description: '每隔 N 楼自动全层刷新路线规划（0 表示关闭定时自动更新）',
            default: 0,
            min: 0,
            max: 100
          }
        ]
      })
    } catch {}
  }

  if (typeof tavern.onGameSettingsChanged === 'function') {
    tavern.onGameSettingsChanged(async ({ gameId, values } = {}) => {
      if (!gameId || !values || syncingGameSettings) return
      syncingGameSettings = true
      try {
        if (typeof values.enabled === 'boolean') {
          await service.setEnabled({ gameId, enabled: values.enabled })
        }
        if (values.autoUpdateInterval !== undefined) {
          const interval = Number(values.autoUpdateInterval)
          if (Number.isSafeInteger(interval) && interval >= 0 && interval <= 100) {
            await updateGame(gameId, current => {
              current.compass.autoUpdateInterval = interval
              return current
            })
            void publishCompassState(gameId)
          }
        }
      } finally {
        syncingGameSettings = false
      }
    })
  }

  // ── 浏览器侧 RPC 处理 ─────────────────────────────────────────────
  function handle(rpcName, fn) {
    if (typeof tavern.handle === 'function') tavern.handle(rpcName, fn)
  }

  handle('plot-compass:state', async ({ gameId } = {}) => {
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const [record, turn] = await Promise.all([readGame(gameId), latestTurnOf(gameId)])
    return { ok: true, ...service.viewState(record, gameId, turn) }
  })

  handle('plot-compass:set-enabled', async ({ gameId, enabled } = {}) => {
    const result = await service.setEnabled({ gameId, enabled })
    return { ok: true, ...result }
  })

  handle('plot-compass:set-model', async ({ gameId, model } = {}) => {
    const result = await service.setModel({ gameId, model })
    return { ok: true, ...result }
  })

  handle('plot-compass:generate', async ({ gameId, scope, guidance, wait, fresh } = {}) => {
    const result = await service.generate({ gameId, scope, guidance, wait: wait === true, fresh: fresh === true })
    return { ok: true, ...result }
  })

  handle('plot-compass:cancel', async ({ gameId } = {}) => {
    const result = await service.cancel({ gameId })
    return { ok: true, ...result }
  })

  handle('plot-compass:chat', async ({ gameId, message, wait } = {}) => {
    const result = await service.chat({ gameId, message, wait: wait === true })
    return { ok: true, ...result }
  })

  handle('plot-compass:clear-chat', async ({ gameId } = {}) => {
    const plotCompass = await service.clearChat({ gameId })
    return { ok: true, plotCompass }
  })

  handle('plot-compass:pin', async ({ gameId, horizon, routeId, exact } = {}) => {
    const plotCompass = await service.pin({ gameId, horizon, routeId, exact: exact === true })
    return { ok: true, plotCompass }
  })

  handle('plot-compass:toggle-step', async ({ gameId, horizon, routeId, stepIndex } = {}) => {
    const plotCompass = await service.toggleStep({ gameId, horizon, routeId, stepIndex })
    return { ok: true, plotCompass }
  })

  handle('plot-compass:set-archetypes', async ({ gameId, archetypes } = {}) => {
    const plotCompass = await service.setArchetypes({ gameId, archetypes })
    return { ok: true, plotCompass }
  })

  handle('plot-compass:set-preferences', async ({ gameId, pace, blindBox, customDirective, autoUpdateInterval } = {}) => {
    const plotCompass = await service.setPreferences({ gameId, pace, blindBox, customDirective, autoUpdateInterval })
    return { ok: true, plotCompass }
  })

  handle('plot-compass:set-defaults', async (patch = {}) => {
    const defaults = await saveDefaults(patch)
    return { ok: true, defaults }
  })

  handle('plot-compass:model-catalog', async () => {
    if (!runtimeLlm || typeof runtimeLlm.listProviders !== 'function' || typeof runtimeLlm.listModels !== 'function') {
      return { ok: true, modelCatalog: [] }
    }
    const providers = runtimeLlm.listProviders()
    const groups = await Promise.all(providers.map(async provider => {
      try {
        const models = await runtimeLlm.listModels(provider.id)
        return {
          provider: provider.id,
          providerName: provider.name || provider.id,
          models: (Array.isArray(models) ? models : [])
            .filter(m => !Array.isArray(m.inputModalities) || m.inputModalities.includes('text'))
            .map(m => ({ id: m.id, name: m.name || m.id }))
        }
      } catch {
        return { provider: provider.id, providerName: provider.name || provider.id, models: [] }
      }
    }))
    return { ok: true, modelCatalog: groups.filter(g => g.models.length > 0) }
  })

  handle('plot-compass:model-reasoning', async ({ provider, model } = {}) => {
    if (!provider || !model || !runtimeLlm) return { ok: true, reasoning: null }
    try {
      const info = typeof runtimeLlm.resolveModelInfo === 'function'
        ? await Promise.resolve(runtimeLlm.resolveModelInfo(provider, model))
        : null
      const efforts = Array.isArray(info?.reasoningEfforts)
        ? info.reasoningEfforts
        : (Array.isArray(info?.capabilities?.reasoningEfforts) ? info.capabilities.reasoningEfforts : [])
      return {
        ok: true,
        reasoning: efforts.length
          ? { efforts: efforts.map(e => typeof e === 'string' ? { id: e, name: e } : { id: e.id, name: e.name || e.id }) }
          : null
      }
    } catch {
      return { ok: true, reasoning: null }
    }
  })

  return Object.freeze({
    service,
    readGame,
    publishCompassState
  })
}

export default { name, inject, apply }
