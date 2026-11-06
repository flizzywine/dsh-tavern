import { AsyncLocalStorage } from 'node:async_hooks'
import { bounded, untilAborted } from './plugin-callback.js'
import { pluginMember, pluginMemberId, pluginMemberPrefix } from './background-members.js'

const TOOL_NAME = /^[a-z][a-z0-9_]{2,47}$/
const MAX_TOOL_RESULT = 20000
const MAX_TASK_PROMPT = 20000
const MAX_TASK_TOOLS = 8
const MAX_TOOL_CALLS_PER_TASK = 16
const TASK_TIMEOUT_MS = 600000
const SETTLEMENT_TASK_TIMEOUT_MS = 300000
const MANUAL_TASK_TIMEOUT_MS = 600000
const MAX_TASK_INPUT = 4000
const MAX_VERSION_WATCHES = 2000
function taskKey(owner, name) { return owner + ':' + name }

/** Own task runs, cancellation, version watches and write authority. Registrations stay with the plugin API. */
export function createPluginTaskExecution({ runTask, currentKey, readLatestSettledTurn, readPendingTurn,
  requireGame, choicesFor, snapshotOf, recordError, reservedToolNames, settlementTasks, manualTasks }) {
  const taskRuns = new Map(), phasesRan = new Set(), versionWatches = new Set()
  const taskContext = new AsyncLocalStorage()
  function staleVersion() { return Object.assign(new Error('这一轮的正文版本已不是当前显示的版本'), { code: 'TAVERN_PLUGIN_STALE_VERSION' }) }

  /** A watch on (game, turn, textVersion): its controller aborts when that version is no longer current. */
  function watchVersion(gameId, turn, textVersion, owner) {
    const watch = { gameId, turn, textVersion, owner, controller: new AbortController() }
    versionWatches.add(watch)
    watch.controller.signal.addEventListener('abort', () => versionWatches.delete(watch), { once: true })
    if (versionWatches.size > MAX_VERSION_WATCHES) versionWatches.delete(versionWatches.values().next().value)
    return { ...watch, release: () => versionWatches.delete(watch) }
  }

  /** Abort the watches of a game whose text version is no longer the shown one (or all of them). */
  async function checkVersions(gameId, { all = false } = {}) {
    const watches = Array.from(versionWatches).filter(watch => watch.gameId === gameId)
    const keys = new Map()
    for (const watch of watches) {
      if (!all) {
        if (!keys.has(watch.turn)) keys.set(watch.turn, await currentKey(gameId, watch.turn).catch(() => undefined))
        const key = keys.get(watch.turn)
        if (key === undefined || key === watch.textVersion) continue
      }
      watch.controller.abort(staleVersion())
    }
  }

  // A one-off task in a fresh background session of this game: same background model,
  // card background and world book as Tavern's own tasks, never Tavern's resident session.
  // A plugin's tool definitions, checked: name → tool.
  function checkTools(tools) {
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
    return byName
  }

  async function runTaskAs(owner, { gameId, prompt, tools = [], signal, member } = {}) {
    const game = await requireGame(gameId)
    // A member of this plugin only (tavern.member): its resident Session, its queue.
    const memberId = member === undefined ? '' : pluginMemberId(owner, String(member))
    if (member !== undefined && !pluginMember(memberId)) throw new Error('插件 ' + owner + ' 没有注册成员 ' + member)
    if ((await choicesFor(game.sessionId)).disabled.has(owner)) throw new Error('玩家在本局关闭了插件 ' + owner)
    if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('prompt 必须是非空字符串')
    if (prompt.length > MAX_TASK_PROMPT) throw new Error('prompt 不能超过 20000 字')
    // A member with a prefix of its own answers with its own tools: they sit in that prefix, so
    // a task brings none (the prefix stays the same for every task, and cached).
    const prefix = memberId ? pluginMemberPrefix(memberId) : null
    if (prefix && tools.length) throw new Error('成员 ' + member + ' 有自己的系统提示词和工具，任务里不能再传 tools')
    const byName = prefix ? prefix.tools : checkTools(tools)
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
      const result = await bounded(runTask({ gameId: game.sessionId, owner, prompt: prompt.trim(),
        tools: Array.from(byName.values()).map(tool => ({ name: tool.name, description: tool.description.trim(), parameters: structuredClone(tool.parameters) })),
        call, signal, member: memberId, ...(prefix ? { system: prefix.system } : {}) }), '后台任务', TASK_TIMEOUT_MS)
      return { text: String(result?.text || '') }
    } catch (error) {
      if (!signal?.aborted) recordError(game.sessionId, owner, '后台任务', error)
      throw error
    }
  }

  /** One plugin task under Tavern's watch: bounded, stoppable, its failure recorded for the panel. */
  async function executeTask(entry, kind, context, signal, onStart, operationId) {
    const controller = new AbortController()
    // A settlement task also stops once its text version is replaced (rollback, regenerate, edit).
    const version = kind === 'settlement' && context.textVersion ? watchVersion(context.gameId, context.turn, context.textVersion, entry.owner) : null
    const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : []), ...(version ? [version.controller.signal] : [])])
    const run = { plugin: entry.owner, task: entry.name, title: entry.title, kind, startedAt: Date.now(), controller }
    taskRuns.set(context.gameId, run)
    const finish = onStart?.(entry.owner + ' · ' + entry.title)
    const stage = (kind === 'manual' ? '手动任务 ' : '结算任务 ') + entry.title
    // A task registered on a member runs there unless the call names another.
    const runAgent = (input = {}) => runTaskAs(entry.owner, { ...(entry.member ? { member: entry.member } : {}), ...input, gameId: context.gameId, signal: combined })
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
      if (version) version.release()
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
    // Before and alongside Tavern's settlement the turn is still pending; after it, settled.
    const read = () => phase === 'after' ? readLatestSettledTurn(gameId) : readPendingTurn(gameId)
    const material = await read()
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
        const current = await read()
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
    const material = await readLatestSettledTurn(gameId)
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


  function writeGuard(owner, material) {
    const task = taskContext.getStore()
    // Keep the captured task's identity, but check its authority again at write time.
    return () => {
      if (!task) return null
      if (task.owner !== owner || task.gameId !== material.sessionId || task.textVersion !== material.key
        || task.phase !== 'after' && task.phase !== undefined || task.signal.aborted || taskRuns.get(task.gameId) !== task.run || !task.operationId) {
        throw Object.assign(new Error('插件任务已结束或不属于这一轮'), { code: 'TAVERN_PLUGIN_STALE_VERSION' })
      }
      return task.operationId
    }
  }
  return Object.freeze({ checkTools, runAgent: runTaskAs, runSettlementTasks, manualTaskFor, runManualTask, stopTasks, runningTask,
    orderedTasks, watchVersion, checkVersions, staleSignal: () => AbortSignal.abort(staleVersion()), writeGuard })
}
