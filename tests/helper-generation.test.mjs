import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { generateHelper, generateHelperRaw, generateHelperCompletion, identifyHelperModelMessages, defaultOrderedRawConfig } from '../tavern-plugin/lib/domain/helper-generation.js'
import { compileHelperGenerate, validateHelperGenerateConfig, resolveHelperGenerationPreset, helperGenerationHistory } from '../tavern-plugin/lib/domain/helper-generation-prompts.js'
import { createHelperGenerationTasks } from '../tavern-plugin/lib/domain/helper-generation-tasks.js'
import { createCleanCompatibilityPreset } from '../tavern-plugin/lib/domain/sillytavern-compatibility.js'

const pluginSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const generationCases = pluginSource.slice(pluginSource.indexOf("      case 'generateTavernHelper':"), pluginSource.indexOf("      case 'callOpeningRuntime':"))
function generationRpc(dependencies) {
  return new Function('dependencies', 'globalDefaultOrder', `const { helperGenerationTasks, chatForSession, callModel, generateHelper, generateHelperRaw, generateHelperCompletion,
    helperGenerationHistory, validateHelperGenerateConfig, readChatCard, helperGenerationPreset, worldBooks, readCardExtensions, defaultOrderedRawConfig } = { defaultOrderedRawConfig: globalDefaultOrder, ...dependencies };
    return async (method, args) => { switch (method) { ${generationCases} } }`)(dependencies, defaultOrderedRawConfig)
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

test('generate applies nonempty and empty overrides instead of losing requested content', () => {
  const context = generationContext()
  const messages = compileHelperGenerate({ user_input: 'Current', max_chat_history: 0, overrides: {
    char_description: 'Replacement description', char_personality: '', scenario: 'Replacement scenario',
    persona_description: 'Replacement persona', world_info_before: '', world_info_after: 'Replacement lore', dialogue_examples: 'Replacement example',
    chat_history: { prompts: [{ role: 'assistant', content: 'Replacement history' }], author_note: 'Replacement author note', with_depth_entries: false }
  } }, context)
  const text = messages.map(message => message.content).join('\n')
  for (const value of ['Replacement description', 'Replacement scenario', 'Replacement persona', 'Replacement lore', 'Replacement example', 'Replacement history', 'Replacement author note']) assert.ok(text.includes(value), value)
  for (const value of ['Kind', 'Constant lore', 'new history', 'old history', 'Card description']) assert.ok(!text.includes(value), value)
  assert.ok(text.indexOf('Replacement history') < text.indexOf('Current'))
})

test('generate inherits supported preset sampling unless overridden or explicitly unset', async () => {
  const context = generationContext()
  context.presetSnapshot.compatibilityPresetDocument = { temperature: 0.7, openai_max_tokens: 240 }
  let request
  const call = custom_api => generateHelper({ user_input: 'hello', custom_api }, { ...context, callModel: async value => { request = value; return 'ok' } })
  await call(undefined)
  assert.equal(request.temperature, 0.7)
  assert.equal(request.maxTokens, 240)
  await call({ temperature: 'same_as_preset', max_tokens: 'unset' })
  assert.equal(request.temperature, 0.7)
  assert.equal(request.maxTokens, undefined)
  await call({ temperature: 0.1, max_completion_tokens: 30, apiurl: 'https://ignored.invalid', key: 'private' })
  assert.equal(request.temperature, 0.1)
  assert.equal(request.maxTokens, 30)
  assert.ok(!JSON.stringify(request).includes('private'))
})

test('preset lookup distinguishes an unselected chat from a preview and rejects ambiguous names', async () => {
  const presets = [{ title: 'Duplicate', path: 'presets/one.json' }, { title: 'Duplicate', path: 'presets/two.json' }]
  const deps = { catalog: async () => ({ presets }), selected: async () => ({ activePreset: 'presets/one.json' }),
    read: async () => createCleanCompatibilityPreset(), readDocument: async () => ({}) }
  assert.equal(await resolveHelperGenerationPreset('in_use', null, deps), null)
  assert.equal((await resolveHelperGenerationPreset('in_use', undefined, deps)).presetPath, 'presets/one.json')
  assert.equal((await resolveHelperGenerationPreset('presets/two.json', null, deps)).presetPath, 'presets/two.json')
  await assert.rejects(resolveHelperGenerationPreset('Duplicate', null, deps), /不唯一/)
})

test('generate inserts worldbook and script depths locally and scans none-position injections', () => {
  const context = generationContext()
  context.worldBook.view.entries.push({ ref: 'depth', enabled: true, constant: true, content: 'Depth lore', position: 4, depth: 1, role: 2 })
  context.chat.tavernScriptPrompts = [{ id: 'stored', role: 'system', content: 'Stored script', position: 'in_chat', depth: 0, once: true }]
  const config = { user_input: 'Current', injects: [
    { role: 'system', content: 'dragon', position: 'none', should_scan: true },
    { role: 'user', content: 'One-call injection', position: 'in_chat', depth: 0 }
  ] }
  const messages = compileHelperGenerate(config, context), texts = messages.map(message => message.content)
  assert.ok(texts.includes('Dragon lore'))
  assert.ok(!texts.includes('dragon'))
  assert.ok(texts.indexOf('Depth lore') < texts.indexOf('Current'))
  assert.equal(messages.find(message => message.content === 'Depth lore').role, 'assistant')
  assert.ok(texts.indexOf('Stored script') > texts.indexOf('Current'))
  assert.ok(texts.indexOf('One-call injection') > texts.indexOf('Stored script'))
  assert.equal(context.chat.tavernScriptPrompts.length, 1, 'one-shot prompts are not consumed by an independent helper task')
  assert.ok(!compileHelperGenerate({ ...config, overrides: { chat_history: { with_depth_entries: false } } }, context).some(message => message.content === 'Depth lore'))
})

test('generate preserves legacy DSH preset phases and resolves Helper variables', () => {
  const context = generationContext()
  context.presetSnapshot = { front: { entries: [{ role: 'system', content: 'Front' }] }, middle: { entries: [{ role: 'assistant', content: 'Middle' }] }, back: { entries: [{ role: 'user', content: 'Back' }] } }
  const messages = compileHelperGenerate({ user_input: '{{get_chat_variable::location}}', max_chat_history: 0 }, context)
  assert.equal(messages[0].content, 'Front')
  assert.equal(messages.at(-1).content, 'Back')
  assert.ok(messages.findIndex(message => message.content === 'Middle') < messages.findIndex(message => message.content === 'forest'))
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
  assert.throws(() => compileHelperGenerate({ user_input: 'hello' }, context), /EJS/)
  assert.ok(compileHelperGenerate({ user_input: 'hello', overrides: { char_description: 'rendered state' } }, context).some(message => message.content === 'rendered state'))
})

test('helper task cancellation aborts the operation and promptly rejects even when a provider ignores abort', async () => {
  const tasks = createHelperGenerationTasks()
  let signal, finish
  const pending = tasks.run('one', 'shared', value => { signal = value; return new Promise(resolve => { finish = resolve }) })
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  await Promise.resolve()
  assert.equal(signal.aborted, false)
  assert.equal(tasks.stop('other', 'shared'), false)
  assert.equal(tasks.stop('one', 'shared'), true)
  assert.equal(signal.aborted, true)
  await rejected
  assert.equal(tasks.stop('one', 'shared'), false)
  assert.equal(await tasks.run('one', 'shared', async () => 'replacement'), 'replacement')
  finish('late result must not win')
})

test('token cancellation handles out-of-order request admission without poisoning reused IDs', async () => {
  let now = 100
  const tasks = createHelperGenerationTasks({ now: () => now, cancellationLifetime: 10, cancellationLimit: 2 })
  assert.equal(tasks.stop('game', 'id'), false)
  assert.equal(await tasks.run('game', 'id', async () => 'untracked stop is harmless', 'first'), 'untracked stop is harmless')
  assert.equal(tasks.stop('game', 'id', { pending: true, generationToken: 'late' }), true)
  await assert.rejects(tasks.run('game', 'id', () => assert.fail('cancelled before body admission'), 'late'), { name: 'AbortError' })
  assert.equal(await tasks.run('game', 'id', async () => 'new incarnation', 'fresh'), 'new incarnation')
  assert.equal(await tasks.run('other', 'id', async () => 'other session', 'late'), 'other session')
  let finish
  const active = tasks.run('game', 'id', () => new Promise(resolve => { finish = resolve }), 'active')
  await Promise.resolve()
  assert.equal(tasks.stop('game', 'id', { generationToken: 'stale' }), false)
  finish('active remains')
  assert.equal(await active, 'active remains')
  assert.deepEqual(tasks.stopAll('game', [{ generationId: 'other', generationToken: 'batch' }]), ['other'])
  await assert.rejects(tasks.run('game', 'other', () => assert.fail(), 'batch'), { name: 'AbortError' })
  tasks.stop('game', 'third', { pending: true, generationToken: 'bounded' })
  assert.equal(await tasks.run('game', 'id', async () => 'oldest intent evicted', 'late'), 'oldest intent evicted')
  now = 111
  assert.equal(await tasks.run('game', 'third', async () => 'expired intent', 'bounded'), 'expired intent')
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
    generateHelper, generateHelperRaw, generateHelperCompletion, helperGenerationHistory, validateHelperGenerateConfig,
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

test('callModel forwards cancellation to model lookup and provider stream and never returns aborted text', async () => {
  const source = pluginSource.slice(pluginSource.indexOf('  async function callModel(opts) {'), pluginSource.indexOf('  // ---------- 角色卡 ----------'))
  const calls = [], controller = new AbortController(), selection = { provider: 'fixture', model: 'model' }
  let abortDuringStream = false
  const llm = { prepareCall: async (config, signal) => { calls.push({ config, signal }); return { config, stream: async function* (options) {
    calls.push(options)
    yield { type: 'text-delta', text: 'answer' }
    if (abortDuringStream) controller.abort(new Error('cancelled provider'))
    yield { type: 'finish', reason: { kind: 'stop' } }
  } } } }
  const callModel = new Function('llm', 'modelSelection', 'backgroundModelSelection', 'backgroundConfigForSession', 'identifyHelperModelMessages', source + ';return callModel')(
    llm, () => selection, () => selection, async () => ({}), identifyHelperModelMessages)
  assert.equal(await callModel({ sessionId: 'story', messages: [], system: '', background: true, signal: controller.signal }), 'answer')
  assert.equal(calls[0].signal, controller.signal)
  assert.equal(calls[1].signal, controller.signal)
  abortDuringStream = true
  await assert.rejects(callModel({ messages: [], signal: controller.signal }), /cancelled provider/)
  const count = calls.length
  await assert.rejects(callModel({ messages: [], signal: controller.signal }), /cancelled provider/)
  assert.equal(calls.length, count, 'already cancelled tasks do not resolve models')
})

test('构筑评议的清空覆盖参数仅发送评议正文，不混入角色或历史', async () => {
  const config = { user_input: '请评议当前构筑', should_stream: true, ordered_prompts: ['user_input'], max_chat_history: 0,
    overrides: { world_info_before: '', persona_description: '', char_description: '', char_personality: '', scenario: '',
      world_info_after: '', dialogue_examples: '', chat_history: { with_depth_entries: false, author_note: '', prompts: [] } } }
  let request
  assert.equal(await generateHelperRaw(config, { history: [{ role: 'assistant', text: '不应进入评议的剧情' }],
    callModel: async value => { request = value; return '评分结果' } }), '评分结果')
  assert.deepEqual(request.messages, [{ role: 'user', content: [{ type: 'text', text: '请评议当前构筑' }] }])
  for (const overrides of [{ persona_description: '需要实现的覆盖内容' }, { chat_history: { with_depth_entries: false, author_note: '作者注释' } },
    { chat_history: { with_depth_entries: false, prompts: [{ role: 'user', content: '不可忽略' }] } }]) {
    await assert.rejects(generateHelperRaw({ ...config, overrides }, { callModel: () => assert.fail('不应静默丢弃覆盖内容') }), /暂不支持覆盖项/)
  }
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

test('generateRaw 只有在没给顺序时才按 generate 处理', () => {
  assert.deepEqual(defaultOrderedRawConfig({ user_input: 'hi', ordered_prompts: [] }), { user_input: 'hi' })
  assert.deepEqual(defaultOrderedRawConfig({ user_input: 'hi' }), { user_input: 'hi' })
  assert.equal(defaultOrderedRawConfig({ ordered_prompts: ['user_input'] }), null)
  assert.equal(defaultOrderedRawConfig({ ordered_prompts: 'user_input' }), null, '错误类型交给 generateRaw 报错')
  assert.equal(defaultOrderedRawConfig(null), null)
})
