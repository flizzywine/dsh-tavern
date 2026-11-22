import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { fingerprint } from '../android/native/shims/source-update.mjs'

async function tree(overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-fp-'))
  const files = {
    'package.json': JSON.stringify({ name: 'x', version: '3.4.0', dependencies: { a: '1.0.0' }, dsh: { profile: { bundles: ['b'] } } }),
    'pnpm-lock.yaml': 'lock: 1\n',
    'tavern-plugin/package.json': JSON.stringify({ name: 'p', version: '1.0.0', dependencies: { c: '^2.0.0' } }),
    'tavern-plugin/pnpm-lock.yaml': 'lock: 2\n',
    'tavern-plugin/packages/remote/package.json': JSON.stringify({ name: 'r', version: '0.1.0', dependencies: { d: '1' } }),
    'patches/a@1.0.0.patch': 'diff\n',
    'config/dsh-compatibility.json': '{"supported":["0.2.1-rc.2"]}',
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
  ]) assert.notEqual(await make(overrides), base, `${label}变化需要新安装包`)
})
