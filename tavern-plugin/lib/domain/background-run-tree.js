// The 后台任务 page's main view, after a GitHub Actions run: per turn, the story moments in
// order, each with the background tasks it started, and under a task what ran because it finished
// (任务完成, needs). Built from what the server keeps: story moments, runs of declared
// tasks (workflow.runs) and background Agent runs (the runner's), all in memory.

const KEPT_SEGMENTS = 5

function startedAt(item) {
  return item.queuedAt ?? item.at
}

// An Agent run belongs to a declared task's run when it is of that task (a plugin's runTask
// for a plugin's task) and was queued while that task ran.
function ranFor(jobRun, run, now) {
  const task = String(jobRun.task || '')
  const mine = task === run.task || (run.task === 'plugin' && run.plugin && task.startsWith('plugin:' + run.plugin + ':'))
  return mine && run.queuedAt >= jobRun.at && run.queuedAt <= (jobRun.endedAt ?? now) + 1000
}

function agentLine(run) {
  const line = { id: run.id, status: run.status, member: run.member || '', lane: run.lane || '', queuedAt: run.queuedAt }
  for (const key of ['startedAt', 'endedAt', 'model', 'error']) if (run[key] !== undefined && run[key] !== null && run[key] !== '') line[key] = run[key]
  return line
}

/**
 * @returns {{ turn: number|null, at: number, moments: object[], others: object[] }[]} newest first.
 * A moment is { event, name, at, tasks }; a task is { key, name, task, status, at, endedAt?,
 * error?, agents, then } where agents are its Agent runs and then the tasks it started.
 */
export function buildRunTree({ moments = [], jobRuns = [], runs = [], catalog = [], now = Date.now() } = {}) {
  const nameOf = task => catalog.find(item => item.task === task)?.name || task
  const ordered = [...moments].sort((a, b) => a.at - b.at)
  // A turn begins when the player sends; what came before the first send is its own group.
  const segments = []
  for (const moment of ordered) {
    if (moment.event === 'turn-started' || segments.length === 0) {
      segments.push({ turn: moment.event === 'turn-started' && Number.isSafeInteger(moment.turn) ? moment.turn : null, at: moment.at, moments: [], others: [], nodes: [] })
    }
    segments.at(-1).moments.push({ event: moment.event, name: moment.name, at: moment.at, tasks: [] })
  }
  const all = [...jobRuns, ...runs].map(startedAt)
  if (segments.length === 0 && all.length) segments.push({ turn: null, at: Math.min(...all), moments: [], others: [], nodes: [] })
  const segmentAt = time => segments.slice().reverse().find(segment => segment.at <= time) || segments[0]
  const momentAt = (segment, event, time) => segment.moments.filter(item => item.event === event && item.at <= time + 1000).at(-1)
  const used = new Set()

  // Declared tasks' runs, in the order they started. Only background tasks: a declaration
  // that starts no task of the catalog (对局标题, 存档整理: upkeep, no background Agent) is left out.
  const placed = []
  for (const jobRun of [...jobRuns].sort((a, b) => a.at - b.at)) {
    if (!jobRun.task) continue
    const segment = segmentAt(jobRun.at)
    const node = { key: 'job:' + jobRun.id + ':' + jobRun.at, id: jobRun.id, name: jobRun.name, task: jobRun.task || '', status: jobRun.status, at: jobRun.at,
      agents: [], then: [], event: jobRun.event, cause: jobRun.cause, needs: jobRun.needs }
    if (jobRun.endedAt !== undefined) node.endedAt = jobRun.endedAt
    if (jobRun.error) node.error = jobRun.error
    if (jobRun.condition) node.condition = jobRun.condition
    for (const run of runs) {
      if (!used.has(run.id) && ranFor(jobRun, run, now)) { node.agents.push(agentLine(run)); used.add(run.id) }
    }
    segment.nodes.push(node)
    placed.push({ segment, node })
  }
  // Agent runs no declared task started: settlement (the reply flow starts it), and what the
  // player or a plugin started by hand.
  for (const run of [...runs].sort((a, b) => a.queuedAt - b.queuedAt)) {
    if (used.has(run.id)) continue
    const segment = segmentAt(run.queuedAt)
    const node = { key: 'run:' + run.id, name: run.task === 'plugin' ? '插件「' + (run.plugin || '未知') + '」任务' : run.name || nameOf(run.task), task: run.task,
      status: run.status, at: run.queuedAt, agents: [agentLine(run)], then: [], event: run.task === 'settlement' ? 'reply-committed' : '' }
    if (run.endedAt) node.endedAt = run.endedAt
    if (run.error) node.error = run.error
    segment.nodes.push(node)
    placed.push({ segment, node })
  }
  // Hang each task under what started it: the task it waited on, else its moment.
  for (const { segment, node } of placed.sort((a, b) => a.node.at - b.node.at)) {
    const before = segment.nodes.filter(other => other !== node && other.at <= node.at + 1000)
    const parent = node.event === 'task-finished' && node.cause
      ? before.filter(other => other.task === node.cause || other.id === node.cause).at(-1)
      : node.event === 'needs' ? before.filter(other => (node.needs || []).includes(other.id)).at(-1) : null
    if (parent) { parent.then.push(node); continue }
    const moment = node.event && node.event !== 'needs' ? momentAt(segment, node.event, node.at) : null
    if (moment) moment.tasks.push(node)
    else segment.others.push(node)
  }
  return segments.slice(-KEPT_SEGMENTS).reverse().map(({ nodes, ...segment }) => segment)
}
