import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createPlayInteractionFlow } from '../tavern-plugin/lib/domain/play-interaction-flow.js'
import { clientControls } from './fixtures/native-controls.mjs'

const source = await readFile(new URL('../tavern-plugin/src/client/features/play-interaction-panels.js', import.meta.url), 'utf8')
test('panels use the flow interface and candidate selection preserves user edits', async t => {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true })
  dom.window.matchMedia = () => ({ matches: false })
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => { Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act }); dom.window.close() })
  const { createRoot } = await import('react-dom/client')
  const calls = [], errors = []
  let finishPolish
  dom.window.addEventListener('error', event => errors.push(event.error))
  const interactions = createPlayInteractionFlow({ rpc: async (...args) => { calls.push(args); return { task: {}, view: {} } },
    coordinationView: v => v, coordination: { setView() {}, invalidate() {} }, applyBodyResult() {}, reportError: (...args) => errors.push(args) })
  const context = vm.createContext({ React, ...clientControls(React), setInterval, clearInterval,
    rpc: async method => {
      if (method === 'polishBody') return new Promise(resolve => { finishPolish = resolve })
      if (method === 'polishProgress') return { progress: { edits: [{ reason: '更具体', find: '原句', replace: '改句' }] } }
    }, window: dom.window, document: dom.window.document,
    useCandidatePreferences: () => 'after-send', useTavernSessionMode: () => 'story',
    latestTavernAssistantMessageId: () => 'm', isPlayMode: () => true, TAVERN_MOBILE_QUERY: '(max-width: 1023px)',
    useLiveTavernView: () => ({ view: {} }) })
  vm.runInContext(source, context)
  const usePanel = store => () => React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const panels = context.createPlayInteractionPanels({ interactions, useCandidatePanel: usePanel(interactions.candidates),
    useCandidateGuidePanel: usePanel(interactions.guide), useRegenPanel: usePanel(interactions.regeneration),
    usePhonePlay: () => false })
  let draft = '玩家原文'
  const props = { sessionId: 'a', useSession: select => select({ running: false }), useChat: select => select({}),
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
  interactions.guide.set({ sessionId: 'a', messageId: 'm', phase: 'input' })
  await render(panels.CandidateGuidePanel)
  await act(async () => dom.window.document.querySelector('.dsh-tavern-regen-submit').click())
  assert.equal(calls[0][0], 'submitTask')
  assert.equal(interactions.guide.getSnapshot(), null)
  interactions.regeneration.set({ sessionId: 'a', phase: 'input' })
  await render(panels.RegenPanel)
  assert.equal(dom.window.document.querySelectorAll(".dsh-tavern-regen-submit").length, 1)
  await act(async () => dom.window.document.querySelector('.dsh-tavern-regen-submit').click())
  assert.deepEqual(calls[1], ['regenBody', { guidance: '' }, 'a'])
  await act(async () => interactions.regeneration.set({ sessionId: 'a', phase: 'input' }))
  await act(async () => [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === '精修').click())
  assert.match(dom.window.document.querySelector('.dsh-tavern-regen-loading').textContent, /已修 1 处/)
  assert.match(dom.window.document.querySelector('summary').textContent, /更具体/)
  assert.equal(dom.window.document.querySelector('del').textContent, '原句')
  assert.equal(dom.window.document.querySelector('ins').textContent, '改句')
  await act(async () => finishPolish({ edits: [], view: null }))
  assert.match(dom.window.document.querySelector('.dsh-tavern-choice-error').textContent, /没有发现需要修改/)
  assert.deepEqual(errors, [])
  await act(async () => root.unmount())
})
