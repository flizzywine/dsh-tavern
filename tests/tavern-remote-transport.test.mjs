import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { stripTypeScriptTypes, createRequire } from 'node:module'
import vm from './fixtures/client-vm.mjs'

const remoteSource = stripTypeScriptTypes(await readFile(new URL('../tavern-plugin/packages/dsh-tavern-remote/src/client.ts', import.meta.url), 'utf8'))
  .replace(/^import .*$/gm, '').replace(/^export /gm, '')
const remoteBundle = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-remote/lib/client.js', import.meta.url), 'utf8')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function signalHarness(format, { holdDisposal = false } = {}) {
  let descriptor, provided, unmounted = 0
  const snapshots = [], follows = [], timers = new Map()
  class FakeSnapshotStream {
    constructor(stream, options) {
      this.stream = stream
      this.options = options
      this.starts = 0
      this.restarts = 0
      this.disposals = 0
      this.abort = new AbortController()
      this.finished = deferred()
      snapshots.push(this)
    }
    start() { this.starts++; this.stream.open(this.abort.signal) }
    restart() { this.restarts++; this.stream.open(this.abort.signal) }
    dispose() {
      this.disposals++
      this.abort.abort()
      if (!holdDisposal) this.finished.resolve()
      return this.finished.promise
    }
  }
  class FakeCarrierError extends Error {}
  const sandbox = {
    RemoteSnapshotStream: FakeSnapshotStream,
    RemoteStreamCarrierError: FakeCarrierError,
    TYPERT_REMOTE: {},
    setTimeout(callback, delay) {
      const timer = { callback, delay }
      timers.set(timer, timer)
      return timer
    },
    clearTimeout(timer) { timers.delete(timer) },
    window: { __ModuleLoader__: { load(value) { descriptor = value } } },
  }
  const client = format === 'source'
    ? vm.runInNewContext(remoteSource + '\n;({ apply })', sandbox)
    : (vm.runInNewContext(remoteBundle, sandbox), descriptor.factory(id => {
      assert.equal(id, '@deepseek-ai/dsh-api-gateway/client')
      return { RemoteSnapshotStream: FakeSnapshotStream, RemoteStreamCarrierError: FakeCarrierError }
    }))
  const dispose = await client.apply({
    remote: {
      async $mount() { return async () => { unmounted++ } },
      $stream(options) { return options },
    },
    get(name) {
      assert.equal(name, 'remote.tavernSignals')
      return { follow(ids, signal) { follows.push({ ids: Array.from(ids), signal }); return [] } }
    },
    provide(name, value) { assert.equal(name, 'tavernSessionSignals'); provided = value },
  })
  return {
    service: provided, dispose, snapshots, follows, timers,
    get current() { return snapshots.at(-1) },
    get unmounted() { return unmounted },
    runTimer(timer = timers.keys().next().value) { assert.ok(timer); timers.delete(timer); timer.callback() },
  }
}

function signal(version, sessionId = 'A', kind = 'candidate') {
  return { id: kind + ':' + version, sessionId, kind, version }
}
function replace(stream, ...signals) { stream.options.replace({ type: 'snapshot', signals }) }
function update(stream, value) { stream.options.update({ type: 'delta', signal: value }) }
function staleCallbacks(stream) {
  replace(stream, signal('stale-snapshot'))
  update(stream, signal('stale-delta'))
  stream.options.failed(new Error('stale failure'))
  stream.stream.carrierFailed(new Error('stale carrier'))
}

