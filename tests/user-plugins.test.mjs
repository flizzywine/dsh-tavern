import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { loaderReload, readPatchedUserPlugins, syncUserPlugins, watchUserPlugins } from '../tavern-plugin/lib/domain/user-plugins.js'

async function home(t) {
  const dshHome = await mkdtemp(path.join(tmpdir(), 'user-plugins-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const dataRoot = path.join(dshHome, 'profile-data', 'tavern', 'data')
  const profile = path.join(dshHome, 'profiles', 'tavern')
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(profile, 'package.json'), '{}')
  return { dshHome, dataRoot, profile }
}

async function plugin(dataRoot, folder, pkg, files = { 'index.mjs': 'export function apply() {}\n' }) {
  const dir = path.join(dataRoot, 'plugins', folder)
  await mkdir(dir, { recursive: true })
  if (pkg) await writeFile(path.join(dir, 'package.json'), JSON.stringify({ version: '1.0.0', ...pkg }))
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text)
  return dir
}

test('插件文件夹换了（托管模组启动时重新发布）：从 DSH 启动时的条目重启到新文件夹，没换的不动', async t => {
  const { dataRoot } = await home(t)
  const pkg = { name: 'dsh-tavern-mod-phone', main: 'plugin.mjs' }, files = { 'plugin.mjs': 'export function apply() {}\n' }
  await plugin(dataRoot, 'card-dsh-tavern-mod-phone-aaaaaaaaaaaa', pkg, files)
  await plugin(dataRoot, 'card-dsh-tavern-mod-dice-cccccccccccc', { name: 'dsh-tavern-mod-dice', main: 'plugin.mjs' }, files)
  await syncUserPlugins({ dataRoot, logger: { warn() {} } })
  const loaded = await readPatchedUserPlugins({ dataRoot })
  assert.deepEqual([...loaded.keys()].sort(), ['tavern-user-plugin-dsh-tavern-mod-dice', 'tavern-user-plugin-dsh-tavern-mod-phone'])
  const reloads = []
  let settle
  const done = new Promise(resolve => { settle = resolve })
  const stop = watchUserPlugins({ dataRoot, delay: 50, loaded, logger: { warn() {} }, reload: async (id, entry) => { reloads.push([id, entry]); settle() } })
  t.after(stop)
  await rm(path.join(dataRoot, 'plugins', 'card-dsh-tavern-mod-phone-aaaaaaaaaaaa'), { recursive: true })
  const moved = await plugin(dataRoot, 'card-dsh-tavern-mod-phone-bbbbbbbbbbbb', pkg, files)
  await done
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(reloads, [['tavern-user-plugin-dsh-tavern-mod-phone', path.join(moved, '.tavern-entry.mjs')]])
  assert.equal(loaded.get('tavern-user-plugin-dsh-tavern-mod-phone'), path.join(moved, '.tavern-entry.mjs'), '重启一次后不再重复')
})


for (const pkg of [null, [], 'bad', {}, { name: 'broken' }, { name: 42, version: '1.0.0' }, { name: 'broken', version: 1 }, { name: 'broken', version: '  ' }]) {
  test('invalid manifest is removed from existing registration without rewriting plugin: ' + JSON.stringify(pkg), async t => {
    const { dataRoot, profile } = await home(t)
    const dir = await plugin(dataRoot, 'legacy', { name: 'legacy', version: '1.0.0', main: 'index.mjs' })
    await syncUserPlugins({ dataRoot, logger: { warn() {} } })
    const source = JSON.stringify(pkg)
    await writeFile(path.join(dir, 'package.json'), source)
    const result = await syncUserPlugins({ dataRoot, logger: { warn() {} } })
    assert.deepEqual(result.plugins, [])
    assert.equal(result.problems.length, 1)
    assert.match(result.problems[0].reason, /package.json/)
    assert.deepEqual(parse(await readFile(path.join(profile, 'cordis.patch.yml'), 'utf8')), [])
    assert.equal(await readFile(path.join(dir, 'package.json'), 'utf8'), source)
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'legacy', version: '1.0.0', main: 'index.mjs' }))
    assert.equal((await syncUserPlugins({ dataRoot, logger: { warn() {} } })).plugins.length, 1)
  })
}
