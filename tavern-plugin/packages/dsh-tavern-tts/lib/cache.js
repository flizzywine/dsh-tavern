import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { hash, SHA, wav, fail } from './core.js'
import { measureVoiceLoudness, measureVoiceLoudnessSafely, voiceLoudnessGain } from './loudness.js'

// Only synthesized clips owned by this directory; never scan a consumer's assets.
export function createCache({ dataDir, maxBytes = 1024 ** 3, maxAgeDays = 30, measureLoudness = measureVoiceLoudness, onBoot = () => {} } = {}) {
  const root = dataDir && join(dataDir, 'cache', 'audio-v2')
  const entries = new Map()
  let loaded = false, warming, loadError, chain = Promise.resolve()
  const serial = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p }
  async function readEntry(key) {
    try {
      const entry = JSON.parse(await readFile(join(root, key + '.json'), 'utf8'))
      if (SHA.test(entry.hash) && Array.isArray(entry.scopes) && entry.scopes.length <= 128 && entry.scopes.every(s => typeof s === 'string') && Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= 32 * 1024 ** 2 && Number.isFinite(entry.access)) return entry
    } catch { /* An interrupted manifest is a miss, never a guessed cache hit. */ }
    return null
  }
  async function find(key) {
    // The directory is the record: a clip placed there after the index was read (a cache rekey) is still found.
    if (!entries.has(key) && root) {
      const entry = await readEntry(key)
      if (entry) entries.set(key, entry)
    }
    return entries.get(key)
  }
  async function load() {
    if (loaded) return
    if (!root) { loaded = true; loadError = undefined; return }
    const started = performance.now()
    onBoot({ phase: 'voice-cache.begin', hostUptimeMs: Math.round(process.uptime() * 1000) })
    const files = await readdir(root).catch(e => { if (e.code === 'ENOENT') return []; throw e })
    entries.clear()
    for (const file of files.filter(f => /^[a-f0-9]{64}\.json$/.test(f))) {
      const key = file.slice(0, 64), entry = await readEntry(key)
      if (entry) entries.set(key, entry)
      else entries.delete(key)
    }
    await trim()
    loaded = true; loadError = undefined
    onBoot({ phase: 'voice-cache.end', hostUptimeMs: Math.round(process.uptime() * 1000), durationMs: Math.round(performance.now() - started), files: files.length, entries: entries.size })
  }
  async function atomic(file, bytes) {
    const tmp = file + '.' + randomUUID() + '.tmp'
    await writeFile(tmp, bytes, { mode: 0o600 }); await rename(tmp, file)
  }
  async function remove(key) {
    entries.delete(key)
    if (root) for (const ext of ['wav', 'json']) await unlink(join(root, key + '.' + ext)).catch(e => { if (e.code !== 'ENOENT') throw e })
  }
  async function trim() {
    const cutoff = Date.now() - maxAgeDays * 86400000
    for (const [key, e] of entries) if (e.access < cutoff) await remove(key)
    let size = [...entries.values()].reduce((sum, e) => sum + e.bytes, 0)
    for (const [key, e] of [...entries].sort((a,b) => a[1].access - b[1].access)) {
      if (size <= maxBytes && entries.size <= 10000) break
      await remove(key); size -= e.bytes
    }
  }
  return {
    // Export must not hydrate/trim the cache, update access time, or associate a new scope.
    peek: (key, metadata = false) => serial(async () => {
      if (!SHA.test(key)) fail('INVALID_INPUT')
      try {
        const entry = root ? JSON.parse(await readFile(join(root, key + '.json'), 'utf8')) : entries.get(key)
        if (!entry) return null
        const audio = root ? await readFile(join(root, key + '.wav')) : entry.audio
        if(audio?.length !== entry.bytes)return null
        return metadata ? {audio,loudness:entry.loudness} : audio
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'INVALID_AUDIO' || error instanceof SyntaxError) return null
        throw error
      }
    }),
    get: (key, scope) => serial(async () => {
      if (!SHA.test(key)) fail('INVALID_INPUT')
      // A cold playback hit needs its own manifest, not the entire cache index.
      const e = await find(key); if (!e) return null
      if (e.bytes > maxBytes || e.access < Date.now() - maxAgeDays * 86400000) { await remove(key); return null }
      try {
        const b = root ? await readFile(join(root, key + '.wav')) : e.audio
        // Validated at put(); a size check rejects interrupted files without re-parsing.
        if (b.length !== e.bytes) { await remove(key); return null }
        e.access = Date.now()
        if (scope && !e.scopes.includes(scope)) { if (e.scopes.length >= 128) { await remove(key); return null }; e.scopes.push(scope) }
        if (root) await atomic(join(root, key + '.json'), JSON.stringify(e))
        return b
      } catch { await remove(key); return null }
    }),
    put: (key, bytes, scopes, qa) => serial(async () => {
      await load(); const b = wav(bytes)
      if (!SHA.test(key) || b.length > maxBytes) fail('CACHE_FULL')
      const e = { hash: hash(b), bytes: b.length, scopes: [...new Set(scopes)], access: Date.now(), ...(qa ? { qa } : {}) }
      if (root) { await mkdir(root, { recursive: true }); await atomic(join(root, key + '.wav'), b); await atomic(join(root, key + '.json'), JSON.stringify(e)) }
      else e.audio = b
      entries.set(key, e); await trim()
      // Preserve paid audio even when optional measurement fails.
      e.loudness = await measureVoiceLoudnessSafely(b, measureLoudness)
      if (root && entries.has(key)) await atomic(join(root, key + '.json'), JSON.stringify(e))
    }),
    loudness: key => serial(async () => {
      if (!SHA.test(key)) fail('INVALID_INPUT')
      const entry = await find(key)
      if (!entry) fail('AUDIO_GONE')
      if (entry.bytes > maxBytes || entry.access < Date.now() - maxAgeDays * 86400000) { await remove(key); fail('AUDIO_GONE') }
      return { ...(entry.loudness || voiceLoudnessGain(null, null)) }
    }),
    // Startup settings must not hydrate disk. Explicit management and writes still
    // hydrate before global age/LRU eviction; a warm cache applies limits now.
    configure: (limits, { lazy = false } = {}) => serial(async () => { maxBytes = limits.maxBytes; maxAgeDays = limits.maxAgeDays; if (!loaded && lazy) return; await load(); await trim() }),
    stats: () => serial(async () => { await load(); await trim(); return { count: entries.size, bytes: [...entries.values()].reduce((s,e) => s + e.bytes, 0), maxBytes, maxAgeDays } }),
    // Management must not wait behind disk hydration, eviction or a synthesis write.
    snapshot() {
      if (!loaded && !warming) warming = serial(load).catch(() => { loadError = 'CACHE_UNAVAILABLE' })
      return {count:entries.size,bytes:[...entries.values()].reduce((s,e) => s + e.bytes,0),maxBytes,maxAgeDays,loading:!loaded && !loadError,...(loadError ? {error:loadError} : {})}
    },
    deleteEntry: key => serial(async () => {
      if (typeof key !== 'string' || !SHA.test(key)) fail('INVALID_INPUT')
      // Do not hydrate: load() also evicts unrelated expired/LRU entries.
      const exists = !!await find(key)
      await remove(key)
      return { removed: exists ? 1 : 0, keys: exists ? [key] : [] }
    }),
    clear: scope => serial(async () => { await load(); const keys = [...entries].filter(([,e]) => !scope || e.scopes.includes(scope)).map(([k]) => k); for (const k of keys) await remove(k); return { removed: keys.length, keys } }),
    flush: () => chain,
  }
}
