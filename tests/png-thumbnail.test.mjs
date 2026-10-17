import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { deflateSync } from "node:zlib"
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createMobileCardImport } from '../tavern-plugin/lib/domain/mobile-card-import.js'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (function () {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    table[index] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let value = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) value = CRC_TABLE[(value ^ buffer[index]) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

/** 测试用最小 PNG 编码器：只写未滤波扫描线，足以覆盖解码侧的分支。 */
function testPng(options) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(options.width, 0)
  header.writeUInt32BE(options.height, 4)
  header[8] = options.bitDepth === undefined ? 8 : options.bitDepth
  header[9] = options.colorType
  header[12] = options.interlace === undefined ? 0 : options.interlace
  const parts = [SIGNATURE, pngChunk('IHDR', header)]
  if (options.palette) parts.push(pngChunk('PLTE', options.palette))
  if (options.transparency) parts.push(pngChunk('tRNS', options.transparency))
  const raw = Buffer.concat(options.rows.map(function (row) { return Buffer.concat([Buffer.from([0]), row]) }))
  parts.push(pngChunk('IDAT', deflateSync(raw, { level: 6 })), pngChunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}

/** 独立读取缩略图：校验 chunk CRC、解压长度与反滤波，返回 RGBA 读取器。 */

function rgbRows(size) {
  const rows = []
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(size * 3)
    for (let x = 0; x < size; x += 1) {
      row[x * 3] = x * 8
      row[x * 3 + 1] = y * 8
      row[x * 3 + 2] = 0
    }
    rows.push(row)
  }
  return rows
}

test('手机下载目录为 PNG 提供缩略图，JSON 与不可读图片降级为空', async function () {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-mobile-thumb-'))
  const png = testPng({ width: 32, height: 32, colorType: 2, rows: rgbRows(32) })
  await writeFile(path.join(root, '阿青.png'), png)
  await writeFile(path.join(root, '阿青.json'), JSON.stringify({ name: '阿青' }))
  await writeFile(path.join(root, '坏图.png'), Buffer.concat([SIGNATURE, Buffer.from('broken')]))
  const imports = createMobileCardImport({
    runtimeHost: 'android',
    roots: [{ id: 'downloads', label: '手机 Download', path: root }]
  })
  const catalog = await imports.list()
  const byName = new Map(catalog.files.map(function (file) { return [file.name, file] }))

  const thumbnail = await imports.thumbnail(byName.get('阿青.png').id)
  assert.deepEqual([thumbnail.width, thumbnail.height], [32, 32], '小于上限的图片保持原尺寸')
  assert.ok(Buffer.isBuffer(thumbnail.body))
  assert.equal(await imports.thumbnail(byName.get('阿青.png').id), thumbnail, '同一文件应命中缓存')

  assert.equal(await imports.thumbnail(byName.get('阿青.json').id), undefined, 'JSON 没有缩略图')
  assert.equal(await imports.thumbnail(byName.get('坏图.png').id), undefined, '损坏图片降级而不是抛错')
  await assert.rejects(imports.thumbnail('downloads:' + Buffer.from('../oops.png').toString('base64url')), /无效|不允许/)
})
