export * from '../shared/asset-pack-json.js'
export * from '../shared/asset-pack-refs.js'
import { check, text } from '../shared/asset-pack-json.js'
export function relativePath(value, path = '$') {
  text(value, path, 240)
  check(!/[\\:%?#*"<>|\u0000-\u001f]/u.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), path, 'Unsafe relative path', 'INVALID_PATH')
  return value
}
export function record(value, path, validate) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'Expected record')
  for (const [key, item] of Object.entries(value)) {
    check(!['__proto__', 'constructor', 'prototype'].includes(key), path + '.' + key, 'Reserved key')
    validate(item, path + '.' + key, key)
  }
}
