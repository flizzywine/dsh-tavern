import { createHash } from 'node:crypto'
import { isMvuUpdateEntry } from './domain/worldbook-recall.js'
import { createPluginTaskExecution } from './domain/plugin-task-execution.js'
import { pluginMember, pluginMemberId, registerPluginMember } from './domain/background-members.js'
import { CUSTOM_EVENT, STORY_EVENTS } from './domain/story-events.js'
import { bounded, untilAborted } from './domain/plugin-callback.js'
import path from 'node:path'
import { publicPluginMedia, pluginMediaSession } from './domain/plugin-media.js'
import { normalizeGameSettings, coerceSetting, settingValues } from './domain/plugin-game-settings.js'

// The public `tavern` service for third-party DSH plugins (docs/plugin-api.md).
// Only additive changes are allowed here: published plugins depend on every
// name and field. Internals are reached through `deps`, never exposed.
export const TAVERN_PLUGIN_API_VERSION = 6
const TRACKER = Symbol.for('cordis.tracker')
const SECTION_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_SECTION_TEXT = 8000
const TOOL_NAME = /^[a-z][a-z0-9_]{2,47}$/
const HANDLER_NAME = /^[a-z0-9][a-z0-9._:/-]{0,95}$/
const MAX_HANDLER_ARGS = 256 * 1024
const MAX_HANDLER_RESULT = 4 * 1024 * 1024
const MAX_TOOL_RESULT = 20000
const MAX_TOOL_CALLS_PER_SETTLEMENT = 8
const MAX_WORLDBOOK_ENTRIES = 20
const MAX_WORLDBOOK_ENTRY = 4000
const MAX_POOL_ENTRIES = 200
const MAX_CAST_SOURCE_CHARACTERS = 50
// Read on every send, settlement and world book search: a slow plugin must not hold the game up.
const POOL_TIMEOUT_MS = 5000
const POOL_ENTRY_ID = /^[A-Za-z0-9._-]{1,64}$/
const PLUGIN_TIMEOUT_MS = 30000
const REPLACEMENT_TIMEOUT_MS = 120000
const MAX_MEMBER_SYSTEM = 20000
const MAX_VARIABLES = 1024 * 1024
const MAX_EDIT_TEXT = 200000
const MAX_HISTORY_TURNS = 50
const MAX_TASK_TITLE = 40
const MAX_TASK_DESCRIPTION = 500
const MAX_CARD_OPERATIONS = 200
const MAX_CARD_VALUE = 2 * 1024 * 1024
const TOOL_MODES = ['play', 'card']
const TASK_PHASES = Object.freeze({ before: '结算前', parallel: '与结算同时', after: '结算后' })
const MAX_PUBLISHED_STATE = 256 * 1024
const MAX_PUBLISHED_ENTRIES = 2000
const MAX_PACK_FILES = 5000
// Card files Tavern reads itself; a plugin importer never takes these.
const NATIVE_CARD_EXTENSIONS = new Set(['.png', '.json', '.charx', '.dshcard'])
const CARD_EXTENSION = /^\.[a-z0-9][a-z0-9._-]{0,19}$/

// Story moments plugins may follow (domain/story-events.js), and plugins' own (`<plugin>:<name>`).
const PLUGIN_STORY_EVENTS = STORY_EVENTS
const OWN_EVENT_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_EVENT_DATA = 8192
const MAX_OUTPUT = 65536
// Outputs live in plugin data beside the plugin's own records, under their own owner key.
const outputOwner = (plugin, name) => 'output:' + plugin + ':' + name
// A plugin's own moments per game in 10 s: two plugins answering each other cannot spin forever.
const MAX_OWN_EVENTS = 60

function ownerOf(service) {
  const ctx = service && service.ctx
  const fiber = ctx && (ctx[Symbol.for('cordis.shadow')] ? Object.getPrototypeOf(ctx) : ctx).fiber
  const name = String(fiber && fiber.name || '').trim()
  if (!name || name === 'root') throw new Error('请在插件里通过 ctx.inject 取得 tavern 服务，并以 tavern.方法名() 的形式调用')
  return name
}

/** Register through the caller's Cordis fiber so plugin unload disposes it. */
// What a plugin hears of a story moment: the game, and the moment's plain fields.
function heardOf(event, gameId, payload) {
  const heard = { event, gameId }
  if (Number.isSafeInteger(payload?.turn)) heard.turn = payload.turn
  for (const key of ['kind', 'task', 'plugin', 'member', 'status', 'from']) if (typeof payload?.[key] === 'string' && payload[key]) heard[key] = payload[key]
  if (payload?.data !== undefined) heard.data = structuredClone(payload.data)
  return heard
}

function owned(service, register, label) {
  const ctx = service && service.ctx
  return ctx && typeof ctx.effect === 'function' ? ctx.effect(register, label) : register()
}

function positiveTurn(value) {
  const turn = Number(value)
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('turn 必须是正整数')
  return turn
}

function textOrFunction(text) {
  if (typeof text !== 'string' && typeof text !== 'function') throw new TypeError('text 必须是字符串或函数')
}

function sectionName(name) {
  if (typeof name !== 'string' || !SECTION_NAME.test(name)) throw new Error('name 只能用小写字母、数字、点、下划线和连字符')
}

function taskKey(owner, name) { return owner + ':' + name }

function taskTitle(title, name) {
  if (title === undefined) return name
  if (typeof title !== 'string' || !title.trim() || title.trim().length > MAX_TASK_TITLE) throw new Error('title 必须是 1–' + MAX_TASK_TITLE + ' 字')
  return title.trim()
}

function gameIdOf(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('gameId 必须是非空字符串')
  return value
}

function boundedWithSignal(promise, label, signal, ms = PLUGIN_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let timer
    const finish = (callback, value) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      callback(value)
    }
    const abort = () => finish(reject, signal.reason || new Error(label + ' 已取消'))
    if (signal?.aborted) return abort()
    timer = setTimeout(() => finish(reject, new Error(label + ' 超过 ' + ms / 1000 + ' 秒未返回')), ms)
    signal?.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error))
  })
}

