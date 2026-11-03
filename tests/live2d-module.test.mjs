// Live2D is the stage's on-demand module (dsh-tavern-live2d): lib/client/live2d-client.mjs, built from live2d-module.js,
// loaded by the stage's live2d-loader.cjs only when a Live2D figure, preview or runtime entry needs it.
// The heap-guard and resource-URL tests run the real pixi-live2d-display cubism4 bundle, which never ships: they skip
// unless DSH_LIVE2D_DISPLAY names a downloaded copy (<dataRoot>/live2d/core/pixi-live2d-display-cubism4.min.js).
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import * as url from 'node:url'
import vm from 'node:vm'

const display = process.env.DSH_LIVE2D_DISPLAY || ''
const live2dDisplaySkip = display && existsSync(display) ? false : 'set DSH_LIVE2D_DISPLAY to a downloaded pixi-live2d-display cubism4 bundle'
const vendor = live2dDisplaySkip ? '' : readFileSync(display, 'utf8')
const clientSource = name => readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/' + name, import.meta.url), 'utf8')
const guardSource = clientSource('cubism-heap.cjs')
const chunkUrl = new URL('../tavern-plugin/packages/dsh-tavern-stage/lib/client/live2d-client.mjs', import.meta.url)
const loaderSource = readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/live2d-loader.cjs', import.meta.url), 'utf8')
// One page: a fresh loader scope (its page-level chunk cache starts empty).
function page() {
  const context = { module: { exports: {} }, console }
  vm.runInNewContext(loaderSource, context)
  return context.module.exports.createStageLive2d
}
const React = { createElement: (type, props) => ({ type, props }), useSyncExternalStore: (subscribe, snapshot) => snapshot(), useEffect: effect => { effect() } }
function host() {
  const RUNTIMES = {}
  const vendorRuntimeStore = extra => {
    const listeners = new Set()
    return Object.assign({ revision: 0, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) }, snapshot() { return this.revision },
      installed(value) { extra.installed.call(this, value); this.revision++; for (const fn of listeners) fn() } }, extra.fields)
  }
  return { RUNTIMES, vendorRuntimeStore, RuntimeEntry: () => null, Spinner: () => null, rpc: async () => ({}), forkLoadScript: async () => {}, loadPixiRuntime: async () => {}, forkLipSync: {} }
}

test('Live2D code ships only in its own chunk: neither the core client nor the stage client carries the module', () => {
  const core = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const stage = readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/lib/client.js', import.meta.url), 'utf8')
  const chunk = readFileSync(chunkUrl, 'utf8')
  for (const name of ['function createLive2dModule', 'RUNTIMES.live2d =', 'function cubismHeapGuard', 'function loadLive2dRuntime', 'function Live2dFigurePreview']) {
    assert.ok(chunk.includes(name), name)
    assert.equal(core.includes(name), false, 'core: ' + name)
    assert.equal(stage.includes(name), false, 'stage: ' + name)
  }
  assert.ok(stage.includes('function createStageLive2d('))
})

test('the built module registers the Live2D runtime entry for its lifetime and exposes the stage runtime', async () => {
  const { createLive2dModule } = await import(chunkUrl)
  const names = host(), module = createLive2dModule({ React, ...names })
  assert.equal(names.RUNTIMES.live2d.title, 'Live2D')
  assert.deepEqual(Object.keys(module.runtime).sort(), ['live2dDropContext', 'live2dExpress', 'live2dHeadFrame', 'live2dLoadError', 'live2dPlace', 'live2dUseContext', 'loadLive2dRuntime', 'syntheticMouth'])
  assert.equal(typeof module.preview.Preview, 'function')
  module.store.installed({ core: '/core.js', display: '/display.js' })
  assert.equal(module.store.core, '/core.js')
  module.dispose()
  assert.equal(names.RUNTIMES.live2d, undefined)
})

