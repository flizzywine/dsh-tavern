// Live2D runtime files (dsh-tavern-stage lib/live2d): synthetic API markers only, no proprietary runtime in fixtures.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCubismCore, CUBISM_CORE_DOWNLOAD, CUBISM_CORE_LICENSE, LIVE2D_RUNTIME_SOURCES } from '../tavern-plugin/packages/dsh-tavern-stage/lib/live2d/cubism-core.js'
import { TAVERN_RUNTIME_ASSET_PREFIX, resolveTavernRuntimeAsset } from '../tavern-plugin/lib/domain/tavern-runtime-assets.js'
import { syntheticFixture } from './helpers/synthetic-link-fixture.mjs'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { createLive2dFiles, live2dFigureRuntime } from '../tavern-plugin/packages/dsh-tavern-stage/lib/live2d/live2d-files.js'
import { createFigureRuntimes } from '../tavern-plugin/packages/dsh-tavern-stage/lib/figure-runtimes.js'
import { createExtensionRequests } from '../tavern-plugin/lib/domain/extension-requests.js'
import { registerTavernHttpRoutes } from '../tavern-plugin/lib/http/routes.js'

const source = 'var Live2DCubismCore = {Moc: {}, Model: {}, Version: {}, csmGetVersion() {}, csmReviveMocInPlace() {}}; throw new Error("must not execute");'
const input = { name: 'live2dcubismcore.min.js', consent: true, base64: Buffer.from(source).toString('base64') }
async function setup(t) {
  // publishing hard-links its temporary file: one registered synthetic fixture.
  const root = syntheticFixture(t, 'cubism-import-')
  return { root, core: createCubismCore(root) }
}

test('a dropped Core publishes atomically, serves from the runtime-asset route and never replaces the installed file', async t => {
  const { root, core } = await setup(t)
  const initial = await core.status()
  assert.equal(initial.installed, false)
  assert.equal(initial.core, '')
  assert.equal(initial.downloadUrl, CUBISM_CORE_DOWNLOAD)
  assert.equal(initial.licenseUrl, CUBISM_CORE_LICENSE)
  const results = await Promise.all([core.importFile(input), core.importFile(input)])
  assert.ok(results.every(result => result.coreInstalled))
  assert.deepEqual(await readdir(path.join(root, 'core')), ['live2dcubismcore.min.js'])
  assert.equal(await readFile(path.join(root, 'core/live2dcubismcore.min.js'), 'utf8'), source)
  assert.equal((await core.status()).core, TAVERN_RUNTIME_ASSET_PREFIX + 'live2d/live2dcubismcore.min.js')
  await core.importFile({ ...input, name: 'live2dcubismcore.js', base64: Buffer.from(source + '\n// changed').toString('base64') })
  assert.equal(await readFile(path.join(root, 'core/live2dcubismcore.min.js'), 'utf8'), source)
})

test('import boundary rejects consent, traversal, encoding, size, wrong runtime and syntax without writing', async t => {
  const { root, core } = await setup(t)
  for (const patch of [
    { consent: 'true' }, { consent: false }, { name: '../live2dcubismcore.min.js' }, { name: 'sdk.zip' },
    { base64: '!!!!' }, { base64: 'YQ==' + '=' }, { base64: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') },
    { base64: Buffer.from('<html>download</html>').toString('base64') },
    { base64: Buffer.from('var spine = {};').toString('base64') },
    { base64: Buffer.from(source + '{').toString('base64') },
    { base64: Buffer.from([255, 254]).toString('base64') }
  ]) await assert.rejects(core.importFile({ ...input, ...patch }))
  assert.equal(await core.hasCore(), false)
  assert.deepEqual(await readdir(root), [])
})


const display = 'var PIXI = {live2d: {Live2DModel: {}, CubismModel: {}}}; var Live2DCubismCore; throw new Error("must not execute");'
const kindOf = url => url === LIVE2D_RUNTIME_SOURCES.core ? 'core' : url === LIVE2D_RUNTIME_SOURCES.display ? 'display' : assert.fail(url)

test('download asks for consent, fetches each missing piece from its publisher once and publishes it for offline use', async t => {
  const root = syntheticFixture(t, 'cubism-download-'), fetched = []
  const core = createCubismCore(root, { fetch: async (url, init) => { fetched.push(kindOf(url)); assert.ok(init.signal); return new Response(kindOf(url) === 'core' ? source : display) } })
  await assert.rejects(core.download({}), /同意/)
  assert.deepEqual(fetched, [])
  const status = await core.download({ consent: true })
  assert.equal(status.installed, true)
  assert.equal(status.display, TAVERN_RUNTIME_ASSET_PREFIX + 'live2d/pixi-live2d-display-cubism4.min.js')
  assert.deepEqual(fetched.sort(), ['core', 'display'])
  assert.equal(await readFile(path.join(root, 'core/pixi-live2d-display-cubism4.min.js'), 'utf8'), display)
  await core.download({ consent: true })
  assert.equal(fetched.length, 2, 'an installed runtime is never fetched again')
})

test('a failed download names each piece, keeps what arrived and still takes the dropped official file', async t => {
  const root = syntheticFixture(t, 'cubism-download-fail-')
  const answers = {
    core: [() => new Response('', { status: 404 }), () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }) }, () => new Response('<html>download</html>')],
    display: [() => new Response(display)]
  }
  const core = createCubismCore(root, { fetch: async url => answers[kindOf(url)].shift()() })
  await assert.rejects(core.download({ consent: true }), /^Error: 下载 Cubism Core 失败（HTTP 404）$/)
  assert.deepEqual((await core.status()).missing, ['core'], 'the piece that arrived stays installed')
  await assert.rejects(core.download({ consent: true }), /下载 Cubism Core 失败（连接超时）/)
  await assert.rejects(core.download({ consent: true }), /下载 Cubism Core 失败（运行库必须是有效的 UTF-8 JavaScript 文件）/)
  assert.deepEqual(await readdir(path.join(root, 'core')), ['pixi-live2d-display-cubism4.min.js'])
  await assert.rejects(core.importFile({ ...input, name: 'cubism4.min.js' }), /不是预期的 pixi-live2d-display/)
  assert.equal((await core.importFile(input)).installed, true)
})

