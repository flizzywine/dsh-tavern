// Relay planning and injected lifecycle; no filesystem or model-provider dependencies.
// Entry = { sourceId, fromTurn, toTurn, versions, participants, text }, fromTurn === toTurn.
// Volume = { sourceIds, fromTurn, toTurn, versions, participants, text }.
// versions is { [turn]: textVersion }: one key per covered turn, including across sources.
// A volume's range is its envelope, not a claim that gaps have been summarized.
// The controller validates output once at its write boundary; the host supplies storyRetention.estimate.
export const RELAY_DEFAULTS = Object.freeze({ everyRounds: 5, tokenThreshold: 50000 })
export const RAW_MIN_ROUNDS = 3
const unique = list => [...new Set(list)]
const sourcesOf = item => item.sourceIds ?? [item.sourceId]
const branchOf = (state, id) => state?.branches?.[id] ?? { entries: [], volumes: [], coveredThrough: 0, pendingEvents: [] }
const ordered = items => [...items].sort((a, b) => a.fromTurn - b.fromTurn || a.toTurn - b.toTurn)

/** Inputs are resolved numeric settings; missing layers inherit, invalid explicit values fail. */
export function relayConfig(...layers) {
  const config = { ...RELAY_DEFAULTS }
  for (const layer of layers) for (const key of Object.keys(config)) {
    if (layer?.[key] === undefined) continue
    const value = layer[key]
    if (!Number.isFinite(value) || value <= 0 || (key === 'everyRounds' && !Number.isInteger(value))) {
      throw new TypeError(`${key} must be positive${key === 'everyRounds' ? ' and integral' : ''}`)
    }
    config[key] = value
  }
  return Object.freeze(config)
}

const tagged = (tag, text) => `<${tag}>\n${text}\n</${tag}>`
/** The relay task: the JSON request, then how to answer it (long material comes before the ask). */
export function relayInstruction(request) {
  return tagged('relay_request', JSON.stringify(request)) + '\n\n' + tagged('relay_instructions', '请按来源的 compressionPrompt 压缩，不混淆参与者。使用共享原文查询工具读取指定轮次和事件引用；摘要只是索引，不替代原文。'
    + '\n只返回 JSON：{"entries":[{"sourceId":"来源id","turn":1,"participants":["人物id"],"text":"摘要"}],"volume":null}。'
    + ' summarize 非空时，每个轮次、每个来源恰好一项；无内容也标明无新增。仅返回新范围。merge 非空时 volume 为合并旧项的非空文本，否则为 null。保留专名、关系、约定和未解决事项。')
}
export const relayRequestOf = instruction => JSON.parse(instruction.match(/<relay_request>\n([\s\S]*?)\n<\/relay_request>/)[1])
/** The source records a standalone relay call carries, one record per round and source. */
export const relayRecords = records => tagged('source_records', records.map(({ turn, source, participants, text }) =>
  `<record turn="${turn}" source="${source}"${participants ? ` participants="${participants.join(', ')}"` : ''}>\n${text}\n</record>`).join('\n'))

export function relaySource({ id, name, recentRounds, compressionPrompt, readRaw }) {
  if (typeof id !== 'string' || !id) throw new TypeError('Source requires id')
  if (!Number.isInteger(recentRounds) || recentRounds < 1) throw new TypeError('recentRounds must be a positive integer')
  if (typeof compressionPrompt !== 'string' || typeof readRaw !== 'function') throw new TypeError('Source requires compressionPrompt and readRaw')
  return Object.freeze({ id, name: name || id, recentRounds, compressionPrompt, readRaw })
}
export const protectedRounds = sources => sources.reduce((max, source) => Math.max(max, source.recentRounds), 0)
export function rawWindow(current, covered) {
  return { from: Math.max(1, Math.min(covered + 1, current - RAW_MIN_ROUNDS + 1)), to: current }
}

/** Coverage is only the contiguous prefix actually represented, never the stored watermark alone. */
function coverage(items, ceiling) {
  const turns = new Set(items.flatMap(item => Object.keys(item.versions).map(Number)))
  let covered = 0
  while (covered < ceiling && turns.has(covered + 1)) covered++
  return covered
}

