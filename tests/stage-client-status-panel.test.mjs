import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import vm from 'node:vm'
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

test('page keys close through the facade in both trust modes without taking editing shortcuts', async () => {
  for (const trustedCardMode of [true, false]) {
    const h = harness(), posted = [], listeners = new Map()
    const panel = openPage(h, {trustedCardMode, shortcut: 's'})
    await settle()
    const prelude = /<script data-dsh-card-page>([\s\S]*?)<\/script>/.exec(h.lifecycles[0].props.content)[1]
    const context = {window: {}, parent: {postMessage: data => posted.push(data)}, addEventListener: (type, fn) => listeners.set(type, fn)}
    vm.runInNewContext(prelude, context)
    const key = init => listeners.get('keydown')({key:'s',preventDefault(){}, ...init})
    key({target:{tagName:'INPUT'}})
    key({ctrlKey:true})
    key({repeat:true})
    key({isComposing:true})
    assert.equal(posted.length, 0)
    key({})
    key({key:'Escape',target:{tagName:'TEXTAREA'}})
    assert.deepEqual(posted.map(call => call.method), ['close','close'])
    panel.dispose(); h.panels.dispose()
  }
})

test('usePages is undefined while reading, then null for a card without pages or a failed read, else {pages, fresh}', async () => {
  const pending = createStageStatusPanel({React: {useState: initial => [initial, () => {}], useEffect() {}}, window: {}, document: {}, rpc: () => new Promise(() => {}), signals: {}})
  assert.equal(pending.usePages('s1'), undefined, 'not read yet: the entry reveal waits for it')
  pending.dispose()
  {
    let value = 'unset'
    const {React} = fakeReact()
    const failed = createStageStatusPanel({React: {...React, useState: initial => [initial, next => { value = next }]}, window: {}, document: {}, rpc: () => Promise.reject(new Error('坏了')), signals: {}})
    failed.usePages('s1')
    await settle()
    assert.equal(value, null, 'a failed read holds nothing')
    failed.dispose()
  }
  for (const [pages, expected] of [[{pages: [], fresh: true}, null],
    [{pages: [{id: 'status', label: '状态', shortcut: 's', menu: true}], fresh: true}, {pages: [{id: 'status', label: '状态', shortcut: 's', menu: true}], fresh: true}]]) {
    const h = harness({pages})
    let value = 'unset'
    const {React} = fakeReact()
    const panels = createStageStatusPanel({React: {...React, useState: initial => [initial, next => { value = next }]}, window: {}, document: {},
      rpc: (method, args, sessionId) => { h.calls.push({method, args, sessionId}); return Promise.resolve({ok: true, ...pages}) }, signals: {}})
    panels.usePages('s1')
    await settle()
    assert.deepEqual(h.calls, [{method: 'readCardPages', args: {sessionId: 's1'}, sessionId: 's1'}])
    assert.deepEqual(value, expected)
    panels.dispose()
  }
})

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

test('a trusted page frame has no sandbox attribute, an untrusted one sandbox=allow-scripts', async () => {
  for (const trustedCardMode of [true, false]) {
    const h = harness()
    const page = openPage(h, {trustedCardMode})
    await settle()
    assert.equal(h.lifecycles[0].props.trustedCardMode, trustedCardMode)
    assert.equal(h.frames.length, 1)
    assert.equal(h.frames[0].srcdoc, '<!doctype html>' + h.lifecycles[0].props.content)
    assert.equal(h.frames[0].getAttribute('sandbox'), trustedCardMode ? null : 'allow-scripts')
    assert.deepEqual(h.lifecycles[0].refs, [h.frames[0]])
    page.dispose()
  }
})

