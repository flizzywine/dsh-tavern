import { clampToLimit, describeMvuLimits, limitFailuresAt, limitsAt, parseMeter } from './mvu-limits.js'

// The one check every write of MVU variables (stat_data) passes before it is saved:
// path → owner → type, range and integer (the card's $meta.limits) → the rules' relations (a mod's constraints). Only the
// values a write changed are checked, plus what the rules say depends on them. The gate reads; each write site saves.
//
// source: settlement (the background model) | rules (rule tool results) | panel | widget | script | plugin | opening | migration.
// Rule-owned paths: settlement drops them before it writes (mvu-background-settlement.js); script, widget and plugin are
// refused there; rules, panel, opening and migration may write them, through the same checks.

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right)
export const encodePointerSegment = segment => String(segment).replaceAll('~', '~0').replaceAll('/', '~1')
const OWNER_REFUSED = new Set(['script', 'widget', 'plugin'])

export function pointerSegments(pointer) {
  return String(pointer).split('/').slice(1).map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}

/** An operation path as an absolute variables pointer (/stat_data/...; older relative paths are under stat_data). */
export function variablesPointer(pointer) {
  const segments = pointerSegments(pointer)
  return '/' + (segments[0] === 'stat_data' ? segments : ['stat_data', ...segments]).map(encodePointerSegment).join('/')
}

// A segment "*" in an owned path stands for any one name (a rules variable each party member keeps, /特工表/*/资质保证).
export function pathsOverlap(left, right) {
  if (left === right || left.startsWith(right + '/') || right.startsWith(left + '/')) return true
  if (!right.includes('/*')) return false
  const a = left.split('/'), b = right.split('/')
  return a.slice(0, Math.min(a.length, b.length)).every((segment, index) => b[index] === '*' || b[index] === segment)
}

/** The pointers one JSON Patch operation touches (a move both ends; an append to a list the list). */
export function operationPointers(operation) {
  if (operation.op === 'move') return [variablesPointer(operation.from), variablesPointer(operation.path)]
  const target = variablesPointer(operation.path)
  if ((operation.op === 'insert' || operation.op === 'add') && target.endsWith('/-')) return [target.slice(0, -2)]
  return [target]
}

// Every changed leaf of stat_data, in full (never truncated: a check that stops early lets the rest through). A value
// that appears or disappears with a whole object is walked into, so a new member's fields are checked too.
const container = value => object(value) || Array.isArray(value)
function changedLeaves(before, after, segments = [], out = []) {
  if (sameValue(before, after)) return out
  const walk = (container(before) || before === undefined) && (container(after) || after === undefined)
    && !(container(before) && container(after) && Array.isArray(before) !== Array.isArray(after))
  if (!walk) { out.push({ segments, before, after }); return out }
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (key !== '$meta') changedLeaves(before?.[key], after?.[key], [...segments, key], out)
  }
  return out
}

const pointerOf = segments => '/stat_data/' + segments.map(encodePointerSegment).join('/')

function valueAt(root, segments) {
  let node = root
  for (const key of segments) {
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, key)) return undefined
    node = node[key]
  }
  return node
}

function setAt(root, segments, value) {
  let node = root
  for (const key of segments.slice(0, -1)) node = node[key]
  node[segments.at(-1)] = value
}

// Operations whose pointers overlap form one segment: JSON Patch applies a batch whole because a later operation may
// build on an earlier one (create an object, then write into it; move; the same path twice).
function segmentsOf(operations) {
  const parent = operations.map((_operation, index) => index)
  const find = index => parent[index] === index ? index : (parent[index] = find(parent[index]))
  const pointers = operations.map(operationPointers)
  for (let i = 0; i < operations.length; i++) for (let j = i + 1; j < operations.length; j++) {
    if (pointers[i].some(left => pointers[j].some(right => pathsOverlap(left, right)))) parent[find(j)] = find(i)
  }
  const groups = new Map()
  operations.forEach((operation, index) => {
    const root = find(index)
    if (!groups.has(root)) groups.set(root, { id: 'segment-' + (groups.size + 1), operations: [], pointers: [], failures: [] })
    groups.get(root).operations.push(operation)
    groups.get(root).pointers.push(...pointers[index])
  })
  return [...groups.values()]
}

