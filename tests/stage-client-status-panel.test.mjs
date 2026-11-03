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
    rpc: (method, args, sessionId) => { reads.push({method, args, sessionId}); return Promise.resolve(args.withHtml ? result : {...result, html: undefined, data: {variables: {hp: 2}, ledger: {}}}) },
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
