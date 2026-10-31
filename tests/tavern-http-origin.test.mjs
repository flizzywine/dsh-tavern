import test from 'node:test'
import assert from 'node:assert/strict'
import { registerTavernHttpRoutes } from '../tavern-plugin/lib/http/routes.js'
import {createTavernClientAssets} from '../tavern-plugin/lib/domain/tavern-client-assets.js'
import {registerStageClientAssets} from '../tavern-plugin/packages/dsh-tavern-stage/lib/client-assets.js'

// 只为了拿到 handleTavernRequest：registerTavernHttpRoutes 在没有 webServer 时
// 只做一次 exposeHandler 回调，不注册任何路由，也不读取其它依赖。
function handle(clientAssets) {
  let handler
  // every HTTP request passes the host Connection first (routes.js); this one admits all.
  const ctx = { get: name => name === 'connection' ? { requestRejection: () => undefined, trustedHosts: [] } : undefined, effect: () => {} }
  registerTavernHttpRoutes({
    ctx,
    clientAssets,
    dispatch: async () => {},
    fileResources: {}, helperHistoryAccess: {}, mobileCardImport: {},
    performanceDiagnostics: {}, runtimeGeneration: 1, runtimeReadiness: {},
    sceneIllustrations: {}, readPluginMediaFile: async () => {},
    pluginAssets: {}, sessionResources: { read: async () => '{}' },
    str: String, tavernRemoteAssets: {}, tavernStaticResources: {},
    castAssets: {}, assetLibrary: undefined, speech: {},
    exportCardFile: async () => {}, assetPacks: {}, uploads: {},
    exposeHandler: (fn) => { handler = fn },
  })
  return handler
}

function capture() {
  const res = { status: 0, headers: {}, body: '' }
  res.writeHead = (status, headers) => { res.status = status; if (headers) res.headers = headers }
  res.end = (body) => { res.body = body === undefined ? '' : String(body) }
  return res
}

async function call(handler, { origin, host, method = 'GET', url = '/api/dsh-tavern/runtime-generation' }) {
  const res = capture()
  const headers = {}
  if (host !== undefined) headers.host = host
  if (origin !== undefined) headers.origin = origin
  await handler({ method, url, headers }, res)
  return res
}

const PUBLIC = 'noval-wang.kutina.cn'

test('反向代理下同源 Origin 放行：Origin 与请求 Host 一致时不再 403', async () => {
  const handler = handle()
  // 隧道/反代场景：浏览器发 Origin=https://<公网域名>，Host 也是该域名。
  const res = await call(handler, { host: PUBLIC, origin: `https://${PUBLIC}` })
  assert.equal(res.status, 200, '同源 Origin 不应被 Origin 围栏拦下')
  assert.match(res.body, /runtimeGeneration|ok/)
})

test('空 Origin 仍然放行；其它主机的 loopback Origin 不算同源', async () => {
  const handler = handle()
  for (const origin of [undefined, '']) {
    const res = await call(handler, { host: PUBLIC, origin })
    assert.equal(res.status, 200, `Origin=${String(origin)} 应保持放行`)
  }
  for (const origin of ['http://127.0.0.1:3081', 'http://localhost:3081']) {
    assert.equal((await call(handler, { host: PUBLIC, origin })).status, 403, `Origin=${origin} 与 Host 不同源`)
  }
})

test('跨站 Origin 仍然被拒绝，放行范围没有被放宽', async () => {
  const handler = handle()
  for (const origin of [
    'https://evil.example.com',
    'https://noval-wang.kutina.cn.evil.example.com',
    'http://noval-wang.kutina.cn.attacker.test',
  ]) {
    const res = await call(handler, { host: PUBLIC, origin })
    assert.equal(res.status, 403, `Origin=${origin} 必须仍被拒绝`)
    assert.equal(res.body, 'forbidden')
  }
})

test('Origin 端口与 Host 不匹配时仍拒绝', async () => {
  const handler = handle()
  const res = await call(handler, { host: PUBLIC, origin: `https://${PUBLIC}:8443` })
  assert.equal(res.status, 403, '端口不同不算同源')
})

