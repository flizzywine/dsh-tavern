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