for (const format of ['source', 'bundle']) {
  test(`${format}: signal transport shares one active stream and isolates session/kind listeners`, async () => {
    const h = await signalHarness(format)
    const candidate = [], runtime = [], connected = [], errors = []
    const stopCandidate = h.service.subscribe('A', 'candidate', value => candidate.push(value.version),
      error => errors.push(error.message), () => connected.push('candidate'))
    const stopRuntime = h.service.subscribe('A', 'runtime-work', value => runtime.push(value.version),
      error => errors.push(error.message), () => connected.push('runtime'))
    assert.equal(h.snapshots.length, 1, 'same-session listeners share their stream')
    const first = h.current
    const stopOther = h.service.subscribe('B', 'candidate', () => {})
    assert.equal(first.disposals, 1)
    assert.equal(first.restarts, 0)
    assert.equal(first.abort.signal.aborted, true)
    assert.deepEqual(h.follows.map(item => item.ids), [['A'], ['A', 'B']])
    replace(h.current, signal('1'), signal('2', 'A', 'runtime-work'))
    update(h.current, signal('3'))
    assert.deepEqual(candidate, ['1', '3'])
    assert.deepEqual(runtime, ['2'])
    assert.deepEqual(connected.sort(), ['candidate', 'runtime'])
    const replayed = []
    const stopReplay = h.service.subscribe('A', 'candidate', value => replayed.push(value.version),
      undefined, () => replayed.push('connected'))
    assert.deepEqual(replayed, ['connected', '3'])
    assert.equal(h.snapshots.length, 2)
    h.current.stream.carrierFailed(new Error('retrying'))
    assert.deepEqual(errors, ['retrying', 'retrying'])
    stopOther()
    assert.deepEqual(h.follows.map(item => item.ids), [['A'], ['A', 'B'], ['A']])
    stopCandidate(); stopRuntime(); stopReplay()
    await h.dispose()
  })

  test(`${format}: last signal unsubscribe disposes without opening an empty follow`, async () => {
    const h = await signalHarness(format)
    const stop = h.service.subscribe('A', 'candidate', () => {})
    const first = h.current
    stop(); stop()
    assert.deepEqual(h.follows.map(item => item.ids), [['A']])
    assert.equal(first.disposals, 1)
    assert.equal(first.restarts, 0)
    assert.equal(first.abort.signal.aborted, true)
    staleCallbacks(first)
    assert.equal(h.timers.size, 0)
    await h.dispose()
    assert.equal(first.disposals, 1)
  })

  test(`${format}: resubscribe ignores every old callback and pending disposal completion`, async () => {
    const h = await signalHarness(format, { holdDisposal: true })
    const events = []
    const stop = h.service.subscribe('A', 'candidate', () => {})
    const first = h.current
    replace(first, signal('cached'))
    stop()
    const stopNext = h.service.subscribe('A', 'candidate', value => events.push(value.version),
      error => events.push(error.message), () => events.push('connected'))
    const next = h.current
    assert.notEqual(first, next)
    assert.deepEqual(events, [], 'a new lifetime must not replay old connection/cache state')
    staleCallbacks(first)
    assert.deepEqual(events, [])
    assert.equal(h.timers.size, 0)
    replace(next, signal('fresh'))
    first.finished.resolve()
    await Promise.resolve()
    update(next, signal('newer'))
    assert.deepEqual(events, ['connected', 'fresh', 'newer'])
    assert.equal(h.snapshots.length, 2)
    assert.equal(next.disposals, 0)
    stopNext()
    next.finished.resolve()
    await h.dispose()
  })

  test(`${format}: failed-stream retry is canceled by unsubscribe and cannot replace a successor`, async () => {
    const h = await signalHarness(format)
    const stop = h.service.subscribe('A', 'candidate', () => {})
    const first = h.current
    first.options.failed(new Error('failed'))
    const canceled = h.timers.keys().next().value
    assert.equal(canceled.delay, 250)
    stop()
    assert.equal(h.timers.size, 0)
    const events = []
    const stopNext = h.service.subscribe('A', 'candidate', value => events.push(value.version))
    const next = h.current
    h.runTimer(canceled) // A callback already queued before cancellation is still harmless.
    staleCallbacks(first)
    replace(next, signal('fresh'))
    assert.deepEqual(events, ['fresh'])
    assert.equal(h.snapshots.length, 2)
    next.options.failed(new Error('next failure'))
    const nextRetry = h.timers.keys().next().value
    assert.equal(nextRetry.delay, 250)
    h.runTimer(canceled)
    assert.equal(h.timers.size, 1, 'a stale timer must not clear the successor recovery timer')
    assert.ok(h.timers.has(nextRetry))
    stopNext()
    assert.equal(h.timers.size, 0)
    await h.dispose()
  })

  test(`${format}: recovery backs off, fences failed snapshots, and resets after success`, async () => {
    const h = await signalHarness(format)
    const events = []
    const stop = h.service.subscribe('A', 'candidate', value => events.push(value.version),
      error => events.push(error.message), () => events.push('connected'))
    const first = h.current
    replace(first, signal('initial'))
    first.options.failed(new Error('failed'))
    staleCallbacks(first)
    assert.deepEqual(events, ['connected', 'initial', 'failed'])
    assert.equal(h.timers.size, 1)
    assert.equal(h.timers.keys().next().value.delay, 250)
    h.runTimer()
    assert.equal(first.disposals, 1)
    assert.equal(h.snapshots.length, 2)
    h.current.options.failed(new Error('failed again'))
    assert.equal(h.timers.keys().next().value.delay, 500)
    h.runTimer()
    replace(h.current, signal('recovered'))
    h.current.options.failed(new Error('failed after success'))
    assert.equal(h.timers.keys().next().value.delay, 250)
    stop()
    await h.dispose()
  })

  test(`${format}: stopping a failed lifetime resets backoff before the next snapshot`, async () => {
    const h = await signalHarness(format)
    const stop = h.service.subscribe('A', 'candidate', () => {})
    h.current.options.failed(new Error('failed'))
    h.runTimer()
    h.current.options.failed(new Error('failed again'))
    assert.equal(h.timers.keys().next().value.delay, 500)
    stop()
    const events = []
    const stopNext = h.service.subscribe('A', 'candidate', value => events.push(value.version),
      undefined, () => events.push('connected'))
    assert.deepEqual(events, [])
    h.current.options.failed(new Error('new lifetime failed'))
    assert.equal(h.timers.keys().next().value.delay, 250)
    stopNext()
    await h.dispose()
  })

  test(`${format}: session changes replace ownership and cancel the previous retry`, async () => {
    const h = await signalHarness(format)
    const a = [], b = [], connected = []
    const stopA = h.service.subscribe('A', 'candidate', value => a.push(value.version))
    const first = h.current
    replace(first, signal('a1'))
    first.options.failed(new Error('failed'))
    const canceled = h.timers.keys().next().value
    const stopB = h.service.subscribe('B', 'candidate', value => b.push(value.version),
      undefined, () => connected.push('B'))
    const both = h.current
    assert.equal(h.timers.size, 0)
    assert.deepEqual(connected, [])
    h.runTimer(canceled)
    staleCallbacks(first)
    replace(both, signal('a2'), signal('b2', 'B'))
    stopA()
    const onlyB = h.current
    replace(both, signal('old-b', 'B'))
    replace(onlyB, signal('b3', 'B'))
    assert.deepEqual(a, ['a1', 'a2'])
    assert.deepEqual(b, ['b2', 'b3'])
    assert.deepEqual(h.follows.map(item => item.ids), [['A'], ['A', 'B'], ['B']])
    assert.equal(both.disposals, 1)
    stopB()
    await h.dispose()
  })

  test(`${format}: carrier failure invalidates cached connection state until a new snapshot`, async () => {
    const h = await signalHarness(format)
    const stopFirst = h.service.subscribe('A', 'candidate', () => {})
    replace(h.current, signal('old'))
    h.current.stream.carrierFailed(new Error('carrier disconnected'))
    const events = []
    const stopSecond = h.service.subscribe('A', 'candidate', value => events.push(value.version),
      undefined, () => events.push('connected'))
    assert.deepEqual(events, [])
    assert.equal(h.snapshots.length, 1, 'carrier recovery stays owned by RemoteSnapshotStream')
    assert.equal(h.timers.size, 0)
    replace(h.current, signal('reconnected'))
    assert.deepEqual(events, ['connected', 'reconnected'])
    stopFirst(); stopSecond()
    await h.dispose()
  })

  test(`${format}: reentrant subscription changes stop the retired snapshot delivery`, async () => {
    const h = await signalHarness(format)
    const events = []
    let stopB
    const stopA = h.service.subscribe('A', 'candidate', value => events.push('candidate:' + value.version),
      undefined, () => { stopB ??= h.service.subscribe('B', 'candidate', () => {}) })
    const stopRuntime = h.service.subscribe('A', 'runtime-work', value => events.push('runtime:' + value.version))
    const first = h.current
    replace(first, signal('old'), signal('old', 'A', 'runtime-work'))
    assert.deepEqual(events, [], 'onConnect retired the stream before either value could be published')
    replace(h.current, signal('new'), signal('new', 'A', 'runtime-work'))
    assert.deepEqual(events, ['candidate:new', 'runtime:new'])
    stopA(); stopRuntime(); stopB()
    await h.dispose()
  })

  test(`${format}: unsubscribing during error publication prevents recovery and further callbacks`, async () => {
    const h = await signalHarness(format)
    const events = []
    const stopA = h.service.subscribe('A', 'candidate', () => {}, () => {
      events.push('first'); stopA(); stopB()
    })
    const stopB = h.service.subscribe('A', 'runtime-work', () => {}, () => events.push('second'))
    h.current.options.failed(new Error('failed'))
    assert.deepEqual(events, ['first'])
    assert.equal(h.timers.size, 0)
    assert.equal(h.snapshots.length, 1)
    await h.dispose()
  })

  test(`${format}: service disposal cancels retry, fences callbacks, and awaits all retired streams`, async () => {
    const h = await signalHarness(format, { holdDisposal: true })
    const events = []
    const stopA = h.service.subscribe('A', 'candidate', value => events.push(value.version), error => events.push(error.message))
    const first = h.current
    const stopB = h.service.subscribe('B', 'candidate', () => {})
    const next = h.current
    next.options.failed(new Error('failed'))
    const canceled = h.timers.keys().next().value
    const disposed = h.dispose()
    assert.equal(h.timers.size, 0)
    assert.equal(next.disposals, 1)
    assert.equal(h.unmounted, 0)
    assert.throws(() => h.service.subscribe('A', 'candidate', () => {}), /disposed/)
    await assert.rejects(h.service.control('claimTavernScriptWork', {}), /disposed/)
    staleCallbacks(first); staleCallbacks(next)
    h.runTimer(canceled)
    stopA(); stopB()
    assert.deepEqual(events, ['failed'])
    assert.equal(h.snapshots.length, 2)
    next.finished.resolve()
    await Promise.resolve()
    assert.equal(h.unmounted, 0, 'the superseded stream is still closing')
    first.finished.resolve()
    await disposed
    await h.dispose()
    assert.equal(h.unmounted, 1)
    assert.equal(first.disposals, 1)
    assert.equal(next.disposals, 1)
  })
}

