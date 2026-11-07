import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { hash, fail, wav } from './core.js'
import { measureVoiceLoudness, measureVoiceLoudnessSafely, voiceLoudnessGain } from './loudness.js'

// a TTS cloud provider's official voice sample is downloaded once
// into the TTS host data dir (never the owner's chat data), measured once at that first write, and served same-origin so
// the browser auditions it through the mixer's preview bus. Callers pass only sample identities the provider's own
// discovery listed (settings.js fishSample); this is not a URL proxy. Provider sample URLs are presigned and change per
// listing, so the identity is the provider, voice and the URL's origin + path (the signature query is not identity).
const TYPES = { 'audio/mpeg':'mp3', 'audio/mp3':'mp3', 'audio/wav':'wav', 'audio/x-wav':'wav', 'audio/wave':'wav', 'audio/ogg':'ogg',
  'audio/opus':'opus', 'audio/webm':'webm', 'audio/aac':'aac', 'audio/mp4':'m4a', 'audio/x-m4a':'m4a', 'audio/flac':'flac' }
export const SAMPLE_KEY = /^[a-f0-9]{40}$/

export function createSampleCache({ dataDir, fetch = globalThis.fetch, measureLoudness = measureVoiceLoudness, maxClipBytes = 8 * 1024 ** 2, maxBytes = 128 * 1024 ** 2, now = Date.now } = {}) {
  const root = join(dataDir, 'cache', 'samples-v1'), flights = new Map()
  const meta = key => readFile(join(root, key + '.json'), 'utf8').then(JSON.parse, e => { if (e.code === 'ENOENT') return null; throw e })
  async function atomic(file, bytes) {
    const tmp = file + '.' + randomUUID() + '.tmp'
    await writeFile(tmp, bytes, { mode: 0o600 }); await rename(tmp, file)
  }
  async function download(url) {
    let response
    try { response = await fetch(url, { method:'GET', redirect:'error', signal:AbortSignal.timeout(20000) }) } catch { fail('SAMPLE_UNAVAILABLE') }
    const type = TYPES[(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()]
    if (!response.ok || !type) { await response.body?.cancel(); fail('SAMPLE_UNAVAILABLE') }
    if (Number(response.headers.get('content-length')) > maxClipBytes) { await response.body?.cancel(); fail('SAMPLE_TOO_LARGE') }
    const chunks = []; let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > maxClipBytes) fail('SAMPLE_TOO_LARGE')
      chunks.push(chunk)
    }
    return { bytes:Buffer.concat(chunks), type }
  }
  // Oldest clips leave first once the directory is over its limit; the clip just written always stays.
  async function prune(kept) {
    const rows = (await Promise.all((await readdir(root)).filter(name => name.endsWith('.json')).map(name => meta(name.slice(0, -5)).then(row => row && { ...row, key:name.slice(0, -5) }))))
      .filter(Boolean).sort((a, b) => a.at - b.at)
    let total = rows.reduce((sum, row) => sum + row.size, 0)
    for (const row of rows) {
      if (total <= maxBytes) break
      if (row.key === kept) continue
      await unlink(join(root, row.key + '.json')); await unlink(join(root, row.key + '.' + row.ext)).catch(() => {})
      total -= row.size
    }
  }
  return {
    // → {key, mime, loudness}; a cached clip answers without any network.
    async clip({ provider, voiceId, url }) {
      const source = new URL(url)
      if (source.protocol !== 'https:') fail('SAMPLE_UNAVAILABLE')
      const key = hash([provider, voiceId, source.origin + source.pathname]).slice(0, 40)
      if (!flights.has(key)) flights.set(key, (async () => {
        let row = await meta(key)
        if (!row) {
          const { bytes, type } = await download(url)
          // Vendor compressed demos are mastered; preserve their original gain.
          const loudness = type === 'wav' ? await measureVoiceLoudnessSafely(wav(bytes), measureLoudness) : voiceLoudnessGain(null, null)
          row = { v:1, ext:type, mime:Object.keys(TYPES).find(mime => TYPES[mime] === type), size:bytes.length, loudness, at:now() }
          await mkdir(root, { recursive:true })
          await atomic(join(root, key + '.' + type), bytes); await atomic(join(root, key + '.json'), JSON.stringify(row))
          await prune(key)
        }
        return { key, mime:row.mime, loudness:row.ext === 'wav' ? row.loudness || voiceLoudnessGain(null, null) : voiceLoudnessGain(null, null) }
      })().finally(() => flights.delete(key)))
      return flights.get(key)
    },
    async read(key) {
      if (typeof key !== 'string' || !SAMPLE_KEY.test(key)) fail('INVALID_INPUT')
      const row = await meta(key)
      if (!row) fail('SAMPLE_UNAVAILABLE')
      return { bytes:await readFile(join(root, key + '.' + row.ext)), mime:row.mime }
    },
  }
}
