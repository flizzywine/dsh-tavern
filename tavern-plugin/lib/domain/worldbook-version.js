import { createHash } from 'node:crypto'

/** Resource version, independent of later game-local worldbook edits. */
export function worldbookContentDigest(record) {
  const source = record?.source ?? null
  const document = record?.document ?? record?.view?.raw ?? null
  return createHash('sha256').update(JSON.stringify({ source, document })).digest('hex')
}
