// t11：0.2.0 桌面（宿主包在 app.asar 内）下，会话/子进程补丁的宿主包解析根选择。
//
// 真机取证（E:\Software\DeepSeek Harness\dsh-home\logs\tavern.log）：
//   dsh-tavern: 会话补丁未安装…：无法解析宿主 DSH 包：Cannot find module
//               '@deepseek-ai/dsh-session-persistence'
//   Require stack: - …\tavern-plugin\node_modules\@deepseek-ai\dsh-tools\lib\index.js
// 也就是旧实现从插件自己的 node_modules 闭包出发解析。这份用例把「候选顺序」钉死在纯函数
// 上（任何 Node 都跑），再用真机桌面证明第一个候选就是宿主自己用的那一棵、且保持同一性
// （需要 Electron Node 的 asar 支持，纯 Node 下 app.asar 内路径恒不可解析，故那一组跳过）。
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { defaultHostRequire, installHostSessionPatch } from '../tavern-plugin/lib/domain/host-session-patch.js'
import { installHostSubprocessPatch } from '../tavern-plugin/lib/domain/host-subprocess-patch.js'

const pluginDirectory = dirname(fileURLToPath(new URL('../tavern-plugin/package.json', import.meta.url)))

// 真机桌面的可执行文件与它注入给 Electron Node 子进程的入口（日志的 service.starting.entry）。
const desktopExecutable = process.env.TAVERN_DESKTOP_EXECUTABLE || 'E:/Software/DeepSeek Harness/DeepSeek Harness.exe'
const desktopBootstrap = process.env.DSH_DESKTOP_DSH_BOOTSTRAP
  || join(dirname(desktopExecutable), 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
const desktopResources = join(dirname(desktopExecutable), 'resources')
const desktopEnv = { DSH_DESKTOP_DSH_BOOTSTRAP: desktopBootstrap }
const desktopArgv = [desktopExecutable, desktopBootstrap]
// app.asar 内的路径在纯 Node 下 existsSync/require.resolve 恒失败，只有 Electron Node
// （ELECTRON_RUN_AS_NODE=1，真机宿主就是）能读；用一次目录读取判定当前运行时能不能跑这组断言。
const asarRuntime = (() => {
  try { readdirSync(join(desktopResources, 'app.asar', 'dsh')); return true } catch { return false }
})()
const desktopSkip = !existsSync(desktopExecutable)
  ? '测试机没有安装 0.2.0 桌面'
  : !asarRuntime ? '需要 Electron Node 的 app.asar 读写支持才能解析归档内宿主包' : false
const load = specifier => import(pathToFileURL(specifier).href)

const sessionNames = [
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-persistence',
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-session-query',
  '@deepseek-ai/dsh-session-format-catalog',
]

test('桌面：会话补丁从 asar 宿主根解析', { skip: desktopSkip }, async () => {
  const hostRequire = await defaultHostRequire(null, { env: desktopEnv, argv: desktopArgv })
  assert.match(hostRequire.resolve('@deepseek-ai/dsh-session/package.json'), /[\\/]app\.asar[\\/]dsh[\\/]node_modules[\\/]/)
})

test('同一性：宿主单例 instanceof asar 解析出的类，且重复解析落到同一份宿主包', { skip: desktopSkip }, async () => {
  const hostRequire = await defaultHostRequire(null, { env: desktopEnv, argv: desktopArgv })
  const { SessionPersistence } = await load(hostRequire.resolve('@deepseek-ai/dsh-session-persistence'))
  // 宿主正在使用的那一份就是这里解析出的那一份：否则补丁只改到副本，正文编辑对单例无效。
  const live = Object.create(SessionPersistence.prototype)
  assert.ok(live instanceof SessionPersistence)
  const again = await defaultHostRequire(live, { env: desktopEnv, argv: desktopArgv })
  assert.equal(again.resolve('@deepseek-ai/dsh-session-persistence'), hostRequire.resolve('@deepseek-ai/dsh-session-persistence'))
  // ESM 用解析后的真实文件路径做缓存键，所以两次 import 必须是同一个命名空间。
  assert.equal(await load(again.resolve('@deepseek-ai/dsh-session')), await load(hostRequire.resolve('@deepseek-ai/dsh-session')))
})

test('会话存储不属于候选宿主根时明确报「不是同一份」，不静默降级', { skip: desktopSkip }, async () => {
  // 桌面在、候选可解析，但传给补丁的 persistence 不是这份宿主构造的：必须报同一性错误。
  await assert.rejects(
    () => defaultHostRequire({}, { env: desktopEnv, argv: desktopArgv }),
    /解析到的宿主包与正在运行的会话存储不是同一份/,
  )
})

test('真机桌面：换用 asar 根后不再报「无法解析宿主 DSH 包」', { skip: desktopSkip }, async () => {
  const require = await defaultHostRequire(null, { env: desktopEnv, argv: desktopArgv })
  const { Context } = await load(require.resolve('@deepseek-ai/cordis'))
  const jsonl = await load(require.resolve('@deepseek-ai/dsh-session-persistence-jsonl'))
  const Jsonl = typeof jsonl.apply === 'function' ? jsonl : jsonl.default
  const ctx = new Context()
  try {
    await ctx.plugin(Jsonl, { root: mkdtempSync(join(tmpdir(), 'tavern-asar-host-patch-')), compression: 'none' })
    // query 传 null：0.2.0 的 SessionQueryEngine 需要等价宿主实例，这里只验证解析阶段。
    const handle = await installHostSessionPatch({ hostRequire: require, persistence: ctx.sessionPersistence, query: null })
    assert.match(handle.hostVersion, /^\d+\.\d+\.\d+/)
    assert.doesNotMatch(handle.reason, /无法解析宿主 DSH 包/)
    assert.notEqual(handle.status, 'skipped')
  } finally {
    await ctx.fiber.dispose()
  }
})

test('真机桌面：Windows 子进程补丁用 asar 根装得上、可回滚', { skip: desktopSkip || process.platform !== 'win32' }, async () => {
  const require = await defaultHostRequire(null, { env: desktopEnv, argv: desktopArgv })
  const { default: Local } = await load(require.resolve('@deepseek-ai/dsh-subprocess-local'))
  const original = Local.prototype.spawn
  const restore = await installHostSubprocessPatch({ hostRequire: require })
  try {
    assert.notEqual(Local.prototype.spawn, original, '补丁应当替换宿主单例的原型方法')
  } finally {
    restore()
  }
  assert.equal(Local.prototype.spawn, original)
})