const {createPresentationQueue, rpcFetchPriority} = createRequire(import.meta.url)('../tavern-plugin/src/client/rpc-transport.cjs')
for (const file of ['../tavern-plugin/src/client/main.js', '../tavern-plugin/lib/client.js']) {
  test(`${file}: slow stage reads use the mux while origin-bound projections leave HTTP slots free`, async () => {
    const source = await readFile(new URL(file, import.meta.url),'utf8')
    const start = source.indexOf('function rpc(method, args, sessionId, requestOptions)')
    // d6e5cb1ed removed recordImageInteraction; rpc is now followed by rpcWithTimeout.
    const end = source.indexOf('function rpcWithTimeout',start)
    const waiting = [], multiplexed = [], remoteGate = deferred()
    const sandbox = {
      window: { crypto: globalThis.crypto }, Date, performance, Promise, JSON, Error, clipExportTransport: null,
      roundLoadCounts:new Map(), roundLoadTrace:{mark() {}}, rpcFetchPriority,
      presentationRequest:createPresentationQueue(),
      tavernSessionSignals:{control:async (method,args) => {multiplexed.push({method,args});await remoteGate.promise;return {ok:true,method}}},
      performanceReportAt:Date.now(), pagePerformance:{},
      tavernRuntimeGenerationMonitor:{observe() {}},
      readTavernJsonResponse:response=>response.json(),
      fetch:(url, request) => {const gate=deferred();waiting.push({url,request,gate});return gate.promise},
    }
    const rpc = vm.runInNewContext(source.slice(start,end)+';rpc',sandbox)
    const slow = [['getStageDirection',{turn:17,readOnly:true}],['getStageModHistory',{turn:17}],['getDialogueBubbles',{turn:17}]].map(([method,args])=>rpc(method,args,'session-A'))
    const projections = Array.from({length:8},()=>rpc('getAssetPackPresentation',{turn:17},'session-A'))
    await new Promise(resolve=>setImmediate(resolve))
    assert.equal(multiplexed.length,3)
    assert.ok(multiplexed.every(row=>row.args.sessionId==='session-A'))
    assert.equal(waiting.length,2,'only two origin-bound projection requests may occupy HTTP sockets')
    const small=rpc('getUpdateStatus',{})
    assert.equal(waiting.length,3,'unrelated HTTP calls are not queued behind projections')
    waiting[2].gate.resolve({json:async()=>({ok:true})})
    await small
    remoteGate.resolve()
    await Promise.all(slow)
    for (let i=0;i<8;i++) {
      const request=waiting.filter(row=>row.url.endsWith('getAssetPackPresentation'))[i]
      assert.ok(request)
      request.gate.resolve({json:async()=>({ok:true})})
      await new Promise(resolve=>setImmediate(resolve))
    }
    await Promise.all(projections)
    // A direction request that is not readOnly may run and save the director: it keeps HTTP.
    const generating=rpc('getStageDirection',{turn:18},'session-A')
    await new Promise(resolve=>setImmediate(resolve))
    assert.equal(multiplexed.length,3)
    const sent=waiting.find(row=>row.url.endsWith('getStageDirection'))
    assert.ok(sent,'getStageDirection without readOnly goes over HTTP')
    sent.gate.resolve({json:async()=>({ok:true})})
    await generating
  })
}
test('queued projection cancellation never consumes an HTTP connection and failures release the slot',async()=>{
  const run=createPresentationQueue(1), hold=deferred(), controller=new AbortController()
  const first=run(()=>hold.promise)
  let sent=false
  const cancelled=run(()=>{sent=true},controller.signal)
  controller.abort()
  await assert.rejects(cancelled,{name:'AbortError'})
  hold.resolve();await first
  await assert.rejects(run(()=>{throw Error('failed')}),/failed/)
  assert.equal(await run(()=>42),42)
  assert.equal(sent,false)
})
test('host mux read allowlist preserves dispatch, errors and cancellation, excluding origin-bound leases and writes',async()=>{
  const source=await readFile(new URL('../tavern-plugin/lib/index.js',import.meta.url),'utf8')
  const start=source.indexOf('async control(method, args, signal)'), end=source.indexOf('async * follow',start)
  const calls=[]
  // The stage owns its remote reads (dsh-tavern-stage lib/requests.js remoteRead); the host mux asks extensionRequests.
  const {createExtensionRequests}=await import('../tavern-plugin/lib/domain/extension-requests.js')
  const extensionRequests=createExtensionRequests(), reads=new Set(['getStageDirection','getStageModHistory','getDialogueBubbles'])
  extensionRequests.register('stage',{methods:[...reads,'getAssetPackPresentation','getStagePhonePresentation','saveDialogueBubbles'],remoteRead:method=>reads.has(method),call(){}})
  const service=vm.runInNewContext('({'+source.slice(start,end)+'})',{
    runtimeGeneration:'test-runtime',str:String,extensionRequests,
    requestPerformance:{serialize:(_method,_sessionId,result)=>JSON.stringify(result)},
    dispatch:async(method,args)=>{calls.push(method);if(args.fail)throw Object.assign(Error('changed'),{code:'REVISION_CONFLICT'});return {turn:args.turn}},
  })
  for(const method of ['getStageDirection','getStageModHistory','getDialogueBubbles']) {
    assert.deepEqual(JSON.parse(await service.control(method,{turn:17})),{ok:true,turn:17,runtimeGeneration:'test-runtime'})
    assert.deepEqual(JSON.parse(await service.control(method,{fail:true})),{ok:false,error:'changed',errorCode:'REVISION_CONFLICT'})
  }
  for(const method of ['getAssetPackPresentation','getStagePhonePresentation','saveDialogueBubbles'])await assert.rejects(service.control(method,{}))
  const count=calls.length, cancelled=AbortSignal.abort()
  await assert.rejects(service.control('getStageDirection',{},cancelled),{name:'AbortError'})
  assert.equal(calls.length,count)
})

