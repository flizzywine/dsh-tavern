import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { parseExpressionAt } from 'acorn'
import { JSDOM } from 'jsdom'
import { browserReactScript } from './fixtures/browser-react.mjs'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

// Exercise the real parent component, not only the separately exported runtime:
// #419 had a Helper gate at both levels.
test('酒馆状态父组件在没有 Helper 时仍挂载手动停靠区，两种状态栏位置均可用', () => {
  const start = source.indexOf('function StatusPanelView(')
  assert.ok(start >= 0)
  const node = parseExpressionAt(source, start, { ecmaVersion: 'latest' })
  for (const placement of ['sidebar', 'body']) {
    const view = { mode: 'story', tavernHelper: null, statusBarPlacement: placement, card: { name: '仅正则卡', path: '' }, activity: {} }
    const runtime = () => {}
    const context = {
      React: {
        useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect() {},
        createElement: (type, props, ...children) => ({ type, props, children })
      },
      useTavernConfirm: () => () => {}, usePersistentError: () => ['', () => {}],
      useLiveTavernView: () => ({ view, phase: 'ready' }), isMissingTavernCardError: () => false,
      latestTavernAssistantMessageId: () => null, TavernPersistentStatusRuntime: runtime
    }
    for (const name of ['TextArea', 'EmptyState', 'TavernDebugButton', 'TavernBackgroundWait', 'TavernBackgroundRunsLink', 'TavernSaveUpgrade', 'TavernCardAppDock', 'TavernPluginTasks', 'TavernPluginStatusSections', 'TavernLedger', 'TavernMvuVariables']) context[name] = () => {}
    const component = vm.runInNewContext('(' + source.slice(start, node.end) + ')', context)
    const result = component({ view, props:{sessionId:'s'}, guideDraft:'' })
    const found = []
    function walk(value) {
      if (!value || typeof value !== 'object') return
      if (value.type === runtime) found.push(value)
      for (const child of value.children || []) Array.isArray(child) ? child.forEach(walk) : walk(child)
    }
    walk(result)
    assert.equal(found.length, 1, placement + ': parent must not suppress manual docking')
    assert.equal(found[0].props.panels, placement === 'body' ? 'pinned' : 'all')
    assert.equal(found[0].props.view, view)
  }
})

test('没有已注册面板时固定明确失败，而不是静默丢掉操作', () => {
  const createRegistry = vm.runInNewContext('(' + declaration('createTavernPanelRegistry') + ')')
  assert.throws(() => createRegistry().pin('missing', true), /面板尚未准备好/)
})

test('浏览器不支持 moveBefore 时拒绝固定，不能改用会重载 iframe 的移动', () => {
  const createRegistry = vm.runInNewContext('(' + declaration('createTavernPanelRegistry') + ')')
  const registry = createRegistry()
  const home = { isConnected: true, appendChild() { assert.fail('must not fall back to appendChild') } }
  const node = { parentNode: home }, entry = { id: 'panel', sessionId: 's', node, home, pinned: false }
  registry.register(entry)
  assert.throws(() => registry.pin('panel', true), /不支持保留页面状态的移动/)
  assert.equal(entry.pinned, false)
  assert.equal(node.parentNode, home)
})

function declaration(name) {
  const start = source.indexOf('function ' + name + '(')
  assert.ok(start >= 0, name)
  const node = parseExpressionAt(source, start, { ecmaVersion: 'latest' })
  return source.slice(start, node.end)
}

