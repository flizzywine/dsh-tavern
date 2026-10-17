import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { EventEmitter } from 'node:events'
import test, { beforeEach, afterEach, mock } from 'node:test'

import { createApplicationUpdater as createUpdater } from '../tavern-plugin/lib/application-updater.js'

// Never let fixtures accidentally consume a real release. Local HTTP fixtures
// still exercise the production fetch path; every other request fails the test,
// even if the updater catches the error and falls back to another source.
const nativeFetch = globalThis.fetch
let unexpectedRequests = []
beforeEach(() => {
  unexpectedRequests = []
  mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return nativeFetch(input, init)
    unexpectedRequests.push(url.origin + url.pathname)
    throw new Error('External network is disabled in updater tests')
  })
})
afterEach(() => {
  mock.restoreAll()
  assert.deepEqual(unexpectedRequests, [], '更新器测试必须显式模拟远端请求')
})

function createApplicationUpdater(options) {
  return createUpdater({
    // Most fixtures model a direct child; Windows broker fixtures opt in below.
    platform: 'linux', dshHome: options.sourceRoot,
    // CDN fallback is explicit in each fixture; never fetch live metadata.
    fetchCdnMetadata: async () => { throw new Error('CDN unavailable in GitHub fixture') },
    ...options,
  })
}

const knownIdentity = { currentVersion: '1.1.0', currentCommit: 'a'.repeat(40) }
const verifiedUpdate = {
  readLocalIdentity: async () => knownIdentity,
  fetchManifest: async () => ({ version: '1.1.0' }),
  fetchLatestCommit: async () => 'b'.repeat(40),
  compareCommits: async () => 'ahead',
}

