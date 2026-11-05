import assert from 'node:assert/strict'
import test from 'node:test'
import { refreshCdn } from '../.github/scripts/refresh-cdn.mjs'

function fixture({ throttled = true, revisions = ['old'], purgeError = false } = {}) {
  const logs = [], calls = []
  let checks = 0
  return {
    logs, calls,
    options: {
      repo: 'owner/repo', branch: 'main', manifest: { revision: 'new', archive: { commit: 'archive-sha' } },
      sleep: async () => {}, log: text => logs.push(text),
      request: async url => {
        calls.push(url)
        if (url.includes('purge.')) {
          if (purgeError) return new Response('', { status: 503 })
          return Response.json({ paths: { '/entry': { throttled, throttlingReset: 2822 } } })
        }
        if (url.endsWith('runtime.zip')) return new Response('zip')
        return Response.json({ revision: revisions[Math.min(checks++, revisions.length - 1)] })
      },
    },
  }
}

test('HTTP 200 purge throttling remains a failure when CDN is stale, with a retry time', async () => {
  const { options, logs, calls } = fixture()
  await assert.rejects(refreshCdn(options), /stale manifest.*Purge throttled.*2822 seconds.*48 minutes/)
  assert.equal(logs.filter(line => line.includes('purge throttled')).length, 4)
  assert.equal(calls.filter(url => url.includes('cdn.jsdelivr.net')).length, 4)
})

test('throttling does not fail a verified matching CDN, and immutable archive is warmed', async () => {
  const { options, calls } = fixture({ revisions: ['old', 'new'] })
  await refreshCdn(options)
  assert.ok(calls.at(-1).endsWith('@archive-sha/runtime.zip'))
})

test('unthrottled stale CDN still fails the revision consistency check', async () => {
  const { options } = fixture({ throttled: false })
  await assert.rejects(refreshCdn(options), /stale manifest/)
})

test('purge HTTP failure is reported and does not skip revision verification', async () => {
  const { options, logs } = fixture({ purgeError: true, revisions: ['new'] })
  await refreshCdn(options)
  assert.equal(logs.filter(line => line.includes('HTTP 503')).length, 4)
})
