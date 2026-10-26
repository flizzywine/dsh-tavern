import assert from 'node:assert/strict'
import test from 'node:test'
import { CAST_DATA_OWNER } from "../tavern-plugin/lib/domain/cast-annotation.js"
import { createCastPresentation } from '../tavern-plugin/lib/domain/cast-presentation.js'
import { createPluginData } from '../tavern-plugin/lib/domain/plugin-data.js'

const { createCastAssets, imageExtension } = await import('../tavern-plugin/lib/domain/cast-assets.js')
const { writeZipEntries: writeZip } = await import('../tavern-plugin/lib/domain/zip-entries.js')
const writeZipEntries = pairs => writeZip(pairs.map(([path, content]) => ({ path, content })))
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const png = tag => Buffer.concat([PNG, Buffer.from(tag)])
function assetStore() {
  const files = new Map()
  return {
    files,
    async readJson(path) { return files.has(path) ? JSON.parse(files.get(path)) : undefined },
    async updateJson(path, change) { const next = change(files.has(path) ? JSON.parse(files.get(path)) : undefined); files.set(path, JSON.stringify(next)); return next },
    async writeBytes(path, data) { files.set(path, Buffer.from(data)) },
    async readBytes(path) { return files.get(path) }
  }
}

test('角色素材：按图片内容识别格式，头像与情绪立绘分开存，同一人物可改名加别名', async () => {
  const assets = createCastAssets({ store: assetStore() })
  assert.equal(imageExtension(png('a')), 'png')
  assert.equal(imageExtension(Buffer.from('not an image')), null)
  await assert.rejects(assets.setImage({ cardPath: 'cards/a.png', name: '林曦', slot: 'avatar', bytes: Buffer.from('nope') }), /只支持/)
  await assert.rejects(assets.setImage({ cardPath: 'cards/a.png', name: '林曦', slot: 'blush', bytes: png('a') }), /情绪名/)
  await assets.setImage({ cardPath: 'cards/a.png', name: '林曦', slot: 'avatar', bytes: png('a') })
  let cast = await assets.setImage({ cardPath: 'cards/a.png', name: '林曦', slot: 'joy', bytes: png('b') })
  assert.equal(cast.characters.length, 1)
  assert.match(cast.characters[0].avatar, /^[0-9a-f]{32}\.png$/)
  assert.deepEqual(Object.keys(cast.characters[0].sprites), ['joy'])
  cast = await assets.setCharacter({ cardPath: 'cards/a.png', name: '林曦', rename: '林小曦', aliases: ['小曦', '林小曦'] })
  assert.deepEqual([cast.characters[0].name, cast.characters[0].aliases], ['林小曦', ['小曦']])
  cast = await assets.removeImage({ cardPath: 'cards/a.png', name: '小曦', slot: 'joy' })
  assert.deepEqual(cast.characters[0].sprites, {})
  const image = await assets.readImage(assets.keyOf('cards/a.png'), cast.characters[0].avatar)
  assert.equal(image.mediaType, 'image/png')
  assert.equal(await assets.readImage(assets.keyOf('cards/a.png'), '../x.png'), undefined)
  assert.equal(await assets.readImage(assets.keyOf('cards/a.png'), 'a'.repeat(32) + '.html'), undefined)
  assert.equal((await assets.read('cards/other.png')).characters.length, 0, '每张卡各自一份')
})

test('导入 ST 立绘包：单人按文件名、多人按文件夹，非情绪名的文件跳过', async () => {
  const assets = createCastAssets({ store: assetStore() })
  const single = writeZipEntries([['joy.png', png('j')], ['sadness.png', png('s')], ['readme.txt', Buffer.from('x')], ['__MACOSX/._joy.png', png('m')]])
  let result = await assets.importSpritePack({ cardPath: 'c', name: '林曦', bytes: single })
  assert.deepEqual([result.imported, result.skipped, result.characters], [2, 1, ['林曦']])
  const multi = writeZipEntries([['pack/老周/anger.png', png('a')], ['pack/林曦/joy.png', png('j2')]])
  result = await assets.importSpritePack({ cardPath: 'c', name: '林曦', bytes: multi })
  assert.deepEqual(result.characters.sort(), ['林曦', '老周'])
  assert.deepEqual(Object.keys(result.cast.characters.find(item => item.name === '林曦').sprites).sort(), ['joy', 'sadness'])
  await assert.rejects(assets.importSpritePack({ cardPath: 'c', name: '林曦', bytes: writeZipEntries([['a.txt', Buffer.from('x')]]) }), /按情绪命名/)
})