test('真实 Git 历史可离线识别新旧，包括 archive 安装的 bare source-cache', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-order-git-'))
  try {
    const repo = path.join(root, 'repo')
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    git('init', repo)
    git('-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'old')
    const old = git('-C', repo, 'rev-parse', 'HEAD')
    git('-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'new')
    const recent = git('-C', repo, 'rev-parse', 'HEAD')
    const dshHome = path.join(root, 'dsh')
    await mkdir(path.join(dshHome, 'source-cache'), { recursive: true })
    git('clone', '--bare', repo, path.join(dshHome, 'source-cache/dsh-tavern.git'))
    for (const sourceRoot of [repo, root]) {
      for (const [currentCommit, latestCommit, expected] of [[old, recent, 'update-available'], [recent, old, 'up-to-date']]) {
        const updater = createApplicationUpdater({
          dataRoot: path.join(root, 'data'), sourceRoot, dshHome, runtimeHost: 'desktop',
          readLocalIdentity: async () => ({ currentVersion: '1.1.0', currentCommit }),
          fetchManifest: async () => ({ version: '1.1.0' }), fetchLatestCommit: async () => latestCommit,
          compareUrl: 'http://127.0.0.1:1/no-network-expected',
          fetchCdnMetadata: async () => { throw new Error('no fallback expected') },
        })
        assert.equal((await updater.check()).phase, expected)
      }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('GitHub 路径的较高版本号不能绕过提交先后判断，未知本地构建不能盲目安装', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-order-version-'))
  try {
    const common = {
      ...verifiedUpdate, dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'desktop',
      fetchManifest: async () => ({ version: '99.0.0' }), compareCommits: async () => 'behind',
      spawnProcess() { assert.fail('不能启动安装') },
    }
    assert.equal((await createApplicationUpdater(common).start()).phase, 'up-to-date')
    const unknown = createApplicationUpdater({ ...common, readLocalIdentity: async () => ({ currentVersion: 'unknown', currentCommit: '' }) })
    assert.equal((await unknown.check()).phase, 'check-failed')
    await assert.rejects(() => unknown.start(), /尚未开始下载/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

for (const source of ['github']) {
  for (const relation of ['behind', 'diverged', 'unavailable', 'ahead']) {
    test(`${source} 根据提交先后判断更新：${relation}，检查和安装使用同一保护`, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-update-order-'))
      try {
        const currentCommit = '59aabc3ac90055e017065fceb1d0855fc94ad60e'
        const latestCommit = '5f68b3423908a593239a19e07359cef5d53aaaab'
        await writeFile(path.join(root, 'package.json'), '{"version":"1.1.0"}')
        let spawned = 0
        const updater = createApplicationUpdater({
          dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'desktop',
          readLocalIdentity: async () => ({ currentVersion: '1.1.0', currentCommit }),
          fetchManifest: async () => {
            if (source === 'jsdelivr') throw new Error('offline')
            return { version: '1.1.0' }
          },
          fetchLatestCommit: async () => latestCommit,
          fetchCdnMetadata: async () => {
            if (source === 'github') throw new Error('offline')
            return { revision: latestCommit, files: [{ path: 'package.json', sha256: 'a'.repeat(64) }] }
          },
          compareCommits: async (current, latest) => {
            assert.equal(current, currentCommit)
            assert.equal(latest, latestCommit)
            if (relation === 'unavailable') throw new Error('无法确认提交先后')
            return relation
          },
          spawnProcess() { spawned += 1; return { unref() {} } },
        })
        const checked = await updater.check()
        assert.equal(checked.phase, relation === 'ahead' ? 'update-available' : relation === 'behind' ? 'up-to-date' : 'check-failed')
        if (relation === 'unavailable' || relation === 'diverged') {
          await assert.rejects(() => updater.start(), /尚未开始下载/)
        } else {
          assert.equal((await updater.start()).phase, relation === 'ahead' ? 'running' : 'up-to-date')
        }
        assert.equal(spawned, relation === 'ahead' ? 1 : 0)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  }
}

test('jsDelivr 发布序号阻止缓存倒退，并允许无 GitHub 更新', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-cdn-'))
  try {
    const packageText = JSON.stringify({ version: '0.7.2' })
    await writeFile(path.join(root, 'package.json'), packageText)
    await writeFile(path.join(root, 'dsh-tavern-runtime.json'), JSON.stringify({
      schemaVersion: 2, revision: 'a'.repeat(40), releaseSequence: 42, version: '0.7.2',
      files: [{ path: 'package.json', sha256: createHash('sha256').update(packageText).digest('hex') }],
    }))
    const metadata = {
      schemaVersion: 2, revision: '9'.repeat(40), releaseSequence: 43, version: '0.7.2',
      files: [{ path: 'package.json', sha256: createHash('sha256').update(packageText).digest('hex') }],
    }
    const common = {
      dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli',
      fetchManifest: async () => { throw new Error('fetch failed') },
      fetchLatestCommit: async () => { throw new Error('fetch failed') },
      fetchCdnMetadata: async () => metadata,
      compareCommits: async () => { throw new Error('GitHub 不应参与 CDN 发布序号判断') },
      now: () => 321,
    }
    const current = await createApplicationUpdater(common).check()
    assert.equal(current.phase, 'up-to-date')
    assert.match(current.checkWarning, /缓存延迟/)

    metadata.files[0].sha256 = createHash('sha256').update('new package').digest('hex')
    metadata.releaseSequence = 41
    assert.equal((await createApplicationUpdater(common).check()).phase, 'up-to-date')

    metadata.releaseSequence = 43
    const child = { pid: 4321, once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() {} }
    let launchCwd
    const home = path.join(root, 'home')
    const changed = await createApplicationUpdater({ ...common, dshHome: home, platform: 'linux', spawnProcess(_command, _args, options) { launchCwd = options.cwd; return child } }).start()
    assert.equal(changed.phase, 'running')
    assert.equal(launchCwd, home, '更新链不能以被替换的程序目录作为工作目录（Windows 会 EBUSY）')
    assert.equal(changed.checkSource, 'jsdelivr')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('更新诊断跨检查保留回退和网络原因，并可在重启后读取', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-update-diagnostics-'))
  try {
    const networkError = () => Object.assign(new Error('fetch failed https://user:secret@example.test/meta?token=secret'), { cause: Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' }) })
    const options = { dataRoot: root, sourceRoot: root, runtimeHost: 'desktop', ...verifiedUpdate,
      fetchCdnMetadata: async () => { throw new Error('清单缺少发布序号') },
      fetchManifest: async () => { throw networkError() },
    }
    const updater = createApplicationUpdater({ ...options, fetchLatestCommit: async () => { throw networkError() } })
    assert.equal((await updater.check()).phase, 'check-failed')
    // raw.githubusercontent.com blocked alone only loses the version label (#125).
    const recovered = createApplicationUpdater(options)
    const checked = await recovered.check()
    assert.equal(checked.phase, 'update-available')
    assert.equal(checked.latestVersion, 'unknown')
    const records = recovered.diagnostics().records
    assert.equal(new Set(records.filter(r => r.event === 'check.started').map(r => r.attemptId)).size, 2)
    assert.ok(records.some(r => r.event === 'fallback.cdn'))
    assert.ok(records.some(r => r.event === 'github.commit.failed' && r.cause.code === 'ETIMEDOUT' && r.durationMs >= 0))
    assert.ok(records.some(r => r.event === 'github.version.failed' && r.cause.code === 'ETIMEDOUT'))
    assert.ok(records.some(r => r.event === 'status' && r.phase === 'check-failed'))
    assert.ok(records.some(r => r.event === 'status' && r.phase === 'update-available'))
    assert.ok(!JSON.stringify(records).includes('secret'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

for (const mode of ['relative-loose', 'absolute-packed', 'detached']) test('Git worktree 正确读取独立 HEAD 与共享 refs：' + mode, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-worktree-'))
  try {
    const source = path.join(root, 'checkout')
    const common = path.join(root, 'repository.git')
    const metadata = path.join(common, 'worktrees', 'trial')
    const commit = 'd'.repeat(40)
    await mkdir(source, { recursive: true })
    await mkdir(metadata, { recursive: true })
    await mkdir(path.join(common, 'refs', 'heads'), { recursive: true })
    await writeFile(path.join(source, '.git'), 'gitdir: ' + (mode.startsWith('absolute') ? metadata : path.relative(source, metadata)) + '\n')
    await writeFile(path.join(metadata, 'commondir'), '../..\n')
    await writeFile(path.join(metadata, 'HEAD'), mode === 'detached' ? commit + '\n' : 'ref: refs/heads/trial\n')
    if (mode.endsWith('packed')) await writeFile(path.join(common, 'packed-refs'), commit + ' refs/heads/trial\n')
    else await writeFile(path.join(common, 'refs', 'heads', 'trial'), commit + '\n')
    await writeFile(path.join(source, 'package.json'), JSON.stringify({ version: '0.7.2' }))
    const updater = createApplicationUpdater({ dataRoot: path.join(root, 'data'), sourceRoot: source, runtimeHost: 'android',
      fetchManifest: async () => ({ version: '0.7.2' }), fetchLatestCommit: async () => commit })
    const result = await updater.check()
    assert.equal(result.phase, 'up-to-date')
    assert.equal(result.currentCommit, commit)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('历史更新记录的宿主不覆盖当前运行环境', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-runtime-host-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.7.0' }))
  for (const [runtimeHost, cachedHost] of [['cli', 'desktop'], ['desktop', 'cli']]) {
    await writeFile(path.join(root, 'update-status.json'), JSON.stringify({ phase: 'up-to-date', host: cachedHost }))
    const updater = createApplicationUpdater({ dataRoot: root, sourceRoot: root, runtimeHost })
    const status = await updater.status()
    assert.equal(status.host, runtimeHost)
    assert.equal(status.phase, 'idle')
  }
})

test('Windows helper 启动失败保留不确定状态，避免已启动的 WMI 更新器和重试并发', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'update-helper-error-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const updater = createApplicationUpdater({ ...verifiedUpdate, dataRoot: root, sourceRoot: root, dshHome: root, platform: 'win32',
    spawnProcess() {
      const child = new EventEmitter()
      child.stderr = new EventEmitter()
      child.unref = () => {}
      queueMicrotask(() => { child.emit('spawn'); child.stderr.emit('data', Buffer.from('Windows 更新器启动失败：WMI 访问被拒绝')); child.emit('close', 1) })
      return child
    },
  })
  await assert.rejects(updater.start, /WMI 访问被拒绝/)
  const saved = JSON.parse(await readFile(path.join(root, 'update-status.json'), 'utf8'))
  assert.equal(saved.phase, 'blocked')
  assert.match(saved.error, /WMI 访问被拒绝/)
})

test('jsDelivr 兜底：本地清单未核验时用提交比较，比较不可达时以本地清单序号为下界 (#125)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-floor-'))
  try {
    const current = 'c'.repeat(40)
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '2.4.0' }))
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit: current }))
    // Installed before its own manifest was published: local files do not match.
    await writeFile(path.join(root, 'dsh-tavern-runtime.json'), JSON.stringify({
      revision: 'a'.repeat(40), releaseSequence: 42, version: '2.4.0', files: [{ path: 'package.json', sha256: 'f'.repeat(64) }],
    }))
    const metadata = { revision: '9'.repeat(40), releaseSequence: 44, version: '2.4.0', files: [{ path: 'package.json', sha256: 'e'.repeat(64) }] }
    const offline = async () => { throw new Error('fetch failed') }
    const common = { dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli',
      fetchManifest: offline, fetchLatestCommit: offline, fetchCdnMetadata: async () => metadata }
    const compared = []
    const viaCompare = await createApplicationUpdater({ ...common, compareCommits: async (a, b) => { compared.push([a, b]); return 'ahead' } }).check()
    assert.equal(viaCompare.phase, 'update-available')
    assert.deepEqual(compared, [[current, metadata.revision]])
    const viaFloor = await createApplicationUpdater({ ...common, compareCommits: offline }).check()
    assert.equal(viaFloor.phase, 'update-available')
    metadata.releaseSequence = 42
    assert.equal((await createApplicationUpdater({ ...common, compareCommits: offline }).check()).phase, 'check-failed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('状态查询按与安装相同的规则回收残留锁，更新按钮不再永久卡在「等待安全停止」', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'update-stale-lock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '2.5.0' }))
  await writeFile(path.join(root, 'update-status.json'), JSON.stringify({ phase: 'running', attemptId: 'old' }))
  const dead = 2 ** 22 + 12345 // well above any live PID on test hosts
  const lock = path.join(root, '.tavern-install.lock')
  await mkdir(path.join(lock, 'processes', 'install'), { recursive: true })
  const old = Date.now() - 5 * 60_000
  await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ attemptId: 'old', generation: 'g', pid: dead, state: 'blocked', unsafeToRetry: true, startedAt: old, updatedAt: old }))
  await writeFile(path.join(lock, 'processes', 'install', `${dead + 1}.json`), JSON.stringify({ pid: dead + 1 }))
  const { utimes } = await import('node:fs/promises')
  for (const file of [path.join(lock, 'owner.json'), lock]) await utimes(file, new Date(old), new Date(old))
  const status = await createApplicationUpdater({ dataRoot: root, sourceRoot: root, runtimeHost: 'cli' }).status()
  assert.equal(status.phase, 'failed')
  assert.equal(status.repairRequired, true)
  await assert.rejects(readFile(path.join(lock, 'owner.json')), { code: 'ENOENT' })
})

test('没有安装锁的遗留「进行中」记录：超过 1 小时转为可修复，不再永久禁用更新', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'update-orphan-record-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '2.5.0' }))
  const updater = createApplicationUpdater({ dataRoot: root, sourceRoot: root, runtimeHost: 'cli' })
  await writeFile(path.join(root, 'update-status.json'), JSON.stringify({ phase: 'running', attemptId: 'a', startedAt: Date.now() - 5 * 60_000 }))
  assert.equal((await updater.status()).phase, 'blocked', 'a recent record stays fenced')
  await writeFile(path.join(root, 'update-status.json'), JSON.stringify({ phase: 'blocked', attemptId: 'a', startedAt: Date.now() - 2 * 60 * 60_000 }))
  const status = await updater.status()
  assert.equal(status.phase, 'failed')
  assert.equal(status.repairRequired, true)
})
