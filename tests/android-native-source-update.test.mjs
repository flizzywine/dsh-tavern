import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { fingerprint, runtimeFingerprint } from '../android/native/shims/source-update.mjs'

const TOOL = fileURLToPath(new URL('../android/native/shims/source-update.mjs', import.meta.url))

async function tree(overrides = {}, root) {
  root ||= await mkdtemp(path.join(os.tmpdir(), 'native-fp-'))
  const files = {
    'package.json': JSON.stringify({ name: 'x', version: '3.4.0', dependencies: { a: '1.0.0' }, dsh: { profile: { bundles: ['b'] } } }),
    'pnpm-lock.yaml': 'lock: 1\n',
    'tavern-plugin/package.json': JSON.stringify({ name: 'p', version: '1.0.0', dependencies: { c: '^2.0.0' } }),
    'tavern-plugin/pnpm-lock.yaml': 'lock: 2\n',
    'tavern-plugin/packages/remote/package.json': JSON.stringify({ name: 'r', version: '0.1.0', dependencies: { d: '1' } }),
    'patches/a@1.0.0.patch': 'diff\n',
    'config/dsh-compatibility.json': '{"supported":["0.2.1-rc.2"]}',
    'config/cli-runtime/package.json': '{"dependencies":{"@deepseek-ai/dsh":"0.2.1-rc.2"}}',
    'config/cli-runtime/package-lock.json': '{"lockfileVersion":3}',
    'tavern-plugin/lib/index.js': 'export {}\n',
    ...overrides,
  }
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) continue
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true })
    await writeFile(path.join(root, rel), content)
  }
  return root
}

test('原生 APK 热更新的依赖指纹：只看依赖，不看版本号和程序代码', async (t) => {
  const roots = []
  const make = async overrides => { const r = await tree(overrides); roots.push(r); return fingerprint(r) }
  t.after(() => Promise.all(roots.map(r => rm(r, { recursive: true, force: true }))))
  const base = await make()
  assert.equal(await make(), base, '相同内容指纹相同')
  assert.equal(await make({ 'package.json': JSON.stringify({ name: 'x', version: '3.5.0', dependencies: { a: '1.0.0' }, dsh: { profile: { bundles: ['b'] } } }) }), base, '只改版本号可以热更新')
  assert.equal(await make({ 'tavern-plugin/lib/index.js': 'export const changed = 1\n' }), base, '只改程序代码可以热更新')
  for (const [label, overrides] of [
    ['根依赖', { 'package.json': JSON.stringify({ name: 'x', version: '3.4.0', dependencies: { a: '1.0.1' }, dsh: { profile: { bundles: ['b'] } } }) }],
    ['profile bundles', { 'package.json': JSON.stringify({ name: 'x', version: '3.4.0', dependencies: { a: '1.0.0' }, dsh: { profile: { bundles: ['b', 'c'] } } }) }],
    ['锁文件', { 'pnpm-lock.yaml': 'lock: 9\n' }],
    ['插件锁文件', { 'tavern-plugin/pnpm-lock.yaml': 'lock: 9\n' }],
    ['子包依赖', { 'tavern-plugin/packages/remote/package.json': JSON.stringify({ name: 'r', version: '0.1.0', dependencies: { d: '2' } }) }],
    ['补丁', { 'patches/a@1.0.0.patch': 'diff 2\n' }],
    ['新增补丁', { 'patches/b@1.0.0.patch': 'diff\n' }],
    ['DSH 版本约束', { 'config/dsh-compatibility.json': '{"supported":["0.2.2"]}' }],
  ]) assert.notEqual(await make(overrides), base, `${label}变化需要补装依赖`)
})

test('只有 DSH 运行时变化才需要换安装包', async (t) => {
  const roots = []
  const make = async overrides => { const r = await tree(overrides); roots.push(r); return runtimeFingerprint(r) }
  t.after(() => Promise.all(roots.map(r => rm(r, { recursive: true, force: true }))))
  const base = await make()
  for (const overrides of [{ 'pnpm-lock.yaml': 'lock: 9\n' }, { 'patches/a@1.0.0.patch': 'diff 2\n' }, { 'config/dsh-compatibility.json': '{}' }]) {
    assert.equal(await make(overrides), base, '普通依赖变化在手机上补装')
  }
  assert.notEqual(await make({ 'config/cli-runtime/package.json': '{"dependencies":{"@deepseek-ai/dsh":"0.2.2"}}' }), base)
  assert.notEqual(await make({ 'config/cli-runtime/package-lock.json': '{"lockfileVersion":3,"x":1}' }), base)
})

