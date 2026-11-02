import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { findDshCommand } from '../bin/launcher-environment.mjs'
import { assertProfileBundlesLoad, skippedBundleFailure } from '../bin/profile-bundle-check.mjs'

const bridge = fileURLToPath(new URL('../tavern-plugin/packages/dsh-profile-bridge', import.meta.url))
let dsh = null
try { dsh = findDshCommand() } catch {}

test('酒馆自己的插件包被跳过是安装失败；用户自加的只提示', () => {
  const skipped = [
    { packageName: 'dsh-better-sidebar', reason: 'requirements {"@deepseek-ai/dsh-app-boot":"^0.2.1"}' },
    { packageName: 'someone-else', reason: 'cannot resolve' },
  ]
  const { error, ignored } = skippedBundleFailure(skipped, ['dsh-tavern-plugin', 'dsh-better-sidebar'])
  assert.match(error.message, /跳过酒馆的插件包/)
  assert.match(error.message, /dsh-better-sidebar：requirements/)
  assert.doesNotMatch(error.message, /someone-else/)
  assert.deepEqual(ignored.map(item => item.packageName), ['someone-else'])
  assert.equal(skippedBundleFailure(skipped.slice(1), ['dsh-better-sidebar']).error, null)
})

// 0.2.0 宿主上装了要求 ^0.2.1 的 dsh-better-sidebar：--dump-config 照样通过，启动时才被跳过。
test('用宿主自己的加载器发现 peerDependencies 不满足而被跳过的插件包', { skip: !dsh && '需要已安装的 DSH' }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tavern-bundle-check-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await cp(bridge, path.join(dir, 'node_modules', 'dsh-profile-bridge'), { recursive: true })
  for (const name of ['dsh-too-new', 'user-too-new']) {
    await mkdir(path.join(dir, 'node_modules', name), { recursive: true })
    await writeFile(path.join(dir, 'node_modules', name, 'package.json'), JSON.stringify({
      name, version: '1.0.0', peerDependencies: { '@deepseek-ai/dsh-app-boot': '^99.0.0' }, dsh: { bundle: {} },
    }))
  }
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern', private: true, dsh: { profile: { bundles: ['dsh-profile-bridge', 'dsh-too-new', 'user-too-new'] } } }))

  const warnings = []
  await assert.rejects(
    assertProfileBundlesLoad({ dsh, host: 'cli', profileDir: dir, managedBundles: ['dsh-profile-bridge', 'dsh-too-new'], log: message => warnings.push(message) }),
    error => /dsh-too-new：/.test(error.message) && /\^99\.0\.0/.test(error.message) && !/user-too-new/.test(error.message),
  )
  assert.match(warnings.join('\n'), /user-too-new/)
  await assertProfileBundlesLoad({ dsh, host: 'cli', profileDir: dir, managedBundles: ['dsh-profile-bridge'], log: () => {} })
})
