import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCharx, cardImport, collectCardAssets, emotionSlot, pngWithCard } from '../tavern-plugin/lib/domain/card-assets.js'
import { createCastAssets } from '../tavern-plugin/lib/domain/cast-assets.js'
import { readZipEntries, writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000049454e44ae426082', 'hex')
const zip = pairs => writeZipEntries(pairs.map(([path, content]) => ({ path, content })))
const textChunk = (key, value) => {
  const body = Buffer.concat([Buffer.from('tEXt'), Buffer.from(key + '\0' + value, 'latin1')])
  const chunk = Buffer.alloc(body.length + 8)
  chunk.writeUInt32BE(body.length - 4, 0); body.copy(chunk, 4)
  return chunk
}
// A distinct, well-formed PNG per tag.
const png = tag => Buffer.concat([PNG.subarray(0, 33), textChunk('tag', tag), PNG.subarray(33)])
function store() {
  const files = new Map()
  return {
    files,
    async readJson(path) { return files.has(path) ? JSON.parse(files.get(path)) : undefined },
    async updateJson(path, change) { const next = change(files.has(path) ? JSON.parse(files.get(path)) : undefined); files.set(path, JSON.stringify(next)); return next },
    async writeBytes(path, data) { files.set(path, Buffer.from(data)) },
    async readBytes(path) { return files.get(path) }
  }
}

test('表情名对到 ST 的 28 种情绪：英文、中文、带编号的都认，认不出的返回 null', () => {
  assert.equal(emotionSlot('happy'), 'joy')
  assert.equal(emotionSlot('Smile_2'), 'joy')
  assert.equal(emotionSlot('开心'), 'joy')
  assert.equal(emotionSlot('害羞'), 'embarrassment')
  assert.equal(emotionSlot('anger.png'), 'anger')
  assert.equal(emotionSlot('default'), 'neutral')
  assert.equal(emotionSlot('thinking'), null)
  assert.equal(emotionSlot('crying'), 'sadness')
})

test('同一情绪有多张时，名字最贴近的那张当立绘（sad 胜过 crying），其余保留', async () => {
  const cast = createCastAssets({ store: store() })
  const summary = await cast.importCardAssets({ cardPath: 'cards/c.json', name: '鱼', collected: { emotions: [{ name: 'crying', ext: 'png', bytes: png('cry') }, { name: 'sad', ext: 'png', bytes: png('sad') }], backgrounds: [], cover: null, extras: [], cast: [], skipped: 0 } })
  assert.equal(summary.sprites, 1)
  const manifest = await cast.read('cards/c.json')
  assert.deepEqual(manifest.extras.map(item => item.name), ['crying'])
})

test('CHARX：PNG 卡面带上卡数据存成 PNG，立绘、背景、其他素材分开；地址读不到的计数', () => {
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '林曦', assets: [
    { type: 'icon', uri: 'embeded://assets/icon/images/main.png', name: 'main', ext: 'png' },
    { type: 'emotion', uri: 'embeded://assets/emotion/images/1.png', name: 'happy', ext: 'png' },
    { type: 'emotion', uri: 'embeded://assets/emotion/images/2.png', name: 'thinking', ext: 'png' },
    { type: 'background', uri: 'embeded://assets/background/images/bg.png', name: 'main', ext: 'png' },
    { type: 'x-risu-asset', uri: 'embeded://assets/other/audio/bgm.mp3', name: 'bgm', ext: 'mp3' },
    { type: 'emotion', uri: 'embeded://assets/emotion/images/missing.png', name: 'sad', ext: 'png' },
    { type: 'icon', uri: 'https://example.com/x.png', name: 'alt', ext: 'png' }
  ] } }
  const file = zip([['card.json', JSON.stringify(card)], ['assets/icon/images/main.png', png('cover')], ['assets/emotion/images/1.png', png('joy')],
    ['assets/emotion/images/2.png', png('think')], ['assets/background/images/bg.png', png('bg')], ['assets/other/audio/bgm.mp3', Buffer.from('ID3bgm')]])
  const { payload, collected } = cardImport({ kind: 'charx', name: '林曦.charx', fileB64: file.toString('base64') })
  assert.equal(payload.kind, 'png')
  assert.equal(payload.name, '林曦.png')
  assert.equal(JSON.parse(Buffer.from(payload.b64, 'base64').toString('utf8')).data.name, '林曦')
  assert.ok(Buffer.from(payload.fileB64, 'base64').includes(Buffer.from('ccv3\0')), '卡面 PNG 里带着 ccv3 数据')
  assert.equal(collected.cover, null, 'PNG 卡面已经是人物卡封面')
  assert.deepEqual(collected.emotions.map(item => item.name), ['happy', 'thinking'])
  assert.deepEqual(collected.backgrounds.map(item => item.name), ['main'])
  assert.deepEqual(collected.extras.map(item => [item.type, item.name, item.ext]), [['x-risu-asset', 'bgm', 'mp3']])
  assert.equal(collected.skipped, 1)

  const webp = zip([['card.json', JSON.stringify({ spec: 'chara_card_v3', data: { name: 'B', assets: [{ type: 'icon', uri: 'embeded://c.webp', name: 'main', ext: 'webp' }] } })], ['c.webp', Buffer.from('RIFF0000WEBPVP8 ')]])
  const other = cardImport({ kind: 'charx', name: 'B.charx', fileB64: webp.toString('base64') })
  assert.equal(other.payload.kind, 'text', '卡面不是 PNG 时存成 JSON')
  assert.ok(other.collected.cover, '卡面留给主角头像')
  assert.throws(() => cardImport({ kind: 'charx', name: 'x.charx', fileB64: zip([['a.txt', 'x']]).toString('base64') }), /card\.json/)
})

