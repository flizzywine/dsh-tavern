import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { refreshCdnPublication } from '../.github/scripts/refresh-cdn-publication.mjs'
import { CDN_ENTRYPOINTS } from '../.github/scripts/stage-cdn-entrypoints.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const repository = 'owner/repository', prefix = '/gh/' + repository + '@runtime-archive-main/'
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

function fixture({ stale = ['dsh-tavern-runtime.json'], throttleUntil = 0, recover = true, archiveCorrupt = false, firstRateLimit = false } = {}) {
  let time = 0
  const messages = [], purges = [], requests = []
  const expected = new Map(CDN_ENTRYPOINTS.map(file => [file, Buffer.from('current bytes: ' + file)]))
  const visible = new Map([...expected].map(([file, bytes]) => [file, stale.includes(file) ? Buffer.from('stale bytes: ' + file) : bytes]))
  const archiveBytes = Buffer.from('immutable runtime archive')
  const archive = { commit: 'a'.repeat(40), path: 'runtime.zip', size: archiveBytes.length, sha256: hash(archiveBytes) }
  const options = { repository, branch: 'main', archive, files: [...expected].map(([file, bytes]) => ({ path: file, size: bytes.length, sha256: hash(bytes) })),
    now: () => time, wait: async ms => { time += ms }, log: message => messages.push(message), timeoutMs: 20_000, pollMs: 1000,
    fetchImpl: async value => {
      const url = new URL(value)
      requests.push({ url: url.href, time })
      if (url.pathname.endsWith('/runtime.zip')) return new Response(archiveCorrupt ? 'damaged runtime archive' : archiveBytes)
      const file = url.pathname.slice(prefix.length)
      assert.ok(expected.has(file), 'only the exact release entry points are requested: ' + url)
      if (url.hostname === 'purge.jsdelivr.net') {
        purges.push({ file, time })
        if (firstRateLimit && purges.length === 1) return new Response('rate limited', { status: 429, headers: { 'retry-after': '2' } })
        if (time < throttleUntil) return json({ status: 'finished', paths: { [url.pathname]: { throttled: true, throttlingReset: Math.ceil((throttleUntil - time) / 1000) } } })
        if (recover) visible.set(file, expected.get(file))
        return json({ status: 'finished', paths: { [url.pathname]: { throttled: false, providers: { CF: true, FY: true } } } })
      }
      return new Response(visible.get(file))
    },
  }
  return { options, messages, purges, requests, visible, expected, time: () => time }
}

test('an already current publication verifies its archive and every entry point without using purge quota', async () => {
  const f = fixture({ stale: [] })
  await refreshCdnPublication(f.options)
  assert.equal(f.purges.length, 0)
  assert.equal(f.requests.length, 5)
  assert.match(f.messages.at(-1), /all published bytes match/)
})

test('HTTP 200 finished with a throttled path waits for its reset and actually refreshes before succeeding', async () => {
  const f = fixture({ throttleUntil: 3500 })
  await refreshCdnPublication(f.options)
  assert.deepEqual(f.purges.map(item => item.file), ['dsh-tavern-runtime.json', 'dsh-tavern-runtime.json'])
  assert.equal(f.purges[0].time, 0)
  assert.ok(f.purges[1].time >= 4500, 'respect API reset and the one-second clock margin')
  assert.ok(f.time() >= f.purges[1].time)
  assert.ok(f.messages.some(message => /throttled.*retry after/.test(message)))
  assert.match(f.messages.at(-1), /all published bytes match/)
})

test('waiting longer than the release deadline still fails instead of treating a throttled finished response as success', async () => {
  const f = fixture({ throttleUntil: 60_000 })
  await assert.rejects(refreshCdnPublication({ ...f.options, timeoutMs: 4000 }), /still serves stale or invalid bytes: dsh-tavern-runtime.json/)
  assert.equal(f.purges.length, 1)
  assert.equal(f.time(), 4000)
  assert.equal(f.messages.some(message => /all published bytes match/.test(message)), false)
})

test('an accepted purge alone is insufficient, and repeated polls do not consume more purge quota', async () => {
  const f = fixture({ recover: false })
  await assert.rejects(refreshCdnPublication({ ...f.options, timeoutMs: 4000 }), /still serves stale/)
  assert.equal(f.purges.length, 1)
})

test('a current manifest cannot hide a stale installer; only changed files are purged', async () => {
  const f = fixture({ stale: ['install.ps1', 'android/setup.sh'] })
  await refreshCdnPublication(f.options)
  assert.deepEqual(f.purges.map(item => item.file).sort(), ['android/setup.sh', 'install.ps1'])
})

test('an HTTP rate limit also respects Retry-After', async () => {
  const f = fixture({ firstRateLimit: true })
  await refreshCdnPublication(f.options)
  assert.equal(f.purges.length, 2)
  assert.ok(f.purges[1].time >= 2000)
})

test('corrupted immutable archives fail before any alias is purged', async () => {
  const f = fixture({ archiveCorrupt: true })
  await assert.rejects(refreshCdnPublication(f.options), /immutable runtime archive size or SHA-256/)
  assert.equal(f.purges.length, 0)
})

test('the actual publication workflow uses the throttling-aware verifier with sufficient time', async () => {
  const workflow = parse(await readFile(new URL('../.github/workflows/publish-runtime-manifest.yml', import.meta.url), 'utf8'))
  const step = workflow.jobs.publish.steps.find(step => step.name === 'Purge jsDelivr installer caches')
  assert.equal(step.run.trim(), 'node .github/scripts/refresh-cdn-publication.mjs "$GITHUB_REPOSITORY" "$GITHUB_REF_NAME"')
  assert.ok(step['timeout-minutes'] >= 16)
  assert.notEqual(step['continue-on-error'], true)
})
