import {readFile} from 'node:fs/promises'
import {userInfo} from 'node:os'
import {jsonBytes, readDocument, sealPack} from './validation.js'
import {check} from '../asset-packs/common.js'

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

function stripPrivateVoiceMedia(manifest, files) {
  const sources = Object.values(manifest.voiceLibrary?.voices || {}).flatMap(voice => Object.values(voice.sources))
    .filter(source => source.kind === 'reference-list')
  const privateMedia = new Set(sources.filter(source => source.private).flatMap(source => source.references.map(ref => ref.media)))
  if (!privateMedia.size) return
  // A hash marked private must not escape through a second voice or a sound asset.
  const usesPrivateMedia = value => typeof value === 'string' ? privateMedia.has(value)
    : value !== null && typeof value === 'object' && Object.values(value).some(usesPrivateMedia)
  check(!usesPrivateMedia(manifest.assets), '$.assets', 'A private voice recording is also used as an asset', 'INVALID_INPUT')
  for (const source of sources) source.references = source.references.filter(ref => !privateMedia.has(ref.media))
  for (const hash of privateMedia) {
    files.delete(`media/${hash}.${manifest.blobs[hash].ext}`)
    delete manifest.blobs[hash]
  }
}

// The export view of a pack: omit local-only audio, scrub text, and reseal the archive.
export async function exportPrivacyView(pack, username = userInfo().username) {
  const manifest = {...scrubValue(pack.manifest, username), files:pack.manifest.files}, files = new Map(pack.files)
  stripPrivateVoiceMedia(manifest, files)
  for (const [name, data] of files) {
    if (name.startsWith('media/') || !TEXT.test(name)) continue
    const bytes = data.file ? await readFile(data.file) : Buffer.from(data), text = bytes.toString('utf8')
    if (scrubText(text, username) === text) continue
    files.set(name, name.endsWith('.json') ? jsonBytes(scrubValue(readDocument(bytes), username)) : Buffer.from(scrubText(text, username)))
  }
  await sealPack(manifest, files, pack)
  return {...pack, manifest, files}
}