test('the stage loads the Live2D module once, only when Live2D is needed, and retries a failed load', async () => {
  const createStageLive2d = page(), names = host()
  let loads = 0, fail = true
  const load = async () => { loads++; if (fail) throw new Error('offline'); return import(chunkUrl) }
  const live2d = createStageLive2d({ React, host: names, load, report: () => {} })
  live2d.runtime.live2dUseContext({})
  assert.equal(live2d.runtime.ready(), false)
  assert.equal(live2d.runtime.core(), '')
  assert.equal(JSON.stringify(live2d.previews.snapshots.peek('model', ['smile'], 'face')), '{}')
  assert.equal(loads, 0, 'a stage without Live2D downloads nothing')
  await assert.rejects(live2d.runtime.loadLive2dRuntime('/core.js'), /offline/)
  fail = false
  let revisions = 0
  live2d.store.subscribe(() => revisions++)
  // A shown runtime entry asks for the module; the first figure core joins the same load.
  assert.equal(live2d.Entry({ request: names.rpc }), null)
  const runtime = live2d.runtime.loadLive2dRuntime('')
  assert.equal(await runtime, null, 'no Cubism Core imported: the runtime stays off')
  assert.equal(loads, 2)
  assert.equal(live2d.runtime.ready(), true)
  assert.ok(revisions > 0)
  assert.equal(live2d.Entry({ request: names.rpc }).props.request, names.rpc)
  assert.equal(names.RUNTIMES.live2d.title, 'Live2D')
  live2d.dispose()
  assert.equal(names.RUNTIMES.live2d, undefined)
  // The same page re-activating the stage starts from the chunk it already has.
  const again = createStageLive2d({ React, host: host(), load, report: () => {} })
  assert.equal(again.runtime.ready(), true)
  assert.equal(loads, 2)
  again.dispose()
})

// Cubism Core for Web moves its heap to a new ArrayBuffer when a later moc makes it grow, so every model created before then
// wrote and read a stale copy (a figure kept a shut mouth while its voice played). The fake core below keeps that one
// property of the real one: views are taken on the heap of their creation.
function fakeCore() {
  const heap = { buffer: new ArrayBuffer(64), next: 16 } // a released model has _ptr 0
  const f32 = (ptr, length) => new Float32Array(heap.buffer, ptr, length)
  function Parameters(ptr) {
    this.count = 2; this.ids = ['ParamMouthOpenY', 'ParamAngleX']
    this.values = f32(ptr, 2); this.maximumValues = new Float32Array([1, 30]); this.minimumValues = new Float32Array([0, -30])
    this.defaultValues = new Float32Array(2)
  }
  function Parts(ptr) { this.count = 1; this.ids = ['PartMouth']; this.opacities = f32(ptr + 8, 1) }
  function Drawables(ptr) { this.count = 1; this.ids = ['MouthMesh']; this.vertexPositions = [f32(ptr + 12, 1)]; this.resetDynamicFlags() }
  Drawables.prototype.resetDynamicFlags = function () {}
  // The "core": reads its inputs from and writes its outputs to the heap it owns now.
  function Model(ptr) {
    this._ptr = ptr
    this.parameters = new Parameters(ptr); this.parts = new Parts(ptr); this.drawables = new Drawables(ptr)
  }
  Model.prototype.update = function () { f32(this._ptr + 12, 1)[0] = f32(this._ptr, 1)[0] }
  Model.prototype.release = function () {}
  Model.fromMoc = () => { const model = new Model(heap.next); heap.next += 16; return model }
  // Growth: the bytes move to a larger buffer; existing views keep the old one.
  const grow = () => { const next = new ArrayBuffer(heap.buffer.byteLength * 2); new Uint8Array(next).set(new Uint8Array(heap.buffer)); heap.buffer = next }
  return { core: { Model, Parameters, Parts, Drawables }, grow }
}

function runtime() {
  const ctx = { console, performance: { now: () => 0 }, window: { Live2DCubismCore: {} },
    PIXI: { utils: { EventEmitter }, Point: class {}, Matrix: class {}, Container: class {}, Transform: class {} } }
  vm.runInNewContext(vendor, ctx)
  vm.runInNewContext(guardSource, ctx)
  return ctx
}

