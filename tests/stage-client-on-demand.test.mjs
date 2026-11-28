// On-demand stage client: a card without the stage downloads nothing and asks the stage for
// nothing; a stage card loads the client once.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import vm from 'node:vm'

const local = createRequire(import.meta.url)
const {createStageClientLoader} = local('../tavern-plugin/src/client/stage-client-loader.cjs')
const {watchStageAvailability} = local('../tavern-plugin/packages/dsh-tavern-stage/src/client/availability.cjs')

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = async () => { for (let i = 0; i < 6; i++) await tick() }

// ctx.sessions.list and liveTavernView, as the core wires them.
function createHost() {
  const rows = new Map(), listListeners = new Set()
  const sessions = {list:{getSnapshot:() => ({byId:Object.fromEntries(rows)}), subscribe(listener) {listListeners.add(listener); return () => listListeners.delete(listener)}}}
  const states = new Map(), viewListeners = new Map(), invalidated = []
  const views = {
    getSnapshot:id => states.get(id) || {phase:'idle', view:null},
    subscribe(id, listener, paths) {
      assert.deepEqual(paths, [['stage']], 'the loader subscribes to the stage flags only')
      if (!viewListeners.has(id)) viewListeners.set(id, new Set())
      viewListeners.get(id).add(listener)
      listener(views.getSnapshot(id))
      return () => viewListeners.get(id).delete(listener)
    },
    invalidate:id => invalidated.push(id)
  }
  return {
    sessions, views, invalidated,
    open(id) { rows.set(id, {id, retainedBy:{mainView:1}}); for (const fn of [...listListeners]) fn() },
    close(id) { rows.set(id, {id, retainedBy:{mainView:0}}); for (const fn of [...listListeners]) fn() },
    publish(id, stage) {
      states.set(id, {phase:'ready', view:{chatId:id, stage}, error:''})
      for (const fn of [...(viewListeners.get(id) || [])]) fn(states.get(id))
    },
    watching:id => (viewListeners.get(id)?.size || 0) > 0
  }
}

// The stage plugin as the core sees it: inject tavernStageFrontend, mount/unmount through the shared availability.
function createStagePlugin(log) {
  return {
    name:'dsh-tavern-stage', inject:['tavernStageFrontend'],
    apply(ctx) {
      const host = ctx.get('tavernStageFrontend')
      ctx.effect(() => watchStageAvailability({source:host.availability, activate:() => {log.push('mount'); return () => log.push('unmount')}}), 'stage lifetime')
    }
  }
}

// The stage lifecycle signal: `changed` gets each signal (the latest replayed on connect), `wake` reconnections.
function createRuntime(status = 'ready') {
  const changes = new Set(), wakes = new Set()
  return {
    reads:[], status,
    read({workbench}) { this.reads.push(workbench); return Promise.resolve({status:this.status, enabled:true, installed:true}) },
    subscribe(changed, wake) { changes.add(changed); wakes.add(wake); return () => { changes.delete(changed); wakes.delete(wake) } },
    emit(version) { for (const fn of [...changes]) fn({kind:'plugin-lifecycle', version}) },
    wake() { for (const fn of [...wakes]) fn() }
  }
}

async function cordis() {
  const require = createRequire(pathToFileURL(process.env.DSH_BOOT_MODULE))
  return (await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)).Context
}

test('a stage card loads the client once and mounts it; closing unmounts, reopening remounts without a second download', async () => {
  const Context = await cordis()
  const host = createHost(), runtime = createRuntime(), log = [], loads = []
  const ctx = new Context()
  const loader = createStageClientLoader({sessions:host.sessions, views:host.views, runtime,
    load:() => {loads.push(1); return Promise.resolve({default:createStagePlugin(log)})}, install:plugin => ctx.plugin(plugin), report:error => assert.fail(error)})
  ctx.provide('tavernStageFrontend', Object.freeze({availability:loader.availability}))
  const stop = loader.start()
  // the plain card first: nothing happens
  host.open('plain'); host.publish('plain', {dialogue:false, stage:false})
  await settle()
  assert.equal(loads.length, 0)
  assert.deepEqual(runtime.reads, [])
  // then a card with bubbles on
  host.open('stage'); host.publish('stage', {dialogue:true, stage:false})
  await settle()
  assert.equal(loads.length, 1)
  assert.equal(loader.loaded(), true)
  assert.deepEqual(log, ['mount'])
  assert.deepEqual(runtime.reads, [false], 'the plugin mounts from the status the loader already read')
  // the stage session goes away: the plugin unmounts its views, the module stays
  host.close('stage')
  await settle()
  assert.deepEqual(log, ['mount', 'unmount'])
  assert.equal(host.watching('stage'), false)
  assert.deepEqual(runtime.reads, [false], 'closing the last stage needs no status query')
  // the card's stage switch flips on an open session: no second download
  host.publish('plain', {dialogue:true, stage:true})
  await settle()
  assert.deepEqual(log, ['mount', 'unmount', 'mount'])
  assert.equal(loads.length, 1)
  assert.deepEqual(runtime.reads, [false, false])
  stop()
  await settle()
  assert.deepEqual(log, ['mount', 'unmount', 'mount', 'unmount'], 'stopping the loader disposes the plugin fiber')
  await ctx.fiber.dispose()
})

