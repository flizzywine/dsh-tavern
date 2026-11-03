import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const source = fileURLToPath(new URL('../tavern-plugin/packages/dsh-tavern-image-bundled/', import.meta.url))
const DEFINITIONS = { characters: [
  { id: 'xu', name: '许静好', match: 'Xu Jinghao', enabled: true, cards: ['cards/反高潮.json'], traits: { face: '她是一位年轻女子' }, outfits: [
    { id: 'o1', name: '白色亚麻吊带长裙', upper: '穿着一件白色亚麻细吊带长裙', lower: '白色亚麻长裙，裙摆垂到小腿', shoes: '脚上穿着一双棕色平底皮凉鞋', back: '从背后看露出肩膀', enabled: true },
    { id: 'o2', name: '黑色蕾丝内衣', upper: '上身只穿着一件黑色蕾丝文胸', lower: '下身是一条黑色蕾丝内裤', nsfw: true, enabled: true },
    { id: 'o3', name: '停用的衣服', upper: '上身穿着一件红色毛衣', enabled: false },
  ] },
  { id: 'hero', name: '男主', note: '玩家（通用）', enabled: true, traits: { face: '他是一位年轻男子' }, outfits: [{ id: 'h1', name: '藏青色棉质睡衣', upper: '上身穿着一件藏青色睡衣上衣', enabled: true }] },
  { id: 'other', name: '别的卡的人', enabled: true, cards: ['cards/别的卡.json'], traits: { face: '她是一位年轻女子' }, outfits: [{ id: 'x1', name: '旗袍', upper: '穿着一件旗袍', enabled: true }] },
] }

async function runtime(t, { config = {}, snapshot = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-comfy-test-'))
  await mkdir(join(root, 'lib')); await mkdir(join(root, 'workflows'))
  await cp(join(source, 'lib'), join(root, 'lib'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(join(root, 'worldbook.json'), JSON.stringify({ name: 'test', entries: [] }))
  await writeFile(join(root, 'definitions.json'), JSON.stringify(DEFINITIONS))
  const sections = new Map(), pools = new Map(), disposes = []
  const tavern = {
    apiVersion: 2,
    attach: async () => ({}), update: async () => ({}), remove: async () => ({}), list: async () => [],
    promptSection: ({ name, text }) => { sections.set('prompt:' + name, text); return () => sections.delete('prompt:' + name) },
    turnSection: ({ name, text }) => { sections.set('turn:' + name, text); return () => sections.delete('turn:' + name) },
    worldbookEntries: ({ name, entries }) => { pools.set(name, entries); return () => pools.delete(name) },
    onTurnSettled: () => () => {}, onTimelineChanged: () => () => {},
    getTurn: async () => ({ card: { id: 'cards/反高潮.json', name: '反高潮' } }),
    readTurnData: async () => (snapshot ? { turn: 1, data: snapshot } : null),
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tavern,
    webServer: { register() { return () => {} } },
    inject(names, install) { if (names.every(name => this[name])) install(this) },
    effect(install) { const off = install(); if (typeof off === 'function') disposes.push(off); return off },
  }
  const { apply } = await import(pathToFileURL(join(root, 'lib', 'index.js')).href + '?' + Math.random())
  apply(ctx, { plannerProvider: 'mock', plannerModel: 'mock', ...config })
  for (let i = 0; i < 100 && !pools.has('outfits'); i++) await delay(20)
  t.after(async () => {
    for (const dispose of disposes.splice(0).reverse()) dispose()
    await delay(40)
    assert.ok(resolve(root).startsWith(resolve(tmpdir())) && basename(root).startsWith('dsh-comfy-test-'))
    await rm(root, { recursive: true, force: true })
  })
  return { text: context => sections.get('turn:outfit-wardrobe')(context), entries: context => pools.get('outfits')(context), sections, pools }
}

test('衣服库：名单进本轮上下文，只有这张卡的人和通用玩家，停用的衣服不列', async t => {
  const f = await runtime(t)
  assert.ok(f.sections.has('turn:outfit-wardrobe'), '注册成本轮上下文段落')
  const text = await f.text({ gameId: 'g', turn: 1, input: '去海边' })
  assert.match(text, /许静好：白色亚麻吊带长裙、黑色蕾丝内衣（私密）/)
  assert.match(text, /男主：藏青色棉质睡衣/)
  assert.doesNotMatch(text, /别的卡的人|旗袍|停用的衣服/)
  assert.match(text, /worldbook_search/)
  assert.doesNotMatch(text, /上一段结束时穿着/, '还没有记录时不写现在穿什么')
})

test('衣服库：每套衣服一条世界书条目，按衣服名召回，内容是完整描述', async t => {
  const f = await runtime(t)
  const entries = await f.entries({ gameId: 'g', turn: 1 })
  assert.equal(entries.length, 3)
  for (const entry of entries) assert.match(entry.id, /^[A-Za-z0-9._-]{1,64}$/)
  const dress = entries.find(e => e.title === '许静好的衣服·白色亚麻吊带长裙')
  assert.deepEqual(dress.keys, ['白色亚麻吊带长裙'])
  assert.equal(dress.secondaryKeys, undefined, '只有一个人有这件衣服时不要求同时提到人名')
  assert.match(dress.content, /白色亚麻细吊带长裙.*棕色平底皮凉鞋.*背面：从背后看露出肩膀/)
  assert.match(entries.find(e => e.title.endsWith('黑色蕾丝内衣')).content, /私密场合穿/)
})

test('衣服库：现在穿的那套按这一轮的角色记录写全文', async t => {
  const f = await runtime(t, { snapshot: { characters: { xu: { current: { outfit: '白色亚麻吊带长裙（裙摆被海风吹起）' } } } } })
  const text = await f.text({ gameId: 'g', turn: 3 })
  assert.match(text, /上一段结束时穿着：白色亚麻吊带长裙——穿着一件白色亚麻细吊带长裙.*（裙摆被海风吹起）/)
})

test('衣服库：配图关、规划关、或单独关掉时，名单和条目都是空的', async t => {
  for (const config of [{ imageEnabled: false }, { plannerEnabled: false }, { wardrobeHints: false }]) {
    const f = await runtime(t, { config })
    assert.equal(await f.text({ gameId: 'g', turn: 1 }), '')
    assert.deepEqual(await f.entries({ gameId: 'g', turn: 1 }), [])
  }
})