test('编辑正文后台词标注带到新版本：原句照旧，台词数不变时改写的句子按位置沿用', async () => {
  const { carryCastLines } = await import('../tavern-plugin/lib/domain/cast-annotation.js')
  const lines = [{ n: 1, quote: '你好。', speaker: '林曦', emotion: 'joy' }, { n: 2, quote: '嗯', speaker: '老周', emotion: 'neutral' }]
  assert.deepEqual(carryCastLines(lines, 2, ['你好。', '嗯，好']), [{ n: 1, quote: '你好。', speaker: '林曦', emotion: 'joy' }, { n: 2, quote: '嗯，好', speaker: '老周', emotion: 'neutral' }])
  assert.deepEqual(carryCastLines(lines, 2, ['新加的', '你好。', '改了']), [{ n: 2, quote: '你好。', speaker: '林曦', emotion: 'joy' }], '台词数变了，只认原句')

  const files = new Map()
  const store = {
    async readJson(path) { return files.has(path) ? structuredClone(files.get(path)) : undefined },
    async updateJson(path, change) { const next = change(files.has(path) ? structuredClone(files.get(path)) : undefined); files.set(path, next); return next }
  }
  const data = createPluginData({ store })
  let shown = { key: 'v1', text: '她说：“你好。”\n他答：「嗯」' }
  const turns = { readTurn: async () => ({ chatId: 'chat', sessionId: 'game', turn: 2, key: shown.key, text: shown.text }) }
  const published = []
  const cast = createCastPresentation({ enabled: async () => true, turns, data, publish: (_id, annotation) => published.push(annotation) })
  await data.saveTurn({ chatId: 'chat', owner: CAST_DATA_OWNER, turn: 2, key: 'v1', data: { version: 1, lines } })
  const carry = await cast.beforeEdit('game')
  shown = { key: 'v2', text: '她轻声说：“你好。”\n他答：「嗯，好」' }
  await carry()
  const kept = (await data.turnsUpTo({ chatId: 'chat', owner: CAST_DATA_OWNER, turn: 2 })).find(item => item.key === 'v2')
  assert.deepEqual(kept.data.lines.map(line => [line.quote, line.speaker]), [['你好。', '林曦'], ['嗯，好', '老周']])
  assert.equal(published.length, 1)
  assert.ok((await data.turnsUpTo({ chatId: 'chat', owner: CAST_DATA_OWNER, turn: 2 })).some(item => item.key === 'v1'), '旧版本的标注留着，撤销回去头像还在')
})

test('修复前编辑过的轮次：读取时用旧版本标注补上当前版本；大半台词都换了就不补', async () => {
  const files = new Map()
  const store = {
    async readJson(path) { return files.has(path) ? structuredClone(files.get(path)) : undefined },
    async updateJson(path, change) { const next = change(files.has(path) ? structuredClone(files.get(path)) : undefined); files.set(path, next); return next }
  }
  const data = createPluginData({ store })
  let shown = { key: 'v2', text: '她轻声说：“你好。”\n他答：「嗯，好」' }
  const turns = {
    resolveGame: async () => ({ chatId: 'chat', sessionId: 'game' }),
    currentKey: async () => shown.key,
    readTurn: async () => ({ chatId: 'chat', sessionId: 'game', turn: 2, key: shown.key, text: shown.text })
  }
  const cast = createCastPresentation({ enabled: async () => true, turns, data })
  await data.saveTurn({ chatId: 'chat', owner: CAST_DATA_OWNER, turn: 2, key: 'v1', data: { version: 1, lines: [{ n: 1, quote: '你好。', speaker: '林曦', emotion: 'joy' }, { n: 2, quote: '嗯', speaker: '老周', emotion: 'neutral' }] } })
  const read = await cast.forTurns('game', [2])
  assert.deepEqual(read.turns[2].map(line => [line.quote, line.speaker]), [['你好。', '林曦'], ['嗯，好', '老周']])
  assert.ok((await data.turnsUpTo({ chatId: 'chat', owner: CAST_DATA_OWNER, turn: 2 })).some(item => item.key === 'v2'), '补出来的标注存下，下次直接读')
  shown = { key: 'v3', text: '全新的“第一句”和「第二句」' }
  assert.deepEqual((await cast.forTurns('game', [2])).turns, {}, '重新生成的新文本不套旧说话人')
})
