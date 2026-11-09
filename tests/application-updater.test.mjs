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
    // 清单主源是 GitHub raw 运行清单，commits API 补判；jsDelivr 只在前两者都判不了时兜底。
    // 测试默认把 raw 清单置为不可用，需要它的用例自己传 fetchGithubManifest。
    fetchGithubManifest: async () => { throw new Error('GitHub manifest unavailable in fixtures') },
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

test('Next 插件分发将更新交给宿主，忽略同一数据目录的旧更新状态', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'update-next-plugin-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '3.2.0', dshTavern: { distribution: 'plugin' } }))
  await writeFile(path.join(root, 'update-status.json'), JSON.stringify({ phase: 'running', host: 'desktop' }))
  const updater = createApplicationUpdater({ dataRoot: root, sourceRoot: root })
  const status = await updater.status()
  assert.equal(status.phase, 'package-managed')
  assert.equal(status.currentVersion, '3.2.0')
  assert.equal(status.updateCommand, undefined)
  assert.deepEqual(await updater.check(), status)
  await assert.rejects(updater.start(), /酒馆启动器/)
  await assert.rejects(updater.cancel(), /DSH NEXT 插件管理/)
})

test('桌面安装完成只在旧运行时要求重启，重启后解除提示', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'update-desktop-restart-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'update-status.json'), JSON.stringify({ phase: 'completed', host: 'desktop', requiresRestart: true, completedAt: 200 }))
  const updater = runtimeStartedAt => createApplicationUpdater({ dataRoot: root, sourceRoot: root, runtimeHost: 'desktop', runtimeStartedAt, ...verifiedUpdate })
  assert.equal((await updater(100).status()).requiresRestart, true)
  assert.equal((await updater(300).status()).requiresRestart, false)
})

test('Android standalone 安装完成后，重启的 3088 服务不再要求重启 DSHA', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'update-android-restart-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'update-status.json'), JSON.stringify({ phase: 'completed', host: 'android', requiresRestart: true, completedAt: 200 }))
  const updater = runtimeStartedAt => createApplicationUpdater({ dataRoot: root, sourceRoot: root, runtimeHost: 'android', runtimeStartedAt, ...verifiedUpdate })
  // The page that ran the update still needs the hint: same runtime, completion already reported.
  assert.equal((await updater(100).status()).requiresRestart, true)
  // Installing restarts the service; the new runtime is newer than the completion, so the hint expires.
  const restarted = await updater(300).status()
  assert.equal(restarted.requiresRestart, false)
  assert.equal(restarted.phase, 'completed')
})

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

test('开始更新复用最近的检查结果，不重复请求或刷新本地身份', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-update-reuse-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const latest = 'b'.repeat(40)
  let identityReads = 0
  let networkChecks = 0
  let launchedArguments
  const child = { pid: process.pid, once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() {} }
  const updater = createApplicationUpdater({
    dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli', now: () => 1000,
    readLocalIdentity: async () => { identityReads += 1; return knownIdentity },
    fetchManifest: async () => { networkChecks += 1; return { version: knownIdentity.currentVersion } },
    fetchLatestCommit: async () => { networkChecks += 1; return latest },
    compareCommits: async () => { networkChecks += 1; return 'ahead' },
    spawnProcess(_command, args) { launchedArguments = args; return child },
  })
  assert.equal((await updater.check()).phase, 'update-available')
  assert.equal(networkChecks, 3)
  assert.equal((await updater.start()).phase, 'running')
  assert.equal(networkChecks, 3, 'start 不得重复整套远端检查')
  assert.equal(identityReads, 2, 'check 一次，start 只刷新一次身份')
  assert.equal(launchedArguments[launchedArguments.indexOf('--target-commit') + 1], latest)
  assert.ok(updater.diagnostics().records.some(entry => entry.event === 'check.reused'))
})

test('检查结果过期后 start 重新核实远端并再次确认本地身份', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-update-reuse-expired-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let clock = 1000
  let identityReads = 0
  let networkChecks = 0
  const child = { pid: process.pid, once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() {} }
  const updater = createApplicationUpdater({
    dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli', now: () => clock,
    readLocalIdentity: async () => { identityReads += 1; return knownIdentity },
    fetchManifest: async () => { networkChecks += 1; return { version: knownIdentity.currentVersion } },
    fetchLatestCommit: async () => { networkChecks += 1; return 'b'.repeat(40) },
    compareCommits: async () => { networkChecks += 1; return 'ahead' },
    spawnProcess() { return child },
  })
  await updater.check()
  clock += 5 * 60 * 1000 + 1
  assert.equal((await updater.start()).phase, 'running')
  assert.equal(networkChecks, 6)
  assert.equal(identityReads, 3)
  assert.ok(!updater.diagnostics().records.some(entry => entry.event === 'check.reused'))
})