test('RisuAI PNG 的 chara-ext-asset 块、JSON 里的 data: 地址、extensions.risuai.emotions 都能读到', () => {
  const card = { spec: 'chara_card_v3', data: { name: 'A', assets: [{ type: 'emotion', uri: '__asset:1', name: 'angry', ext: 'png' }],
    extensions: { risuai: { emotions: [['sad', '__asset:2'], ['angry', '__asset:1']] } } } }
  const text = Buffer.from(JSON.stringify(card)).toString('base64')
  const file = Buffer.concat([PNG.subarray(0, 33), textChunk('ccv3', text), textChunk('chara-ext-asset_:1', png('a').toString('base64')), textChunk('chara-ext-asset_:2', png('s').toString('base64')), PNG.subarray(33)])
  const fromPng = cardImport({ kind: 'png', name: 'A.png', b64: text, fileB64: file.toString('base64') })
  assert.equal(fromPng.payload.kind, 'png', '非 CHARX 的导入内容不变')
  assert.deepEqual(fromPng.collected.emotions.map(item => item.name), ['angry', 'sad'])

  const json = { spec: 'chara_card_v3', data: { name: 'J', assets: [{ type: 'background', uri: 'data:image/png;base64,' + png('b').toString('base64'), name: 'room', ext: 'png' }] } }
  const fromJson = cardImport({ kind: 'text', name: 'J.json', text: JSON.stringify(json) })
  assert.deepEqual(fromJson.collected.backgrounds.map(item => item.name), ['room'])
})

