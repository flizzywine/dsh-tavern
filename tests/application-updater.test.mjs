import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createApplicationUpdater, sanitizeUpdateError } from '../tavern-plugin/lib/application-updater.js'

test('版本相同时不下载、不停止服务', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-version-'))
  try {
    const dataRoot = path.join(root, 'data')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.7.1' }))
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit: 'a'.repeat(40) }))
    let spawned = 0
    const updater = createApplicationUpdater({
      dataRoot,
      sourceRoot: root,
      runtimeHost: 'cli',
      fetchManifest: async () => ({ version: '0.7.1' }),
      fetchLatestCommit: async () => 'a'.repeat(40),
      spawnProcess() { spawned += 1 },
      now: () => 123,
    })

    assert.deepEqual(await updater.start(), {
      phase: 'up-to-date', host: 'cli', checkedAt: 123, currentVersion: '0.7.1', latestVersion: '0.7.1',
      currentCommit: 'a'.repeat(40), latestCommit: 'a'.repeat(40),
      checkSource: 'github', checkWarning: undefined,
    })
    assert.equal(spawned, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('检查更新只返回最新提交状态，不启动安装进程', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-check-'))
  try {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.9.0' }))
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit: 'a'.repeat(40) }))
    let spawned = 0
    const updater = createApplicationUpdater({
      dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli',
      fetchManifest: async () => ({ version: '0.9.0' }), fetchLatestCommit: async () => 'b'.repeat(40),
      spawnProcess() { spawned += 1 }, now: () => 234,
    })

    assert.deepEqual(await updater.status(), {
      phase: 'idle', host: 'cli', currentVersion: '0.9.0', currentCommit: 'a'.repeat(40),
    })
    assert.deepEqual(await updater.check(), {
      phase: 'update-available', host: 'cli', checkedAt: 234,
      currentVersion: '0.9.0', latestVersion: '0.9.0',
      currentCommit: 'a'.repeat(40), latestCommit: 'b'.repeat(40),
      checkSource: 'github', checkWarning: undefined,
    })
    assert.equal(spawned, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('GitHub 最新提交仅发布运行清单时，以父提交作为最新运行构建', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-manifest-commit-'))
  try {
    const runtimeCommit = 'a'.repeat(40)
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.9.0' }))
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit: runtimeCommit }))
    const updater = createApplicationUpdater({
      dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli',
      fetchManifest: async () => ({ version: '0.9.0' }),
      fetchLatestCommit: async () => ({
        sha: 'b'.repeat(40),
        parents: [{ sha: runtimeCommit }],
        files: [{ filename: 'dsh-tavern-runtime.json' }],
      }),
      fetchCdnMetadata: async () => { throw new Error('备用源不应参与本用例') },
      now: () => 250,
    })

    assert.deepEqual(await updater.check(), {
      phase: 'up-to-date', host: 'cli', checkedAt: 250,
      currentVersion: '0.9.0', latestVersion: '0.9.0',
      currentCommit: runtimeCommit, latestCommit: runtimeCommit,
      checkSource: 'github', checkWarning: undefined,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('检查更新失败时保留当前构建信息且不启动安装', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-check-failed-'))
  try {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.9.0' }))
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit: 'c'.repeat(40) }))
    let spawned = 0
    const updater = createApplicationUpdater({
      dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli',
      fetchManifest: async () => { throw new Error('offline') },
      fetchLatestCommit: async () => { throw new Error('offline') },
      fetchCdnMetadata: async () => { throw new Error('offline') },
      spawnProcess() { spawned += 1 }, now: () => 345,
    })

    const result = await updater.check()
    assert.equal(result.phase, 'check-failed')
    assert.equal(result.currentVersion, '0.9.0')
    assert.equal(result.currentCommit, 'c'.repeat(40))
    assert.match(result.error, /无法检查更新/)
    assert.equal(spawned, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('状态缓存中的旧提交号不会覆盖当前本地构建', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-current-identity-'))
  try {
    const dataRoot = path.join(root, 'data')
    await mkdir(dataRoot, { recursive: true })
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.9.1' }))
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit: 'd'.repeat(40) }))
    await writeFile(path.join(dataRoot, 'update-status.json'), JSON.stringify({
      phase: 'update-available', host: 'cli', checkedAt: 123,
      currentVersion: '0.9.0', currentCommit: 'a'.repeat(40), latestCommit: 'b'.repeat(40),
    }))
    const updater = createApplicationUpdater({ dataRoot, sourceRoot: root, runtimeHost: 'cli' })

    const result = await updater.status()
    assert.equal(result.currentVersion, '0.9.1')
    assert.equal(result.currentCommit, 'd'.repeat(40))
    assert.equal(result.latestCommit, 'b'.repeat(40))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('GitHub 不可达时通过 jsDelivr 文件哈希判断是否有更新', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-cdn-'))
  try {
    const packageText = JSON.stringify({ version: '0.7.2' })
    await writeFile(path.join(root, 'package.json'), packageText)
    const metadata = { revision: '9'.repeat(40), files: [{ path: 'package.json', sha256: createHash('sha256').update(packageText).digest('hex') }] }
    const common = {
      dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli',
      fetchManifest: async () => { throw new Error('fetch failed') },
      fetchLatestCommit: async () => { throw new Error('fetch failed') },
      fetchCdnMetadata: async () => metadata,
      now: () => 321,
    }
    const current = await createApplicationUpdater(common).start()
    assert.equal(current.phase, 'up-to-date')
    assert.equal(current.checkSource, 'jsdelivr')
    assert.match(current.checkWarning, /jsDelivr 备用源/)

    metadata.files[0].sha256 = createHash('sha256').update('new package').digest('hex')
    const child = { pid: 4321, once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() {} }
    const changed = await createApplicationUpdater({ ...common, platform: 'linux', spawnProcess() { return child } }).start()
    assert.equal(changed.phase, 'running')
    assert.equal(changed.checkSource, 'jsdelivr')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('版本号相同但提交号变化时仍启动更新', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-commit-'))
  try {
    const dataRoot = path.join(root, 'data')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.7.2' }))
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit: 'a'.repeat(40) }))
    const calls = []
    const child = { pid: 4321, once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() {} }
    const updater = createApplicationUpdater({
      dataRoot,
      sourceRoot: root,
      runtimeHost: 'cli',
      platform: 'linux',
      fetchManifest: async () => ({ version: '0.7.2' }),
      fetchLatestCommit: async () => 'b'.repeat(40),
      spawnProcess(command, args) { calls.push({ command, args }); return child },
      now: () => 456,
    })

    const result = await updater.start()
    assert.equal(result.phase, 'running')
    assert.equal(result.currentCommit, 'a'.repeat(40))
    assert.equal(result.latestCommit, 'b'.repeat(40))
    assert.deepEqual(calls[0].args.slice(-2), ['--target-commit', 'b'.repeat(40)])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('完整 Git 安装可直接从 HEAD 识别当前提交', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-git-head-'))
  try {
    const commit = 'c'.repeat(40)
    await mkdir(path.join(root, '.git', 'refs', 'heads'), { recursive: true })
    await writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    await writeFile(path.join(root, '.git', 'refs', 'heads', 'main'), `${commit}\n`)
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.7.2' }))
    const updater = createApplicationUpdater({
      dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'android',
      fetchManifest: async () => ({ version: '0.7.2' }), fetchLatestCommit: async () => commit,
      now: () => 789,
    })

    assert.equal((await updater.start()).phase, 'up-to-date')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('乱码更新错误替换为可执行的重新安装提示', () => {
  assert.equal(sanitizeUpdateError('�������� DSH Tavern����'), '更新失败：安装程序输出编码异常。建议重新安装一次。')
  assert.equal(sanitizeUpdateError('服务启动失败'), '服务启动失败')
})

test('UI 更新沿用 Profile 中记录的 Desktop 宿主并脱离当前服务执行', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const dataRoot = path.join(root, 'profile-data/tavern/data')
    const profileManifest = path.join(root, 'profiles/tavern/package.json')
    await mkdir(path.dirname(profileManifest), { recursive: true })
    await writeFile(profileManifest, JSON.stringify({ dshTavern: { host: 'desktop' } }))
    const calls = []
    const child = { pid: 4321, unrefCalled: false, once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() { this.unrefCalled = true } }
    const updater = createApplicationUpdater({
      dataRoot,
      sourceRoot: '/app/dsh-tavern',
      dshHome: root,
      execPath: '/runtime/node',
      platform: 'linux',
      spawnProcess(command, args, options) { calls.push({ command, args, options }); return child },
      now: () => 123,
    })

    assert.deepEqual(await updater.status(), { phase: 'idle', host: 'desktop', currentVersion: 'unknown', currentCommit: '' })
    assert.deepEqual(await updater.start(), { phase: 'running', host: 'desktop', startedAt: 123, pid: 4321 })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].command, '/runtime/node')
    assert.deepEqual(calls[0].args.slice(0, 4), [path.join(path.resolve('/app/dsh-tavern'), 'bin', 'dsh-tavern.mjs'), 'update', '--host', 'desktop'])
    assert.ok(calls[0].args.includes('--status-file'))
    assert.ok(calls[0].args.includes('--delay=800'))
    assert.equal(calls[0].options.detached, true)
    assert.equal(child.unrefCalled, true)
    assert.deepEqual(JSON.parse(await readFile(path.join(dataRoot, 'update-status.json'), 'utf8')), { phase: 'running', host: 'desktop', startedAt: 123, pid: 4321 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('更新任务正在运行时拒绝重复启动', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const dataRoot = path.join(root, 'profile-data/tavern/data')
    const profileManifest = path.join(root, 'profiles/tavern/package.json')
    await mkdir(path.dirname(profileManifest), { recursive: true })
    await writeFile(profileManifest, JSON.stringify({ dshTavern: { host: 'cli' } }))
    let spawned = 0
    const updater = createApplicationUpdater({
      dataRoot,
      sourceRoot: '/app/dsh-tavern',
      dshHome: root,
      spawnProcess() { spawned += 1; return { once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() {} } },
      now: () => 1000,
    })

    await updater.start()
    await assert.rejects(() => updater.start(), /更新正在进行/)
    assert.equal(spawned, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('超过十五分钟的更新自动标记为中断并持久化', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const dataRoot = path.join(root, 'profile-data/tavern/data')
    const statusFile = path.join(dataRoot, 'update-status.json')
    await mkdir(dataRoot, { recursive: true })
    await writeFile(statusFile, JSON.stringify({ phase: 'running', host: 'desktop', startedAt: 1000 }))
    const updater = createApplicationUpdater({
      dataRoot,
      sourceRoot: '/app/dsh-tavern',
      dshHome: root,
      now: () => 1000 + (15 * 60 * 1000),
    })

    assert.deepEqual(await updater.status(), {
      phase: 'failed', host: 'desktop', failedAt: 901000, error: '上次更新已中断', currentVersion: 'unknown', currentCommit: '',
    })
    assert.deepEqual(JSON.parse(await readFile(statusFile, 'utf8')), {
      phase: 'failed', host: 'desktop', failedAt: 901000, error: '上次更新已中断',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('更新进程已经退出时立即恢复按钮', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const dataRoot = path.join(root, 'profile-data/tavern/data')
    const statusFile = path.join(dataRoot, 'update-status.json')
    await mkdir(dataRoot, { recursive: true })
    await writeFile(statusFile, JSON.stringify({ phase: 'running', host: 'desktop', startedAt: 1000, pid: 4321 }))
    const updater = createApplicationUpdater({
      dataRoot,
      sourceRoot: '/app/dsh-tavern',
      dshHome: root,
      now: () => 2000,
      isProcessAlive: () => false,
    })

    assert.deepEqual(await updater.status(), {
      phase: 'failed', host: 'desktop', failedAt: 2000, error: '上次更新已中断', currentVersion: 'unknown', currentCommit: '',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('更新进程仍存活时保持运行状态', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const dataRoot = path.join(root, 'profile-data/tavern/data')
    const running = { phase: 'running', host: 'desktop', startedAt: 1000, pid: 4321 }
    await mkdir(dataRoot, { recursive: true })
    await writeFile(path.join(dataRoot, 'update-status.json'), JSON.stringify(running))
    const updater = createApplicationUpdater({
      dataRoot,
      sourceRoot: '/app/dsh-tavern',
      dshHome: root,
      now: () => 2000,
      isProcessAlive: () => true,
    })

    assert.deepEqual(await updater.status(), { ...running, currentVersion: 'unknown', currentCommit: '' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('当前 CLI 运行方式优先于共享 Profile 的 Desktop 安装记录', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const dataRoot = path.join(root, 'profile-data/tavern/data')
    const profileManifest = path.join(root, 'profiles/tavern/package.json')
    await mkdir(path.dirname(profileManifest), { recursive: true })
    await writeFile(profileManifest, JSON.stringify({ dshTavern: { host: 'desktop' } }))
    const updater = createApplicationUpdater({ dataRoot, sourceRoot: '/app/dsh-tavern', dshHome: root, runtimeHost: 'cli' })

    assert.deepEqual(await updater.status(), { phase: 'idle', host: 'cli', currentVersion: 'unknown', currentCommit: '' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Android 安装记录让 UI 更新任务沿用 Android 宿主', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const dataRoot = path.join(root, 'profile-data/tavern/data')
    const profileManifest = path.join(root, 'profiles/tavern/package.json')
    await mkdir(path.dirname(profileManifest), { recursive: true })
    await writeFile(profileManifest, JSON.stringify({ dshTavern: { host: 'android' } }))
    const calls = []
    const child = { once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() {} }
    const updater = createApplicationUpdater({
      dataRoot,
      sourceRoot: '/storage/emulated/0/dsh-tavern',
      dshHome: root,
      execPath: '/runtime/node',
      platform: 'linux',
      spawnProcess(command, args) { calls.push({ command, args }); return child },
      now: () => 456,
    })

    assert.deepEqual(await updater.status(), { phase: 'idle', host: 'android', currentVersion: 'unknown', currentCommit: '' })
    assert.deepEqual(await updater.start(), { phase: 'running', host: 'android', startedAt: 456 })
    assert.deepEqual(calls[0].args.slice(0, 4), [
      path.join(path.resolve('/storage/emulated/0/dsh-tavern'), 'bin', 'dsh-tavern.mjs'), 'update', '--host', 'android',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('手动重启后把“文件已更新”状态收敛为更新完成', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-recovered-'))
  try {
    const dataRoot = path.join(root, 'data')
    const statusFile = path.join(dataRoot, 'update-status.json')
    await mkdir(dataRoot, { recursive: true })
    await writeFile(statusFile, JSON.stringify({ phase: 'installed-restart-required', host: 'cli', targetCommit: 'f'.repeat(40) }))
    const updater = createApplicationUpdater({ dataRoot, sourceRoot: root, runtimeHost: 'cli', now: () => 2345 })
    assert.deepEqual(await updater.status(), {
      phase: 'completed', host: 'cli', completedAt: 2345, targetCommit: 'f'.repeat(40), recoveredByRestart: true,
      currentVersion: 'unknown', currentCommit: '',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows UI 更新通过短生命周期 helper 与服务进程树脱钩', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const calls = []
    const child = { pid: 4321, once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() {} }
    const updater = createApplicationUpdater({
      dataRoot: path.join(root, 'profile-data/tavern/data'),
      sourceRoot: 'C:\\app\\dsh-tavern',
      dshHome: root,
      execPath: 'C:\\runtime\\node.exe',
      platform: 'win32',
      spawnProcess(command, args, options) { calls.push({ command, args, options }); return child },
      now: () => 789,
    })

    assert.deepEqual(await updater.start(), { phase: 'running', host: 'cli', startedAt: 789 })
    assert.equal(calls[0].command, 'C:\\runtime\\node.exe')
    assert.match(calls[0].args[0], /bin[\\/]dsh-tavern-update-helper\.mjs$/)
    assert.equal(calls[0].args[1], 'C:\\runtime\\node.exe')
    assert.ok(calls[0].args.includes('--status-file'))
    assert.equal(calls[0].options.windowsHide, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
