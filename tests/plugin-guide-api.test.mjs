import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function createTavernUiExtensions()')
const factory = source.slice(start, source.indexOf('const tavernUiExtensions = createTavernUiExtensions()', start))

function load(extra = {}) {
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    tavernPluginBoundary: () => 'Boundary',
    tavernPluginAllowed: () => true,
    tavernErrorHub: { report() {} },
    ...extra
  }
  return vm.runInNewContext(factory + '; createTavernUiExtensions()', context)
}

function plugin(ui, name = 'pet-guide') {
  const instance = { ctx: { fiber: { name } } }
  Object.setPrototypeOf(instance, ui.service)
  return instance
}

test('watchReply：先给当前状态，随后每次变化回调一次，内容不变不回调，卸载后停止', () => {
  const ui = load()
  const seen = []
  const dispose = plugin(ui).watchReply('s1', state => seen.push(state))
  assert.equal(seen.length, 1)
  assert.equal(JSON.stringify(seen[0]), JSON.stringify({
    sessionId: 's1', mode: '', turn: 0, text: '', streaming: false, busy: false, tool: null,
    cardSave: null, cardSaved: null, changed: false
  }))

  ui.publishReply({ sessionId: 's1', mode: 'card', turn: 3, text: '已定：A', streaming: true, busy: true, tool: 'tavern_update_card' })
  assert.equal(seen.length, 2)
  assert.equal(seen[1].text, '已定：A')
  assert.equal(seen[1].streaming, true)
  assert.equal(seen[1].tool, 'tavern_update_card')

  // Same content: no second callback.
  ui.publishReply({ sessionId: 's1', mode: 'card', turn: 3, text: '已定：A', streaming: true, busy: true, tool: 'tavern_update_card' })
  assert.equal(seen.length, 2)

  ui.publishReply({ sessionId: 's1', mode: 'card', turn: 3, text: '已定：A', streaming: false, busy: false })
  assert.equal(seen.length, 3)
  assert.equal(seen[2].tool, null, '工具名结束后清空')

  dispose()
  ui.publishReply({ sessionId: 's1', mode: 'card', turn: 4, text: '下一轮' })
  assert.equal(seen.length, 3)
  assert.equal(ui.replySnapshot('s1').text, '下一轮', '状态仍然保留，供后来者立即读取')
})

test('watchReply：本轮落盘的新卡才出现在 cardSaved，改卡则 changed 为 true', () => {
  const ui = load()
  let state = null
  plugin(ui).watchReply('s1', next => { state = next })
  const save = { turn: 5, path: 'cards/纯主笔.json', createsCard: true, changed: true }
  ui.publishReply({ sessionId: 's1', mode: 'card', turn: 5, text: '建好了。', cardSave: save })
  assert.equal(state.cardSaved, 'cards/纯主笔.json')
  assert.equal(state.changed, true)
  assert.equal(JSON.stringify(state.cardSave), JSON.stringify(save))

  ui.publishReply({ sessionId: 's1', mode: 'card', turn: 6, text: '**第 1 题：还要改什么？**', cardSave: save })
  assert.equal(state.cardSaved, null, '上一轮保存的卡不会算到这一轮')
  assert.equal(state.changed, false)

  ui.publishReply({ sessionId: 's1', mode: 'card', turn: 7, text: '改好了。', cardSave: { turn: 7, path: 'cards/纯主笔.json', createsCard: false, changed: true } })
  assert.equal(state.changed, true)
  assert.equal(state.cardSaved, null)
})

