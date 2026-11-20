import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { imagePluginFixture } from './fixtures/image-plugin-runtime.mjs'

// 参考图文件名就是内容的 SHA-256；只有这种名字才算参考图文件。
const KEPT = 'a'.repeat(64)
const ORPHAN = 'b'.repeat(64)

async function seed(f) {
  const directory = join(f.pluginRoot, 'reference-images')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, KEPT), Buffer.alloc(2048))
  await writeFile(join(directory, ORPHAN), Buffer.alloc(4096))
  await writeFile(join(directory, 'not-a-hash.png'), Buffer.alloc(512))
  return directory
}

const fixtureConfig = { stylePresets: [{ id: 'p1', name: '示例画风', artist: 'a', samples: [{ id: KEPT, mediaType: 'image/png', name: 'k.png', byteLength: 2048 }] }] }

test('参考图清理只统计没人引用的文件，预览一个字节都不删', async t => {
  const f = await imagePluginFixture(t, { config: fixtureConfig })
  const runtime = await f.start()
  const directory = await seed(f)
  const preview = await runtime.request('reference-gc')
  assert.equal(preview.status, 200)
  assert.equal(preview.body.total, 2, '只认 64 位小写 SHA-256 文件名，别的文件不参与统计')
  assert.equal(preview.body.referenced, 1, '画风示例图引用的那张要算在引用里')
  assert.equal(preview.body.orphanCount, 1)
  assert.equal(preview.body.orphanBytes, 4096)
  assert.ok(existsSync(join(directory, ORPHAN)), '预览不删文件')
  assert.ok(existsSync(join(directory, KEPT)))
})

test('清理删掉孤儿并保留仍被引用的图，重复清理不再删任何东西', async t => {
  const f = await imagePluginFixture(t, { config: fixtureConfig })
  const runtime = await f.start()
  const directory = await seed(f)
  const done = await runtime.request('reference-gc', {})
  assert.equal(done.status, 200)
  assert.equal(done.body.removed, 1)
  assert.equal(done.body.removedBytes, 4096)
  assert.equal(done.body.kept, 1, '被引用的那张要留着，旧作业才能重画')
  assert.equal(done.body.failed, 0)
  assert.equal(existsSync(join(directory, ORPHAN)), false)
  assert.ok(existsSync(join(directory, KEPT)))
  const again = await runtime.request('reference-gc')
  assert.equal(again.body.orphanCount, 0, '第二次清理没有可删的东西')
  assert.equal(again.body.total, 1)
})
