// accepted identity boards are resource authority, not outfit metadata.
import {shape, array, text, check, validateHash} from './common.js'
export function validateIdentitySettei(value, path = '$.identitySettei') {
  shape(value, ['board', 'version', 'palette'], ['board', 'version', 'palette'], path)
  validateHash(value.board, path + '.board')
  text(value.version, path + '.version', 160)
  array(value.palette, path + '.palette', 64)
  value.palette.forEach((entry, index) => {
    const p = path + '.palette[' + index + ']'
    shape(entry, ['role', 'hex', 'zone'], ['role', 'hex', 'zone'], p)
    text(entry.role, p + '.role', 160)
    text(entry.zone, p + '.zone', 160)
    check(typeof entry.hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(entry.hex), p + '.hex')
  })
  return value
}
