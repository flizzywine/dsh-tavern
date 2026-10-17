import { AsyncLocalStorage } from 'node:async_hooks'
import { publicPluginMedia, pluginMediaSession } from './domain/plugin-media.js'

// The public `tavern` service for third-party DSH plugins (docs/plugin-api.md).
// Only additive changes are allowed here: published plugins depend on every
// name and field. Internals are reached through `deps`, never exposed.
export const TAVERN_PLUGIN_API_VERSION = 2
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
// Read on every send, settlement and world book search: a slow plugin must not hold the game up.
const POOL_TIMEOUT_MS = 5000
const POOL_ENTRY_ID = /^[A-Za-z0-9._-]{1,64}$/
const PLUGIN_TIMEOUT_MS = 30000
const REPLACEMENT_TIMEOUT_MS = 120000
const MAX_ERRORS_PER_GAME = 30
const MAX_VARIABLES = 1024 * 1024
const MAX_EDIT_TEXT = 200000
const MAX_HISTORY_TURNS = 50
const MAX_TASK_PROMPT = 20000
const MAX_TASK_TOOLS = 8
const MAX_TOOL_CALLS_PER_TASK = 16
const TASK_TIMEOUT_MS = 600000
const SETTLEMENT_TASK_TIMEOUT_MS = 300000
const MANUAL_TASK_TIMEOUT_MS = 600000
const MAX_TASK_TITLE = 40
const MAX_TASK_DESCRIPTION = 500
const MAX_CARD_OPERATIONS = 200
const MAX_CARD_VALUE = 2 * 1024 * 1024
const TOOL_MODES = ['play', 'card']
const MAX_TASK_INPUT = 4000
const TASK_PHASES = Object.freeze({ before: '结算前', after: '结算后' })
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

