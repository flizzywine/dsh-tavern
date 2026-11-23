import test from 'node:test'
import assert from 'node:assert/strict'
import { imagePluginFixture } from './fixtures/image-plugin-runtime.mjs'

const hash = letter => String(letter).repeat(64)
// 参考图存储返回的 descriptor：id 是 64 位小写 SHA-256，字节数来自实际文件。
const sample = (letter, patch = {}) => ({ id: hash(letter), mediaType: 'image/png', name: letter + '.png', byteLength: 64, ...patch })

test('画风示例图在配置里只存 descriptor：非法引用被丢弃，每套最多 8 张', async t => {
  const f = await imagePluginFixture(t)
  const runtime = await f.start()
  const result = await runtime.request('config', {
    stylePresets: [{
      id: 'p1', name: '示例画风', artist: 'masterpiece, style', negative: 'lowres', position: 'prefix', enabled: true,
      samples: [
        sample('a'),
        { id: 'not-a-hash', mediaType: 'image/png', name: 'bad-id.png', byteLength: 64 },
        sample('b', { mediaType: 'image/gif' }),
        sample('c', { byteLength: 0 }),
        sample('d', { path: 'C:/secret.png' }),
        ...Array.from({ length: 9 }, (_, index) => sample(index)),
      ],
    }],
  })
  assert.equal(result.status, 200)
  const saved = result.body.state.config.stylePresets[0]
  assert.equal(saved.samples.length, 8, '每套最多保留 8 张示例图')
  assert.deepEqual(Object.keys(saved.samples[0]).sort(), ['byteLength', 'id', 'mediaType', 'name'], '只保存参考图描述符的四个字段')
  assert.ok(saved.samples.every(item => /^[0-9a-f]{64}$/.test(item.id)), '非法编号不会进入配置')
  assert.ok(saved.samples.every(item => ['image/png', 'image/jpeg', 'image/webp'].includes(item.mediaType)), '只保留支持的图片类型')
  assert.ok(saved.samples.every(item => !Object.hasOwn(item, 'path')), '不接受路径或 URL')
  // 同一套画风原有字段不受影响
  assert.equal(saved.artist, 'masterpiece, style')
  assert.equal(saved.negative, 'lowres')
  assert.equal(saved.name, '示例画风')
  // 落到磁盘的 config.json 也要带着这些引用
  const onDisk = await f.read('config.json')
  assert.equal(onDisk.stylePresets[0].samples.length, 8)
})

test('没有示例图的画风保存后仍是空数组，位置与开关照旧', async t => {
  const f = await imagePluginFixture(t)
  const runtime = await f.start()
  const result = await runtime.request('config', {
    stylePresets: [{ id: 'p2', name: '旧画风', artist: 'soft light', position: 'suffix', enabled: false }],
  })
  assert.equal(result.status, 200)
  const saved = result.body.state.config.stylePresets[0]
  assert.deepEqual(saved.samples, [], '未上传示例图时给空数组，前端不必再判空')
  assert.equal(saved.position, 'suffix')
  assert.equal(saved.enabled, false)
})
