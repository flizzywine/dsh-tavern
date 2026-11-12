import {readFile} from 'node:fs/promises'
import {userInfo} from 'node:os'
import {jsonBytes, readDocument, sealPack} from './validation.js'

// Exported archives leave this machine: absolute local paths keep only their file name and the OS account name becomes
// a neutral word. media/ blobs are named by their hash, so they stay byte-identical.
const TEXT = /\.(json|md|txt|ya?ml|csv|svg|html?|css|m?js)$/i
const STOP = '\\s"\'`<>|*?()\\[\\]{},;\uff0c\u3002\uff1b\uff1a\uff08\uff09\u3001\u300c\u300d'
const SEGMENT = `[^${STOP}\\\\/]+`
const ABSOLUTE = new RegExp(`(?:(?<![A-Za-z0-9_])[A-Za-z]:[\\\\/]|\\\\\\\\(?=${SEGMENT})|(?<![\\w.])/(?:Users|home)/(?=${SEGMENT}))(?:${SEGMENT}[\\\\/]+)*(?:${SEGMENT})?`, 'g')
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function scrubText(text, username = userInfo().username) {
  const out = text.replace(ABSOLUTE, match => { const parts = match.split(/[\\/]+/).filter(Boolean); return parts.length > 1 ? parts.at(-1) : '' })
  return username ? out.replace(new RegExp(`(?<![A-Za-z0-9_])${escape(username)}(?![A-Za-z0-9_])`, 'gi'), 'user') : out
}
const scrubValue = (value, username) => typeof value === 'string' ? scrubText(value, username)
  : Array.isArray(value) ? value.map(item => scrubValue(item, username))
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubValue(item, username)]))
  : value

// The export view of a pack: text members and the manifest scrubbed, then resealed so file hashes and contentHash match.
export async function exportPrivacyView(pack, username = userInfo().username) {
  const manifest = {...scrubValue(pack.manifest, username), files:pack.manifest.files}, files = new Map(pack.files)
  for (const [name, data] of files) {
    if (name.startsWith('media/') || !TEXT.test(name)) continue
    const bytes = data.file ? await readFile(data.file) : Buffer.from(data), text = bytes.toString('utf8')
    if (scrubText(text, username) === text) continue
    files.set(name, name.endsWith('.json') ? jsonBytes(scrubValue(readDocument(bytes), username)) : Buffer.from(scrubText(text, username)))
  }
  await sealPack(manifest, files, pack)
  return {...pack, manifest, files}
}
