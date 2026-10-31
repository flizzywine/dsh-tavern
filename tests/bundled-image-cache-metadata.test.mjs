import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readImageFileMetadata } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-file-metadata.js'
import { imagePluginFixture, IMAGE_PNG } from './fixtures/image-plugin-runtime.mjs'

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-image-metadata-'))
  try { await run(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

async function mtimeMs(file) {
  const handle = await open(file, 'r')
  try { return (await handle.stat()).mtimeMs } finally { await handle.close() }
}

function pngHeader(width, height) {
  const header = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header)
  header.write('IHDR', 12, 'ascii')
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  return header
}

test('读取 PNG、JPEG 和 WebP 的头部元数据', async () => {
  await withTempDir(async dir => {
    const png = join(dir, 'image.img')
    const jpeg = join(dir, 'image.jpg')
    const webp = join(dir, 'image.webp')
    await writeFile(png, Buffer.concat([pngHeader(1024, 768), Buffer.alloc(9)]))
    await writeFile(jpeg, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]))
    const webpHeader = Buffer.alloc(24)
    webpHeader.write('RIFF', 0, 'ascii')
    webpHeader.write('WEBP', 8, 'ascii')
    await writeFile(webp, webpHeader)

    assert.deepEqual(await readImageFileMetadata(png), {
      mediaType: 'image/png', width: 1024, height: 768,
      byteLength: 33, mtimeMs: await mtimeMs(png),
    })
    assert.equal((await readImageFileMetadata(jpeg)).mediaType, 'image/jpeg')
    assert.deepEqual(await readImageFileMetadata(webp), {
      mediaType: 'image/webp', width: null, height: null,
      byteLength: 24, mtimeMs: await mtimeMs(webp),
    })
  })
})

test('短文件、空文件和坏头不抛错并保留未知 MIME 与尺寸', async () => {
  await withTempDir(async dir => {
    const short = join(dir, 'short.img')
    const empty = join(dir, 'empty.img')
    const badPng = join(dir, 'bad.img')
    await writeFile(short, Buffer.from([0x89, 0x50, 0x4e]))
    await writeFile(empty, Buffer.alloc(0))
    const bad = Buffer.alloc(25)
    bad[1] = 0x50
    bad[2] = 0x4e
    await writeFile(badPng, bad)

    assert.deepEqual(await readImageFileMetadata(short), {
      mediaType: '', width: null, height: null, byteLength: 3,
      mtimeMs: await mtimeMs(short),
    })
    assert.equal((await readImageFileMetadata(empty)).byteLength, 0)
    assert.equal((await readImageFileMetadata(empty)).mediaType, '')
    assert.deepEqual((({ width, height }) => ({ width, height }))(await readImageFileMetadata(badPng)), { width: 0, height: 0 })
    await assert.rejects(readImageFileMetadata(join(dir, 'missing.png')), { code: 'ENOENT' })
  })
})

test('大图片文件只请求读取最多 24 字节，并关闭文件句柄', async () => {
  await withTempDir(async dir => {
    const file = join(dir, 'large.img')
    const payloadBytes = 8 * 1024 * 1024
    await writeFile(file, Buffer.concat([pngHeader(1920, 1080), Buffer.alloc(payloadBytes)]))
    const readLengths = []
    let closed = false
    const result = await readImageFileMetadata(file, {
      openFile: async (...args) => {
        const handle = await open(...args)
        return {
          stat: () => handle.stat(),
          read: (...readArgs) => {
            readLengths.push(readArgs[2])
            return handle.read(...readArgs)
          },
          close: async () => { closed = true; return handle.close() },
        }
      },
    })

    assert.deepEqual(readLengths, [24])
    assert.equal(closed, true)
    assert.equal(result.byteLength, payloadBytes + 24)
    assert.equal(result.mediaType, 'image/png')
    assert.equal(result.width, 1920)
    assert.equal(result.height, 1080)
  })
})

test('runtime 从 orphan PNG 恢复图库状态，并恢复无 MIME 旧作业与去重 key', async t => {
  const fixture = await imagePluginFixture(t)
  const cacheDir = join(fixture.pluginRoot, 'cache')
  await mkdir(cacheDir, { recursive: true })
  const orphanId = '00000000-0000-4000-8000-000000000101'
  const legacyId = '00000000-0000-4000-8000-000000000102'
  const repairedId = '00000000-0000-4000-8000-000000000103'
  const orphanFile = join(cacheDir, orphanId + '.png')
  const legacyFile = join(cacheDir, legacyId + '.img')
  const repairedFile = join(cacheDir, repairedId + '.img')
  await writeFile(orphanFile, IMAGE_PNG)
  await writeFile(legacyFile, IMAGE_PNG)
  await writeFile(repairedFile, IMAGE_PNG)
  await writeFile(join(fixture.pluginRoot, 'jobs-store.json'), JSON.stringify({
    [legacyId]: {
      id: legacyId, state: 'done', createdAt: 1, key: 'restored-cache-key',
      positive: 'a saved image', file: legacyFile, params: {},
    },
    [repairedId]: {
      id: repairedId, state: 'running', createdAt: 2, mediaType: 'image/png',
      byteLength: 0, file: repairedFile, size: { width: 2, height: 2 }, params: {},
    },
  }))

  const runtime = await fixture.start()
  const state = await runtime.request('state')
  const orphan = state.body.jobs.find(job => job.id === orphanId)
  assert.ok(orphan)
  assert.equal(orphan.state, 'done')
  assert.equal(orphan.size, '2x2')
  assert.equal(orphan.mediaType, 'image/png')
  assert.equal(orphan.byteLength, IMAGE_PNG.length)
  assert.equal(orphan.hasImage, true)
  const repaired = state.body.jobs.find(job => job.id === repairedId)
  assert.ok(repaired)
  assert.equal(repaired.state, 'done')
  assert.equal(repaired.percent, 100)
  assert.equal(repaired.byteLength, IMAGE_PNG.length)
  assert.equal(repaired.mediaType, 'image/png')

  const legacy = await runtime.request('jobs?key=restored-cache-key')
  assert.equal(legacy.body.job.id, legacyId)
  assert.equal(legacy.body.job.state, 'done')
  assert.equal(legacy.body.job.mediaType, 'image/png')
  const reused = await runtime.request('jobs', { tag: 'a saved image', key: 'restored-cache-key' })
  assert.equal(reused.body.id, legacyId)
})
