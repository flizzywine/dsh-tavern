import assert from 'node:assert/strict'
import { mkdir, rm, truncate, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createFileSymlink } from './helpers/file-symlink.mjs'
import { mkdtemp } from 'node:fs/promises'

import { createMobileCardImport } from '../tavern-plugin/lib/domain/mobile-card-import.js'

test('Android 下载目录人物卡只列出受限目录里的 PNG/JSON，并按选择读取', { skip: process.platform === 'win32' ? 'Requires symlinks, which Windows only allows with extra privileges' : false }, async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-mobile-card-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const downloads = path.join(root, 'Download')
  const outside = path.join(root, 'outside.json')
  await mkdir(downloads, { recursive: true })
  await writeFile(path.join(downloads, '阿青.json'), JSON.stringify({ name: '阿青' }))
  await writeFile(path.join(downloads, '说明.txt'), 'not a card')
  await writeFile(outside, JSON.stringify({ name: '越界' }))

  const imports = createMobileCardImport({
    runtimeHost: 'android',
    roots: [{ id: 'downloads', label: '手机 Download', path: downloads }]
  })
  const catalog = await imports.list()

  assert.equal(catalog.available, true)
  assert.equal(catalog.storageAccessible, true)
  assert.deepEqual(catalog.files.map(function (file) { return file.name }), ['阿青.json'])
  assert.equal(catalog.files[0].directory, '手机 Download')
  assert.equal('path' in catalog.files[0], false)

  assert.deepEqual(await imports.read(catalog.files[0].id), {
    kind: 'text', name: '阿青.json', text: JSON.stringify({ name: '阿青' })
  })
  const traversalId = 'downloads:' + Buffer.from('../outside.json').toString('base64url')
  await assert.rejects(imports.read(traversalId), /无效|不允许/)
  await t.test('下载目录中的文件符号链接不会被列为人物卡', async t => {
    if (!createFileSymlink(t, outside, path.join(downloads, '越界.json'))) return
    assert.deepEqual((await imports.list()).files.map(file => file.name), ['阿青.json'])
  })
})

test('Android 下载目录直接读取任意大小的 DSH 卡包、CHARX 和素材包 ZIP，PNG/JSON 限制为 32 MiB', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-mobile-archive-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const big = 3 * 1024 ** 3
  const archives = ['示例卡.DSHCARD', '舞台.CHARX', '示例素材包.zip']
  for (const name of archives) {
    await writeFile(path.join(root, name), '')
    await truncate(path.join(root, name), big)
  }
  for (const extension of ['json', 'png']) {
    const legacy = path.join(root, 'large.' + extension)
    await writeFile(legacy, '')
    await truncate(legacy, 32 * 1024 ** 2 + 1)
  }

  const imports = createMobileCardImport({ runtimeHost: 'android', roots: [{ id: 'download', label: 'Download', path: root }] })
  const { files } = await imports.list()
  assert.deepEqual(files.map(item => [item.name, item.size]).sort(), archives.map(name => [name, big]).sort())
  for (const item of files) {
    assert.deepEqual(await imports.archive(item.id), { file: path.join(root, item.name), name: item.name })
    await assert.rejects(imports.read(item.id), /请通过卡包入口/)
  }

  await rm(path.join(root, '示例素材包.zip'))
  assert.deepEqual((await imports.list()).files.map(item => item.name).sort(), ['舞台.CHARX', '示例卡.DSHCARD'].sort())
  await assert.rejects(imports.archive(files.find(item => item.name.endsWith('.zip')).id), /不存在|过大/)
})
