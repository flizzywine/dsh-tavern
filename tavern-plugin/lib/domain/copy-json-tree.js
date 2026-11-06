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
