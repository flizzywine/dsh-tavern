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
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { hostRequireCandidates, desktopLauncherEntry } from '../tavern-plugin/lib/domain/host-package-resolution.js'
import { defaultHostRequire, installHostSessionPatch, PINNED_SHA256, SESSION_PATCH_VERSION } from '../tavern-plugin/lib/domain/host-session-patch.js'
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

test('宿主包解析根按「归档宿主 → 启动器入口 → 插件闭包」排序，且不做混装', async () => {
  const { resolvable, candidates } = hostRequireCandidates({
    names: sessionNames,
    env: desktopEnv,
    argv: ['node.exe', join(pluginDirectory, 'lib', 'index.js')],
  })
  assert.deepEqual(candidates.map(candidate => candidate.label), [
    'desktop-archive-host',
    'launcher-entry',
    'resources-app',
    'resources-app-unpacked',
    'plugin-package',
  ])
  assert.equal(candidates[0].anchor, join(desktopResources, 'app.asar', 'dsh', 'package.json'))
  assert.equal(candidates.at(-1).anchor, join(pluginDirectory, 'package.json'))
  if (asarRuntime) {
    // 能解析全部包的只有桌面宿主自己的两个锚点；插件闭包缺 dsh-session-persistence /
    // -jsonl / -query / -format-catalog，必须被 resolvable 过滤掉 —— 那正是真机日志里
    // throw 的那份闭包。
    assert.deepEqual(resolvable.map(candidate => candidate.label), ['desktop-archive-host', 'launcher-entry'])
    const pluginCandidate = candidates.at(-1)
    assert.equal(pluginCandidate.label, 'plugin-package')
    assert.ok(!resolvable.includes(pluginCandidate), '插件闭包不得作为宿主根')
    for (const name of sessionNames) {
      assert.match(resolvable[0].require.resolve(name),
        /[\\/]app\.asar[\\/]dsh[\\/]node_modules[\\/]@deepseek-ai[\\/]/, name)
    }
  }
})

test('没有桌面入口时不凭空造出宿主根，只剩启动器入口与插件闭包', () => {
  const { candidates, resolvable } = hostRequireCandidates({
    names: ['@deepseek-ai/dsh-tools'],
    env: {},
    argv: ['node.exe', join(pluginDirectory, 'lib', 'index.js')],
  })
  assert.deepEqual(candidates.map(candidate => candidate.label), ['launcher-entry', 'plugin-package'])
  assert.ok(!candidates.some(candidate => candidate.label.startsWith('desktop-archive')))
  assert.deepEqual(resolvable.map(candidate => candidate.label), ['launcher-entry', 'plugin-package'])
})

test('入口是归档旁解包形态（app.asar.unpacked）时归一到同一个宿主根', () => {
  const unpackedEntry = desktopBootstrap.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  assert.notEqual(unpackedEntry, desktopBootstrap)
  const { candidates } = hostRequireCandidates({ names: sessionNames, env: { DSH_DESKTOP_DSH_BOOTSTRAP: unpackedEntry }, argv: ['node.exe'] })
  assert.equal(candidates[0].label, 'desktop-archive-host')
  assert.equal(candidates[0].anchor, join(desktopResources, 'app.asar', 'dsh', 'package.json'))
})

test('desktopLauncherEntry 优先用宿主注入的入口，临时探针脚本不推导 resources 根', () => {
  assert.equal(desktopLauncherEntry({ env: desktopEnv, argv: ['x', 'C:/tmp/probe.mjs'] }), desktopBootstrap)
  const { candidates, resolvable } = hostRequireCandidates({
    names: ['@deepseek-ai/dsh-tools'],
    env: {},
    argv: ['DeepSeek Harness.exe', 'C:/tmp/probe.mjs'],
  })
  assert.deepEqual(candidates.map(candidate => candidate.label), ['launcher-entry', 'plugin-package'])
  assert.equal(resolvable.at(-1).label, 'plugin-package')
})

