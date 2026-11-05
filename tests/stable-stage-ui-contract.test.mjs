import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const source = await readFile(new URL('../tavern-plugin/src/client/features/plugin-extensions.js', import.meta.url), 'utf8')
const factory = source.slice(source.indexOf('function createTavernUiExtensions()'), source.indexOf('const tavernUiExtensions = createTavernUiExtensions()'))

function events(values = {}) {
  const handlers = new Map()
  return Object.assign(values, {
    addEventListener(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn) },
    removeEventListener(name, fn) { handlers.get(name)?.delete(fn) },
    emit(name, event = {}) { for (const fn of handlers.get(name) || []) fn(event) },
    count(name) { return handlers.get(name)?.size || 0 }
  })
}
function fixture() {
  const viewport = events({ offsetLeft: 0, offsetTop: 0, width: 390, height: 700 })
  const window = events({ visualViewport: viewport, innerWidth: 390, innerHeight: 700,
    getComputedStyle: () => ({ paddingTop: '20px', paddingRight: '0px', paddingBottom: '30px', paddingLeft: '0px' }) })
  const document = events({ body: { append() {} }, createElement: () => ({ style: {}, setAttribute() {}, remove() {} }) })
  let element, unmounted = 0, disposers = [], allowed = true
  const scopeListeners = new Set()
  const context = {
    window, document, React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    tavernPluginBoundary: () => 'Boundary', tavernErrorHub: { report() {} }, tavernPluginAllowed: (_, gameId) => allowed && gameId !== 'denied',
    tavernCardPluginScopes: { subscribe: fn => { scopeListeners.add(fn); return () => scopeListeners.delete(fn) } },
    require: () => ({ createRoot: () => ({ render: value => { element = value }, unmount: () => { unmounted++ } }) })
  }
  const ui = vm.runInNewContext(factory + '; createTavernUiExtensions()', context)
  const plugin = Object.create(ui.service)
  plugin.ctx = { fiber: { name: 'fixture' }, effect(register) { const dispose = register(); disposers.push(dispose); return dispose } }
  return { ui, plugin, viewport, window, document, element: () => element, unmounted: () => unmounted, unload: () => disposers.forEach(dispose => dispose()), deny: () => { allowed = false; for (const fn of [...scopeListeners]) fn() } }
}

test('browser capability map is independent and returned as a fresh snapshot', () => {
  const { ui } = fixture()
  assert.equal(ui.service.apiVersion, 9)
  const caps = ui.service.getCapabilities()
  assert.equal(caps.openOverlay, 1)
  assert.equal(caps.overlayLayout, 2)
  assert.equal(caps.overlayFullscreen, 1)
  assert.equal(caps.stageDock, 1)
  caps.openOverlay = 99
  assert.equal(ui.service.getCapabilities().openOverlay, 1)
})

test('performance ledger snapshot observes card scope and stage lifetime', () => {
  const f = fixture()
  assert.equal(f.plugin.getStagePerformanceStatus('game'), null)
  const unbind = f.ui.bindStagePerformance(id => ({ gameId: id }))
  assert.equal(f.plugin.getStagePerformanceStatus('game').gameId, 'game')
  assert.equal(f.plugin.getStagePerformanceStatus('denied'), null)
  f.deny()
  assert.equal(f.plugin.getStagePerformanceStatus('game'), null)
  unbind()
  assert.equal(f.plugin.getStagePerformanceStatus('game'), null)
})

test('native stage dock denies unrelated games and cleans up its shared lease', () => {
  const f = fixture(), reasons = []
  assert.equal(f.plugin.openStageDock({ gameId: 'denied', render() {} }).reason, 'denied')
  assert.equal(f.plugin.openStageDock({ gameId: 'game', render() {} }).reason, 'stage-unavailable')
  let active = null
  const bridge = { shutdown() { if (active) active.closed('stage-unavailable') }, open(key, closed) {
    if (active) return { ok: false, reason: 'busy' }
    active = { key, closed }
    return { ok: true, node: { append() {} }, close() { active = null } }
  } }
  const unbind = f.ui.bindStageDock('game', bridge)
  const opened = f.plugin.openStageDock({ gameId: 'game', render: () => null, onClose: ({ reason }) => reasons.push(reason) })
  assert.equal(opened.ok, true)
  assert.equal(f.plugin.openStageDock({ gameId: 'game', render() {} }).reason, 'busy')
  active.closed('too-narrow')
  opened.close()
  assert.deepEqual(reasons, ['too-narrow'])
  assert.equal(f.unmounted(), 1)
  assert.equal(f.document.count('keydown'), 0)
  assert.equal(f.plugin.openStageDock({ gameId: 'game', render() {}, onClose: ({reason}) => reasons.push(reason) }).ok, true)
  f.deny()
  assert.equal(active, null)
  assert.deepEqual(reasons, ['too-narrow','denied'])
  f.unload()
  unbind()
})

