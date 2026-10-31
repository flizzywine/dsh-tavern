// Run explicitly: node tests/fixtures/runtime-control-starvation.mjs
// Uses the installed DSH mux client/server, generated codecs and production RPC/control services.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from './client-vm.mjs'
import { chromium } from 'playwright'
import { createTavernScriptDispatch } from '../../tavern-plugin/lib/domain/tavern-script-dispatch.js'
import { TYPERT_REMOTE } from '../../tavern-plugin/packages/dsh-tavern-remote/lib/typert.remote-client.js'

const require = createRequire(new URL('../../tavern-plugin/package.json', import.meta.url))
const gateway = pathToFileURL(require.resolve('@deepseek-ai/dsh-api-gateway'))
const { RemoteStreamMuxServer } = await import(new URL('./types/stream-server.js', gateway))
const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')))
const temporary = await mkdtemp(join(tmpdir(), 'tavern-control-'))
const gate = createTavernScriptDispatch({ claimTimeoutMs: 1000 })
const host = await readFile(new URL('../../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const client = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const rpcStart = client.indexOf('\t\tfunction rpc(method,')
let service, browser
const dispatch = (method, args) => {
  const { sessionId: id, runtimeId: runtime, eventId, leaseToken } = args
  switch (method) {
    case 'claimTavernScriptWork': return gate.claim(id, runtime, args.ready)
    case 'startTavernScriptWork': return gate.start(id, eventId, leaseToken, runtime)
    case 'getTavernScriptWorkState': return gate.workState(id, eventId, leaseToken, runtime, args.keepAlive)
    case 'heartbeatTavernScriptRuntime': return { active: gate.touch(id, runtime, args.ready) }
    case 'completeTavernHelperEvent': return { completed: gate.complete(id, eventId, args.args, runtime, leaseToken) }
    case 'releaseTavernHelperRuntime': return { released: gate.dispose(id, runtime) }
    default: throw Error(method)
  }
}
const start = host.indexOf("  ctx.provide('tavernSessionSignals',")
vm.runInNewContext(host.slice(start, host.indexOf('\n  registerTavernHttpRoutes({', start)), {
  ctx: { provide(_name, value) { service = value } }, dispatch, runtimeGeneration: 'test'
})
const contract = TYPERT_REMOTE.descriptors.find(item => item.method === 'control')
const mux = new RemoteStreamMuxServer(async function * (endpoint, payload, signal) {
  assert.equal(endpoint, 'tavernSignals/control')
  const [method, args] = contract.parameters.map(parameter => parameter.codec.schema.parse(payload.args[parameter.wire]))
  yield contract.result.schema.parse(await service.control(method, args, signal))
}, error => ({ code: 'test/error', message: error.message }), 2000)
const held = []
let httpClaims = 0
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.end('<!doctype html><title>Runtime control saturation</title>'); return }
  if (req.url === '/api/dsh-tavern/getSession') { held.push(res); return }
  httpClaims++
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ ok: true }))
})
server.on('upgrade', (req, socket, head) => mux.handleUpgrade(req, socket, head))
try {
  const entry = join(temporary, 'entry.mjs')
  await writeFile(entry, `
    export { RemoteStreamMuxClient } from ${JSON.stringify(new URL('./types/client/stream-client.js', gateway).pathname)};
    export { apply } from ${JSON.stringify(new URL('../../tavern-plugin/packages/dsh-tavern-remote/lib/types/client.js', import.meta.url).pathname)};
  `)
  const gatewayClient = join(temporary, 'gateway-client.mjs')
  await writeFile(gatewayClient, `
    export { RemoteSnapshotStream } from ${JSON.stringify(new URL('./types/client/snapshot-stream.js', gateway).pathname)};
    export { RemoteStreamCarrierError } from ${JSON.stringify(new URL('./types/client/stream-client.js', gateway).pathname)};
  `)
  const cryptoShim = join(temporary, 'crypto.mjs')
  await writeFile(cryptoShim, 'export const randomUUID = () => globalThis.crypto.randomUUID()')
  const bundle = await rolldown({ input: entry, platform: 'browser',
    resolve: { alias: { '@deepseek-ai/dsh-api-gateway/client': gatewayClient, '@deepseek-ai/dsh-util-crypto': cryptoShim } } })
  const { output } = await bundle.generate({ format: 'iife', name: 'TavernControlTest' })
  await bundle.close()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:' + server.address().port)
  await page.addScriptTag({ content: output[0].code })
  await page.evaluate(async rpcSource => {
    const mux = new TavernControlTest.RemoteStreamMuxClient()
    mux.start()
    let descriptors
    await TavernControlTest.apply({
      remote: { async $mount(value) { descriptors = value.descriptors; return async () => {} } },
      get() { return { control(method, args, signal = new AbortController().signal) {
        const descriptor = descriptors.find(item => item.method === 'control')
        const values = [method, args]
        const payload = { args: Object.fromEntries(descriptor.parameters.map((parameter, index) =>
          [parameter.wire, parameter.codec.schema.parse(values[index])])) }
        return mux.open('tavernSignals/control', payload, signal)
      } } },
      provide(_name, value) { window.tavernSessionSignals = value }
    })
    Object.assign(window, {
      performanceReportAt: Date.now(), pagePerformanceStarted: Date.now(), pagePerformance: {},
      performanceRequests: [], performanceActiveRequests: 0,
      beginSessionViewRead: () => null, tavernRuntimeGenerationMonitor: { observe() {} },
      readTavernJsonResponse: response => response.json()
    })
    window.eval(rpcSource)
    window.views = Array.from({ length: 6 }, () => rpc('getSession', {}, 's'))
  }, client.slice(rpcStart, client.indexOf('\n\t\tfunction recordImageInteraction', rpcStart)))
  for (let i = 0; i < 100 && held.length < 6; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(held.length, 6, 'all HTTP/1.1 connection slots are occupied')
  gate.claim('s', 'runtime', true)
  const originalWork = gate.dispatch('s', 'MESSAGE_RECEIVED', [1])
  await page.evaluate(() => {
    const service = tavernSessionSignals
    window.tavernSessionSignals = undefined // Exercise the previous HTTP path.
    window.oldController = new AbortController()
    window.oldClaim = rpc('claimTavernScriptWork', { runtimeId: 'runtime', ready: true }, 's',
      { signal: oldController.signal }).catch(() => {})
    window.tavernSessionSignals = service
  })
  const original = await originalWork
  assert.equal(original.claimTimedOut, true)
  assert.equal(httpClaims, 0, 'old claim is stuck in the real browser connection queue')
  await page.evaluate(() => oldController.abort())
  gate.claim('s', 'runtime', true)
  const work = gate.dispatch('s', 'MESSAGE_RECEIVED', [1])
  const result = await page.evaluate(async () => {
    const began = performance.now()
    const base = { runtimeId: 'runtime', ready: true }
    const offer = await rpc('claimTavernScriptWork', base, 's')
    const identity = { ...base, eventId: offer.event.id, leaseToken: offer.leaseToken }
    const start = await rpc('startTavernScriptWork', identity, 's')
    const state = await rpc('getTavernScriptWorkState', { ...identity, keepAlive: true }, 's')
    const complete = await rpc('completeTavernHelperEvent', { ...identity, args: [1] }, 's')
    const duplicate = await rpc('completeTavernHelperEvent', { ...identity, args: [1] }, 's')
    await rpc('heartbeatTavernScriptRuntime', base, 's')
    await rpc('releaseTavernHelperRuntime', base, 's')
    return { started: start.started, phase: state.phase, completed: complete.completed,
      duplicate: duplicate.completed, elapsedMs: Math.round(performance.now() - began) }
  })
  assert.equal((await work).handled, true)
  assert.equal(result.started, true)
  assert.equal(result.phase, 'executing')
  assert.equal(result.completed, true)
  assert.equal(result.duplicate, true)
  assert.equal(httpClaims, 0)
  console.log(JSON.stringify({ heldViewRequests: held.length, oldHttpClaimReachedHost: httpClaims, oldClaimTimedOut: original.claimTimedOut, ...result }))
} finally {
  gate.dispose('s')
  for (const res of held) res.end(JSON.stringify({ ok: true }))
  await browser?.close()
  await mux.close()
  await new Promise(resolve => server.close(resolve))
  await rm(temporary, { recursive: true, force: true })
}
