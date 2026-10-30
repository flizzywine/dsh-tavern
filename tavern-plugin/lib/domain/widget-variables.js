// shared finite projections and capability checks; no storage or executor.
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import contract from '../../src/client/widget-contracts.cjs'
import { resolveVariable } from './variable-bindings/index.js'

const { stageWidgetVariablePointer: pointer, stageWidgetVariableContains: contains, validateStageWidgetVariables: validate, stageWidgetPlain: plain } = contract
const bytes = value => Buffer.byteLength(JSON.stringify(value))
const encode = parts => '/' + parts.map(key => key.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')
const safeKey = key => !['__proto__', 'prototype', 'constructor'].includes(key) && !/^(\$|__)/.test(key)
const reject = reason => { throw Object.assign(new Error(reason), { code: 'WIDGET_VARIABLE_REJECTED' }) }
// Native window and slice readers may reconstruct object keys in different orders.
export const widgetVariableJson = value => JSON.stringify(value, (_key,item) =>
  plain(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item) ?? 'undefined'
export const widgetVariableDigest = value => createHash('sha256').update(widgetVariableJson(value)).digest('hex')

export function widgetVariableAt(root, parts) {
  let value = root
  for (const key of parts) {
    if (!value || typeof value !== 'object' || Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key) || !Object.hasOwn(value, key)) return { present: false }
    value = value[key]
  }
  return { present: true, value }
}

function boundedValue(value, budget) {
  function walk(item, depth) {
    if (++budget.nodes > 2048 || depth > 12) throw new Error('too-large')
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item
    if (typeof item === 'number' && Number.isFinite(item)) return item
    if (Array.isArray(item)) return item.map(value => walk(value, depth + 1))
    if (!plain(item)) throw new Error('not-json')
    const output = {}
    for (const key of Object.keys(item)) if (safeKey(key)) output[key] = walk(item[key], depth + 1)
    return output
  }
  const output = walk(value, 0)
  if (bytes(output) > 8192) throw new Error('too-large')
  return output
}

export function projectWidgetVariableValues(declarations, sources, pathCache = new Map()) {
  validate(declarations)
  const values = {}, budget = { nodes: 0 }
  let size = 0
  for (const [id, read] of Object.entries(declarations.reads || {})) {
    const source = sources[read.source]
    if (!source?.available) { values[id] = { status: 'unavailable' }; continue }
    const key = read.source + ':' + read.path
    try {
      let cached = pathCache.get(key)
      if (!cached) {
        const found = widgetVariableAt(source.value, pointer(read.path)), count = {nodes:0}
        cached = found.present ? {value:boundedValue(found.value,count),nodes:count.nodes} : {missing:true,nodes:0}
        if (pathCache.size < 256) pathCache.set(key,cached)
      }
      budget.nodes += cached.nodes
      if (budget.nodes > 2048) throw new Error('too-large')
      if (cached.missing) { values[id] = {status:'missing'}; continue }
      const item = { status: 'ready', value: cached.value }
      const cost = bytes({ [id]: item })
      if (size + cost > 12288) throw new Error('too-large')
      size += cost
      values[id] = item
    } catch { values[id] = { status: 'too-large' } }
  }
  return values
}

// A binding shares the read-point and path cache, but never grants an iframe another read capability.
export function projectWidgetSettingBindings(bindings, sources, pathCache) {
  return Object.fromEntries(Object.entries(bindings || {}).map(([key,binding]) => [key,resolveVariable(binding,sources)]))
}

// The caller supplies a revision-pinned, indexed window, not a latest-variable scan.
// It must include the current row and at most 19 proven predecessors on this branch.
export function resolveWidgetVariableSnapshot({ rows, messageId, lastPage, live = false, chatVariables, settlement = 'idle' }) {
  if (!Array.isArray(rows) || rows.length > 20) throw new Error('Invalid variable history window')
  const current = rows.find(row => row.messageId === messageId)
  if (!current) return { kind: 'unavailable', turn: null, sources: {} }
  const waiting = ['pending', 'running', 'waiting-runtime', 'failed'].includes(settlement)
  const eligible = rows.filter(row => row.messageId < messageId || row.messageId === messageId && lastPage && !waiting)
    .sort((left, right) => right.messageId - left.messageId)
  const saved = eligible.find(row => row.message?.role === 'assistant' && !row.message.mvu?.pending
    && !['error','failed','rejected'].includes(row.message.mvu?.receipt?.status)
    && plain(row.message.variables?.[row.message.swipeId || 0]?.stat_data))
  const sources = { 'helper-chat': { available: live && lastPage, value: chatVariables } }
  if (!saved) return { kind: 'unavailable', turn: null, sources }
  sources.mvu = { available: true, value: saved.message.variables[saved.message.swipeId || 0].stat_data }
  const verified = saved.verified === true
  return { kind: !verified ? 'saved-unverified' : saved.messageId === messageId ? 'exact' : 'inherited', turn: saved.message.turn || (saved.message.greeting ? 1 : 0), sources }
}

function jsonValue(value) {
  let nodes = 0
  function visit(item, depth) {
    if (++nodes > 2048 || depth > 12) reject('value-too-large')
    if (item === null || ['string', 'boolean'].includes(typeof item)) return
    if (typeof item === 'number' && Number.isFinite(item)) return
    if (Array.isArray(item)) { for (const child of item) visit(child, depth + 1); return }
    if (!plain(item) || Object.keys(item).some(key => !safeKey(key))) reject('invalid-value')
    for (const child of Object.values(item)) visit(child, depth + 1)
  }
  visit(value, 0)
}

// Validate and simulate only to check intent/preconditions. This is NOT an MVU writer.
// The caller must run the returned operations through the real MVU executor.
export function prepareWidgetVariableOperations(declarations, baseline, operations) {
  validate(declarations)
  if (!plain(baseline) || !Array.isArray(operations) || !operations.length || operations.length > 16 || bytes(operations) > 8192) reject('invalid-operations')
  const expected = structuredClone(baseline), normalized = []
  for (const operation of operations) {
    if (!plain(operation) || Object.keys(operation).some(key => !['writeId', 'suffix', 'op', 'value'].includes(key))) reject('invalid-operation')
    const write = declarations.writes?.[operation.writeId]
    if (!write || !write.ops.includes(operation.op)) reject('undeclared-operation')
    const base = pointer(write.path), suffix = pointer(operation.suffix ?? '', true)
    if (write.scope === 'exact' && suffix.length) reject('exact-suffix')
    const root = widgetVariableAt(baseline, base)
    if (write.scope === 'subtree' && (!root.present || root.value === null || typeof root.value !== 'object')) reject('subtree-root-missing')
    const parts = [...base, ...suffix]
    if (parts.length > 16 || Buffer.byteLength(encode(parts)) > 512) reject('path-too-large')
    if (parts.slice(0, -1).includes('-')) reject('invalid-append')
    const target = widgetVariableAt(expected, parts), parent = widgetVariableAt(expected, parts.slice(0, -1)), key = parts.at(-1)
    if (!parent.present || !parent.value || typeof parent.value !== 'object') reject('parent-missing')
    const array = Array.isArray(parent.value)
    if (array && (write.scope !== 'subtree' || !(key === '-' || /^(0|[1-9][0-9]*)$/.test(key)))) reject('array-needs-subtree')
    if (key === '-' && (!array || operation.op !== 'insert')) reject('invalid-append')
    if (operation.op !== 'remove') { if (!Object.hasOwn(operation, 'value')) reject('value-required'); jsonValue(operation.value) }
    else if (Object.hasOwn(operation, 'value')) reject('remove-value')
    if (write.scope === 'exact' && ((target.present && typeof target.value === 'object' && target.value !== null) || (operation.value !== null && typeof operation.value === 'object'))) reject('exact-requires-scalar')
    if (operation.op !== 'insert' && !target.present) reject('target-missing')
    if (operation.op === 'insert') {
      if (array) {
        const index = key === '-' ? parent.value.length : Number(key)
        if (index > parent.value.length) reject('array-index')
        parent.value.splice(index, 0, structuredClone(operation.value))
      } else {
        if (target.present) reject('target-exists')
        parent.value[key] = structuredClone(operation.value)
      }
    } else if (operation.op === 'remove') {
      if (array) parent.value.splice(Number(key), 1)
      else delete parent.value[key]
    } else if (operation.op === 'delta') {
      if (typeof target.value !== 'number' || !Number.isFinite(operation.value) || typeof operation.value !== 'number' || !Number.isFinite(target.value + operation.value)) reject('delta-requires-finite-number')
      parent.value[key] += operation.value
    } else parent.value[key] = structuredClone(operation.value)
    normalized.push({ op: operation.op, path: '/stat_data' + encode(parts), ...(operation.op !== 'remove' ? { value: structuredClone(operation.value) } : {}) })
  }
  return { operations: normalized, expected }
}

// Complete change traversal: no truncated audit can authorize a transaction.
export function auditWidgetVariableResult(declarations, before, after, expected) {
  validate(declarations)
  const writes = Object.values(declarations.writes || {}).map(write => ({ ...write, parts: pointer(write.path) }))
  const paths = []
  let visited = 0
  function visit(left, right, parts) {
    if (++visited > 8192 || parts.length > 16) reject('change-set-too-large')
    if (isDeepStrictEqual(left, right)) return
    if (plain(left) && plain(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) visit(left[key], right[key], [...parts, key])
      return
    }
    if (!parts.length || parts.some(key => !safeKey(key)) || !writes.some(write => contains(write.parts, parts) && (write.scope === 'subtree' || write.parts.length === parts.length && ![left, right].some(value => value !== null && typeof value === 'object')))) reject('out-of-scope-result')
    paths.push(encode(parts))
    if (paths.length > 64 || bytes(paths) > 8192) reject('feedback-budget-exhausted')
  }
  visit(before, after, [])
  // A silently ignored leaf must not permit the remaining half of a batch.
  function checkIntent(left, wanted, actual) {
    if (isDeepStrictEqual(left, wanted)) return
    if (plain(left) && plain(wanted) || Array.isArray(left) && Array.isArray(wanted)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(wanted)])) checkIntent(left[key], wanted[key], actual?.[key])
    } else if (isDeepStrictEqual(left, actual)) reject('operation-not-applied')
  }
  if (paths.length) checkIntent(before, expected, after)
  return { paths, status: paths.length ? 'committed' : 'unchanged', normalized: !isDeepStrictEqual(expected, after) }
}
