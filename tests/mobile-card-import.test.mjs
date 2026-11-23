import assert from 'node:assert/strict'
import { mkdir, rm, truncate, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createFileSymlink } from './helpers/file-symlink.mjs'
import { mkdtemp } from 'node:fs/promises'

import { createMobileCardImport } from '../tavern-plugin/lib/domain/mobile-card-import.js'
import { MAX_CARD_UPLOAD_BYTES } from '../tavern-plugin/lib/domain/uploads.js'

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

test('Android 下载目录允许直接读取大体积 DSH 和 CHARX 卡包，PNG/JSON 限制为 32 MiB', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-mobile-archive-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const names = ['辉夜姬.DSHCARD', '舞台.CHARX']
  const max = MAX_CARD_UPLOAD_BYTES
  for (const name of names) {
    const file = path.join(root, name)
    await writeFile(file, '')
    await truncate(file, max)
  }
  for (const extension of ['json', 'png']) {
    const legacy = path.join(root, 'large.' + extension)
    await writeFile(legacy, '')
    await truncate(legacy, 32 * 1024 ** 2 + 1)
  }

  const imports = createMobileCardImport({ runtimeHost: 'android', roots: [{ id: 'download', label: 'Download', path: root }] })
  const { files } = await imports.list()
  assert.deepEqual(files.map(item => item.name).sort(), names.slice().sort())
  for (const { id, name, size } of files) {
    const file = path.join(root, name)
    assert.equal(size, max)
    assert.deepEqual(await imports.archive(id), { file, name })
    await truncate(file, max + 1)
    await assert.rejects(imports.archive(id), /过大/)
  }

  assert.deepEqual((await imports.list()).files, [])
})
