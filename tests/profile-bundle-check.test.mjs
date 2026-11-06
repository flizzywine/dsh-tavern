import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
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

// The host skips a bundle whose @deepseek-ai/dsh* peer misses the running DSH version, so an
// exact-version pin drops the bundle on every newer DSH the installer still accepts.
test('酒馆自带插件包的 DSH peer 覆盖整个支持的 DSH 版本范围', async () => {
  const semver = createRequire(import.meta.url)('semver')
  const root = new URL('../', import.meta.url)
  const json = async file => JSON.parse(await readFile(new URL(file, root), 'utf8'))
  const { minDshVersion, belowDshVersion } = await json('config/dsh-compatibility.json')
  const supported = `>=${minDshVersion} <${belowDshVersion}`
  const manifest = await json('package.json')
  const local = manifest.dsh.profile.bundles
    .map(name => manifest.devDependencies?.[name])
    .filter(spec => spec?.startsWith('link:'))
  assert.ok(local.length > 0)
  const uncovered = []
  for (const spec of local) {
    const bundle = await json(`${spec.slice('link:./'.length)}/package.json`)
    for (const [name, range] of Object.entries(bundle.peerDependencies || {})) {
      if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
      if (!semver.subset(supported, range, { includePrerelease: true })) uncovered.push(`${bundle.name} ${name}@${range}`)
    }
  }
  assert.deepEqual(uncovered, [], `must cover ${supported}`)
})

// 0.2.0 宿主上装了要求 ^0.2.1 的 dsh-better-sidebar：--dump-config 照样通过，启动时才被跳过。
test('用宿主自己的加载器发现 peerDependencies 不满足而被跳过的插件包', { skip: !dsh && '需要已安装的 DSH' }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tavern-bundle-check-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await cp(bridge, path.join(dir, 'node_modules', 'dsh-tavern-launcher'), { recursive: true })
  for (const name of ['dsh-too-new', 'user-too-new']) {
    await mkdir(path.join(dir, 'node_modules', name), { recursive: true })
    await writeFile(path.join(dir, 'node_modules', name, 'package.json'), JSON.stringify({
      name, version: '1.0.0', peerDependencies: { '@deepseek-ai/dsh-app-boot': '^99.0.0' }, dsh: { bundle: {} },
    }))
  }
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern', private: true, dsh: { profile: { bundles: ['dsh-tavern-launcher', 'dsh-too-new', 'user-too-new'] } } }))

  const warnings = []
  await assert.rejects(
    assertProfileBundlesLoad({ dsh, host: 'cli', profileDir: dir, managedBundles: ['dsh-tavern-launcher', 'dsh-too-new'], log: message => warnings.push(message) }),
    error => /dsh-too-new：/.test(error.message) && /\^99\.0\.0/.test(error.message) && !/user-too-new/.test(error.message),
  )
  assert.match(warnings.join('\n'), /user-too-new/)
  await assertProfileBundlesLoad({ dsh, host: 'cli', profileDir: dir, managedBundles: ['dsh-tavern-launcher'], log: () => {} })
})
