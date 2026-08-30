import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export const OFFICIAL_MVU_VERSION = Object.freeze({
  repository: 'https://github.com/MagicalAstrogy/MagVarUpdate',
  commit: '0a730cd4a9b99689d1135a49b542c780b977c24c',
  upstreamBundleSha256: '3b510787a95c7a51523dcbbb2beff5f13b3bd069abf973dec1fdb1f21eeea61f',
  bundleSha256: '47aca7394ed5f9d613dea34a8d6eaabd41d9d26427338528761d8db972e7a3e1',
  assetUrl: '/api/dsh-tavern/vendor/magvarupdate/bundle.js'
})

const bundleUrl = new URL('../vendor/magvarupdate/host-build/artifact/bundle.js', import.meta.url)
let bundlePromise

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** Read and verify the pinned official MagVarUpdate artifact from this package. */
export async function readOfficialMvuBundle() {
  if (bundlePromise === undefined) {
    bundlePromise = readFile(bundleUrl).then(function (body) {
      const actual = sha256(body)
      if (actual !== OFFICIAL_MVU_VERSION.bundleSha256) {
        throw new Error('本地官方 MVU 产物校验失败：期望 ' + OFFICIAL_MVU_VERSION.bundleSha256 + '，实际 ' + actual)
      }
      return Object.freeze({
        body,
        mediaType: 'text/javascript; charset=utf-8',
        etag: '"sha256-' + actual + '"',
        commit: OFFICIAL_MVU_VERSION.commit,
        sha256: actual
      })
    })
  }
  return await bundlePromise
}
