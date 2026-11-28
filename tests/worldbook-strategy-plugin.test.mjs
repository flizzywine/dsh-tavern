import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'
import { installWorldbookHost } from '../tavern-plugin/lib/host/worldbook.js'

function setup(select, { origin = 'global', prepareWorldbook, enabled = true, ...options } = {}) {
  const worldBook = { view: { entries: [
    { ref: 'built-in', title: '钟楼', content: '钟楼每天六点鸣钟。', enabled: true, primaryKeys: ['钟楼'] },
    { ref: 'plugin-first', title: '秘密通道', content: '地道入口藏在壁炉里。', enabled: true, primaryKeys: ['壁炉'] },
    { ref: 'plugin-second', title: '通行证', content: '通行证是一张金色卡片。', enabled: true },
    { ref: 'off', title: '停用资料', content: '停用内容', enabled: false },
    { ref: 'fixed', title: '夜色', content: '这里永远都是夜晚。', constant: true },
    { ref: 'tail', title: '钟声', content: '夜间禁止敲钟。', channel: 'tail' },
    { ref: 'mvu', title: '[mvu_update] 变量', content: '变量更新规则', constant: true }
  ] } }
  const ctx = { fiber: { name: 'test/plugin@one' }, effect: register => register(), get() {}, on() {} }
  const host = installWorldbookHost(ctx, {
    directory: tmpdir(),
    worldBooks: { bound: async () => worldBook }, getAgent: () => null, projectCapabilities: (_chat, book) => book,
    templates: {
      runtime: async () => ({ render: async text => ({ ok: true, text, scopes: {} }), prepareWorldbook }),
      globalVariables: async () => ({})
    },
    poolEntries: input => api.worldbookPoolEntries(input), pluginScanTexts: input => api.worldbookScanTexts(input)
  })
  const runningUserPlugins = new Map([['test/plugin@one', { runtimeName: 'test/plugin@one', origin }]])
  const api = createTavernPluginApi({ ctx, registerWorldbookStrategy: host.registerStrategy, runningUserPlugins,
    resolveGame: async sessionId => ({ sessionId }),
    logger: { warn() {} }, ...options })
  const dispose = api.service.worldbookStrategy({ name: 'choose', label: 'Choose', enabled, select })
  const chat = { sessionId: 'game-1', tavernScriptPrompts: [{ content: '脚本扫描文本' }], messages: [
    { role: 'assistant', turn: 1, text: '开场菜单', greeting: true },
    { role: 'user', text: '往门里看看。' },
    { role: 'assistant', turn: 2, text: '你发现了壁炉。' },
    { role: 'user', placeholder: true, text: '你走到钟楼。' }
  ] }
  return { host, worldBook, dispose, chat, input: { chat, turn: 3, card: {}, userText: '你走到钟楼。', requestKey: 'request-3' } }
}

test('插件替换静态条目的匹配和排序，宿主保留固定通道、提供独立的可见条目及近期对话', async () => {
  const h = setup(({ gameId, purpose, entries, history, scanText, userText }) => {
    assert.equal(gameId, 'game-1')
    assert.equal(purpose, 'generation')
    assert.equal(userText, '你走到钟楼。')
    assert.deepEqual(history.map(row => row.text), ['往门里看看。', '你发现了壁炉。'])
    assert.equal(scanText, '脚本扫描文本')
    assert.deepEqual(entries.map(row => row.ref), ['built-in', 'plugin-first', 'plugin-second'])
    entries[1].content = '插件试图改写原文'
    return ['plugin-second', 'plugin-first', 'plugin-second']
  })
  const result = await h.host.projectForeground(h.input)
  assert.match(result.log.strategy, /^plugin-.+-choose$/)
  assert.deepEqual(result.log.entries.filter(row => row.reason === 'plugin-strategy').map(row => row.ref), ['plugin-second', 'plugin-first'])
  assert.match(result.automaticContext, /通行证[\s\S]*秘密通道/)
  assert.match(result.automaticContext, /地道入口藏在壁炉里/)
  assert.doesNotMatch(result.context, /插件试图改写原文|钟楼每天六点/)
  assert.equal(result.staticPrefix, '这里永远都是夜晚。')
  assert.match(result.context, /夜间禁止敲钟/)
})

