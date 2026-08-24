import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveEntryConfig } from '../android/dsh-tavern-entry/index.js'
import { configureAndroidProfiles } from '../android/configure-profiles.mjs'

const root = new URL('../', import.meta.url)
const installer = await readFile(new URL('../android/install.sh', import.meta.url), 'utf8')
const updater = await readFile(new URL('../android/update.sh', import.meta.url), 'utf8')
const entryClient = await readFile(new URL('../android/dsh-tavern-entry/client.js', import.meta.url), 'utf8')
const entryManifest = JSON.parse(await readFile(new URL('../android/dsh-tavern-entry/package.json', import.meta.url), 'utf8'))
const mobileManifest = JSON.parse(await readFile(new URL('../android/dsh-client-ui-mobile-adapt/package.json', import.meta.url), 'utf8'))

test('两个 Android 插件的包入口与实际源码一致', async () => {
  for (const [directory, manifest] of [
    ['android/dsh-tavern-entry', entryManifest],
    ['android/dsh-client-ui-mobile-adapt', mobileManifest],
  ]) {
    const main = path.resolve(new URL(directory + '/', root).pathname, manifest.main)
    await access(main)
  }
  assert.equal(entryManifest.exports['.'], './index.js')
  assert.equal(entryManifest.exports['./client'], './client.js')
  assert.equal(mobileManifest.exports['.'].default, './index.js')
  assert.equal(mobileManifest.exports['./client'].default, './client.js')
})

test('自动拉起插件默认使用 3088，并优先读取 Tavern Profile 的真实源码目录', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'dsh-android-entry-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const profile = path.join(home, '.dsh', 'profiles', 'tavern')
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({ dshTavern: { source: '/opt/dsh-tavern' } }), 'utf8')

  assert.deepEqual(resolveEntryConfig({}, home), {
    dshHome: path.join(home, '.dsh'),
    appDir: '/opt/dsh-tavern',
    port: 3088,
  })
  assert.equal(resolveEntryConfig({ DSH_TAVERN_ANDROID_PORT: '3099' }, home).port, 3099)
  assert.throws(() => resolveEntryConfig({ DSH_TAVERN_ANDROID_PORT: '0' }, home), /有效端口/)
  assert.match(entryClient, /127\.0\.0\.1:3088/)
  assert.doesNotMatch(entryClient, /127\.0\.0\.1:3081/)
})

test('Android 安装脚本增量配置两个 Profile，失败不会伪装成成功', () => {
  assert.match(installer, /^#!\/usr\/bin\/env bash\nset -euo pipefail/m)
  assert.match(installer, /DSH_TAVERN_PORT="\$\{TAVERN_PORT\}"/)
  assert.match(installer, /configure-profiles\.mjs/)
  assert.match(installer, /dsh-tavern-entry/)
  assert.match(installer, /dsh-client-ui-mobile-adapt/)
  assert.match(installer, /install --host android/)
  assert.match(installer, /DSH_TAVERN_RUNTIME_HOST="android"/)
  assert.doesNotMatch(installer, /dsh-cost-meter/)
  assert.doesNotMatch(installer, /rm -rf|\|\| true/)
  assert.doesNotMatch(installer, /tavern-plugin\/lib\/client\.js/)
})

test('Android 更新只快进原克隆仓库，并重新执行完整 Android 安装', () => {
  assert.match(updater, /^#!\/usr\/bin\/env bash\nset -euo pipefail/m)
  assert.match(updater, /DSH_TAVERN_SOURCE_ROOT/)
  assert.match(updater, /git -C "\$\{REPO_ROOT\}" fetch origin main/)
  assert.match(updater, /merge-base --is-ancestor HEAD origin\/main/)
  assert.match(updater, /merge --ff-only origin\/main/)
  assert.match(updater, /bin\/dsh-tavern\.mjs" stop/)
  assert.match(updater, /android\/install\.sh/)
  assert.doesNotMatch(updater, /reset --hard|git clean|git checkout/)
})

test('Android Profile 配置保留已有内容并幂等加入所需插件', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-android-profiles-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const tavern = path.join(directory, 'profiles', 'tavern')
  const web = path.join(directory, 'profiles', 'web')
  await mkdir(tavern, { recursive: true })
  await mkdir(web, { recursive: true })
  const initial = {
    private: true,
    dependencies: { existing: '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'existing'] } },
  }
  await writeFile(path.join(tavern, 'package.json'), JSON.stringify(initial), 'utf8')
  await writeFile(path.join(web, 'package.json'), JSON.stringify(initial), 'utf8')

  configureAndroidProfiles({ repoRoot: new URL('..', import.meta.url).pathname, tavernProfile: tavern, webProfile: web })
  configureAndroidProfiles({ repoRoot: new URL('..', import.meta.url).pathname, tavernProfile: tavern, webProfile: web })

  const tavernPkg = JSON.parse(await readFile(path.join(tavern, 'package.json'), 'utf8'))
  const webPkg = JSON.parse(await readFile(path.join(web, 'package.json'), 'utf8'))
  assert.equal(tavernPkg.dependencies.existing, '1.0.0')
  assert.equal(tavernPkg.dsh.profile.bundles.filter((name) => name === 'dsh-client-ui-mobile-adapt').length, 1)
  assert.equal(webPkg.dsh.profile.bundles.filter((name) => name === 'dsh-tavern-entry').length, 1)
  assert.match(webPkg.dependencies['dsh-tavern-entry'], /^link:\//)
})
