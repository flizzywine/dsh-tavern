import assert from 'node:assert/strict'
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
    let spawned = 0
    const updater = createApplicationUpdater({
      dataRoot,
      sourceRoot: root,
      runtimeHost: 'cli',
      fetchManifest: async () => ({ version: '0.7.1' }),
      spawnProcess() { spawned += 1 },
      now: () => 123,
    })

    assert.deepEqual(await updater.start(), {
      phase: 'up-to-date', host: 'cli', checkedAt: 123, currentVersion: '0.7.1', latestVersion: '0.7.1',
    })
    assert.equal(spawned, 0)
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

    assert.deepEqual(await updater.status(), { phase: 'idle', host: 'desktop' })
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
      phase: 'failed', host: 'desktop', failedAt: 901000, error: '上次更新已中断',
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
      phase: 'failed', host: 'desktop', failedAt: 2000, error: '上次更新已中断',
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

    assert.deepEqual(await updater.status(), running)
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

    assert.deepEqual(await updater.status(), { phase: 'idle', host: 'cli' })
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

    assert.deepEqual(await updater.status(), { phase: 'idle', host: 'android' })
    assert.deepEqual(await updater.start(), { phase: 'running', host: 'android', startedAt: 456 })
    assert.deepEqual(calls[0].args.slice(0, 4), [
      path.join(path.resolve('/storage/emulated/0/dsh-tavern'), 'bin', 'dsh-tavern.mjs'), 'update', '--host', 'android',
    ])
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