function untilAborted(promise, signal) {
  let abort
  return Promise.race([Promise.resolve(promise), new Promise((_resolve, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
  })]).finally(() => signal.removeEventListener('abort', abort))
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

export function createTavernPluginApi(deps) {
  const settledHandlers = new Set()
  const removedHandlers = new Set()
  const timelineHandlers = new Set()
  const castHandlers = new Set()
  const speechProviders = new Map()
  const sections = new Map()
  const turnSections = new Map()
  const settlementSections = new Map()
  const settlementTools = new Map()
  const worldbookSources = new Map()
  const worldbookPools = new Map()
  const handlers = new Map()
  const candidateSections = new Map()
  const compactionSections = new Map()
  const replacements = { settlement: new Map() }
  const settlementTasks = new Map()
  const manualTasks = new Map()
  const toolScopes = new Map()
  // The plugin task running in each game (one at a time), and settlement phases already run per text version.
  const taskRuns = new Map()
  const taskContext = new AsyncLocalStorage()
  const phasesRan = new Set()
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
    return { game, disabled: new Set(settings?.disabled || []), replacements: settings?.replacements || {},
      disabledTasks: new Set(settings?.disabledTasks || []), taskOrder: settings?.taskOrder || [] }
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

    // Who says each quoted line and how they feel (docs/design/cast-presentation.md), annotated by settlement.
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

    // A speech channel of the plugin's own; players pick it in Tavern's voicing settings.
    speechProvider({ id, label, description = '', voices = [], defaultVoice = '', synthesize } = {}) {
      const owner = ownerOf(this)
      sectionName(id)
      if (typeof label !== 'string' || !label.trim() || label.trim().length > 30) throw new Error('label 必须是 1–30 字')
      if (typeof synthesize !== 'function') throw new TypeError('speechProvider 需要 synthesize 函数')
      if (!Array.isArray(voices) || voices.some(voice => typeof voice !== 'string')) throw new TypeError('voices 必须是文本数组')
      const key = owner + '/' + id
      const entry = { id: key, owner, label: label.trim(), description: String(description).slice(0, 300), voices: voices.slice(0, 200), defaultVoice: String(defaultVoice || ''),
        synthesize: input => bounded(synthesize(input), '配音渠道 ' + key, REPLACEMENT_TIMEOUT_MS).catch(error => { recordError(null, owner, '配音', error); throw error }) }
      return register.call(this, speechProviders, key, entry, 'tavern.speechProvider()', '配音渠道 ' + id + ' 已注册')
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
      return await snapshotOf(material)
    },

    async getTurnState({ gameId } = {}) {
      return await turnState(gameId)
    },

    async getCardContext({ gameId, turn } = {}) {
      return await deps.readCardContext(await requireTurn(gameId, turn))
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
      return (await deps.listCards()).map(card => ({
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
    async updateCardRaw({ card, operations } = {}) {
      const owner = ownerOf(this)
      const id = cardIdOf(card)
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
      return { changed: await deps.updateCardRaw(id, plain, owner) }
    },

    // Where a tool this plugin registered with DSH shows: in play, in the card workbench, or both.
    // Tavern's own tools are not affected.
    toolModes({ name, modes } = {}) {
      if (typeof name !== 'string' || !name || (deps.isControlledTool && deps.isControlledTool(name))) throw new TypeError('toolModes 只能设置插件自己注册的工具')
      if (!Array.isArray(modes) || !modes.length || modes.some(mode => !TOOL_MODES.includes(mode))) throw new TypeError('modes 只能是 play、card 中的一项或两项')
      return register.call(this, toolScopes, name, { owner: ownerOf(this), modes: [...new Set(modes)] }, 'tavern.toolModes()', '工具 ' + name + ' 的可见范围已被设置')
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
      if (skill.source !== 'user') throw new Error('只能删除玩家自己的 Skill，内置 Skill 不能删除')
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
      const task = taskContext.getStore()
      // Captured async context is not authority: stopped/finished callbacks must
      // not regain write access once the game becomes idle or a new task starts.
      const taskOperation = () => {
        if (!task) return null
        if (task.owner !== owner || task.gameId !== material.sessionId || task.textVersion !== material.key
          || task.phase === 'before' || task.signal.aborted || taskRuns.get(task.gameId) !== task.run || !task.operationId) {
          throw Object.assign(new Error('插件任务已结束或不属于这一轮'), { code: 'TAVERN_PLUGIN_STALE_VERSION' })
        }
        return task.operationId
      }
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

    // A one-off task in a fresh background session of this game: same background model,
    // card background and world book as Tavern's own tasks, never Tavern's resident session.
    async runTask(input = {}) {
      return await runTaskAs(ownerOf(this), input)
    },

    // A task of this plugin run after each turn, before or after Tavern's own settlement.
    settlementTask({ name, title, phase = 'after', run } = {}) {
      const owner = ownerOf(this)
      sectionName(name)
      if (!Object.hasOwn(TASK_PHASES, phase)) throw new Error("phase 只能是 'before' 或 'after'")
      if (typeof run !== 'function') throw new TypeError('run 必须是函数')
      const entry = { owner, name, title: taskTitle(title, name), phase, run }
      return register.call(this, settlementTasks, taskKey(owner, name), entry, 'tavern.settlementTask()', '结算任务 ' + name + ' 已注册')
    },

    // A task the player starts by hand (a button in the game), or the plugin through startTask.
    manualTask({ name, title, description = '', input, run } = {}) {
      const owner = ownerOf(this)
      sectionName(name)
      if (typeof description !== 'string' || description.length > MAX_TASK_DESCRIPTION) throw new Error('description 最多 ' + MAX_TASK_DESCRIPTION + ' 字')
      if (input !== undefined && (!input || typeof input !== 'object' || typeof input.label !== 'string' || !input.label.trim())) throw new Error('input 要写成 { label, placeholder? }')
      if (typeof run !== 'function') throw new TypeError('run 必须是函数')
      const ask = input ? { label: input.label.trim().slice(0, 200), placeholder: typeof input.placeholder === 'string' ? input.placeholder.slice(0, 500) : '' } : null
      const entry = { owner, name, title: taskTitle(title, name), description: description.trim(), input: ask, run }
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

    // Browser halves call their own host half through tavernUi.callHost(name, args).
    handle(name, handler) {
      const owner = ownerOf(this)
      if (typeof name !== 'string' || !HANDLER_NAME.test(name)) throw new Error('handle 的 name 只能用小写字母、数字和 . _ : / -，最多 96 个字符')
      if (typeof handler !== 'function') throw new TypeError('handle 需要一个函数')
      return register.call(this, handlers, name, { owner, handler }, 'tavern.handle()', '处理函数 ' + name + ' 已被注册，请在名字前加上插件名')
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
  Object.defineProperty(service, TRACKER, { value: { associate: 'tavern', property: 'ctx' } })

  // A one-off task in a fresh background session of this game: same background model,
  // card background and world book as Tavern's own tasks, never Tavern's resident session.
  async function runTaskAs(owner, { gameId, prompt, tools = [], signal } = {}) {
    const game = await requireGame(gameId)
    if ((await choicesFor(game.sessionId)).disabled.has(owner)) throw new Error('玩家在本局关闭了插件 ' + owner)
    if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('prompt 必须是非空字符串')
    if (prompt.length > MAX_TASK_PROMPT) throw new Error('prompt 不能超过 20000 字')
    if (!Array.isArray(tools) || tools.length > MAX_TASK_TOOLS) throw new Error('tools 最多 8 个')
    const byName = new Map()
    for (const tool of tools) {
      if (!tool || typeof tool.name !== 'string' || !TOOL_NAME.test(tool.name)) throw new Error('工具名只能用小写字母、数字和下划线，以字母开头，3–48 个字符')
      if (reservedToolNames.has(tool.name) || byName.has(tool.name)) throw new Error('工具名 ' + tool.name + ' 已被占用')
      if (typeof tool.description !== 'string' || !tool.description.trim()) throw new Error('工具 ' + tool.name + ' 需要 description')
      if (!tool.parameters || typeof tool.parameters !== 'object' || tool.parameters.type !== 'object') throw new Error('工具 ' + tool.name + ' 的 parameters 必须是 type 为 object 的 JSON Schema')
      if (typeof tool.execute !== 'function') throw new TypeError('工具 ' + tool.name + ' 需要 execute 函数')
      byName.set(tool.name, tool)
    }
    let calls = 0
    const call = async (name, args) => {
      const tool = byName.get(name)
      if (!tool) return JSON.stringify({ ok: false, error: '没有这个工具：' + name })
      if (++calls > MAX_TOOL_CALLS_PER_TASK) return JSON.stringify({ ok: false, error: '工具调用次数已达上限，请直接给出结果' })
      try {
        const value = await bounded(tool.execute(structuredClone(args ?? {})), '插件工具 ' + name)
        return (typeof value === 'string' ? value : JSON.stringify(value ?? { ok: true })).slice(0, MAX_TOOL_RESULT)
      } catch (error) {
        recordError(game.sessionId, owner, '后台任务工具 ' + name, error)
        return JSON.stringify({ ok: false, error: String(error?.message || error).slice(0, 500) })
      }
    }
    try {
      const result = await bounded(deps.runTask({ gameId: game.sessionId, owner, prompt: prompt.trim(),
        tools: Array.from(byName.values()).map(tool => ({ name: tool.name, description: tool.description.trim(), parameters: structuredClone(tool.parameters) })),
        call, signal }), '后台任务', TASK_TIMEOUT_MS)
      return { text: String(result?.text || '') }
    } catch (error) {
      if (!signal?.aborted) recordError(game.sessionId, owner, '后台任务', error)
      throw error
    }
  }

  /** One plugin task under Tavern's watch: bounded, stoppable, its failure recorded for the panel. */
  async function executeTask(entry, kind, context, signal, onStart, operationId) {
    const controller = new AbortController()
    const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
    const run = { plugin: entry.owner, task: entry.name, title: entry.title, kind, startedAt: Date.now(), controller }
    taskRuns.set(context.gameId, run)
    const finish = onStart?.(entry.owner + ' · ' + entry.title)
    const stage = (kind === 'manual' ? '手动任务 ' : '结算任务 ') + entry.title
    const runAgent = (input = {}) => runTaskAs(entry.owner, { ...input, gameId: context.gameId, signal: combined })
    try {
      combined.throwIfAborted()
      const scope = { owner: entry.owner, gameId: context.gameId, textVersion: context.textVersion, phase: context.phase, run, signal: combined, operationId }
      const work = taskContext.run(scope, () => entry.run({ ...structuredClone(context), signal: combined, runAgent }))
      await bounded(untilAborted(work, combined), stage,
        kind === 'manual' ? MANUAL_TASK_TIMEOUT_MS : SETTLEMENT_TASK_TIMEOUT_MS)
      return true
    } catch (error) {
      if (!combined.aborted) recordError(context.gameId, entry.owner, stage, error)
      return false
    } finally {
      // A finished, failed or stopped task: whatever it left running is stopped too.
      controller.abort()
      if (taskRuns.get(context.gameId) === run) taskRuns.delete(context.gameId)
      finish?.()
    }
  }

  function orderedTasks(phase, choices) {
    const rank = key => { const at = choices.taskOrder.indexOf(key); return at < 0 ? Infinity : at }
    return Array.from(settlementTasks.values()).filter(entry => entry.phase === phase && !choices.disabled.has(entry.owner))
      .sort((a, b) => rank(taskKey(a.owner, a.name)) - rank(taskKey(b.owner, b.name)) || a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name))
  }

  /**
   * Seam: run a game's settlement tasks of one phase, once per text version, one after another.
   * `around(work)` lets Tavern wrap the run (only called when there is something to run).
   */
  async function runSettlementTasks({ gameId, phase, signal, onStart, around }) {
    if (!settlementTasks.size) return
    const choices = await choicesFor(gameId)
    const tasks = orderedTasks(phase, choices).filter(entry => !choices.disabledTasks.has(taskKey(entry.owner, entry.name)))
    if (!tasks.length) return
    const material = phase === 'before' ? await deps.readPendingTurn(gameId) : await deps.readLatestSettledTurn(gameId)
    if (!material || material.greeting) return
    const id = phase + '\u0000' + material.chatId + '\u0000' + material.key
    if (phasesRan.has(id)) return
    phasesRan.add(id)
    if (phasesRan.size > 2000) phasesRan.delete(phasesRan.values().next().value)
    let started = false
    const work = async operationId => {
      started = true
      for (const entry of tasks) {
        if (signal?.aborted) return
        // Read again for each task: an earlier one may have changed the variables.
        const current = phase === 'before' ? await deps.readPendingTurn(gameId) : await deps.readLatestSettledTurn(gameId)
        if (!current || current.key !== material.key) return
        await executeTask(entry, 'settlement', { ...(await snapshotOf(current)), phase }, signal, onStart, operationId)
      }
    }
    try { await (around ? around(work) : work()) }
    catch (error) {
      if (!started) phasesRan.delete(id)
      throw error
    }
  }

  /** The manual task `key` as the player may start it in this game; throws when it can't run. */
  async function manualTaskFor(gameId, key, input) {
    const entry = manualTasks.get(String(key || ''))
    if (!entry) throw Object.assign(new Error('没有这个插件任务（插件未加载，或没有用 tavern.manualTask 注册）'), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
    if ((await choicesFor(gameId)).disabled.has(entry.owner)) throw new Error('玩家在本局关闭了插件 ' + entry.owner)
    if (input !== undefined && input !== null && typeof input !== 'string') throw new TypeError('input 必须是字符串')
    if (typeof input === 'string' && input.length > MAX_TASK_INPUT) throw new Error('input 不能超过 ' + MAX_TASK_INPUT + ' 字')
    if (taskRuns.has(gameId)) throw new Error('插件任务「' + taskRuns.get(gameId).title + '」正在运行，请等它完成')
    return entry
  }

  /** Seam: run a manual task Tavern has admitted (see manualTaskFor); resolves true when it succeeded. */
  async function runManualTask({ gameId, key, input, signal, onStart, operationId }) {
    const entry = await manualTaskFor(gameId, key, input)
    const material = await deps.readLatestSettledTurn(gameId)
    const context = material ? await snapshotOf(material) : { gameId, turn: null, textVersion: null, text: '', rawText: '', card: null, variables: null }
    return executeTask(entry, 'manual', { ...context, input: typeof input === 'string' ? input.trim() : '' }, signal, onStart, operationId)
  }

  function stopTasks(gameId) {
    const run = taskRuns.get(gameId)
    if (!run) return false
    run.controller.abort(new Error('玩家停止了插件任务'))
    return true
  }

  function runningTask(gameId) {
    const run = taskRuns.get(gameId)
    return run ? { plugin: run.plugin, task: run.task, title: run.title, kind: run.kind, startedAt: run.startedAt } : null
  }

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

  /** The game's plugin panel: what each plugin uses here, the player's choices, recent errors. */
  async function gamePlugins(gameId) {
    const choices = await choicesFor(gameId)
    const { game, disabled, replacements: chosen } = choices
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
    for (const entry of castHandlers) use(entry.owner, '演出', '观察')
    for (const entry of speechProviders.values()) use(entry.owner, '配音', '添加')
    for (const entry of [...sections.values(), ...turnSections.values(), ...worldbookSources.values()]) use(entry.owner, '上下文', '添加')
    for (const entry of worldbookPools.values()) use(entry.owner, '世界书', '添加')
    for (const entry of [...settlementSections.values(), ...settlementTools.values()]) use(entry.owner, '结算', '添加')
    for (const entry of candidateSections.values()) use(entry.owner, '候选', '添加')
    for (const entry of compactionSections.values()) use(entry.owner, '压缩', '添加')
    for (const owner of attachedOwners) use(owner, '界面', '添加')
    for (const entry of settlementTasks.values()) use(entry.owner, '结算', '任务')
    for (const entry of manualTasks.values()) use(entry.owner, '手动任务', '添加')
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
    const tasks = {
      settlement: Object.keys(TASK_PHASES).flatMap(phase => orderedTasks(phase, choices).map(entry => ({ key: taskKey(entry.owner, entry.name), plugin: entry.owner,
        title: entry.title, phase, phaseLabel: TASK_PHASES[phase], enabled: !choices.disabledTasks.has(taskKey(entry.owner, entry.name)) }))),
      manual: Array.from(manualTasks.values()).filter(entry => !disabled.has(entry.owner)).sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name))
        .map(entry => ({ key: taskKey(entry.owner, entry.name), plugin: entry.owner, title: entry.title, description: entry.description, input: entry.input })),
      running: runningTask(game.sessionId)
    }
    return { plugins, replacements: stages, tasks, errors: [...(errors.get(game.sessionId) || [])].reverse() }
  }

  async function setGamePlugin(gameId, { name, enabled, replace, task, taskOrder } = {}) {
    const { game } = await choicesFor(gameId)
    if (!game) throw new Error('这一局不存在或不是游玩对话')
    await deps.data.updateSettings(game.chatId, settings => {
      if (typeof name === 'string' && typeof enabled === 'boolean') {
        settings.disabled = settings.disabled.filter(item => item !== name)
        if (!enabled) settings.disabled.push(name)
      }
      if (task && typeof task.key === 'string' && typeof task.enabled === 'boolean') {
        settings.disabledTasks = settings.disabledTasks.filter(item => item !== task.key)
        if (!task.enabled) settings.disabledTasks.push(task.key)
      }
      if (Array.isArray(taskOrder)) settings.taskOrder = [...new Set(taskOrder.filter(item => typeof item === 'string'))].slice(0, 200)
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
    async sections({ gameId, turn }) { return collectSections(settlementSections, { gameId, turn }, '结算说明段落', (await choicesFor(gameId)).disabled) },
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

  return Object.freeze({ service, toolModesFor, callHandler, turnState, exportGame, importGame, turnSettled, castAnnotated, gameRemoved,
    speechProviders: () => Array.from(speechProviders.values()), timelineChanged, gameForked, forkTurns, promptSections, turnContext, worldbookPoolEntries, settlement, candidate, compactionNotes, replaceSettlement,
    runSettlementTasks, manualTaskFor, runManualTask, stopTasks, runningTask, gamePlugins, setGamePlugin })
}
