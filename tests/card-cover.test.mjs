// 人物卡配封面：JSON 原件变成带卡数据的 PNG，PNG 原件只换像素，没有原件时嵌入当前卡；导出 PNG 能被重新读回。
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createFileResourceStore } from '../tavern-plugin/lib/domain/file-resources.js'
import { cardAssetSource, pngCardTextChunk, pngWithTextChunks } from '../tavern-plugin/lib/domain/card-assets.js'

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
