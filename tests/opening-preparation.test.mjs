import test from 'node:test'
import assert from 'node:assert/strict'
import { createOpeningPreparation } from '../tavern-plugin/lib/domain/opening-preparation.js'
import { inspectWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'

const card = { name: '测试', first_mes: '首页', alternate_greetings: ['第二幕'] }
function fixture() {
  const document = { name: '本局世界书', entries: [{ id: 0, name: '选项', keys: [], content: '固定设定', enabled: false }] }
  const record = { source: { kind: 'card', cardPath: 'card' }, view: inspectWorldBookDocument(document) }
  return { record, service: createOpeningPreparation({ readCard: async () => structuredClone(card), worldBooks: { bound: async () => structuredClone(record) } }) }
}
test('准备页世界书修改只进入本局草稿，确认后提供原生开场与世界书快照', async () => {
  const { service, record } = fixture()
  const draft = await service.create('card')
  const other = await service.create('card')
  const entries = structuredClone(draft.worldbook.entries)
  entries[0].enabled = true
  await service.replaceWorldbook(draft.id, entries, draft.worldbook.entries)
  const commit = service.resolve(draft.id, 'card', 'alternate:0')
  assert.equal(commit.openingId, 'alternate:0')
  assert.equal(commit.worldbookSnapshot.document.entries[0].enabled, true)
  assert.equal(service.get(other.id).worldbook.entries[0].enabled, false)
  assert.equal(record.view.entries[0].enabled, false)
  assert.throws(() => service.resolve(draft.id, 'other-card', 'primary'), /人物卡/)
  assert.throws(() => service.resolve(draft.id, 'card', 'alternate:99'), /开场/)
})
test('过期世界书写入不覆盖新设置，返回值也不能直接修改草稿', async () => {
  const { service } = fixture()
  const draft = await service.create('card')
  const old = structuredClone(draft.worldbook.entries)
  draft.worldbook.entries[0].enabled = true
  await service.replaceWorldbook(draft.id, draft.worldbook.entries, old)
  await assert.rejects(service.replaceWorldbook(draft.id, old, old), /修改/)
  const current = service.get(draft.id)
  current.worldbook.entries[0].enabled = false
  assert.equal(service.get(draft.id).worldbook.entries[0].enabled, true)
})

import { createHelperWorldbookHost } from './fixtures/helper-worldbook-host.mjs'
for (const embedded of [false, true]) test('本局世界书的运行时读写与原始资源隔离：' + embedded, async () => {
  const h = await createHelperWorldbookHost(embedded)
  try {
    const before = await h.read()
    h.chat.openingWorldbookSnapshot = { version: 1, source: (await h.record()).source, document: structuredClone(before) }
    const { worldbook } = await h.adapter.getWorldbook('audit', '审计书')
    const entries = structuredClone(worldbook.entries)
    entries[0].enabled = false
    await h.adapter.replaceWorldbook('audit', '审计书', entries, worldbook.entries)
    assert.equal((await h.adapter.getWorldbook('audit', '审计书')).worldbook.entries[0].enabled, false)
    assert.deepEqual(await h.read(), before)
    const { worldInfo } = await h.adapter.loadWorldInfo('audit', '审计书')
    const updated = structuredClone(worldInfo)
    updated.entries[7].content = '只属于这局的新正文'
    await h.adapter.saveWorldInfo('audit', '审计书', updated, worldInfo)
    assert.equal((await h.adapter.loadWorldInfo('audit', '审计书')).worldInfo.entries[7].content, '只属于这局的新正文')
    assert.deepEqual(await h.read(), before)
  } finally { await h.cleanup() }
})

import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
test('原样宿主调用：更新世界书、保存 swipe、重新加载，实际进入准备草稿', async () => {
  const { service } = fixture()
  const draft = await service.create('card')
  let receive, selected
  const parent = { postMessage(message) {
    Promise.resolve().then(async () => {
      let result
      if (message.type === 'dsh-tavern-opening-read') result = service.get(draft.id)
      if (message.type === 'dsh-tavern-opening-worldbook') result = await service.replaceWorldbook(draft.id, message.entries, message.expectedEntries)
      if (message.type === 'dsh-tavern-opening-save') result = service.select(draft.id, ['primary', 'alternate:0'][message.swipeId])
      if (message.type === 'dsh-tavern-opening-select') selected = message.swipeId
      receive({ source: parent, data: { type: 'dsh-tavern-opening-response', token: 'test', requestId: message.requestId, ok: true, result } })
    })
  } }
  const context = vm.createContext({ window: {}, parent, setTimeout, clearTimeout, console, addEventListener: (_, callback) => { receive = callback } })
  vm.runInContext(await readFile(new URL('../tavern-plugin/src/client/opening-preview.js', import.meta.url), 'utf8'), context)
  context.installOpeningPreviewBridge('test', { preparationId: draft.id, swipes: ['首页', '第二幕'], openingIds: ['primary', 'alternate:0'], selectedIndex: 0, worldbook: draft.worldbook })
  const host = context.window
  await host.TavernHelper.updateWorldbookWith(host.TavernHelper.getCharWorldbookNames('current').primary, rows => rows.map(row => ({ ...row, enabled: true })))
  host.SillyTavern.chat[0].swipe_id = 1
  host.SillyTavern.chat[0].mes = host.SillyTavern.chat[0].swipes[1]
  await host.SillyTavern.saveChat()
  assert.equal(service.get(draft.id).openingId, 'alternate:0')
  assert.equal(selected, undefined, 'save must not destroy the awaiting page')
  await host.SillyTavern.reloadCurrentChat()
  assert.equal(selected, 1)
  assert.equal(service.resolve(draft.id, 'card', 'alternate:0').worldbookSnapshot.document.entries[0].enabled, true)
  await assert.rejects(host.waitGlobalInitialized('Mvu'), /尚未初始化/, 'must not claim an unloaded MVU is ready')
})

import { TavernPromptTemplateRuntime } from '../tavern-plugin/lib/domain/tavern-prompt-template-runtime.js'
test('准备页加载真实模板引擎，运行时变量和插件设置均隔离保存', async () => {
  const { record } = fixture()
  const service = createOpeningPreparation({ readCard: async () => card, worldBooks: { bound: async () => record }, templateRuntime: () => TavernPromptTemplateRuntime.create() })
  const draft = await service.create('card', { runtime: true })
  assert.equal(draft.runtime.context.extensionSettings.EjsTemplate.enabled, true)
  assert.equal(draft.runtime.scripts[0].system, 'official-mvu')
  assert.match(draft.runtime.scripts[0].assetUrl, /vendor\/magvarupdate\/bundle.js$/)
  const result = await service.callRuntime(draft.id, 'updateTavernHelperVariables', { option: { type: 'message', message_id: 0 }, variables: { stat_data: { hp: 10 }, schema: {} } })
  assert.equal(result.context.messages[0].variables.stat_data.hp, 10)
  const settings = { ...draft.runtime.context.extensionSettings, mvu: { enabled: true } }
  const saved = await service.callRuntime(draft.id, 'saveTavernExtensionSettings', { settings, expectedSettings: draft.runtime.context.extensionSettings })
  assert.deepEqual(saved.extensionSettings, settings)
  const second = await service.create('card', { runtime: true })
  assert.equal(second.runtime.context.extensionSettings.mvu, undefined)
  await assert.rejects(service.callRuntime(draft.id, 'updateTavernHelperMessages', { messages: [{ message_id: 0, message: '改写剧情' }] }), /只能更新开场变量/)
})


test('准备页独立生成只返回文本，不修改草稿或初始化游戏', async () => {
  let captured
  const service = createOpeningPreparation({ readCard: async () => structuredClone(card), worldBooks: { bound: async () => null },
    generateRaw: async (config, context) => { captured = { config, context }; return '档案结果' } })
  const draft = await service.create('card')
  const before = service.get(draft.id)
  assert.deepEqual(await service.callRuntime(draft.id, 'generateTavernHelperRaw', { config: { ordered_prompts: [] } }), { text: '档案结果' })
  assert.equal(captured.context.sessionId, '')
  assert.deepEqual(service.get(draft.id), before)
  await assert.rejects(service.callRuntime('missing', 'generateTavernHelperRaw', {}), /准备/)
})


test('准备页复用正式脚本选择，保留启用脚本并排除重复 MVU 核心', async () => {
  const scripts = [
    { id: 'core', name: 'MVU', type: 'script', enabled: true, content: 'core' },
    { id: 'aux', name: '辅助', type: 'script', enabled: true, content: 'window.aux = true', data: { count: 1 } },
    { id: 'off', name: '关闭', type: 'script', enabled: false, content: 'throw Error()' }
  ]
  const service = createOpeningPreparation({ readCard: async () => structuredClone(card), worldBooks: { bound: async () => null },
    readRuntimeExtensions: async () => ({ helperScripts: scripts }) })
  const draft = await service.create('card')
  assert.deepEqual(draft.runtime.scripts.map(s => s.id), ['aux'])
  assert.equal(draft.runtime.context.mvuEnabled, false)
  draft.runtime.scripts[0].data.count = 100
  assert.equal(service.get(draft.id).runtime.scripts[0].data.count, 1)
})

test('opening API restores its response listener after document replacement', async () => {
  const listeners = new Set()
  const entries = [{ name: 'mode', enabled: true }]
  const parent = { postMessage(message) {
    assert.match(message.requestId, /^opening-preview:/)
    queueMicrotask(() => {
      for (const receive of listeners) receive({ source: parent, data: {
        type: 'dsh-tavern-opening-response', token: 'replacement', requestId: message.requestId,
        ok: true, result: { worldbook: { name: 'book', entries } }
      } })
    })
  } }
  const context = vm.createContext({ window: {}, parent, setTimeout, clearTimeout, console,
    addEventListener: (_, handler) => listeners.add(handler) })
  vm.runInContext(await readFile(new URL('../tavern-plugin/src/client/opening-preview.js', import.meta.url), 'utf8'), context)
  context.installOpeningPreviewBridge('replacement', { preparationId: 'draft', swipes: [''], openingIds: ['primary'], selectedIndex: 0, worldbook: { name: 'book', entries } })
  listeners.clear() // document.open clears listeners but keeps global API functions.
  assert.equal((await context.window.getWorldbook('book'))[0].name, 'mode')
})