test('replacing a stage bridge closes the old stage lease without removing the new bridge', () => {
  const f = fixture(), reasons = []
  function bridge() {
    let active
    return { shutdown() { active?.('stage-unavailable'); active = null },
      open(key, close) { active = close; return { ok: true, node: { append() {} }, close() { active = null } } } }
  }
  const first = bridge(), second = bridge(), unbindFirst = f.ui.bindStageDock('game', first)
  f.plugin.openStageDock({ gameId: 'game', render() {}, onClose: ({reason}) => reasons.push(reason) })
  const unbindSecond = f.ui.bindStageDock('game', second)
  unbindFirst()
  assert.deepEqual(reasons, ['stage-unavailable'])
  assert.equal(f.plugin.openStageDock({ gameId: 'game', render() {} }).ok, true)
  unbindSecond()
  assert.equal(f.plugin.openStageDock({ gameId: 'game', render() {} }).reason, 'stage-unavailable')
})

test('a card can ignore unknown capabilities and fall back on an older host', () => {
  function install(ui) {
    const capabilities = ui.getCapabilities?.() || {}
    const options = { id: 'battle', label: 'Battle', render: () => null }
    if (capabilities.stageInteraction === 1 && typeof ui.registerStageInteraction === 'function') {
      return ui.registerStageInteraction(options)
    }
    return ui.registerComposerAction({ id: options.id, label: options.label,
      run: ({ gameId }) => ui.openOverlay({ gameId, render: options.render }) })
  }
  const f = fixture()
  const old = Object.create(f.plugin)
  old.getCapabilities = undefined
  old.registerStageInteraction = undefined
  const stopOld = install(old)
  const handle = f.ui.composerActions()[0].run({ gameId: 'old-game' })
  assert.equal(typeof handle.close, 'function')
  handle.close()
  stopOld()
  const newer = Object.create(f.plugin)
  newer.getCapabilities = () => ({ stageInteraction: 1, futureOptionalFeature: 99 })
  const stopNew = install(newer)
  assert.equal(f.ui.composerActions().length, 1)
  stopNew()
})

test('overlay retains old render parameters, tracks viewport, and cleans up on unload', () => {
  const f = fixture()
  let screen, closes = 0
  const handle = f.plugin.openOverlay({ gameId: 'game', render: args => { screen = args; return 'screen' }, onClose: () => closes++ })
  f.element().children[0].type()
  assert.equal(screen.gameId, 'game')
  assert.equal(typeof screen.close, 'function')
  assert.equal(screen.layout.get().width, 390)
  assert.deepEqual(JSON.parse(JSON.stringify(screen.layout.get().safe)), { left: 0, top: 20, width: 390, height: 650 })
  f.viewport.height = 400
  assert.equal(screen.layout.get().safe.height, 380, 'a keyboard-sized visual viewport does not apply the bottom screen inset twice')
  f.viewport.height = 700
  const seen = []
  const stop = screen.layout.subscribe(rect => seen.push(rect.width))
  f.viewport.width = 1280
  f.viewport.emit('resize')
  assert.deepEqual(seen, [1280])
  stop()
  f.viewport.emit('scroll')
  assert.deepEqual(seen, [1280])
  screen.layout.subscribe(rect => seen.push(rect.width))
  f.unload()
  handle.close()
  f.viewport.emit('resize')
  assert.deepEqual(seen, [1280])
  assert.equal(f.viewport.count('resize'), 0)
  assert.equal(f.window.count('resize'), 0)
  assert.equal(f.document.count('keydown'), 0)
  assert.equal(f.unmounted(), 1)
  assert.equal(closes, 1)
})

test('overlay Escape, non-dismissible mode, and repeated close preserve lifecycle', () => {
  const f = fixture()
  let closes = 0, stopped = 0
  const handle = f.plugin.openOverlay({ render: () => null, onClose: () => closes++ })
  f.document.emit('keydown', { key: 'Escape', stopPropagation() { stopped++ } })
  handle.close()
  assert.equal(stopped, 1)
  assert.equal(closes, 1)
  const g = fixture()
  const fixed = g.plugin.openOverlay({ render: () => null, dismissible: false })
  g.document.emit('keydown', { key: 'Escape', stopPropagation() { throw Error('must not stop') } })
  assert.equal(g.unmounted(), 0)
  fixed.close()
  assert.equal(g.unmounted(), 1)
})

