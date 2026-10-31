// The task table, after GitHub Actions' workflow: every background task the story starts
// is one declaration — which moments start it (`on`), when it runs at all (`if`), what
// it does (`run`) and which moments stop it (`cancelOn`, `cancel`). The scheduler follows
// the story events for it, so the declaration is the only place a task's trigger is
// written, and the 后台任务 page reads it from here.
// A task's `needs` (background-tasks.js) are kept here too: the task that owns a
// piece of work says how to wait for it in a game (`waiter`), and a task that needs it
// waits through `needs`, so no task reaches into another's queues.
// Between declared tasks, `needs` names other tasks (by id) instead of moments: it runs
// once they all finished the same turn, and hears what their runs returned — their
// outputs, kept per game and turn until the story is rewound past that turn.

function list(value) {
  return (Array.isArray(value) ? value : [value]).filter(item => item !== undefined && item !== null).map(String).filter(Boolean)
}

// The game a moment happened in: `sessionId`, or a settled turn's save header. A moment
// with no game (a settlement whose save could not be read) starts no task.
function gameOf(payload) {
  return String(payload?.sessionId || payload?.latest?.sessionId || '')
}

const KEPT_TURNS = 8
const KEPT_RUNS = 60

export function createWorkflow({ events, tasks = [], logger = console, now = Date.now }) {
  if (!events || typeof events.on !== 'function') throw new Error('任务表缺少剧情事件')
  const jobs = new Map()
  // Per game: turn → (task id → what its run returned).
  const outputs = new Map()
  // Per task id: run(payload) of each declared task that needs it.
  const dependents = new Map()
  // Per game: each time a declared task ran (its `if` held), newest last, for the 后台任务 page.
  const history = new Map()

  function record(entry, payload, event, at = now(), status = 'running') {
    const item = { id: entry.id, name: entry.name, task: entry.task, event, at, status }
    if (status === 'skipped') Object.assign(item, { endedAt: at }, entry.condition ? { condition: entry.condition } : {})
    if (Number.isSafeInteger(payload.turn)) item.turn = payload.turn
    // What finished, for a task started by 任务完成; what it needed, for one started by needs.
    if (event === 'task-finished' && payload.task) item.cause = String(payload.task)
    if (event === 'needs') item.needs = Object.keys(payload.needs || {})
    const kept = history.get(payload.gameId) || []
    kept.push(item)
    history.set(payload.gameId, kept.slice(-KEPT_RUNS))
    return (status, error) => { item.status = status; item.endedAt = now(); if (error) item.error = String(error?.message || error).slice(0, 200) }
  }
  const catalog = new Map(tasks.map(item => [item.task, item]))
  const waiters = new Map()

  /** How to wait for a task's work in a game: `wait(chat)` settles when it is done. */
  function waiter(task, wait) {
    if (!catalog.has(task)) throw new Error('任务目录里没有 ' + task)
    if (typeof wait !== 'function') throw new Error('任务 ' + task + ' 的等待方式必须是函数')
    if (waiters.has(task)) throw new Error('任务 ' + task + ' 的等待方式已登记')
    waiters.set(task, wait)
    return () => { if (waiters.get(task) === wait) waiters.delete(task) }
  }

  async function waitAll(list, chat) {
    for (const task of list) {
      const wait = waiters.get(task)
      if (!wait) throw new Error('任务 ' + task + ' 没有登记等待方式')
      await wait(chat)
    }
  }

  /** Wait for the work of this game that `task` needs, in the order its declaration names. */
  async function needs(task, chat) {
    const item = catalog.get(task)
    if (!item) throw new Error('任务目录里没有 ' + task)
    await waitAll(item.needs || [], chat)
  }

  function outputsOf(gameId, turn) {
    return outputs.get(gameId)?.get(turn)
  }

  // A finished run of `id` for this turn: keep what it returned, then start the tasks that
  // need it once all they need has finished the turn.
  function finished(id, gameId, turn, value) {
    if (!Number.isSafeInteger(turn)) return
    const turns = outputs.get(gameId) || new Map()
    const done = turns.get(turn) || new Map()
    done.set(id, value === undefined ? null : value)
    turns.set(turn, done)
    for (const old of [...turns.keys()].sort((a, b) => a - b).slice(0, -KEPT_TURNS)) turns.delete(old)
    outputs.set(gameId, turns)
    for (const start of [...(dependents.get(id) || [])]) start(gameId, turn)
  }

  /** Declare a task; returns the function that removes it. */
  function job(declaration) {
    const id = String(declaration?.id || '')
    const name = String(declaration?.name || id)
    const on = list(declaration?.on)
    const after = list(declaration?.needs)
    const cancelOn = list(declaration?.cancelOn)
    const { if: when, enabled, run, cancel } = declaration || {}
    // `task`: the background runner task it starts (background-tasks.js), and
    // `condition`: its `if` in words; both only describe it on the 后台任务 page.
    const task = String(declaration?.task || '')
    const condition = String(declaration?.condition || '')
    // `flow`: a flow starts it at these moments itself and waits for it (变量结算), so it is
    // only declared here, to be listed with the rest; it has no run.
    const flow = declaration?.flow === true
    if (!id) throw new Error('任务缺少 id')
    if (jobs.has(id)) throw new Error('任务 ' + id + ' 已声明')
    if (on.length === 0 && after.length === 0) throw new Error('任务 ' + name + ' 缺少触发事件')
    if (after.includes(id)) throw new Error('任务 ' + name + ' 不能等它自己')
    if (!flow && typeof run !== 'function') throw new Error('任务 ' + name + ' 缺少 run')
    if (flow && (run !== undefined || after.length > 0)) throw new Error('流程启动的任务 ' + name + ' 不能有 run 或 needs')
    if (when !== undefined && typeof when !== 'function') throw new Error('任务 ' + name + ' 的 if 必须是函数')
    if (enabled !== undefined && typeof enabled !== 'function') throw new Error('任务 ' + name + ' 的 enabled 必须是函数')
    if (cancelOn.length > 0 && typeof cancel !== 'function') throw new Error('任务 ' + name + ' 有 cancelOn 但缺少 cancel')
    const entry = Object.freeze({ id, name, task, condition, flow, on: Object.freeze(on), needs: Object.freeze(after), cancelOn: Object.freeze(cancelOn) })
    // Synchronous where the task is, so tasks on one moment start in declaration order.
    // `if` filters which moments are its at all (not kept); `enabled` is the feature's switch:
    // with it off the run is kept as skipped, so the 后台任务 page shows it was not done.
    function attempt(payload, event) {
      const proceed = (ok, at) => {
        if (!ok || jobs.get(id) !== entry) return
        const end = record(entry, payload, event, at)
        let value
        try { value = run(payload, event) } catch (error) { end('failed', error); throw error }
        const done = result => { end('completed'); if (jobs.get(id) === entry) finished(id, payload.gameId, payload.turn, result) }
        if (typeof value?.then !== 'function') return done(value)
        return value.then(done, error => { end('failed', error); throw error })
      }
      const switched = ok => {
        if (jobs.get(id) !== entry) return
        if (!ok || !enabled) return proceed(ok)
        const at = now()
        return Promise.resolve(enabled(payload, event)).then(on => jobs.get(id) !== entry ? undefined : on ? proceed(true, at) : void record(entry, payload, event, at, 'skipped'))
      }
      const ok = when ? when(payload, event) : true
      return typeof ok?.then === 'function' ? ok.then(switched) : switched(ok)
    }
    // A failing `if`, run or cancel is the events' to report, under the task's name.
    const follow = (event, label, work) => events.on(event, label, payload => {
      const gameId = gameOf(payload)
      if (!gameId) return
      return work({ ...payload, gameId }, event)
    })
    const stops = [
      ...on.map(event => flow ? events.on(event, name + '（流程启动）', () => {}) : follow(event, name, attempt)),
      ...cancelOn.map(event => follow(event, '取消' + name, cancel))
    ]
    // Started by what it needs: once every one of them finished this turn.
    const start = (gameId, turn) => {
      const done = outputsOf(gameId, turn)
      if (!done || after.some(need => !done.has(need)) || done.has(id)) return
      const payload = { gameId, sessionId: gameId, turn, needs: Object.fromEntries(after.map(need => [need, done.get(need)])) }
      Promise.resolve().then(() => attempt(payload, 'needs'))
        .catch(error => logger.warn?.('dsh-tavern: 「' + name + '」失败:', error?.message || error))
    }
    for (const need of after) dependents.set(need, [...(dependents.get(need) || []), start])
    jobs.set(id, entry)
    return () => {
      if (jobs.get(id) !== entry) return
      jobs.delete(id)
      for (const stop of stops) stop()
      for (const need of after) dependents.set(need, (dependents.get(need) || []).filter(item => item !== start))
    }
  }

  // Rewinding or rewriting the story drops the outputs of the turns it took back (from the
  // turn it names, or all of the game's when it names none).
  events.on('story-rewound', '作废任务产出', payload => {
    const gameId = gameOf(payload), turns = outputs.get(gameId)
    if (!turns) return
    if (!Number.isSafeInteger(payload?.turn)) { outputs.delete(gameId); return }
    for (const turn of [...turns.keys()]) if (turn >= payload.turn) turns.delete(turn)
  })

  /** The runs of declared tasks in this game, oldest first. */
  function runs(gameId) {
    return (history.get(String(gameId || '')) || []).map(item => ({ ...item }))
  }

  /** What a declared task's run returned for this game and turn, or undefined. */
  function output(gameId, turn, id) {
    const value = outputsOf(String(gameId), turn)?.get(String(id))
    return value === undefined ? undefined : value
  }

  /** Declared tasks, in declaration order. */
  function table() {
    return [...jobs.values()]
  }

  /** Wait for the work of this game that the next turn waits for (blocksNextTurn). */
  async function beforeNextTurn(chat) {
    await waitAll([...catalog.values()].filter(item => item.blocksNextTurn).map(item => item.task), chat)
  }

  return Object.freeze({ job, table, waiter, needs, beforeNextTurn, output, runs })
}