test('修复安装复用同提交的最近检查，仍然启动重装', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-update-reuse-repair-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataRoot = path.join(root, 'data')
  await mkdir(dataRoot, { recursive: true })
  await writeFile(path.join(dataRoot, 'update-status.json'), JSON.stringify({ phase: 'failed', host: 'cli', repairRequired: true, repairSince: 1, error: 'interrupted' }))
  let networkChecks = 0
  let spawned = 0
  const child = { pid: process.pid, once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() {} }
  const updater = createApplicationUpdater({
    dataRoot, sourceRoot: root, runtimeHost: 'cli', now: () => 1000,
    readLocalIdentity: async () => knownIdentity,
    fetchManifest: async () => { networkChecks += 1; return { version: knownIdentity.currentVersion } },
    fetchLatestCommit: async () => { networkChecks += 1; return knownIdentity.currentCommit },
    spawnProcess() { spawned += 1; return child },
  })
  assert.equal((await updater.check()).phase, 'repair-required')
  assert.equal((await updater.start()).phase, 'running')
  assert.equal(networkChecks, 2)
  assert.equal(spawned, 1)
})

test('GitHub raw 运行清单是清单主源：commits API 不可用时仍能判出更新', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-raw-first-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const installed = 'a'.repeat(40)
  const latest = 'b'.repeat(40)
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '3.2.0' }))
  const updater = createApplicationUpdater({
    dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli',
    readLocalIdentity: async () => ({ currentVersion: '3.2.0', currentCommit: installed, currentReleaseSequence: 100 }),
    fetchManifest: async () => ({ version: '3.2.0' }),
    fetchLatestCommit: async () => { throw new Error('commits API unavailable') },
    fetchGithubManifest: async () => ({
      schemaVersion: 2, revision: latest, releaseSequence: 101, version: '3.2.0',
      files: [{ path: 'package.json', sha256: 'f'.repeat(64) }],
    }),
    compareCommits: async () => { throw new Error('提交比较不该被调用') },
  })
  const checked = await updater.check()
  assert.equal(checked.phase, 'update-available')
  assert.equal(checked.checkSource, 'github-manifest')
  assert.equal(checked.latestCommit, latest)
  assert.equal(checked.checkWarning, undefined)
})

test('raw 清单落后一版（刚推送、CI 还没发布清单）时用 commits API 补判', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-raw-lag-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const installed = 'a'.repeat(40)
  const newer = 'b'.repeat(40)
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '3.2.0' }))
  const updater = createApplicationUpdater({
    dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli',
    readLocalIdentity: async () => ({ currentVersion: '3.2.0', currentCommit: installed, currentReleaseSequence: 100 }),
    fetchManifest: async () => ({ version: '3.2.0' }),
    // raw 清单仍停在已安装的提交上。
    fetchGithubManifest: async () => ({
      schemaVersion: 2, revision: installed, releaseSequence: 100, version: '3.2.0',
      files: [{ path: 'package.json', sha256: 'f'.repeat(64) }],
    }),
    fetchLatestCommit: async () => newer,
    compareCommits: async (current, target) => {
      assert.deepEqual([current, target], [installed, newer])
      return 'ahead'
    },
  })
  const checked = await updater.check()
  assert.equal(checked.phase, 'update-available')
  assert.equal(checked.checkSource, 'github')
  assert.equal(checked.latestCommit, newer)
})

test('raw 清单与 commits API 一致显示无更新时，不再问 jsDelivr', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-raw-current-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const installed = 'a'.repeat(40)
  const packageText = JSON.stringify({ version: '3.2.0' })
  await writeFile(path.join(root, 'package.json'), packageText)
  let cdnRequests = 0
  const updater = createApplicationUpdater({
    dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli',
    fetchManifest: async () => ({ version: '3.2.0' }),
    fetchLatestCommit: async () => installed,
    fetchGithubManifest: async () => ({
      schemaVersion: 2, revision: installed, releaseSequence: 100, version: '3.2.0',
      files: [{ path: 'package.json', sha256: createHash('sha256').update(packageText).digest('hex') }],
    }),
    fetchCdnMetadata: async () => { cdnRequests += 1; throw new Error('jsDelivr 不该被问到') },
  })
  const checked = await updater.check()
  assert.equal(checked.phase, 'up-to-date')
  assert.equal(checked.checkSource, 'github-manifest')
  assert.equal(cdnRequests, 0, '主源判得动时不发 CDN 请求')
})


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
    // A live PID: the launched updater is still running when status is read.
    const child = { pid: process.pid, once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() {} }
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
    assert.ok(records.some(r => r.event === 'fallback.manifest'))
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

