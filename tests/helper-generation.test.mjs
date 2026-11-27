import test from 'node:test'
import assert from 'node:assert/strict'
import { createTemplateHandlers } from '../tavern-plugin/lib/rpc/template.js'
import { generateHelper, generateHelperRaw, generateHelperCompletion } from "../tavern-plugin/lib/domain/helper-generation.js"
import { compileHelperGenerate, resolveHelperGenerationPreset } from '../tavern-plugin/lib/domain/helper-generation-prompts.js'
import { createHelperGenerationTasks } from '../tavern-plugin/lib/domain/helper-generation-tasks.js'
import { createServerTemplateRuntime } from '../tavern-plugin/lib/domain/server-template-runtime.js'
import { createCardOpeningRuntime } from '../tavern-plugin/lib/domain/card-opening-runtime.js'
import { createCleanCompatibilityPreset } from '../tavern-plugin/lib/domain/sillytavern-compatibility.js'
import { inspectWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'

function generationRpc(dependencies) {
  const handlers = createTemplateHandlers(dependencies)
  return (method, args) => handlers[method](args, method)
}

function generationContext() {
  const preset = createCleanCompatibilityPreset()
  preset.entries.unshift({ entryKey: 'custom', identifier: 'custom', role: 'system', content: 'Preset for {{char}}', ordered: true, enabled: true })
  return {
    sessionId: 'story',
    chat: { macroState: { userName: 'Player', local: {}, global: {} }, variables: { location: 'forest' }, messages: [], tavernScriptPrompts: [] },
    card: { name: 'Hero', description: 'Card description for {{user}}', personality: 'Kind', scenario: 'A forest', mes_example: 'An unstructured example', system_prompt: 'Card system', post_history_instructions: 'Card tail' },
    presetSnapshot: { compatibilityPreset: preset, compatibilityPresetDocument: {} },
    history: [{ role: 'user', text: 'old history' }, { role: 'assistant', text: 'new history' }],
    worldBook: { view: { raw: {}, entries: [
      { ref: 'constant', constant: true, enabled: true, content: 'Constant lore', position: 0 },
      { ref: 'keyword', enabled: true, primaryKeys: ['dragon'], content: 'Dragon lore', position: 1 },
      { ref: 'inactive', enabled: true, primaryKeys: ['missing-key'], content: 'Inactive lore', position: 1 },
      { ref: 'disabled', constant: true, enabled: false, content: 'Disabled lore', position: 0 }
    ] } }
  }
}

test('generate inserts worldbook and script depths locally and scans none-position injections', async () => {
  const context = generationContext()
  context.worldBook.view.entries.push({ ref: 'depth', enabled: true, constant: true, content: 'Depth lore', position: 4, depth: 1, role: 2 })
  context.chat.tavernScriptPrompts = [{ id: 'stored', role: 'system', content: 'Stored script', position: 'in_chat', depth: 0, once: true }]
  const config = { user_input: 'Current', injects: [
    { role: 'system', content: 'dragon', position: 'none', should_scan: true },
    { role: 'user', content: 'One-call injection', position: 'in_chat', depth: 0 }
  ] }
  const messages = await compileHelperGenerate(config, context), texts = messages.map(message => message.content)
  assert.ok(texts.includes('Dragon lore'))
  assert.ok(!texts.includes('dragon'))
  assert.ok(texts.indexOf('Depth lore') < texts.indexOf('Current'))
  assert.equal(messages.find(message => message.content === 'Depth lore').role, 'assistant')
  assert.ok(texts.indexOf('Stored script') > texts.indexOf('Current'))
  assert.ok(texts.indexOf('One-call injection') > texts.indexOf('Stored script'))
  assert.equal(context.chat.tavernScriptPrompts.length, 1, 'one-shot prompts are not consumed by an independent helper task')
  assert.ok(!(await compileHelperGenerate({ ...config, overrides: { chat_history: { with_depth_entries: false } } }, context)).some(message => message.content === 'Depth lore'))
})

test('generate rejects unsupported or malformed inputs before calling the model', async () => {
  for (const config of [null, [], { image: 'image.png' }, { tools: [{}] }, { json_schema: {} }, { user_input: 3 }, { max_chat_history: -1 },
    { overrides: { chat_history: { prompts: [{ role: 'tool', content: 'wrong' }] } } },
    { overrides: { char_description: {} } }, { injects: [{ role: 'system', content: 'x', position: 'in_chat', depth: -1 }] },
    { injects: [{ role: 'system', content: 'x', position: 'in_chat', filter: true }] }]) {
    await assert.rejects(generateHelper(config, { ...generationContext(), callModel: () => assert.fail('invalid request reached model') }))
  }
  const context = generationContext()
  context.card.description = '<%= getvar("state") %>'
  await assert.rejects(compileHelperGenerate({ user_input: 'hello' }, context), /EJS/)
  assert.ok((await compileHelperGenerate({ user_input: 'hello', overrides: { char_description: 'rendered state' } }, context)).some(message => message.content === 'rendered state'))
})

test('Helper generation projects bound EJS, preserves positions and follows activations without writing state', async t => {
  const fixture = generationContext()
  const chat = { ...fixture.chat, sessionId: 'story', cardPath: 'cards/hero.json' }
  const globalVariables = { route: 'initial' }
  const entries = [
    { constant: true, order: 100, position: 0, content: 'Before <%= getvar("route", { scope: "global" }) %>' },
    { constant: true, order: 90, position: 1, content: '<% setvar("route", "local", { scope: "global" }); await window.EjsTemplate.saveVariables(true); await activewi("book", 3, true); %>' },
    { constant: true, order: 100, position: 1, content: 'After <%= getvar("route", { scope: "global" }) %>' },
    { enabled: false, order: 70, position: 4, depth: 0, role: 2, content: 'Depth <%= getvar("route", { scope: "global" }) %>' },
    { primaryKeys: ['dragon'], order: 60, position: 1, content: 'Keyword <%= 2 + 3 %>' },
  ].map((entry, uid) => ({ enabled: true, ...entry, sourceUid: uid, ref: `entry:${uid}`, title: `Lore ${uid}` }))
  const worldBook = { view: { displayName: 'book', entries } }
  const snapshot = {
    state: { sessionId: chat.sessionId, chatId: chat.sessionId, lifecycleRevision: 0, stateRevision: 0, chat: [], chat_metadata: { variables: chat.variables } },
    environment: {
      characters: [{ name: 'Hero', mes_example: '', data: { name: 'Hero', extensions: { world: 'book' } } }], this_chid: '0', name1: 'Player', name2: 'Hero',
      world_names: ['book'], selected_world_info: [], dsh: { regexScripts: [] },
      extension_settings: { regex: [], variables: { global: globalVariables }, EjsTemplate: { enabled: true, autosave_enabled: true } },
      worldbooks: { book: { entries: Object.fromEntries(entries.map(entry => [entry.sourceUid, {
        uid: entry.sourceUid, comment: entry.title, content: entry.content, disable: !entry.enabled, key: entry.primaryKeys || [], keysecondary: [], order: entry.order
      }])) } }
    }
  }
  const original = structuredClone(snapshot)
  const runtime = createServerTemplateRuntime({ rpc: async (method, args) => {
    assert.equal(args.sessionId, 'story')
    assert.equal(method, 'getFullPromptTemplateState', 'an independent generation may only read the host snapshot')
    return structuredClone(snapshot)
  } })
  t.after(() => runtime.dispose())
  let messages
  const invoke = generationRpc({ fullTemplateRuntime: runtime, helperGenerationTasks: createHelperGenerationTasks(), chatForSession: async () => chat,
    readChatCard: async () => fixture.card, readCardExtensions: async () => ({}), worldBooks: { bound: async () => worldBook },
    readPromptTemplateGlobalVariables: async () => globalVariables, helperGenerationPreset: async () => fixture.presetSnapshot,
    tavernScriptHostAdapter: { readGlobalPromptTemplateSettings: async () => ({ settings: snapshot.environment.extension_settings.EjsTemplate }) },
    callModel: async request => { messages = request.messages.map(message => [message.role, message.content[0].text]); return 'reply' } })
  const generate = (method, config) => invoke(method, { sessionId: 'story', config: { user_input: 'dragon', ...config } })
  assert.deepEqual(await generate('generateTavernHelper'), { text: 'reply' })
  const before = messages.findIndex(([, text]) => text === 'Before initial')
  const after = messages.findIndex(([, text]) => text.includes('After local') && text.includes('Keyword 5'))
  assert.ok(before >= 0 && after > before, JSON.stringify(messages))
  assert.deepEqual(messages[messages.findIndex(([role]) => role === 'user') + 1], ['assistant', 'Depth local'])
  assert.ok(messages.every(([, text]) => !text.includes('<%')))
  assert.deepEqual(snapshot, original)

  await generate('generateTavernHelperRaw', { overrides: { world_info_before: 'before override', chat_history: { with_depth_entries: false } } })
  assert.ok(messages.some(([, text]) => text === 'before override'))
  assert.ok(messages.every(([, text]) => !text.includes('Depth local')))
  await generate('generateTavernHelperRaw', { ordered_prompts: ['user_input'] })
  assert.deepEqual(messages, [['user', 'dragon']])

  entries[2].content = '<%= throw %>'
  await assert.rejects(generate('generateTavernHelper'), /Lore 2（entry:2，syntax-error）/)
  snapshot.environment.extension_settings.EjsTemplate.generate_enabled = false
  await assert.rejects(generate('generateTavernHelper'), /生成模板已停用/)
})

test('opening Helper generation projects the draft book with the same template world name', async t => {
  let invoke, messages
  const fullTemplateRuntime = createServerTemplateRuntime({ rpc: (method, args) => invoke(method, args) })
  t.after(() => fullTemplateRuntime.dispose())
  const document = { name: 'Draft book', entries: {
    0: { uid: 0, constant: true, position: 1, content: '<% const book = (await window.TavernHelper.getWorldbook("current")); if (book.length) await activewi(getCharWorldbookNames().primary, 1, true); %>' },
    1: { uid: 1, disable: true, position: 1, content: 'Draft <%= 2 + 3 %>' }
  } }
  const { openingPreparation } = createCardOpeningRuntime({ fullTemplateRuntime,
    readCard: async () => ({ name: 'Hero', first_mes: 'Opening' }), worldBooks: { bound: async () => ({ view: inspectWorldBookDocument(document) }) },
    tavernExtensionSettings: { read: async () => ({ EjsTemplate: { enabled: true } }) },
    readCardExtensions: async () => ({}), tavernRemoteAssets: { pinExtensions: async () => ({}) },
    helperGenerationPreset: async () => null,
    callModel: async request => { messages = request.messages; return 'reply' } })
  t.after(() => openingPreparation.dispose())
  invoke = generationRpc({ openingPreparation })
  const draft = await openingPreparation.create('cards/hero.json')
  const before = openingPreparation.templateState(draft.id)
  const reply = await openingPreparation.callRuntime(draft.id, 'generateTavernHelper', { config: { user_input: 'Start' } })
  assert.deepEqual(reply, { text: 'reply' })
  assert.ok(messages.some(message => message.content[0].text === 'Draft 5'))
  assert.deepEqual(openingPreparation.templateState(draft.id), before)
})

test('generation RPC resolves named presets without changing selection and scopes cancellation to Helper work', async () => {
  const fixture = generationContext(), requests = [], tasks = createHelperGenerationTasks()
  const chat = { ...fixture.chat, id: 'game', sessionId: 'story', cardPath: 'cards/hero.json', runtimePresetSnapshot: fixture.presetSnapshot,
    messages: [{ role: 'assistant', text: 'old body', swipes: ['old body', 'selected body'], swipeId: 1 }] }
  const named = createCleanCompatibilityPreset()
  named.entries.unshift({ entryKey: 'named', identifier: 'named', role: 'system', content: 'Named preset text', ordered: true, enabled: true })
  const before = structuredClone(chat)
  let heldSignal, started
  const ready = new Promise(resolve => { started = resolve })
  const invoke = generationRpc({ helperGenerationTasks: tasks, chatForSession: async id => id === 'story' ? chat : null,
    callModel: async options => {
      requests.push(options)
      if (options.messages.some(message => message.content[0].text === 'hold')) { heldSignal = options.signal; started(); return new Promise(() => {}) }
      return 'reply'
    },
    readChatCard: async () => fixture.card, worldBooks: { bound: async () => fixture.worldBook }, readCardExtensions: async () => ({ variables: {} }),
    helperGenerationPreset: (name, snapshot) => resolveHelperGenerationPreset(name, snapshot, {
      catalog: async () => ({ presets: [{ path: 'presets/named.json', title: 'Named' }] }),
      read: async path => { assert.equal(path, 'presets/named.json'); return named }, readDocument: async () => ({}) }) })
  assert.deepEqual(await invoke('generateTavernHelper', { sessionId: 'story', config: { preset_name: 'Named', generation_id: 'complete', user_input: 'hello' } }), { text: 'reply' })
  // Tavern Helper's generateRaw without ordered_prompts is the default-order request generate builds.
  assert.deepEqual(await invoke('generateTavernHelperRaw', { sessionId: 'story', config: { preset_name: 'Named', generation_id: 'default-order', user_input: 'hello' } }), { text: 'reply' })
  assert.ok(JSON.stringify(requests.at(-1).messages).includes('Named preset text'), '缺省顺序的 generateRaw 按 generate 组装')
  requests.splice(1)
  assert.ok(JSON.stringify(requests[0].messages).includes('Named preset text'))
  assert.ok(JSON.stringify(requests[0].messages).includes('selected body'))
  assert.equal(requests[0].background, true)
  assert.deepEqual(chat, before)
  await assert.rejects(invoke('generateTavernHelper', { sessionId: 'story', config: { preset_name: 'missing' } }), /预设不存在/)
  assert.deepEqual(await invoke('stopTavernHelperGeneration', { sessionId: 'story', generationId: 'uploading', generationToken: 'token', pending: true }), { stopped: true })
  await assert.rejects(invoke('generateTavernHelperRaw', { sessionId: 'story', generationToken: 'token', config: { generation_id: 'uploading', ordered_prompts: [{ role: 'user', content: 'late upload' }] } }), { name: 'AbortError' })
  assert.equal(requests.length, 1, 'cancel-before-admission must not reach the model')
  const pending = invoke('generateTavernHelperRaw', { sessionId: 'story', config: { generation_id: 'held', ordered_prompts: [{ role: 'user', content: 'hold' }] } })
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  await ready
  assert.deepEqual(await invoke('stopTavernHelperGeneration', { sessionId: 'another', generationId: 'held' }), { stopped: false })
  assert.deepEqual(await invoke('stopAllTavernHelperGeneration', { sessionId: 'story' }), { stopped: true, generationIds: ['held'] })
  await rejected
  assert.equal(heldSignal.aborted, true)
})

test('extra model connection and credentials cannot override host routing', async () => {
  let request
  await generateHelperRaw({ ordered_prompts: [{ role: 'user', content: 'hello' }], custom_api: { apiurl: 'https://ignored.invalid', key: 'private', model: 'ignored', temperature: 0.4, max_tokens: 100 } }, { callModel: async value => { request = value; return 'hello' } })
  assert.equal(request.temperature, 0.4)
  assert.equal(request.maxTokens, 100)
  assert.ok(!JSON.stringify(request).includes('private'))
  assert.ok(!JSON.stringify(request).includes('ignored'))
  await generateHelperCompletion({ model: 'ignored', messages: [{ role: 'user', content: 'neutral test' }], max_tokens: 20 }, { sessionId: 'session', callModel: async value => { request = value; return 'ok' } })
  assert.equal(request.sessionId, 'session')
  assert.equal(request.maxTokens, 20)
  assert.deepEqual(request.messages, [{ role: 'user', content: [{ type: 'text', text: 'neutral test' }] }])
  for (const extra of [{ tools: [{}] }, { n: 2 }, { temperature: NaN }, { max_tokens: -1 }]) {
    await assert.rejects(generateHelperCompletion({ messages: [{ role: 'user', content: 'hello' }], ...extra }, { callModel: () => assert.fail('invalid request') }))
  }
})
