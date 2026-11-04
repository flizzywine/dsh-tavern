import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageStatusPanel} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/status-panel.cjs')

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)) }
const HTML = '<div id="hp">体力</div><script>parent.DshStatusPanel.onData(d=>document.getElementById("hp").textContent=d.variables.hp)</script>'

function harness(result = {html: HTML, title: '辉夜的状态', figures: [{name: '辉夜', emotion: '开心'}], data: {variables: {hp: 3}, ledger: {}}}) {
  const reads = [], built = [], facades = [], frames = []
  let notify = null
  const document = {createElement: () => {
    const attributes = new Map(), listeners = {}
    const frame = {isConnected: false, attributes, listeners, contentWindow: {addEventListener() {}},
      setAttribute: (name, value) => attributes.set(name, String(value)), getAttribute: name => attributes.has(name) ? attributes.get(name) : null,
      addEventListener: (name, fn) => { listeners[name] = fn }, remove() { frame.isConnected = false }}
    frames.push(frame)
    return frame
  }}
  const host = {appendChild: frame => { frame.isConnected = true }}
  const panels = createStageStatusPanel({React: {}, window: {console}, document,
    rpc: (method, args, sessionId) => { reads.push({method, args, sessionId}); return Promise.resolve({ok: true, panel: args.withHtml ? result : {...result, html: undefined, data: {variables: {hp: 2}, ledger: {}}}}) },
    signals: {subscribe: (_, fn) => { notify = fn; return () => { notify = null } }},
    themeTokens: () => ({accent: '#ff0000'}),
    mountCardFrame: input => { built.push(input); return '<!doctype html>' + input.content },
    installHostFacade: (hostWindow, owner, priority, names) => { facades.push({owner, names}); return () => { facades.splice(facades.findIndex(item => item.owner === owner), 1) } }})
  return {panels, host, reads, built, facades, frames, signal: () => notify?.()}
}

test('the card html goes to the card-HTML builder unchanged; the sandbox follows trustedCardMode', async () => {
  for (const trustedCardMode of [true, false]) {
    const h = harness()
    const panel = h.panels.open({sessionId: 's1', trustedCardMode, host: () => h.host, onClose() {}, onState() {}})
    await settle()
    assert.deepEqual(h.reads[0], {method: 'readStatusPanel', args: {sessionId: 's1', withHtml: true}, sessionId: 's1'})
    assert.equal(h.built.length, 1)
    assert.equal(h.built[0].content, HTML)
    assert.equal(h.built[0].trustedCardMode, trustedCardMode)
    assert.equal(panel.frame.srcdoc, '<!doctype html>' + HTML)
    assert.equal(panel.frame.getAttribute('sandbox'), trustedCardMode ? null : 'allow-scripts')
    assert.equal(h.facades.length, trustedCardMode ? 1 : 0)
    panel.dispose()
    assert.equal(h.frames[0].isConnected, false)
    assert.equal(h.facades.length, 0)
  }
})

test('the trusted facade exposes data(), onData() and close(); close() calls onClose', async () => {
  const h = harness()
  let closes = 0
  const panel = h.panels.open({sessionId: 's1', trustedCardMode: true, host: () => h.host, onClose: () => closes++, onState() {}})
  await settle()
  assert.deepEqual(h.facades[0].names, ['DshStatusPanel'])
  const facade = h.facades[0].owner.DshStatusPanel
  assert.equal(h.facades[0].owner.frameElement, panel.frame)
  assert.deepEqual(facade.data(), {variables: {hp: 3}, ledger: {}, figures: [{name: '辉夜', emotion: '开心', avatar: null}], theme: {accent: '#ff0000'}})
  const pushed = []
  facade.onData(value => pushed.push(value))
  panel.setFaces(new Map([['辉夜', 'data:image/webp;base64,AAAA'], ['路人', 'data:image/webp;base64,BBBB']]))
  await settle()
  assert.equal(pushed.length, 1)
  assert.deepEqual(pushed[0].figures, [{name: '辉夜', emotion: '开心', avatar: 'data:image/webp;base64,AAAA'}])
  facade.close()
  assert.equal(closes, 1)
  panel.dispose()
})

test('one state signal while open reads once and pushes once', async () => {
  const h = harness()
  const panel = h.panels.open({sessionId: 's1', trustedCardMode: true, host: () => h.host, onClose() {}, onState() {}})
  await settle()
  const pushed = []
  h.facades[0].owner.DshStatusPanel.onData(value => pushed.push(value))
  h.signal()
  await settle()
  assert.deepEqual(h.reads.map(item => item.args.withHtml), [true, false])
  assert.equal(pushed.length, 1)
  assert.deepEqual(pushed[0].variables, {hp: 2})
  panel.dispose()
  h.signal()
  await settle()
  assert.equal(h.reads.length, 2)
})

test('a card without a panel ({panel:null} in the request envelope) opens to the empty note, not a frame', async () => {
  const h = harness(null)
  const states = []
  const panel = h.panels.open({sessionId: 's1', trustedCardMode: true, host: () => h.host, onClose() {}, onState: value => states.push(value.phase)})
  await settle()
  assert.deepEqual(states, ['loading', 'empty'])
  assert.equal(h.built.length, 0)
  panel.dispose()
})
test('a full sheet has no title bar, only the close button; a window sheet keeps its title', () => {
  const find = (node, test) => !node || typeof node !== 'object' ? null : test(node) ? node : node.children.reduce((hit, child) => hit || find(child, test), null)
  for (const [size, title] of [['full', null], ['window', '状态']]) {
    const React = {createElement: (type, props, ...children) => ({type, props: props || {}, children: children.flat()}),
      useRef: () => ({current: null}), useState: initial => [initial, () => {}], useEffect() {}}
    const panels = createStageStatusPanel({React, window: {console, addEventListener() {}, removeEventListener() {}}, document: {}, rpc: () => new Promise(() => {}), signals: {subscribe: () => () => {}}})
    const tree = panels.Overlay({sessionId: 's1', size, onClose() {}})
    assert.equal(tree.props['data-size'], size)
    assert.equal(find(tree, node => node.props.className === 'fork-gal-status-title')?.children[0] ?? null, title)
    assert.equal(find(tree, node => node.props.role === 'dialog').props['aria-label'], '状态')
    assert.ok(find(tree, node => node.props.className === 'fork-gal-status-close'))
    panels.dispose()
  }
})
test('the panel size reaches the sheet state; an undeclared size is the window', async () => {
  for (const [size, expected] of [['full', 'full'], [undefined, 'window']]) {
    const h = harness({html: HTML, title: '状态', ...(size ? {size} : {}), figures: [], data: {variables: {}, ledger: {}}})
    const states = []
    const panel = h.panels.open({sessionId: 's1', trustedCardMode: true, host: () => h.host, onClose() {}, onState: value => states.push(value)})
    await settle()
    assert.deepEqual(states.map(value => [value.phase, value.size]), [['loading', 'window'], ['ready', expected]])
    panel.dispose()
  }
})