test('导入角色素材再导出 CHARX：主角立绘在标准位置，其他人物和声音在扩展里，未识别的原样写回；重新导入完整还原', async () => {
  const cast = createCastAssets({ store: store() })
  const collected = {
    emotions: [{ name: 'happy', ext: 'png', bytes: png('joy') }, { name: '开心', ext: 'png', bytes: png('joy2') }, { name: 'thinking', ext: 'png', bytes: png('think') }],
    // Backgrounds are stage material (stage-material.js); character material arrives without them.
    backgrounds: [],
    cover: null, extras: [{ type: 'x-risu-asset', name: 'bgm', ext: 'mp3', bytes: Buffer.from('ID3bgm') }],
    cast: [{ name: '老周', aliases: ['周叔'], avatar: png('zhou'), sprites: { anger: png('zhou-angry') }, voices: { openai: 'onyx' } }], skipped: 0
  }
  const summary = await cast.importCardAssets({ cardPath: 'cards/a.json', name: '林曦', collected })
  assert.deepEqual(summary, { sprites: 2, backgrounds: 0, avatars: 1, kept: 3, unmatched: ['thinking'] })
  const manifest = await cast.read('cards/a.json')
  assert.deepEqual(manifest.characters.map(item => [item.name, Object.keys(item.sprites)]), [['林曦', ['joy']], ['老周', ['anger']]])
  assert.equal(manifest.backgrounds, undefined)
  assert.deepEqual(manifest.extras.map(item => [item.type, item.name]), [['emotion', 'happy'], ['emotion', 'thinking'], ['x-risu-asset', 'bgm']])

  const files = new Map([['b'.repeat(32) + '.png', png('bg')]])
  for (const file of [...manifest.characters.flatMap(item => [item.avatar, ...Object.values(item.sprites)]), ...manifest.extras.map(item => item.file)].filter(Boolean)) files.set(file, await cast.readFile('cards/a.json', file))
  // The card export passes the library's backgrounds in the same place (card-files.js).
  const charx = buildCharx({ document: { spec: 'chara_card_v2', data: { name: '林曦', description: 'd', extensions: { other: 1 } } }, cover: png('cover'),
    manifest: { ...manifest, backgrounds: [{ name: 'main', file: 'b'.repeat(32) + '.png' }] }, characterName: '林曦', readFile: file => files.get(file) })
  const entries = readZipEntries(charx)
  const exported = JSON.parse(entries.get('card.json').toString('utf8'))
  assert.equal(exported.spec, 'chara_card_v3')
  assert.deepEqual(exported.data.group_only_greetings, [])
  assert.equal(exported.data.extensions.other, 1, '已有扩展保留')
  assert.deepEqual(exported.data.assets.map(item => [item.type, item.name]), [['icon', 'main'], ['emotion', 'joy'], ['background', 'main'], ['emotion', 'happy'], ['emotion', 'thinking'], ['x-risu-asset', 'bgm']])
  for (const asset of exported.data.assets) assert.ok(entries.has(asset.uri.replace('embeded://', '')), asset.uri)
  assert.deepEqual(exported.data.extensions.dsh_tavern.cast.characters.map(item => [item.name, Object.keys(item.sprites), item.voices]), [['林曦', ['joy'], {}], ['老周', ['anger'], { openai: 'onyx' }]])

  const again = cardImport({ kind: 'charx', name: '林曦.charx', fileB64: charx.toString('base64') })
  const copy = createCastAssets({ store: store() })
  await copy.importCardAssets({ cardPath: 'cards/b.json', name: '林曦', collected: again.collected })
  const restored = await copy.read('cards/b.json')
  assert.deepEqual(restored.characters.map(item => [item.name, item.aliases, Object.keys(item.sprites), Boolean(item.avatar), item.voices || {}]),
    [['林曦', [], ['joy'], false, {}], ['老周', ['周叔'], ['anger'], true, { openai: 'onyx' }]])
  assert.deepEqual(again.collected.backgrounds.map(item => item.name), ['main'])
  assert.deepEqual(restored.extras.map(item => [item.type, item.name]), manifest.extras.map(item => [item.type, item.name]))
  assert.ok(pngWithCard(png('c'), '{}').includes(Buffer.from('IEND')))
})


test('素材配额按唯一地址计算；超限拒绝导入导出，缺失的扩展图片明确计数', () => {
  const characters = Array.from({ length: 300 }, (_, i) => ({ name: '角色' + i, sprites: { joy: 'embeded://' + i + '.png' } }))
  const card = { data: { assets: [{ type: 'emotion', name: 'joy', uri: 'embeded://0.png' }], extensions: { dsh_tavern: { cast: { characters } } } } }
  const collected = collectCardAssets(card, () => PNG)
  assert.equal(collected.cast.reduce((n, c) => n + Object.keys(c.sprites).length, 0), 300)
  assert.equal(collected.skipped, 0)
  characters.push({ name: '超限', sprites: { joy: 'embeded://300.png' } })
  assert.throws(() => collectCardAssets(card, () => PNG), /素材超过 300/)
  assert.throws(() => buildCharx({ document: { data: {} }, manifest: { characters }, readFile: () => PNG }), /素材超过 300/)
  const missing = collectCardAssets({ data: { extensions: { risuai: { emotions: [['sad', 'missing']] }, dsh_tavern: { cast: { characters: [{ name: 'A', avatar: 'missing', sprites: { joy: 'missing' } }] } } } } }, () => undefined)
  assert.equal(missing.skipped, 3)
})

test('CHARX 导出拒绝生成超过导入解压容量的文件', () => {
  const bytes = Buffer.alloc(8 * 1024 * 1024)
  const characters = Array.from({ length: 20 }, (_, i) => ({ name: '角色' + i, sprites: { joy: i + '.png' } }))
  assert.throws(() => buildCharx({ document: { data: {} }, manifest: { characters }, readFile: () => bytes }), /解压后内容超过 150 MB/)
})