test('空列表跳过自动注入，非法 ID 或选择异常恢复内置排序', async () => {
  const selects = [() => [], () => ['off'], () => ['fixed'], () => { throw new Error('plugin failed') }]
  for (const [index, select] of selects.entries()) {
    const h = setup(select)
    const result = await h.host.projectForeground(h.input)
    if (index === 0) assert.match(result.log.strategy, /^plugin-.+-choose$/)
    else assert.equal(result.log.strategy, 'native-skills')
    assert.equal(result.automaticContext.includes('钟楼每天六点鸣钟。'), index > 0)
  }
})

test('插件收到预处理后的可见条目，脚本隐藏的资料不会传入回调', async () => {
  const h = setup(({ entries }) => {
    assert.deepEqual(entries.map(entry => entry.ref), ['built-in', 'plugin-second'])
    return ['plugin-second']
  }, { prepareWorldbook: async entries => ({
    entries: entries.filter(entry => entry.uid !== 'plugin-first'), scopes: {}
  }) })
  h.worldBook.view.entries.push({ ref: 'script', title: '[GENERATE:BEFORE]', content: '@@generate\n<% run() %>', enabled: false })
  const result = await h.host.projectForeground(h.input)
  assert.match(result.log.strategy, /^plugin-.+-choose$/)
  assert.match(result.automaticContext, /通行证是一张金色卡片/)
})

test('插件排序仍受预算、5 条上限和跨策略冷却约束', async () => {
  let asked = []
  let pluginEnabled = true
  const h = setup(({ entries }) => {
    asked = entries.filter(entry => entry.coolingDown).map(entry => entry.ref)
    return ['large', ...Array.from({ length: 6 }, (_, i) => 'short-' + i)]
  }, { enabled: async ({ gameId }) => pluginEnabled && gameId === 'game-1' })
  h.worldBook.view.raw = { token_budget: 110 }
  h.worldBook.view.entries.push({ ref: 'large', title: '长文', content: '太长了。'.repeat(100) },
    ...Array.from({ length: 6 }, (_, i) => ({ ref: 'short-' + i, title: '短文 ' + i, content: '简短内容。', primaryKeys: ['钟楼'] })))
  const first = await h.host.projectForeground(h.input)
  const refs = first.log.entries.filter(row => row.reason === 'plugin-strategy').map(row => row.ref)
  assert.deepEqual(refs, ['short-0', 'short-1', 'short-2', 'short-3', 'short-4'])
  h.chat.worldBookVirtualState = first.virtualState
  h.chat.messages.push({ role: 'assistant', turn: 3, text: '向前走。' })
  const next = await h.host.projectForeground({ ...h.input, turn: 4, requestKey: 'request-4' })
  assert.deepEqual(asked, refs)
  assert.deepEqual(next.log.entries.filter(row => row.reason === 'plugin-strategy').map(row => row.ref), ['short-5'])
  pluginEnabled = false
  const native = await h.host.projectForeground({ ...h.input, turn: 4, requestKey: 'request-4' })
  assert.ok(refs.every(ref => !native.refs.includes(ref)))
  assert.ok(native.refs.includes('short-5'))
})

test('card-scoped plugin cannot inspect another game and unload revokes pending callback', async () => {
  let called = false
  const scoped = setup(() => { called = true; return [] }, {
    enabled: () => { called = true; return true },
    origin: 'card', cardScope: async () => new Map([['test/plugin@one', { cards: ['/cards/own.json'] }]]), cardPathOf: async () => '/cards/other.json'
  })
  assert.equal((await scoped.host.projectForeground(scoped.input)).log.strategy, 'native-skills')
  assert.equal(called, false)
  let release, started
  const pending = new Promise(resolve => { started = resolve })
  const h = setup(() => { started(); return new Promise(resolve => { release = resolve }) })
  const result = h.host.projectForeground(h.input)
  await pending; h.dispose(); release(['plugin-first'])
  assert.equal((await result).log.strategy, 'native-skills')
})

test('历史导入和前缀恢复不调用在线召回策略，继续提供常驻条目', async () => {
  let calls = 0
  const h = setup(() => { calls++; return [] }, { enabled: () => { calls++; return true } })
  const prefix = await h.host.projectPrefix(h.chat, h.input.card)
  assert.equal(prefix.prefixContext, '这里永远都是夜晚。')
  const history = await h.host.projectForeground({ ...h.input, purpose: 'history-import', worldBook: h.worldBook })
  assert.equal(history.staticPrefix, prefix.prefixContext)
  assert.equal(history.automaticContext, '')
  assert.equal(calls, 0)
})
