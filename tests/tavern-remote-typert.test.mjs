// t12：dsh-tavern-remote 的 typert 清单必须满足宿主 0.2.0-rc.2 的 strict codec 契约。
//
// 真机症状（E:\Software\DeepSeek Harness\dsh-home\logs\tavern.log 启动期）：
//   typert-loader: 1 typert contributor(s) failed to register
//   Error: typert-loader: dsh-tavern-remote invocation "dsh-tavern-remote#tavernSignals/control"
//          parameter codec has no create() factory
//
// 契约差异（asar 内 0.2.0-rc.2 的实现）：dsh-typert-loader 的 requireStrictCodec
// （lib/index.js:206-212）与 dsh-typert-registry 的 validateCodec（lib/index.js:562-566）都要求
// 每个 strict codec 提供 create() 工厂；0.1.2-rc.1 的生成器输出的是 `schema: <zod 实例>`，
// 于是整份清单被拒、dsh-tavern-remote 整行不激活（伴生 `dsh: warning: 1 entry did not activate`）。
// 本用例把新契约钉在生成产物上，并（宿主可读 app.asar 时）用宿主真实的 validateTypertManifest 复核。
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const remoteDirectory = dirname(fileURLToPath(new URL('../tavern-plugin/packages/dsh-tavern-remote/package.json', import.meta.url)))
const load = name => import(pathToFileURL(join(remoteDirectory, 'lib', name)).href)

// 真机桌面：0.2.0 的 typert-loader 只在 <resources>\app.asar 内，纯 Node 读不了，
// 因此那一组断言只在能读归档的运行时（Electron Node）里跑。
const desktopExecutable = process.env.TAVERN_DESKTOP_EXECUTABLE || 'E:/Software/DeepSeek Harness/DeepSeek Harness.exe'
const desktopResources = join(dirname(desktopExecutable), 'resources')
const asarRuntime = (() => {
  try { readdirSync(join(desktopResources, 'app.asar', 'dsh')); return true } catch { return false }
})()
const desktopSkip = !existsSync(desktopExecutable)
  ? '测试机没有安装 0.2.0 桌面'
  : !asarRuntime ? '需要 Electron Node 的 app.asar 读写支持才能加载宿主 typert-loader' : false

function codecsOf(invocation) {
  const codecs = []
  for (const parameter of invocation.parameters || []) codecs.push([`parameter ${parameter.name}`, parameter.codec])
  if (invocation.result !== undefined) codecs.push(['result', invocation.result])
  if (invocation.uplink !== undefined) codecs.push(['uplink', invocation.uplink.codec])
  if (invocation.invocation?.codec !== undefined) codecs.push(['Context', invocation.invocation.codec])
  return codecs
}

test('宿主面清单满足 0.2.0 strict codec 契约：create() 工厂而非 0.1.2 的 schema', async () => {
  const { TYPERT } = await load('typert.host.js')
  assert.equal(TYPERT.package, 'dsh-tavern-remote')
  assert.equal(TYPERT.face, 'host')
  assert.deepEqual(TYPERT.schemas, [])
  for (const key of ['services', 'events', 'objects']) assert.ok(Array.isArray(TYPERT.model[key]), `TYPERT.model.${key} 必须是数组`)
  assert.ok(TYPERT.invocations.length >= 2)
  for (const invocation of TYPERT.invocations) {
    for (const key of ['id', 'service', 'namespace', 'method']) assert.equal(typeof invocation[key], 'string', `${invocation.id} 缺少 ${key}`)
    assert.ok(invocation.id.length > 0 && invocation.service.length > 0 && invocation.namespace.length > 0 && invocation.method.length > 0)
    assert.deepEqual(invocation.invocation, { kind: 'direct' })
    assert.deepEqual(invocation.cancellation, { parameter: 'signal' })
    assert.equal(invocation.mode, 'stream')
    const wires = new Set()
    for (const parameter of invocation.parameters) {
      assert.equal(parameter.source, 'json')
      assert.ok(parameter.name.length > 0 && parameter.wire.length > 0)
      assert.ok(!wires.has(parameter.wire), `${invocation.id} 重复 wire：${parameter.wire}`)
      wires.add(parameter.wire)
      assert.equal(parameter.lookup, undefined)
    }
    assert.equal(typeof invocation.sourceLocation.file, 'string')
    for (const key of ['line', 'column']) assert.ok(Number.isInteger(invocation.sourceLocation[key]) && invocation.sourceLocation[key] > 0)
    for (const [subject, codec] of codecsOf(invocation)) {
      // 这两条正是 0.2.0 loader/registry 的 requireStrictCodec / validateCodec。
      assert.equal(codec.mode, 'strict', `${invocation.id} ${subject} 必须用 strict codec`)
      assert.ok(typeof codec.typeSymbol === 'string' && codec.typeSymbol.length > 0, `${invocation.id} ${subject} 缺少 typeSymbol`)
      assert.equal(typeof codec.create, 'function', `${invocation.id} ${subject} 缺少 create() 工厂`)
      assert.equal(codec.schema, undefined, `${invocation.id} ${subject} 仍带 0.1.2 的 schema 字段`)
    }
  }
})

