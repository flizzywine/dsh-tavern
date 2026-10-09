import { publicPluginMedia, pluginMediaSession } from './domain/plugin-media.js'

// The public `tavern` service for third-party DSH plugins (docs/plugin-api.md).
// Only additive changes are allowed here: published plugins depend on every
// name and field. Internals are reached through `deps`, never exposed.
export const TAVERN_PLUGIN_API_VERSION = 2
const TRACKER = Symbol.for('cordis.tracker')
const SECTION_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_SECTION_TEXT = 8000
const TOOL_NAME = /^[a-z][a-z0-9_]{2,47}$/
const MAX_TOOL_RESULT = 20000
const MAX_TOOL_CALLS_PER_SETTLEMENT = 8
const MAX_WORLDBOOK_ENTRIES = 20
const MAX_WORLDBOOK_ENTRY = 4000
const PLUGIN_TIMEOUT_MS = 30000
const REPLACEMENT_TIMEOUT_MS = 120000
const MAX_ERRORS_PER_GAME = 30
// Stages a plugin may replace, and what a replacement must hand back (docs/plugin-design.md).
const REPLACEABLE_STAGES = Object.freeze({ settlement: '结算' })

function ownerOf(service) {
  const ctx = service && service.ctx
  const fiber = ctx && (ctx[Symbol.for('cordis.shadow')] ? Object.getPrototypeOf(ctx) : ctx).fiber
  const name = String(fiber && fiber.name || '').trim()
  if (!name || name === 'root') throw new Error('请在插件里通过 ctx.inject 取得 tavern 服务，并以 tavern.方法名() 的形式调用')
  return name
}

/** Register through the caller's Cordis fiber so plugin unload disposes it. */
function owned(service, register, label) {
  const ctx = service && service.ctx
  return ctx && typeof ctx.effect === 'function' ? ctx.effect(register, label) : register()
}

function positiveTurn(value) {
  const turn = Number(value)
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('turn 必须是正整数')
  return turn
}

/** A plugin callback, bounded in time: a hung plugin must never hold up a turn. */
function bounded(promise, label, ms = PLUGIN_TIMEOUT_MS) {
  let timer
  return Promise.race([Promise.resolve(promise), new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(label + ' 超过 ' + ms / 1000 + ' 秒未返回')), ms)
  })]).finally(() => clearTimeout(timer))
}

function textOrFunction(text) {
  if (typeof text !== 'string' && typeof text !== 'function') throw new TypeError('text 必须是字符串或函数')
}

function sectionName(name) {
  if (typeof name !== 'string' || !SECTION_NAME.test(name)) throw new Error('name 只能用小写字母、数字、点、下划线和连字符')
}

function gameIdOf(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('gameId 必须是非空字符串')
  return value
}

