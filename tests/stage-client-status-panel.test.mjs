import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageStatusPanel} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/status-panel.cjs')

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)) }
const HTML = '<div id="hp">体力</div><script>DshCardPage.onData(d=>document.getElementById("hp").textContent=d.ledger.hp)</script>'
const PAGE = {id: 'status', label: '辉夜的状态', size: 'window', html: HTML, figures: [{name: '辉夜', emotion: '开心'}], card: {name: '辉夜大小姐'}, preload: [], data: {ledger: {hp: 3}}}

function harness({page = PAGE, pages = {pages: [], fresh: false}, failRead = false, locate = () => null, options = {}} = {}) {
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
    if (method === 'locateCardPageAsset') return Promise.resolve({ok: true, place: locate(args.ref)})
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

test('a shown map page applies its own background and music to the current game', async () => {
  const scenes = [], actions = []
  const h = harness({locate:ref=>({packId:ref.kind==='music'?'music-pack':'map-pack'}),
    options:{applyCardScene:async (...args)=>{scenes.push(args);return {applied:true}}}})
  const page = openPage(h,{onAction:(...args)=>actions.push(args)})
  await settle()
  const frame = h.frames[0]
  frame.listeners.load()
  h.send(frame.contentWindow,'applyTravelScene',{sessionId:'another-game',background:'forest',music:'evening',actors:['旅伴']})
  await settle()
  assert.deepEqual(responses(frame).at(-1).result,{applied:true},JSON.stringify(responses(frame).at(-1)))
  assert.deepEqual(scenes,[['s1',{packId:'map-pack',assetId:'forest'},{packId:'music-pack',assetId:'evening'}]])
  assert.deepEqual(actions,[['travelCast',['旅伴']]])
  page.dispose()
})

test('a shown card page opens its available plugin panel in the current game', async () => {
  const requests = [], selections = []
  const h = harness({options:{findPluginPanel:async (...ref) => {
    requests.push(ref)
    return ref[1] === 'travel' ? {title:'旅行与牌桌', size:'full'} : null
  }}})
  const page = openPage(h, {onPluginPanel: value => selections.push(value), pluginPanelShowing: () => selections.length > 0})
  await settle()
  const frame = h.frames[0]
  frame.listeners.load()
  h.send(frame.contentWindow, 'openPluginPanel', {plugin:'unrelated', panelId:'table'})
  await settle()
  assert.equal(responses(frame).at(-1).ok,false)
  h.send(frame.contentWindow, 'openPluginPanel', {plugin:'travel', panelId:'table', sessionId:'another-game'})
  await settle()
  assert.deepEqual(requests.at(-1), ['s1', 'travel', 'table'])
  assert.deepEqual(selections, [{plugin:'travel', id:'table', title:'旅行与牌桌', size:'full'}])
  assert.deepEqual(responses(frame).at(-1).result, {opened:true})
  h.send(frame.contentWindow, 'title', {text:'旅行'})
  await settle()
  assert.deepEqual(responses(frame).at(-1).result, {title:'旅行'})
  h.send(frame.contentWindow, 'fillInput', {text:'旅行'})
  await settle()
  assert.equal(responses(frame).at(-1).ok, false)
  assert.deepEqual(h.fills, [])
  page.dispose()
})

// A small React stand-in: effects run during render, their cleanups are kept, refs are plain objects.
function fakeReact(stateOverride, pluginPanel = null) {
  const cleanups = []
  return {cleanups, React: {createElement: (type, props, ...children) => ({type, props: props || {}, children: children.flat()}),
    useRef: value => ({current: value ?? null}), useState: initial => [initial === null ? pluginPanel : stateOverride ?? initial, () => {}],
    useMemo: fn => fn(),
    useEffect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) }}}
}
const find = (node, test) => !node || typeof node !== 'object' ? null : test(node) ? node : node.children.reduce((hit, child) => hit || find(child, test), null)
const text = node => !node ? '' : typeof node === 'string' ? node : node.children.map(text).join('')

test('a shared plugin panel receives the host page ID for each card page', () => {
  const PluginPanel = () => null
  const {React} = fakeReact(null, {plugin: 'travel', id: 'journal', title: '旅程'})
  const h = harness({options: {React, PluginPanel}})
  for (const stagePageId of ['quests', 'inventory']) {
    const tree = h.panels.Overlay({sessionId: 's1', pageId: stagePageId, onClose() {}})
    const {stage, ...props} = find(tree, node => node.type === PluginPanel).props
    assert.deepEqual(props, {sessionId: 's1', plugin: 'travel', id: 'journal', stagePageId})
    assert.equal(stage.page, stagePageId)
    const offer = {title:'再问一句',lines:[{speaker:'旅伴',text:'要出发了吗？'}],options:[],onSelect() {}}
    const actions = []
    const another = h.panels.Overlay({sessionId:'s1',pageId:stagePageId,onAction:(...args)=>actions.push(args)})
    find(another,node=>node.type===PluginPanel).props.stage.offerChoices(offer)
    assert.deepEqual(actions,[['offerChoices',offer]])
  }
  h.panels.dispose()
})

test('stage plugin panels default to a window and can fill the stage with a labeled exit', () => {
  const PluginPanel = () => null
  for (const [size, expected] of [[undefined, 'window'], ['full', 'full']]) {
    const {React, cleanups} = fakeReact(null, {plugin:'travel', id:'table', title:'牌桌', size})
    const h = harness({options: {React, PluginPanel}})
    const tree = h.panels.Overlay({sessionId:'s1', pageId:'inventory', size:'full', label:'道具', onClose() {}})
    assert.equal(tree.props['data-size'], expected)
    assert.equal(find(tree, node => node.props?.role === 'dialog').props['aria-label'], '牌桌')
    assert.equal(find(tree, node => node.props?.className === 'fork-gal-status-close').props['aria-label'], '返回道具')
    cleanups.forEach(cleanup => cleanup())
    h.panels.dispose()
  }
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

test('a page knows whether it stands in for the stage entry (data().entry)', async () => {
  for (const entry of [true, undefined]) {
    const h = harness()
    const page = openPage(h, {entry})
    await settle()
    const frame = h.frames[0]
    frame.listeners.load()
    const data = frame.contentWindow.posted.filter(message => message.type === 'dsh-card-page-data').at(-1).data
    assert.equal(data.entry, entry === true)
    assert.match(h.lifecycles[0].props.content, entry ? /"entry":true/ : /"entry":false/)
    page.dispose()
  }
})
