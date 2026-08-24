import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createApplicationUpdater } from '../tavern-plugin/lib/application-updater.js'

test('UI 更新沿用 Profile 中记录的 Desktop 宿主并脱离当前服务执行', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const dataRoot = path.join(root, 'profile-data/tavern/data')
    const profileManifest = path.join(root, 'profiles/tavern/package.json')
    await mkdir(path.dirname(profileManifest), { recursive: true })
    await writeFile(profileManifest, JSON.stringify({ dshTavern: { host: 'desktop' } }))
    const calls = []
    const child = { unrefCalled: false, once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() { this.unrefCalled = true } }
    const updater = createApplicationUpdater({
      dataRoot,
      sourceRoot: '/app/dsh-tavern',
      dshHome: root,
      execPath: '/runtime/node',
      spawnProcess(command, args, options) { calls.push({ command, args, options }); return child },
      now: () => 123,
    })

    assert.deepEqual(await updater.status(), { phase: 'idle', host: 'desktop' })
    assert.deepEqual(await updater.start(), { phase: 'running', host: 'desktop', startedAt: 123 })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].command, '/runtime/node')
    assert.deepEqual(calls[0].args.slice(0, 4), ['/app/dsh-tavern/bin/dsh-tavern.mjs', 'update', '--host', 'desktop'])
    assert.ok(calls[0].args.includes('--status-file'))
    assert.ok(calls[0].args.includes('--delay=800'))
    assert.equal(calls[0].options.detached, true)
    assert.equal(child.unrefCalled, true)
    assert.deepEqual(JSON.parse(await readFile(path.join(dataRoot, 'update-status.json'), 'utf8')), { phase: 'running', host: 'desktop', startedAt: 123 })
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
      spawnProcess(command, args) { calls.push({ command, args }); return child },
      now: () => 456,
    })

    assert.deepEqual(await updater.status(), { phase: 'idle', host: 'android' })
    assert.deepEqual(await updater.start(), { phase: 'running', host: 'android', startedAt: 456 })
    assert.deepEqual(calls[0].args.slice(0, 4), [
      '/storage/emulated/0/dsh-tavern/bin/dsh-tavern.mjs', 'update', '--host', 'android',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