test('代理终止 TLS 时同 Host 的 HTTP / HTTPS 都可通过来源检查，null 不可通过', async () => {
  for (const scheme of ['http', 'https']) {
    assert.equal((await call(handle(), { host: PUBLIC, origin: `${scheme}://${PUBLIC}` })).status, 200)
  }
  assert.equal((await call(handle(), { host: PUBLIC, origin: 'null' })).status, 403)
  assert.equal((await call(handle(), { host: '127.0.0.1:3081', origin: `https://${PUBLIC}` })).status, 403)
})

function externalRoutes(connection) {
  let external, internal, calls = 0
  const webServer = { register(route) { external = route.handler; return () => {} } }
  registerTavernHttpRoutes({
    ctx: { get: name => ({ webServer, connection })[name], effect: fn => fn() },
    performanceDiagnostics: { http() {} }, runtimeReadiness: { ok: true }, runtimeGeneration: 1,
    dispatch: async () => { calls++; return {} }, str: String,
    fontLibrary: { serve: async () => false }, // unrelated asset route adapter
    sessionResources: { read: async cap => { if (cap !== 'valid') throw Error('denied'); return '{}' } },
    exposeHandler: fn => { internal = fn },
  })
  return { external, internal, calls: () => calls }
}

async function operation(handler, headers = {}, url = '/api/dsh-tavern/changeSetting') {
  const res = capture()
  await handler({ method: 'POST', url, headers: { host: PUBLIC, ...headers },
    async *[Symbol.asyncIterator]() { yield Buffer.from('{}') }
  }, res)
  return res
}

test('HTTP 操作遵守 DSH 登录和可信 Host 拒绝结果，鉴权前不派发操作', async () => {
  let rejection = 401, checked
  const routes = externalRoutes({ requestRejection(req) { checked = req; return rejection } })
  for (const origin of [undefined, `https://${PUBLIC}`]) {
    const res = await operation(routes.external, origin ? { origin } : {})
    assert.equal(res.status, 401)
    assert.equal(routes.calls(), 0)
    assert.equal(checked.headers.host, PUBLIC)
  }
  rejection = 403
  assert.equal((await operation(routes.external)).status, 403)
  assert.equal(routes.calls(), 0)
  rejection = undefined
  assert.equal((await operation(routes.external, { origin: `https://${PUBLIC}`, cookie: 'host-session' })).status, 200)
  assert.equal(checked.headers.cookie, 'host-session')
  assert.equal(routes.calls(), 1)
  assert.equal((await operation(routes.external, { origin: 'null' })).status, 403)
  assert.equal(routes.calls(), 1)
})

// in-process calls go through the same Connection check, so they fail closed too.
test('鉴权服务缺失时 HTTP 与进程内调用都失败关闭', async () => {
  const routes = externalRoutes(undefined)
  assert.equal((await operation(routes.external)).status, 503)
  assert.equal((await operation(routes.internal)).status, 503)
  assert.equal(routes.calls(), 0)
})

test('沙箱资源仍凭能力票据访问，不要求主页面登录 Cookie', async () => {
  // cookie-free capability reads pass the Host fence (trustedHosts) instead of the session check.
  const routes = externalRoutes({ trustedHosts: [PUBLIC], requestRejection: () => { throw Error('must not check session') } })
  for (const [cap, expected] of [['valid', 200], ['invalid', 403]]) {
    assert.equal((await call(routes.external, { host: PUBLIC, origin: 'null', url: `/api/dsh-tavern/session-resource?cap=${cap}` })).status, expected)
  }
  assert.equal(routes.calls(), 0)
})


test('舞台脚本 HTTP 资源仅在插件注册期间可用，保留旧 URL', async () => {
  const registry = createTavernClientAssets(), handler = handle(registry)
  const request = {host:'localhost:3081', origin:'http://localhost:3081', url:'/api/dsh-tavern/client-assets/skin-overlay.mjs'}
  assert.equal((await call(handler, request)).status, 404)
  const stop = registerStageClientAssets(registry)
  const loaded = await call(handler, request)
  assert.equal(loaded.status, 200)
  assert.equal(loaded.headers['Content-Type'], 'text/javascript; charset=utf-8')
  assert.match(loaded.body, /createSkinOverlayPlayer/)
  stop()
  assert.equal((await call(handler, request)).status, 404)
})
