import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { syncPatchText, syncUserPlugins } from '../tavern-plugin/lib/domain/user-plugins.js'

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
  if (pkg) await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg))
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text)
  return dir
}

test('plugins 目录里的插件写进 profile patch，用户自己的条目原样保留', async t => {
  const { dataRoot, profile } = await home(t)
  const patch = path.join(profile, 'cordis.patch.yml')
  await writeFile(patch, '# 我的覆盖\n- id: approval\n  config:\n    policy: never\n')
  const dir = await plugin(dataRoot, 'memory', { name: 'dsh-tavern-memory', exports: { '.': './index.mjs', './client': './client.js' }, dsh: { client: { platform: 'web' } } })
  await plugin(dataRoot, 'broken', null)
  const warnings = []
  const result = await syncUserPlugins({ dataRoot, logger: { warn: text => warnings.push(text) } })
  assert.equal(result.changed, true)
  const text = await readFile(patch, 'utf8')
  assert.match(text, /# 我的覆盖/)
  assert.deepEqual(parse(text), [
    { id: 'approval', config: { policy: 'never' } },
    { insert: [{ id: 'tavern-user-plugin-dsh-tavern-memory', name: path.join(dir, 'index.mjs') }] },
  ])
  assert.match(warnings.join('\n'), /plugins\/broken：缺少 package\.json/)
  assert.equal((await syncUserPlugins({ dataRoot, logger: { warn() {} } })).changed, false, '没有变化时不改写文件')

  await rm(dir, { recursive: true })
  await syncUserPlugins({ dataRoot, logger: { warn() {} } })
  assert.deepEqual(parse(await readFile(patch, 'utf8')), [{ id: 'approval', config: { policy: 'never' } }], '删掉文件夹后条目随之移除')
})

test('没有插件也没有旧条目时不碰 patch 文件；非 Tavern profile 时跳过', async t => {
  assert.equal(syncPatchText('[]', []), null)
  const { dataRoot, profile } = await home(t)
  await rm(path.join(profile, 'package.json'))
  await plugin(dataRoot, 'a', { name: 'a', main: 'index.mjs' })
  assert.equal((await syncUserPlugins({ dataRoot })).skipped, true)
})

test('缺少宿主入口的插件不登记', async t => {
  const { dataRoot } = await home(t)
  await plugin(dataRoot, 'ui-only', { name: 'ui-only', exports: { './client': './client.js' } }, { 'client.js': '' })
  await plugin(dataRoot, 'missing', { name: 'missing', main: 'nope.mjs' })
  const result = await syncUserPlugins({ dataRoot, logger: { warn() {} } })
  assert.deepEqual(result.plugins, [])
  assert.deepEqual(result.problems.map(problem => problem.folder).sort(), ['missing', 'ui-only'])
})

test('不折行改写用户的长路径；与已安装的包重名的插件不登记；同一原因只警告一次', async t => {
  const { dataRoot, profile } = await home(t)
  const long = '/very/long/' + 'path/'.repeat(30) + 'index.mjs'
  const patch = path.join(profile, 'cordis.patch.yml')
  await writeFile(patch, `- id: mine\n  name: "${long}"\n`)
  await mkdir(path.join(profile, 'node_modules', 'dsh-tavern-plugin'), { recursive: true })
  await writeFile(path.join(profile, 'node_modules', 'dsh-tavern-plugin', 'package.json'), '{}')
  await plugin(dataRoot, 'clash', { name: 'dsh-tavern-plugin', main: 'index.mjs' })
  await plugin(dataRoot, 'ok', { name: 'ok', main: 'index.mjs' })
  const warnings = []
  const logger = { warn: text => warnings.push(text) }
  await syncUserPlugins({ dataRoot, logger })
  await syncUserPlugins({ dataRoot, logger })
  const text = await readFile(patch, 'utf8')
  assert.ok(text.includes(`"${long}"`), '用户原有的长行保持一行')
  assert.deepEqual(parse(text).at(-1).insert.map(entry => entry.id), ['tavern-user-plugin-ok'])
  assert.equal(warnings.filter(text => text.includes('plugins/clash')).length, 1)
})