test('the host mux carries a stage direction read only when it is readOnly, through the real stage requests', async () => {
  const source=await readFile(new URL('../tavern-plugin/lib/index.js',import.meta.url),'utf8')
  const start=source.indexOf('async control(method, args, signal)'), end=source.indexOf('async * follow',start)
  const {createExtensionRequests}=await import('../tavern-plugin/lib/domain/extension-requests.js')
  const {createStageRequests}=await import('../tavern-plugin/packages/dsh-tavern-stage/lib/requests.js')
  const director=[]
  const chat={id:'chat-1'}
  const stage=createStageRequests({
    chatForSession:async()=>chat, readRoundView:async()=>chat,
    requestPerformance:{stage:(_name,run)=>run()},
    stageDirector:{get:async(_chat,turn,_config,options)=>{director.push({turn,readOnly:options?.readOnly===true});return {status:'done',turn}}},
  })
  const extensionRequests=createExtensionRequests()
  extensionRequests.register('stage',{methods:stage.methods,remoteRead:stage.remoteRead,call:(method,args)=>stage.call(method,args,null,false)})
  const service=vm.runInNewContext('({'+source.slice(start,end)+'})',{
    runtimeGeneration:'test-runtime',str:String,extensionRequests,
    requestPerformance:{serialize:(_method,_sessionId,result)=>JSON.stringify(result)},
    dispatch:(method,args)=>extensionRequests.call(method,args),
  })
  assert.deepEqual(JSON.parse(await service.control('getStageDirection',{sessionId:'s',turn:3,readOnly:true})),{ok:true,status:'done',turn:3,runtimeGeneration:'test-runtime'})
  await assert.rejects(service.control('getStageDirection',{sessionId:'s',turn:4}),/不支持的运行时控制请求/)
  assert.deepEqual(director,[{turn:3,readOnly:true}],'a direction request that may run the director never runs through the mux')
})

