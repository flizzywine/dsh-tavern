import test from 'node:test'
import assert from 'node:assert/strict'
import vm from './fixtures/client-vm.mjs'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
function fixture() {
  const draft = { card: { path: 'fixture.json' }, preparationId: 'draft', index: 2, userName: '玩家', requestMode: 'dsh' }
  const state = { openingPicker: draft, picking: true, uiMode: 'play', requestMode: 'dsh' }
  const ctx = vm.createContext({ ...state, busy: false, compatibilityAvailable: true,
    playPrewarmRef: { current: { cancel() {} } }, cardBatch: { reset() {} },
    tavernErrorHub: { clear() {}, report() {}, resolve() {} }, setCards() {}, setMenuSession() {}, setCardEntry() {}, setError() {}, setChatImport() {}, setBusy() {},
    setOpeningPicker(value) { ctx.openingPicker = state.openingPicker = value },
    setPicking(value) { ctx.picking = state.picking = value },
    setUiMode(value) { ctx.uiMode = state.uiMode = value },
    setRequestMode(value) { ctx.requestMode = state.requestMode = value },
    call: async () => ({}), history: [], groupOfMode: v => v, isPlayMode: v => v !== 'card',
    props: { sessions: { clear() {} } }, window: { localStorage: { setItem() {} } },
    openSessionWhenReady: async () => {}, askConfirm: async () => false,
  })
  vm.runInContext(source.slice(source.indexOf('function openPicker()'), source.indexOf('async function loadInitialResources')), ctx)
  vm.runInContext(source.slice(source.indexOf('async function switchMode(nextMode)'), source.indexOf('async function renameConversation')), ctx)
  return { ctx, state, draft }
}

for (const targetMode of ['card', 'story']) test(`完成 ${targetMode} 创建时只释放已经开局的准备页`, async () => {
  const { ctx, state, draft } = fixture()
  const calls = []
  Object.assign(ctx, { setPendingOpen() {}, publishSessionMode() {}, CustomEvent: class {},
    call: async (method, args) => calls.push([method, args.id]) })
  ctx.window.dispatchEvent = () => {}
  vm.runInContext(source.slice(source.indexOf('async function finishPendingOpen(pending)'), source.indexOf('const conversationLifecycle =', source.indexOf('async function finishPendingOpen(pending)'))), ctx)
  await ctx.finishPendingOpen({ sessionId: 'created', targetMode })
  assert.equal(state.openingPicker, targetMode === 'card' ? draft : null)
  assert.deepEqual(calls, targetMode === 'card' ? [] : [['releaseOpeningPreparation', 'draft']])
})

test('切换游玩 / 卡片时回到该模式下最近用过的对话，而不是最新创建的（#220）', async () => {
  const { ctx } = fixture()
  const opened = []
  vm.runInContext(source.slice(source.indexOf('function tavernHistoryActivity('), source.indexOf('function groupTavernHistory(')), ctx)
  Object.assign(ctx, {
    summaries: { 'card-old': { updatedAt: 500 } }, groupOfMode: mode => mode === 'card' ? 'card' : 'play',
    openSessionWhenReady: async sessionId => { opened.push(sessionId) },
    history: [
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
