// operation-local protocol kernel. The existing director owner supplies
// validated window results; this module neither authorizes sources nor writes Chat.
import { assetPackDigest } from './stage-asset-pack-catalogue.js'
import { canonicalJson } from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'

const clone = value => structuredClone(value)
// deep equality compares canonical JSON directly; hashing both sides first adds nothing.
const same = (a, b) => a === undefined || b === undefined ? a === b : canonicalJson(a) === canonicalJson(b)
const immutable = value => {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) immutable(item)
    Object.freeze(value)
  }
  return value
}

// Preserve duplicate paragraphs individually, in order. Only rewrites need LCS;
// ordinary token append uses the linear fast path in reconcile below.
function align(previous, units) {
  const old = previous.map(item => assetPackDigest(item.unit)), next = units.map(assetPackDigest)
  const rows = Array.from({length:old.length + 1}, () => new Uint32Array(next.length + 1))
  for (let i = old.length - 1; i >= 0; i--) for (let j = next.length - 1; j >= 0; j--) {
    rows[i][j] = old[i] === next[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1])
  }
  const matches = new Map()
  let i = 0, j = 0
  while (i < old.length && j < next.length) {
    if (old[i] === next[j]) { matches.set(j, previous[i]); i++; j++ }
    else if (rows[i + 1][j] >= rows[i][j + 1]) i++
    else j++
  }
  return matches
}

export function createStreamingParagraphs() {
  let serial = 0, paragraphs = []
  function reconcile(units, committed = false) {
    const old = paragraphs
    const prefix = old.slice(0, -1).every((item, index) => same(item.unit, units[index]))
    const tail = old.at(-1), nextTail = units[old.length - 1]
    const extending = prefix && units.length >= old.length && (!tail || same(tail.unit, nextTail) ||
      !tail.sealed && nextTail?.kind === tail.unit.kind && nextTail.alias === tail.unit.alias && nextTail.name === tail.unit.name &&
      typeof nextTail.text === 'string' && nextTail.text.startsWith(tail.unit.text))
    const matches = extending ? new Map(old.map((item, index) => [index, item])) : align(old, units)
    paragraphs = units.map((unit, index) => {
      const existing = matches.get(index)
      return immutable({id:existing?.id || 'paragraph-' + ++serial, at:index + 1, unit:clone(unit),
        sealed:committed || index < units.length - 1})
    })
    const rewrite = old.some((item, index) => item.sealed &&
      (paragraphs[index]?.id !== item.id || !same(paragraphs[index]?.unit, item.unit) || !paragraphs[index]?.sealed))
    return {paragraphs:paragraphs.slice(), rewrite}
  }
  return {reconcile}
}

/**
 * A run port MUST return already validated {results:[{id,at,ops,state}]} for every
 * input paragraph, in order, including no-op paragraphs. Patch-window corrections
 * finish before this promise resolves. No partial result is published here.
 * system/tools are frozen snapshots, not builders that can vary per window.
 */