// Actual React effects and DOM controls, but a controlled retained-frame lease.
// jsdom's moveBefore double tests placement/order, not iframe browsing-context
// preservation; the companion Chromium test verifies that separate guarantee.
for (const { eager, navigate } of [{ eager: false }, { eager: true }, { eager: false, navigate: true }]) test(`React: 无 Helper 面板首击在注册后固定并可返回，eager=${eager}, navigate=${Boolean(navigate)}`, async t => {
  const dom = new JSDOM('<main id="root"></main>', { runScripts: 'outside-only', pretendToBeVisual: true })
  const { window } = dom
  t.after(() => { window.testApi?.root.unmount(); window.close() })
  const errors = []
  window.addEventListener('error', event => { errors.push(event.error.message); event.preventDefault() })
  window.IntersectionObserver = class { observe() {} disconnect() {} }
  window.Element.prototype.moveBefore = function (node) { this.appendChild(node) }
  window.eval(`${await browserReactScript()}
    const React=modules.react,h=React.createElement,events=[],reported=[];
    ${declaration('createTavernPanelRegistry')}
    const tavernPanelRegistry=createTavernPanelRegistry();
    const pin=tavernPanelRegistry.pin;
    tavernPanelRegistry.pin=(id,value)=>{events.push('pin:'+value);return pin(id,value);};
    const tavernRetainedFrames={has:()=>false,key:props=>props.sessionId+':'+props.turn,mount(props,home){
      events.push('mount');const node=document.createElement('input');node.value='保留输入';home.appendChild(node);
      const release=tavernPanelRegistry.register({id:'retained:'+this.key(props),sessionId:props.sessionId,node,home,pinned:false});
      events.push('registered');return {update(){},detach(){release();node.remove();}};
    }};
    const tavernErrorHub={report(source,error){reported.push(error.message);}};
    const tavernStoredFrameHeight=()=>240,tavernFrameHeightKey=()=>'',tavernFrameSizing=()=>false;
    const isPlayMode=mode=>['story','script'].includes(mode);
    const TavernMessageFrame=()=>{throw Error('No Helper: automatic status runtime must not start');};
    ${declaration('TavernRetainedMessageFrame')}
    ${declaration('TavernDockedPanel')}
    ${declaration('TavernPersistentStatusRuntime')}
    const root=modules['react-dom/client'].createRoot(document.querySelector('#root'));
    const view={mode:'story',tavernHelper:null,tavernStatusViews:[{viewId:'automatic'}]};
    function renderSession(sessionId){root.render(h('div',null,
      h('article',{id:'message'},h(TavernRetainedMessageFrame,{sessionId,turn:1,partIndex:0,content:'<script>0</script>',eager:${eager}})),
      h('aside',{id:'sidebar'},h(TavernPersistentStatusRuntime,{sessionId,view}))));}
    renderSession('no-helper');
    window.testApi={root,events,reported,registry:tavernPanelRegistry,renderSession};
  `)
  async function waitFor(read, label) {
    for (let i = 0; i < 100; i++) { const value = read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 5)) }
    assert.fail(label + ': ' + JSON.stringify(errors))
  }
  const button = name => [...window.document.querySelectorAll('button')].find(node => node.textContent === name)
  const pinButton = await waitFor(() => button('固定到右侧'), 'pin control')
  if (!eager) assert.deepEqual(Array.from(window.testApi.events), [], 'cold frame must not register before click')
  pinButton.click()
  if (navigate) {
    // Change message before the activation commit. The old click must neither
    // pin the new message nor survive until the old message is shown again.
    window.testApi.renderSession('other')
    await waitFor(() => window.testApi.registry.inspect().some(entry => entry.sessionId === 'other'), 'mount other message')
    assert.equal(window.document.querySelector('#sidebar input'), null)
    window.testApi.renderSession('no-helper')
    await waitFor(() => window.testApi.registry.inspect().some(entry => entry.sessionId === 'no-helper'), 'return to old message')
    assert.equal(window.document.querySelector('#sidebar input'), null)
    assert.equal(window.testApi.events.some(value => value.startsWith('pin:')), false, 'stale intent is consumed, not replayed')
    assert.deepEqual(Array.from(window.testApi.reported), [])
    assert.deepEqual(errors, [])
    return
  }
  const input = await waitFor(() => window.document.querySelector('#sidebar input'), 'single click docks')
  assert.deepEqual(Array.from(window.testApi.events), ['mount', 'registered', 'pin:true'])
  assert.equal(button('固定到右侧'), undefined)
  input.value = 'changed'
  for (let round = 0; round < 2; round++) {
    button('返回正文栏').click()
    assert.equal(await waitFor(() => window.document.querySelector('#message input'), 'restore'), input)
    assert.equal(input.value, 'changed')
    const next = await waitFor(() => button('固定到右侧'), 'pin available after restore')
    if (round === 0) { next.click(); assert.equal(await waitFor(() => window.document.querySelector('#sidebar input'), 'repin'), input) }
  }
  assert.equal(window.testApi.events.filter(value => value === 'mount').length, 1, 'docking never creates a second lease')
  assert.deepEqual(Array.from(window.testApi.reported), [])
  assert.deepEqual(errors, [])
})