const run = (root, ...args) => {
  const out = execFileSync(process.execPath, [TOOL, ...args, '--root', root], { encoding: 'utf8' })
  return JSON.parse(out.trim().split('\n').filter(line => line.startsWith('RESULT ')).pop().slice(7))
}
const exists = file => stat(file).then(() => true, () => false)

test('依赖有变化的更新：node_modules 复制给新源码，失败时源码与 profile 原样换回', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-swap-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profile = path.join(root, 'home/.dsh-tavern/profiles/tavern')
  await tree({ 'node_modules/a/index.js': 'old-root', 'tavern-plugin/node_modules/c/index.js': 'old-plugin',
    '.native-source.json': JSON.stringify({ revision: 'old', sequence: 1 }) }, path.join(root, 'src'))
  await tree({ 'tavern-plugin/lib/index.js': 'export const v = 2\n', '.native-source.json': JSON.stringify({ revision: 'new', sequence: 2 }) }, path.join(root, 'src.next'))
  for (const [rel, content] of [['package.json', '{"v":1}'], ['cordis.patch.yml', 'user: 1\n'], ['node_modules/x/index.js', 'old-profile']]) {
    await mkdir(path.dirname(path.join(profile, rel)), { recursive: true })
    await writeFile(path.join(profile, rel), content)
  }

  assert.equal(run(root, 'swap', '--copy-modules').kind, 'swapped')
  assert.equal(await readFile(path.join(root, 'src/tavern-plugin/node_modules/c/index.js'), 'utf8'), 'old-plugin', '新源码拿到一份依赖')
  assert.equal(await readFile(path.join(root, 'src.prev/tavern-plugin/node_modules/c/index.js'), 'utf8'), 'old-plugin', '旧源码保持完整')
  assert.ok((run(root, 'backup', '--modules').saved).includes('home/.dsh-tavern/profiles/tavern/node_modules'))

  // 模拟安装器改动了一切
  await writeFile(path.join(profile, 'package.json'), '{"v":2}')
  await writeFile(path.join(profile, 'node_modules/x/index.js'), 'half-installed')
  await writeFile(path.join(root, 'src/tavern-plugin/node_modules/c/index.js'), 'half-installed')
  await mkdir(path.join(root, 'pnpm-store'), { recursive: true })

  const back = run(root, 'rollback')
  assert.equal(back.kind, 'rolled-back')
  assert.equal(back.source.revision, 'old')
  assert.equal(await readFile(path.join(root, 'src/tavern-plugin/node_modules/c/index.js'), 'utf8'), 'old-plugin')
  assert.equal(await readFile(path.join(root, 'src/node_modules/a/index.js'), 'utf8'), 'old-root')
  assert.equal(await readFile(path.join(profile, 'package.json'), 'utf8'), '{"v":1}')
  assert.equal(await readFile(path.join(profile, 'node_modules/x/index.js'), 'utf8'), 'old-profile')
  assert.equal(await readFile(path.join(profile, 'cordis.patch.yml'), 'utf8'), 'user: 1\n')
  for (const leftover of ['src.prev', 'src.bad', 'update-backup', 'pnpm-store']) assert.equal(await exists(path.join(root, leftover)), false, leftover)
})

test('依赖没变的更新：node_modules 直接搬给新源码；成功后清理备份', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-swap-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await tree({ 'tavern-plugin/node_modules/c/index.js': 'kept', '.dsh-tavern-local.json': '{}', '.native-source.json': JSON.stringify({ revision: 'old', sequence: 1 }) }, path.join(root, 'src'))
  await tree({ '.native-source.json': JSON.stringify({ revision: 'new', sequence: 2 }) }, path.join(root, 'src.next'))
  await mkdir(path.join(root, 'home/.dsh-tavern/profiles/tavern'), { recursive: true })
  await writeFile(path.join(root, 'home/.dsh-tavern/profiles/tavern/package.json'), '{}')
  run(root, 'swap')
  assert.equal(await exists(path.join(root, 'src.prev/tavern-plugin/node_modules')), false, '搬走而不是复制')
  assert.equal(await readFile(path.join(root, 'src/tavern-plugin/node_modules/c/index.js'), 'utf8'), 'kept')
  assert.equal(await exists(path.join(root, 'src/.dsh-tavern-local.json')), true)
  assert.deepEqual(run(root, 'backup').saved, ['home/.dsh-tavern/profiles/tavern/package.json'])
  assert.equal(run(root, 'commit').kind, 'committed')
  for (const leftover of ['src.prev', 'update-backup']) assert.equal(await exists(path.join(root, leftover)), false, leftover)
})
