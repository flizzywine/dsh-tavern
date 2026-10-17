import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { deflateSync, inflateSync } from 'node:zlib'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createMobileCardImport } from '../tavern-plugin/lib/domain/mobile-card-import.js'
import { renderPngThumbnail } from '../tavern-plugin/lib/domain/png-thumbnail.js'

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
function readThumbnail(buffer) {
  let offset = SIGNATURE.length
  let header = null
  const idat = []
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    assert.equal(buffer.readUInt32BE(offset + 8 + length), crc32(buffer.subarray(offset + 4, offset + 8 + length)), type + ' 数据块 CRC 应正确')
    if (type === 'IHDR') header = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    offset += length + 12
  }
  assert.ok(header, '缩略图应包含 IHDR')
  const width = header.readUInt32BE(0)
  const height = header.readUInt32BE(4)
  assert.equal(header[8], 8, '缩略图应为 8bit')
  assert.equal(header[12], 0, '缩略图不应隔行')
  const channels = header[9] === 6 ? 4 : 3
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat))
  assert.equal(raw.length, height * (stride + 1), 'IDAT 解压长度应与尺寸一致')
  const pixels = new Uint8Array(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x]
      const left = x >= channels ? pixels[y * stride + x - channels] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const upLeft = (y > 0 && x >= channels) ? pixels[(y - 1) * stride + x - channels] : 0
      let restored = value
      if (filter === 1) restored = value + left
      else if (filter === 2) restored = value + up
      else if (filter === 3) restored = value + ((left + up) >> 1)
      else if (filter === 4) {
        const estimate = left + up - upLeft
        const distances = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)]
        const smallest = Math.min(distances[0], distances[1], distances[2])
        restored = value + (smallest === distances[0] ? left : (smallest === distances[1] ? up : upLeft))
      }
      pixels[y * stride + x] = restored & 0xff
    }
  }
  return {
    width,
    height,
    channels,
    pixel: function (x, y) {
      const index = y * stride + x * channels
      return [pixels[index], pixels[index + 1], pixels[index + 2], channels === 4 ? pixels[index + 3] : 255]
    }
  }
}

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

test('缩略图按面积平均缩小，并输出像素正确的 PNG', () => {
  const source = testPng({ width: 32, height: 32, colorType: 2, rows: rgbRows(32) })
  const thumbnail = renderPngThumbnail(source, { maxEdge: 16 })
  assert.equal(thumbnail.width, 16)
  assert.equal(thumbnail.height, 16)
  const image = readThumbnail(thumbnail.body)
  assert.deepEqual([image.width, image.height], [16, 16])
  assert.equal(image.channels, 3, '不透明图片应写成 RGB 以减小体积')
  assert.deepEqual(image.pixel(0, 0), [4, 4, 0, 255])
  assert.deepEqual(image.pixel(3, 7), [52, 116, 0, 255])
  assert.deepEqual(image.pixel(15, 15), [244, 244, 0, 255])
})

test('缩略图不放大本来就比上限小的图片', () => {
  const source = testPng({ width: 4, height: 4, colorType: 2, rows: rgbRows(4) })
  const thumbnail = renderPngThumbnail(source, { maxEdge: 160 })
  assert.deepEqual([thumbnail.width, thumbnail.height], [4, 4])
  const image = readThumbnail(thumbnail.body)
  assert.deepEqual(image.pixel(2, 3), [16, 24, 0, 255])
})

test('缩略图支持调色板 PNG', () => {
  const palette = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0])
  const rows = []
  for (let y = 0; y < 32; y += 1) {
    const row = Buffer.alloc(32)
    for (let x = 0; x < 32; x += 1) row[x] = (x + y) % 4
    rows.push(row)
  }
  const thumbnail = renderPngThumbnail(testPng({ width: 32, height: 32, colorType: 3, rows, palette }), { maxEdge: 16 })
  const image = readThumbnail(thumbnail.body)
  assert.deepEqual([image.width, image.height], [16, 16])
  // 块 (0,0) = 索引 0/1/1/2 = 红/绿/绿/蓝 的四色平均
  assert.deepEqual(image.pixel(0, 0), [64, 128, 64, 255])
  // 块 (1,0) = 索引 2/3/3/0 = 蓝/黄/黄/红
  assert.deepEqual(image.pixel(1, 0), [191, 128, 64, 255])
})

test('缩略图保留透明像素的 alpha 且不被预乘平均污染', () => {
  const rows = []
  for (let y = 0; y < 32; y += 1) {
    const row = Buffer.alloc(32 * 4)
    for (let x = 0; x < 32; x += 1) {
      row[x * 4] = 200
      row[x * 4 + 1] = 100
      row[x * 4 + 2] = 50
      row[x * 4 + 3] = 128
    }
    rows.push(row)
  }
  const thumbnail = renderPngThumbnail(testPng({ width: 32, height: 32, colorType: 6, rows }), { maxEdge: 16 })
  const image = readThumbnail(thumbnail.body)
  assert.equal(image.channels, 4, '含透明像素的图片应写成 RGBA')
  assert.deepEqual(image.pixel(0, 0), [200, 100, 50, 128])
  assert.deepEqual(image.pixel(15, 15), [200, 100, 50, 128])
})

test('无法识别的图片与隔行 PNG 明确报错，交由调用方降级', () => {
  assert.throws(function () { renderPngThumbnail(Buffer.from('这不是 PNG')) }, /不是有效的 PNG/)
  const interlaced = testPng({ width: 32, height: 32, colorType: 2, rows: rgbRows(32), interlace: 1 })
  assert.throws(function () { renderPngThumbnail(interlaced) }, /隔行/)
})

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

test('非 Android 宿主不提供手机缩略图', async function () {
  const imports = createMobileCardImport({ runtimeHost: 'cli', roots: [] })
  await assert.rejects(imports.thumbnail('downloads:abc'), /不允许从手机下载目录导入/)
})

test('解压炸弹与超大尺寸在分配大块内存前就拒绝', () => {
  // 声明 16×16，图像数据却能解压出 64MB：解压必须按头部算出的长度截止。
  const header = Buffer.alloc(13)
  header.writeUInt32BE(16, 0); header.writeUInt32BE(16, 4); header[8] = 8; header[9] = 2
  const bomb = Buffer.concat([SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(Buffer.alloc(64 * 1024 * 1024))), pngChunk('IEND', Buffer.alloc(0))])
  assert.ok(bomb.length < 200 * 1024)
  assert.throws(function () { renderPngThumbnail(bomb) }, /长度异常/)
  // 2 亿像素只看头部就拒绝，不会去解压。
  header.writeUInt32BE(20000, 0); header.writeUInt32BE(10000, 4)
  const huge = Buffer.concat([SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(Buffer.alloc(16))), pngChunk('IEND', Buffer.alloc(0))])
  assert.throws(function () { renderPngThumbnail(huge) }, /像素过多/)
})