export function createStreamingDirector({identity, baseline, system, tools, run, onChange = () => {}, batchSize = 6, firstWindowSize = batchSize, remainderOnCommit = false, maxWindow = 24, maxCalls = 16}) {
  if (![batchSize, firstWindowSize, maxWindow, maxCalls].every(value => Number.isSafeInteger(value) && value > 0) || maxWindow < batchSize || firstWindowSize > maxWindow) throw new Error('Invalid streaming budget')
  const source = immutable(clone(identity)), initial = immutable(clone(baseline)), fixedTools = immutable(clone(tools))
  const index = createStreamingParagraphs()
  let paragraphs = [], epoch = 0, highWater = 0, calls = 0, committed = false, cancelled = false
  let accounting = {counts:{},totalOps:0}, diagnostics = []
  let failure = null, flight = null, scheduled = false, state = initial, through = 0, published = [], records = new Map()
  const tasks = new Set()
  const budget = () => Math.min(maxCalls, Math.ceil(highWater / batchSize) + 1 + (firstWindowSize < batchSize ? 1 : 0))
  const sealed = () => paragraphs.filter(item => item.sealed).length
  const phase = () => cancelled ? 'cancelled' : failure ? 'failed' : committed && through === paragraphs.length ? 'settled' : committed ? 'committed' : 'streaming'
  function snapshot() {
    return immutable({identity:source, epoch, phase:phase(), committed, calls, budget:budget(), highWater,
      through, paragraphs:paragraphs.slice(), entries:published.slice(), state:clone(state), accounting:clone(accounting), diagnostics:clone(diagnostics), failure:failure && {...failure}, inFlight:!!flight})
  }
  const notify = () => onChange(snapshot())
  function append(paragraph, record) {
    records.set(paragraph.id, record)
    diagnostics.push(...(record.diagnostics || []))
    if (record.entries) published.push(...record.entries)
    else if (record.ops.length) published.push(immutable({at:paragraph.at, ops:clone(record.ops), state:clone(record.state), timeTransitionMs:0}))
    state = record.state
    accounting = record.accounting || accounting
    through++
  }
  function reuse() {
    while (through < sealed()) {
      const paragraph = paragraphs[through], record = records.get(paragraph.id)
      if (!record || record.at !== paragraph.at || record.unitDigest !== assetPackDigest(paragraph.unit) || record.before !== assetPackDigest(state) || record.beforeAccounting !== assetPackDigest(accounting)) break
      append(paragraph, record)
    }
  }
  function schedule() {
    if (scheduled || flight || cancelled || failure) return
    scheduled = true
    queueMicrotask(() => { scheduled = false; pump() })
  }
  function pump() {
    if (flight || cancelled || failure) return
    reuse()
    const available = sealed() - through
    const opening = (remainderOnCommit || firstWindowSize < batchSize) && through === 0 && !committed
    if (remainderOnCommit && through > 0 && !committed) { notify(); return }
    if (!available || !committed && available < (opening ? firstWindowSize : batchSize)) { notify(); return }
    if (calls >= budget()) {
      if (committed) failure = {code:'STREAMING_BUDGET_EXHAUSTED', message:'Text is readable; director call budget exhausted'}
      notify(); return
    }
    // Keep the first visible prefix independent of a coalesced body backlog.
    const window = paragraphs.slice(through, through + (opening ? firstWindowSize : remainderOnCommit && committed ? available : maxWindow))
      .filter(item => item.sealed)
    // Stop before a reusable island so an unchanged carried state can save a call.
    // The carried state is fixed during the scan: hash it once (only if any later paragraph has a record).
    let carriedDigest
    const stop = window.findIndex((item, i) => {
      const before = i > 0 && records.get(item.id)?.before
      return !!before && before === (carriedDigest ??= assetPackDigest(state))
    })
    const items = stop < 0 ? window : window.slice(0, stop)
    const controller = new AbortController(), ticket = {epoch, controller, through:items.at(-1).at}
    const carried = immutable(clone(state))
    const request = immutable({system, tools:clone(fixedTools), messages:[{role:'user', content:JSON.stringify({
      first:items[0].at, paragraphs:items.map(({id, at, unit}) => ({id, at, unit})), carried
    })}]})
    calls++; flight = ticket; notify()
    let acceptedWindow = false
    const accept = result => {
      if (acceptedWindow || cancelled || ticket.epoch !== epoch || controller.signal.aborted) return
      if (!result || !Array.isArray(result.results) || result.results.length !== items.length) throw new Error('Validated director window is incomplete')
      // Check the entire port result before publishing any of it.
      const accepted = []
      let before = carried, beforeAccounting = accounting
      for (let i = 0; i < items.length; i++) {
        const paragraph = items[i], output = result.results[i]
        if (output.id !== paragraph.id || output.at !== paragraph.at || !Array.isArray(output.ops) || !output.state) throw new Error('Validated director window is unaligned')
        accepted.push(immutable({at:paragraph.at, unitDigest:assetPackDigest(paragraph.unit), before:assetPackDigest(before), beforeAccounting:assetPackDigest(beforeAccounting), accounting:clone(output.accounting || beforeAccounting), ops:clone(output.ops), state:clone(output.state), ...(output.entries ? {entries:clone(output.entries)} : {}), diagnostics:clone(output.diagnostics || [])}))
        before = output.state; beforeAccounting = output.accounting || beforeAccounting
      }
      for (let i = 0; i < items.length; i++) append(items[i], accepted[i])
      acceptedWindow = true
      notify()
    }
    const task = Promise.resolve().then(() => {
      // Keep the native flight occupied through teardown, but publish validated output now.
      if (controller.signal.aborted) return null
      return run({identity:source, epoch:ticket.epoch, request, paragraphs:items, carried, signal:controller.signal, accept})
    }).then(accept).catch(error => {
      if (!cancelled && ticket.epoch === epoch && !controller.signal.aborted) failure = {code:error.code || 'STREAMING_DIRECTOR_FAILED', message:String(error.message || error)}
    }).finally(() => {
      // A rewrite aborts but does not overlap another native request, even when the
      // provider ignores AbortSignal. Only settlement of the old call frees flight.
      if (flight === ticket) flight = null
      tasks.delete(task); notify(); schedule()
    })
    tasks.add(task)
  }
  function update(units, final = false) {
    if (cancelled || committed) return snapshot()
    const previous = paragraphs, changed = index.reconcile(units, final)
    paragraphs = changed.paragraphs
    highWater = Math.max(highWater, paragraphs.length)
    // Later bubble parsing must not abort a sealed opening that never read that tail.
    const affected = !remainderOnCommit || previous.slice(0,Math.max(through,flight?.through || 0)).some((item,i) =>
      paragraphs[i]?.id !== item.id || !same(paragraphs[i]?.unit,item.unit) || !paragraphs[i]?.sealed)
    if (changed.rewrite && affected) {
      epoch++; flight?.controller.abort(); through = 0; state = initial; accounting = {counts:{},totalOps:0}; diagnostics = []; published = []; failure = null
      const live = new Set(paragraphs.map(item => item.id))
      records = new Map([...records].filter(([id]) => live.has(id)))
    }
    committed = final
    notify(); schedule()
    return snapshot()
  }
  return {
    update, commit:units => update(units, true), snapshot,
    cancel() { if (!cancelled) {cancelled = true; flight?.controller.abort(); notify()} },
    fail(error) {
      failure = {code:error.code || 'STREAMING_DIRECTOR_FAILED',message:String(error.message || error)}
      flight?.controller.abort(); notify()
    },
    async drain() {
      do { await Promise.resolve(); await Promise.all([...tasks]) } while (tasks.size || scheduled)
    }
  }
}