// Exercise the shipped Remote bundle, not a stub of tavernSessionSignals.control:
// stale embedded codecs reject locally, and the bubble store retains null forever.
async function mountedRemote(t) {
  const { hostBrowserEntry } = await import('./helpers/host-browser-entry.mjs')
  const require = createRequire(process.env.DSH_BOOT_MODULE || new URL('../tavern-plugin/package.json', import.meta.url))
  const { Context } = require('@deepseek-ai/cordis')
  function loadBundle(source, gateway) {
    let entry
    vm.runInNewContext(source, {
      window: { __ModuleLoader__: { load(value) { entry = value } } },
      crypto: globalThis.crypto, AbortController, AbortSignal, setTimeout, clearTimeout,
      Error, Promise, console,
    })
    return entry.factory(id => id === '@deepseek-ai/dsh-api-gateway/client' ? gateway : require(id))
  }
  const gateway = loadBundle(await readFile(hostBrowserEntry(require, '@deepseek-ai/dsh-api-gateway'), 'utf8'))
  const ctx = new Context(), calls = []
  const { TYPERT_REMOTE: hostContract } = await import('../tavern-plugin/packages/dsh-tavern-remote/lib/typert.remote-client.js')
  const methodCodec = hostContract.descriptors.find(d => d.method === 'control').parameters[0].codec
  const methodSchema = methodCodec.create ? methodCodec.create() : methodCodec.schema
  t.after(() => ctx.fiber.dispose())
  let mounted
  ctx.provide('typert', { remotes: { register(value) { mounted = value; return () => {} } } })
  ctx.provide('connection', {
    registerGenerationSource: () => () => {},
    start: () => ({ stop() {} }),
    rpc: { async *open(path, endpoint, payload, signal) {
      signal.throwIfAborted()
      // NEXT validates strict codecs at the Host boundary, not in its Client Gateway.
      if (!methodSchema.safeParse(payload.args.method).success) throw new Error('Host rejected "method"')
      calls.push({ path, endpoint, payload })
      yield JSON.stringify({ ok: true, method: payload.args.method, config: { stage: { enabled: true } } })
    } },
  })
  await ctx.plugin(gateway)
  await ctx.plugin(loadBundle(remoteBundle, gateway))
  return { service: ctx.tavernSessionSignals, calls, mounted }
}

