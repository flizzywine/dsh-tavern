import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createPlayInteractionFlow } from '../tavern-plugin/lib/domain/play-interaction-flow.js'
import { createSessionSignalTransport } from '../tavern-plugin/lib/domain/session-signal-transport.js'
import { clientControls } from './fixtures/native-controls.mjs'
import { syncClock } from './fixtures/sync-clock.mjs'

const require = createRequire(import.meta.url)
const candidateTabs = require('../tavern-plugin/packages/dsh-presentation-protocol/src/candidate-tabs.cjs')
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
  const context = vm.createContext({ React, ...clientControls(React), setInterval, clearInterval, candidateTabs,
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
  // 没填意见的普通重新生成没有要跟踪的进度（按钮上写着「重生成中…」），表单立刻让位；
  // 留着输入框和「生成并替换正文」，看上去就像刚才那一下没被接住。
  assert.equal(dom.window.document.querySelector('.dsh-tavern-regen'), null, '普通重新生成一提交，填意见的表单就让位')
  assert.equal(interactions.regeneration.getSnapshot().phase, 'loading', '面板状态仍在跑，按钮保持「重生成中…」')
  await act(async () => interactions.regeneration.set({ sessionId: 'a', messageId: 'm', phase: 'loading', rewrite: true }))
  await render(panels.RegenPanel)
  assert.match(dom.window.document.querySelector('.dsh-tavern-regen-loading').textContent, /正在按意见改写正文/)
  assert.equal(dom.window.document.querySelector('.dsh-tavern-regen-input'), null, '在跑的改写不再露出表单')
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

test('宿主没有消息 id 时，候选面板仍然显示这一局的候选项', async t => {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true })
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => { Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act }); dom.window.close() })
  const { createRoot } = await import('react-dom/client')
  const signals = createSessionSignalTransport()
  const interactions = createPlayInteractionFlow({ rpc: async () => ({ candidates: null }),
    coordinationView: v => v, coordination: { setView() {}, invalidate() {} }, applyBodyResult() {}, reportError() {} })
  const context = vm.createContext({ React, ...clientControls(React), candidateTabs,
    tavernSessionSignals: signals, liveTavernView: { invalidate() {} }, rpc: async () => ({}),
    window: dom.window, document: dom.window.document,
    useCandidatePreferences: () => 'after-send', useTavernSessionMode: () => 'story',
    latestTavernAssistantMessageId: () => null, isPlayMode: () => true, TAVERN_MOBILE_QUERY: '(max-width: 1023px)',
    useLiveTavernView: () => ({ view: {} }), tavernPlayEvents: { emit() {} } })
  vm.runInContext(source, context)
  const panels = context.createPlayInteractionPanels({ interactions,
    useCandidatePanel: () => React.useSyncExternalStore(interactions.candidates.subscribe, interactions.candidates.getSnapshot, interactions.candidates.getSnapshot),
    useCandidateGuidePanel: () => React.useSyncExternalStore(interactions.guide.subscribe, interactions.guide.getSnapshot, interactions.guide.getSnapshot),
    useRegenPanel: () => null, usePhonePlay: () => false })
  const props = { sessionId: 'a', useSession: select => select({ running: false }),
    useChat: select => select({ legacy: { nodes: [] } }), useInput: select => select({ draft: '' }),
    inputActions: { setDraft() {} } }
  const root = createRoot(dom.window.document.querySelector('main'))
  // 存档里的候选项属于这一局最近一轮；面板记的是页面手里的消息 id，宿主没给就是 null。
  interactions.candidates.set({ sessionId: 'a', messageId: null, phase: 'ready', choices: [{ type: 'action', text: '走近' }] })
  await act(async () => root.render(React.createElement(panels.CandidateQuestion, props)))
  assert.equal(dom.window.document.querySelectorAll('.dsh-tavern-question').length, 1, '宿主没有消息 id 也要显示这一轮的候选项')
  assert.match(dom.window.document.querySelector('.dsh-tavern-question-head').textContent, /接下来的行动/)
  await act(async () => root.unmount())
})

