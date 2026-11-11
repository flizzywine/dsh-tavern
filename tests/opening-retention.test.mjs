import test from 'node:test'
import assert from 'node:assert/strict'
import vm from './fixtures/client-vm.mjs'
import { sourceFunction } from './fixtures/source-function.mjs'
import { readFileSync } from 'node:fs'

const sidebar = readFileSync(new URL('../tavern-plugin/src/client/features/sidebar.js', import.meta.url), 'utf8')
const cardList = readFileSync(new URL('../tavern-plugin/src/client/features/card-list.js', import.meta.url), 'utf8')
function fixture() {
  const draft = { card: { path: 'fixture.json' }, preparationId: 'draft', index: 2, userName: '玩家', requestMode: 'dsh' }
  const state = { openingPicker: draft, picking: true, uiMode: 'play', requestMode: 'dsh' }
  const ctx = vm.createContext({ ...state, busy: false, compatibilityAvailable: true,
    playPrewarmRef: { current: { cancel() {} } }, cardBatch: { reset() {} },
    tavernErrorHub: { clear() {}, report() {}, resolve() {} }, setCards() {}, setMenuSession() {}, setShowArchived() {}, setCardEntry() {}, setError() {}, setChatImport() {}, setBusy() {},
    setOpeningPicker(value) { ctx.openingPicker = state.openingPicker = value },
    setPicking(value) { ctx.picking = state.picking = value },
    setUiMode(value) { ctx.uiMode = state.uiMode = value },
    setRequestMode(value) { ctx.requestMode = state.requestMode = value },
    call: async () => ({}), unarchivedHistory: [], groupOfMode: v => v, isPlayMode: v => v !== 'card',
    props: { sessions: { clear() {} } }, window: { localStorage: { setItem() {} } },
    openSessionWhenReady: async () => {}, askConfirm: async () => false,
  })
  for (const name of ['openPicker', 'switchMode']) vm.runInContext(sourceFunction(sidebar, name), ctx)
  return { ctx, state, draft }
}

for (const targetMode of ['card', 'story']) test(`完成 ${targetMode} 创建时只释放已经开局的准备页`, async () => {
  const { ctx, state, draft } = fixture()
  const calls = []
  Object.assign(ctx, { setPendingOpen() {}, publishSessionMode() {}, CustomEvent: class {},
    call: async (method, args) => calls.push([method, args.id]) })
  ctx.window.dispatchEvent = () => {}
  vm.runInContext(sourceFunction(sidebar, 'finishPendingOpen'), ctx)
  await ctx.finishPendingOpen({ sessionId: 'created', targetMode })
  assert.equal(state.openingPicker, targetMode === 'card' ? draft : null)
  assert.deepEqual(calls, targetMode === 'card' ? [] : [['releaseOpeningPreparation', 'draft']])
})

test('会话打开后立即挂载，最近打开排序在后台写入并刷新', async () => {
  const calls = []
  let releaseMark
  const ctx = vm.createContext({
    window: { setTimeout() {} },
    sessionListRecoveryRef: { current: { open: async id => { calls.push(['open', id]) } } },
    call: async method => { calls.push([method]); await new Promise(resolve => { releaseMark = resolve }) },
    refresh: async groups => { calls.push(['refresh', groups]) },
    setError() {},
  })
  vm.runInContext(sourceFunction(sidebar, 'openSessionWhenReady'), ctx)
  await ctx.openSessionWhenReady('session-fast')
  assert.deepEqual(calls, [['open', 'session-fast'], ['markConversationOpened']])
  releaseMark()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.at(-1)[0], 'refresh')
  assert.equal(calls.at(-1)[1][0], 'sessions')
})

test('切换游玩 / 卡片时回到该模式下最近用过的对话，而不是最新创建的（#220）', async () => {
  const { ctx } = fixture()
  const opened = []
  vm.runInContext(sourceFunction(cardList, 'tavernHistoryActivity'), ctx)
  Object.assign(ctx, {
    summaries: { 'card-old': { updatedAt: 500 } }, groupOfMode: mode => mode === 'card' ? 'card' : 'play',
    openSessionWhenReady: async sessionId => { opened.push(sessionId) },
    unarchivedHistory: [
      { sessionId: 'card-new', mode: 'card', createdAt: 300, updatedAt: 300, lastOpenedAt: 300 },
      { sessionId: 'card-old', mode: 'card', createdAt: 100, updatedAt: 100, lastOpenedAt: 100 },
      { sessionId: 'play-new', mode: 'story', requestMode: 'dsh', createdAt: 300, updatedAt: 300, lastOpenedAt: 300 },
      { sessionId: 'play-old', mode: 'story', requestMode: 'dsh', createdAt: 100, updatedAt: 100, lastOpenedAt: 900 },
    ],
  })
  await ctx.switchMode('card')
  await ctx.switchMode('play')
  assert.deepEqual(opened, ['card-old', 'play-old'])
})
