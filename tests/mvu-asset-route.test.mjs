import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { OFFICIAL_MVU_VERSION, createOfficialMvuBundleReader, readOfficialMvuBundle } from '../tavern-plugin/lib/domain/official-mvu-assets.js'
import { TAVERN_RUNTIME_ASSET_PREFIX, readTavernRuntimeAsset } from '../tavern-plugin/lib/domain/tavern-runtime-assets.js'
import { redactMvuLoadError } from '../tavern-plugin/lib/domain/mvu-diagnostics.js'

// Execute the registered production handler, not a second implementation of its catch path.
const source = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const start = source.indexOf('handler: async (req, res) => {', source.indexOf("const webServer = ctx.get('webServer')")) + 'handler: '.length
const end = source.indexOf("\n    }), 'dsh-tavern: web route')", start)
function route(overrides = {}) {
  return vm.runInNewContext('(' + source.slice(start, end).trim() + ')', {
    URL, Buffer, TAVERN_RELEASE_CAPABILITIES: { sceneImages: false }, OFFICIAL_MVU_VERSION,
    runtimeReadiness: Promise.resolve({ ok: true }), readOfficialMvuBundle, redactMvuLoadError, str: String,
    runtimeGeneration: 'test', TAVERN_RUNTIME_ASSET_PREFIX, readTavernRuntimeAsset, ...overrides
  })
}
async function request(handler, options = {}) {
  const response = {}
  await handler({ method: 'GET', url: OFFICIAL_MVU_VERSION.assetUrl, headers: { origin: 'null' }, ...options }, {
    writeHead(status, headers) { Object.assign(response, { status, headers }) },
    end(body) { response.body = body }
  })
  return response
}

test('MVU file failure returns uncached CORS-readable 503 JSON; restored file serves verified JS', async () => {
  const good = await readOfficialMvuBundle()
  let available = false
  const reader = createOfficialMvuBundleReader({ read: async () => {
    if (available) return good.body
    throw Error("ENOENT: open 'C:\\Users\\PRIVATE_USER\\bundle.js'; apiKey=SECRET_VALUE")
  } })
  const handler = route({ readOfficialMvuBundle: reader.read })
  const failed = await request(handler)
  assert.equal(failed.status, 503)
  assert.equal(failed.headers['Access-Control-Allow-Origin'], '*')
  assert.equal(failed.headers['Cache-Control'], 'no-store')
  assert.equal(failed.headers['X-Content-Type-Options'], 'nosniff')
  assert.match(failed.headers['Content-Type'], /^application\/json/)
  assert.equal(JSON.parse(failed.body).ok, false)
  assert.match(JSON.parse(failed.body).error, /ENOENT/)
  assert.doesNotMatch(failed.body, /PRIVATE_USER|SECRET_VALUE/)
  available = true
  const recovered = await request(handler)
  assert.equal(recovered.status, 200)
  assert.equal(recovered.headers['Content-Type'], good.mediaType)
  assert.equal(recovered.headers['Content-Length'], good.body.length)
  assert.deepEqual(recovered.body, good.body)
})

test('MVU readiness errors use 503 while existing RPC error envelope stays unchanged', async () => {
  const handler = route({ runtimeReadiness: Promise.resolve({ ok: false, error: Error('runtime startup failed') }) })
  const asset = await request(handler)
  assert.equal(asset.status, 503)
  assert.equal(JSON.parse(asset.body).error, 'runtime startup failed')
  const rpc = await request(handler, { url: '/api/dsh-tavern/test', method: 'POST', headers: {} })
  assert.equal(rpc.status, 200)
  assert.deepEqual(JSON.parse(rpc.body), { ok: false, error: 'runtime startup failed' })
})

test('固定脚本依赖从本地发布，不经过远程静态缓存', async () => {
  const handler = route({ runtimeReadiness: new Promise(() => {}) })
  const assets = [
    ['zod/index.mjs', /^text\/javascript/],
    ['vue/vue.runtime.global.prod.js', /^text\/javascript/],
    ['vue-router/vue-router.global.prod.js', /^text\/javascript/],
    ['jquery/jquery.min.js', /^text\/javascript/],
    ['jquery-ui/jquery-ui.min.js', /^text\/javascript/],
    ['jquery-ui-touch-punch/jquery.ui.touch-punch.min.js', /^text\/javascript/],
    ['lodash/lodash.min.js', /^text\/javascript/],
    ['tailwind/index.global.js', /^text\/javascript/],
    ['fontawesome/css/all.min.css', /^text\/css/],
    ['fontawesome/webfonts/fa-solid-900.woff2', /^font\/woff2/],
    ['jquery-ui/themes/base/theme.min.css', /^text\/css/],
    ['jquery-ui/themes/base/images/ui-icons_444444_256x240.png', /^image\/png/]
  ]
  for (const [path, mediaType] of assets) {
    const asset = await request(handler, {
      url: TAVERN_RUNTIME_ASSET_PREFIX + path,
      headers: { origin: 'null' }
    })
    assert.equal(asset.status, 200, path)
    assert.match(asset.headers['Content-Type'], mediaType, path)
    assert.equal(asset.headers['Access-Control-Allow-Origin'], '*', path)
    assert.ok(asset.body.length > 0, path)
  }
})

test('production RPC preserves Chinese snapshots and variable paths at every UTF-8 byte boundary', async () => {
  const payload = { sessionId: 's', expectedEntries: [{ content: '世界书𠮷🙂' }], variables: { stat_data: { 当前处境: '未改变' } } }
  const bytes = Buffer.from(JSON.stringify(payload))
  let calls = 0
  const handler = route({ dispatch: async (method, args) => {
    calls++
    assert.equal(method, 'updateTavernHelperVariables')
    assert.deepEqual(JSON.parse(JSON.stringify(args)), payload)
    return { updated: true }
  } })
  for (let split = 1; split < bytes.length; split++) {
    const result = await request(handler, { method: 'POST', url: '/api/dsh-tavern/updateTavernHelperVariables', headers: {},
      async *[Symbol.asyncIterator]() { yield bytes.subarray(0, split); yield bytes.subarray(split) }
    })
    assert.equal(JSON.parse(result.body).ok, true, 'split at byte ' + split + ': ' + result.body)
  }
  assert.equal(calls, bytes.length - 1)
})

test('RPC keeps malformed JSON rejection and scene-image byte limits before dispatch', async () => {
  let calls = 0
  const handler = route({ TAVERN_RELEASE_CAPABILITIES: { sceneImages: true }, dispatch: async () => { calls++; return {} } })
  const malformed = await request(handler, { method: 'POST', url: '/api/dsh-tavern/test', headers: {},
    async *[Symbol.asyncIterator]() { yield Buffer.from('{') }
  })
  assert.equal(malformed.status, 400)
  const large = await request(handler, { method: 'POST', url: '/api/dsh-tavern/generateSceneImage', headers: {},
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ text: '中'.repeat(6000) })) }
  })
  assert.equal(JSON.parse(large.body).ok, false)
  assert.match(JSON.parse(large.body).error, /生图请求过大/)
  assert.equal(calls, 0)
})
