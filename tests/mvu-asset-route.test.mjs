import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { OFFICIAL_MVU_VERSION, createOfficialMvuBundleReader, readOfficialMvuBundle } from '../tavern-plugin/lib/domain/official-mvu-assets.js'
import { redactMvuLoadError } from '../tavern-plugin/lib/domain/mvu-diagnostics.js'

// Execute the registered production handler, not a second implementation of its catch path.
const source = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const start = source.indexOf('handler: async (req, res) => {', source.indexOf("const webServer = ctx.get('webServer')")) + 'handler: '.length
const end = source.indexOf("\n    }), 'dsh-tavern: web route')", start)
function route(overrides = {}) {
  return vm.runInNewContext('(' + source.slice(start, end).trim() + ')', {
    URL, Buffer, TAVERN_RELEASE_CAPABILITIES: { sceneImages: false }, OFFICIAL_MVU_VERSION,
    runtimeReadiness: Promise.resolve({ ok: true }), readOfficialMvuBundle, redactMvuLoadError, str: String,
    runtimeGeneration: 'test', ...overrides
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
