import assert from 'node:assert/strict'
import test from 'node:test'
import { CAST_DATA_OWNER, CAST_SUBMIT_TOOL, castSettlementText, dialogueQuotes, normalizeCastSubmission, recentSpeakers } from '../tavern-plugin/lib/domain/cast-annotation.js'
import { createCastPresentation } from '../tavern-plugin/lib/domain/cast-presentation.js'
import { createPluginData } from '../tavern-plugin/lib/domain/plugin-data.js'

test('按阅读顺序取出同一行内成对引号里的台词，不跨行', () => {
  const text = '林曦笑着说：“你好。”他点头「嗯」。\n“没有结尾\n『第三句』和 "fourth" 以及 ＂第五＂'
  assert.deepEqual(dialogueQuotes(text), ['你好。', '嗯', '第三句', 'fourth', '第五'])
  assert.deepEqual(dialogueQuotes('只有旁白。'), [])
})

test('结算说明给台词编号并列出已出现人物；没有台词时不加说明', () => {
  const text = castSettlementText(['你好。', '这是一句'+'很长'.repeat(30)+'的台词'], { speakers: ['林曦', '老周'] })
  assert.match(text, /^【本轮台词】/)
  assert.match(text, /已出现的人物：林曦、老周/)
  assert.match(text, /\n1\. 你好。\n2\. 这是一句.+…$/)
  assert.equal(castSettlementText([]), '')
  assert.equal(CAST_SUBMIT_TOOL.parameters.properties.lines.items.properties.emotion.enum.length, 28)
})

test('提交按编号映射回原文；无效编号、空名字跳过，未知情绪按平静', () => {
  const quotes = ['你好。', '嗯', '走吧']
  const lines = normalizeCastSubmission({ lines: [
    { n: 3, speaker: ' 老周 ', emotion: 'joy' }, { n: 1, speaker: '林曦', emotion: 'blush' },
    { n: 9, speaker: '谁', emotion: 'joy' }, { n: 2, speaker: '  ', emotion: 'joy' }, { n: 1, speaker: '重复', emotion: 'joy' }
  ] }, quotes)
  assert.deepEqual(lines, [
    { n: 1, quote: '你好。', speaker: '林曦', emotion: 'neutral' },
    { n: 3, quote: '走吧', speaker: '老周', emotion: 'joy' }
  ])
  assert.deepEqual(normalizeCastSubmission({ lines: [] }, quotes), [])
  assert.throws(() => normalizeCastSubmission({}, quotes), /lines/)
  assert.throws(() => normalizeCastSubmission({ lines: [{ n: 7, speaker: 'x', emotion: 'joy' }] }, quotes), /重新提交/)
})

test('最近出现的人物去重，新的在前', () => {
  const records = [{ data: { lines: [{ speaker: '甲' }, { speaker: '乙' }] } }, { data: { lines: [{ speaker: '甲' }, { speaker: '丙' }] } }]
  assert.deepEqual(recentSpeakers(records), ['乙', '甲', '丙'])
})

function harness({ enabled = true, text = '她说：“你好。”\n他答：「嗯」', key = 'v1' } = {}) {
  const files = new Map()
  const store = {
    async readJson(path) { return files.has(path) ? structuredClone(files.get(path)) : undefined },
    async updateJson(path, change) { const next = change(files.has(path) ? structuredClone(files.get(path)) : undefined); files.set(path, next); return next }
  }
  const state = { enabled, key, published: 0 }
  const data = createPluginData({ store })
  const turns = {
    async resolveGame(sessionId) { return sessionId === 'game' ? { chatId: 'chat', sessionId } : null },
    async currentKey(_sessionId, turn) { return turn === 2 ? state.key : null },
    async readPendingTurn() { return { chatId: 'chat', turn: 2, key: state.key, text, greeting: false } }
  }
  const cast = createCastPresentation({ enabled: async () => state.enabled, turns, data, publish: (_gameId, annotation) => { state.published++; state.annotation = annotation } })
  return { cast, data, state }
}

test('结算时列出本轮台词，提交后按正文版本保存，换了版本就读不到', async () => {
  const { cast, data, state } = harness()
  const note = await cast.settlement.section({ gameId: 'game', turn: 2 })
  assert.match(note, /1\. 你好。\n2\. 嗯$/)
  const result = JSON.parse(await cast.settlement.call('cast_submit', { lines: [{ n: 1, speaker: '林曦', emotion: 'joy' }, { n: 2, speaker: '老周', emotion: 'neutral' }] }, { gameId: 'game', turn: 2 }))
  assert.deepEqual(result, { ok: true, annotated: 2 })
  assert.equal(state.published, 1)
  assert.equal((await data.turnsUpTo({ chatId: 'chat', owner: CAST_DATA_OWNER, turn: 2 })).length, 1)
  const read = await cast.forTurns('game', [2, 3])
  assert.deepEqual(read, { enabled: true, turns: { 2: [{ n: 1, quote: '你好。', speaker: '林曦', emotion: 'joy' }, { n: 2, quote: '嗯', speaker: '老周', emotion: 'neutral' }] } })
  assert.deepEqual(state.annotation, { turn: 2, textVersion: 'v1', lines: read.turns[2] }, '通知带上这一轮的版本和标注')
  state.enabled = false
  assert.deepEqual(await cast.annotation('game', 2), { turn: 2, textVersion: 'v1', lines: read.turns[2] }, '关掉标注后已有的标注仍可读')
  state.enabled = true
  state.key = 'v2'
  assert.deepEqual(await cast.forTurns('game', [2]), { enabled: true, turns: {} })
  assert.equal(await cast.annotation('game', 2), null)
})

test('关闭时不加说明、不返回标注；没有说明时调用被拒绝', async () => {
  const { cast, state } = harness({ enabled: false })
  assert.equal(await cast.settlement.section({ gameId: 'game', turn: 2 }), '')
  assert.equal(await cast.settlement.wanted(), false)
  assert.equal(JSON.parse(await cast.settlement.call('cast_submit', { lines: [] }, { gameId: 'game', turn: 2 })).ok, false)
  assert.deepEqual(await cast.forTurns('game', [2]), { enabled: false, turns: {} })
  state.enabled = true
  assert.equal(await cast.settlement.wanted(), true)
})

test('本轮没有台词时不加说明；提交出错时让模型重提', async () => {
  assert.equal(await harness({ text: '只有旁白。' }).cast.settlement.section({ gameId: 'game', turn: 2 }), '')
  const { cast } = harness()
  await cast.settlement.section({ gameId: 'game', turn: 2 })
  const failed = JSON.parse(await cast.settlement.call('cast_submit', { lines: [{ n: 5, speaker: '谁', emotion: 'joy' }] }, { gameId: 'game', turn: 2 }))
  assert.equal(failed.ok, false)
  assert.equal(failed.retryable, true)
})

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
