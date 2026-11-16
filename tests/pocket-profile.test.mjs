import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse } from 'yaml'
import { mergeProfileManifest, prepareProfileWorkspace, syncProfileDependencyPatches } from '../bin/profile-configuration.mjs'

const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
const source = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const workspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')

for (const host of ['desktop', 'next', 'android', 'cli']) {
  test(`Pocket dependency upgrade selects and copies the installed host's patch (${host})`, async t => {
    const profileDir = await mkdtemp(path.join(tmpdir(), 'tavern-pocket-profile-'))
    t.after(() => rm(profileDir, { recursive: true, force: true }))
    const current = {
      dependencies: { 'dsh-pocket': '2.12.0', 'user-plugin': '1.0.0' },
      dsh: { profile: { bundles: ['dsh-pocket', 'user-plugin'] } },
      dshTavern: { managedBundles: ['dsh-pocket'], managedDependencies: ['dsh-pocket'] },
    }
    const options = { source, current, host, dshVersion: '0.2.2-rc.3', pluginPath: path.join(sourceRoot, 'tavern-plugin'), dataRoot: '/fixture/data' }
    const manifest = mergeProfileManifest(options)
    assert.deepEqual(mergeProfileManifest({ ...options, current: manifest }), manifest)
    assert.equal(manifest.dependencies['user-plugin'], '1.0.0')
    const text = prepareProfileWorkspace(workspace, manifest)
    const patches = parse(text).patchedDependencies
    const copied = syncProfileDependencyPatches({ sourceRoot, profileDir, workspaceText: text })
    const pocketKeys = Object.keys(patches).filter(key => key.startsWith('dsh-pocket@'))
    if (host === 'desktop' || host === 'next') {
      const version = source.devDependencies['dsh-pocket']
      assert.equal(manifest.dependencies['dsh-pocket'], version)
      assert.deepEqual(pocketKeys, [`dsh-pocket@${version}`])
      const patch = patches[pocketKeys[0]]
      assert.ok(copied.includes(path.normalize(patch)))
      assert.equal(await readFile(path.join(profileDir, patch), 'utf8'), await readFile(path.join(sourceRoot, patch), 'utf8'))
    } else {
      assert.equal(manifest.dependencies['dsh-pocket'], undefined)
      assert.deepEqual(pocketKeys, [])
      assert.ok(copied.every(file => !file.includes('dsh-pocket')))
    }
  })
}

test('CLI keeps a user-installed Pocket version without applying another version’s patch', () => {
  const manifest = mergeProfileManifest({
    source, host: 'cli', pluginPath: path.join(sourceRoot, 'tavern-plugin'), dataRoot: '/fixture/data',
    current: { dependencies: { 'dsh-pocket': '2.12.0' }, dsh: { profile: { bundles: ['dsh-pocket'] } } },
  })
  assert.equal(manifest.dependencies['dsh-pocket'], '2.12.0')
  assert.ok(manifest.dsh.profile.bundles.includes('dsh-pocket'))
  const patches = parse(prepareProfileWorkspace(workspace, manifest)).patchedDependencies
  assert.ok(Object.keys(patches).every(key => !key.startsWith('dsh-pocket@')))
})
