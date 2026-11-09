import { types } from 'node:util'

const OMIT = Symbol('json.omit')

function normalizedNumber(value) {
  return !Number.isFinite(value) ? null : value === 0 ? 0 : value
}

function defineOwn(target, key, value) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

function copyHolder(value, key, stack) {
  let current = value
  if (current !== null && (typeof current === 'object' || typeof current === 'function' || typeof current === 'bigint')) {
    const toJSON = current.toJSON
    if (typeof toJSON === 'function') current = toJSON.call(current, key)
  }
  return normalize(current, stack)
}

function normalize(value, stack) {
  if (value === null) return null
  switch (typeof value) {
    case 'string': case 'boolean': return value
    case 'number': return normalizedNumber(value)
    case 'bigint': throw new TypeError('Do not know how to serialize a BigInt')
    case 'undefined': case 'function': case 'symbol': return OMIT
  }
  // util.types avoids user-visible Symbol.toStringTag/valueOf probes.
  if (types.isNumberObject(value)) return normalizedNumber(Number(value))
  if (types.isStringObject(value)) return String(value)
  if (types.isBooleanObject(value)) return Boolean.prototype.valueOf.call(value)
  if (types.isBigIntObject(value)) throw new TypeError('Do not know how to serialize a BigInt')
  if (stack.has(value)) throw new TypeError('Converting circular structure to JSON')
  stack.add(value)
  try {
    if (Array.isArray(value)) {
      const result = new Array(value.length)
      for (let index = 0; index < value.length; index++) {
        const child = copyHolder(value[index], String(index), stack)
        result[index] = child === OMIT ? null : child
      }
      return result
    }
    const result = {}
    for (const key of Object.keys(value)) {
      const child = copyHolder(value[key], key, stack)
      if (child === OMIT) continue
      if (key === '__proto__') defineOwn(result, key, child)
      else result[key] = child
    }
    return result
  } finally {
    stack.delete(value)
  }
}

/** One-pass detached copy with JSON.parse(JSON.stringify(...)) value semantics. */
export function normalizeJsonCopy(value) {
  if (value === undefined) return undefined
  const result = copyHolder(value, '', new Set())
  if (result === OMIT) throw new SyntaxError('"undefined" is not valid JSON')
  return result
}

/** Detach an already parsed JSON tree, sharing only immutable primitive values.
 * Not a serializer: callers must normalize arbitrary input before using this.
 * In particular, this does not implement toJSON, cycles or custom prototypes.
 */
export function copyJsonTree(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(copyJsonTree)
  const result = {}
  for (const key of Object.keys(value)) {
    const child = copyJsonTree(value[key])
    if (key === '__proto__') Object.defineProperty(result, key, { value: child, enumerable: true, writable: true, configurable: true })
    else result[key] = child
  }
  return result
}
