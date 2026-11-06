import { createHash } from 'node:crypto'

const immutable = new WeakSet()
const fingerprints = new WeakMap()

// Only pass owned JSON data, never live domain state. A shallow Object.freeze
// alone cannot certify a graph, so arbitrary frozen objects are not memoized.
export function freezeJsonProjection(value) {
  if (value && typeof value === 'object' && !immutable.has(value)) {
    for (const child of Object.values(value)) freezeJsonProjection(child)
    Object.freeze(value)
    immutable.add(value)
  }
  return value
}

export function fingerprintJsonProjection(value) {
  if (immutable.has(value) && fingerprints.has(value)) return fingerprints.get(value)
  const hash = createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('base64url')
  if (immutable.has(value)) fingerprints.set(value, hash)
  return hash
}

// Detach only when a projection actually crosses the transport interface.
export function copyJsonProjection(value) {
  return immutable.has(value) ? structuredClone(value) : value
}

// Content equality is the version check. Callers must obtain fresh source text
// before calling; this cache never substitutes a TTL for resource freshness.
export function createJsonProjectionCache({ capacity = 16, maxBytes = 32 * 1024 * 1024 } = {}) {
  const entries = new Map()
  let bytes = 0
  return (key, text, project) => {
    const previous = entries.get(key)
    if (previous?.text === text) {
      entries.delete(key); entries.set(key, previous)
      return previous.value
    }
    if (previous) { bytes -= previous.bytes; entries.delete(key) }
    const value = freezeJsonProjection(project(text))
    // A bound on retained serialized weight, not an exact JS heap limit.
    const weight = 2 * (text.length + JSON.stringify(value).length)
    if (weight <= maxBytes) {
      entries.set(key, { text, value, bytes: weight }); bytes += weight
      while (entries.size > capacity || bytes > maxBytes) {
        const oldest = entries.keys().next().value
        bytes -= entries.get(oldest).bytes; entries.delete(oldest)
      }
    }
    return value
  }
}

// Unlike unordered object equality, preserve JSON property order: templates may
// stringify a character. Compare freshly read JSON with an owned, normalized
// source; never retain a caller's mutable object as evidence of freshness.
function sameOrderedJson(a, b) {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && a.length !== b.length) return false
  if (!Array.isArray(a) && ![Object.prototype, null].includes(Object.getPrototypeOf(a))) return false
  const keys = Object.keys(a), other = Object.keys(b)
  return keys.length === other.length && keys.every((key, i) => key === other[i] && sameOrderedJson(a[key], b[key]))
}

/** For already parsed JSON resources. Every call still requires a fresh read.
 * Avoid serializing unchanged large objects; normalize on misses just as the
 * text cache does. Source and projection are both owned and budgeted.
 */
export function createJsonValueProjectionCache({ capacity = 16, maxBytes = 32 * 1024 * 1024 } = {}) {
  const entries = new Map()
  let bytes = 0
  return (key, input, project) => {
    const previous = entries.get(key)
    if (previous && sameOrderedJson(input, previous.source)) {
      entries.delete(key); entries.set(key, previous)
      return previous.value
    }
    if (previous) { bytes -= previous.bytes; entries.delete(key) }
    const text = JSON.stringify(input)
    const source = freezeJsonProjection(JSON.parse(text))
    const value = freezeJsonProjection(project(source))
    const weight = 2 * (text.length + JSON.stringify(value).length)
    if (weight <= maxBytes) {
      entries.set(key, { source, value, bytes: weight }); bytes += weight
      while (entries.size > capacity || bytes > maxBytes) {
        const oldest = entries.keys().next().value
        bytes -= entries.get(oldest).bytes; entries.delete(oldest)
      }
    }
    return value
  }
}