test('多角色与全局候选默认停在 [精选]，焦点角色排前，支持无“我”第三人称及跨 Tab 勾选拼接', async t => {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true })
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => { Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act }); dom.window.close() })
  const { createRoot } = await import('react-dom/client')
  const signals = createSessionSignalTransport()
  const interactions = createPlayInteractionFlow({ rpc: async () => ({ candidates: null }),
    coordinationView: v => v, coordination: { setView() {}, invalidate() {} }, applyBodyResult() {}, reportError() {} })
  let draft = ''
  const context = vm.createContext({ React, ...clientControls(React), candidateTabs,
    tavernSessionSignals: signals, liveTavernView: { invalidate() {} }, rpc: async () => ({}),
    window: dom.window, document: dom.window.document,
    useCandidatePreferences: () => 'after-send', useTavernSessionMode: () => 'story',
    latestTavernAssistantMessageId: () => 'm-1', isPlayMode: () => true, TAVERN_MOBILE_QUERY: '(max-width: 1023px)',
    useLiveTavernView: () => ({ view: {} }), tavernPlayEvents: { emit() {} } })
  vm.runInContext(source, context)
  const panels = context.createPlayInteractionPanels({ interactions,
    useCandidatePanel: () => React.useSyncExternalStore(interactions.candidates.subscribe, interactions.candidates.getSnapshot, interactions.candidates.getSnapshot),
    useCandidateGuidePanel: () => React.useSyncExternalStore(interactions.guide.subscribe, interactions.guide.getSnapshot, interactions.guide.getSnapshot),
    useRegenPanel: () => null, usePhonePlay: () => false })
  const makeProps = () => ({ sessionId: 'a', useSession: select => select({ running: false }),
    useChat: select => select({ legacy: { nodes: [] } }), useInput: select => select({ draft }),
    inputActions: { setDraft(next) { draft = next } } })
  const root = createRoot(dom.window.document.querySelector('main'))

  // 第三人称群像（无“我”）：苏晚(焦点, 3条) + 陆沉(3条) + 全局(突发事件 + 场景变化)
  const choices = [
    { type: 'action', actor: '苏晚', text: '苏晚突然拉开门审视门外' },
    { type: 'action', actor: '苏晚', text: '苏晚故意放轻脚步走向窗边' },
    { type: 'action', actor: '苏晚', text: '苏晚开口唤了一声门外的人' },
    { type: 'action', actor: '陆沉', text: '陆沉推门而入坦然应对' },
    { type: 'action', actor: '陆沉', text: '陆沉退回走廊暗处观察' },
    { type: 'action', actor: '陆沉', text: '陆沉敲响门框递上手中信件' },
    { type: 'event', text: '走廊尽头突然传来急促脚步声' },
    { type: 'scene', text: '转入次日清晨的议事厅' }
  ]
  interactions.candidates.set({ sessionId: 'a', messageId: 'm-1', phase: 'ready', expanded: true, choices })
  await act(async () => root.render(React.createElement(panels.CandidateQuestion, makeProps())))

  const tabs = [...dom.window.document.querySelectorAll('.dsh-tavern-question-tab')]
  assert.deepEqual(tabs.map(el => el.querySelector('.dsh-tavern-question-tab-label').textContent), ['精选', '苏晚', '陆沉', '全局'])
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true', '首屏默认停在 [精选]')

  // [精选] 包含各角色代表项 + 全局事件与场景，且带角色/事件/场景标签
  const featuredOptions = [...dom.window.document.querySelectorAll('.dsh-tavern-question-option')]
  assert.equal(featuredOptions.length, 6)
  assert.equal(featuredOptions[0].querySelector('.dsh-tavern-question-tag-actor').textContent, '苏晚')
  assert.equal(featuredOptions[4].querySelector('.dsh-tavern-question-tag-event').textContent, '突发事件')
  assert.equal(featuredOptions[5].querySelector('.dsh-tavern-question-tag-scene').textContent, '场景变化')

  // 切到 [苏晚] Tab 点选第 1 条，再切到 [全局] Tab 点选突发事件，草稿按行拼接且 [苏晚] Tab 显示 ✓1
  await act(async () => tabs[1].click())
  const suwanOptions = [...dom.window.document.querySelectorAll('.dsh-tavern-question-option')]
  assert.equal(suwanOptions.length, 3)
  assert.equal(suwanOptions[0].querySelector('.dsh-tavern-question-tag'), null, '单角色 Tab 内不重复显示角色名标签')
  await act(async () => suwanOptions[0].click())
  await act(async () => root.render(React.createElement(panels.CandidateQuestion, makeProps())))

  const updatedTabs = [...dom.window.document.querySelectorAll('.dsh-tavern-question-tab')]
  assert.equal(updatedTabs[1].querySelector('.dsh-tavern-question-tab-count').textContent, '✓1')
  await act(async () => updatedTabs[3].click())
  const globalOptions = [...dom.window.document.querySelectorAll('.dsh-tavern-question-option')]
  assert.equal(globalOptions.length, 2)
  await act(async () => globalOptions[0].click())
  assert.equal(draft, '苏晚突然拉开门审视门外\n【突发事件】走廊尽头突然传来急促脚步声')

  await act(async () => root.unmount())
})

