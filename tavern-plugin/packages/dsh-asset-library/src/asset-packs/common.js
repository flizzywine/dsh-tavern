export * from '../shared/asset-pack-json.js'
export * from '../shared/asset-pack-refs.js'
import { check, text } from '../shared/asset-pack-json.js'
// One archive entry an import wrote to a spool file: its digest was computed from the bytes as they were written, and
// nothing else about it is validated yet. Only the asset library creates these; readers take its bytes one file at a time.
export class SpooledFile {
  constructor(size, file, sha256, stamp) { this.length = size; this.file = file; this.sha256 = sha256; this.stamp = stamp; Object.freeze(this) }
}
export const spoolFileStamp = ({dev, ino, size, mtimeNs, ctimeNs}) => [dev, ino, size, mtimeNs, ctimeNs].join(':')
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