/** One gate per card: its limits, the rule-owned paths and a mod's constraints ({ check, settle?, describe? }). */
export function createMvuWriteGate({ limits = [], ownedPaths = [], constraints = null } = {}) {
  const owned = ownedPaths.map(variablesPointer)
  const isOwned = pointer => owned.some(path => pathsOverlap(pointer, path))

  /**
   * before/after: variables ({ stat_data }). operations: the submitted operations, ruleOperations: the rule tools' (one
   * segment, settlement only). Returns the changed pointers, the failures (each with its segment), the segments, what
   * changed outside every operation (side: its limit breaks are warnings: nobody here can fix a card script's writes),
   * and for the host's own writes the state with the clamp limits applied (corrected) and what was clamped.
   */
  function check({ source, before, after: written, operations = [], ruleOperations = [] }) {
    const beforeData = object(before?.stat_data) ? before.stat_data : {}
    // A host write the rules did not make: the rules' derived values and caps are worked out again as an action leaves
    // them (constraints.settle), and that is what is checked and saved. The background's writes are settled by its run;
    // a script, widget or plugin may not write those paths at all.
    const settled = source !== 'settlement' && !OWNER_REFUSED.has(source) && constraints?.settle && object(written?.stat_data) ? constraints.settle(written.stat_data) : written?.stat_data
    const after = settled === written?.stat_data ? written : { ...written, stat_data: settled }
    const afterData = object(after?.stat_data) ? after.stat_data : {}
    const leaves = changedLeaves(beforeData, afterData)
    const segments = segmentsOf(operations)
    const rules = ruleOperations.length ? { id: 'rules', operations: ruleOperations, pointers: ruleOperations.flatMap(operationPointers), failures: [] } : null
    const side = { id: 'side', operations: [], pointers: [], failures: [], warnings: [] }
    const owner = pointer => (rules && rules.pointers.some(item => pathsOverlap(pointer, item)) ? rules : null)
      || segments.find(segment => segment.pointers.some(item => pathsOverlap(pointer, item))) || (operations.length || rules ? side : null)
    const failures = [], clamped = []
    let corrected = null
    const fail = (pointer, failure) => {
      const segment = owner(pointer)
      const row = { path: pointer, ...failure, ...(segment ? { segment: segment.id } : {}) }
      if (segment === side && source === 'settlement') { side.warnings.push(row); return }
      failures.push(row)
      segment?.failures.push(row)
    }
    for (const leaf of leaves) {
      const pointer = pointerOf(leaf.segments)
      if (OWNER_REFUSED.has(source) && isOwned(pointer)) {
        fail(pointer, { rule: 'owner', current: leaf.before, value: leaf.after, allowed: '只能经规则动作改', message: pointer + ' 归规则管，只能经规则动作改' })
        continue
      }
      if (leaf.after === undefined) continue
      for (const broken of limitFailuresAt(limits, leaf.segments, leaf.after, leaf.before)) {
        const into = source === 'settlement' ? undefined : clampToLimit(broken.limit, leaf.after)
        if (into !== undefined) {
          corrected ??= structuredClone(after)
          setAt(corrected.stat_data, leaf.segments, into)
          clamped.push({ path: pointer, from: leaf.after, to: into })
          continue
        }
        fail(pointer, { rule: broken.rule, current: leaf.before, value: leaf.after, allowed: broken.allowed, message: broken.message })
        break
      }
    }
    const changed = leaves.map(leaf => pointerOf(leaf.segments))
    if (constraints && changed.length) {
      for (const failure of constraints.check({ before: beforeData, after: (corrected || after)?.stat_data || {}, changed, source }) || []) fail(failure.path, failure)
    }
    if (after !== written) for (const leaf of changedLeaves(written.stat_data, after.stat_data)) clamped.push({ path: pointerOf(leaf.segments), from: leaf.before, to: leaf.after })
    return { changed, failures, segments: [...(rules ? [rules] : []), ...segments, side], side, corrected: corrected || after, clamped }
  }

  /**
   * Before the background's operations run: a delta on a "current/cap" meter becomes the replace it computes (official
   * MVU cannot add to text), and a value a clamp limit names is brought into range. The numbers are the host's.
   */
  function prepare(operations, variables) {
    const root = { stat_data: structuredClone(object(variables?.stat_data) ? variables.stat_data : {}) }
    const clamped = []
    const clampLeaves = (segments, value) => {
      if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === '$meta' ? item : clampLeaves([...segments, key], item)]))
      for (const limit of limitsAt(limits, segments)) {
        const into = clampToLimit(limit, value)
        if (into !== undefined && !sameValue(into, value)) { clamped.push({ path: pointerOf(segments), from: value, to: into }); return into }
      }
      return value
    }
    const prepared = operations.map(operation => {
      if (!['replace', 'delta', 'insert', 'add'].includes(operation.op)) return operation
      const segments = pointerSegments(variablesPointer(operation.path)).slice(1)
      if (segments.at(-1) === '-') return { ...operation, value: clampLeaves(segments, operation.value) }
      let next = operation
      if (operation.op === 'delta') {
        const current = valueAt(root.stat_data, segments)
        const meterLimit = limitsAt(limits, segments).find(limit => limit.meter)
        const meter = meterLimit ? parseMeter(current) : null
        if (meter) next = { op: 'replace', path: operation.path, value: (meter.current + operation.value) + '/' + meter.cap }
        else if (typeof current === 'number' && limitsAt(limits, segments).some(limit => limit.clamp)) {
          const value = current + operation.value, into = clampLeaves(segments, value)
          next = sameValue(into, value) ? operation : { op: 'replace', path: operation.path, value: into }
        }
        if (next.op === 'delta') {
          if (typeof current === 'number' && valueAt(root.stat_data, segments.slice(0, -1)) !== undefined) setAt(root.stat_data, segments, current + operation.value)
          return next
        }
      }
      next = { ...next, value: clampLeaves(segments, next.value) }
      if (segments.length && object(valueAt(root.stat_data, segments.slice(0, -1)))) setAt(root.stat_data, segments, structuredClone(next.value))
      return next
    })
    return { operations: prepared, clamped }
  }

  function describe() {
    return [describeMvuLimits(limits), ...(constraints?.describe?.() || [])].filter(Boolean).join('\n')
  }

  return Object.freeze({ check, prepare, describe, owned: Object.freeze([...owned]) })
}

/**
 * A host write of whole variables (panel, page script, plugin, opening, widget, migration): all or nothing. Returns the
 * variables to save (with the clamp limits applied) and what was clamped; a write that breaks a rule throws one error
 * naming every broken value (code DSH_MVU_WRITE_REJECTED, failures on it), so nothing of it is saved.
 */
export function admitMvuWrite(gate, { source, before, after }) {
  if (!gate || !object(after?.stat_data)) return { variables: after, clamped: [] }
  const checked = gate.check({ source, before, after })
  if (checked.failures.length) {
    const lines = checked.failures.slice(0, 8).map(failure => failure.message || (failure.path + '：' + (failure.allowed || '不允许')))
    const more = checked.failures.length > lines.length ? '；另有 ' + (checked.failures.length - lines.length) + ' 处' : ''
    throw Object.assign(new Error('变量没有保存：' + lines.join('；') + more), {
      code: 'DSH_MVU_WRITE_REJECTED', source, failures: checked.failures.map(({ segment: _segment, ...failure }) => failure) })
  }
  return { variables: checked.corrected, clamped: checked.clamped }
}
