import assert from 'node:assert/strict'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mkdtemp } from 'node:fs/promises'

import { createMobileCardImport } from '../tavern-plugin/lib/domain/mobile-card-import.js'

test('Android 下载目录人物卡只列出受限目录里的 PNG/JSON，并按选择读取', async function () {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-mobile-card-'))
  const downloads = path.join(root, 'Download')
  const outside = path.join(root, 'outside.json')
  await mkdir(downloads, { recursive: true })
  await writeFile(path.join(downloads, '阿青.json'), JSON.stringify({ name: '阿青' }))
  await writeFile(path.join(downloads, '说明.txt'), 'not a card')
  await writeFile(outside, JSON.stringify({ name: '越界' }))
  await symlink(outside, path.join(downloads, '越界.json'))

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
})

test('非 Android 宿主不开放下载目录导入', async function () {
  const imports = createMobileCardImport({ runtimeHost: 'cli', roots: [] })
  assert.deepEqual(await imports.list(), { available: false, files: [] })
})

test('Android 下载目录不可读时不伪装成空目录', async function () {
  const imports = createMobileCardImport({
    runtimeHost: 'android',
    roots: [{ id: 'downloads', label: '手机 Download', path: '/path/that/does/not/exist' }]
  })
  assert.deepEqual(await imports.list(), { available: true, storageAccessible: false, files: [] })
})

test('下载目录导入拒绝过大文件', async function () {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-mobile-card-large-'))
  await writeFile(path.join(root, 'large.json'), '12345')
  const imports = createMobileCardImport({
    runtimeHost: 'android', maxBytes: 4,
    roots: [{ id: 'downloads', label: '手机 Download', path: root }]
  })
  assert.deepEqual((await imports.list()).files, [])
})