test('the runtime-asset route serves the downloaded files unless a private vendor copy exists', async t => {
  const root = syntheticFixture(t, 'runtime-route-'), vendorRoot = pathToFileURL(path.join(root, 'vendor') + path.sep)
  for (const [relative, stored] of [['live2d/pixi-live2d-display-cubism4.min.js', 'live2d/core/pixi-live2d-display-cubism4.min.js'], ['live2d/live2dcubismcore.min.js', 'live2d/core/live2dcubismcore.min.js']]) {
    const url = TAVERN_RUNTIME_ASSET_PREFIX + relative, target = path.join(root, stored)
    assert.equal((await resolveTavernRuntimeAsset(url, root, vendorRoot)).file, target)
    const local = new URL(relative, vendorRoot)
    await mkdir(new URL('.', local), { recursive: true })
    await writeFile(local, 'private copy')
    assert.equal((await resolveTavernRuntimeAsset(url, root, vendorRoot)).file.href, local.href)
  }
})

test('the live2d figure runtime needs both pieces, owns its requests and refuses consent from other origins', async t => {
  assert.throws(() => createLive2dFiles('live2d'), /绝对路径/)
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'live2d-core-'))
  const root = path.join(dataRoot, 'live2d'), core = path.join(root, 'core'), file = path.join(core, 'live2dcubismcore.min.js')
  await mkdir(core, { recursive: true })
  const display = path.join(core, 'pixi-live2d-display-cubism4.min.js')
  t.after(async () => { await unlink(file); await unlink(display); await rmdir(core); await rmdir(root); await rmdir(dataRoot) })
  const files = createLive2dFiles(root)
  // Exercise the actual stage projection capability decision, not just status().
  const host = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/lib/rpc.js', import.meta.url), 'utf8')
  const decision = host.match(/const live2d = [^\n]*figureRuntimes\.available\('live2d'\)[^\n]+/)?.[0]
  assert.ok(decision)
  const runtimes = createFigureRuntimes()
  runtimes.register('live2d', live2dFigureRuntime(files))
  const projectAvailable = new (Object.getPrototypeOf(async function () {}).constructor)('figureRuntimes', 'requestPerformance', decision + '; return live2d')
  const project = () => projectAvailable(runtimes, {stage: (_name, task) => task()})
  assert.equal(await files.hasCore(), false)
  assert.equal(await project(), false)
  await writeFile(file, '// core')
  assert.equal(await files.hasCore(), true)
  assert.equal(await files.available(), false)
  assert.equal(await project(), false, 'Core alone keeps the missing-runtime prompt')
  assert.deepEqual((await files.coreStatus()).missing, ['display'])
  assert.equal((await files.coreStatus()).displayDownloadUrl, 'https://github.com/guansss/pixi-live2d-display/releases/tag/v0.4.0')
  await writeFile(display, '// display')
  assert.equal(await files.available(), true)
  assert.equal(await project(), true)
  // Both runtime URLs the status hands out resolve to the imported files when no private vendor copy exists.
  const vendorRoot = pathToFileURL(path.join(dataRoot, 'no-vendor') + path.sep)
  const status = await files.coreStatus()
  assert.equal((await resolveTavernRuntimeAsset(status.core, dataRoot, vendorRoot)).file, file)
  assert.equal((await resolveTavernRuntimeAsset(status.display, dataRoot, vendorRoot)).file, display)
  // The stage's figure runtime owns the requests, including the names the asset library and stage use.
  const requests = createExtensionRequests()
  runtimes.bind(requests)
  for (const method of ['getLive2dRuntime', 'importLive2dRuntime', 'downloadLive2dRuntime']) assert.ok(requests.handles(method), method)
  assert.equal((await requests.call('getLive2dRuntime', {})).installed, true)
  const routes = [], disposers = []
  const webServer = { server: new EventEmitter(), register(route) { routes.push(route); return () => {} } }
  registerTavernHttpRoutes({
    ctx: { get: name => name === 'webServer' ? webServer : name === 'connection' ? {requestRejection:() => undefined} : undefined, effect: fn => disposers.push(fn()) },
    runtimeReadiness: Promise.resolve({ ok: true }), performanceDiagnostics: { http() {} }
  })
  t.after(() => disposers.forEach(dispose => dispose?.()))
  const route = routes.find(item => item.path === '/api/dsh-tavern')
  // consent cannot be posted from an opaque card frame or another local origin.
  for (const method of ['importLive2dRuntime', 'downloadLive2dRuntime']) for (const origin of ['null', 'https://untrusted.example', 'http://localhost:1234']) {
    const response = { writeHead(status) { this.status = status }, end() {} }
    await route.handler({ method: 'POST', url: '/api/dsh-tavern/' + method, headers: { host: 'localhost', origin } }, response)
    assert.equal(response.status, 403)
  }
})