test('registerReplyPresenter：按注册顺序取第一个给出 fold 的；模式不符、返回 null、空白摘要继续往后找', () => {
  const ui = load()
  const card = plugin(ui, 'pet')
  const other = plugin(ui, 'other')
  const calls = []
  card.registerReplyPresenter({ id: 'card', modes: ['card'], present: message => { calls.push('card:' + message.text); return null } })
  other.registerReplyPresenter({ id: 'blank', modes: ['card'], present: () => ({ fold: { summary: '   ' } }) })
  other.registerReplyPresenter({ id: 'story', modes: ['story'], present: () => ({ fold: { summary: '不该出现' } }) })
  other.registerReplyPresenter({ id: 'fold', modes: ['card'], present: message => ({ fold: { summary: '  第 2 题：核心定位是什么？ \n ' } }) })

  const found = ui.presentReply({ sessionId: 's1', mode: 'card', turn: 3, text: '问题', changed: false, streaming: false })
  assert.equal(found.owner, 'other')
  assert.equal(found.fold.summary, '第 2 题：核心定位是什么？')
  assert.deepEqual(calls, ['card:问题'])
  assert.equal(ui.presentReply({ sessionId: 's1', mode: 'story', turn: 3, text: '问题' }).fold.summary, '不该出现')
  assert.equal(ui.presentReply({ sessionId: 's1', mode: 'script', turn: 3, text: '问题' }), null)

  assert.throws(() => card.registerReplyPresenter({ id: 'card', modes: ['card'], present() {} }), /已注册/)
  assert.throws(() => card.registerReplyPresenter({ id: 'Bad Id', modes: ['card'], present() {} }), /id/)
  assert.throws(() => card.registerReplyPresenter({ id: 'nope', modes: [], present() {} }), /modes/)
  assert.throws(() => card.registerReplyPresenter({ id: 'nope', modes: ['CARD'], present() {} }), /modes/)
})

test('registerComposerSlot：先注册者优先，卸载后让位；id 与 modes 有校验', () => {
  const ui = load()
  const first = plugin(ui, 'first')
  const second = plugin(ui, 'second')
  const firstSlot = first.registerComposerSlot({ id: 'dock', modes: ['card'], render: () => 'first' })
  assert.equal(ui.composerSlotFor('card').owner, 'first')
  assert.equal(ui.composerSlotFor('story'), null)
  second.registerComposerSlot({ id: 'dock', modes: ['card'], render: () => 'second' })
  assert.equal(ui.composerSlotFor('card').owner, 'first', '同一模式取最先注册的')
  firstSlot()
  assert.equal(ui.composerSlotFor('card').owner, 'second')
  assert.throws(() => second.registerComposerSlot({ id: 'dock', modes: ['card'], render() {} }), /已注册/)
  assert.throws(() => second.registerComposerSlot({ id: 'Bad', modes: ['card'], render() {} }), /id/)
  assert.throws(() => second.registerComposerSlot({ id: 'x', modes: ['card'], render: 1 }), /render/)
})

test('tavernReplyState：流式取 partial，结束后取最后一条终稿，工具名与轮次跟着走', () => {
  const start = source.indexOf('function tavernReplyText(blocks)')
  const end = source.indexOf('// Always mounted with the composer', start)
  const state = vm.runInNewContext(source.slice(start, end) + '; tavernReplyState', {})
  const nodes = [
    { kind: 'user', turn: 2, messageId: 'u2' },
    { kind: 'assistant', turn: 2, messageId: 'a2', blocks: [{ kind: 'text', text: '上一轮回复' }] }
  ]
  const streaming = state({
    sessionId: 's1',
    partial: { turn: 3, step: 1, blocks: [{ kind: 'text', text: '已定：' }, { kind: 'tool-call', callId: 'c1', name: 'tavern_update_card' }] },
    nodes,
    runningCalls: [{ name: 'tavern_update_card', callId: 'c1' }],
    running: true,
    view: { mode: 'card', cardSave: { turn: 3, path: 'cards/a.json', createsCard: true, changed: true } }
  })
  assert.equal(streaming.mode, 'card')
  assert.equal(streaming.turn, 3)
  assert.equal(streaming.text, '已定：')
  assert.equal(streaming.streaming, true)
  assert.equal(streaming.busy, true)
  assert.equal(streaming.tool, 'tavern_update_card')
  assert.equal(JSON.stringify(streaming.cardSave), JSON.stringify({ turn: 3, path: 'cards/a.json', createsCard: true, changed: true }))

  const settled = state({ sessionId: 's1', partial: null, nodes, runningCalls: [], running: false, view: { mode: 'card', cardSave: null } })
  assert.equal(settled.turn, 2)
  assert.equal(settled.text, '上一轮回复')
  assert.equal(settled.streaming, false)
  assert.equal(settled.busy, false)
  assert.equal(settled.tool, null)
  assert.equal(settled.cardSave, null)
})
