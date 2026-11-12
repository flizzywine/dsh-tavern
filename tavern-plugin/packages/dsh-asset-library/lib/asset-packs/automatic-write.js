import {shape, check, text, validateUuid} from './common.js'

// Portable attribution contains no chat coordinates and conveys no write authority.
export function validateAutomaticWrite(value, path = '$') {
  if (value === undefined) return
  shape(value, ['writeId','writerId','at','fields','source'], ['writeId','writerId','at','fields','source'], path)
  validateUuid(value.writeId, path + '.writeId')
  text(value.writerId, path + '.writerId', 80)
  check(typeof value.at === 'string' && Number.isFinite(Date.parse(value.at)), path + '.at')
  check(Array.isArray(value.fields) && value.fields.length > 0 && value.fields.length <= 128, path + '.fields')
  for (const field of value.fields) text(field, path + '.fields', 80)
  shape(value.source, ['kind','occurrenceId'], ['kind','occurrenceId'], path + '.source')
  text(value.source.kind, path + '.source.kind', 80)
  validateUuid(value.source.occurrenceId, path + '.source.occurrenceId')
}
