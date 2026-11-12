import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageStatusPanel} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/status-panel.cjs')

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)) }
const HTML = '<div id="hp">体力</div><script>DshCardPage.onData(d=>document.getElementById("hp").textContent=d.ledger.hp)</script>'
const PAGE = {id: 'status', label: '辉夜的状态', size: 'window', html: HTML, figures: [{name: '辉夜', emotion: '开心'}], card: {name: '辉夜大小姐'}, preload: [], data: {ledger: {hp: 3}}}

function harness({page = PAGE, pages = {pages: [], fresh: false}, failRead = false, options = {}} = {}) {
  const calls = [], frames = [], lifecycles = [], fills = []
  const messageListeners = new Set()
  let notify = null
  const document = {createElement: () => {
    const attributes = new Map(), listeners = {}
    const contentWindow = {posted: [], postMessage(message) { contentWindow.posted.push(message) }, addEventListener() {}}
    const frame = {isConnected: false, attributes, listeners, contentWindow, style: {},
      setAttribute: (name, value) => attributes.set(name, String(value)), getAttribute: name => attributes.has(name) ? attributes.get(name) : null,
      removeAttribute: name => attributes.delete(name), addEventListener: (name, fn) => { listeners[name] = fn }, remove() { frame.isConnected = false }}
    frames.push(frame)
    return frame
  }}
  const host = {appendChild: frame => { frame.isConnected = true }}
  const window = {console, getComputedStyle: () => ({getPropertyValue: () => ''}),
    addEventListener: (type, fn) => { if (type === 'message') messageListeners.add(fn) },
    removeEventListener: (type, fn) => { if (type === 'message') messageListeners.delete(fn) }}
  const rpc = (method, args, sessionId) => {
    calls.push({method, args, sessionId})
    if (method === 'readCardPage') return failRead ? Promise.reject(new Error('坏了')) : Promise.resolve({ok: true, page: page && (args.withHtml ? page : {...page, html: undefined, data: {ledger: {hp: 2}}})})
    if (method === 'readCardPages') return Promise.resolve({ok: true, ...pages})
    if (method === 'locateCardPageAsset') return Promise.resolve({ok: true, place: null})
    return Promise.reject(new Error('unexpected ' + method))
  }
  const createCardFrame = props => {
    const lifecycle = {props, updates: [], refs: [], stopped: 0}
    const descriptor = {token: 'doc-' + lifecycles.length, html: '<!doctype html>' + props.content, trustedCardMode: props.trustedCardMode, ref: node => lifecycle.refs.push(node)}
    Object.assign(lifecycle, {update: next => lifecycle.updates.push(next), snapshot: () => ({visibleDocument: descriptor, pendingDocument: null, height: 0}),
      start: () => () => { lifecycle.stopped++ }})
    lifecycles.push(lifecycle)
    return lifecycle
  }
  const panels = createStageStatusPanel({React: {}, window, document, rpc,
    signals: {subscribe: (_, fn) => { notify = fn; return () => { notify = null } }},
    themeTokens: () => ({accent: '#ff0000'}), createCardFrame, packService: () => null,
    fillInput: (sessionId, text) => fills.push([sessionId, text]), ...options})
  const send = (source, method, args = {}) => {
    const token = /var token="([^"]+)"/.exec(lifecycles[0].props.content)[1]
    for (const fn of [...messageListeners]) fn({source, data: {type: 'dsh-card-page-call', token, requestId: 'r-' + method, method, args}})
  }
  return {panels, host, calls, frames, lifecycles, fills, messageListeners, send, signal: () => notify?.()}
}
const openPage = (h, extra = {}) => h.panels.open({sessionId: 's1', page: 'status', trustedCardMode: true, host: () => h.host, onClose() {}, onState() {}, onAction() {}, ...extra})
const responses = frame => frame.contentWindow.posted.filter(message => message.type === 'dsh-card-page-response')

// A small React stand-in: effects run during render, their cleanups are kept, refs are plain objects.
function fakeReact(stateOverride) {
  const cleanups = []
  return {cleanups, React: {createElement: (type, props, ...children) => ({type, props: props || {}, children: children.flat()}),
    useRef: value => ({current: value ?? null}), useState: initial => [stateOverride ?? initial, () => {}],
    useEffect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) }}}
}
const find = (node, test) => !node || typeof node !== 'object' ? null : test(node) ? node : node.children.reduce((hit, child) => hit || find(child, test), null)
const text = node => !node ? '' : typeof node === 'string' ? node : node.children.map(text).join('')