test('shipped Remote bundle accepts all host control methods through the real Gateway', async t => {
  const h = await mountedRemote(t)
  const { TYPERT_REMOTE } = await import('../tavern-plugin/packages/dsh-tavern-remote/lib/typert.remote-client.js')
  const declaredCodec = TYPERT_REMOTE.descriptors.find(d => d.method === 'control').parameters[0].codec
  const bundledCodec = h.mounted.descriptors.find(d => d.method === 'control').parameters[0].codec
  const declared = declaredCodec.create ? declaredCodec.create() : declaredCodec.schema
  const bundled = bundledCodec.create ? bundledCodec.create() : bundledCodec.schema
  const methods = declared.options.map(option => option.value)
  assert.deepEqual(Array.from(bundled.options, option => option.value), methods, 'embedded contract must match generated descriptors')
  for (const method of methods) {
    const result = await h.service.control(method, { sessionId: 'session-stage', turn: 17 })
    assert.equal(result.method, method)
  }
  assert.equal(h.calls.length, methods.length)
  await assert.rejects(h.service.control('getAssetPackPresentation', {}), /rejected "method"/)
  await assert.rejects(h.service.control('getDialogueBubbles', {}, AbortSignal.abort()), { name: 'AbortError' })
  assert.equal(h.calls.length, methods.length, 'invalid or canceled requests never reach the host control implementation')
})

