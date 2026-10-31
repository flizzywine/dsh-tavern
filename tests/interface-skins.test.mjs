// 界面皮肤: imported CSS files with one active at a time, and the public skin contract
// (variables and class names listed in interface-skin.md) that must keep existing.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createInterfaceSkins } from '../tavern-plugin/packages/dsh-dream-skin/lib/interface-skins.js'

async function withSkins(run) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'tavern-skins-'))
  try { await run(createInterfaceSkins({ store: createProfileDataStore({ dataRoot }) }), dataRoot) }
  finally { await rm(dataRoot, { recursive: true, force: true }) }
}

test('导入的皮肤立即启用，可切回默认、切换、删除', async () => {
  await withSkins(async (skins, dataRoot) => {
    assert.deepEqual((await skins.list()).skins.map(({ id, name, builtin }) => ({ id, name, builtin })), [{ id: 'builtin:paper', name: '纸感', builtin: true }])
    assert.deepEqual(await skins.active(), { id: null, css: '' })
    const first = await skins.importSkin({ name: '我的.css', css: 'body { color: red }' })
    assert.equal(first.skins[1].name, '我的')
    assert.equal(first.active, first.skins[1].id)
    assert.deepEqual(await skins.active(), { id: first.active, css: 'body { color: red }' })
    const second = await skins.importSkin({ name: 'dark.css', css: 'body { color: blue }' })
    assert.equal(second.skins.length, 3)
    assert.equal((await skins.active()).css, 'body { color: blue }')
    assert.equal((await skins.select(first.active)).active, first.active)
    assert.equal((await skins.select(null)).active, null)
    assert.equal((await skins.active()).css, '')
    await skins.select(second.active)
    const removed = await skins.remove(second.active)
    assert.equal(removed.active, null)
    assert.deepEqual(removed.skins.map(skin => skin.name), ['纸感', '我的'])
    assert.deepEqual((await readdir(path.join(dataRoot, 'interface-skins'))).sort(), [first.active + '.css', 'index.json'].sort())
  })
})

test('内置皮肤可以选用、不能删除，默认不启用', async () => {
  await withSkins(async skins => {
    assert.equal((await skins.list()).active, null)
    assert.equal((await skins.select('builtin:paper')).active, 'builtin:paper')
    const { id, css } = await skins.active()
    assert.equal(id, 'builtin:paper')
    assert.match(css, /@font-face/)
    await assert.rejects(skins.remove('builtin:paper'), /内置皮肤不能删除/)
    await assert.rejects(skins.select('builtin:none'), /皮肤不存在/)
  })
})

test('空文件、超大文件和不存在的皮肤被拒绝', async () => {
  await withSkins(async skins => {
    await assert.rejects(skins.importSkin({ name: 'a.css', css: '  ' }), /皮肤文件为空/)
    await assert.rejects(skins.importSkin({ name: 'a.css', css: 'a'.repeat(5 * 1024 * 1024 + 1) }), /5 MB/)
    await assert.rejects(skins.select('../../etc'), /皮肤不存在/)
    await assert.rejects(skins.select('0123456789ab'), /皮肤不存在/)
    await assert.rejects(skins.remove('../x'), /皮肤不存在/)
    assert.equal((await skins.list()).skins.length, 1)
  })
})

test('皮肤规范列出的变量和类名都还在', async () => {
  const root = new URL('../', import.meta.url)
  const spec = await readFile(new URL('presets/tavern/skills/tavern-plugin/references/interface-skin.md', root), 'utf8')
  const css = await readFile(new URL('tavern-plugin/lib/client-assets/tavern.css', root), 'utf8')
  const client = await readFile(new URL('tavern-plugin/lib/client.js', root), 'utf8')
  const variables = [...spec.matchAll(/^\| `(--dsh-tavern-[a-z-]+)`/gm)].map(match => match[1])
  const classes = [...spec.matchAll(/^\| `\.(dsh-tavern-[a-z-]+)`/gm)].map(match => match[1])
  assert.ok(variables.length >= 10 && classes.length >= 10)
  for (const name of variables) assert.match(css, new RegExp(name.replace(/-/g, '\\-') + ':'), `tavern.css 不再定义 ${name}`)
  for (const name of classes) assert.match(client, new RegExp('["\\s]' + name + '["\\s]'), `界面不再输出类名 ${name}`)
})