test('codec 工厂可重复调用、返回同一份可用 schema，并与宿主侧枚举一致', async () => {
  const { TYPERT } = await load('typert.host.js')
  const control = TYPERT.invocations.find(invocation => invocation.id === 'dsh-tavern-remote#tavernSignals/control')
  assert.ok(control, 'control 调用必须存在')
  const [methodCodec, argsCodec] = control.parameters.map(parameter => parameter.codec)
  const methodSchema = methodCodec.create()
  assert.equal(methodCodec.create(), methodSchema, 'create() 应当记忆化（同一份 schema 实例）')
  for (const method of ['claimTavernScriptWork', 'startTavernScriptWork', 'getTavernScriptWorkState', 'heartbeatTavernScriptRuntime', 'completeTavernHelperEvent', 'releaseTavernHelperRuntime']) {
    assert.equal(methodSchema.safeParse(method).success, true, `control 应当接受 ${method}`)
  }
  assert.equal(methodSchema.safeParse('notATavernMethod').success, false)
  const argsSchema = argsCodec.create()
  assert.equal(argsSchema.safeParse({ count: 1, nested: { ok: true }, list: [1, 'x', null] }).success, true)
  assert.equal(argsSchema.safeParse('not-an-object').success, false)
  assert.equal(control.result.create().safeParse('result-text').success, true)
  assert.equal(control.result.create().safeParse(42).success, false)
})

test('客户端面清单同样携带 create() 工厂，且与宿主面声明一致', async () => {
  const { TYPERT } = await load('typert.host.js')
  const { TYPERT_REMOTE } = await load('typert.remote-client.js')
  assert.equal(TYPERT_REMOTE.package, 'dsh-tavern-remote')
  assert.ok(Array.isArray(TYPERT_REMOTE.descriptors))
  for (const descriptor of TYPERT_REMOTE.descriptors) {
    // @deepseek-ai/dsh-api-gateway/client 的 requireStrictInputs 只认 mode:'strict'。
    for (const [subject, codec] of codecsOf(descriptor)) {
      assert.equal(codec.mode, 'strict', `${descriptor.id} ${subject} 必须用 strict codec`)
      assert.equal(typeof codec.create, 'function', `${descriptor.id} ${subject} 缺少 create() 工厂`)
      assert.equal(codec.schema, undefined, `${descriptor.id} ${subject} 仍带 0.1.2 的 schema 字段`)
    }
  }
  const hostIds = TYPERT.invocations.map(invocation => invocation.id).sort()
  const clientIds = TYPERT_REMOTE.descriptors.map(descriptor => descriptor.id).sort()
  assert.deepEqual(clientIds, hostIds, '两侧必须声明同一组调用')
  for (const client of TYPERT_REMOTE.descriptors) {
    const host = TYPERT.invocations.find(invocation => invocation.id === client.id)
    assert.deepEqual(client.parameters.map(parameter => parameter.wire), host.parameters.map(parameter => parameter.wire))
    assert.deepEqual(client.cancellation, host.cancellation)
  }
})

