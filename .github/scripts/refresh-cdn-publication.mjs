import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CDN_ENTRYPOINTS } from './stage-cdn-entrypoints.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function matches(response, expected) {
  // Bound both ordinary entry points and the immutable archive before hashing.
  const declared = Number(response.headers.get('content-length'))
  if (!response.ok || declared > expected.size && !response.headers.get('content-encoding')) { await response.body?.cancel().catch(() => {}); return false }
  const reader = response.body?.getReader()
  if (!reader) return false
  const hash = createHash('sha256')
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > expected.size) { await reader.cancel(); return false }
      hash.update(value)
    }
    return size === expected.size && hash.digest('hex') === expected.sha256
  } finally { reader.releaseLock() }
}

/** A purge can return HTTP 200 / finished while an individual path is throttled. */
export async function refreshCdnPublication({ repository, branch, files, archive,
  fetchImpl = globalThis.fetch, now = Date.now, wait = sleep, log = console.log,
  timeoutMs = 15 * 60_000, pollMs = 15_000 } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !['main', 'stable'].includes(branch)) throw new Error('Invalid CDN publication target')
  if (!/^[a-f0-9]{40}$/i.test(archive?.commit || '') || archive.path !== 'runtime.zip' || !/^[a-f0-9]{64}$/i.test(archive.sha256 || '') || !Number.isSafeInteger(archive.size) || archive.size <= 0 || archive.size >= 20_000_000) throw new Error('Invalid immutable runtime archive')
  if (!Array.isArray(files) || files.length !== CDN_ENTRYPOINTS.length || new Set(files.map(file => file.path)).size !== files.length || files.some(file => !CDN_ENTRYPOINTS.includes(file.path) || !Number.isSafeInteger(file.size) || file.size <= 0 || !/^[a-f0-9]{64}$/i.test(file.sha256 || ''))) throw new Error('Invalid CDN entry points')
  const deadline = now() + timeoutMs, dist = 'runtime-archive-' + branch
  const fetchUrl = (url, timeout = 20_000) => fetchImpl(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(timeout, deadline - now()))) })
  const archiveUrl = `https://cdn.jsdelivr.net/gh/${repository}@${archive.commit}/${archive.path}`
  if (!await matches(await fetchUrl(archiveUrl, 60_000), archive)) throw new Error('CDN immutable runtime archive size or SHA-256 does not match its manifest')
  log(`Verified immutable runtime archive: ${archive.size} bytes`)

  const states = files.map(file => ({ ...file, nextPurge: 0, purged: false }))
  let pending = states
  while (now() < deadline) {
    const checks = await Promise.all(states.map(async file => {
      const url = `https://cdn.jsdelivr.net/gh/${repository}@${dist}/${file.path}`
      try { return await matches(await fetchUrl(url), file) } catch { return false }
    }))
    pending = states.filter((_file, index) => !checks[index])
    if (!pending.length) { log('Verified CDN installers and manifest: all published bytes match'); return }
    await Promise.all(pending.map(async file => {
      // A confirmed purge needs propagation time; do not immediately rate-limit it again.
      if (file.purged || now() < file.nextPurge) return
      const key = `/gh/${repository}@${dist}/${file.path}`
      try {
        const response = await fetchUrl('https://purge.jsdelivr.net' + key)
        if (!response.ok) {
          const retry = Number(response.headers.get('retry-after'))
          file.nextPurge = now() + (retry > 0 ? retry * 1000 : 30_000)
          log(`CDN purge HTTP ${response.status}: ${file.path}; will retry`)
          return
        }
        const result = await response.json(), entry = result.paths?.[key]
        if (entry?.throttled === true) {
          const seconds = Math.ceil(Number(entry.throttlingReset))
          const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 + 1000 : 30_000
          file.nextPurge = now() + delay
          log(`CDN purge throttled: ${file.path}; retry after ${Math.ceil(delay / 1000)}s`)
        } else if (result.status === 'finished' && entry && Object.values(entry.providers || {}).length && Object.values(entry.providers).every(value => value === true)) {
          file.purged = true
          log(`CDN purge accepted: ${file.path}; checking propagation`)
        } else {
          file.nextPurge = now() + 30_000
          log(`CDN purge not confirmed: ${file.path}; will retry`)
        }
      } catch (error) {
        file.nextPurge = now() + 30_000
        log(`CDN purge request failed: ${file.path}: ${error.message}`)
      }
    }))
    const remaining = deadline - now()
    if (remaining > 0) await wait(Math.min(pollMs, remaining))
  }
  throw new Error('CDN publication still serves stale or invalid bytes: ' + pending.map(file => file.path).join(', '))
}

export async function refreshPublishedRuntime(repository, branch, { sourceRoot = process.cwd(), ...options } = {}) {
  const files = await Promise.all(CDN_ENTRYPOINTS.map(async file => {
    const bytes = await readFile(path.join(sourceRoot, file))
    return { path: file, size: bytes.length, sha256: digest(bytes) }
  }))
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'dsh-tavern-runtime.json'), 'utf8'))
  return refreshCdnPublication({ ...options, repository, branch, files, archive: manifest.archive })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await refreshPublishedRuntime(process.argv[2], process.argv[3])
}