export function createTavernPluginApi(deps) {
  const settledHandlers = new Set()
  const removedHandlers = new Set()
  const mediaRemovedHandlers = new Set()
  const timelineHandlers = new Set()
  const castHandlers = new Set()
  const cardHandlers = new Set()
  const cardImporters = new Map()
  // Each plugin's own game settings (one declaration per plugin) and who listens for changes.
  const gameSettingDefs = new Map()
  const settingHandlers = new Set()
  const speechProviders = new Map()
  const imageProviders = new Map()
  const mvuSettlementProviders = new Map()
  const capabilities = Object.freeze({ mvuSettlementProvider: 1, worldbookStrategy: 1 })
  const sections = new Map()
  const turnSections = new Map()
  const settlementSections = new Map()
  const settlementTools = new Map()
  const worldbookSources = new Map()
  const worldbookPools = new Map()
  const castSources = new Map()
  const handlers = new Map()
  const candidateSections = new Map()
  const compactionSections = new Map()
  const replacements = { settlement: new Map(), ledger: new Map() }
  const ledgerRuns = new Map()  // gameId → AbortController of a running ledger replacement
  const settlementTasks = new Map()
  const ownEvents = new Map()
  const manualTasks = new Map()
  // Task-table jobs plugins declared (tavern.job), by workflow id.
  const jobs = new Map()
  const toolScopes = new Map()
  const toolNetworks = new Map()
  const reservedToolNames = new Set(deps.reservedToolNames || [])
  const notified = new Set()
  // The latest state each plugin published for its page side, per game and name (memory only).
  const publishedStates = new Map()
  const log = deps.logger || console

  const taskExecution = createPluginTaskExecution({
    runTask: deps.runTask, currentKey: deps.currentKey,
    readLatestSettledTurn: deps.readLatestSettledTurn, readPendingTurn: deps.readPendingTurn,
    requireGame, choicesFor, snapshotOf, recordError, reservedToolNames, settlementTasks, manualTasks,
  })
  const { runSettlementTasks, manualTaskFor, runManualTask, stopTasks, runningTask, checkVersions } = taskExecution

  /** Log a plugin failure; Tavern carries on with its own behaviour. */
  function recordError(_gameId, owner, stage, error) {
    const message = String(error?.message || error).slice(0, 500)
    log.warn?.('dsh-tavern: 插件 ' + owner + ' 在「' + stage + '」出错: ' + message)
  }

  /**
   * Which plugins take part in a game. Installed plugins take part in every game (players
   * switch them off globally, not per game); a card's own plugins only in that card's games.
   * Per-game switches, replacement choices and task order saved by older versions are ignored.
   */
  async function choicesFor(gameId) {
    const game = gameId ? await deps.resolveGame(String(gameId)).catch(() => null) : null
    const { elsewhere, own } = await cardPluginsFor(game)
    return { game, disabled: new Set(elsewhere), elsewhere, own, replacements: {}, disabledTasks: new Set(), taskOrder: [] }
  }

  /** Card plugins (card-plugins.js): those of another card than this game's, and this card's own. */
  async function cardPluginsFor(game) {
    const scopes = deps.cardScope ? await deps.cardScope().catch(() => null) : null
    if (!scopes?.size) return { elsewhere: new Set(), own: new Set() }
    const cardPath = game && deps.cardPathOf ? await deps.cardPathOf(game.sessionId).catch(() => null) : null
    const elsewhere = new Set(), own = new Set()
    for (const [name, scope] of scopes) (scope.cards.includes(cardPath) ? own : elsewhere).add(name)
    return { elsewhere, own }
  }

  /** A card plugin's calls reach only its own card and that card's games. */
  async function guardScope(owner, input) {
    const scopes = deps.cardScope ? await deps.cardScope().catch(() => null) : null
    const scope = scopes?.get(owner)
    if (!scope) return
    const refuse = () => { throw Object.assign(new Error('卡内插件 ' + owner + ' 只能用于它所在的人物卡'), { code: 'TAVERN_PLUGIN_SCOPE' }) }
    if (input.card !== undefined && !scope.cards.includes(String(input.card))) refuse()
    if (input.gameId !== undefined && (typeof input.gameId !== 'string' || !scope.cards.includes(await deps.cardPathOf?.(input.gameId).catch(() => null)))) refuse()
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

  async function snapshotOf(material) {
    const variables = deps.readVariables ? await deps.readVariables(material).catch(() => null) : null
    return {
      gameId: material.sessionId, turn: material.turn, textVersion: material.key, greeting: material.greeting === true,
      text: material.text, rawText: material.source,
      card: { id: material.card.path, name: material.card.name },
      variables: variables ?? null
    }
  }

  /** The latest settled turn, shown in textVersion, of a game where this plugin is on. */
  async function writableTurn(owner, gameId, turn, textVersion, label) {
    const material = await requireTurn(gameId, turn)
    if ((await choicesFor(material.sessionId)).disabled.has(owner)) throw new Error('玩家在本局关闭了插件 ' + owner)
    if (typeof textVersion !== 'string' || textVersion !== material.key) throw Object.assign(new Error(label + ' 的 textVersion 不是这一轮当前显示的正文版本'), { code: 'TAVERN_PLUGIN_STALE_VERSION' })
    const latest = await deps.readLatestSettledTurn(material.sessionId)
    if (!latest || latest.turn !== material.turn) throw Object.assign(new Error(label + ' 只能用于最新一轮，且要等这一轮写完、后台结算结束'), { code: 'TAVERN_PLUGIN_TURN_UNAVAILABLE' })
    return material
  }

  /** Where a game stands now: its latest written turn, and whether a reply or settlement is under way. */
  async function turnState(gameId) {
    const game = await requireGame(gameId)
    const [latest, settled, activity] = await Promise.all([deps.readPendingTurn(game.sessionId), deps.readLatestSettledTurn(game.sessionId),
      deps.readActivity ? deps.readActivity(game.sessionId) : null])
    const generating = activity?.generating === true, settling = activity?.settling === true
    return {
      gameId: game.sessionId, turn: latest?.turn ?? 0, textVersion: latest?.key ?? null, greeting: latest?.greeting === true,
      generating, settling, busy: generating || settling,
      settled: !!latest && !!settled && settled.turn === latest.turn && settled.key === latest.key
    }
  }

  function cardIdOf(card) {
    if (typeof card !== 'string' || !card.trim()) throw new TypeError('需要人物卡 id（listCards 返回的 id）')
    return card.trim()
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
    // Managed modules opt in; ordinary plugins keep their existing API and card scope.
    get modHostApi() {return deps.modHost?.apiVersion ?? null},
    registerMod(manifest, implementation) {
      const host=deps.modHost
      if (!host) throw new Error('Managed module host is not enabled')
      const owner = ownerOf(this)
      return owned(this, () => host.register(owner, manifest, implementation), 'tavern.registerMod()')
    },
    capabilities,

    mvuSettlementProvider({ name, settle } = {}) {
      const owner = ownerOf(this)
      sectionName(name)
      if (typeof settle !== 'function') throw new TypeError('settle 必须是函数')
      const entry = { owner, name, settle }
      return register.call(this, mvuSettlementProviders, owner + '\u0000' + name, entry,
        'tavern.mvuSettlementProvider()', 'MVU 提供器 ' + name + ' 已注册')
    },

    onTurnSettled(handler) {
      if (typeof handler !== 'function') throw new TypeError('onTurnSettled 需要一个函数')
      const entry = { owner: ownerOf(this), handler }
      return owned(this, () => { settledHandlers.add(entry); return () => settledHandlers.delete(entry) }, 'tavern.onTurnSettled()')
    },

    // A moment of the event table, Tavern's (玩家发送, 正文开始, 正文写完, 本轮结算完, 回合作废,
    // 剧情回退或改写, 任务完成) or a plugin's own ('<plugin>:<name>', see emit): the handler is
    // listed there as this plugin's and hears { event, gameId, ... } in the games that have it on.
    on(event, handler) {
      const owner = ownerOf(this)
      if (!Object.hasOwn(PLUGIN_STORY_EVENTS, event) && !CUSTOM_EVENT.test(String(event))) {
        throw new Error('event 只能是 ' + Object.keys(PLUGIN_STORY_EVENTS).join('、') + '，或别的插件的事件「插件名:事件名」')
      }
      if (typeof handler !== 'function') throw new TypeError('tavern.on() 需要一个函数')
      if (!deps.storyEvents) throw new Error('当前酒馆不支持剧情事件')
      return owned(this, () => deps.storyEvents.on(event, '插件「' + owner + '」', async payload => {
        const gameId = String(payload?.sessionId || payload?.latest?.sessionId || '')
        if (!gameId || (await choicesFor(gameId)).disabled.has(owner)) return
        const heard = heardOf(event, gameId, payload)
        try { await bounded(handler(heard), 'tavern.on(' + event + ')') }
        catch (error) { recordError(gameId, owner, '剧情事件 ' + (PLUGIN_STORY_EVENTS[event] || event), error) }
      }), 'tavern.on()')
    },

    // A task of the task table, declared like Tavern's own: the moments that start it (`on`),
    // or the plugin tasks it runs after (`needs`: '<plugin>:<task>' — once they all finished
    // the same turn), when it runs (`if`, given what started it) and its `run`. What `run`
    // returns is its output for that turn: tasks that need it hear it as needs['<plugin>:<task>'].
    // It is listed on the 后台任务 page; `member` names the plugin member it works through
    // (runTask with that member), `description` what it does and `condition` its `if` in words.
    job({ name, title, description, condition, on, needs, member, if: when, run } = {}) {
      const owner = ownerOf(this)
      if (typeof name !== 'string' || !OWN_EVENT_NAME.test(name)) throw new Error('任务名只能用小写字母、数字、点、下划线和连字符，最多 64 个字符')
      const events = on === undefined ? [] : (Array.isArray(on) ? on : [on])
      if (events.some(event => !Object.hasOwn(PLUGIN_STORY_EVENTS, event) && !CUSTOM_EVENT.test(String(event)))) {
        throw new Error('on 只能是 ' + Object.keys(PLUGIN_STORY_EVENTS).join('、') + '，或别的插件的事件「插件名:事件名」')
      }
      const after = needs === undefined ? [] : (Array.isArray(needs) ? needs : [needs])
      if (after.some(need => !CUSTOM_EVENT.test(String(need)))) throw new Error('needs 写成「插件名:任务名」')
      if (events.length === 0 && after.length === 0) throw new Error('tavern.job() 需要 on 或 needs')
      if (typeof run !== 'function') throw new TypeError('tavern.job() 需要 run 函数')
      if (when !== undefined && typeof when !== 'function') throw new TypeError('tavern.job() 的 if 必须是函数')
      if (member !== undefined && !pluginMember(pluginMemberId(owner, member))) throw new Error('成员 ' + member + ' 还没有用 tavern.member() 注册')
      if (!deps.workflow) throw new Error('当前酒馆不支持任务表')
      const id = 'plugin:' + owner + ':' + name
      const entry = { id, owner, name, title: String(title || name), description: String(description || ''), member: member === undefined ? '' : String(member), needs: after.map(String) }
      const heard = (payload, event) => {
        const value = heardOf(event, payload.gameId, payload)
        if (payload.needs) value.needs = Object.fromEntries(Object.entries(payload.needs).map(([need, output]) => [need.replace(/^plugin:/, ''), structuredClone(output)]))
        return value
      }
      return owned(this, () => {
        const stop = deps.workflow.job({ id, task: id, name: '插件「' + owner + '」' + entry.title, condition: String(condition || ''),
          on: events, needs: entry.needs.map(need => 'plugin:' + need),
          // A failing condition is this plugin's error, and the task does not run.
          if: async (payload, event) => {
            if ((await choicesFor(payload.gameId)).disabled.has(owner)) return false
            try { return !when || Boolean(await when(heard(payload, event))) }
            catch (error) { recordError(payload.gameId, owner, '任务 ' + entry.title, error); return false }
          },
          // A failing run is recorded as this plugin's error and leaves no output.
          run: async (payload, event) => {
            try { return await bounded(run(heard(payload, event)), 'tavern.job(' + name + ')') }
            catch (error) { recordError(payload.gameId, owner, '任务 ' + entry.title, error); throw error }
          } })
        jobs.set(id, entry)
        return () => { stop(); if (jobs.get(id) === entry) jobs.delete(id) }
      }, 'tavern.job()')
    },

    // Announce a moment of this plugin, '<this plugin>:<name>': others follow it with tavern.on and
    // hear { event, gameId, from, data }. Data is small (≤ 8 KB JSON): ids and flags; what they
    // point at is read through readOutput.
    async emit(name, { gameId, data } = {}) {
      const owner = ownerOf(this)
      if (typeof name !== 'string' || !OWN_EVENT_NAME.test(name)) throw new Error('事件名只能用小写字母、数字、点、下划线和连字符，最多 64 个字符')
      const event = owner + ':' + name
      if (!CUSTOM_EVENT.test(event)) throw new Error('插件名 ' + owner + ' 不能用作事件前缀')
      const game = await requireGame(gameId)
      if (data !== undefined && JSON.stringify(data).length > MAX_EVENT_DATA) throw new Error('data 最多 8 KB')
      const now = Date.now(), recent = (ownEvents.get(game.sessionId) || []).filter(at => now - at < 10000)
      if (recent.length >= MAX_OWN_EVENTS) throw new Error('这一局 10 秒内插件事件太多，已暂停发出')
      ownEvents.set(game.sessionId, [...recent, now])
      if (!deps.storyEvents) throw new Error('当前酒馆不支持剧情事件')
      deps.storyEvents.emit(event, { sessionId: game.sessionId, from: owner, ...(data === undefined ? {} : { data: structuredClone(data) }) })
    },

    onGameRemoved(handler) {
      if (typeof handler !== 'function') throw new TypeError('onGameRemoved 需要一个函数')
      const entry = { owner: ownerOf(this), handler }
      return owned(this, () => { removedHandlers.add(entry); return () => removedHandlers.delete(entry) }, 'tavern.onGameRemoved()')
    },

    // The player removed pictures this plugin attached (第 5 版): drop the plugin's own copies.
    onMediaRemoved(handler) {
      if (typeof handler !== 'function') throw new TypeError('onMediaRemoved 需要一个函数')
      const entry = { owner: ownerOf(this), handler }
      return owned(this, () => { mediaRemovedHandlers.add(entry); return () => mediaRemovedHandlers.delete(entry) }, 'tavern.onMediaRemoved()')
    },

    onTimelineChanged(handler) {
      if (typeof handler !== 'function') throw new TypeError('onTimelineChanged 需要一个函数')
      const entry = { owner: ownerOf(this), handler }
      return owned(this, () => { timelineHandlers.add(entry); return () => timelineHandlers.delete(entry) }, 'tavern.onTimelineChanged()')
    },

    // Who says each quoted line and how they feel (Wiki「设计：cast-presentation」), annotated by settlement.
    onCastAnnotated(handler) {
      if (typeof handler !== 'function') throw new TypeError('onCastAnnotated 需要一个函数')
      const entry = { owner: ownerOf(this), handler }
      return owned(this, () => { castHandlers.add(entry); return () => castHandlers.delete(entry) }, 'tavern.onCastAnnotated()')
    },

    async getCast({ gameId, turn } = {}) {
      const game = await requireGame(gameId)
      return (await deps.readCast?.(game.sessionId, positiveTurn(turn))) ?? null
    },

    // The card's characters with their avatar and expression sprites, as URLs a page can show.
    async getCastAssets({ gameId } = {}) {
      const game = await requireGame(gameId)
      return (await deps.readCastAssets?.(game.sessionId)) ?? null
    },

    // Characters a plugin offers to this game's cast: avatars and expression sprites it keeps itself
    // (a DSH card's packs, say). The player's own assets win; what the player lacks is filled from these.
    castAssetSource({ name, characters } = {}) {
      const owner = ownerOf(this)
      sectionName(name)
      if (typeof characters !== 'function') throw new TypeError('characters 必须是函数')
      return register.call(this, castSources, owner + '\u0000' + name, { owner, name, characters }, 'tavern.castAssetSource()', '角色素材来源 ' + name + ' 已注册')
    },

    // The asset packs this game's card carries (DSH cards): opaque data the plugin reading their
    // `format` interprets. Files are read by path, or loaded in the page from `baseUrl + path`.
    async listCardPacks({ gameId } = {}) {
      const game = await requireGame(gameId)
      return structuredClone((await deps.listCardPacks?.(game.sessionId)) || [])
    },

    async readCardPackFile({ gameId, pack, path } = {}) {
      const game = await requireGame(gameId)
      if (typeof pack !== 'string' || typeof path !== 'string' || !path) throw new TypeError('readCardPackFile 需要 pack 和 path')
      if (!deps.readCardPackFile) throw Object.assign(new Error('当前版本不支持素材包'), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
      return await deps.readCardPackFile(game.sessionId, pack, path)
    },

    // A speech channel of the plugin's own; players pick it in Tavern's voicing settings.
    speechProvider({ id, label, description = '', voices = [], defaultVoice = '', version = '', synthesize } = {}) {
      const owner = ownerOf(this)
      sectionName(id)
      if (typeof label !== 'string' || !label.trim() || label.trim().length > 30) throw new Error('label 必须是 1–30 字')
      if (typeof synthesize !== 'function') throw new TypeError('speechProvider 需要 synthesize 函数')
      if (!Array.isArray(voices) || voices.some(voice => typeof voice !== 'string')) throw new TypeError('voices 必须是文本数组')
      if (typeof version !== 'string' || version.length > 40) throw new TypeError('version 必须是不超过 40 字的字符串')
      const key = owner + '/' + id
      const entry = { id: key, owner, label: label.trim(), description: String(description).slice(0, 300), voices: voices.slice(0, 200), defaultVoice: String(defaultVoice || ''), version,
        synthesize: input => bounded(synthesize(input), '配音渠道 ' + key, REPLACEMENT_TIMEOUT_MS).catch(error => { recordError(null, owner, '配音', error); throw error }) }
      return register.call(this, speechProviders, key, entry, 'tavern.speechProvider()', '配音渠道 ' + id + ' 已注册')
    },

    // Picture generation Tavern itself asks for (stage asset packs). Tavern keeps no image channels:
    // status() → { ready, reason?, model?, maxReferences } describes the plugin's current channel;
    // generate({ prompt, references: [{ data, mediaType }], width, height, background, quality, signal })
    // → { data, mediaType }. A thrown error with requestMayHaveSucceeded === false says nothing was billed.
    imageProvider({ id, label, status, generate } = {}) {
      const owner = ownerOf(this)
      sectionName(id)
      if (typeof label !== 'string' || !label.trim() || label.trim().length > 30) throw new Error('label 必须是 1–30 字')
      if (typeof status !== 'function') throw new TypeError('imageProvider 需要 status 函数')
      if (typeof generate !== 'function') throw new TypeError('imageProvider 需要 generate 函数')
      const key = owner + '/' + id
      const entry = { id: key, owner, label: label.trim(),
        status: async () => {
          const value = await bounded(status(), '生图渠道 ' + key, POOL_TIMEOUT_MS)
          const maxReferences = Number.isSafeInteger(value?.maxReferences) && value.maxReferences > 0 ? value.maxReferences : 0
          return { ready: value?.ready === true, reason: String(value?.reason || '').slice(0, 200), model: String(value?.model || '').slice(0, 100), maxReferences }
        },
        generate: input => Promise.resolve().then(() => generate(input)).catch(error => { recordError(null, owner, '生图', error); throw error }) }
      return register.call(this, imageProviders, key, entry, 'tavern.imageProvider()', '生图渠道 ' + id + ' 已注册')
    },

    // Say a line in a character's voice on the channel the player chose: { url, mediaType }, or
    // null when voicing is off, the channel is the browser's own, or narration is set silent.
    async synthesizeSpeech({ gameId, speaker, text, emotion, narration } = {}) {
      const game = await requireGame(gameId)
      if (typeof text !== 'string' || !text.trim()) throw new TypeError('text 必须是非空字符串')
      const result = await deps.synthesizeSpeech?.(game.sessionId, { speaker: typeof speaker === 'string' ? speaker : '', text, emotion: typeof emotion === 'string' ? emotion : 'neutral', narration: narration === true })
      return result && result.url ? { url: result.url, mediaType: result.mediaType } : null
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

    // A named output of this plugin for a turn, which every plugin may read (readOutput): what an
    // event points at, such as a map's 信号强度 for a phone. Kept per turn and text version like
    // turn data, so a rollback or a regenerated reply drops it.
    async publishOutput({ gameId, turn, name, value } = {}) {
      const owner = ownerOf(this)
      if (typeof name !== 'string' || !OWN_EVENT_NAME.test(name)) throw new Error('产出名只能用小写字母、数字、点、下划线和连字符，最多 64 个字符')
      const game = await requireGame(gameId)
      const at = positiveTurn(turn)
      const key = await deps.currentKey(game.sessionId, at)
      if (!key) throw Object.assign(new Error('这一轮不存在'), { code: 'TAVERN_PLUGIN_TURN_UNAVAILABLE' })
      if (value === undefined) throw new TypeError('value 不能省略；要清除请传 null')
      if (JSON.stringify(value).length > MAX_OUTPUT) throw new Error('产出最多 64 KB')
      await deps.data.saveTurn({ chatId: game.chatId, owner: outputOwner(owner, name), turn: at, key, data: value })
      return { turn: at, textVersion: key }
    },

    // Another plugin's (or this one's) output: the latest one at or before `turn` (the latest of
    // all without it) whose turn still shows the text it was made for; null when there is none.
    async readOutput({ gameId, turn, plugin, name } = {}) {
      if (typeof plugin !== 'string' || !plugin || typeof name !== 'string' || !name) throw new TypeError('readOutput 需要 plugin 和 name')
      const game = await deps.resolveGame(gameIdOf(gameId))
      if (!game) return null
      const keys = new Map()
      for (const record of await deps.data.turnsUpTo({ chatId: game.chatId, owner: outputOwner(plugin, name), turn: turn === undefined ? Number.MAX_SAFE_INTEGER : positiveTurn(turn) })) {
        if (!keys.has(record.turn)) keys.set(record.turn, await deps.currentKey(game.sessionId, record.turn))
        if (keys.get(record.turn) === record.key) return { plugin, name, turn: record.turn, textVersion: record.key, value: structuredClone(record.data) }
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

    // The plugin's own data, not tied to a game: kept outside its folder, so updates keep it.
    async savePluginData({ data } = {}) {
      const owner = ownerOf(this)
      if (!deps.pluginData) throw new Error('当前 Tavern 不支持插件数据')
      await deps.pluginData.save(owner, data)
    },

    async readPluginData() {
      const owner = ownerOf(this)
      return deps.pluginData ? deps.pluginData.read(owner) : null
    },

    // Options of this plugin in each game's settings: Tavern draws them in 本局设置 and keeps the values with the game.
    gameSettings(input) {
      const owner = ownerOf(this)
      const entry = { owner, ...normalizeGameSettings(input) }
      return register.call(this, gameSettingDefs, owner, entry, 'tavern.gameSettings()', '插件 ' + owner + ' 已声明过本局配置项')
    },

    // The values in effect in one game: what the player chose, the declared default elsewhere.
    async getGameSettings({ gameId } = {}) {
      const owner = ownerOf(this)
      const entry = gameSettingDefs.get(owner)
      if (!entry) return {}
      const game = await requireGame(gameId)
      return settingValues(entry, (await deps.data.readSettings(game.chatId)).values[owner])
    },

    // Called with { gameId, values } after the player changes this plugin's settings in a game.
    onGameSettingsChanged(handler) {
      if (typeof handler !== 'function') throw new TypeError('onGameSettingsChanged 需要一个函数')
      const entry = { owner: ownerOf(this), handler }
      return owned(this, () => { settingHandlers.add(entry); return () => settingHandlers.delete(entry) }, 'tavern.onGameSettingsChanged()')
    },

    async getTurn({ gameId, turn } = {}) {
      const material = await deps.readTurn(gameIdOf(gameId), positiveTurn(turn))
      if (!material) return null
      await deps.media.issue(material.chatId, material.turn, material.key)
      return await snapshotOf(material)
    },

    async getTurnState({ gameId } = {}) {
      return await turnState(gameId)
    },

    // The plugin's latest state for its own page side (tavernUi.watchState): kept in memory, replaced on each call.
    async publishState({ gameId, name, data } = {}) {
      const owner = ownerOf(this)
      const game = await requireGame(gameId)
      sectionName(name)
      if ((await choicesFor(game.sessionId)).disabled.has(owner)) throw new Error('玩家在本局关闭了插件 ' + owner)
      const json = data === undefined ? 'null' : JSON.stringify(data)
      if (json === undefined || json.length > MAX_PUBLISHED_STATE) throw new Error('data 必须是不超过 256 KB 的 JSON 值')
      const key = game.sessionId + '\u0000' + owner + '\u0000' + name
      publishedStates.delete(key)
      publishedStates.set(key, JSON.parse(json))
      if (publishedStates.size > MAX_PUBLISHED_ENTRIES) publishedStates.delete(publishedStates.keys().next().value)
      try { deps.publishState?.(game.sessionId, owner, name) } catch {}
    },

    // An AbortSignal that aborts once this turn's textVersion is no longer the shown one
    // (rollback, regenerate, edit, the game removed). Already aborted when it is not current now.
    async versionSignal({ gameId, turn, textVersion } = {}) {
      const owner = ownerOf(this)
      const game = await requireGame(gameId)
      const at = positiveTurn(turn)
      if (typeof textVersion !== 'string' || !textVersion) throw new TypeError('textVersion 必须是 onTurnSettled 或 getTurn 给出的值')
      if (await deps.currentKey(game.sessionId, at) !== textVersion) return taskExecution.staleSignal()
      const watch = taskExecution.watchVersion(game.sessionId, at, textVersion, owner)
      // A plugin that unloads lets go of its watches.
      owned(this, () => () => watch.release(), 'tavern.versionSignal()')
      return watch.controller.signal
    },

    async getCardContext({ gameId, turn } = {}) {
      return await deps.readCardContext(await requireTurn(gameId, turn))
    },

    // The context Tavern's own story request used for this turn: the player input and each section, read-only.
    async getRequestContext({ gameId, turn } = {}) {
      const game = await requireGame(gameId)
      return structuredClone((await deps.readRequestContext?.(game.sessionId, positiveTurn(turn))) ?? null)
    },

    // The game's character card as Tavern plays it, read-only.
    async getCard({ gameId } = {}) {
      const game = await requireGame(gameId)
      const card = await deps.readCard(game.sessionId)
      if (!card) return null
      const { path: _where, ...data } = structuredClone(card)
      return data
    },

    // The picture of the game's character card, as a URL a page can show.
    async getCardImage({ gameId } = {}) {
      const game = await requireGame(gameId)
      return (await deps.readCardImage?.(game.sessionId)) ?? null
    },

    // This game's character design archive (人物设计档案): the one text and pictures share.
    async getCharacterDesigns({ gameId } = {}) {
      const game = await requireGame(gameId)
      return structuredClone(await deps.readCharacterDesigns(game.sessionId))
    },

    // Create or update one person in the archive, as the settlement's own design tool does:
    // all five fields are required, and the game's worldbook entry for them follows.
    async saveCharacterDesign({ gameId, name, aliases, identity, personality, appearance, speechStyle, narrativeRole } = {}) {
      const owner = ownerOf(this)
      const game = await requireGame(gameId)
      if ((await choicesFor(game.sessionId)).disabled.has(owner)) throw new Error('玩家在本局关闭了插件 ' + owner)
      if (aliases !== undefined && (!Array.isArray(aliases) || aliases.some(alias => typeof alias !== 'string'))) throw new TypeError('aliases 必须是文本数组')
      const result = await deps.saveCharacterDesign(game.sessionId, { name, ...(aliases ? { aliases } : {}), identity, personality, appearance, speechStyle, narrativeRole })
      if (result?.ok !== true) throw new Error(String(result?.error || '人物设计保存失败'))
      return { name: result.name }
    },

    // Every character card in the library, read-only. `id` is what card-taking methods accept.
    async listCards() {
      const scope = deps.cardScope ? (await deps.cardScope().catch(() => null))?.get(ownerOf(this)) : null
      return (await deps.listCards()).filter(card => !scope || scope.cards.includes(card.path)).map(card => ({
        id: card.path, name: card.name, fileName: String(card.path).split('/').pop(),
        imageUrl: card.hasImage ? '/api/dsh-tavern/card-image?path=' + encodeURIComponent(card.path) : '',
        script: card.script ? { title: card.script.title } : null,
        group: card.group || '', starred: Boolean(card.starred), error: card.readError || ''
      }))
    },

    // A card's full JSON as Tavern plays it (its working copy), read-only.
    async readCardRaw({ card } = {}) {
      const raw = await deps.readCardRaw(cardIdOf(card))
      if (!raw) throw Object.assign(new Error('人物卡不存在：' + card), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
      return structuredClone(raw)
    },

    // Change a card's working copy with JSON Pointer set/delete. The imported original is kept,
    // so the player can still restore it in Tavern.
    async updateCardRaw({ card, operations, expectedRevision } = {}) {
      const owner = ownerOf(this)
      const id = cardIdOf(card)
      if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw new TypeError('expectedRevision 必须是 cardRevision 返回的数字')
      if (!Array.isArray(operations) || !operations.length || operations.length > MAX_CARD_OPERATIONS) throw new TypeError('operations 需要 1–' + MAX_CARD_OPERATIONS + ' 项')
      const plain = operations.map((operation, index) => {
        const label = 'operations[' + index + ']'
        if (!operation || typeof operation !== 'object' || !['set', 'delete'].includes(operation.op)) throw new TypeError(label + '.op 必须是 set 或 delete')
        if (typeof operation.path !== 'string' || !operation.path.startsWith('/')) throw new TypeError(label + '.path 必须是以 / 开头的 JSON Pointer')
        if (operation.op === 'delete') return { op: 'delete', path: operation.path }
        if (operation.value === undefined) throw new TypeError(label + '.value 不能省略')
        const json = JSON.stringify(operation.value)
        if (json === undefined || json.length > MAX_CARD_VALUE) throw new TypeError(label + '.value 必须是不超过 2 MB 的 JSON 值')
        return { op: 'set', path: operation.path, value: JSON.parse(json) }
      })
      try {
        const result = await deps.updateCardRaw(id, plain, owner, expectedRevision === undefined ? {} : { expectedRevision })
        return typeof result === 'object' && result ? { changed: result.changed === true, revision: result.revision } : { changed: result === true }
      } catch (error) {
        if (error?.code === 'REVISION_CONFLICT') error.code = 'TAVERN_PLUGIN_REVISION_CONFLICT'
        throw error
      }
    },

    // The card's working-copy revision: a number that grows with every change (0 before the first).
    async cardRevision({ card } = {}) {
      return await deps.cardRevision(cardIdOf(card))
    },

    // Called with { card, revision } after a card's working copy changed (an edit, a restore, a plugin).
    onCardChanged(handler) {
      if (typeof handler !== 'function') throw new TypeError('onCardChanged 需要一个函数')
      const entry = { owner: ownerOf(this), handler }
      return owned(this, () => { cardHandlers.add(entry); return () => cardHandlers.delete(entry) }, 'tavern.onCardChanged()')
    },

    // A card's cast (avatars, expression sprites, voices), written as the player's stage page does.
    async setCastImage({ card, name, slot, data } = {}) {
      if (!(data instanceof Uint8Array)) throw new TypeError('data 必须是 Uint8Array 或 Buffer')
      await deps.editCast(cardIdOf(card), (cast, cardPath) => cast.setImage({ cardPath, name, slot, bytes: Buffer.from(data) }))
    },

    async removeCastImage({ card, name, slot } = {}) {
      await deps.editCast(cardIdOf(card), (cast, cardPath) => cast.removeImage({ cardPath, name, slot }))
    },

    async setCastCharacter({ card, name, rename, aliases } = {}) {
      await deps.editCast(cardIdOf(card), (cast, cardPath) => cast.setCharacter({ cardPath, name, rename, aliases }))
    },

    async setCastVoice({ card, name, provider, voice } = {}) {
      await deps.editCast(cardIdOf(card), (cast, cardPath) => cast.setVoice({ cardPath, name, provider, voice }))
    },

    async removeCastCharacter({ card, name } = {}) {
      await deps.editCast(cardIdOf(card), (cast, cardPath) => cast.removeCharacter({ cardPath, name }))
    },

    // Store an asset pack (files by path) and attach it to the card, replacing a pack with the same id.
    async saveCardPack({ card, id, format = '', title = '', files } = {}) {
      const id_ = cardIdOf(card)
      if (!Array.isArray(files) || !files.length || files.length > MAX_PACK_FILES) throw new TypeError('files 需要 1–' + MAX_PACK_FILES + ' 个 { path, data }')
      if (typeof format !== 'string' || typeof title !== 'string') throw new TypeError('format、title 必须是字符串')
      return await deps.saveCardPack(id_, { id, format, title, files: files.map(file => ({ path: file?.path, data: file?.data })) })
    },

    async removeCardPack({ card, id } = {}) {
      return await deps.removeCardPack(cardIdOf(card), String(id || ''))
    },

    // Import card files of a format Tavern does not read: convert hands back the card (and its files).
    cardImporter({ id, label, extensions, convert, imported } = {}) {
      const owner = ownerOf(this)
      sectionName(id)
      if (typeof label !== 'string' || !label.trim() || label.trim().length > 30) throw new Error('label 必须是 1–30 字')
      if (!Array.isArray(extensions) || !extensions.length || extensions.length > 10) throw new TypeError('extensions 需要 1–10 个扩展名')
      const list = extensions.map(item => String(item || '').toLowerCase())
      for (const item of list) {
        if (!CARD_EXTENSION.test(item)) throw new Error('扩展名要写成 .xxx 的形式：' + item)
        if (NATIVE_CARD_EXTENSIONS.has(item)) throw new Error(item + ' 由 Tavern 自己导入，插件不能接管')
        const taken = Array.from(cardImporters.values()).find(entry => entry.extensions.includes(item))
        if (taken) throw new Error(item + ' 已由插件 ' + taken.owner + ' 导入')
      }
      if (typeof convert !== 'function') throw new TypeError('cardImporter 需要 convert 函数')
      if (imported !== undefined && typeof imported !== 'function') throw new TypeError('imported 必须是函数')
      const entry = { owner, id, label: label.trim(), extensions: [...new Set(list)], convert, imported }
      return register.call(this, cardImporters, owner + '/' + id, entry, 'tavern.cardImporter()', '导入器 ' + id + ' 已注册')
    },

    // Where a tool this plugin registered with DSH shows: in play, in the card workbench, or both.
    // Tavern's own tools are not affected.
    toolNetwork({ name, capability = 'search' } = {}) {
      if (typeof name !== 'string' || !/^[A-Za-z0-9_.:-]{1,120}$/.test(name) || reservedToolNames.has(name) || name === 'web_fetch' || deps.isControlledTool?.(name)) throw new TypeError('toolNetwork 只能声明插件自己的工具')
      if (!['search', 'fetch'].includes(capability)) throw new TypeError('capability 只能是 search 或 fetch')
      return register.call(this, toolNetworks, name, { owner: ownerOf(this), capability }, 'tavern.toolNetwork()', '工具 ' + name + ' 的联网能力已被声明')
    },

    toolModes({ name, modes } = {}) {
      if (typeof name !== 'string' || !name || (deps.isControlledTool && deps.isControlledTool(name))) throw new TypeError('toolModes 只能设置插件自己注册的工具')
      if (!Array.isArray(modes) || !modes.length || modes.some(mode => !TOOL_MODES.includes(mode))) throw new TypeError('modes 只能是 play、card 中的一项或两项')
      return register.call(this, toolScopes, name, { owner: ownerOf(this), modes: [...new Set(modes)] }, 'tavern.toolModes()', '工具 ' + name + ' 的可见范围已被设置')
    },

    // A directory of the plugin's own skills (<dir>/<name>/SKILL.md), read-only, after Tavern's built-in ones.
    skillSource({ dir, role = 'card' } = {}) {
      const owner = ownerOf(this)
      if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new TypeError('dir 必须是绝对路径（例如 fileURLToPath(new URL(\'./skills\', import.meta.url))）')
      if (!['card', 'background'].includes(role)) throw new Error("role 只能是 'card' 或 'background'")
      if (typeof deps.addSkillRoot !== 'function') throw new Error('当前版本不支持插件 Skill')
      return owned(this, () => {
        let dispose = deps.addSkillRoot({ owner, dir: path.resolve(dir), role })
        // A card's own plugin lives in that card's games: its skills would reach every game, so they are not added.
        void (deps.cardScope ? deps.cardScope() : Promise.resolve(null)).then(scopes => {
          if (scopes?.has(owner)) { dispose(); dispose = () => {}; recordError(null, owner, 'Skill 来源', new Error('卡内插件不能添加 Skill')) }
        }, () => {})
        return () => dispose()
      }, 'tavern.skillSource()')
    },

    // Skills: Tavern's built-in ones read-only, the player's own ones writable.
    async listSkills() {
      return (await deps.skills.list()).map(skill => ({ name: skill.name, source: skill.source, description: skill.description || '' }))
    },

    async readSkill({ name } = {}) {
      const skill = await deps.skills.read(name)
      if (!skill) return null
      return { name: skill.name, source: skill.source, description: skill.description || '', content: skill.content, references: await deps.skills.referenceFiles(skill.name) }
    },

    // Create or replace one of the player's skills; references are the complete references/*.md set.
    async saveSkill({ name, description, body, references, overwrite = false } = {}) {
      for (const [key, value] of [['name', name], ['description', description], ['body', body]]) if (typeof value !== 'string' || !value.trim()) throw new TypeError('saveSkill 需要 ' + key)
      if (references !== undefined && !Array.isArray(references)) throw new TypeError('references 必须是数组')
      const saved = await deps.skills.write({ name, description, body, ...(references ? { references: references.map(ref => ({ path: ref?.path, content: ref?.content })) } : {}), overwrite: overwrite === true })
      return { name: saved.name, overwritten: saved.overwritten }
    },

    async removeSkill({ name } = {}) {
      const skill = await deps.skills.read(name)
      if (!skill) throw Object.assign(new Error('Skill 不存在：' + name), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
      if (skill.source !== 'user') throw new Error(skill.source === 'plugin' ? '只能删除玩家自己的 Skill，插件自带的 Skill 不能删除' : '只能删除玩家自己的 Skill，内置 Skill 不能删除')
      await deps.skills.remove(skill.name)
    },

    // Settled turns from..to (at most 50), each with the player's input and the shown text.
    async getHistory({ gameId, from, to } = {}) {
      const game = await requireGame(gameId)
      const first = positiveTurn(from), last = to === undefined ? first + MAX_HISTORY_TURNS - 1 : positiveTurn(to)
      if (last < first) throw new Error('to 不能小于 from')
      return await deps.readHistory(game.sessionId, first, Math.min(last, first + MAX_HISTORY_TURNS - 1))
    },

    // Replace the variables of the latest turn's shown version (after its settlement).
    async setVariables({ gameId, turn, textVersion, variables } = {}) {
      const owner = ownerOf(this)
      const material = await writableTurn(owner, gameId, turn, textVersion, 'setVariables')
      if (variables === null || typeof variables !== 'object' || Array.isArray(variables)) throw new TypeError('variables 必须是对象')
      const json = JSON.stringify(variables)
      if (json.length > MAX_VARIABLES) throw new Error('variables 不能超过 1 MB')
      const taskOperation = taskExecution.writeGuard(owner, material)
      taskOperation()
      await deps.writeVariables(material, JSON.parse(json), { taskOperation })
      await changed(material.sessionId)
      return { turn: material.turn, textVersion: material.key }
    },

    // Replace the latest turn's text; HTML blocks in it must stay as they are. Plugins then get onTurnSettled again.
    async editTurn({ gameId, turn, textVersion, text } = {}) {
      const owner = ownerOf(this)
      const material = await writableTurn(owner, gameId, turn, textVersion, 'editTurn')
      if (typeof text !== 'string' || !text.trim()) throw new TypeError('text 必须是非空字符串')
      if (text.length > MAX_EDIT_TEXT) throw new Error('text 太长')
      await deps.editText(material, text)
      return await snapshotOf(await requireTurn(material.sessionId, material.turn))
    },

    // A task of this game in a background session: a fresh one-off by default; with `member`, the
    // resident session of that member of this plugin (tavern.member), queued behind its other tasks.
    async runTask(input = {}) {
      return await taskExecution.runAgent(ownerOf(this), input)
    },

    // A resident background Agent of this plugin: one per game, its own Session and prompt cache.
    // Tasks given `member: name` run in it one at a time, beside Tavern's own members.
    // A resident member of this plugin: one Session per game. With `system` it has a prefix of
    // its own: that system prompt and `tools` (as in runTask) only, the same for every task, so
    // each runTask({ member }) is one message to it and brings no tools of its own. Without
    // `system` it shares Tavern's background prefix (card, world book), as before.
    member({ name, title, system, tools } = {}) {
      const owner = ownerOf(this)
      sectionName(name)
      const label = taskTitle(title, name)
      if (system !== undefined && (typeof system !== 'string' || !system.trim() || system.length > MAX_MEMBER_SYSTEM)) throw new Error('system 必须是 1–' + MAX_MEMBER_SYSTEM + ' 字的系统提示词')
      if (tools !== undefined && system === undefined) throw new Error('成员要有自己的工具，先给它 system')
      const checked = system === undefined ? undefined : taskExecution.checkTools(tools || [])
      return owned(this, () => registerPluginMember({ owner, name, title: label, system: system?.trim(), tools: checked }), 'tavern.member()')
    },

    // A task of this plugin run after each turn, before or after Tavern's own settlement.
    settlementTask({ name, title, phase = 'after', member, run } = {}) {
      const owner = ownerOf(this)
      sectionName(name)
      if (!Object.hasOwn(TASK_PHASES, phase)) throw new Error("phase 只能是 'before'、'parallel' 或 'after'")
      if (typeof run !== 'function') throw new TypeError('run 必须是函数')
      if (member !== undefined) sectionName(member)
      const entry = { owner, name, title: taskTitle(title, name), phase, member, run }
      return register.call(this, settlementTasks, taskKey(owner, name), entry, 'tavern.settlementTask()', '结算任务 ' + name + ' 已注册')
    },

    // A task the player starts by hand (a button in the game), or the plugin through startTask.
    manualTask({ name, title, description = '', input, member, run } = {}) {
      const owner = ownerOf(this)
      sectionName(name)
      if (typeof description !== 'string' || description.length > MAX_TASK_DESCRIPTION) throw new Error('description 最多 ' + MAX_TASK_DESCRIPTION + ' 字')
      if (input !== undefined && (!input || typeof input !== 'object' || typeof input.label !== 'string' || !input.label.trim())) throw new Error('input 要写成 { label, placeholder? }')
      if (typeof run !== 'function') throw new TypeError('run 必须是函数')
      const ask = input ? { label: input.label.trim().slice(0, 200), placeholder: typeof input.placeholder === 'string' ? input.placeholder.slice(0, 500) : '' } : null
      if (member !== undefined) sectionName(member)
      const entry = { owner, name, title: taskTitle(title, name), description: description.trim(), input: ask, member, run }
      return register.call(this, manualTasks, taskKey(owner, name), entry, 'tavern.manualTask()', '手动任务 ' + name + ' 已注册')
    },

    // Start one of this plugin's manual tasks, as if the player pressed its button.
    async startTask({ gameId, name, input } = {}) {
      const owner = ownerOf(this)
      await requireGame(gameId)
      return await deps.startManualTask({ gameId, key: taskKey(owner, String(name)), input })
    },

    async backgroundModel({ gameId } = {}) {
      const selection = await deps.backgroundModel(gameIdOf(gameId))
      if (!selection || !selection.provider || !selection.model) return null
      return {
        provider: String(selection.provider),
        model: String(selection.model),
        ...(selection.reasoningEffort ? { reasoningEffort: String(selection.reasoningEffort) } : {})
      }
    },

    async attach({ gameId, turn, textVersion, item } = {}) {
      const owner = ownerOf(this)
      const material = await requireTurn(gameId, turn)
      if (typeof textVersion !== 'string' || textVersion === '') throw new Error('textVersion 必须是 onTurnSettled 或 getTurn 给出的值')
      const record = await deps.media.attach({ chatId: material.chatId, sessionId: material.sessionId, owner, turn: material.turn, key: textVersion, currentKey: material.key, item })
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

    // `version` (第 5 版) removes one picture: 'current' (the latest earlier version takes its
    // place) or an index into `history`; the item goes with its last picture.
    async remove(itemId, { version } = {}) {
      const owner = ownerOf(this)
      const located = await locateItem(itemId).catch(() => null)
      if (!located) return false
      if (version === undefined) {
        const removed = await deps.media.remove({ chatId: located.chatId, owner, itemId })
        if (removed) await changed(located.sessionId)
        return removed
      }
      const item = await deps.media.find(located.chatId, itemId)
      if (!item || item.owner !== owner) return false
      await deps.media.removeVersion({ chatId: located.chatId, itemId, version: version === 'current' ? null : version })
      await changed(located.sessionId)
      return true
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

    candidateSection({ name, text } = {}) {
      const owner = ownerOf(this)
      sectionName(name); textOrFunction(text)
      return register.call(this, candidateSections, owner + '\u0000' + name, { owner, name, text }, 'tavern.candidateSection()', '候选说明段落 ' + name + ' 已注册')
    },

    compactionSection({ name, text } = {}) {
      const owner = ownerOf(this)
      sectionName(name); textOrFunction(text)
      return register.call(this, compactionSections, owner + '\u0000' + name, { owner, name, text }, 'tavern.compactionSection()', '压缩说明段落 ' + name + ' 已注册')
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

    // Take over the player's manual ledger consolidation (第 6 版); Tavern still applies the delta.
    replaceLedger({ consolidate } = {}) {
      const owner = ownerOf(this)
      if (typeof consolidate !== 'function') throw new TypeError('consolidate 必须是函数')
      return register.call(this, replacements.ledger, owner, { owner, consolidate }, 'tavern.replaceLedger()', '本插件已经注册了台账整理替换')
    },

    // Browser halves call their own host half through tavernUi.callHost(name, args).
    handle(name, handler) {
      const owner = ownerOf(this)
      if (typeof name !== 'string' || !HANDLER_NAME.test(name)) throw new Error('handle 的 name 只能用小写字母、数字和 . _ : / -，最多 96 个字符')
      if (typeof handler !== 'function') throw new TypeError('handle 需要一个函数')
      return register.call(this, handlers, name, { owner, handler }, 'tavern.handle()', '处理函数 ' + name + ' 已被注册，请在名字前加上插件名')
    },

    // Select references only; Tavern retains source ownership, rendering and mandatory entries.
    worldbookStrategy({ name, label, description = '', select } = {}) {
      const owner = ownerOf(this)
      sectionName(name)
      if (typeof select !== 'function') throw new TypeError('select 必须是函数')
      if (!deps.worldbookStrategies || !deps.worldbookStrategyEntries || !deps.projectWorldbookSelection) throw new Error('世界书策略服务不可用')
      const id = 'plugin-' + createHash('sha256').update(owner).digest('hex').slice(0, 16) + '-' + name
      return owned(this, () => {
        let active = true
        const dispose = deps.worldbookStrategies.register({ id, label, description, project: async input => {
          const gameId = input.chat?.sessionId
          const fallback = () => deps.projectWorldbookSelection(input, null)
          try {
            input.signal?.throwIfAborted()
            if (!active || !gameId || (await choicesFor(gameId)).disabled.has(owner)) return fallback()
            await guardScope(owner, { gameId })
            const worldBook = await deps.worldbookStrategyEntries(input)
            const entries = (worldBook?.view?.entries || []).filter(entry => entry.enabled !== false && !isMvuUpdateEntry(entry))
              .map(({ ref, sourceUid, sourcePath, title, content, constant, primaryKeys, secondaryKeys, order, position, depth, role }) =>
                ({ ref, sourceUid, sourcePath, title, content, constant, primaryKeys, secondaryKeys, order, position, depth, role }))
            const request = select(structuredClone({ gameId, userText: input.userText || '', purpose: input.purpose || 'generation', entries }))
            const result = await bounded(input.signal ? untilAborted(request, input.signal) : request, '世界书策略 ' + name, POOL_TIMEOUT_MS)
            input.signal?.throwIfAborted()
            if (!active || (await choicesFor(gameId)).disabled.has(owner)) return fallback()
            await guardScope(owner, { gameId })
            if (!Array.isArray(result) || result.some(ref => typeof ref !== 'string')) throw new Error('select 必须返回条目 ref 数组')
            const allowed = new Set(entries.map(entry => entry.ref))
            if (result.some(ref => !allowed.has(ref))) throw new Error('select 返回了不可用的条目 ref')
            return deps.projectWorldbookSelection({ ...input, worldBook }, [...new Set(result)])
          } catch (error) {
            input.signal?.throwIfAborted()
            recordError(gameId, owner, '世界书策略 ' + name, error)
            return fallback()
          }
        } })
        return () => { active = false; dispose() }
      }, 'tavern.worldbookStrategy()')
    },

    worldbookSource({ name, entries } = {}) {
      const owner = ownerOf(this)
      sectionName(name)
      if (typeof entries !== 'function') throw new TypeError('entries 必须是函数')
      return register.call(this, worldbookSources, owner + '\u0000' + name, { owner, name, entries }, 'tavern.worldbookSource()', '世界书来源 ' + name + ' 已注册')
    },

    // Entries joining this game's world book pool: Tavern's own recall decides what reaches a request.
    worldbookEntries({ name, entries } = {}) {
      const owner = ownerOf(this)
      sectionName(name)
      if (typeof entries !== 'function') throw new TypeError('entries 必须是函数')
      return register.call(this, worldbookPools, owner + '\u0000' + name, { owner, name, entries }, 'tavern.worldbookEntries()', '世界书条目来源 ' + name + ' 已注册')
    }
  }
  // Every call naming a game or a card passes the card-plugin scope check first.
  for (const key of Object.keys(service)) {
    const method = service[key]
    if (typeof method !== 'function' || method.constructor.name !== 'AsyncFunction') continue
    service[key] = async function (...args) {
      const input = args[0]
      if (input && typeof input === 'object' && (input.gameId !== undefined || input.card !== undefined)) await guardScope(ownerOf(this), input)
      return await method.apply(this, args)
    }
  }
  Object.defineProperty(service, TRACKER, { value: { associate: 'tavern', property: 'ctx' } })

  /** A browser half calling a host handler; JSON in, JSON out. */
  async function callHandler(name, args) {
    const entry = handlers.get(String(name || ''))
    if (!entry) throw Object.assign(new Error('没有名为 ' + name + ' 的插件处理函数（插件未加载，或宿主侧没有调用 tavern.handle 注册）'), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
    const input = args === undefined ? {} : args
    if (JSON.stringify(input).length > MAX_HANDLER_ARGS) throw new Error('callHost 的参数不能超过 256 KB')
    const gameId = typeof input?.gameId === 'string' ? input.gameId : ''
    if (gameId && (await choicesFor(gameId)).disabled.has(entry.owner)) throw new Error('玩家在本局关闭了插件 ' + entry.owner)
    let result
    try { result = await entry.handler(structuredClone(input)) }
    catch (error) { if (gameId) recordError(gameId, entry.owner, 'handle:' + name, error); throw error }
    const text = result === undefined ? undefined : JSON.stringify(result)
    if (text !== undefined && text.length > MAX_HANDLER_RESULT) throw new Error('插件处理函数的返回值不能超过 4 MB')
    return text === undefined ? null : JSON.parse(text)
  }

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
    dispatch(settledHandlers, { ...(await snapshotOf(material)), settledAt: Date.now() }, 'onTurnSettled', (await choicesFor(material.sessionId)).disabled)
  }

  /** Called by Tavern after settlement saved a turn's dialogue annotation. */
  function castAnnotated(gameId, annotation) {
    if (!gameId || castHandlers.size === 0) return
    void choicesFor(gameId).then(({ disabled }) => dispatch(castHandlers, { gameId, ...annotation }, 'onCastAnnotated', disabled))
  }

  /** Seam: the state a plugin last published for a game (null when none, or the plugin is off there). */
  async function pluginState(gameId, owner, name) {
    const key = String(gameId) + '\u0000' + String(owner) + '\u0000' + String(name)
    if (!publishedStates.has(key) || (await choicesFor(gameId)).disabled.has(String(owner))) return null
    return structuredClone(publishedStates.get(key))
  }

  /** Called by Tavern after a card's working copy changed; a card plugin hears only about its own card. */
  async function cardChanged(cardPath, revision) {
    if (cardHandlers.size === 0) return
    const scopes = deps.cardScope ? await deps.cardScope().catch(() => null) : null
    const elsewhere = new Set(Array.from(scopes || []).filter(([, scope]) => !scope.cards.includes(cardPath)).map(([name]) => name))
    dispatch(cardHandlers, { card: cardPath, revision }, 'onCardChanged', elsewhere)
  }

  /** Seam: the importer for a file name, by extension; a card's own plugins never import other cards. */
  async function cardImporterFor(name) {
    const extension = (/\.[^./\\]+$/.exec(String(name || '').toLowerCase()) || [''])[0]
    if (!extension || NATIVE_CARD_EXTENSIONS.has(extension)) return null
    const scopes = deps.cardScope ? await deps.cardScope().catch(() => null) : null
    const entry = Array.from(cardImporters.values()).find(item => item.extensions.includes(extension) && !scopes?.has(item.owner))
    return entry ? { owner: entry.owner, id: entry.id, label: entry.label } : null
  }

  /** Seam: run the importer for `name` on the file's bytes; the card and its files, checked. */
  async function convertCard(name, data) {
    const found = await cardImporterFor(name)
    const entry = found && cardImporters.get(found.owner + '/' + found.id)
    if (!entry) throw Object.assign(new Error('没有能导入这种文件的插件'), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
    let value
    try { value = await bounded(entry.convert({ name: String(name), data }), '导入器 ' + entry.label, REPLACEMENT_TIMEOUT_MS) }
    catch (error) { recordError(null, entry.owner, '导入人物卡', error); throw new Error('插件「' + entry.label + '」没能导入这个文件：' + String(error?.message || error)) }
    const fail = message => { throw new Error('插件「' + entry.label + '」交回的人物卡不合格：' + message) }
    if (!value || typeof value !== 'object' || !value.card || typeof value.card !== 'object' || Array.isArray(value.card)) fail('card 必须是人物卡 JSON 对象')
    const files = new Map()
    for (const [path, bytes] of Object.entries(value.files && typeof value.files === 'object' ? value.files : {})) {
      if (!(bytes instanceof Uint8Array)) fail('files 里的 ' + path + ' 必须是 Uint8Array 或 Buffer')
      files.set(path, Buffer.from(bytes))
    }
    const packs = value.packs === undefined ? [] : value.packs
    if (!Array.isArray(packs) || packs.length > 20) fail('packs 最多 20 个')
    return { owner: entry.owner, label: entry.label, card: structuredClone(value.card), files,
      packs: packs.map(pack => ({ id: pack?.id, format: String(pack?.format || ''), title: String(pack?.title || ''), files: Array.isArray(pack?.files) ? pack.files.map(file => ({ path: file?.path, data: file?.data })) : [] })),
      imported: entry.imported }
  }

  /** Seam: tell the importing plugin where its card went; its failure never undoes the import. */
  async function cardImported(converted, card) {
    if (typeof converted.imported !== 'function') return
    try { await bounded(converted.imported({ card }), '导入器收尾') }
    catch (error) { recordError(null, converted.owner, '导入人物卡收尾', error) }
  }

  /** Called by Tavern after the player removed pictures of a plugin's media item; only its owner hears. */
  function mediaRemoved(gameId, item, pictures, itemRemoved) {
    if (!gameId || !item?.owner || !pictures?.length) return
    const owners = new Set([...mediaRemovedHandlers].filter(entry => entry.owner !== item.owner).map(entry => entry.owner))
    dispatch(mediaRemovedHandlers, { gameId, itemId: item.id, kind: item.kind, turn: item.turn, textVersion: item.key, itemRemoved: itemRemoved === true, pictures }, 'onMediaRemoved', owners)
  }

  function gameRemoved(gameId) {
    if (!gameId) return
    for (const key of Array.from(publishedStates.keys())) if (key.startsWith(gameId + '\u0000')) publishedStates.delete(key)
    void checkVersions(gameId, { all: true })
    dispatch(removedHandlers, { gameId }, 'onGameRemoved')
  }

  const TIMELINE_KINDS = new Set(['rollback', 'undo-rollback', 'regenerate', 'edit', 'fork'])
  /** Called by Tavern after the story line of a game changed; the change is informational. */
  function timelineChanged(gameId, change = {}) {
    if (!gameId || !TIMELINE_KINDS.has(change.kind)) return
    if (change.kind !== 'fork') void checkVersions(gameId).catch(() => {})
    if (timelineHandlers.size === 0) return
    const turn = Number(change.turn)
    const known = Number.isSafeInteger(turn) && turn > 0
    void Promise.all([choicesFor(gameId), known ? deps.currentKey(gameId, turn).catch(() => null) : null]).then(([{ disabled }, textVersion]) => dispatch(timelineHandlers, {
      gameId, kind: change.kind, ...(known ? { turn } : {}), ...(textVersion ? { textVersion } : {}),
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

  /** Plugin data and media of one game, for a save package; null when there is nothing. */
  async function exportGame(chatId) {
    const [data, media] = await Promise.all([deps.data.snapshot(chatId), deps.media.snapshot(chatId)])
    return data || media ? { data, media } : null
  }

  /** A save package's plugin data and media into the imported game; a failure never undoes the import. */
  async function importGame({ targetChatId, targetSessionId, keyMap, data, media, attachment }) {
    const imported = { data: 0, media: 0 }
    try { if (data) imported.data = await deps.data.importInto({ source: data, targetChatId, keyMap }) }
    catch (error) { log.warn?.('dsh-tavern: 导入存档时恢复插件数据失败: ' + String(error?.message || error)) }
    try { if (media) imported.media = await deps.media.importInto({ source: media, targetChatId, targetSessionId, keyMap, attachment }) }
    catch (error) { log.warn?.('dsh-tavern: 导入存档时恢复插件媒体失败: ' + String(error?.message || error)) }
    return imported
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
    const signal = input.signal || new AbortController().signal
    const finish = input.onStart?.(entry.owner)
    try {
      signal.throwIfAborted()
      const fields = structuredClone({ gameId: input.gameId, turn: input.turn, text: input.text, posture: input.posture, tasks: input.tasks })
      const value = await bounded(untilAborted(entry.settle({ ...fields, signal }), signal), '结算替换', REPLACEMENT_TIMEOUT_MS)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('settle 必须返回对象')
      const posture = value.posture === undefined || value.posture === null ? '' : value.posture
      if (typeof posture !== 'string') throw new Error('posture 必须是字符串')
      if (input.tasks.posture && !posture.trim()) throw new Error('本局开启了姿势结算，settle 必须返回非空的 posture')
      if (posture.length > 8000) throw new Error('posture 不能超过 8000 字')
      return { owner: entry.owner, posture: posture.trim() }
    } catch (error) {
      // The player stopped the settlement: stop, do not fall back to Tavern's own.
      if (signal.aborted) throw signal.reason
      recordError(input.gameId, entry.owner, '结算替换（已改用 Tavern 自己的结算）', error)
      return null
    } finally {
      finish?.()
    }
  }

  /**
   * Seam: run the ledger replacement, if any. Returns { owner, delta } for Tavern to apply,
   * or null so Tavern consolidates by itself (no replacement, it declined, or it failed).
   * `apply(delta)` validates without saving and throws on a bad delta.
   */
  async function replaceLedger(input) {
    const entry = await replacementFor('ledger', input.gameId)
    if (!entry) return null
    const controller = new AbortController()
    ledgerRuns.set(input.gameId, controller)
    const finish = input.onStart?.(entry.owner)
    try {
      const fields = structuredClone({ gameId: input.gameId, from: input.from, through: input.through, text: input.text, ledger: input.ledger, rules: input.rules, tool: input.tool })
      const value = await bounded(untilAborted(entry.consolidate({ ...fields, signal: controller.signal }), controller.signal), '台账整理替换', REPLACEMENT_TIMEOUT_MS)
      if (value === null) return null
      if (!value || typeof value !== 'object' || Array.isArray(value) || !value.delta || typeof value.delta !== 'object' || Array.isArray(value.delta)) throw new Error('consolidate 必须返回 { delta } 或 null')
      input.apply(value.delta)
      return { owner: entry.owner, delta: structuredClone(value.delta) }
    } catch (error) {
      // The player stopped the background: stop, do not fall back to Tavern's own.
      if (controller.signal.aborted) throw controller.signal.reason
      recordError(input.gameId, entry.owner, '台账整理替换（已改用 Tavern 自己的整理）', error)
      return null
    } finally {
      if (ledgerRuns.get(input.gameId) === controller) ledgerRuns.delete(input.gameId)
      finish?.()
    }
  }

  function stopAllTasks(gameId) {
    const ledger = ledgerRuns.get(gameId)
    ledger?.abort(new Error('玩家停止了台账整理'))
    return stopTasks(gameId) || Boolean(ledger)
  }

  /** A game's manual plugin tasks and the options plugins add to its settings. */
  async function gamePlugins(gameId) {
    const choices = await choicesFor(gameId)
    const { game, disabled } = choices
    if (!game) return null
    const tasks = {
      manual: Array.from(manualTasks.values()).filter(entry => !disabled.has(entry.owner)).sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name))
        .map(entry => ({ key: taskKey(entry.owner, entry.name), plugin: entry.owner, title: entry.title, description: entry.description, input: entry.input })),
      running: runningTask(game.sessionId)
    }
    const stored = deps.data?.readSettings ? (await deps.data.readSettings(game.chatId).catch(() => null))?.values || {} : {}
    const settings = Array.from(gameSettingDefs.values()).filter(entry => !disabled.has(entry.owner)).sort((a, b) => a.owner.localeCompare(b.owner))
      .map(entry => ({ plugin: entry.owner, title: entry.title || entry.owner, card: choices.own.has(entry.owner), fields: structuredClone(entry.fields), values: settingValues(entry, stored[entry.owner]) }))
    return { tasks, settings }
  }

  /** Change one option a plugin added to this game's settings. */
  async function setGamePlugin(gameId, { setting } = {}) {
    const { game, disabled } = await choicesFor(gameId)
    if (!game) throw new Error('这一局不存在或不是游玩对话')
    const entry = setting && typeof setting === 'object' ? gameSettingDefs.get(String(setting.plugin)) : undefined
    const field = entry?.fields.find(item => item.key === setting.key)
    if (!entry || !field || disabled.has(entry.owner)) throw new Error('这一局没有这个插件配置项')
    const value = coerceSetting(field, setting.value)
    if (value === undefined) throw new Error('「' + field.label + '」的值不符合要求')
    await deps.data.updateSettings(game.chatId, settings => { settings.values[entry.owner] = { ...settings.values[entry.owner], [field.key]: value } })
    const values = settingValues(entry, (await deps.data.readSettings(game.chatId)).values[entry.owner])
    dispatch(Array.from(settingHandlers).filter(item => item.owner === entry.owner), { gameId: game.sessionId, values }, '本局配置项', disabled)
    deps.settingsChanged?.(game.sessionId, entry.owner)
    return gamePlugins(gameId)
  }

  /** One plugin's settings in a game, for its page side; null when it declared none. */
  async function pluginGameSettings(gameId, owner) {
    const entry = gameSettingDefs.get(String(owner))
    if (!entry) return null
    const { game, disabled } = await choicesFor(gameId)
    if (!game || disabled.has(entry.owner)) return null
    return settingValues(entry, (await deps.data.readSettings(game.chatId)).values[entry.owner])
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

  /** Seam: plugin entries for a game's world book pool, validated, in a stable order. Each read asks the plugins again. */
  // The pool is read several times a turn: report each source's problem once until it changes.
  const poolReports = new Map()
  function reportPool(gameId, pool, stage, error) {
    const key = gameId + '\u0000' + pool.owner + '\u0000' + pool.name
    const message = error ? String(error?.message || error) : ''
    if (poolReports.get(key) === message) return
    if (message) poolReports.set(key, message); else poolReports.delete(key)
    if (poolReports.size > 1000) poolReports.delete(poolReports.keys().next().value)
    if (error) recordError(gameId, pool.owner, stage, error)
  }

  async function worldbookPoolEntries({ gameId, turn }) {
    if (!worldbookPools.size) return []
    const { disabled } = await choicesFor(gameId)
    const result = []
    for (const pool of Array.from(worldbookPools.values()).filter(entry => !disabled.has(entry.owner)).sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name))) {
      const stage = '世界书条目 ' + pool.name
      let entries
      try { entries = await bounded(pool.entries(structuredClone({ gameId, turn })), stage, POOL_TIMEOUT_MS) }
      catch (error) { reportPool(gameId, pool, stage, error); continue }
      if (!Array.isArray(entries)) { reportPool(gameId, pool, stage, entries == null ? null : new Error('entries 要返回数组')); continue }
      const seen = new Set(), problems = []
      for (const entry of entries.slice(0, MAX_POOL_ENTRIES)) {
        const id = typeof entry?.id === 'string' ? entry.id : ''
        const content = typeof entry?.content === 'string' ? entry.content.trim() : ''
        if (!POOL_ENTRY_ID.test(id) || seen.has(id)) { problems.push('条目 id 缺失、格式不对或重复：' + String(id).slice(0, 64)); continue }
        seen.add(id)
        if (!content) continue
        if (content.length > MAX_WORLDBOOK_ENTRY) { problems.push('条目 ' + id + ' 超过 ' + MAX_WORLDBOOK_ENTRY + ' 字'); continue }
        // The template runtime only knows the bound books; a plugin entry is plain text.
        if (/<%[=_-]?[\s\S]*?%>/.test(content)) { problems.push('条目 ' + id + ' 含 EJS 模板，插件条目不支持'); continue }
        const keys = list => (Array.isArray(list) ? list : []).filter(key => typeof key === 'string' && key.trim()).slice(0, 50).map(key => key.trim().slice(0, 200))
        result.push({ owner: pool.owner, source: pool.name, id, content,
          title: typeof entry.title === 'string' ? entry.title.trim().slice(0, 200) : '',
          keys: keys(entry.keys), secondaryKeys: keys(entry.secondaryKeys),
          constant: entry.constant === true, force: entry.force === true })
      }
      if (entries.length > MAX_POOL_ENTRIES) problems.push('每个来源最多 ' + MAX_POOL_ENTRIES + ' 条，多出的已忽略')
      reportPool(gameId, pool, stage, problems.length ? new Error(problems.slice(0, 3).join('；')) : null)
    }
    return result
  }

  /** Seam: notes plugins add to the background candidate task. */
  const candidate = Object.freeze({
    async sections({ gameId, turn }) { return collectSections(candidateSections, { gameId, turn }, '候选说明段落', (await choicesFor(gameId)).disabled) }
  })

  /** Seam: notes plugins add to a story game's summary instruction. */
  async function compactionNotes({ gameId }) {
    return collectSections(compactionSections, { gameId }, '压缩说明段落', (await choicesFor(gameId)).disabled)
  }

  /** Seam: the characters plugins offer to a game's cast, checked; a failing source is skipped. */
  async function castAssetSources({ gameId }) {
    const { disabled } = await choicesFor(gameId).catch(() => ({ disabled: new Set() }))
    const url = value => typeof value === 'string' && value.length <= 4096 && /^(\/|https?:\/\/|data:image\/)/.test(value) ? value : ''
    const text = (value, max) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : ''
    const pictures = map => Object.fromEntries(Object.entries(map && typeof map === 'object' ? map : {}).slice(0, 64)
      .map(([emotion, value]) => [text(emotion, 40), url(value)]).filter(([emotion, value]) => emotion && value))
    const result = []
    const entries = Array.from(castSources.values()).filter(entry => !disabled.has(entry.owner)).sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name))
    for (const entry of entries) {
      let list
      try { list = await bounded(entry.characters({ gameId }), '角色素材来源 ' + entry.name) }
      catch (error) { recordError(gameId, entry.owner, '角色素材来源 ' + entry.name, error); continue }
      for (const item of Array.isArray(list) ? list.slice(0, MAX_CAST_SOURCE_CHARACTERS) : []) {
        const name = text(item?.name, 60)
        if (!name) continue
        result.push({ name, aliases: (Array.isArray(item.aliases) ? item.aliases : []).map(alias => text(alias, 60)).filter(Boolean).slice(0, 20),
          avatarUrl: url(item.avatarUrl), avatars: pictures(item.avatars), sprites: pictures(item.sprites), plugin: entry.owner })
      }
    }
    return result
  }

  /** Seam: what the background settlement task offers the model on behalf of plugins. */
  const settlement = Object.freeze({
    /** Tool definitions, in a stable order: they sit in the cached request prefix. */
    tools() { return Array.from(settlementTools.values()).sort((a, b) => a.name.localeCompare(b.name)).map(entry => entry.tool) },
    has(name) { return settlementTools.has(name) },
    /** This game's plugin tools, split by whether the player has their plugin on. */
    async toolNames({ gameId }) {
      const { disabled } = await choicesFor(gameId).catch(() => ({ disabled: new Set() }))
      const names = Array.from(settlementTools.values()).sort((a, b) => a.name.localeCompare(b.name))
      return { available: names.filter(entry => !disabled.has(entry.owner)).map(entry => entry.name), unavailable: names.filter(entry => disabled.has(entry.owner)).map(entry => entry.name) }
    },
    // Sections see the turn being settled: its text is not readable through getTurn until settlement ends.
    async sections({ gameId, turn }) {
      const pending = deps.readPendingTurn ? await deps.readPendingTurn(gameId).catch(() => null) : null
      const current = pending && pending.turn === turn ? { text: pending.text, textVersion: pending.key } : {}
      return collectSections(settlementSections, { gameId, turn, ...current }, '结算说明段落', (await choicesFor(gameId)).disabled)
    },
    /** One settlement run's dispatcher: bounded calls, errors returned to the model, never thrown. */
    calls({ gameId, turn }) {
      let count = 0
      const choices = choicesFor(gameId).catch(() => ({ disabled: new Set() }))
      return async function call(name, args) {
        const entry = settlementTools.get(name)
        if (!entry) return JSON.stringify({ ok: false, retryable: false, error: '插件工具 ' + name + ' 已不可用' })
        if ((await choices).disabled.has(entry.owner)) return JSON.stringify({ ok: false, retryable: false, error: '玩家在本局关闭了插件 ' + entry.owner + '，本轮不要调用它的工具；以后各轮以结算任务里列出的可用插件工具为准' })
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

  /** Seam: where a plugin-registered DSH tool may show; null when its plugin set nothing. */
  function toolModesFor(name) {
    const entry = toolScopes.get(name)
    return entry ? entry.modes.slice() : null
  }

  async function mvuProvider(input = {}) {
    const gameId = gameIdOf(input.gameId)
    const material = deps.readPendingTurn ? await deps.readPendingTurn(gameId).catch(() => null) : null
    if (!material || material.turn !== Number(input.turn) || typeof material.key !== 'string') return null
    const choices = await choicesFor(gameId)
    const entries = Array.from(mvuSettlementProviders.values()).filter(entry => choices.own.has(entry.owner))
      .sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name))
    if (entries.length !== 1) {
      if (entries.length > 1) recordError(gameId, entries.map(entry => entry.owner).join(', '), 'mvuSettlementProvider', new Error('多个卡内提供器候选，拒绝随机接管'))
      return null
    }
    const entry = entries[0]
    const { signal, ...payload } = input
    let result
    try {
      signal?.throwIfAborted()
      result = await boundedWithSignal(Promise.resolve().then(() => entry.settle({ ...structuredClone(payload), textVersion: material.key, ...(signal ? { signal } : {}) })),
        'MVU 提供器 ' + entry.owner, signal)
    } catch (error) {
      recordError(gameId, entry.owner, 'mvuSettlementProvider', error)
      throw error
    }
    // A callback may finish after unload, a card switch, or the canonical text changes.
    if (mvuSettlementProviders.get(entry.owner + '\u0000' + entry.name) !== entry) return null
    const latest = await choicesFor(gameId)
    if (!latest.own.has(entry.owner) || latest.disabled.has(entry.owner)) return null
    const current = await deps.readPendingTurn?.(gameId).catch(() => null)
    if (!current || current.turn !== material.turn || current.key !== material.key) return null
    if (result === null || result === false) return null
    if (!result || typeof result !== 'object' || !Array.isArray(result.operations)) {
      throw new Error('MVU 提供器必须返回 { operations } 或 null')
    }
    return { owner: entry.owner, operations: structuredClone(result.operations) }
  }

  async function mvuProviderActive({ gameId, owner } = {}) {
    const choices = await choicesFor(gameId)
    const entries = Array.from(mvuSettlementProviders.values()).filter(entry => choices.own.has(entry.owner))
    return entries.length === 1 && entries[0].owner === owner && !choices.disabled.has(owner)
  }

  function mvuProviderRegistered(owner) {
    return typeof owner === 'string' && Array.from(mvuSettlementProviders.values()).some(entry => entry.owner === owner)
  }

  /** Plugins' settlement and manual tasks, for the 后台任务 page's 任务目录. */
  function taskCatalog() {
    const item = (entry, kind) => ({
      task: 'plugin:' + entry.owner + ':' + entry.name, name: entry.title, plugin: entry.owner,
      member: entry.member ? pluginMemberId(entry.owner, entry.member) : '', lane: entry.member ? 'resident' : 'ephemeral',
      does: kind === 'manual' ? (entry.description || '插件的手动任务。') : '插件的结算任务，每轮' + TASK_PHASES[entry.phase] + '运行。',
      trigger: kind === 'manual' ? '玩家点插件的按钮，或插件自己启动。' : '每轮变量结算' + (entry.phase === 'parallel' ? '时' : entry.phase === 'before' ? '前' : '后') + '。',
      lock: kind === 'manual'
    })
    // A job's start line comes from its declaration (describeTasks), so it brings none.
    const job = entry => ({ task: entry.id, name: entry.title, plugin: entry.owner,
      member: entry.member ? pluginMemberId(entry.owner, entry.member) : '', lane: entry.member ? 'resident' : 'ephemeral',
      does: entry.description || '插件声明的任务。', manual: '', needs: entry.needs.map(need => 'plugin:' + need), lock: false })
    return [...Array.from(settlementTasks.values(), entry => item(entry, 'settlement')), ...Array.from(manualTasks.values(), entry => item(entry, 'manual')), ...Array.from(jobs.values(), job)]
      .sort((a, b) => a.plugin.localeCompare(b.plugin) || a.task.localeCompare(b.task))
  }

  return Object.freeze({ taskCatalog, service, mvuProvider, mvuProviderActive, mvuProviderRegistered, capabilities, toolModesFor, toolNetworkFor: name => toolNetworks.get(name)?.capability, callHandler, turnState, exportGame, importGame, turnSettled, castAnnotated, castAssetSources, gameRemoved, mediaRemoved,
    speechProviders: () => Array.from(speechProviders.values()), imageProviders: () => Array.from(imageProviders.values()), timelineChanged, checkVersions, pluginState, cardChanged, cardImporterFor, convertCard, cardImported, gameForked, forkTurns, promptSections, turnContext, worldbookPoolEntries, settlement, candidate, compactionNotes, replaceSettlement, replaceLedger,
    runSettlementTasks, manualTaskFor, runManualTask, stopTasks: stopAllTasks, runningTask, gamePlugins, setGamePlugin, pluginGameSettings })
}
