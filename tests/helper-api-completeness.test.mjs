import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { helperHostHarness, helperClient } from './fixtures/helper-host-harness.mjs'
import { stubFrameDependencyImports } from './fixtures/frame-dependency-imports.mjs'

// This catalog comes from the pinned upstream declarations, not our export list.
const official = JSON.parse(await readFile(new URL('./fixtures/tavern-helper-official-api.json', import.meta.url)))
const openingBridge = await readFile(new URL('../tavern-plugin/src/client/opening-preview.js', import.meta.url), 'utf8')
const plain = value => JSON.parse(JSON.stringify(value))
const context = () => ({ chatId: 'coverage', characterName: 'Card', playerName: 'Player', character: { name: 'Card', avatar: 'card.png' },
  worldbook: { name: 'Bound', entries: [] }, messages: [{ message_id: 0, role: 'assistant', message: 'Opening', variables: { stat_data: { score: 1 } } }],
  turnMessageIds: { 1: 0 }, chatVariables: {}, regexScripts: { global: [], character: [], preset: [] } })

function storage() {
  const values = new Map()
  return { get length() { return values.size }, key: i => [...values.keys()][i],
    getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
}
function frame(state = context(), localStorage = storage()) {
  const listeners = [], sent = [], parent = { postMessage: value => sent.push(value) }
  const scope = { parent, console, structuredClone, localStorage, Response, Blob, URL, setTimeout, clearTimeout,
    addEventListener(name, listener) { if (name === 'message') listeners.push(listener) } }
  scope.window = scope
  vm.createContext(scope)
  const html = helperClient.buildTavernFrameDocument({ content: '<p>card</p>', token: 'coverage', helperContext: state, turn: 1 })
  for (const match of html.matchAll(/<script data-dsh-tavern-(?:helper|interactive-helper|frame-variable-aliases)>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(stubFrameDependencyImports(match[1]), scope)
  }
  return { window: scope, sent, calls: () => sent.filter(call => call.type === 'dsh-tavern-helper-call'),
    reply(call, result, ok = true) {
      for (const listener of listeners) listener({ source: parent, data: {
        type: 'dsh-tavern-helper-response', token: 'coverage', requestId: call.requestId, ok, result, error: ok ? undefined : result
      } })
    } }
}
function environment(kind, state = context(), localStorage = storage()) {
  if (kind === 'script') return helperHostHarness(state, { localStorage })
  const run = frame(state, localStorage)
  if (kind.startsWith('opening')) {
    vm.runInContext(openingBridge, run.window)
    run.window.installOpeningPreviewBridge('coverage', { runtime: kind === 'opening-runtime', swipes: ['Opening'], selectedIndex: 0,
      openingIds: ['primary'], worldbook: state.worldbook, characterName: state.characterName })
  }
  return run
}

for (const kind of ['script', 'message', 'opening-runtime', 'opening-static']) {
  test(kind + ': every upstream function and exported object has both entry points', () => {
    const w = environment(kind).window
    for (const { name } of official.functions) {
      assert.equal(typeof w[name], 'function', name + ' global')
      assert.equal(typeof w.TavernHelper[name], 'function', name + ' namespace')
      assert.equal(w.TavernHelper[name], w[name], name + ' alias')
    }
    for (const [name, type] of Object.entries(official.exports)) {
      assert.equal(typeof w[name], type, name)
      assert.equal(w.TavernHelper[name], w[name])
    }
    assert.equal(w.tavern_events.WORLDINFO_UPDATED, 'worldinfo_updated')
  })

  test(kind + ': create, bind, update and delete a named compatibility worldbook', async () => {
    const w = environment(kind).window
    assert.equal(await w.createWorldbook('Side book'), true)
    assert.equal(await w.createWorldbook('Side book'), false)
    await w.rebindChatWorldbook('current', 'Side book')
    await w.rebindGlobalWorldbooks(['Side book'])
    await w.rebindCharWorldbooks('current', { primary: 'Side book', additional: ['Bound'] })
    assert.equal(w.getChatWorldbookName('current'), 'Side book')
    assert.deepEqual(plain(w.getGlobalWorldbookNames()), ['Side book'])
    const added = await w.createWorldbookEntries('Side book', [{ name: 'A', content: 'one' }, { name: 'B', content: 'two' }])
    assert.equal(added.new_entries.length, 2)
    await w.updateWorldbookWith('Side book', async entries => { entries[0].content = 'changed'; return entries })
    assert.equal((await w.getWorldbook('Side book'))[0].content, 'changed')
    const removed = await w.deleteWorldbookEntries('Side book', e => e.name === 'A')
    assert.equal(removed.deleted_entries.length, 1)
    assert.equal(await w.deleteWorldbook('Side book'), true)
    assert.equal(w.getChatWorldbookName('current'), null)
    assert.deepEqual(plain(w.getGlobalWorldbookNames()), [])
    assert.equal(w.getCharWorldbookNames('current').primary, null)
  })
}

for (const kind of ['script', 'message']) {
  test(kind + ': local management round trips survive reopening and stay isolated from other chats', async () => {
    const localStorage = storage(), run = environment(kind, context(), localStorage), w = run.window
    await w.createWorldbook('Saved', [{ name: 'Entry', content: 'persisted' }])
    await w.rebindChatWorldbook('current', 'Saved')
    w.setLorebookSettings({ scan_depth: 9 })
    await w.createCharacter('Other', { description: 'Other character' })
    await w.createPersona('Reader', { description: 'Reader persona' })
    await w.createPreset('Story', { settings: { temperature: 0.5 } })
    assert.equal(w.loadPreset('Story'), true)
    w.replaceVariables({ value: 1 }, { type: 'preset' })
    w.insertOrAssignVariables({ extra: 2 }, { type: 'extension', extension_id: 'plugin' })
    const reopened = environment(kind, context(), localStorage).window
    assert.equal((await reopened.getWorldbook('Saved'))[0].content, 'persisted')
    assert.equal(reopened.getChatWorldbookName('current'), 'Saved')
    assert.equal(reopened.getLorebookSettings().scan_depth, 9)
    assert.equal((await reopened.getCharacter('Other')).description, 'Other character')
    assert.equal(reopened.getPersona('Reader').description, 'Reader persona')
    assert.equal(reopened.getPreset('in_use').settings.temperature, 0.5)
    assert.deepEqual(plain(reopened.getVariables({ type: 'preset' })), { value: 1 })
    assert.deepEqual(plain(reopened.getVariables({ type: 'extension', extension_id: 'plugin' })), { extra: 2 })
    assert.deepEqual(plain(reopened.getVariables({ type: 'message' })), { stat_data: { score: 1 } })
    const other = environment(kind, { ...context(), chatId: 'other' }, localStorage).window
    assert.equal(other.getWorldbookNames().includes('Saved'), false)
    assert.deepEqual(plain(other.getVariables({ type: 'preset' })), {})
    assert.equal(run.calls().length, 0, 'local operations never send an invented host method')
  })
}

test('the original opening API sequence reaches message creation and trigger with a bound native book', async () => {
  for (const kind of ['script', 'message']) {
    const run = environment(kind), w = run.window
    assert.ok(await w.waitGlobalInitialized('Mvu'))
    assert.equal(w.getWorldbookNames().includes('Bound'), true)
    await w.rebindChatWorldbook('current', 'Bound')
    assert.equal(w.getChatWorldbookName('current'), 'Bound')
    const message = w.createChatMessages([{ role: 'user', message: 'Begin the story' }])
    const call = run.calls().at(-1)
    assert.equal(call.method, 'createTavernHelperMessages')
    run.reply(call, { updated: true }); await message
    const trigger = w.triggerSlash('/trigger')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(run.calls().at(-1).method, 'triggerTavernSlash')
    run.reply(run.calls().at(-1), { pipe: 'started' })
    assert.equal(await trigger, 'started')
  }
})

test('native worldbook edits retain their host version checks and report stale writes', async () => {
  const run = frame(), w = run.window
  const pending = w.createWorldbookEntries('Bound', [{ name: 'Native', content: 'entry' }])
  assert.equal(run.calls()[0].method, 'getTavernHelperWorldbook')
  run.reply(run.calls()[0], { worldbook: { name: 'Bound', version: 'v1', entries: [] } })
  await new Promise(resolve => setImmediate(resolve))
  const patch = run.calls().at(-1)
  assert.equal(patch.method, 'patchTavernHelperWorldbook')
  assert.equal(patch.args.patch.version, 'v1')
  run.reply(patch, 'worldbook changed', false)
  await assert.rejects(pending, /worldbook changed/)
})

test('native global regex replace saves and returns without a missing-function error', async () => {
  const run = environment('script'), w = run.window
  const rules = [{ id: 'r', script_name: 'Rule', enabled: true, find_regex: 'token', replace_string: 'value', trim_strings: [],
    source: { ai_output: true }, destination: { display: true }, min_depth: null, max_depth: null }]
  const pending = w.replaceTavernRegexes(rules, { type: 'global' })
  await new Promise(resolve => setImmediate(resolve))
  const call = run.calls().at(-1)
  assert.equal(call.method, 'saveTavernExtensionSettings')
  run.reply(call, { updated: true, extensionSettings: call.args.settings })
  await pending
  assert.equal(w.getTavernRegexes({ type: 'global' })[0].find_regex, 'token')
  assert.equal(w.getTavernRegexes({ type: 'global' })[0].source.ai_output, true)
})

test('message-frame regex editing, macros and legacy worldbook entry aliases have real round trips', async () => {
  const w = frame().window
  await w.updateTavernRegexesWith(rules => rules.concat([{ id: 'r', find_regex: 'token', replace_string: 'changed', enabled: true,
    source: { ai_output: true }, destination: { display: true } }]), { type: 'character' })
  assert.equal(w.formatAsTavernRegexedString('token', 'ai_output', 'display'), 'changed')
  const macro = w.registerMacroLike(/<count>/g, (ctx, text) => ctx.message_id + ':' + text)
  assert.equal(w.substitudeMacros('<count>', { message_id: 2 }), '2:<count>')
  macro.unregister()
  assert.equal(w.substitudeMacros('<count>'), '<count>')
  await w.createLorebook('Legacy')
  const added = await w.createLorebookEntries('Legacy', [{ comment: 'A', content: 'text', type: 'constant' }])
  await w.updatelorebookEntriesWith('Legacy', entries => { entries[0].content = 'updated'; return entries })
  assert.equal((await w.getLorebookEntries('Legacy'))[0].content, 'updated')
  assert.equal((await w.deleteLorebookEntries('Legacy', added.new_uids)).delete_occurred, true)
})

test('unavailable privileged/history operations return documented fallback shapes without RPC or rejection', async () => {
  const run = frame(), w = run.window
  assert.equal(w.isAdmin(), false)
  assert.equal(w.isInstalledExtension('unknown'), false)
  const result = await w.installExtension('https://example.invalid/plugin', 'global')
  assert.equal(result.ok, false)
  assert.equal(result.status, 501)
  assert.equal((await result.json()).success, false)
  await w.deleteChatMessages([0]); await w.rotateChatMessages(0, 1, 2)
  assert.equal(run.calls().length, 0)
  assert.equal(w.getChatMessages(0)[0].message, 'Opening')
  assert.equal(w.__dshTavernHelperCompatibility.modes.deleteChatMessages, 'unsupported')
})

test('character, persona, preset and script management support updater callbacks and deletion', async () => {
  const w = frame().window
  await w.createCharacter('Guest', { description: 'before' })
  await w.updateCharacterWith('Guest', async row => ({ ...row, description: 'after' }))
  assert.equal(w.getCharData('Guest').description, 'after')
  assert.equal(await w.deleteCharacter('Guest'), true)
  await w.createPersona('Reader', { title: 'before' })
  const id = w.getPersona('Reader').avatar_id
  await w.updatePersonaWith(id, row => ({ ...row, title: 'after' }))
  assert.equal(w.getPersona(id).title, 'after')
  assert.equal(await w.deletePersona(id), true)
  await w.createPreset('Draft')
  await w.updatePresetWith('Draft', row => ({ ...row, prompts: [{ id: 'main', content: 'test' }] }))
  assert.equal(await w.renamePreset('Draft', 'Story'), true)
  assert.equal(w.getPreset('Story').prompts[0].content, 'test')
  assert.equal(await w.deletePreset('Story'), true)
  await w.updateScriptTreesWith(async trees => trees.concat([{ type: 'script', id: 'new', name: 'Added', content: '' }]), { type: 'character' })
  assert.equal(w.getScriptTrees({ type: 'character' })[0].name, 'Added')
})

test('audio state, local file contents, model responses and raw regex import use usable return shapes', async () => {
  const w = frame().window
  w.Audio = class {
    constructor() { this.paused = true; this.duration = 10; this.currentTime = 2 }
    play() { this.paused = false; return Promise.resolve() }
    pause() { this.paused = true }
  }
  w.appendAudioList('bgm', [{ url: 'https://example.invalid/song' }])
  w.setAudioSettings('bgm', { volume: 25 })
  w.playAudio('bgm', w.getAudioList('bgm')[0])
  await Promise.resolve()
  assert.equal(w.getCurrentAudio('bgm').playing, true)
  assert.equal(w.getCurrentAudio('bgm').progress, 20)
  w.pauseAudio('bgm')
  assert.equal(w.getCurrentAudio('bgm').playing, false)
  w.fetch = fetch
  const url = await w.uploadTavernFile('hello.txt', Buffer.from('hello').toString('base64'))
  assert.ok(url.startsWith('data:'))
  assert.equal(await (await w.getTavernFile('hello.txt')).text(), 'hello')
  assert.equal(await w.deleteTavernFile('hello.txt'), true)
  assert.equal((await w.getTavernFile('hello.txt')).status, 404)
  const requests = []
  w.fetch = async (...args) => { requests.push(args); return new Response(JSON.stringify({ data: [{ id: 'model-a' }] })) }
  assert.deepEqual(plain(await w.getModelList({ apiurl: 'https://example.invalid/v1', key: 'test-key' })), ['model-a'])
  assert.equal(requests[0][0], 'https://example.invalid/v1/models')
  assert.equal(w.importRawTavernRegex('Imported', JSON.stringify({ findRegex: 'raw', replaceString: 'works', placement: [2], markdownOnly: true })), true)
  assert.equal(w.formatAsTavernRegexedString('raw', 'ai_output', 'display'), 'works')
})
