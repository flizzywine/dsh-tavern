import { parse as parseYaml } from 'yaml'

// Value limits for MVU variables, declared where the card already describes its variables' structure: an object's
// `$meta` in the initial values (next to extensible / required / template) may carry `limits`, keyed by a path relative
// to that object (segments split by `/`, `*` for every child, `~1` for a `/` inside a name) with
// { min?, max?, values?, integer?, meter?, cap?, clamp? }:
//   "机构": { "混沌": 0, "$meta": { "limits": { "混沌": { "min": 0, "integer": true } } } }
//   "已标": { "职能": 0, "$meta": { "limits": { "*": { "min": 0, "max": 30 } } } }
//   "队伍": { "$meta": { "limits": { "*/生命": { "meter": true, "max": 999 }, "*/好感": { "min": 0, "max": 100, "clamp": true } } } }
// meter: the value is one text "current/cap" of integers with current <= cap; min bounds the current (default 0), cap
// fixes the cap, max bounds a cap that may change. clamp: a value out of range is brought back into it instead of
// rejected (values and integer are never clamped). Official MVU keeps only the $meta fields it knows when it builds
// variables.schema, so the limits are read from the card's initial values. The write gate (mvu-write-gate.js) checks
// every changed value against them. Checked once when the card is written (the card check); reads keep only
// well-formed rules.

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const encode = segment => String(segment).replace(/~/g, '~0').replace(/\//g, '~1')
const decode = segment => segment.replace(/~1/g, '/').replace(/~0/g, '~')
const METER = /^(-?\d+)\/(-?\d+)$/

/** A "current/cap" meter text as integers, or null when it is not one. */
export function parseMeter(value) {
  const match = typeof value === 'string' ? METER.exec(value) : null
  return match ? { current: Number(match[1]), cap: Number(match[2]) } : null
}

function normalizeRule(rule, path, error) {
  if (!object(rule)) { error(path, '取值范围必须是对象，如 { "min": 0, "max": 30 } 或 { "values": [0, 1, 2] }'); return null }
  const out = {}
  for (const key of ['min', 'max', 'cap']) {
    if (rule[key] === undefined) continue
    if (typeof rule[key] !== 'number' || !Number.isFinite(rule[key])) { error(path + '/' + key, key + ' 必须是有限数字'); return null }
    out[key] = rule[key]
  }
  for (const key of ['integer', 'meter', 'clamp']) {
    if (rule[key] === undefined) continue
    if (typeof rule[key] !== 'boolean') { error(path + '/' + key, key + ' 必须是 true 或 false'); return null }
    if (rule[key]) out[key] = true
  }
  if (rule.values !== undefined) {
    if (!Array.isArray(rule.values) || !rule.values.length || rule.values.some(value => value === null || typeof value === 'object')) {
      error(path + '/values', 'values 必须是非空数组，元素是数字、文本或布尔值'); return null
    }
    out.values = [...rule.values]
  }
  if (out.meter) {
    if (out.values) { error(path, '「当前/上限」（meter）不能写 values'); return null }
    if (out.cap !== undefined && (!Number.isInteger(out.cap) || out.cap < 0)) { error(path + '/cap', 'cap 必须是非负整数'); return null }
    if (out.cap !== undefined && out.max !== undefined) { error(path, 'cap 固定了上限，不要再写 max'); return null }
    delete out.integer
  } else if (out.cap !== undefined) { error(path + '/cap', 'cap 只用于「当前/上限」（写 "meter": true）'); return null }
  if (out.min !== undefined && out.max !== undefined && out.min > out.max) { error(path, 'min 不能大于 max'); return null }
  if (out.clamp && out.min === undefined && out.max === undefined && !out.meter) { error(path, 'clamp 要配 min 或 max（values 不能收回）'); return null }
  if (!['min', 'max', 'values', 'integer', 'meter'].some(key => out[key] !== undefined)) { error(path, '至少写 min、max、values、integer、meter 中的一项'); return null }
  return out
}

/** The limits in one initial-values object: { errors, normalized: [{ path, segments, ...rule }] | null }. */
export function validateMvuLimits(state, prefix = '') {
  const errors = [], normalized = []
  const error = (path, message) => errors.push({ path, message })
  function walk(node, segments) {
    if (!object(node)) return
    const limits = object(node.$meta) ? node.$meta.limits : undefined
    const at = prefix + segments.map(segment => '/' + encode(segment)).join('') + '/$meta/limits'
    if (limits !== undefined && !object(limits)) error(at, 'limits 必须是「子项路径 → 取值范围」的对象，子项名可以写 * 表示每一项，多层用 / 连接（如 */生命）')
    else if (limits) {
      for (const [key, rule] of Object.entries(limits)) {
        const relative = key.split('/').map(decode)
        if (relative.some(segment => segment === '' || segment === '$meta')) { error(at + '/' + encode(key), '子项路径的每一段要是名字或 *'); continue }
        // Only the named segments before the first * have to exist: children added during play are not in the initial values.
        let reached = node, missing = null
        for (const segment of relative) {
          if (segment === '*') break
          if (!object(reached) || !Object.hasOwn(reached, segment)) { missing = segment; break }
          reached = reached[segment]
        }
        if (missing !== null) { error(at + '/' + encode(key), '这一层没有「' + missing + '」这一项（写 * 表示每一项）'); continue }
        const limit = normalizeRule(rule, at + '/' + encode(key), error)
        if (limit) normalized.push({ path: '/' + [...segments, ...relative].map(encode).join('/'), segments: [...segments, ...relative], ...limit })
      }
    }
    for (const [key, child] of Object.entries(node)) if (key !== '$meta') walk(child, [...segments, key])
  }
  walk(state, [])
  return { errors, normalized: normalized.length ? normalized : null }
}

/** The initial values that break their own limits (the card check: a card must start inside them). */
export function initialMvuLimitViolations(state, limits, prefix = '') {
  return (limits || []).flatMap(limit => matches(state, limit.segments)
    .filter(({ value }) => violation(limit, value))
    .map(({ path, value }) => ({ path: prefix + '/' + path.map(encode).join('/'), message: '初值 ' + JSON.stringify(value) + ' 不满足自己的范围：' + allowed(limit) })))
}

// The card's initial values: the first opening's <initvar>, else its [initvar] worldbook entries (JSON or YAML).
// A source that is a template (EJS) is not read: its structure is only known once rendered (the card check says so).
function initialValues(data) {
  const block = /<initvar>([\s\S]*?)<\/initvar>/i.exec(String(data?.first_mes || ''))
  const entries = Array.isArray(data?.character_book?.entries) ? data.character_book.entries : []
  const sources = block ? [block[1]] : entries.filter(entry => /^\s*\[initvar\]/i.test(String(entry?.comment || entry?.name || ''))).map(entry => String(entry.content || ''))
  let state = {}
  for (const source of sources) {
    const text = source.replace(/^\s*```[^\n]*\n|\n```\s*$/g, '').trim()
    if (!text || text.includes('<%')) continue
    try { const parsed = parseYaml(text, { maxAliasCount: 50 }); if (object(parsed)) state = { ...state, ...parsed } } catch { /* the card check reports it */ }
  }
  return state
}

/** The limits a card declares in its initial values (card data or a v2/v3 wrapper); null when none. */
export function cardMvuLimits(card) {
  const data = object(card?.data) && (card.spec === 'chara_card_v2' || card.spec === 'chara_card_v3') ? card.data : card
  return validateMvuLimits(initialValues(data)).normalized
}

/** What a limit allows, in words. */
export function allowed(limit) {
  if (limit.meter) {
    const parts = ['写成 "当前/上限"（两边整数，当前不超过上限，如 "2/3"）']
    if (limit.cap !== undefined) parts.push('上限固定是 ' + limit.cap)
    else if (limit.max !== undefined) parts.push('上限不超过 ' + limit.max)
    parts.push('当前不小于 ' + (limit.min ?? 0))
    return parts.join('，')
  }
  const parts = []
  if (limit.values) parts.push('只能是 ' + limit.values.map(value => JSON.stringify(value)).join('、') + ' 之一')
  if (limit.integer) parts.push('是整数')
  if (limit.min !== undefined && limit.max !== undefined) parts.push('应在 ' + limit.min + ' 到 ' + limit.max + ' 之间')
  else if (limit.min !== undefined) parts.push('应不小于 ' + limit.min)
  else if (limit.max !== undefined) parts.push('应不大于 ' + limit.max)
  return parts.join('，')
}

/** One line per limit for the background prompt. */
export function describeMvuLimits(limits) {
  return (limits || []).map(limit => '/stat_data' + limit.path + '：' + allowed(limit)
    + (limit.meter ? '；增减当前用 op="delta" 传整数（如 -1），不要自己拼字符串；只有改上限或两边一起改时才用 replace 写 "当前/上限"' : '')
    + (limit.clamp ? '；超出时自动按边界收回' : '')).join('\n')
}

// The reason a value breaks a limit, or '' when it does not.
function violation(limit, value) {
  if (limit.meter) {
    const meter = parseMeter(value)
    if (!meter) return 'type'
    if (meter.current > meter.cap || meter.current < (limit.min ?? 0)) return 'range'
    if (limit.cap !== undefined ? meter.cap !== limit.cap : limit.max !== undefined && meter.cap > limit.max) return 'range'
    return ''
  }
  if (limit.values && !limit.values.some(item => item === value)) return 'range'
  if ((limit.min !== undefined || limit.max !== undefined || limit.integer) && typeof value !== 'number') return 'type'
  if (limit.integer && !Number.isInteger(value)) return 'type'
  if ((limit.min !== undefined && value < limit.min) || (limit.max !== undefined && value > limit.max)) return 'range'
  return ''
}

/** The value a clamp limit brings `value` back to, or undefined when it cannot (a value of the wrong form, a listed value). */
export function clampToLimit(limit, value) {
  if (!limit.clamp) return undefined
  const into = (number, low, high) => Math.min(high ?? Infinity, Math.max(low ?? -Infinity, number))
  if (limit.meter) {
    const meter = parseMeter(value)
    if (!meter) return undefined
    const cap = limit.cap ?? into(meter.cap, 0, limit.max)
    return into(meter.current, limit.min ?? 0, cap) + '/' + cap
  }
  if (typeof value !== 'number' || limit.values || (limit.integer && !Number.isInteger(value))) return undefined
  return into(value, limit.min, limit.max)
}

// Every concrete path under `node` the pattern names, with its value.
function matches(node, segments, path = []) {
  if (!segments.length) return [{ path, value: node }]
  if (!object(node) && !Array.isArray(node)) return []
  const [head, ...rest] = segments
  const keys = head === '*' ? Object.keys(node).filter(key => !key.startsWith('$')) : Object.hasOwn(node, head) ? [head] : []
  return keys.flatMap(key => matches(node[key], rest, [...path, key]))
}

/** The limits that name one concrete stat_data path (segments). */
export function limitsAt(limits, segments) {
  return (limits || []).filter(limit => limit.segments.length === segments.length
    && limit.segments.every((segment, index) => segment === '*' ? !String(segments[index]).startsWith('$') : segment === segments[index]))
}

/** Why a value at a concrete path breaks the limits naming it: [{ limit, rule: 'type'|'range', allowed, message }]. */
export function limitFailuresAt(limits, segments, value, before) {
  const pointer = '/stat_data/' + segments.map(encode).join('/')
  return limitsAt(limits, segments).flatMap(limit => {
    const rule = violation(limit, value)
    return rule ? [{ limit, rule, allowed: allowed(limit), message: pointer + ' ' + allowed(limit) + '；这批操作执行后是 ' + JSON.stringify(value)
      + (before === undefined ? '' : '（执行前 ' + JSON.stringify(before) + '）') + '。请按正文和当前值重新核对这一项，提交范围内的结果' }] : []
  })
}