/** versionAt returns undefined for future turns after rewind. Later items also become invalid. */
export function projectValid(state, branchId, versionAt) {
  const branch = branchOf(state, branchId)
  let boundary = Infinity
  for (const item of [...branch.entries, ...branch.volumes]) {
    for (const [turn, version] of Object.entries(item.versions)) {
      const current = versionAt(Number(turn))
      if (current === undefined || current !== version) boundary = Math.min(boundary, Number(turn))
    }
  }
  const entries = branch.entries.filter(item => item.toTurn < boundary)
  const volumes = branch.volumes.filter(item => item.toTurn < boundary)
  return { boundary, covered: coverage([...entries, ...volumes], branch.coveredThrough), entries, volumes }
}

function planMerge(units, protectedFrom, threshold, size) {
  if (size(units) <= threshold) return null
  const limit = units.findIndex(item => item.toTurn >= protectedFrom)
  const mergeable = limit < 0 ? units.length : limit
  let count = 0
  while (count < mergeable && (count === 0 || size(units.slice(count)) > threshold / 2)) count++
  if (!count) return null
  // Do not split a round's sources between the volume and per-round entries.
  while (count < mergeable && units[count].fromTurn <= Math.max(...units.slice(0, count).map(item => item.toTurn))) count++
  const merged = units.slice(0, count)
  return {
    units: merged,
    fromTurn: merged[0].fromTurn,
    toTurn: Math.max(...merged.map(item => item.toTurn)),
    versions: Object.assign({}, ...merged.map(item => item.versions)),
    sourceIds: unique(merged.flatMap(sourcesOf)),
    participants: unique(merged.flatMap(item => item.participants))
  }
}

/** estimate(text) must be the same injected function passed to storyVolumePlan. */
export function planRelay(state, { branchId, current, versionAt, config = relayConfig(), sources = [], estimate }) {
  if (typeof estimate !== 'function') throw new TypeError('planRelay requires storyRetention.estimate')
  const branch = branchOf(state, branchId)
  const valid = projectValid(state, branchId, versionAt)
  const raw = rawWindow(current, valid.covered)
  // Rewind may move raw into an indivisible old volume. Restore its entire prefix as raw.
  // Iterate because expanding raw can intersect another volume's envelope.
  let from
  do {
    from = raw.from
    for (const item of [...valid.volumes, ...valid.entries]) {
      if (item.fromTurn < raw.from && item.toTurn >= raw.from) raw.from = item.fromTurn
    }
  } while (from !== raw.from)
  const entries = valid.entries.filter(item => item.toTurn < raw.from)
  const volumes = valid.volumes.filter(item => item.toTurn < raw.from)
  const protectedFrom = Math.min(raw.from, current - Math.max(RAW_MIN_ROUNDS, protectedRounds(sources)) + 1)
  const units = ordered([...volumes, ...entries])
  return {
    branchId, boundary: valid.boundary, covered: valid.covered, raw, protectedFrom,
    summarize: current - valid.covered >= config.everyRounds ? { fromTurn: valid.covered + 1, toTurn: current } : null,
    entries, volumes,
    // Retain the full valid projection for applyMerge, not just the display projection.
    retained: valid,
    merge: planMerge(units, protectedFrom, config.tokenThreshold, list => estimate(list.map(item => item.text).join('\n\n'))),
    pendingEvents: branch.pendingEvents
  }
}

export function renderRelay(plan, { sources = [], resolveName = id => id } = {}) {
  const names = new Map(sources.map(source => [source.id, source.name]))
  return ordered([...plan.volumes, ...plan.entries]).map(item => {
    const turns = Object.keys(item.versions).map(Number).sort((a, b) => a - b)
    const range = turns.length === item.toTurn - item.fromTurn + 1
      ? (item.fromTurn === item.toTurn ? `#${item.fromTurn}` : `#${item.fromTurn}-${item.toTurn}`)
      : turns.map(turn => `#${turn}`).join(', ')
    const label = sourcesOf(item).map(id => names.get(id) ?? id).join(', ')
    const who = item.participants.map(resolveName).join(', ')
    return `${range} ${label}${who ? ` [${who}]` : ''}\n${item.text}`
  }).join('\n\n')
}

/** Apply only to the unchanged state/anchor used for planning; the host owns that write guard. */
export function applyMerge(state, branchId, plan, text) {
  if (!plan.merge || plan.branchId !== branchId) throw new TypeError('No merge for this branch')
  const { units, ...metadata } = plan.merge
  const merged = new Set(units)
  return { ...state, branches: { ...state?.branches, [branchId]: {
    entries: plan.retained.entries.filter(item => !merged.has(item)),
    volumes: ordered([...plan.retained.volumes.filter(item => !merged.has(item)), { ...metadata, text }]),
    coveredThrough: plan.covered,
    pendingEvents: branchOf(state, branchId).pendingEvents
  } } }
}

