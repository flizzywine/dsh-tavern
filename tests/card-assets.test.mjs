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

// 随卡参考音频 (cast-presentation.md 22/N): a clip is audio by its bytes plus what it says; the card file carries both.
const wav = tag => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.from(tag)])

test('参考音频：上传按字节认类型、要原文，限 8 段、合计 8 MB；删除后没人引用的文件一并删掉', async () => {
  const backing = store()
  backing.remove = async path => { backing.files.delete(path) }
  const cast = createCastAssets({ store: backing })
  const first = await cast.addVoiceReference({ cardPath: 'cards/a.json', name: '林曦', bytes: wav('one'), text: '  今天\n天气真好。 ' })
  const clip = first.characters[0].voiceReferences[0]
  assert.match(clip.file, /^[0-9a-f]{32}\.wav$/)
  assert.equal(clip.text, '今天 天气真好。')
  assert.deepEqual(await cast.readFile('cards/a.json', clip.file), wav('one'))
  await assert.rejects(cast.addVoiceReference({ cardPath: 'cards/a.json', name: '林曦', bytes: Buffer.from('not audio'), text: 'x' }), /只支持 WAV、MP3、OGG、FLAC/)
  await assert.rejects(cast.addVoiceReference({ cardPath: 'cards/a.json', name: '林曦', bytes: wav('two'), text: '   ' }), /原话/)
  await assert.rejects(cast.addVoiceReference({ cardPath: 'cards/a.json', name: '林曦', bytes: Buffer.concat([wav('big'), Buffer.alloc(8 * 1024 * 1024)]), text: '大' }), /合计不能超过 8 MB/)
  for (let index = 2; index <= 8; index++) await cast.addVoiceReference({ cardPath: 'cards/a.json', name: '林曦', bytes: Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.from('mp3-' + index)]), text: '第' + index + '段' })
  const full = await cast.read('cards/a.json')
  assert.equal(full.characters[0].voiceReferences.length, 8)
  assert.match(full.characters[0].voiceReferences[1].file, /\.mp3$/)
  await assert.rejects(cast.addVoiceReference({ cardPath: 'cards/a.json', name: '林曦', bytes: wav('nine'), text: '九' }), /最多 8 段/)
  const after = await cast.removeVoiceReference({ cardPath: 'cards/a.json', name: '林曦', file: clip.file })
  assert.equal(after.characters[0].voiceReferences.length, 7)
  assert.equal(await cast.readFile('cards/a.json', clip.file), undefined, '没人引用的参考音频文件删掉')
})

test('配音来源：一个人物在配好的渠道里选一个（声音克隆是其中一项）；上传、删除参考音频都不改这个选择', async () => {
  const backing = store()
  backing.remove = async path => { backing.files.delete(path) }
  const cast = createCastAssets({ store: backing })
  assert.deepEqual((await cast.setVoiceSource({ cardPath: 'cards/a.json', name: '林曦', provider: 'fish', clone: true })).characters[0].voiceSource, { provider: 'fish', clone: true }, '没有参考音频也能选声音克隆')
  const { characters: [{ voiceReferences: [clip], voiceSource }] } = await cast.addVoiceReference({ cardPath: 'cards/a.json', name: '林曦', bytes: wav('one'), text: '你好。' })
  assert.deepEqual(voiceSource, { provider: 'fish', clone: true })
  assert.deepEqual((await cast.setVoiceSource({ cardPath: 'cards/a.json', name: '林曦', provider: 'openai', clone: false })).characters[0].voiceSource, { provider: 'openai' })
  await assert.rejects(cast.setVoiceSource({ cardPath: 'cards/a.json', name: '林曦', provider: 'Bad Id' }), /配音渠道无效/)
  await cast.setVoiceSource({ cardPath: 'cards/a.json', name: '林曦', provider: 'fish', clone: true })
  const after = await cast.removeVoiceReference({ cardPath: 'cards/a.json', name: '林曦', file: clip.file })
  assert.equal(Object.hasOwn(after.characters[0], 'voiceReferences'), false)
  assert.deepEqual(after.characters[0].voiceSource, { provider: 'fish', clone: true }, '删掉最后一段不悄悄换回去')
  assert.equal(Object.hasOwn((await cast.setVoiceSource({ cardPath: 'cards/a.json', name: '林曦', provider: '' })).characters[0], 'voiceSource'), false, '空：回到配音设置里的渠道')
})

test('参考音频随卡导出 CHARX、导入时校验一次：音频与原文完整还原，不合格的那段跳过并计数', async () => {
  const cast = createCastAssets({ store: store() })
  const collected = { emotions: [], backgrounds: [], cover: null, extras: [], skipped: 0,
    cast: [{ name: '老周', aliases: [], avatar: null, sprites: {}, voices: {}, voiceSource: { provider: 'fish', clone: true }, voiceReferences: [{ audio: wav('zhou-1'), text: '来了啊。' }, { audio: Buffer.from('<html>'), text: '坏的' }, { audio: wav('zhou-2'), text: '' }] }] }
  const summary = await cast.importCardAssets({ cardPath: 'cards/a.json', name: '林曦', collected })
  assert.equal(summary.references, 1)
  assert.equal(summary.skippedReferences, 2)
  const manifest = await cast.read('cards/a.json')
  const [clip] = manifest.characters[0].voiceReferences
  assert.equal(clip.text, '来了啊。')

  const charx = buildCharx({ document: { data: { name: '林曦' } }, cover: null, manifest, characterName: '林曦', readFile: file => file === clip.file ? wav('zhou-1') : undefined })
  const entries = readZipEntries(charx)
  const exported = JSON.parse(entries.get('card.json').toString('utf8')).data.extensions.dsh_tavern.cast.characters[0]
  assert.equal(exported.voiceReferences.length, 1)
  assert.equal(exported.voiceReferences[0].text, '来了啊。')
  assert.deepEqual(entries.get(exported.voiceReferences[0].audio.replace('embeded://', '')), wav('zhou-1'))

  const again = cardImport({ kind: 'charx', name: '林曦.charx', fileB64: charx.toString('base64') })
  const copy = createCastAssets({ store: store() })
  await copy.importCardAssets({ cardPath: 'cards/b.json', name: '林曦', collected: again.collected })
  const restored = (await copy.read('cards/b.json')).characters.find(item => item.name === '老周').voiceReferences
  assert.deepEqual(restored, [{ file: clip.file, text: '来了啊。' }])
  assert.deepEqual(exported.voiceSource, { provider: 'fish', clone: true })
  assert.deepEqual((await copy.read('cards/b.json')).characters.find(item => item.name === '老周').voiceSource, { provider: 'fish', clone: true }, '配音来源随卡走')
  assert.deepEqual(await copy.readFile('cards/b.json', clip.file), wav('zhou-1'))
  const plain = buildCharx({ document: { data: { name: '林曦' } }, cover: null, manifest: { characters: [{ name: '林曦', sprites: {}, voices: {} }] }, characterName: '林曦', readFile: () => undefined })
  assert.equal(Object.hasOwn(JSON.parse(readZipEntries(plain).get('card.json').toString('utf8')).data.extensions.dsh_tavern.cast.characters[0], 'voiceReferences'), false, '没有参考音频的人物，导出里不写 voiceReferences')
})