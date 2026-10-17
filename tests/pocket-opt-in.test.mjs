import test from 'node:test'
import assert from 'node:assert/strict'

test('each host drops the patch of the mobile layout it does not install', async () => {
  const { prepareProfileWorkspace, mergeProfileManifest } = await import('../bin/profile-configuration.mjs')
  const { parse } = await import('yaml')
  const { readFile } = await import('node:fs/promises')
  const workspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')
  const source = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  for (const host of ['desktop', 'cli', 'android']) {
    const manifest = mergeProfileManifest({ source, pluginPath: '/x/tavern-plugin', dataRoot: '/x/data', host, dshVersion: '0.1.5-rc.2' })
    const patched = Object.keys(parse(prepareProfileWorkspace(workspace, manifest)).patchedDependencies || {})
    for (const key of patched) {
      const name = key.slice(0, key.lastIndexOf('@'))
      assert.ok(manifest.dependencies[name], `${host} 声明了未安装包的补丁：${key}`)
    }
    assert.equal(patched.some(key => key.startsWith('dsh-web-mobile@')), host === 'android')
  }
})