test('game overlay closes if card authorization is revoked', () => {
  const f=fixture()
  assert.throws(()=>f.plugin.openOverlay({gameId:'denied',render(){}}),/未授权/)
  let closes=0
  f.plugin.openOverlay({gameId:'game',render(){},onClose(){closes++}})
  f.deny()
  assert.equal(closes,1)
  assert.equal(f.document.count('fullscreenchange'),0)
})


test('stage interaction uses an existing composer action, deduplicates, and disposes its overlays', () => {
  const f = fixture()
  let closes = 0
  const unregister = f.plugin.registerStageInteraction({ id: 'battle', label: 'Battle', render: () => null, onClose: () => closes++ })
  const action = f.ui.composerActions()[0]
  assert.equal(action.owner, 'fixture')
  const first = action.run({ gameId: 'game' })
  assert.equal(action.run({ gameId: 'game' }), first)
  unregister()
  assert.equal(f.ui.composerActions().length, 0)
  assert.equal(f.unmounted(), 1)
  assert.equal(closes, 1)
  f.unload()
  assert.equal(closes, 1)
})

test('candidate scene lease follows card scope and stage lifetime', () => {
  const f = fixture(), reasons = []
  assert.equal(f.plugin.getCapabilities().stageScene, 1)
  assert.equal(f.plugin.getCapabilities().stageSceneBackground,1)
  assert.equal(f.plugin.getCapabilities().stageScenePresentation,1)
  assert.equal(f.plugin.getCapabilities().stageSceneActorEmotion,1)
  assert.equal(f.plugin.openStageScene({gameId:'denied',renderHud(){}}).reason, 'denied')
  let active, updated
  const unbind=f.ui.bindStageScene('game',{
    open(input){if(active)return {ok:false,reason:'busy'};active=input;return {ok:true,update(value){updated=value},close(){active=null}}},
    shutdown(){active?.onClose('stage-unavailable')}
  })
  const advances=[]
  const lease=f.plugin.openStageScene({gameId:'game',renderHud(){},onDialogueAdvance:event=>advances.push(event.delta),onClose:({reason})=>reasons.push(reason)})
  active.onDialogueAdvance({gameId:'game',delta:1})
  assert.deepEqual(advances,[1])
  lease.update({actors:[{instanceId:'one',ref:{packId:'p',figureId:'f'},x:0.5}]})
  assert.equal(updated.actors[0].instanceId,'one')
  lease.update({actors:[{instanceId:'one',ref:{packId:'p',figureId:'f'},x:0.5,size:0.1}]})
  assert.throws(()=>lease.update({actors:[{instanceId:'one',ref:{packId:'p',figureId:'f'},x:0.5,size:0.09}]}),/Invalid stage scene actors/)
  assert.throws(()=>lease.update({actors:[],backgroundRef:{packId:'p',kind:'figures',assetId:'f'}}),/Invalid stage scene background/)
  assert.throws(() => lease.update({actors:[
    {instanceId:'one',ref:{packId:'p',figureId:'f'},x:0.3},
    {instanceId:'one',ref:{packId:'p',figureId:'f'},x:0.7}
  ]}), /Invalid stage scene actors/)
  assert.equal(f.plugin.openStageScene({gameId:'game',renderHud(){}}).reason,'busy')
  f.deny()
  assert.equal(active,null)
  assert.deepEqual(reasons,['denied'])
  unbind()
})

test('candidate provider starts for a mounted authorized stage and cleans up a late result', async () => {
  const f = fixture(), calls = [], cleaned = []
  let resolve
  const unbind = f.ui.bindStageScene('game', { shutdown() {} })
  const unregister = f.plugin.registerStageSceneProvider({id:'scene',onStageReady:({gameId})=>{
    calls.push(gameId)
    return new Promise(done => { resolve=done })
  }})
  assert.deepEqual(calls,['game'])
  unbind()
  resolve(()=>cleaned.push('game'))
  await new Promise(setImmediate)
  assert.deepEqual(cleaned,['game'])
  unregister()
})

test('candidate provider ends when card access is revoked', () => {
  const f=fixture(), calls=[]
  const remove=f.plugin.registerStageSceneProvider({id:'scene',onStageReady:({gameId})=>{
    calls.push('start:'+gameId); return ()=>calls.push('stop:'+gameId)
  }})
  assert.equal(f.plugin.getCapabilities().stageSceneProvider,1)
  const unbind=f.ui.bindStageScene('game',{shutdown(){}})
  f.deny()
  assert.deepEqual(calls,['start:game','stop:game'])
  unbind(); remove()
})