export function createTavernPluginApi(deps) {
  const settledHandlers = new Set()
  const removedHandlers = new Set()
  const timelineHandlers = new Set()
  const sections = new Map()
  const turnSections = new Map()
  const settlementSections = new Map()
  const settlementTools = new Map()
  const worldbookSources = new Map()
  const replacements = { settlement: new Map() }
  const attachedOwners = new Set()
  const errors = new Map()
  const reservedToolNames = new Set(deps.reservedToolNames || [])
  const notified = new Set()
  const log = deps.logger || console

  /** Remember a plugin failure for the game's plugin panel, newest last. */
  function recordError(gameId, owner, stage, error) {
    const message = String(error?.message || error).slice(0, 500)
    log.warn?.('dsh-tavern: 插件 ' + owner + ' 在「' + stage + '」出错: ' + message)
    if (!gameId) return
    const list = errors.get(gameId) || []
    list.push({ at: Date.now(), plugin: owner, stage, message })
    errors.set(gameId, list.slice(-MAX_ERRORS_PER_GAME))
    if (errors.size > 200) errors.delete(errors.keys().next().value)
  }

  /** The player's per-game choices. A game Tavern cannot resolve has everything enabled. */
  async function choicesFor(gameId) {
    const game = gameId ? await deps.resolveGame(String(gameId)).catch(() => null) : null
    const settings = game && deps.data?.readSettings ? await deps.data.readSettings(game.chatId).catch(() => null) : null
    return { game, disabled: new Set(settings?.disabled || []), replacements: settings?.replacements || {} }
  }

  function dispatch(handlers, payload, label, disabled) {
    for (const entry of Array.from(handlers)) {
      if (disabled?.has(entry.owner)) continue
      Promise.resolve().then(() => entry.handler(structuredClone(payload))).catch(error => recordError(payload.gameId, entry.owner, label, error))
    }
  }

  async function requireTurn(gameId, turn) {
    const material = await deps.readTurn(gameIdOf(gameId), positiveTurn(turn))
    if (!material) throw Object.assign(new Error('这一轮不存在或还没写完'), { code: 'TAVERN_PLUGIN_TURN_UNAVAILABLE' })
    return material
  }

  function snapshotOf(material) {
    return {
      gameId: material.sessionId, turn: material.turn, textVersion: material.key,
      text: material.text, rawText: material.source,
      card: { id: material.card.path, name: material.card.name }
    }
  }

  async function requireGame(gameId) {
    const game = await deps.resolveGame(gameIdOf(gameId))
    if (!game) throw Object.assign(new Error('这一局不存在或不是游玩对话'), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
    return game
  }

  async function locateItem(itemId) {
    const sessionId = pluginMediaSession(itemId)
    const game = sessionId ? await deps.resolveGame(sessionId) : null
    if (!game) throw Object.assign(new Error('媒体项不存在或不属于本插件'), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
    return game
  }

  async function changed(gameId) {
    try { deps.publish(gameId) } catch {}
  }

  /** One registry entry per (plugin, name), removed when the plugin unloads. */
  function register(registry, key, entry, label, duplicate) {
    return owned(this, () => {
      if (registry.has(key)) throw new Error(duplicate)
      registry.set(key, entry)
      return () => { if (registry.get(key) === entry) registry.delete(key) }
    }, label)
  }

  async function collectSections(registry, context, label, disabled) {
    const result = []
    const entries = Array.from(registry.values()).filter(entry => !disabled?.has(entry.owner)).sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name))
    for (const entry of entries) {
      let text
      try { text = typeof entry.text === 'function' ? await bounded(entry.text(structuredClone(context)), label) : entry.text }
      catch (error) { recordError(context.gameId, entry.owner, label, error); continue }
      if (typeof text !== 'string' || !text.trim()) continue
      result.push({ name: 'tavern-plugin:' + entry.owner + ':' + entry.name, owner: entry.owner, ...(entry.position === 'before' ? { position: 'before' } : {}), text: text.trim().slice(0, MAX_SECTION_TEXT) })
    }
    return result
  }

  const service = {
    ctx: deps.ctx,
    apiVersion: TAVERN_PLUGIN_API_VERSION,

    onTurnSettled(handler) {
      if (typeof handler !== 'function') throw new TypeError('onTurnSettled 需要一个函数')
      const entry = { owner: ownerOf(this), handler }
      return owned(this, () => { settledHandlers.add(entry); return () => settledHandlers.delete(entry) }, 'tavern.onTurnSettled()')
    },

    onGameRemoved(handler) {
      if (typeof handler !== 'function') throw new TypeError('onGameRemoved 需要一个函数')
      const entry = { owner: ownerOf(this), handler }
      return owned(this, () => { removedHandlers.add(entry); return () => removedHandlers.delete(entry) }, 'tavern.onGameRemoved()')
    },

    onTimelineChanged(handler) {
      if (typeof handler !== 'function') throw new TypeError('onTimelineChanged 需要一个函数')
      const entry = { owner: ownerOf(this), handler }
      return owned(this, () => { timelineHandlers.add(entry); return () => timelineHandlers.delete(entry) }, 'tavern.onTimelineChanged()')
    },

    async saveTurnData({ gameId, turn, textVersion, data } = {}) {
      const owner = ownerOf(this)
      const game = await requireGame(gameId)
      const at = positiveTurn(turn)
      const key = await deps.currentKey(game.sessionId, at)
      if (!key) throw Object.assign(new Error('这一轮不存在'), { code: 'TAVERN_PLUGIN_TURN_UNAVAILABLE' })
      if (textVersion !== undefined && textVersion !== key) throw Object.assign(new Error('textVersion 不是这一轮当前显示的正文版本'), { code: 'TAVERN_PLUGIN_STALE_VERSION' })
      if (data === undefined) throw new TypeError('data 不能省略；要清除这一轮的数据请传 null')
      await deps.data.saveTurn({ chatId: game.chatId, owner, turn: at, key, data })
      return { turn: at, textVersion: key }
    },

    async readTurnData({ gameId, turn } = {}) {
      const owner = ownerOf(this)
      const game = await deps.resolveGame(gameIdOf(gameId))
      if (!game) return null
      const keys = new Map()
      for (const record of await deps.data.turnsUpTo({ chatId: game.chatId, owner, turn: positiveTurn(turn) })) {
        if (!keys.has(record.turn)) keys.set(record.turn, await deps.currentKey(game.sessionId, record.turn))
        if (keys.get(record.turn) === record.key) return { turn: record.turn, textVersion: record.key, data: structuredClone(record.data) }
      }
      return null
    },

    async saveGameData({ gameId, data } = {}) {
      const owner = ownerOf(this)
      const game = await requireGame(gameId)
      if (data === undefined) throw new TypeError('data 不能省略；要清除请传 null')
      await deps.data.saveGame({ chatId: game.chatId, owner, data })
    },

    async readGameData({ gameId } = {}) {
      const owner = ownerOf(this)
      const game = await deps.resolveGame(gameIdOf(gameId))
      return game ? deps.data.readGame({ chatId: game.chatId, owner }) : null
    },

    async getTurn({ gameId, turn } = {}) {
      const material = await deps.readTurn(gameIdOf(gameId), positiveTurn(turn))
      if (!material) return null
      await deps.media.issue(material.chatId, material.turn, material.key)
      return snapshotOf(material)
    },

    async getCardContext({ gameId, turn } = {}) {
      return await deps.readCardContext(await requireTurn(gameId, turn))
    },

    async backgroundModel({ gameId } = {}) {
      const selection = await deps.backgroundModel(gameIdOf(gameId))
      return selection && selection.provider && selection.model ? { provider: String(selection.provider), model: String(selection.model) } : null
    },

    async attach({ gameId, turn, textVersion, item } = {}) {
      const owner = ownerOf(this)
      const material = await requireTurn(gameId, turn)
      if (typeof textVersion !== 'string' || textVersion === '') throw new Error('textVersion 必须是 onTurnSettled 或 getTurn 给出的值')
      const record = await deps.media.attach({ chatId: material.chatId, sessionId: material.sessionId, owner, turn: material.turn, key: textVersion, currentKey: material.key, item })
      attachedOwners.add(owner)
      await changed(material.sessionId)
      return { id: record.id }
    },

    async update(itemId, changes) {
      const owner = ownerOf(this)
      const { chatId, sessionId } = await locateItem(itemId)
      const record = await deps.media.patch({ chatId, owner, itemId, changes })
      await changed(sessionId)
      return publicPluginMedia(record)
    },

    async remove(itemId) {
      const owner = ownerOf(this)
      const located = await locateItem(itemId).catch(() => null)
      if (!located) return false
      const removed = await deps.media.remove({ chatId: located.chatId, owner, itemId })
      if (removed) await changed(located.sessionId)
      return removed
    },

    async list({ gameId, turn } = {}) {
      const owner = ownerOf(this)
      const chat = await deps.resolveGame(gameIdOf(gameId))
      if (!chat) return []
      const items = await deps.media.list({ chatId: chat.chatId, owner, turn: turn === undefined ? undefined : positiveTurn(turn) })
      const currentKeys = new Map()
      for (const turnNumber of new Set(items.map(item => item.turn))) currentKeys.set(turnNumber, await deps.currentKey(chat.sessionId, turnNumber))
      return items.map(item => publicPluginMedia(item, currentKeys.get(item.turn) === item.key))
    },

    promptSection({ name, text } = {}) {
      const owner = ownerOf(this)
      sectionName(name); textOrFunction(text)
      return register.call(this, sections, owner + '\u0000' + name, { owner, name, text }, 'tavern.promptSection()', '提示词段落 ' + name + ' 已注册')
    },

    turnSection({ name, text, position = 'after' } = {}) {
      const owner = ownerOf(this)
      sectionName(name); textOrFunction(text)
      if (!['before', 'after'].includes(position)) throw new Error("position 只能是 'before' 或 'after'")
      return register.call(this, turnSections, owner + '\u0000' + name, { owner, name, text, position }, 'tavern.turnSection()', '本轮上下文段落 ' + name + ' 已注册')
    },

    settlementSection({ name, text } = {}) {
      const owner = ownerOf(this)
      sectionName(name); textOrFunction(text)
      return register.call(this, settlementSections, owner + '\u0000' + name, { owner, name, text }, 'tavern.settlementSection()', '结算说明段落 ' + name + ' 已注册')
    },

    settlementTool({ name, description, parameters, execute } = {}) {
      const owner = ownerOf(this)
      if (typeof name !== 'string' || !TOOL_NAME.test(name)) throw new Error('工具名只能用小写字母、数字和下划线，以字母开头，3–48 个字符')
      if (reservedToolNames.has(name)) throw new Error('工具名 ' + name + ' 是 Tavern 自己的工具，请换一个名字')
      if (typeof description !== 'string' || !description.trim() || description.length > 2000) throw new Error('description 必须是 1–2000 字的说明')
      if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters) || parameters.type !== 'object') throw new Error('parameters 必须是 type 为 object 的 JSON Schema')
      if (typeof execute !== 'function') throw new TypeError('execute 必须是函数')
      const entry = { owner, name, tool: Object.freeze({ name, description: description.trim(), parameters: structuredClone(parameters), countsTowardLimit: false }), execute }
      return register.call(this, settlementTools, name, entry, 'tavern.settlementTool()', '结算工具 ' + name + ' 已被注册')
    },

    replaceSettlement({ settle } = {}) {
      const owner = ownerOf(this)
      if (typeof settle !== 'function') throw new TypeError('settle 必须是函数')
      return register.call(this, replacements.settlement, owner, { owner, settle }, 'tavern.replaceSettlement()', '本插件已经注册了结算替换')
    },

    worldbookSource({ name, entries } = {}) {
      const owner = ownerOf(this)
      sectionName(name)
      if (typeof entries !== 'function') throw new TypeError('entries 必须是函数')
      return register.call(this, worldbookSources, owner + '\u0000' + name, { owner, name, entries }, 'tavern.worldbookSource()', '世界书来源 ' + name + ' 已注册')
    }
  }
  Object.defineProperty(service, TRACKER, { value: { associate: 'tavern', property: 'ctx' } })

  /** Called by Tavern after a turn's settlement finished (or failed). */
  async function turnSettled(sessionId) {
    if (settledHandlers.size === 0) return
    const material = await deps.readLatestSettledTurn(sessionId)
    if (!material) return
    const id = material.chatId + '\u0000' + material.key
    if (notified.has(id)) return
    notified.add(id)
    if (notified.size > 2000) notified.delete(notified.values().next().value)
    await deps.media.issue(material.chatId, material.turn, material.key)
    dispatch(settledHandlers, { ...snapshotOf(material), settledAt: Date.now() }, 'onTurnSettled', (await choicesFor(material.sessionId)).disabled)
  }

  function gameRemoved(gameId) {
    if (gameId) dispatch(removedHandlers, { gameId }, 'onGameRemoved')
  }

  const TIMELINE_KINDS = new Set(['rollback', 'undo-rollback', 'regenerate', 'edit', 'fork'])
  /** Called by Tavern after the story line of a game changed; the change is informational. */
  function timelineChanged(gameId, change = {}) {
    if (!gameId || !TIMELINE_KINDS.has(change.kind) || timelineHandlers.size === 0) return
    const turn = Number(change.turn)
    void choicesFor(gameId).then(({ disabled }) => dispatch(timelineHandlers, { gameId, kind: change.kind, ...(Number.isSafeInteger(turn) && turn > 0 ? { turn } : {}),
      ...(change.fromGameId ? { fromGameId: String(change.fromGameId) } : {}) }, 'onTimelineChanged', disabled))
  }

  /** Called by Tavern when a game is forked: carry the visible plugin data and media. */
  async function gameForked({ sourceChatId, targetChatId, targetSessionId, keyMap }) {
    const copied = { data: 0, media: 0 }
    try { copied.data = await deps.data.copyForFork({ sourceChatId, targetChatId, keyMap }) }
    catch (error) { log.warn?.('dsh-tavern: 分叉时复制插件数据失败: ' + String(error?.message || error)) }
    try { copied.media = await deps.media.copyForFork({ sourceChatId, targetChatId, targetSessionId, keyMap }) }
    catch (error) { log.warn?.('dsh-tavern: 分叉时复制插件媒体失败: ' + String(error?.message || error)) }
    return copied
  }

  /**
   * The plugin replacing a stage in this game, or null for Tavern's own. One candidate
   * applies by itself; several apply only when the player chose one (none otherwise).
   */
  async function replacementFor(stage, gameId) {
    const registry = replacements[stage]
    if (!registry || registry.size === 0) return null
    const { disabled, replacements: chosen } = await choicesFor(gameId)
    const candidates = Array.from(registry.values()).filter(entry => !disabled.has(entry.owner))
    if (Object.hasOwn(chosen, stage)) return candidates.find(entry => entry.owner === chosen[stage]) || null
    return candidates.length === 1 ? candidates[0] : null
  }

  /**
   * Seam: run the settlement replacement, if any. Returns the validated result, or null
   * so Tavern settles by itself (no replacement, or it failed: recorded for the panel).
   */
  async function replaceSettlement(input) {
    const entry = await replacementFor('settlement', input.gameId)
    if (!entry) return null
    try {
      const value = await bounded(entry.settle(structuredClone({ gameId: input.gameId, turn: input.turn, text: input.text, posture: input.posture, tasks: input.tasks })), '结算替换', REPLACEMENT_TIMEOUT_MS)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('settle 必须返回对象')
      const posture = value.posture === undefined || value.posture === null ? '' : value.posture
      if (typeof posture !== 'string') throw new Error('posture 必须是字符串')
      if (input.tasks.posture && !posture.trim()) throw new Error('本局开启了姿势结算，settle 必须返回非空的 posture')
      if (posture.length > 8000) throw new Error('posture 不能超过 8000 字')
      return { owner: entry.owner, posture: posture.trim() }
    } catch (error) {
      recordError(input.gameId, entry.owner, '结算替换（已改用 Tavern 自己的结算）', error)
      return null
    }
  }

  /** The game's plugin panel: what each plugin uses here, the player's choices, recent errors. */
  async function gamePlugins(gameId) {
    const { game, disabled, replacements: chosen } = await choicesFor(gameId)
    if (!game) return null
    const uses = new Map()
    const use = (owner, stage, mode) => {
      const list = uses.get(owner) || []
      if (!list.some(item => item.stage === stage && item.mode === mode)) list.push({ stage, mode })
      uses.set(owner, list)
    }
    for (const entry of settledHandlers) use(entry.owner, '生命周期', '观察')
    for (const entry of timelineHandlers) use(entry.owner, '生命周期', '观察')
    for (const entry of removedHandlers) use(entry.owner, '生命周期', '观察')
    for (const entry of [...sections.values(), ...turnSections.values(), ...worldbookSources.values()]) use(entry.owner, '上下文', '添加')
    for (const entry of [...settlementSections.values(), ...settlementTools.values()]) use(entry.owner, '结算', '添加')
    for (const owner of attachedOwners) use(owner, '界面', '添加')
    const stages = {}
    for (const [stage, registry] of Object.entries(replacements)) {
      for (const entry of registry.values()) use(entry.owner, REPLACEABLE_STAGES[stage], '替换')
      const candidates = Array.from(registry.keys()).sort()
      if (!candidates.length) continue
      const active = await replacementFor(stage, gameId)
      stages[stage] = { label: REPLACEABLE_STAGES[stage], candidates, chosen: Object.hasOwn(chosen, stage) ? chosen[stage] : null, active: active ? active.owner : '',
        conflict: !Object.hasOwn(chosen, stage) && candidates.filter(owner => !disabled.has(owner)).length > 1 }
    }
    const plugins = Array.from(uses.keys()).sort().map(name => ({ name, enabled: !disabled.has(name), uses: uses.get(name) }))
    return { plugins, replacements: stages, errors: [...(errors.get(game.sessionId) || [])].reverse() }
  }

  async function setGamePlugin(gameId, { name, enabled, replace } = {}) {
    const { game } = await choicesFor(gameId)
    if (!game) throw new Error('这一局不存在或不是游玩对话')
    await deps.data.updateSettings(game.chatId, settings => {
      if (typeof name === 'string' && typeof enabled === 'boolean') {
        settings.disabled = settings.disabled.filter(item => item !== name)
        if (!enabled) settings.disabled.push(name)
      }
      if (replace && Object.hasOwn(REPLACEABLE_STAGES, replace.stage)) {
        // null: back to the default rule; '' : Tavern's own; a name: that plugin.
        if (replace.plugin === null) delete settings.replacements[replace.stage]
        else settings.replacements[replace.stage] = String(replace.plugin)
      }
    })
    return gamePlugins(gameId)
  }

  /** Turns that hold plugin data or media, so a fork computes versions only for them. */
  async function forkTurns(chatId) {
    const turns = await Promise.all([deps.data.turns(chatId).catch(() => []), deps.media.turns(chatId).catch(() => [])])
    return [...new Set(turns.flat())].sort((a, b) => a - b)
  }

  /** Plugin sections for the foreground story prompt, in a stable order. */
  async function promptSections({ gameId, turn }) {
    const { disabled } = await choicesFor(gameId)
    return (await collectSections(sections, { gameId, turn }, '提示词段落', disabled)).map(({ name, text }) => ({ name, text }))
  }

  /** Seam: per-turn context for the story request, computed once while the turn is prepared. */
  async function turnContext({ gameId, turn, input }) {
    const context = { gameId, turn, input: String(input || '') }
    const { disabled } = await choicesFor(gameId)
    const result = await collectSections(turnSections, context, '本轮上下文段落', disabled)
    for (const source of Array.from(worldbookSources.values()).filter(entry => !disabled.has(entry.owner)).sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name))) {
      let entries
      try { entries = await bounded(source.entries(structuredClone(context)), '世界书来源') }
      catch (error) { recordError(gameId, source.owner, '世界书来源', error); continue }
      const items = (Array.isArray(entries) ? entries : []).slice(0, MAX_WORLDBOOK_ENTRIES).flatMap(entry => {
        const content = typeof entry?.content === 'string' ? entry.content.trim().slice(0, MAX_WORLDBOOK_ENTRY) : ''
        if (!content) return []
        const title = typeof entry.title === 'string' ? entry.title.trim().slice(0, 200) : ''
        return [title ? '[' + title + '] ' + content : content]
      })
      if (items.length) result.push({ name: 'tavern-plugin:' + source.owner + ':' + source.name, owner: source.owner, worldbook: true, text: items.join('\n\n') })
    }
    return result
  }

  /** Seam: what the background settlement task offers the model on behalf of plugins. */
  const settlement = Object.freeze({
    /** Tool definitions, in a stable order: they sit in the cached request prefix. */
    tools() { return Array.from(settlementTools.values()).sort((a, b) => a.name.localeCompare(b.name)).map(entry => entry.tool) },
    has(name) { return settlementTools.has(name) },
    async sections({ gameId, turn }) { return collectSections(settlementSections, { gameId, turn }, '结算说明段落', (await choicesFor(gameId)).disabled) },
    /** One settlement run's dispatcher: bounded calls, errors returned to the model, never thrown. */
    calls({ gameId, turn }) {
      let count = 0
      const choices = choicesFor(gameId).catch(() => ({ disabled: new Set() }))
      return async function call(name, args) {
        const entry = settlementTools.get(name)
        if (!entry) return JSON.stringify({ ok: false, retryable: false, error: '插件工具 ' + name + ' 已不可用' })
        if ((await choices).disabled.has(entry.owner)) return JSON.stringify({ ok: false, retryable: false, error: '玩家在本局关闭了插件 ' + entry.owner + '，不要再调用它的工具' })
        if (++count > MAX_TOOL_CALLS_PER_SETTLEMENT) return JSON.stringify({ ok: false, retryable: false, error: '本轮插件工具调用次数已达上限，请继续完成结算' })
        try {
          const value = await bounded(entry.execute({ gameId, turn, arguments: structuredClone(args ?? {}) }), '插件工具 ' + name)
          const text = typeof value === 'string' ? value : JSON.stringify(value ?? { ok: true })
          return text.slice(0, MAX_TOOL_RESULT)
        } catch (error) {
          recordError(gameId, entry.owner, '结算工具 ' + name, error)
          return JSON.stringify({ ok: false, retryable: false, error: '插件工具执行失败：' + String(error?.message || error).slice(0, 500) })
        }
      }
    }
  })

  return Object.freeze({ service, turnSettled, gameRemoved, timelineChanged, gameForked, forkTurns, promptSections, turnContext, settlement, replaceSettlement, gamePlugins, setGamePlugin })
}
