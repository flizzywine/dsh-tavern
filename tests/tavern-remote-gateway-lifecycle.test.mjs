import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { setImmediate } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

// Resolve the same Gateway that builds the remote package, without depending on
// an unrelated global DSH installation or replacing its lifecycle with a double.
const remoteRequire = createRequire(new URL('../tavern-plugin/packages/dsh-tavern-remote/package.json', import.meta.url))
async function gatewayVariant(require, label) {
  let gatewayFile, cordisFile
  try {
    // Gateway 0.2 resolves ./client to an ESM file under Node; the page runs the browser bundle.
    gatewayFile = require.resolve('@deepseek-ai/dsh-api-gateway/client').replace(/client\.node\.js$/, 'client.browser.js')
    cordisFile = require.resolve('@deepseek-ai/cordis')
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error
    return { label, missingDependency: 'Real Gateway lifecycle test requires ' + label + ' dependencies: ' + error.message }
  }
  const version = require('@deepseek-ai/dsh-api-gateway/package.json').version
  return {
    label: label + ' ' + version,
    cordis: await import(pathToFileURL(cordisFile).href),
    gatewaySource: await readFile(gatewayFile, 'utf8'),
  }
}
const variants = [await gatewayVariant(remoteRequire, 'remote build')]
// The repository test runner selects its real, pinned runtime using this anchor.
if (process.env.DSH_BOOT_MODULE) {
  variants.push(await gatewayVariant(createRequire(pathToFileURL(process.env.DSH_BOOT_MODULE)), 'host runtime'))
}
const clientSource = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-remote/lib/client.js', import.meta.url), 'utf8')
const flush = () => setImmediate()
const signal = (version, sessionId = 'A') => ({ id: 'candidate:' + version, sessionId, kind: 'candidate', version })

function followQueue(ids, abortSignal) {
  const pending = []
  let waiting
  const settle = result => {
    if (!waiting) { pending.push(result); return }
    const current = waiting
    waiting = undefined
    if (result.error) current.reject(result.error)
    else current.resolve(result)
  }
  abortSignal.addEventListener('abort', () => settle({ done: true }), { once: true })
  return {
    ids: Array.from(ids), signal: abortSignal, returned: false,
    send(value) { settle({ value, done: false }) },
    fail(error) { settle({ error }) },
    [Symbol.asyncIterator]() { return this },
    next() {
      if (abortSignal.aborted) return Promise.resolve({ done: true })
      if (pending.length) {
        const item = pending.shift()
        return item.error ? Promise.reject(item.error) : Promise.resolve(item)
      }
      return new Promise((resolve, reject) => { waiting = { resolve, reject } })
    },
    return() { this.returned = true; settle({ done: true }); return Promise.resolve({ done: true }) },
  }
}

async function harness(t, { gatewaySource, cordis }) {
  let descriptor, service, unmounted = 0
  const timers = new Map(), follows = [], streams = []
  const sandbox = {
    AbortController, AbortSignal, Error,
    setTimeout(callback, delay) { const timer = { callback, delay }; timers.set(timer, timer); return timer },
    clearTimeout(timer) { timers.delete(timer) },
    window: { __ModuleLoader__: { load(value) { descriptor = value } } },
  }
  vm.runInNewContext(gatewaySource, sandbox)
  const gateway = descriptor.factory(id => {
    assert.equal(id, '@deepseek-ai/cordis')
    return cordis
  })
  vm.runInNewContext(clientSource, sandbox)
  const client = descriptor.factory(id => {
    assert.equal(id, '@deepseek-ai/dsh-api-gateway/client')
    return gateway
  })
  const connection = { generation: { getSnapshot: () => 1, subscribe: () => () => {} } }
  const dispose = await client.apply({
    remote: {
      async $mount() { return async () => { unmounted++ } },
      $stream(options) { const stream = new gateway.RemoteStream(connection, options); streams.push(stream); return stream },
    },
    get(name) {
      assert.equal(name, 'remote.tavernSignals')
      return { follow(ids, abortSignal) { const queue = followQueue(ids, abortSignal); follows.push(queue); return queue } }
    },
    provide(name, value) { assert.equal(name, 'tavernSessionSignals'); service = value },
  })
  t.after(dispose)
  return {
    service, dispose, gateway, timers, follows, streams,
    get unmounted() { return unmounted },
    runTimer(timer = timers.keys().next().value) { assert.ok(timer); timers.delete(timer); timer.callback() },
  }
}

