import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const rootManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const pluginManifest = JSON.parse(await readFile(new URL('../tavern-plugin/package.json', import.meta.url), 'utf8'))
const remoteManifest = JSON.parse(await readFile(new URL('../tavern-plugin/packages/dsh-tavern-remote/package.json', import.meta.url), 'utf8'))
const clientSource = await readFile(new URL('../tavern-plugin/src/client/main.js', import.meta.url), 'utf8')
const hostSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const remoteBundle = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-remote/lib/client.js', import.meta.url), 'utf8')

test('Tavern notifications use one DSH Remote stream instead of a private EventSource route', function () {
  assert.ok(rootManifest.dsh.profile.bundles.includes('dsh-tavern-remote'))
  assert.ok(pluginManifest.dsh.client.inject.includes('dsh-tavern-remote'))
  assert.equal(remoteManifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.match(clientSource, /ctx\.tavernSessionSignals/)
  assert.doesNotMatch(clientSource, /new window\.EventSource/)
  assert.doesNotMatch(clientSource, /withConnectionSlot/)
  assert.doesNotMatch(hostSource, /pathname === '\/api\/dsh-tavern\/events'/)
})

test('Remote client owns one restartable snapshot stream and isolates session/kind listeners', async function () {
  let descriptor, snapshot, streamOptions, provided
  class FakeSnapshotStream {
    constructor(stream, options) { this.stream = stream; this.options = options; this.starts = 0; this.restarts = 0; snapshot = this }
    start() { this.starts++ }
    restart() { this.restarts++ }
    async dispose() {}
  }
  class FakeCarrierError extends Error {}
  vm.runInNewContext(remoteBundle, { window: { __ModuleLoader__: { load(value) { descriptor = value } } } })
  const client = descriptor.factory(function (id) {
    if (id === '@deepseek-ai/dsh-api-gateway/client') return { RemoteSnapshotStream: FakeSnapshotStream, RemoteStreamCarrierError: FakeCarrierError }
    throw new Error('unexpected module: ' + id)
  })
  const ctx = {
    remote: {
      async $mount() { return async function () {} },
      $stream(options) { streamOptions = options; return {} },
      tavernSignals: { follow() { return [] } },
    },
    provide(name, value) { if (name === 'tavernSessionSignals') provided = value },
  }
  await client.apply(ctx)
  const candidate = [], runtime = [], connected = [], errors = []
  const stopCandidate = provided.subscribe('A', 'candidate', signal => candidate.push(signal.version), error => errors.push(error.message), () => connected.push('candidate'))
  const stopRuntime = provided.subscribe('A', 'runtime-work', signal => runtime.push(signal.version), error => errors.push(error.message), () => connected.push('runtime'))
  assert.equal(snapshot.starts, 1)
  assert.equal(snapshot.restarts, 0)
  const stopOther = provided.subscribe('B', 'candidate', function () {})
  assert.equal(snapshot.restarts, 1)
  snapshot.options.replace({ type: 'snapshot', signals: [
    { id: 'candidate:1', sessionId: 'A', kind: 'candidate', version: '1' },
    { id: 'runtime-work:2', sessionId: 'A', kind: 'runtime-work', version: '2' },
  ] })
  snapshot.options.update({ type: 'delta', signal: { id: 'candidate:3', sessionId: 'A', kind: 'candidate', version: '3' } })
  assert.deepEqual(candidate, ['1', '3'])
  assert.deepEqual(runtime, ['2'])
  assert.deepEqual(connected.sort(), ['candidate', 'runtime'])
  streamOptions.carrierFailed(new Error('retrying'))
  assert.deepEqual(errors, ['retrying', 'retrying'])
  stopOther()
  assert.equal(snapshot.restarts, 2)
  stopCandidate(); stopRuntime()
})
