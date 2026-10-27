export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export function fail(path, message, code = 'INVALID_PRESENTATION') {
  throw Object.assign(new TypeError(message), { code, path })
}
export function check(ok, path, message = 'Invalid current presentation field') { if (!ok) fail(path, message) }
export function shape(value, fields, path) {
  check(object(value), path)
  for (const field of Object.keys(value)) check(fields.includes(field), `${path}.${field}`, 'Unknown field')
}
export function text(value, path, max = 256, empty = false) {
  check(typeof value === 'string' && value.length <= max && (empty || value.length > 0), path)
}
export function integer(value, path, min = 0, max = Number.MAX_SAFE_INTEGER) {
  check(Number.isSafeInteger(value) && value >= min && value <= max, path)
}
export function oneOf(value, values, path) { check(values.includes(value), path) }

// Validate before cloning/encoding: JSON.stringify alone silently loses values.
export function assertJson(value, { maxBytes = 2 * 1024 * 1024, maxDepth = 32 } = {}) {
  const ancestors = new Set()
  let nodes = 0
  function visit(item, depth, path) {
    check(++nodes <= 200000 && depth <= maxDepth, path, 'JSON complexity limit')
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return
    if (typeof item === 'number') { check(Number.isFinite(item), path); return }
    check(typeof item === 'object', path, 'Expected JSON data')
    check(!ancestors.has(item), path, 'Cyclic JSON')
    check(Array.isArray(item) || [Object.prototype, null].includes(Object.getPrototypeOf(item)), path, 'Expected plain JSON object')
    ancestors.add(item)
    if (Array.isArray(item)) {
      check(Object.keys(item).length === item.length, path, 'Sparse or decorated array')
      for (let i = 0; i < item.length; i++) visit(item[i], depth + 1, `${path}[${i}]`)
    } else for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      check(!['__proto__', 'constructor', 'prototype'].includes(key) && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, path, 'Unsafe JSON property')
      visit(descriptor.value, depth + 1, `${path}.${key}`)
    }
    check(Object.getOwnPropertySymbols(item).length === 0, path)
    ancestors.delete(item)
  }
  visit(value, 0, '$')
  check(new TextEncoder().encode(JSON.stringify(value)).length <= maxBytes, '$', 'JSON byte limit')
  return value
}
const sorted = value => Array.isArray(value) ? value.map(sorted) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value
export function canonicalJson(value) { assertJson(value); return JSON.stringify(sorted(value)) }
export async function jsonDigest(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
export function parseJson(source) {
  text(source, '$', 2 * 1024 * 1024)
  check(new TextEncoder().encode(source).length <= 2 * 1024 * 1024, '$', 'JSON byte limit')
  let value
  try { value = JSON.parse(source) } catch { fail('$', 'Invalid JSON') }
  return assertJson(value)
}