test('workbench demand follows its own status path while a stage card is open', async () => {
  const host = createHost(), runtime = createRuntime()
  const loader = createStageClientLoader({sessions:host.sessions, views:host.views, runtime,
    load:async () => ({default:{apply(){}}}), install:() => ({}), report:error => assert.fail(error)})
  const stop = loader.start()
  host.open('game'); host.publish('game', {stage:true})
  await settle()
  const release = loader.hold(), releaseAnother = loader.hold()
  release()
  await settle()
  assert.deepEqual(runtime.reads, [false, true])
  releaseAnother()
  await settle()
  assert.deepEqual(runtime.reads, [false, true, false])
  assert.equal(loader.availability.getSnapshot(), true)
  stop()
})

test('lifecycle changes invalidate open views and ignore out-of-order status results', async () => {
  const host = createHost(), runtime = createRuntime(), requests = [], observed = []
  runtime.read = () => {
    const request = Promise.withResolvers()
    requests.push(request)
    return request.promise
  }
  const loader = createStageClientLoader({sessions:host.sessions, views:host.views, runtime,
    load:async () => ({default:{apply(){}}}), install:() => ({}), report:error => assert.fail(error)})
  host.open('game'); host.publish('game', {stage:true})
  const unsubscribe = loader.availability.subscribe(() => observed.push(loader.availability.getSnapshot()))
  const stop = loader.start()
  runtime.emit('ready'); runtime.emit('disabled')
  assert.deepEqual(host.invalidated, ['game'])
  requests[2].resolve({status:'disabled'})
  requests[0].resolve({status:'ready'}); requests[1].resolve({status:'ready'})
  await settle()
  assert.equal(loader.loaded(), false)
  assert.deepEqual(observed, [])
  runtime.wake()
  requests[3].resolve({status:'ready'})
  await settle()
  assert.equal(loader.loaded(), true)
  assert.deepEqual(observed, [true])
  stop(); unsubscribe()
  assert.deepEqual(observed, [true, false])
})

test('closing during import prevents installation and reopening reuses the downloaded module', async () => {
  const host = createHost(), runtime = createRuntime(), download = Promise.withResolvers()
  let loads = 0, installs = 0
  const loader = createStageClientLoader({sessions:host.sessions, views:host.views, runtime,
    load:() => { loads++; return download.promise }, install:() => { installs++; return {} }, report:error => assert.fail(error)})
  host.open('game'); host.publish('game', {stage:true})
  const stop = loader.start()
  await settle()
  assert.equal(loads, 1)
  host.close('game')
  download.resolve({default:{apply(){}}})
  await settle()
  assert.equal(installs, 0)
  assert.equal(loader.availability.getSnapshot(), false)
  host.open('game')
  await settle()
  assert.equal(installs, 1)
  assert.equal(loads, 1)
  stop()
})

test('host cleanup disposes a pending fiber and an old stop cannot close the next lifetime', async () => {
  const host = createHost(), runtime = createRuntime(), pending = Promise.withResolvers(), disposed = []
  let installs = 0
  const loader = createStageClientLoader({sessions:host.sessions, views:host.views, runtime,
    load:async () => ({default:{apply(){}}}), install:() => ++installs === 1
      ? Object.assign(pending.promise, {dispose:() => disposed.push('pending')})
      : {dispose:() => disposed.push('current')}, report:error => assert.fail(error)})
  host.open('game'); host.publish('game', {stage:true})
  const stop = loader.start()
  await settle()
  assert.equal(installs, 1)
  assert.equal(loader.loaded(), false)
  stop()
  assert.deepEqual(disposed, ['pending'])
  const stopAgain = loader.start()
  await settle()
  pending.resolve()
  stop()
  await settle()
  assert.equal(loader.loaded(), true)
  assert.equal(installs, 2)
  assert.deepEqual(disposed, ['pending'])
  stopAgain()
  assert.deepEqual(disposed, ['pending', 'current'])
})

test('transcript bubbles read the card dialogue flag before asking the stage for bubble settings', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/stage-client-loader.cjs', import.meta.url), 'utf8')
  const subscriptions = []
  const sandbox = {
    window:{}, React:{useCallback:fn => fn, useSyncExternalStore:(subscribe, snapshot) => {subscriptions.push(subscribe(() => {})); return snapshot()}},
    liveTavernView:{
      getSnapshot:id => id === 'bubbles' ? {phase:'ready', view:{stage:{dialogue:true, stage:true}}} : id === 'plain' ? {phase:'ready', view:{stage:{dialogue:false, stage:false}}} : {phase:'loading', view:null},
      subscribe:(id, listener, paths) => {assert.equal(JSON.stringify(paths), '[["stage"]]'); return () => {}}
    }
  }
  const useStageDialogue = vm.runInNewContext(source + '\nuseStageDialogue', sandbox)
  assert.equal(useStageDialogue('bubbles'), true)
  assert.equal(useStageDialogue('plain'), false)
  assert.equal(useStageDialogue('pending'), false, 'no request before the view arrives')
  assert.equal(useStageDialogue(''), false, 'a text without a session subscribes to nothing')
  assert.equal(subscriptions.length, 4)
  // BubbleContent gates its voice-only request on it; text with @bubble lines always reads its speakers.
  const bubbles = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/bubbles.js', import.meta.url), 'utf8')
  assert.match(bubbles, /const dialogue = useStageDialogue\(props\.sessionId\);\r?\n\s*const data = useBubbles\(props\.sessionId, has \|\| dialogue && Boolean\(props\.voiceScope\), select\);/)
})
