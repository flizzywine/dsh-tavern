import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { redactMvuLoadError } from './mvu-diagnostics.js'

export const OFFICIAL_MVU_VERSION = Object.freeze({
  repository: 'https://github.com/MagicalAstrogy/MagVarUpdate',
  commit: '0a730cd4a9b99689d1135a49b542c780b977c24c',
  upstreamBundleSha256: '3b510787a95c7a51523dcbbb2beff5f13b3bd069abf973dec1fdb1f21eeea61f',
  bundleSha256: '47aca7394ed5f9d613dea34a8d6eaabd41d9d26427338528761d8db972e7a3e1',
  assetUrl: '/api/dsh-tavern/vendor/magvarupdate/bundle.js'
})

const bundleUrl = new URL('../vendor/magvarupdate/host-build/artifact/bundle.js', import.meta.url)

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** Observe the existing cached read, without introducing reads during export or changing retries. */
export function createOfficialMvuBundleReader({ read = readFile } = {}) {
  let bundlePromise
  const diagnostic = { scope: 'current-server-process', phase: 'not-read', requests: 0, cacheHits: 0,
    assetPath: 'vendor/magvarupdate/host-build/artifact/bundle.js', expectedSha256: OFFICIAL_MVU_VERSION.bundleSha256 }
  return Object.freeze({
    async read() {
      diagnostic.requests++
      if (bundlePromise !== undefined) diagnostic.cacheHits++
      if (bundlePromise === undefined) {
        const startedAt = Date.now()
        Object.assign(diagnostic, { phase: 'reading', startedAt })
        bundlePromise = Promise.resolve().then(() => read(bundleUrl)).then(function (body) {
          const actual = sha256(body)
          let crlfCount = 0, loneLfCount = 0
          for (let index = 0; index < body.length; index++) if (body[index] === 10) {
            if (body[index - 1] === 13) crlfCount++; else loneLfCount++
          }
          Object.assign(diagnostic, { actualSha256: actual, bytes: body.length, crlfCount, loneLfCount })
          if (actual !== OFFICIAL_MVU_VERSION.bundleSha256) {
            Object.assign(diagnostic, { phase: 'verify-failed', errorCode: 'HASH_MISMATCH' })
            throw new Error('本地官方 MVU 产物校验失败：期望 ' + OFFICIAL_MVU_VERSION.bundleSha256 + '，实际 ' + actual)
          }
          Object.assign(diagnostic, { phase: 'verified', completedAt: Date.now(), durationMs: Date.now() - startedAt })
          return Object.freeze({ body, mediaType: 'text/javascript; charset=utf-8',
            etag: '"sha256-' + actual + '"', commit: OFFICIAL_MVU_VERSION.commit, sha256: actual })
        }).catch(error => {
          if (diagnostic.phase !== 'verify-failed') Object.assign(diagnostic, { phase: 'read-failed', errorCode: String(error.code || 'READ_FAILED').slice(0, 80) })
          Object.assign(diagnostic, { completedAt: Date.now(), durationMs: Date.now() - startedAt, error: redactMvuLoadError(error.message || error) })
          throw error
        })
      }
      return await bundlePromise
    },
    inspect() { return { ...diagnostic } }
  })
}

const reader = createOfficialMvuBundleReader()

/** Read and verify the pinned official MagVarUpdate artifact from this package. */
export async function readOfficialMvuBundle() {
  return await reader.read()
}

export function inspectOfficialMvuAsset() {
  try { return reader.inspect() } catch {
    return { scope: 'current-server-process', phase: 'diagnostic-unavailable' }
  }
}
