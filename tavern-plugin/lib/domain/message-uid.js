import { createHash } from 'node:crypto'

export function validMessageUid(value) {
  return typeof value === 'string' && value.length > 0
}

// Legacy rows need the same identity in bounded and full-history writers. Use
// their pre-deletion position and stable story anchors, never randomness or the
// mutable variable payload. Once written, messageUid is always authoritative.
export function legacyMessageUid(row, position) {
  if (validMessageUid(row?.messageUid)) return row.messageUid
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  const identity = [position, row.id ?? null, row.role ?? null, row.turn ?? null,
    row.greeting === true, row.text ?? '', row.sourceText ?? '', row.nativeAnchor ?? null]
  return 'legacy-' + createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}

// The caller owns the detached row. Native migration publishes only the head
// identity instead, leaving the old Chat projection byte-for-byte compatible.
export function ensureMessageUid(row, position, preferredUid) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { messageUid: null, created: false }
  if (validMessageUid(row.messageUid)) return { messageUid: row.messageUid, created: false }
  row.messageUid = validMessageUid(preferredUid) ? preferredUid : legacyMessageUid(row, position)
  return { messageUid: row.messageUid, created: true }
}
