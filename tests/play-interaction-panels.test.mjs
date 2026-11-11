import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createPlayInteractionFlow } from '../tavern-plugin/lib/domain/play-interaction-flow.js'
import { createSessionSignalTransport } from '../tavern-plugin/lib/domain/session-signal-transport.js'
import { clientControls } from './fixtures/native-controls.mjs'
import { syncClock } from './fixtures/sync-clock.mjs'

const source = await readFile(new URL('../tavern-plugin/src/client/features/play-interaction-panels.js', import.meta.url), 'utf8')
const refreshSource = await readFile(new URL('../tavern-plugin/src/client/modules/session-refresh-controller.js', import.meta.url), 'utf8')
const polishSource = await readFile(new URL('../tavern-plugin/src/client/features/polish-compare.js', import.meta.url), 'utf8')
test('panels use the flow interface and candidate selection preserves user edits', async t => {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true })
  dom.window.matchMedia = () => ({ matches: false })
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => { Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act }); dom.window.close() })
  const { createRoot } = await import('react-dom/client')
  const calls = [], errors = [], playEvents = []
  const signals = createSessionSignalTransport(), invalidated = []
  let pendingPolish, requestId
  dom.window.addEventListener('error', event => errors.push(event.error))
  const interactions = createPlayInteractionFlow({ rpc: async (...args) => { calls.push(args); return { task: {}, view: {} } },
    coordinationView: v => v, coordination: { setView() {}, invalidate() {} }, applyBodyResult() {}, reportError: (...args) => errors.push(args) })
  const context = vm.createContext({ React, ...clientControls(React), setInterval, clearInterval,
    tavernSessionSignals: signals, liveTavernView: { invalidate: id => invalidated.push(id) },
    rpc: async (method, args) => {
      if (method === 'polishBody') {
        requestId = args.requestId
        pendingPolish = Promise.withResolvers()
        return pendingPolish.promise
      }
      if (method === 'polishProgress') return { progress: { edits: [{ reason: '更具体', find: '原句', replace: '改句' }] } }
    }, window: dom.window, document: dom.window.document,
    useCandidatePreferences: () => 'after-send', useTavernSessionMode: () => 'story',
    latestTavernAssistantMessageId: () => 'm', isPlayMode: () => true, TAVERN_MOBILE_QUERY: '(max-width: 1023px)',
    useLiveTavernView: () => ({ view: {} }), tavernPlayEvents: { emit: (...args) => playEvents.push(args) } })
  vm.runInContext(source, context)
  const usePanel = store => () => React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const panels = context.createPlayInteractionPanels({ interactions, useCandidatePanel: usePanel(interactions.candidates),
    useCandidateGuidePanel: usePanel(interactions.guide), useRegenPanel: usePanel(interactions.regeneration),
    usePhonePlay: () => false })
  let draft = '玩家原文'
  let running = false
  const props = { sessionId: 'a', useSession: select => select({ running }), useChat: select => select({}),
    useInput: select => select({ draft }), inputActions: { setDraft: value => { draft = value } } }
  const root = createRoot(dom.window.document.querySelector('main'))
  const render = component => act(async () => root.render(React.createElement(component, props)))
  interactions.candidates.set({ sessionId: 'a', messageId: 'm', phase: 'ready', choices: ['走近'], expanded: true })
  await render(panels.CandidateQuestion)
  await act(async () => dom.window.document.querySelector('.dsh-tavern-question-option').click())
  assert.equal(draft, '玩家原文\n走近')
  draft = '玩家原文\n慢慢走近'
  await render(panels.CandidateQuestion)
  await act(async () => dom.window.document.querySelector('.dsh-tavern-question-option').click())
  assert.equal(draft, '玩家原文\n慢慢走近')
  assert.equal(JSON.stringify(playEvents), JSON.stringify([['choice', 'a', { choiceIndex: 0 }]]), 'picking a choice is a play event; taking it back is not')
  interactions.guide.set({ sessionId: 'a', messageId: 'm', phase: 'input' })
  await render(panels.CandidateGuidePanel)
  await act(async () => dom.window.document.querySelector('.dsh-tavern-regen-submit').click())
  assert.equal(calls[0][0], 'submitTask')
  assert.equal(interactions.guide.getSnapshot(), null)
  interactions.regeneration.set({ sessionId: 'a', messageId: 'm', phase: 'input' })
  await render(panels.RegenPanel)
  assert.equal(dom.window.document.querySelectorAll(".dsh-tavern-regen-submit").length, 1)
  await act(async () => dom.window.document.querySelector('.dsh-tavern-regen-submit').click())
  assert.deepEqual(calls[1], ['regenBody', { guidance: '' }, 'a'])
  // 在途的重新生成面板在宿主报运行中（发送键已换成停止）时还要留着显示进度，
  // 已经能填意见的表单照旧在运行中让位给正文区。
  await act(async () => interactions.regeneration.set({ sessionId: 'a', messageId: 'm', phase: 'loading' }))
  running = true
  await render(panels.RegenPanel)
  assert.match(dom.window.document.querySelector('.dsh-tavern-regen-title').textContent, /重新生成正文/)
  assert.equal(dom.window.document.querySelector('.dsh-tavern-regen-loading'), null, '重新生成时不再挂提示标签')
  assert.equal(dom.window.document.querySelector('.dsh-tavern-question-sub'), null, '面板头不再显示提示小字')
  await act(async () => interactions.regeneration.set({ sessionId: 'a', messageId: 'm', phase: 'input' }))
  await render(panels.RegenPanel)
  assert.equal(dom.window.document.querySelector('.dsh-tavern-regen'), null)
  running = false
  await act(async () => interactions.regeneration.set({ sessionId: 'a', phase: 'input' }))
  await act(async () => [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === '精修').click())
  assert.match(dom.window.document.querySelector('.dsh-tavern-regen-loading').textContent, /已修 1 处/)
  assert.match(dom.window.document.querySelector('summary').textContent, /更具体/)
  assert.equal(dom.window.document.querySelector('del').textContent, '原句')
  assert.equal(dom.window.document.querySelector('ins').textContent, '改句')
  await act(async () => pendingPolish.resolve({ edits: [], view: null }))
  assert.match(dom.window.document.querySelector('.dsh-tavern-choice-error').textContent, /没有发现需要修改/)
  await act(async () => [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === '精修').click())
  await act(async () => pendingPolish.reject(new Error('响应中断')))
  assert.match(dom.window.document.querySelector('.dsh-tavern-choice-error').textContent, /精修未确认完成/)
  await act(async () => signals.publish('a', { kind: 'polish-saved', version: 'another-request' }))
  assert.ok(interactions.regeneration.getSnapshot(), '别的精修完成不会关闭当前表单')
  await act(async () => signals.publish('a', { kind: 'polish-saved', version: requestId }))
  assert.equal(interactions.regeneration.getSnapshot(), null)
  assert.deepEqual(invalidated, ['a'])
  assert.deepEqual(errors, [])
  await act(async () => root.unmount())
})