for (const variant of variants) {
const name = 'real Gateway [' + variant.label + ']: '
const options = { skip: variant.missingDependency }

test(name + 'unsubscribe/resubscribe closes the retired consumer and accepts a new snapshot', options, async t => {
  const h = await harness(t, variant), events = []
  const stop = h.service.subscribe('A', 'candidate', value => events.push(value.version))
  await flush()
  h.follows[0].send({ type: 'snapshot', signals: [signal('first')] })
  await flush()
  assert.deepEqual(events, ['first'])
  stop()
  assert.equal(h.follows[0].signal.aborted, true)
  const stopNext = h.service.subscribe('A', 'candidate', value => events.push(value.version))
  await flush()
  assert.equal(h.streams.length, 2)
  h.follows[0].send({ type: 'delta', signal: signal('stale') })
  h.follows[1].send({ type: 'snapshot', signals: [signal('successor')] })
  await flush()
  assert.deepEqual(events, ['first', 'successor'])
  stopNext()
  await h.dispose()
  assert.ok(h.follows.every(item => item.signal.aborted))
  assert.equal(h.unmounted, 1)
  assert.equal(h.timers.size, 0)
})

test(name + 'terminal failure gets a fresh consumer and canceled recovery cannot reopen it', options, async t => {
  const h = await harness(t, variant), values = [], errors = []
  const stop = h.service.subscribe('A', 'candidate', value => values.push(value.version), error => errors.push(error.message))
  await flush()
  h.follows[0].fail(new Error('terminal failure'))
  await flush()
  assert.deepEqual(errors, ['terminal failure'])
  assert.equal(h.timers.size, 1)
  assert.equal(h.timers.keys().next().value.delay, 250)
  h.runTimer()
  await flush()
  assert.equal(h.streams.length, 2)
  assert.equal(h.follows[0].signal.aborted, true)
  h.follows[1].send({ type: 'snapshot', signals: [signal('recovered')] })
  await flush()
  assert.deepEqual(values, ['recovered'])
  h.follows[1].fail(new Error('second terminal failure'))
  await flush()
  const canceledTimer = h.timers.keys().next().value
  assert.ok(canceledTimer)
  stop()
  assert.equal(h.timers.size, 0)
  canceledTimer.callback()
  await flush()
  assert.equal(h.streams.length, 2)
})

test(name + 'carrier reconnect clears replay state until the next physical snapshot', options, async t => {
  const h = await harness(t, variant), events = [], replay = [], errors = []
  h.service.subscribe('A', 'candidate', value => events.push(value.version), error => errors.push(error.message))
  await flush()
  h.follows[0].send({ type: 'snapshot', signals: [signal('before')] })
  await flush()
  h.follows[0].fail(new h.gateway.RemoteStreamCarrierError('carrier interrupted'))
  await flush()
  assert.equal(h.streams.length, 1, 'the real Gateway owns physical carrier retry')
  assert.equal(h.follows.length, 2)
  assert.deepEqual(errors, ['carrier interrupted'])
  h.service.subscribe('A', 'candidate', value => replay.push(value.version), undefined, () => replay.push('connected'))
  assert.deepEqual(replay, [])
  h.follows[1].send({ type: 'snapshot', signals: [signal('after')] })
  await flush()
  assert.deepEqual(events, ['before', 'after'])
  assert.deepEqual(replay, ['connected', 'after'])
  assert.equal(h.timers.size, 0)
})

test(name + 'reentrant session changes retire the old snapshot and dispose all consumers', options, async t => {
  const h = await harness(t, variant), events = []
  let stopB
  const stopA = h.service.subscribe('A', 'candidate', value => events.push(value.version), undefined, () => {
    if (!stopB) stopB = h.service.subscribe('B', 'candidate', value => events.push(value.version))
  })
  await flush()
  h.follows[0].send({ type: 'snapshot', signals: [signal('retired')] })
  await flush()
  assert.deepEqual(events, [])
  assert.deepEqual(h.follows.map(item => item.ids), [['A'], ['A', 'B']])
  assert.equal(h.follows[0].signal.aborted, true)
  h.follows[1].send({ type: 'snapshot', signals: [signal('new-A'), signal('new-B', 'B')] })
  await flush()
  assert.deepEqual(events, ['new-A', 'new-B'])
  stopB()
  await flush()
  assert.deepEqual(h.follows[2].ids, ['A'])
  stopA()
  await h.dispose()
  assert.ok(h.follows.every(item => item.signal.aborted))
  assert.equal(h.unmounted, 1)
  assert.equal(h.timers.size, 0)
})
}
