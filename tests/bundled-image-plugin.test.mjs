import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { IMAGE_PLUGIN_HOST_EXPORTS, installBundledImagePlugin } from '../bin/bundled-image-plugin.mjs'
import { mergeProfileManifest } from '../bin/profile-configuration.mjs'

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'tavern-bundled-image-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const directory = path.join(root, 'tavern-plugin/packages/dsh-image-gen')
  mkdirSync(path.join(directory, 'lib'), { recursive: true })
  for (const file of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js']) writeFileSync(path.join(directory, file), '')
  writeFileSync(path.join(directory, 'package.json'), '{"name":"dsh-image-gen","type":"module"}')
  const bootstrap = path.join(root, 'desktop/app.asar.unpacked/cli.js')
  const packages = {}
  for (const [name, exported] of Object.entries(IMAGE_PLUGIN_HOST_EXPORTS)) {
    const target = path.join(path.dirname(bootstrap), 'node_modules', name)
    mkdirSync(target, { recursive: true })
    writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name, version: '0.1.2', type: 'module', exports: './index.js' }))
    writeFileSync(path.join(target, 'index.js'), exported ? `export function ${exported}() {}` : 'export default {}')
    packages[name] = target
  }
  return { root, directory, packages, options: { sourceRoot: root, host: 'desktop', env: { DSH_DESKTOP_DSH_BOOTSTRAP: bootstrap } } }
}

test('内置插件链接所有宿主依赖，无 npm 下载或构建；可重复安装', t => {
  const f = fixture(t)
  for (let i = 0; i < 2; i++) assert.equal(installBundledImagePlugin(f.options).length, 4)
  const require = createRequire(path.join(f.directory, 'probe.cjs'))
  for (const [name, directory] of Object.entries(f.packages)) assert.equal(realpathSync(require.resolve(name)), realpathSync(path.join(directory, 'index.js')))
})

test('缺少构建产物或宿主依赖时拒绝安装，不伪装可用', t => {
  const f = fixture(t)
  rmSync(path.join(f.directory, 'lib/client.js'))
  assert.throws(() => installBundledImagePlugin(f.options), /内置生图插件不完整/)
  writeFileSync(path.join(f.directory, 'lib/client.js'), '')
  rmSync(f.packages['@deepseek-ai/dsh-credentials'], { recursive: true })
  assert.throws(() => installBundledImagePlugin(f.options), /缺少必需依赖/)
})

test('Profile 删除旧版 Tavern 管理的生图插件注册，保留其他插件', () => {
  const source = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const options = { source, pluginPath: path.resolve('/app/tavern-plugin'), current: {
    dependencies: { 'dsh-image-gen': '^0.3.0', other: '1' },
    dsh: { profile: { bundles: ['dsh-image-gen', 'other'] } },
    dshTavern: { managedBundles: ['dsh-image-gen'], managedDependencies: ['dsh-image-gen'] },
  } }
  const next = mergeProfileManifest(options)
  assert.equal(next.dependencies['dsh-image-gen'], undefined)
  assert.equal(next.dependencies.other, '1')
  assert.equal(next.dsh.profile.bundles.filter(x => x === 'dsh-image-gen').length, 0)
  assert.deepEqual(mergeProfileManifest({ ...options, current: next }), next)
})
