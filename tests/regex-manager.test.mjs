import assert from 'node:assert/strict'
import test from 'node:test'
import { createRegexManager } from '../tavern-plugin/lib/domain/regex-manager.js'
import { createTavernRegexSettings } from '../tavern-plugin/lib/domain/regex-settings.js'
import { createRegexHandlers } from '../tavern-plugin/lib/rpc/regex.js'

function extensionSettings(initial = {}) {
  let settings = structuredClone(initial)
  return {
    async read() { return structuredClone(settings) },
    async save(next, expected) {
      if (JSON.stringify(settings) !== JSON.stringify(expected)) throw new Error('插件设置已被其他窗口修改')
      settings = structuredClone(next)
      return structuredClone(settings)
    },
    current: () => structuredClone(settings)
  }
}

function legacyLibrary(items = []) {
  let migrated = false
  return {
    async legacyForMigration() { return migrated ? [] : structuredClone(items) },
    async markMigrated() { migrated = true },
    migrated: () => migrated
  }
}

function sampleChat() {
  return {
    id: 'chat-1', mode: 'story', cardPath: 'cards/x.png', cardName: '灯塔小镇',
    runtimePresetSnapshot: {
      presetPath: 'presets/p.json', presetName: 'warm-narrative',
      regexScripts: [
        { id: 'p1', regexKey: 'p1#1', name: '旁白转引用', findRegex: '/^【旁白】(.*)$/gm', replaceString: '> $1', placement: [2], enabled: true }
      ]
    },
    regexOverrides: { preset: { 'p1#1': false }, card: { c1: true } }
  }
}

function cardSources() {
  return {
    regexScripts: [
      { id: 'c1', ref: 'regex:0', name: '选项折叠', findRegex: '/x/g', replaceString: 'y', placement: [2], enabled: false },
      { id: 'c2', ref: 'regex:1', name: '状态封存', findRegex: '/s/g', replaceString: 't', placement: [2], enabled: true }
    ]
  }
}

function harness(options = {}) {
  const store = extensionSettings({ variables: { global: {} }, regex: options.global || [] })
  const settings = createTavernRegexSettings({ extensionSettings: store })
  const legacy = legacyLibrary(options.legacy || [])
  let chat = options.chat === null ? null : (options.chat || sampleChat())
  const updates = []
  const manager = createRegexManager({
    regexSettings: settings,
    legacyLibrary: legacy,
    chatForSession: async id => id === 'session-1' ? structuredClone(chat) : undefined,
    groupOfMode: mode => ['story', 'script'].includes(mode) ? 'play' : 'card',
    readCardSources: async () => (options.cardSources || cardSources()),
    updateChat: async (id, mutation, metadata) => {
      updates.push({ id, metadata })
      chat = mutation(structuredClone(chat))
      return structuredClone(chat)
    }
  })
  return { manager, store, legacy, updates, chat: () => chat }
}

test('imports SillyTavern exports into the global list and keeps their disabled flag', async () => {
  const h = harness({ global: [], chat: null })
  const data = await h.manager.read('')
  const result = await h.manager.importGlobal({ text: JSON.stringify([{ scriptName: '导入A', findRegex: '/a/g', replaceString: 'A', placement: [2] }, { scriptName: '导入B', findRegex: '/b/g', disabled: true }]), fileName: 'x', revision: data.revision })
  assert.equal(result.imported, 2)
  assert.deepEqual(result.global.map(entry => [entry.name, entry.enabled]), [['导入A', true], ['导入B', false]])
  await assert.rejects(h.manager.importGlobal({ text: '{', fileName: 'bad', revision: result.revision }), /不是有效的 JSON/)
  await assert.rejects(h.manager.importGlobal({ text: '{"findRegex":""}', fileName: 'bad', revision: result.revision }), /缺少 findRegex/)
})

test('RPC handlers expose the manager without leaking storage details', async () => {
  const h = harness({ global: [{ id: 'g1', scriptName: 'A', findRegex: '/a/g', replaceString: 'A', placement: [2] }] })
  const handlers = createRegexHandlers({ regexManager: h.manager, str: String })
  const data = await handlers.getRegexManager({ sessionId: 'session-1' })
  assert.equal(data.preset.name, 'warm-narrative')
  const written = await handlers.writeGlobalRegexes({ revision: data.revision, scripts: data.global.map(entry => ({ ...entry, enabled: false })) })
  assert.equal(written.global[0].enabled, false)
  const overridden = await handlers.setRegexOverride({ sessionId: 'session-1', source: 'preset', key: 'p1#1', enabled: true })
  assert.deepEqual(overridden.overrides.preset, { 'p1#1': true })
  const batch = await handlers.setRegexOverrides({ sessionId: 'session-1', changes: [{ source: 'card', key: 'c1', enabled: false }] })
  assert.deepEqual(batch.overrides.card, { c1: false })
  const previewed = await handlers.previewRegexScripts({ text: 'a', scripts: [{ name: 'A', findRegex: '/a/g', replaceString: 'b', placement: [2] }] })
  assert.equal(previewed.text, 'b')
  await assert.rejects(handlers.setRegexOverride({ sessionId: 'session-1', source: 'preset', key: 'p1#1' }), /启用状态无效/)
})