for (const file of ['../tavern-plugin/src/client/main.js', '../tavern-plugin/lib/client.js']) {
  test(`${file}: initial stage settings load survives the shipped Remote codec boundary`, async t => {
    const h = await mountedRemote(t)
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    const start = source.indexOf('function rpc(method, args, sessionId, requestOptions)')
    const end = source.indexOf('function rpcWithTimeout', start) // d6e5cb1ed
    const bubbles = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/bubbles.js', import.meta.url), 'utf8')
    const storeStart = bubbles.indexOf('const bubbleStore =')
    const storeEnd = bubbles.indexOf('function useBubbles', storeStart)
    const sandbox = {
      window: { crypto: globalThis.crypto }, Date, performance, Promise, JSON, Error,
      roundLoadCounts:new Map(), roundLoadTrace:{mark() {}}, rpcFetchPriority,
      tavernSessionSignals: h.service,
      performanceReportAt: Date.now(), pagePerformance: {},
      tavernRuntimeGenerationMonitor: { observe() {} },
      fetch() { assert.fail('origin-independent stage reads must not use HTTP') },
    }
    sandbox.clipExportTransport = null
    const { rpc, store } = vm.runInNewContext(source.slice(start, end) + bubbles.slice(storeStart, storeEnd) + ';({rpc,store:bubbleStore})', sandbox)
    let updates = 0
    store.subscribe(() => updates++)
    store.load('session-stage')
    // Flush the actual async iterator/Gateway/store chain, with no network or timers.
    for (let i = 0; i < 20 && !updates; i++) await new Promise(resolve => setImmediate(resolve))
    assert.ok(store.get('session-stage')?.config.stage.enabled, 'initial rejection must not leave stage settings and avatars without configuration')
    assert.equal(updates, 1)
    for (const method of ['getStageDirection', 'getStageModHistory']) assert.equal((await rpc(method, { turn: 17, readOnly: true }, 'session-stage')).method, method)
    assert.deepEqual(h.calls.map(row => row.payload.args.method), ['getDialogueBubbles', 'getStageDirection', 'getStageModHistory'])
    assert.ok(h.calls.every(row => row.payload.args.args.sessionId === 'session-stage'))
  })
}