test('AI 融合精选条目独占 [精选] Tab，渲染多角色/事件/场景徽章并在选中时显示 ✓ 计数与场景前缀', async t => {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true })
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => { Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act }); dom.window.close() })
  const { createRoot } = await import('react-dom/client')
  const signals = createSessionSignalTransport()
  const interactions = createPlayInteractionFlow({ rpc: async () => ({ candidates: null }),
    coordinationView: v => v, coordination: { setView() {}, invalidate() {} }, applyBodyResult() {}, reportError() {} })
  let draft = ''
  const context = vm.createContext({ React, ...clientControls(React), candidateTabs,
    tavernSessionSignals: signals, liveTavernView: { invalidate() {} }, rpc: async () => ({}),
    window: dom.window, document: dom.window.document,
    useCandidatePreferences: () => 'after-send', useTavernSessionMode: () => 'story',
    latestTavernAssistantMessageId: () => 'm-featured', isPlayMode: () => true, TAVERN_MOBILE_QUERY: '(max-width: 1023px)',
    useLiveTavernView: () => ({ view: {} }), tavernPlayEvents: { emit() {} } })
  vm.runInContext(source, context)
  const panels = context.createPlayInteractionPanels({ interactions,
    useCandidatePanel: () => React.useSyncExternalStore(interactions.candidates.subscribe, interactions.candidates.getSnapshot, interactions.candidates.getSnapshot),
    useCandidateGuidePanel: () => React.useSyncExternalStore(interactions.guide.subscribe, interactions.guide.getSnapshot, interactions.guide.getSnapshot),
    useRegenPanel: () => null, usePhonePlay: () => false })
  const makeProps = () => ({ sessionId: 'a', useSession: select => select({ running: false }),
    useChat: select => select({ legacy: { nodes: [] } }), useInput: select => select({ draft }),
    inputActions: { setDraft(next) { draft = next } } })
  const root = createRoot(dom.window.document.querySelector('main'))

  const choices = [
    { type: 'action', actor: '苏晚', text: '苏晚突然拉开门审视门外' },
    { type: 'action', actor: '苏晚', text: '苏晚故意放轻脚步走向窗边' },
    { type: 'action', actor: '陆沉', text: '陆沉推门而入坦然应对' },
    { type: 'action', actor: '陆沉', text: '陆沉退回走廊暗处观察' },
    { type: 'event', text: '走廊尽头突然传来急促脚步声' },
    { type: 'scene', text: '转入次日清晨的议事厅' },
    { type: 'featured', actors: ['苏晚', '陆沉'], text: '苏晚借审视门外顺势拉开门闩，陆沉趁隙推门而入交换眼色' },
    { type: 'featured', actors: ['苏晚'], hasEvent: true, hasScene: true, text: '走廊脚步声逼近之际，苏晚吹熄灯火退往暗门，众人直至次日清晨才在议事厅重新碰头' }
  ]
  interactions.candidates.set({ sessionId: 'a', messageId: 'm-featured', phase: 'ready', expanded: true, choices })
  await act(async () => root.render(React.createElement(panels.CandidateQuestion, makeProps())))

  const tabs = [...dom.window.document.querySelectorAll('.dsh-tavern-question-tab')]
  assert.deepEqual(tabs.map(el => el.querySelector('.dsh-tavern-question-tab-label').textContent), ['精选', '苏晚', '陆沉', '全局'])
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true')

  const featuredOptions = [...dom.window.document.querySelectorAll('.dsh-tavern-question-option')]
  assert.equal(featuredOptions.length, 2, '提供 AI 融合精选时 [精选] 只展示组合条目，不再机械轮询抽取')
  assert.deepEqual(
    [...featuredOptions[0].querySelectorAll('.dsh-tavern-question-tags .dsh-tavern-question-tag')].map(el => el.textContent),
    ['苏晚', '陆沉']
  )
  assert.deepEqual(
    [...featuredOptions[1].querySelectorAll('.dsh-tavern-question-tags .dsh-tavern-question-tag')].map(el => el.textContent),
    ['苏晚', '突发事件', '场景变化']
  )
  assert.equal(featuredOptions[1].querySelector('.dsh-tavern-question-tag-event').textContent, '突发事件')
  assert.equal(featuredOptions[1].querySelector('.dsh-tavern-question-tag-scene').textContent, '场景变化')

  await act(async () => featuredOptions[1].click())
  await act(async () => root.render(React.createElement(panels.CandidateQuestion, makeProps())))
  assert.equal(draft, '【场景变化】走廊脚步声逼近之际，苏晚吹熄灯火退往暗门，众人直至次日清晨才在议事厅重新碰头')
  assert.equal(dom.window.document.querySelectorAll('.dsh-tavern-question-tab')[0].querySelector('.dsh-tavern-question-tab-count').textContent, '✓1')

  await act(async () => root.unmount())
})