test('the Overlay frame is the core lifecycle with the live tavernHelper and trustedCardMode', async () => {
  const h = harness()
  const helper = {version: 1, turnMessageIds: {1: 1, 3: 5}, messages: []}
  const {React, cleanups} = fakeReact()
  const lifecycles = []
  const panels = createStageStatusPanel({React, window: {console, getComputedStyle: () => ({getPropertyValue: () => ''}), addEventListener() {}, removeEventListener() {}}, document: {createElement: () => h.frames[h.frames.push({style: {}, contentWindow: {}, setAttribute() {}, removeAttribute() {}, addEventListener() {}, remove() {}}) - 1]},
    rpc: (method, args) => Promise.resolve({ok: true, page: PAGE}), signals: {subscribe: () => () => {}},
    useLiveView: () => ({view: {tavernHelper: helper, tavernRuntimePolicy: {trustedCardMode: true}}}),
    createCardFrame: props => { const lifecycle = {props, update() {}, snapshot: () => ({visibleDocument: {token: 'd', html: '', trustedCardMode: true, ref() {}}}), start: () => () => {}}; lifecycles.push(lifecycle); return lifecycle }})
  const tree = panels.Overlay({sessionId: 's1', pageId: 'status', onClose() {}, onAction() {}})
  find(tree, node => node.props.className === 'fork-gal-status-body').props.ref.current = h.host
  await settle()
  assert.equal(lifecycles.length, 1)
  const props = lifecycles[0].props
  assert.equal(props.helperContext, helper)
  assert.equal(props.trustedCardMode, true)
  assert.deepEqual({sessionId: props.sessionId, turn: props.turn, partIndex: props.partIndex, panelId: props.panelId, eager: props.eager, persistent: props.persistent, observeMvuView: props.observeMvuView, runtimeReporting: props.runtimeReporting},
    {sessionId: 's1', turn: 3, partIndex: 0, panelId: 'stage-page-status', eager: true, persistent: true, observeMvuView: false, runtimeReporting: true})
  // no skin scrollbars.page: the page's document shows no native scrollbar either, under the card's own CSS (:where)
  assert.match(props.content, /^<style data-dsh-card-page>:where\(html,body,\*\)\{scrollbar-width:none\}[^<]*<\/style><script data-dsh-card-page>[\s\S]*window\.DshCardPage=[\s\S]*<\/script>/)
  assert.ok(props.content.endsWith(HTML))
  for (const cleanup of cleanups) cleanup()
  panels.dispose()
})

test('close, open, openSettings and fillInput reach onClose / onAction; fillInput sends nothing', async () => {
  const h = harness()
  let closes = 0
  const actions = []
  const page = openPage(h, {onClose: () => closes++, onAction: (...args) => actions.push(args)})
  await settle()
  const source = h.frames[0].contentWindow
  h.send(source, 'close')
  h.send(source, 'open', {id: 'map'})
  h.send(source, 'settings')
  h.send(source, 'fillInput', {text: '去学生会室'})
  await settle()
  assert.equal(closes, 1)
  assert.deepEqual(actions, [['open', 'map'], ['settings'], ['fill']])
  assert.deepEqual(h.fills, [['s1', '去学生会室']])
  assert.deepEqual(h.calls.map(call => call.method), ['readCardPage'])
  assert.deepEqual(responses(h.frames[0]).map(message => [message.requestId, message.ok]), [['r-close', true], ['r-open', true], ['r-settings', true], ['r-fillInput', true]])
  page.dispose()
})

test('title(text) sets the sheet title over the declared label, empty gives the label back', async () => {
  const h = harness()
  const states = []
  const page = openPage(h, {onState: next => states.push(next)})
  await settle()
  const source = h.frames[0].contentWindow
  h.send(source, 'title', {text: '  人物档案·小林  '})
  await settle()
  assert.deepEqual([states.at(-1).title, states.at(-1).label, states.at(-1).phase], ['人物档案·小林', PAGE.label, 'ready'])
  assert.deepEqual(responses(h.frames[0]).at(-1).result, {title: '人物档案·小林'})
  h.send(source, 'title', {text: ''})
  await settle()
  assert.equal(states.at(-1).title, '')
  assert.match(h.lifecycles[0].props.content, /title:function\(text\)\{return call\("title"/)
  // the sheet shows it
  const {React} = fakeReact({phase: 'ready', label: PAGE.label, title: '人物档案·小林', size: 'window', figures: [], shown: true})
  const panels = createStageStatusPanel({React, window: {console, addEventListener() {}, removeEventListener() {}}, document: {}, rpc: () => new Promise(() => {}), signals: {subscribe: () => () => {}}})
  const tree = panels.Overlay({sessionId: 's1', pageId: 'status', label: PAGE.label, onClose() {}})
  assert.equal(text(find(tree, node => node.props.className === 'fork-gal-status-title')), '人物档案·小林')
  panels.dispose()
  page.dispose()
})

test('an entry page draws no chrome (data-bare) until its document is shown, or its read comes back empty or failed', () => {
  for (const [entry, phase, shown, bare] of [[true, 'loading', false, true], [true, 'ready', false, true], [true, 'ready', true, false],
    [true, 'empty', false, false], [true, 'error', false, false], [false, 'loading', false, false], [false, 'ready', false, false]]) {
    const {React} = fakeReact({phase, label: '标题', size: 'full', figures: [], shown})
    const panels = createStageStatusPanel({React, window: {console, addEventListener() {}, removeEventListener() {}}, document: {}, rpc: () => new Promise(() => {}), signals: {subscribe: () => () => {}}})
    const tree = panels.Overlay({sessionId: 's1', pageId: 'title', label: '标题', size: 'full', entry, onClose() {}})
    assert.equal(tree.props['data-bare'], bare ? '' : undefined, JSON.stringify({entry, phase, shown}))
    panels.dispose()
  }
})

// Two card pages a card may author: a full title page entered from text mode and a window menu page from a menu row.
const TITLE_PAGE = {...PAGE, id: 'title', label: '标题', size: 'full', html: '<button data-dsh-sound id="new">新游戏</button>', figures: []}
const MENU_PAGE = {...PAGE, id: 'menu', label: '菜单', size: 'window', html: '<button data-dsh-sound id="back">返回</button>', figures: []}