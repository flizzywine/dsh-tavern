import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  BACKUP_FILE, LOCK_FILE, isEnabled, planDisable, planEnable, readManifest, restoreProfile,
  snapshotProfile, updateProfile, withLock, writeProfile,
} from '../tavern-plugin/packages/dsh-tavern-dshgo/lib/bundles.js'
import { TAVERN_BUNDLES, profileDir } from '../tavern-plugin/packages/dsh-tavern-dshgo/lib/status.js'

function fixture(t, bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']) {
  const home = mkdtempSync(path.join(tmpdir(), 'tavern-dshgo-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const dir = profileDir(home)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'dsh-profile-web', dependencies: { '@deepseek-ai/dsh-base': '^0.2.2' }, dsh: { profile: { bundles } } }, null, 2)}\n`)
  return { home, dir }
}

test('planEnable：按 TAVERN_BUNDLES 顺序补齐，已有项不重复也不提前', () => {
  const manifest = { dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-tavern-plugin', 'dsh-web-mobile'] } } }
  const next = planEnable(manifest)
  assert.deepEqual(next.dsh.profile.bundles, [
    '@deepseek-ai/dsh-base', 'dsh-tavern-plugin', 'dsh-web-mobile',
    ...TAVERN_BUNDLES.filter(name => name !== 'dsh-tavern-plugin' && name !== 'dsh-web-mobile'),
  ])
  assert.deepEqual(planEnable(next).dsh.profile.bundles, next.dsh.profile.bundles, '幂等')
  assert.deepEqual(manifest.dsh.profile.bundles.length, 3, '不改入参')
})

test('planDisable：只摘酒馆的，官方与用户自己的 bundle 原样保留', () => {
  const manifest = { dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', ...TAVERN_BUNDLES, 'dsh-user-thing'] } } }
  assert.deepEqual(planDisable(manifest).dsh.profile.bundles, ['@deepseek-ai/dsh-base', 'dsh-user-thing'])
})

test('isEnabled：8 个齐才算启用', () => {
  assert.equal(isEnabled({ dsh: { profile: { bundles: [...TAVERN_BUNDLES] } } }), true)
  assert.equal(isEnabled({ dsh: { profile: { bundles: TAVERN_BUNDLES.slice(1) } } }), false)
  assert.equal(isEnabled({}), false)
})

test('withLock：占锁期间再进一次直接报错，结束后锁文件被删掉', (t) => {
  const { dir } = fixture(t)
  let second = null
  withLock(dir, () => {
    assert.ok(existsSync(path.join(dir, LOCK_FILE)))
    assert.equal(readFileSync(path.join(dir, LOCK_FILE), 'utf8'), `${process.pid}\n`)
    assert.throws(() => withLock(dir, () => {}), /package\.json\.lock/)
    try { withLock(dir, () => {}) } catch (error) { second = error }
  })
  assert.match(String(second), /正在改这份配置/)
  assert.equal(existsSync(path.join(dir, LOCK_FILE)), false)
})

test('withLock：回调抛错也释放锁', (t) => {
  const { dir } = fixture(t)
  assert.throws(() => withLock(dir, () => { throw new Error('boom') }), /boom/)
  assert.equal(existsSync(path.join(dir, LOCK_FILE)), false)
})

test('writeProfile：tmp + rename，落盘是两空格缩进加换行', (t) => {
  const { dir } = fixture(t)
  const manifest = readManifest(dir)
  manifest.dsh.profile.bundles.push('dsh-tavern-plugin')
  writeProfile(dir, manifest)
  const text = readFileSync(path.join(dir, 'package.json'), 'utf8')
  assert.match(text, /\n {2}"name": "dsh-profile-web",/)
  assert.ok(text.endsWith('}\n'))
  assert.deepEqual(readdirSync(dir), ['package.json'])
})

test('snapshotProfile：只在第一次写快照，之后不覆盖', (t) => {
  const { dir } = fixture(t)
  assert.equal(snapshotProfile(dir), true)
  const first = readFileSync(path.join(dir, BACKUP_FILE), 'utf8')
  writeProfile(dir, planEnable(readManifest(dir)))
  assert.equal(snapshotProfile(dir), false)
  assert.equal(readFileSync(path.join(dir, BACKUP_FILE), 'utf8'), first)
})

test('updateProfile：没变化不写文件，有变化写并保留其它字段', (t) => {
  const { home, dir } = fixture(t, ['@deepseek-ai/dsh-base', ...TAVERN_BUNDLES])
  const before = readFileSync(path.join(dir, 'package.json'), 'utf8')
  const unchanged = updateProfile({ home, apply: planEnable })
  assert.equal(unchanged.changed, false)
  assert.equal(readFileSync(path.join(dir, 'package.json'), 'utf8'), before)

  const changed = updateProfile({ home, apply: planDisable })
  assert.equal(changed.changed, true)
  const after = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  assert.deepEqual(after.dsh.profile.bundles, ['@deepseek-ai/dsh-base'])
  assert.deepEqual(after.dependencies, { '@deepseek-ai/dsh-base': '^0.2.2' })
})

test('updateProfile：第一次启用前留快照，停用后可原样还原', (t) => {
  const { home, dir } = fixture(t)
  const original = readFileSync(path.join(dir, 'package.json'), 'utf8')
  updateProfile({ home, apply: planEnable, beforeFirstChange: true })
  assert.ok(existsSync(path.join(dir, BACKUP_FILE)))
  updateProfile({ home, apply: planDisable })
  restoreProfile(dir)
  assert.equal(readFileSync(path.join(dir, 'package.json'), 'utf8'), original)
})

test('readManifest：缺 dsh.profile.bundles 时补空数组，坏结构报错', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'tavern-dshgo-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const dir = profileDir(home)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), '{"name":"web"}')
  assert.deepEqual(readManifest(dir).dsh.profile.bundles, [])
  writeFileSync(path.join(dir, 'package.json'), '{"dsh":{"profile":[]}}')
  assert.throws(() => readManifest(dir), /dsh\.profile/)
})