test('a DshCardPage call from a foreign window gets no answer', async () => {
  const h = harness()
  let closes = 0
  const page = openPage(h, {onClose: () => closes++})
  await settle()
  const foreign = {posted: [], postMessage(message) { foreign.posted.push(message) }}
  h.send(foreign, 'close')
  await settle()
  assert.equal(closes, 0)
  assert.deepEqual(foreign.posted, [])
  assert.deepEqual(responses(h.frames[0]), [])
  page.dispose()
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

test('asset() outside the bound packs rejects with 本卡的素材包里没有', async () => {
  const h = harness()
  const page = openPage(h)
  await settle()
  h.send(h.frames[0].contentWindow, 'asset', {kind: 'backgrounds', id: 'moon'})
  await settle()
  const locate = h.calls.find(call => call.method === 'locateCardPageAsset')
  assert.deepEqual(locate.args, {sessionId: 's1', page: 'status', ref: {kind: 'backgrounds', id: 'moon', variant: undefined, file: undefined, size: undefined}})
  const [response] = responses(h.frames[0])
  assert.equal(response.ok, false)
  assert.match(response.error, /^本卡的素材包里没有 backgrounds \/ moon$/)
  page.dispose()
})

test('a session state signal re-reads the page and pushes its ledger to onData', async () => {
  const h = harness()
  const page = openPage(h)
  await settle()
  assert.match(h.lifecycles[0].props.content, /"ledger":\{"hp":3\}/)
  assert.match(h.lifecycles[0].props.content, /"theme":\{"accent":"#ff0000"\},"card":\{"name":"辉夜大小姐"\}/)
  h.signal()
  await settle()
  assert.deepEqual(h.calls.map(call => call.args.withHtml), [true, false])
  const pushed = h.frames[0].contentWindow.posted.filter(message => message.type === 'dsh-card-page-data')
  assert.equal(pushed.length, 1)
  assert.equal(pushed[0].data.saved, false, 'an unsaved chat')
  delete pushed[0].data.saved
  assert.deepEqual(pushed[0].data, {ledger: {hp: 2}, figures: [{name: '辉夜', emotion: '开心', avatar: null}], theme: {accent: '#ff0000'}, card: {name: '辉夜大小姐'}})
  page.dispose()
})

test('dispose removes the frames, the message listener, the signal and the lifecycle', async () => {
  const h = harness()
  const page = openPage(h)
  await settle()
  assert.equal(h.frames[0].isConnected, true)
  assert.equal(h.messageListeners.size, 1)
  h.panels.dispose()
  assert.equal(h.frames[0].isConnected, false)
  assert.equal(h.messageListeners.size, 0)
  assert.equal(h.lifecycles[0].stopped, 1)
  assert.deepEqual(h.lifecycles[0].refs, [h.frames[0], null])
  assert.deepEqual(page.frames, [])
  h.signal()
  await settle()
  assert.equal(h.calls.length, 1)
})

test('a missing page opens to the empty state and a failed read to the error state, not a frame', async () => {
  for (const [options, phases] of [[{page: null}, ['loading', 'empty']], [{failRead: true}, ['loading', 'error']]]) {
    const h = harness(options)
    const states = []
    const page = openPage(h, {onState: value => states.push(value.phase)})
    await settle()
    assert.deepEqual(states, phases)
    assert.equal(h.lifecycles.length, 0)
    page.dispose()
  }
})

test('the sheet renders loading, empty and error (重试) states', () => {
  for (const [phase, expected] of [['loading', '正在读取页面…'], ['empty', '本卡没有这个页面'], ['error', '页面读取失败重试']]) {
    const {React} = fakeReact({phase, label: '', size: 'window', figures: []})
    const panels = createStageStatusPanel({React, window: {console, addEventListener() {}, removeEventListener() {}}, document: {}, rpc: () => new Promise(() => {}), signals: {subscribe: () => () => {}}})
    const tree = panels.Overlay({sessionId: 's1', pageId: 'status', onClose() {}})
    const note = find(tree, node => node.props.className === 'fork-gal-status-note')
    assert.equal(text(note), expected)
    if (phase === 'error') assert.equal(find(note, node => node.type === 'button')?.children[0], '重试')
    panels.dispose()
  }
})

test('an entry page is opaque from its first frame: no 正在读取 note, and its close button is 返回主页面', () => {
  for (const entry of [true, false]) {
    const {React} = fakeReact({phase: 'loading', label: '', size: 'full', figures: []})
    const panels = createStageStatusPanel({React, window: {console, addEventListener() {}, removeEventListener() {}}, document: {}, rpc: () => new Promise(() => {}), signals: {subscribe: () => () => {}}})
    const tree = panels.Overlay({sessionId: 's1', pageId: 'title', size: 'full', entry, onClose() {}})
    assert.equal(tree.props['data-entry-page'], entry ? '' : undefined)
    assert.equal(Boolean(find(tree, node => node.props.className === 'fork-gal-status-note')), !entry, 'a loading note only on a page opened while reading')
    assert.equal(find(tree, node => node.props.className === 'fork-gal-status-close').props['aria-label'], entry ? '返回主页面' : '关闭页面')
    panels.dispose()
  }
})

test('a full sheet has no title bar, only the close button; a window sheet keeps its label', () => {
  for (const [size, title] of [['full', null], ['window', '状态']]) {
    const {React} = fakeReact({phase: 'ready', label: '状态', size, figures: []})
    const panels = createStageStatusPanel({React, window: {console, addEventListener() {}, removeEventListener() {}}, document: {}, rpc: () => new Promise(() => {}), signals: {subscribe: () => () => {}}})
    const tree = panels.Overlay({sessionId: 's1', pageId: 'status', size, onClose() {}})
    assert.equal(tree.props['data-size'], size)
    assert.equal(tree.props['data-page'], 'status')
    assert.equal(find(tree, node => node.props.className === 'fork-gal-status-title')?.children[0] ?? null, title)
    assert.equal(find(tree, node => node.props.role === 'dialog').props['aria-label'], '状态')
    assert.ok(find(tree, node => node.props.className === 'fork-gal-status-close'))
    panels.dispose()
  }
})

// Two card pages a card may author: a full title page entered from text mode and a window menu page from a menu row.
const TITLE_PAGE = {...PAGE, id: 'title', label: '标题', size: 'full', html: '<button data-dsh-sound id="new">新游戏</button>', figures: []}
const MENU_PAGE = {...PAGE, id: 'menu', label: '菜单', size: 'window', html: '<button data-dsh-sound id="back">返回</button>', figures: []}
function titleHarness(page, {answer = true} = {}) {
  const asked = [], started = [], played = []
  const h = harness({page, options: {
    confirm: (message, options) => { asked.push([message, options]); return Promise.resolve(answer) },
    newGame: sessionId => started.push(sessionId),
    sounds: {playSkin: name => { played.push(name); return name !== 'close' }}}})
  return {h, asked, started, played}
}
const answered = frame => Object.fromEntries(responses(frame).map(message => [message.requestId, message.ok ? message.result : 'error:' + message.error]))

test('title actions route on both pages: continue / gallery / exit reach the stage, newGame leaves for the core', async () => {
  for (const page of [TITLE_PAGE, MENU_PAGE]) {
    const t = titleHarness(page)
    let closes = 0
    const actions = []
    const panel = openPage(t.h, {page: page.id, saved: false, onClose: () => closes++, onAction: (...args) => actions.push(args)})
    await settle()
    const source = t.h.frames[0].contentWindow
    for (const method of ['continue', 'gallery', 'exit', 'newGame']) t.h.send(source, method)
    await settle()
    assert.equal(closes, 0, page.id + ': continueGame is the stage action, not close() (which leaves on an entry page)')
    assert.deepEqual(actions, [['continue'], ['gallery'], ['exit'], ['exit']])
    assert.deepEqual(t.started, ['s1'])
    assert.deepEqual(t.asked, [], 'an unsaved chat starts without asking')
    assert.deepEqual(answered(t.h.frames[0]), {'r-continue': {ok: true}, 'r-gallery': {ok: true}, 'r-exit': {ok: true}, 'r-newGame': {started: true}})
    panel.dispose()
  }
})

test('newGame asks first when the chat is saved; a cancel answers {started:false} and leaves the page as it was', async () => {
  for (const answer of [false, true]) {
    const t = titleHarness(TITLE_PAGE, {answer})
    const actions = []
    const panel = openPage(t.h, {page: 'title', saved: true, onAction: (...args) => actions.push(args)})
    await settle()
    assert.match(t.h.lifecycles[0].props.content, /"saved":true/)
    t.h.send(t.h.frames[0].contentWindow, 'newGame')
    await settle()
    assert.equal(t.asked.length, 1)
    assert.match(t.asked[0][0], /^开始新游戏？/)
    assert.deepEqual(t.asked[0][1], {confirmText: '开始新游戏', cancelText: '取消'})
    assert.deepEqual(answered(t.h.frames[0]), {'r-newGame': {started: answer}}, 'the call settles either way, so no button stays disabled')
    assert.deepEqual(actions, answer ? [['exit']] : [])
    assert.deepEqual(t.started, answer ? ['s1'] : [])
    panel.dispose()
  }
})

test('sound(name) plays the shown skin palette cue only, and rejects other names', async () => {
  const t = titleHarness(MENU_PAGE)
  const panel = openPage(t.h, {page: 'menu'})
  await settle()
  const source = t.h.frames[0].contentWindow
  t.h.send(source, 'sound', {name: 'move'})
  await settle()
  t.h.send(source, 'sound', {name: 'close'})
  await settle()
  t.h.send(source, 'sound', {name: 'type'})
  await settle()
  assert.deepEqual(t.played, ['move', 'close'])
  assert.deepEqual(responses(t.h.frames[0]).map(message => message.ok ? message.result : message.error),
    [{played: true}, {played: false}, 'sound 只接受 move、confirm、open、close'])
  panel.dispose()
})

test('the prelude exposes the title actions and sounds data-dsh-sound controls on hover, focus and click', async () => {
  const h = harness({page: TITLE_PAGE})
  const panel = openPage(h, {page: 'title'})
  await settle()
  const prelude = /<script data-dsh-card-page>([\s\S]*?)<\/script>/.exec(h.lifecycles[0].props.content)[1]
  const posted = [], listeners = new Map(), context = {window: {}, parent: {postMessage: data => posted.push(data)}, addEventListener: (type, fn) => listeners.set(type, fn)}
  vm.runInNewContext(prelude, context)
  const api = context.window.DshCardPage
  for (const name of ['newGame', 'continueGame', 'openGallery', 'exit']) api[name]()
  api.sound('open')
  assert.deepEqual(JSON.parse(JSON.stringify(posted.splice(0).map(call => [call.method, call.args]))), [['newGame', {}], ['continue', {}], ['gallery', {}], ['exit', {}], ['sound', {name: 'open'}]])
  const button = {disabled: false, getAttribute: () => null, contains: node => node === inner}, inner = {closest: () => button}
  const target = {closest: selector => selector === '[data-dsh-sound]' ? button : null}
  listeners.get('mouseover')({target, relatedTarget: null})
  listeners.get('mouseover')({target, relatedTarget: inner}) // moving inside the same control
  listeners.get('focusin')({target, relatedTarget: null})
  listeners.get('click')({target})
  listeners.get('mouseover')({target: {closest: () => null}})
  button.disabled = true
  listeners.get('click')({target})
  assert.deepEqual(posted.map(call => call.args.name), ['move', 'move', 'confirm'])
  panel.dispose()
})