const sameAnchor = (a, b) => a?.branchId === b?.branchId && a?.turn === b?.turn && a?.textVersion === b?.textVersion
const relayError = code => Object.assign(new Error(code), { code })

/** One controller per chat. Authority readers are synchronous immutable snapshots, not I/O. */
export function createSummaryRelay({ store, readAnchor, versionAt, runSharedTask, sources, estimate }) {
  let enabled = false, generation = 0, serial = Promise.resolve(), completedAnchor = ''
  const running = new Map(), events = new Set()
  const enqueue = work => {
    const result = serial.then(work)
    serial = result.catch(() => {})
    return result
  }
  const alive = epoch => enabled && epoch === generation
  const guard = (epoch, anchor, versions = {}) => alive(epoch) && sameAnchor(anchor, readAnchor()) &&
    Object.entries(versions).every(([turn, version]) => versionAt(Number(turn)) === version)
  const eventValid = event => events.has(event.eventId) && event.anchor.branchId === readAnchor().branchId &&
    versionAt(event.anchor.turn) === event.anchor.textVersion
  const pending = branch => branch.pendingEvents.filter(eventValid)
  function cancel() {
    generation++
    completedAnchor = ''
    for (const task of running.values()) task.controller.abort()
    running.clear()
  }
  function setEnabled(value) {
    if (enabled === (value === true)) return
    cancel()
    enabled = value === true
    events.clear()
  }
  async function recordEvent({ eventId, anchor, sourceId, rawRef, participants = [] }) {
    if (!enabled) return { status: 'disabled' }
    if (!eventId || !sources.some(source => source.id === sourceId) || rawRef === undefined ||
      !Array.isArray(participants) || participants.some(id => typeof id !== 'string')) throw new TypeError('Invalid relay event')
    const epoch = generation
    return enqueue(async () => {
      if (!guard(epoch, anchor)) return { status: 'stale' }
      const expected = await store.read()
      if (!guard(epoch, anchor)) return { status: 'stale' }
      const branch = branchOf(expected, anchor.branchId)
      if (events.has(eventId) || branch.pendingEvents.some(event => event.eventId === eventId)) return { status: 'duplicate' }
      const event = { eventId, anchor: { ...anchor }, targetTurn: anchor.turn + 1, sourceId, rawRef, participants }
      const saved = await store.update(expected, current => {
        if (!guard(epoch, anchor)) return undefined
        return { ...current, branches: { ...current?.branches, [anchor.branchId]: {
          ...branch, pendingEvents: [...branch.pendingEvents, event]
        } } }
      })
      if (saved && alive(epoch)) events.add(eventId)
      return { status: saved ? 'recorded' : 'stale' }
    })
  }
  async function projectEvents({ targetTurn, resolveName = id => id }) {
    if (!enabled) return []
    const epoch = generation, anchor = readAnchor(), state = await store.read()
    if (!guard(epoch, anchor)) return []
    const rows = pending(branchOf(state, anchor.branchId)).filter(event => event.targetTurn === targetTurn)
    const projected = await Promise.all(rows.map(async event => {
      const source = sources.find(source => source.id === event.sourceId)
      const text = await source.readRaw({ ...event.anchor, rawRef: event.rawRef })
      return { ...event, text: `#${event.anchor.turn} ${source.name} [${event.participants.map(resolveName).join(', ')}]\n${text}` }
    }))
    return guard(epoch, anchor) ? projected : []
  }
  /** turn: a reader's earlier page (a call dialled there) plans as of that round; later entries stay out. */
  async function project({ turn } = {}) {
    if (!enabled) return null
    const epoch = generation, anchor = readAnchor(), state = await store.read()
    if (!guard(epoch, anchor)) return null
    const current = Math.min(turn ?? anchor.turn, anchor.turn)
    const plan = planRelay(state, { branchId: anchor.branchId, current, versionAt: at => at <= current ? versionAt(at) : undefined, sources, estimate })
    return { plan, text: renderRelay(plan, { sources }) }
  }
  async function execute(anchor, epoch, signal) {
    const expected = await store.read()
    if (!guard(epoch, anchor)) return { status: 'stale' }
    const plan = planRelay(expected, { branchId: anchor.branchId, current: anchor.turn, versionAt, sources, estimate })
    const dueEvents = pending(branchOf(expected, anchor.branchId)).filter(event => event.targetTurn <= anchor.turn)
    const summarize = plan.summarize ?? (dueEvents.length && plan.covered < anchor.turn
      ? { fromTurn: plan.covered + 1, toTurn: anchor.turn } : null)
    if (!summarize && !plan.merge) return { status: 'idle' }
    const versions = Object.assign({}, ...plan.retained.entries.map(item => item.versions), ...plan.retained.volumes.map(item => item.versions))
    if (summarize) for (let turn = summarize.fromTurn; turn <= summarize.toTurn; turn++) versions[turn] = versionAt(turn)
    Object.assign(versions, plan.merge?.versions)
    const request = {
      summarize, sources: sources.map(({ id, compressionPrompt }) => ({ id, compressionPrompt })),
      events: dueEvents, merge: plan.merge ?? null
    }
    const instruction = relayInstruction(request)
    const result = await runSharedTask({ instruction, signal })
    if (!guard(epoch, anchor, versions) || signal.aborted) return { status: 'stale' }
    // The sole untrusted-output boundary. Identity/ranges/versions come from the plan, never the model.
    const output = JSON.parse(result.output)
    const wanted = new Set()
    if (summarize) for (let turn = summarize.fromTurn; turn <= summarize.toTurn; turn++) {
      for (const source of sources) wanted.add(JSON.stringify([source.id, turn]))
    }
    if (!output || !Array.isArray(output.entries) || (plan.merge ? typeof output.volume !== 'string' || !output.volume.trim() : output.volume !== null)) {
      throw relayError('RELAY_INVALID_OUTPUT')
    }
    const entries = output.entries.map(row => {
      const key = JSON.stringify([row.sourceId, row.turn])
      if (!wanted.delete(key) || typeof row.text !== 'string' || !row.text.trim() || !Array.isArray(row.participants) ||
        row.participants.some(id => typeof id !== 'string' || !id)) throw relayError('RELAY_INVALID_OUTPUT')
      return { sourceId: row.sourceId, fromTurn: row.turn, toTurn: row.turn, versions: { [row.turn]: versions[row.turn] },
        participants: unique(row.participants), text: row.text }
    })
    if (wanted.size) throw relayError('RELAY_INVALID_OUTPUT')
    return enqueue(async () => {
      if (!guard(epoch, anchor, versions) || signal.aborted) return { status: 'stale' }
      const saved = await store.update(expected, current => {
        if (!guard(epoch, anchor, versions) || signal.aborted) return undefined
        const merged = plan.merge ? applyMerge(current, anchor.branchId, plan, output.volume) : current
        const branch = plan.merge ? branchOf(merged, anchor.branchId) : {
          ...branchOf(current, anchor.branchId), entries: plan.retained.entries, volumes: plan.retained.volumes
        }
        return { ...merged, branches: { ...merged?.branches, [anchor.branchId]: {
          ...branch, entries: ordered([...branch.entries, ...entries]),
          coveredThrough: summarize?.toTurn ?? plan.covered,
          pendingEvents: branch.pendingEvents.filter(event => !dueEvents.some(due => due.eventId === event.eventId))
        } } }
      })
      return { status: saved ? 'committed' : 'stale', usage: result.usage, measurement: result.measurement }
    })
  }
  function committed(anchor = undefined) {
    if (!enabled) return Promise.resolve({ status: 'disabled' })
    anchor = { ...(anchor ?? readAnchor()) }
    const epoch = generation
    if (!guard(epoch, anchor)) return Promise.resolve({ status: 'stale' })
    const key = JSON.stringify(anchor)
    if (completedAnchor === key) return Promise.resolve({ status: 'idle' })
    if (running.has(key)) return running.get(key).promise
    const controller = new AbortController()
    const task = { controller }
    task.promise = execute(anchor, epoch, controller.signal).then(result => {
      if (result.status === 'committed' && alive(epoch)) completedAnchor = key
      return result
    }).finally(() => {
      if (running.get(key) === task) running.delete(key)
    })
    running.set(key, task)
    return task.promise
  }
  return Object.freeze({ setEnabled, cancel, committed, recordEvent, projectEvents, project,
    dispose() { setEnabled(false) } })
}