function scenario(guarded) {
  const ctx = runtime(), { core, grow } = fakeCore()
  ctx.Live2DCubismCore = core
  if (guarded) assert.equal(ctx.cubismHeapGuard(core, ctx.PIXI.live2d), true)
  const first = new ctx.PIXI.live2d.CubismModel(core.Model.fromMoc({}))
  grow() // the next, larger moc
  const second = new ctx.PIXI.live2d.CubismModel(core.Model.fromMoc({}))
  return { ctx, first, second }
}

test('without the guard a model created before heap growth no longer reaches the core (the bug)', { skip: live2dDisplaySkip }, () => {
  const { first } = scenario(false)
  first.setParameterValueById('ParamMouthOpenY', 0.8)
  first.update()
  assert.equal(first.getDrawableVertices(0)[0], 0)
})

test('the guard rebinds an older model so lip sync written before and after growth reaches the core', { skip: live2dDisplaySkip }, () => {
  const { first, second } = scenario(true)
  first.setParameterValueById('ParamAngleX', 12) // written into the stale copy before the rebind
  first.setParameterValueById('ParamMouthOpenY', 0.8)
  first.update()
  assert.equal(first.getDrawableVertices(0)[0], Math.fround(0.8))
  assert.equal(first.getParameterValueById('ParamAngleX'), 12)
  first.setParameterValueById('ParamMouthOpenY', 0.25)
  first.update()
  assert.equal(first.getDrawableVertices(0)[0], 0.25)
  assert.equal(first.getParameterMaximumValue(1), 30)
  second.setParameterValueById('ParamMouthOpenY', 0.5)
  second.update()
  assert.equal(second.getDrawableVertices(0)[0], 0.5)
  assert.equal(first.getDrawableVertices(0)[0], 0.25, 'models keep separate state on the shared heap')
})

test('the guard installs once and ignores runtimes without a Cubism core', { skip: live2dDisplaySkip }, () => {
  const ctx = runtime(), { core } = fakeCore()
  assert.equal(ctx.cubismHeapGuard(null, ctx.PIXI.live2d), false)
  assert.equal(ctx.cubismHeapGuard(core, ctx.PIXI.live2d), true)
  assert.equal(ctx.cubismHeapGuard(core, ctx.PIXI.live2d), false)
})

const runtimeSource = clientSource('live2d.cjs')
const pixiRuntime = readFileSync(new URL('../tavern-plugin/src/client/pixi-runtime.js', import.meta.url), 'utf8')
function browser() {
  const context = {console,window:{Live2DCubismCore:{}},PIXI:{utils:{EventEmitter,url},Point:class {},Matrix:class {},Container:class {},Transform:class {}}}
  vm.runInNewContext(vendor,context)
  context.window.PIXI = context.PIXI
  vm.runInNewContext(guardSource + '\n' + pixiRuntime.slice(0,pixiRuntime.indexOf('const forkLipSync')) + '\n' + runtimeSource.slice(0,runtimeSource.indexOf('// Placement:')),context)
  return context
}

test('Live2D runtime preserves browser-owned Blob URLs for model dependencies and deferred files',{skip:live2dDisplaySkip},async()=>{
  const context = browser(), pixi = await context.loadLive2dRuntime('/core.js')
  const settings = new pixi.live2d.Cubism4ModelSettings({url:'blob:http://localhost:43120/model',Version:3,FileReferences:{Moc:'blob:http://localhost:43120/moc',Textures:['blob:http://localhost:43120/texture']}})
  for (const name of ['moc','texture','physics','pose','motion','expression']) {
    const resource = 'blob:http://localhost:43120/'+name
    assert.equal(settings.resolveURL(resource),resource)
  }
  assert.equal(await context.loadLive2dRuntime('/core.js'),pixi)
})

test('non-Blob references retain the existing resolver and its model base URL',{skip:live2dDisplaySkip},async()=>{
  const context = browser(), pixi = await context.loadLive2dRuntime('/core.js')
  const settings = new pixi.live2d.Cubism4ModelSettings({url:'http://localhost:43120/models/model.model3.json',Version:3,FileReferences:{Moc:'model.moc3',Textures:['textures/face.png']}})
  assert.equal(settings.resolveURL('textures/face.png'),'http://localhost:43120/models/textures/face.png')
  assert.equal(settings.resolveURL('https://example.test/model.moc3'),'https://example.test/model.moc3')
})