test('目标宿主真实的 validateTypertManifest 接受该清单', { skip: process.env.DSH_BOOT_MODULE ? false : desktopSkip }, async () => {
  const require = createRequire(process.env.DSH_BOOT_MODULE || join(desktopResources, 'app.asar', 'dsh', 'package.json'))
  const loader = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-loader')).href)
  const { TYPERT } = await load('typert.host.js')
  // 真机日志里抛错的就是这个函数；它不再抛错即表示 dsh-tavern-remote 能注册成功。
  loader.validateTypertManifest('dsh-tavern-remote', TYPERT)
})

// 真机症状（桌面 profile 的酒馆页面 3081，2026-10-16）：网页启动审计报
//   web boot: 2 entries did not activate
//   dsh-tavern-remote: failed
//   dsh-tavern-plugin: pending (waiting for service: tavernSessionSignals)
// 原因是客户端半边 lib/client.js 是 tsdown 构建产物，内嵌的是「构建那一刻」的清单副本：
// lib/typert.remote-client.js 重新生成过、bundle 没重建时，浏览器里 $mount() 仍拿到 0.1.2 的
// `schema:` 清单，被 dsh-typert-registry/lib/client.js 的 validateCodec 拒掉，整行不激活。
// 上面的用例只读生成文件，抓不到这种产物滞后；这里按客户端 ModuleLoader 的方式真正物化 bundle，
// 跑一遍 apply() 并从 $mount 取回内嵌清单复核。
test('客户端 bundle 内嵌清单带 create() 工厂，且与生成的客户端清单一致', async () => {
  const bundle = readFileSync(join(remoteDirectory, 'lib', 'client.js'), 'utf8')
  let captured
  new Function('window', bundle)({ __ModuleLoader__: { load: definition => { captured = definition } } })
  assert.equal(captured?.id, 'dsh-tavern-remote', 'bundle 必须以 dsh-tavern-remote 注册到 ModuleLoader')

  class RemoteStreamCarrierError extends Error {}
  class RemoteSnapshotStream {
    constructor(stream, options) { this.stream = stream; this.options = options }
    async start() {}
    async dispose() {}
  }
  const require = id => {
    if (id === '@deepseek-ai/dsh-api-gateway/client') return { RemoteSnapshotStream, RemoteStreamCarrierError }
    if (id === '@deepseek-ai/cordis') return {}
    throw new Error(`客户端 bundle 请求了未声明的外部模块：${id}`)
  }
  const plugin = captured.factory(require)
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(plugin.inject, ['remote'])

  const mounted = []
  const provided = []
  const ctx = {
    remote: {
      async $mount(manifest) { mounted.push(manifest); return async () => {} },
      $stream: () => ({ start() {}, dispose: async () => {} }),
    },
    get: key => key === 'remote.tavernSignals'
      ? { follow: async function* () {}, control: async function* () { yield '{}' } }
      : undefined,
    provide: (key, value) => { provided.push(key); return () => {} },
    on: () => () => {},
    effect: () => () => {},
  }
  const dispose = await plugin.apply(ctx)
  assert.deepEqual(provided, ['tavernSessionSignals'], '客户端半边必须提供 tavernSessionSignals，否则 dsh-tavern-plugin 永远 pending')
  assert.equal(mounted.length, 1)
  await dispose()

  const embedded = mounted[0]
  assert.equal(embedded.package, 'dsh-tavern-remote')
  for (const descriptor of embedded.descriptors) {
    for (const [subject, codec] of codecsOf(descriptor)) {
      assert.equal(codec.mode, 'strict', `${descriptor.id} ${subject} 必须用 strict codec`)
      assert.equal(typeof codec.create, 'function', `${descriptor.id} ${subject} 缺少 create() 工厂（bundle 未重建？）`)
      assert.equal(codec.schema, undefined, `${descriptor.id} ${subject} 仍带 0.1.2 的 schema 字段（bundle 未重建？）`)
    }
  }
  const { TYPERT_REMOTE } = await load('typert.remote-client.js')
  const normalize = value => JSON.stringify(value, (key, item) => typeof item === 'function' ? '[fn]' : item)
  assert.equal(normalize(embedded), normalize(TYPERT_REMOTE), 'bundle 内嵌清单必须与 lib/typert.remote-client.js 一致')
})
