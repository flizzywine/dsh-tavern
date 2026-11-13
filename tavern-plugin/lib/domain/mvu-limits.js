import { parse as parseYaml } from 'yaml'

// Value limits for MVU variables, declared where the card already describes its variables' structure: an object's
// `$meta` in the initial values (next to extensible / required / template) may carry `limits`, keyed by child name
// (`*` for every child) with { min?, max?, values? }:
//   "机构": { "混沌": 0, "$meta": { "limits": { "混沌": { "min": 0 } } } }
//   "已标": { "职能": 0, "$meta": { "limits": { "*": { "min": 0, "max": 30 } } } }
// Official MVU keeps only the $meta fields it knows when it builds variables.schema, so the limits are read from the
// card's initial values. Settlement checks every value a submission changed against them before saving; a violation
// rolls the batch back with a reason the background agent can fix. Checked once when the card is written (the card
// check); reads keep only well-formed rules.

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const encode = segment => String(segment).replace(/~/g, '~0').replace(/\//g, '~1')

function normalizeRule(rule, path, error) {
  if (!object(rule)) { error(path, '取值范围必须是对象，如 { "min": 0, "max": 30 } 或 { "values": [0, 1, 2] }'); return null }
  const out = {}
  for (const key of ['min', 'max']) {
    if (rule[key] === undefined) continue
    if (typeof rule[key] !== 'number' || !Number.isFinite(rule[key])) { error(path + '/' + key, key + ' 必须是有限数字'); return null }
    out[key] = rule[key]
  }
  if (rule.values !== undefined) {
    if (!Array.isArray(rule.values) || !rule.values.length || rule.values.some(value => value === null || typeof value === 'object')) {
      error(path + '/values', 'values 必须是非空数组，元素是数字、文本或布尔值'); return null
    }
    out.values = [...rule.values]
  }
  if (out.min !== undefined && out.max !== undefined && out.min > out.max) { error(path, 'min 不能大于 max'); return null }
  if (!Object.keys(out).length) { error(path, '至少写 min、max、values 中的一项'); return null }
  return out
}

/** The limits in one initial-values object: { errors, normalized: [{ path, segments, min?, max?, values? }] | null }. */
export function validateMvuLimits(state, prefix = '') {
  const errors = [], normalized = []
  const error = (path, message) => errors.push({ path, message })
  function walk(node, segments) {
    if (!object(node)) return
    const limits = object(node.$meta) ? node.$meta.limits : undefined
    const at = prefix + segments.map(segment => '/' + encode(segment)).join('') + '/$meta/limits'
    if (limits !== undefined && !object(limits)) error(at, 'limits 必须是「子项名 → 取值范围」的对象，子项名可以写 * 表示每一项')
    else if (limits) {
      for (const [key, rule] of Object.entries(limits)) {
        if (key !== '*' && !Object.hasOwn(node, key)) { error(at + '/' + encode(key), '这一层没有「' + key + '」这一项（写 * 表示每一项）'); continue }
        const limit = normalizeRule(rule, at + '/' + encode(key), error)
        if (limit) normalized.push({ path: '/' + [...segments, key].map(encode).join('/'), segments: [...segments, key], ...limit })
      }
    }
    for (const [key, child] of Object.entries(node)) if (key !== '$meta') walk(child, [...segments, key])
  }
  walk(state, [])
  return { errors, normalized: normalized.length ? normalized : null }
}

// The card's initial values: the first opening's <initvar>, else its [initvar] worldbook entries (JSON or YAML).
// A source that is a template (EJS) is not read: its structure is only known once rendered.
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

function allowed(limit) {
  const parts = []
  if (limit.values) parts.push('只能是 ' + limit.values.map(value => JSON.stringify(value)).join('、') + ' 之一')
  if (limit.min !== undefined && limit.max !== undefined) parts.push('应在 ' + limit.min + ' 到 ' + limit.max + ' 之间')
  else if (limit.min !== undefined) parts.push('应不小于 ' + limit.min)
  else if (limit.max !== undefined) parts.push('应不大于 ' + limit.max)
  return parts.join('，')
}

/** One line per limit for the background prompt. */
export function describeMvuLimits(limits) {
  return (limits || []).map(limit => '/stat_data' + limit.path + '：' + allowed(limit)).join('\n')
}

function violates(limit, value) {
  if (limit.values && !limit.values.some(item => item === value)) return true
  if (limit.min === undefined && limit.max === undefined) return false
  return typeof value !== 'number' || (limit.min !== undefined && value < limit.min) || (limit.max !== undefined && value > limit.max)
}

// Every concrete path under `node` the pattern names, with its value.
function matches(node, segments, path = []) {
  if (!segments.length) return [{ path, value: node }]
  if (!object(node) && !Array.isArray(node)) return []
  const [head, ...rest] = segments
  const keys = head === '*' ? Object.keys(node).filter(key => !key.startsWith('$')) : Object.hasOwn(node, head) ? [head] : []
  return keys.flatMap(key => matches(node[key], rest, [...path, key]))
}

function at(node, path) {
  for (const key of path) {
    if (!object(node) && !Array.isArray(node) || !Object.hasOwn(node, key)) return undefined
    node = node[key]
  }
  return node
}

/** Limit violations among the values `after` changed relative to `before` (stat_data roots). */
export function mvuLimitViolations(beforeStatData, afterStatData, limits) {
  const violations = []
  for (const limit of limits || []) {
    for (const { path, value } of matches(afterStatData, limit.segments)) {
      if (JSON.stringify(value) === JSON.stringify(at(beforeStatData, path)) || !violates(limit, value)) continue
      const pointer = '/stat_data/' + path.map(encode).join('/')
      const before = at(beforeStatData, path)
      violations.push({ path: pointer, message: pointer + ' ' + allowed(limit) + '；这批操作执行后是 ' + JSON.stringify(value)
        + (before === undefined ? '' : '（执行前 ' + JSON.stringify(before) + '）') + '。请按正文和当前值重新核对这一项，提交范围内的结果' })
    }
  }
  return violations
}
