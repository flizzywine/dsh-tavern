import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'

import { helperClient, helperHostHarness } from './fixtures/helper-host-harness.mjs'
import { stubFrameDependencyImports } from './fixtures/frame-dependency-imports.mjs'

const plain = value => JSON.parse(JSON.stringify(value))
function messageFrame(state) {
  const listeners = [], sent = [], parent = { postMessage: value => sent.push(value) }
  const scope = { structuredClone, parent, console, addEventListener(name, listener) { if (name === "message") listeners.push(listener) } }
  scope.window = scope
  vm.createContext(scope)
  const html = helperClient.buildTavernFrameDocument({content: '<div>card</div>', token: 'message-token', helperContext: state, turn: 1})
  for (const script of html.matchAll(/<script data-dsh-tavern-(?:helper|interactive-helper|frame-variable-aliases)>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(stubFrameDependencyImports(script[1]), scope)
  }
  return { window: scope, sent, receive(data) { for (const listener of listeners) listener({source: parent, data: {token: 'message-token', ...data}}) } }
}

const messages = [
  {message_id: 0, role: 'assistant', message: 'one', variables: {first: 1}, swipes: ['zero', 'one'], swipe_id: 1, swipes_data: [{old: 1}, {first: 1}]},
  {message_id: 1, role: 'user', message: 'hidden', is_hidden: true, variables: {}},
  {message_id: 2, role: 'assistant', message: 'last', variables: {last: 1}}
]
for (const kind of ['script', 'message']) test(kind + ' getChatMessages supports negative ranges, visibility and upstream data fields', () => {
  const state = {messages, turnMessageIds: {1: 0}, characterName: '角色', playerName: '玩家'}
  const api = (kind === 'script' ? helperHostHarness(state) : messageFrame(state)).window.TavernHelper
  assert.deepEqual(Array.from(api.getChatMessages('-1'), row => row.message_id), [2])
  assert.deepEqual(Array.from(api.getChatMessages('-3--1', {hide_state: 'unhidden'}), row => row.message_id), [0, 2])
  assert.deepEqual(Array.from(api.getChatMessages('0-{{lastMessageId}}', {hide_state: 'hidden'}), row => row.message_id), [1])
  assert.equal(api.getChatMessages('2-0', {role: 'user'})[0].name, '玩家')
  assert.deepEqual(plain(api.getChatMessages('invalid-range')), [])
  const first = api.getChatMessages(0, {include_swipes: true})[0]
  assert.deepEqual(plain(first.data), {first: 1})
  assert.deepEqual(plain(first.extra), {})
  assert.deepEqual(plain(first.swipes_info), [{}, {}])
  first.data.first = 9
  assert.equal(api.getChatMessages(0)[0].data.first, 1)
})

for (const kind of ['script', 'message']) test(kind + ' unsupported variable scopes never fall through to message data', () => {
  const state = {messages: [{message_id: 0, variables: {keep: true}}]}
  const run = kind === 'script' ? helperHostHarness(state) : messageFrame(state), api = run.window.TavernHelper
  for (const type of ['typo']) {
    assert.throws(() => api.getVariables({type}), error => error.code === 'TAVERN_CAPABILITY_UNSUPPORTED')
    assert.throws(() => api.replaceVariables({bad: true}, {type}), error => error.code === 'TAVERN_CAPABILITY_UNSUPPORTED')
  }
  for (const type of ['preset', 'extension']) {
    assert.deepEqual(plain(api.getVariables({type})), {})
    api.replaceVariables({local: type}, {type})
    assert.deepEqual(plain(api.getVariables({type})), {local: type})
  }
  assert.deepEqual(plain(api.getVariables({type: 'message'})), {keep: true})
  assert.equal(run.sent.filter(row => row.type === 'dsh-tavern-helper-call').length, 0)
})

for (const kind of ['script', 'message']) test(kind + ' deleteVariable waits for persistence and returns the upstream result shape', async () => {
  const run = kind === 'script' ? helperHostHarness({chatVariables: {old: 1, keep: 2}}) : messageFrame({messages: [], chatVariables: {old: 1, keep: 2}})
  run.window._ = {unset: (value, key) => delete value[key]}
  const pending = run.window.TavernHelper.deleteVariable('old', {type: 'chat'})
  const call = run.sent.find(row => row.type === 'dsh-tavern-helper-call')
  assert.equal(call.method, 'updateTavernHelperVariables')
  assert.deepEqual(plain(call.args.variables), {keep: 2})
  if (run.reply) run.reply(call, {updated: true})
  else run.receive({type: 'dsh-tavern-helper-response', requestId: call.requestId, ok: true, result: {updated: true}})
  assert.deepEqual(plain(await pending), {variables: {keep: 2}, delete_occurred: true})
})

test('script deleteVariable rejects stale or failed writes instead of reporting a saved deletion', async () => {
  for (const stale of [true, false]) {
    const run = helperHostHarness({chatVariables: {keep: 1}})
    const pending = run.window.deleteVariable('keep', {type: 'chat'})
    run.reply(run.calls()[0], stale ? {updated: false, stale: true} : 'save failed', stale)
    await assert.rejects(pending, stale ? /未保存/ : /save failed/)
    assert.deepEqual(plain(run.window.getVariables({type: 'chat'})), {keep: 1})
  }
})

for (const kind of ['script', 'message']) test(kind + ' installed display/regex/event/global APIs operate on the live frame context', async () => {
  const {marked} = await import('marked')
  const state = {messages, character: {name: '角色'}, characterName: '角色', playerName: '玩家', turnMessageIds: {1: 0}, chatVariables: {gold: 7},
    regexScripts: {character: [{enabled: true, placement: [2], markdownOnly: true, findRegex: '/token/g', replaceString: '**{{char}}** {{getvar::gold}}'}]}}
  const run = kind === 'script' ? helperHostHarness(state) : messageFrame(state), w = run.window
  w.marked = marked
  assert.equal(w.TavernHelper.isCharacterTavernRegexesEnabled(), true)
  assert.equal(w.TavernHelper.formatAsDisplayedMessage('token', {message_id: 0}), '<p><strong>角色</strong> 7</p>\n')
  if (kind === 'message') {
    const nextState = {...state, stateRevision: 2, regexScripts: {character: [{enabled: true, placement: [2], markdownOnly: true, findRegex: '/token/g', replaceString: 'changed'}]}}
    run.receive({type: 'dsh-tavern-helper-context-update', update: helperClient.createTavernHelperContextUpdate(state, nextState, 1, 1)})
    assert.equal(w.formatAsDisplayedMessage('token', {message_id: 0}), '<p>changed</p>\n')
  }

  const wait = w.TavernHelper.waitGlobalInitialized('PluginReady')
  await w.TavernHelper.initializeGlobal('PluginReady', {ready: true})
  assert.equal((await wait).ready, true)
  const next = w.eventWaitOnce('local-ready')
  await w.eventEmitAndWait('local-ready', 1, 'two')
  assert.deepEqual(plain(await next), [1, 'two'])
})

for (const kind of ['script', 'message']) test(kind + ' getChatMessages and substitudeMacros resolve legacy <user>/<char> and sync chatVariables.playerName immediately', async () => {
  const state = {
    messages: [{message_id: 0, role: 'assistant', message: '晚上七点，<user>与妹妹回到了<char>里。', swipes: ['晚上七点，<user>与妹妹回到了<char>里。'], swipe_id: 0, variables: {}}],
    turnMessageIds: {1: 0},
    characterName: '别墅',
    playerName: '你',
    chatVariables: {}
  }
  const run = kind === 'script' ? helperHostHarness(state) : messageFrame(state), api = run.window.TavernHelper
  assert.equal(api.getChatMessages(0)[0].message, '晚上七点，你与妹妹回到了别墅里。')
  assert.equal(api.substitudeMacros('<user> / <char>'), '你 / 别墅')
  const pending = api.updateVariablesWith(current => ({...current, playerName: '沈砚'}), {type: 'chat'})
  assert.equal(api.getChatMessages(0)[0].message, '晚上七点，沈砚与妹妹回到了别墅里。')
  assert.equal(api.substitudeMacros('<user> / {{user}}'), '沈砚 / 沈砚')
  const call = run.sent.find(row => row.type === 'dsh-tavern-helper-call' && row.method === 'updateTavernHelperVariables')
  if (run.reply) run.reply(call, {updated: true})
  else run.receive({type: 'dsh-tavern-helper-response', requestId: call.requestId, ok: true, result: {updated: true}})
  await pending
})
