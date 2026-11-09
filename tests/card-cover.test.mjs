// 人物卡配封面：JSON 原件变成带卡数据的 PNG，PNG 原件只换像素，没有原件时嵌入当前卡；导出 PNG 能被重新读回。
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createFileResourceStore, stripPngTextChunks } from '../tavern-plugin/lib/domain/file-resources.js'
import { cardAssetSource, pngCardTextChunk, pngRawTextChunks, pngWithTextChunks } from '../tavern-plugin/lib/domain/card-assets.js'

// 一张最小 PNG：签名 + 一个标记像素的 IDAT（内容无所谓，只用来区分图片）+ IEND。
function png(marker) {
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8); return out }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IDAT', Buffer.from(marker)), chunk('IEND', Buffer.alloc(0))])
}

const cardOf = bytes => cardAssetSource({ kind: 'png', fileB64: bytes.toString('base64') }).card

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'card-cover-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createFileResourceStore({ dataRoot: root })
  await store.ensure()
  await store.writeWorking('cards/阿珂.json', JSON.stringify({ kind: 'tavern-card-workspace', version: 1, raw: { name: '阿珂' } }))
  return { root, store, originals: path.join(root, 'originals/cards') }
}

test('JSON 原件配封面后变成 PNG 卡，卡数据原样嵌入、旧 JSON 删除', async t => {
  const { store, originals } = await setup(t)
  const original = JSON.stringify({ spec: 'chara_card_v3', data: { name: '阿珂', description: '原版描述' } })
  await writeFile(path.join(originals, '阿珂.json'), original)
  assert.equal(await store.hasCardImage('cards/阿珂.json'), false)

  await store.setCardCover('cards/阿珂.json', png('first'), () => { throw new Error('有原件时不该用当前卡') })
  assert.deepEqual(await readdir(originals), ['阿珂.png'])
  assert.equal(await store.hasCardImage('cards/阿珂.json'), true)
  const image = await store.readCardImage('cards/阿珂.json')
  assert.deepEqual(stripPngTextChunks(image), png('first'))
  assert.deepEqual(cardOf(image), JSON.parse(original))
  // v3 卡同时写 chara 与 ccv3。
  assert.equal(pngRawTextChunks(image).length, 2)
  // 恢复原版仍能读到原来的卡数据。
  const payload = await store.originalCardPayload('cards/阿珂.json')
  assert.equal(payload.kind, 'png')

  // 再换一次：只换像素，卡数据不变。
  await store.setCardCover('cards/阿珂.json', png('second'), () => '')
  const replaced = await store.readCardImage('cards/阿珂.json')
  assert.deepEqual(stripPngTextChunks(replaced), png('second'))
  assert.deepEqual(cardOf(replaced), JSON.parse(original))
  assert.deepEqual(await readdir(originals), ['阿珂.png'])
})

async function encodedImages() {
  const { readFile: read } = await import('node:fs/promises')
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const wasm = async file => WebAssembly.compile(await read(require.resolve(file)))
  const [jpeg, webp] = await Promise.all([import('@jsquash/jpeg/encode.js'), import('@jsquash/webp/encode.js')])
  await jpeg.init(await wasm('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'))
  await webp.init(await wasm('@jsquash/webp/codec/enc/webp_enc.wasm'))
  const pixels = { width: 4, height: 3, data: new Uint8ClampedArray(4 * 3 * 4).fill(200), colorSpace: 'srgb' }
  return { jpeg: Buffer.from(await jpeg.default(pixels)), webp: Buffer.from(await webp.default(pixels)) }
}

test('封面图片：PNG 原样通过，JPG/WebP 转成同尺寸 PNG，其他格式拒绝', async () => {
  const { coverImageAsPng } = await import('../tavern-plugin/lib/domain/card-cover-image.js')
  const keep = png('keep')
  assert.equal(await coverImageAsPng(keep), keep)
  const { jpeg, webp } = await encodedImages()
  for (const source of [jpeg, webp]) {
    const converted = await coverImageAsPng(source)
    assert.equal(converted.readUInt32BE(0), 0x89504e47)
    assert.equal(converted.readUInt32BE(16), 4, '宽度不变')
    assert.equal(converted.readUInt32BE(20), 3, '高度不变')
  }
  await assert.rejects(coverImageAsPng(Buffer.from('GIF89a......')), /PNG、JPG、WebP/)
})

test('工作台工具：配封面、导出 PNG，只在卡片模式、拒绝相对路径与覆盖', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const { registerCardCoverTools } = await import('../tavern-plugin/lib/tools/card-cover.js')
  const { store, root } = await setup(t)
  const tools = new Map()
  let mode = 'card'
  const text = JSON.stringify({ spec: 'chara_card_v3', data: { name: '阿珂', description: '当前' } })
  registerCardCoverTools({
    tools: { register(value) { tools.set(value.name, value) } },
    chatForSession: async () => ({ mode, cardPath: 'cards/阿珂.json' }),
    fileResources: store,
    presentCardText: async () => ({ text }),
    exportCardPng: async cardPath => ({ name: '阿珂', bytes: pngWithTextChunks(await store.readCardImage(cardPath), [pngCardTextChunk('ccv3', text)]) }),
    str: value => String(value ?? '')
  })
  const exec = { agent: { session: { id: 's' } } }
  const { jpeg } = await encodedImages()
  const image = path.join(root, 'cover.jpg')
  await writeFile(image, jpeg)

  await assert.rejects(tools.get('tavern_set_card_cover').execute({ image: 'cover.jpg' }, exec), /完整路径/)
  const set = await tools.get('tavern_set_card_cover').execute({ image }, exec)
  assert.equal(set.path, 'cards/阿珂.json')
  assert.equal(await store.hasCardImage('cards/阿珂.json'), true)
  assert.equal(cardOf(await store.readCardImage('cards/阿珂.json')).data.name, '阿珂')

  const output = path.join(root, 'out', '阿珂.png')
  const exported = await tools.get('tavern_export_card_png').execute({ output }, exec)
  assert.equal(exported.output, output)
  assert.deepEqual(cardOf(await readFile(output)), JSON.parse(text))
  await assert.rejects(tools.get('tavern_export_card_png').execute({ output }, exec), /已存在/)
  await assert.rejects(tools.get('tavern_export_card_png').execute({ output: path.join(root, 'x.jpg') }, exec), /\.png/)

  mode = 'story'
  await assert.rejects(tools.get('tavern_set_card_cover').execute({ image }, exec), /卡片工作台/)
})
