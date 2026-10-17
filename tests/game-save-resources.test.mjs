import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createGameSaveResources } from '../tavern-plugin/lib/domain/game-save-resources.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createFileResourceStore } from '../tavern-plugin/lib/domain/file-resources.js'

async function harness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'save-resources-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const resources = createFileResourceStore({ dataRoot: root })
  const cardPreparation = createCardPreparation()
  const prepare = createGameSaveResources({ resources, cardPreparation })
  return { resources, prepare }
}
const payload = description => ({ kind: 'text', name: 'hero.json', text: JSON.stringify({ name: 'Hero', description }) })
const saveOf = payload => ({ chat: { cardPath: 'cards/hero.json', mode: 'story' }, card: { payload } })

test('同名不同内容的存档人物卡另存，重复及并发导入不覆盖已有卡', async t => {
  const { resources, prepare } = await harness(t)
  const local = await prepare(saveOf(payload('local')))
  const imported = await Promise.all([prepare(saveOf(payload('packaged'))), prepare(saveOf(payload('packaged')))])
  assert.equal(new Set([local.cardPath, ...imported.map(item => item.cardPath)]).size, 3)
  assert.equal((await resources.originalCardPayload(local.cardPath)).text, payload('local').text)
  for (const item of imported) assert.equal((await resources.originalCardPayload(item.cardPath)).text, payload('packaged').text)
  assert.equal((await prepare(saveOf(payload('local')))).importedCard, '')
})

test('PNG 人物卡改名导入仍保留原始图片字节', async t => {
  const { resources, prepare } = await harness(t)
  await prepare(saveOf(payload('local')))
  const raw = { name: 'PNG Hero' }
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const text = Buffer.from('chara\0' + Buffer.from(JSON.stringify(raw)).toString('base64'))
  const chunk = Buffer.alloc(12 + text.length)
  chunk.writeUInt32BE(text.length); chunk.write('tEXt', 4); text.copy(chunk, 8)
  const bytes = Buffer.concat([header, chunk])
  const png = { kind: 'png', name: 'hero.png', b64: Buffer.from(JSON.stringify(raw)).toString('base64'), fileB64: bytes.toString('base64') }
  const result = await prepare(saveOf(png))
  assert.notEqual(result.cardPath, 'cards/hero.json')
  assert.deepEqual(await resources.readCardImage(result.cardPath), bytes)
})

test('同卡绑定了不同剧本时，隔离存档资源且不改变本地旧游戏', async t => {
  const { resources, prepare } = await harness(t)
  const source = saveOf(payload('same card'))
  const local = await prepare(source)
  const localScript = await resources.importText('source', { name: 'story.txt', text: 'LOCAL STORY' })
  await resources.bindMaterial(local.cardPath, localScript)
  const incoming = { ...source, chat: { ...source.chat, mode: 'script' }, script: { path: 'materials/story.txt', text: 'PACKAGED STORY' } }
  const result = await prepare(incoming)
  assert.notEqual(result.cardPath, local.cardPath)
  const script = await resources.scriptForCard(result.cardPath)
  assert.notEqual(script, localScript)
  assert.equal(await resources.readText(script), 'PACKAGED STORY')
  assert.equal(await resources.scriptForCard(local.cardPath), localScript)
  assert.equal(await resources.readText(localScript), 'LOCAL STORY')
  // A later import failure rolls back only the newly created resources.
  await result.rollback()
  assert.equal(await resources.readCard(result.cardPath), undefined)
  assert.equal(await resources.readText(script), undefined)
  assert.equal(await resources.scriptForCard(local.cardPath), localScript)
})

test('同卡同剧本可直接复用；无剧本的本地卡不会被导入操作改绑', async t => {
  const { resources, prepare } = await harness(t)
  const source = saveOf(payload('same card'))
  const local = await prepare(source)
  const incoming = { ...source, chat: { ...source.chat, mode: 'script' }, script: { path: 'materials/story.txt', text: 'SAME STORY' } }
  const isolated = await prepare(incoming)
  assert.notEqual(isolated.cardPath, local.cardPath)
  assert.equal(await resources.scriptForCard(local.cardPath), undefined)
  const localScript = await resources.importText('source', { name: 'story.txt', text: 'SAME STORY' })
  await resources.bindMaterial(local.cardPath, localScript)
  const reused = await prepare(incoming)
  assert.equal(reused.cardPath, local.cardPath)
  assert.equal(reused.importedCard, '')
  await reused.rollback()
  assert.equal(await resources.scriptForCard(local.cardPath), localScript)
})

test('剧本绑定失败清理新卡和新剧本，保留旧资源', async t => {
  const { resources, prepare } = await harness(t)
  const source = saveOf(payload('same card'))
  await prepare(source)
  const failing = createGameSaveResources({ resources: { ...resources, async bindMaterial() { throw new Error('binding failed') } }, cardPreparation: createCardPreparation() })
  await assert.rejects(failing({ ...source, chat: { ...source.chat, mode: 'script' }, script: { path: 'materials/story.txt', text: 'STORY' } }), /binding failed/)
  assert.deepEqual(await resources.list('card'), ['cards/hero.json'])
  assert.deepEqual(await resources.list('source'), [])
})