test('0.2.0 桌面：会话补丁从 asar 宿主根解析，引脚文件逐字节命中', { skip: desktopSkip }, async () => {
  const hostRequire = await defaultHostRequire(null, { env: desktopEnv, argv: desktopArgv })
  assert.match(hostRequire.resolve('@deepseek-ai/dsh-session/package.json'), /[\\/]app\.asar[\\/]dsh[\\/]node_modules[\\/]/)
  const manifest = JSON.parse(readFileSync(hostRequire.resolve('@deepseek-ai/dsh-session/package.json'), 'utf8'))
  assert.equal(manifest.version, SESSION_PATCH_VERSION)
  for (const [name, allowed] of Object.entries(PINNED_SHA256)) {
    const actual = createHash('sha256').update(readFileSync(hostRequire.resolve(name))).digest('hex')
    assert.ok(allowed.includes(actual), `${name} 与 ${SESSION_PATCH_VERSION} 引脚表不一致：${actual}`)
  }
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

test('宿主包解析失败时 installHostSessionPatch 走 failed 而不是静默 skipped', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'tavern-empty-anchor-'))
  writeFileSync(join(empty, 'package.json'), JSON.stringify({ name: 'empty-fixture', private: true }))
  const { candidates, resolvable } = hostRequireCandidates({
    names: sessionNames,
    env: {},
    argv: ['node.exe', join(empty, 'package.json')],
    pluginAnchor: join(empty, 'package.json'),
  })
  assert.deepEqual(candidates.map(candidate => candidate.label), ['plugin-package'])
  assert.deepEqual(resolvable, [])
  // 真机日志里的失败形态：宿主包解析不出来时必须是 failed，不能落到 skipped。
  const failed = await installHostSessionPatch({
    hostRequire: { resolve() { throw new Error("Cannot find module '@deepseek-ai/dsh-session-persistence'") } },
    persistence: null,
    query: null,
  })
  assert.equal(failed.status, 'failed')
  assert.notEqual(failed.status, 'skipped')
  assert.equal(failed.view().ready, false)
  assert.match(failed.reason, /Cannot find module '@deepseek-ai\/dsh-session-persistence'/)
})

test('真机桌面：换用 asar 根后补丁走到版本闸，不再报「无法解析宿主 DSH 包」', { skip: desktopSkip }, async () => {
  const require = await defaultHostRequire(null, { env: desktopEnv, argv: desktopArgv })
  const { Context } = await load(require.resolve('@deepseek-ai/cordis'))
  // 0.2.1-rc.2：JSONL 后端改成 cordis 插件模块（apply/Config），不再 default 导出实现类。
  const jsonlModule = await load(require.resolve('@deepseek-ai/dsh-session-persistence-jsonl'))
  const Jsonl = jsonlModule.default ?? jsonlModule
  const ctx = new Context()
  try {
    await ctx.plugin(Jsonl, { root: mkdtempSync(join(tmpdir(), 'tavern-asar-host-patch-')), compression: 'none' })
    // query 传 null：0.2.0 的 SessionQueryEngine 需要等价宿主实例，这里只验证解析阶段。
    const handle = await installHostSessionPatch({ hostRequire: require, persistence: ctx.sessionPersistence, query: null })
    assert.equal(handle.hostVersion, SESSION_PATCH_VERSION)
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

test('CLI 无扩展名启动链接从真实运行时解析宿主包', { skip: process.platform === 'win32' }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'tavern-cli-host-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const entry = join(root, 'runtime/lib/node_modules/@deepseek-ai/dsh/lib/bin.js')
  const session = join(root, 'runtime/lib/node_modules/@deepseek-ai/dsh-session/index.js')
  for (const file of [entry, session]) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, 'module.exports = {}')
  }
  const launcher = join(root, 'runtime/bin/dsh')
  mkdirSync(dirname(launcher), { recursive: true })
  symlinkSync(entry, launcher)
  const { resolvable } = hostRequireCandidates({ names: ['@deepseek-ai/dsh-session'],
    env: {}, argv: ['node', launcher], pluginAnchor: join(root, 'plugin/package.json') })
  assert.equal(resolvable[0]?.label, 'launcher-entry')
  assert.equal(resolvable[0].require.resolve('@deepseek-ai/dsh-session'), realpathSync(session))
})
