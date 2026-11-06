// Strict portable JSON and hashing primitives; no host or storage dependencies.
export const ASSET_PACK_ERROR_CODES = Object.freeze([
  'INVALID_ASSET_PACK', 'UNSUPPORTED_SCHEMA_VERSION', 'INVALID_REF', 'INVALID_HASH',
  'DUPLICATE_ID', 'INVALID_JSON', 'LIMIT_EXCEEDED', 'UNKNOWN_FIELD', 'INVALID_PATH',
  'MISSING_DEPENDENCY', 'UNBOUND_PACK', 'UNKNOWN_ALIAS', 'CONTENT_HASH_MISMATCH',
  'FILE_CLOSURE_MISMATCH', 'REVISION_CONFLICT', 'RECOVERY_REQUIRED',
  'WIDGET_UNAUTHORIZED', 'ASSET_UNAVAILABLE'
])
export function fail(path, message, code = 'INVALID_ASSET_PACK') {
  throw Object.assign(new TypeError(message), { code, path })
}
export function check(ok, path, message = 'Invalid asset-pack field', code) { if (!ok) fail(path, message, code) }
export const object = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))
export function shape(value, allowed, required, path = '$') {
  check(object(value), path, 'Expected object')
  for (const key of Object.keys(value)) check(allowed.includes(key), `${path}.${key}`, 'Unknown field', 'UNKNOWN_FIELD')
  for (const key of required) check(Object.hasOwn(value, key), `${path}.${key}`, 'Required field')
}
export function text(value, path, max = 256, min = 1) {
  check(typeof value === 'string' && [...value].length >= min && [...value].length <= max && !/[\u0000-\u001f\u007f]/u.test(value), path, 'Invalid text')
}
export function integer(value, path, min = 0, max = Number.MAX_SAFE_INTEGER) { check(Number.isSafeInteger(value) && value >= min && value <= max, path, 'Invalid integer') }
export function bool(value, path) { check(typeof value === 'boolean', path, 'Expected boolean') }
export function oneOf(value, values, path) { check(values.includes(value), path, 'Unexpected value') }
export function version(value, path = '$.schemaVersion') { check(value === 1, path, 'Unsupported schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION') }
export function array(value, path, max = 100000) { check(Array.isArray(value), path, 'Expected array'); check(value.length <= max, path, 'Array limit', 'LIMIT_EXCEEDED') }
export function unique(values, path) { check(new Set(values).size === values.length, path, 'Duplicate identity', 'DUPLICATE_ID') }
export function assertJson(value, { maxDepth = 64, maxBytes = 64 * 1024 * 1024 } = {}) {
  const ancestors = new Set(); let nodes = 0
  function visit(item, depth, path) {
    check(++nodes <= 500000 && depth <= maxDepth, path, 'JSON complexity limit', 'LIMIT_EXCEEDED')
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return
    if (typeof item === 'number') { check(Number.isFinite(item), path, 'Non-finite number', 'INVALID_JSON'); return }
    check(typeof item === 'object' && (Array.isArray(item) || object(item)), path, 'Non-JSON value', 'INVALID_JSON')
    check(!ancestors.has(item), path, 'Cyclic JSON', 'INVALID_JSON')
    ancestors.add(item)
    check(!Object.getOwnPropertySymbols(item).length, path, 'Symbol property', 'INVALID_JSON')
    const descriptors = Object.getOwnPropertyDescriptors(item)
    if (Array.isArray(item)) {
      check(Object.keys(descriptors).length === item.length + 1, path, 'Sparse or decorated array', 'INVALID_JSON')
      for (let i = 0; i < item.length; i++) {
        const d = descriptors[i]
        check(d && Object.hasOwn(d, 'value') && d.enumerable, path, 'Non-JSON array property', 'INVALID_JSON')
        visit(d.value, depth + 1, `${path}[${i}]`)
      }
    } else for (const [key, d] of Object.entries(descriptors)) {
      check(Object.hasOwn(d, 'value') && d.enumerable, path, 'Non-JSON property', 'INVALID_JSON')
      visit(d.value, depth + 1, `${path}.${key}`)
    }
    ancestors.delete(item)
  }
  visit(value, 0, '$')
  check(new TextEncoder().encode(JSON.stringify(value)).length <= maxBytes, '$', `Compact JSON exceeds ${maxBytes} bytes; preserve history and request a supported larger limit before retrying`, 'LIMIT_EXCEEDED')
  return value
}
export function compareCodePoints(a, b) {
  const x = [...a], y = [...b]
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const diff = x[i].codePointAt(0) - y[i].codePointAt(0)
    if (diff) return diff
  }
  return x.length - y.length
}
export function canonicalJson(value, { admitted = false } = {}) {
  // Internal snapshots already passed admission; external callers retain strict JSON checks.
  if (!admitted) assertJson(value)
  // Serialize directly: JSON.stringify(object) reorders integer-like keys.
  const encode = item => Array.isArray(item) ? '[' + item.map(encode).join(',') + ']'
    : object(item) ? '{' + Object.keys(item).sort(compareCodePoints).map(key => JSON.stringify(key) + ':' + encode(item[key])).join(',') + '}'
      : JSON.stringify(item)
  return encode(value)
}
export async function sha256(bytes) {
  check(bytes instanceof Uint8Array, '$', 'Expected bytes')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
export const jsonHash = value => sha256(new TextEncoder().encode(canonicalJson(value)))
export const cloneJson = value => JSON.parse(canonicalJson(value))
export function extensions(value, path) {
  check(object(value), path)
  assertJson(value, { maxDepth: 8, maxBytes: 16384 })
}
// JSON.parse silently accepts duplicate keys. Scan the original token stream first.
export function parseJson(source) {
  check(typeof source === 'string' && !source.startsWith('\ufeff'), '$', 'Expected UTF-8 JSON without BOM', 'INVALID_JSON')
  check(new TextEncoder().encode(source).length <= 128 * 1024 * 1024, '$', 'JSON source exceeds 134217728 bytes (128 MiB); compact whitespace without removing history and retry (compact limit: 64 MiB)', 'LIMIT_EXCEEDED')
  let at = 0
  const ws = () => { while (/[\x20\t\r\n]/.test(source[at] || '\0')) at++ }
  const bad = () => fail('$', 'Invalid JSON', 'INVALID_JSON')
  function string() {
    if (source[at] !== '"') bad()
    const start = at++
    while (at < source.length) {
      const c = source[at++]
      if (c === '\\') { at++; continue }
      if (c === '"') { try { return JSON.parse(source.slice(start, at)) } catch { bad() } }
    }
    bad()
  }
  function value(depth) {
    check(depth <= 64, '$', 'JSON depth limit', 'LIMIT_EXCEEDED'); ws()
    if (source[at] === '"') { string(); return }
    if (source[at] === '{' || source[at] === '[') {
      const isObject = source[at++] === '{', end = isObject ? '}' : ']', keys = new Set()
      ws(); if (source[at] === end) { at++; return }
      while (at < source.length) {
        ws()
        if (isObject) {
          const key = string()
          check(!keys.has(key), '$', 'Duplicate JSON key: ' + key, 'INVALID_JSON'); keys.add(key)
          ws(); if (source[at++] !== ':') bad()
        }
        value(depth + 1); ws()
        if (source[at] === end) { at++; return }
        if (source[at++] !== ',') bad()
      }
      bad()
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(at))
    if (!match) bad()
    at += match[0].length
  }
  value(0); ws(); if (at !== source.length) bad()
  let result
  try { result = JSON.parse(source) } catch { bad() }
  return assertJson(result)
}