test('已打开的精修对比收到保存信号后自动刷新，首次读取失败可恢复', async t => {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true })
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.querySelector('main'))
  t.after(async () => {
    await act(async () => root.unmount())
    Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act })
    dom.window.close()
  })
  const signals = createSessionSignalTransport(), clock = syncClock()
  let reads = 0, comparison = null
  const context = vm.createContext({ React, AbortController, window: dom.window, tavernSessionSignals: signals,
    Switch: () => null, TavernDefaultModelSetting: () => null, EmptyState: ({ text }) => text,
    rpc: async (method, _args, _id, options) => {
      if (method !== 'polishComparison') return {}
      assert.ok(options.signal instanceof AbortSignal)
      if (++reads === 2) throw new Error('暂时断网')
      return { comparison }
    }
  })
  vm.runInContext(refreshSource, context)
  const createRefresh = context.createSessionRefreshController
  context.createSessionRefreshController = options => createRefresh({ ...options, ...clock })
  vm.runInContext(polishSource, context)
  await act(async () => root.render(React.createElement(context.PolishComparisonView, { polishSessionId: 'a' })))
  await act(async () => clock.advance(0))
  assert.match(document.querySelector('main').textContent, /还没有可对比的精修/)

  comparison = { turn: 9, count: 1, segments: [], auto: true, at: 5 }
  await act(async () => {
    signals.publish('a', { kind: 'polish-saved', version: 'automatic-save' })
    await clock.advance(0)
  })
  assert.equal(reads, 2)
  await act(async () => clock.advance(500))
  assert.equal(reads, 3)
  assert.match(document.querySelector('main').textContent, /自动精修 · 第 9 轮/)
})