test('jsDelivr 滞后（清单提交号对不上 GitHub 最新提交）时，用发布序号判断更新', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-lag-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const installed = 'b'.repeat(40)
  const latestCommit = 'd'.repeat(40)
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '3.1.0' }))
  await writeFile(path.join(root, 'dsh-tavern-runtime.json'), JSON.stringify({
    revision: installed, releaseSequence: 900, version: '3.1.0', files: [{ path: 'package.json', sha256: 'f'.repeat(64) }],
  }))
  const metadata = { revision: 'c'.repeat(40), releaseSequence: 914, version: '3.1.0', files: [{ path: 'package.json', sha256: 'e'.repeat(64) }] }
  const common = {
    dataRoot: path.join(root, 'data'), sourceRoot: root, dshHome: path.join(root, 'home'), runtimeHost: 'android',
    fetchManifest: async () => ({ version: '3.1.0' }), fetchLatestCommit: async () => ({ sha: latestCommit }),
    fetchCdnMetadata: async () => metadata,
    compareCommits: async () => { throw new Error('提交号不可比时不该阻塞') },
  }
  const behind = await createApplicationUpdater(common).check()
  assert.equal(behind.phase, 'update-available')
  assert.equal(behind.latestVersion, '3.1.0')
})

test('压缩包安装没有 .git 和安装记录时，用源码自带运行清单的提交号判断更新', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-archive-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const installed = 'b'.repeat(40)
  const latest = 'd'.repeat(40)
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '3.1.0' }))
  // 清单里的哈希与本地文件不一致（安装后 regenerate 过），但提交号仍是这一版。
  await writeFile(path.join(root, 'dsh-tavern-runtime.json'), JSON.stringify({
    revision: installed, releaseSequence: 900, version: '3.1.0', files: [{ path: 'package.json', sha256: 'f'.repeat(64) }],
  }))
  const updater = createApplicationUpdater({
    dataRoot: path.join(root, 'data'), sourceRoot: root, dshHome: path.join(root, 'home'), runtimeHost: 'android',
    fetchManifest: async () => ({ version: '3.1.0' }), fetchLatestCommit: async () => ({ sha: latest }),
    compareCommits: async (current, target) => { assert.deepEqual([current, target], [installed, latest]); return 'ahead' },
  })
  const checked = await updater.check()
  assert.equal(checked.phase, 'update-available')
  assert.equal(checked.currentCommit, installed)
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

test('Windows 更新器启动后，预留锁记下它的进程号，进程未接管就退出时不必等 1 小时', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'update-launcher-pid-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const updater = createApplicationUpdater({ ...verifiedUpdate, dataRoot: root, sourceRoot: root, dshHome: root, platform: 'win32',
    spawnProcess() {
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.unref = () => {}
      queueMicrotask(() => { child.emit('spawn'); child.stdout.emit('data', Buffer.from(launcherPid + '\r\n')); child.emit('close', 0) })
      return child
    },
  })
  let launcherPid = process.pid
  assert.equal((await updater.start()).phase, 'running')
  const owner = JSON.parse(await readFile(path.join(root, '.tavern-install.lock', 'owner.json'), 'utf8'))
  assert.equal(owner.state, 'reserved')
  assert.equal(owner.launcherPid, process.pid)
  // A dead updater that never adopted the reservation: status releases it right away.
  await writeFile(path.join(root, '.tavern-install.lock', 'owner.json'), JSON.stringify({ ...owner, launcherPid: 2 ** 22 + 12345 }))
  const interrupted = await updater.status()
  assert.equal(interrupted.phase, 'failed')
  assert.equal(interrupted.repairRequired, true)
  assert.match(interrupted.error, /没有开始安装就退出/)
  const events = updater.diagnostics().records.map(entry => entry.event)
  assert.ok(events.includes('updater.launched'))
  assert.ok(events.includes('updater.notadopted'))
})

test('从 Git 仓库运行时不启动应用内更新，提示用 git pull；检查更新照常', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-checkout-'))
  try {
    await mkdir(path.join(root, '.git'), { recursive: true })
    const updater = createApplicationUpdater({ dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli', ...verifiedUpdate })
    await assert.rejects(updater.start(), /Git 仓库运行.*git pull/)
    // Android installs are Git checkouts by design; android/update.sh updates them in place.
    const android = createApplicationUpdater({ dataRoot: path.join(root, 'data-android'), sourceRoot: root, runtimeHost: 'android',
      ...verifiedUpdate, fetchLatestCommit: async () => knownIdentity.currentCommit })
    assert.equal((await android.start()).phase, 'up-to-date')
  } finally { await rm(root, { recursive: true, force: true }) }
})
