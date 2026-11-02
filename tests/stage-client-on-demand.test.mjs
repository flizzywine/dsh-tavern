// On-demand stage client: a card without the stage downloads nothing and asks the stage for
// nothing; a stage card loads the client once.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import vm from 'node:vm'

const local = createRequire(import.meta.url)
const {createStageClientLoader, stageWantedOf, openSessionIds} = local('../tavern-plugin/src/client/stage-client-loader.cjs')
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
    reads:0, status,
    read() { this.reads++; return Promise.resolve({status:this.status, enabled:true, installed:true}) },
    subscribe(changed, wake) { changes.add(changed); wakes.add(wake); return () => { changes.delete(changed); wakes.delete(wake) } },
    emit(version) { for (const fn of [...changes]) fn({kind:'plugin-lifecycle', version}) },
    wake() { for (const fn of [...wakes]) fn() }
  }
}

async function cordis() {
  const require = createRequire(pathToFileURL(process.env.DSH_BOOT_MODULE))
  return (await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)).Context
}

test('an ordinary card never downloads the stage client nor asks the server about the stage', async () => {
  const host = createHost(), runtime = createRuntime(), log = [], loads = []
  const loader = createStageClientLoader({sessions:host.sessions, views:host.views, runtime,
    load:() => {loads.push(1); return Promise.resolve({default:createStagePlugin(log)})}, install:() => assert.fail('nothing to install'), report:error => assert.fail(error)})
  const stop = loader.start()
  host.open('plain')
  host.publish('plain', {dialogue:false, stage:false})
  runtime.emit('ready:1'); runtime.wake()
  await settle()
  assert.deepEqual(await loader.availability.read(), {status:'idle'})
  assert.equal(loads.length, 0)
  assert.equal(runtime.reads, 0, 'no stage RPC for a plain card')
  assert.equal(loader.loaded(), false)
  stop()
  assert.equal(host.watching('plain'), false)
})

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
  // then a card with bubbles on
  host.open('stage'); host.publish('stage', {dialogue:true, stage:false})
  await settle()
  assert.equal(loads.length, 1)
  assert.equal(loader.loaded(), true)
  assert.deepEqual(log, ['mount'])
  // the stage session goes away: the plugin unmounts its views, the module stays
  host.close('stage')
  await settle()
  assert.deepEqual(log, ['mount', 'unmount'])
  assert.equal(host.watching('stage'), false)
  // the card's stage switch flips on an open session: no second download
  host.publish('plain', {dialogue:true, stage:true})
  await settle()
  assert.deepEqual(log, ['mount', 'unmount', 'mount'])
  assert.equal(loads.length, 1)
  stop()
  await settle()
  assert.deepEqual(log, ['mount', 'unmount', 'mount', 'unmount'], 'stopping the loader disposes the plugin fiber')
  await ctx.fiber.dispose()
})

test('a stage card waits for the server stage; the lifecycle signal wakes the load and refreshes open views', async () => {
  const host = createHost(), runtime = createRuntime('loading'), log = [], loads = [], installed = []
  const loader = createStageClientLoader({sessions:host.sessions, views:host.views, runtime,
    load:() => {loads.push(1); return Promise.resolve({default:createStagePlugin(log)})}, install:plugin => {installed.push(plugin); return {then:resolve => resolve(), dispose() {log.push('dispose')}}}, report:error => assert.fail(error)})
  const stop = loader.start()
  host.open('stage'); host.publish('stage', {dialogue:true, stage:true})
  // the latest signal replayed on connect is the state the views were read in
  runtime.emit('loading:1')
  await settle()
  assert.deepEqual(host.invalidated, [])
  assert.ok(runtime.reads >= 1, 'a stage card asks the server once it is open')
  assert.equal(loads.length, 0)
  runtime.status = 'ready'; runtime.emit('ready:2')
  await settle()
  assert.deepEqual(host.invalidated, ['stage'], 'views read before the stage started carry stale stage flags')
  assert.equal(loads.length, 1)
  assert.equal(installed.length, 1)
  // a replayed signal or a later wake while loaded does not invalidate or install twice
  runtime.emit('ready:2'); runtime.wake(); host.publish('stage', {dialogue:true, stage:true})
  await settle()
  assert.deepEqual(host.invalidated, ['stage'])
  assert.equal(installed.length, 1)
  stop()
  assert.deepEqual(log, ['dispose'])
})

test('a failed download is reported and retried on the next wake', async () => {
  const host = createHost(), runtime = createRuntime(), reports = [], installed = []
  let fail = true, loads = 0
  const loader = createStageClientLoader({sessions:host.sessions, views:host.views, runtime,
    load:() => {loads++; return fail ? Promise.reject(new Error('offline')) : Promise.resolve({default:{apply() {}}})},
    install:plugin => {installed.push(plugin); return {then:resolve => resolve(), dispose() {}}}, report:error => reports.push(error.message)})
  const stop = loader.start()
  host.open('stage'); host.publish('stage', {dialogue:false, stage:true})
  await settle()
  assert.equal(loads, 1); assert.deepEqual(reports, ['offline']); assert.equal(installed.length, 0)
  fail = false
  runtime.wake()
  await settle()
  assert.equal(loads, 2); assert.equal(installed.length, 1)
  host.close('stage')
  assert.deepEqual(await loader.availability.read(), {status:'idle'})
  stop()
})

test('stage flags come from the host view; open sessions are the retained rows', () => {
  assert.equal(stageWantedOf({view:{stage:{dialogue:false, stage:false}}}), false)
  assert.equal(stageWantedOf({view:{stage:{dialogue:true, stage:false}}}), true)
  assert.equal(stageWantedOf({view:{stage:{dialogue:false, stage:true}}}), true)
  assert.equal(stageWantedOf({view:null}), false)
  assert.equal(stageWantedOf({view:{}}), false)
  assert.deepEqual(openSessionIds({byId:{a:{id:'a', retainedBy:{mainView:1}}, b:{id:'b', retainedBy:{mainView:0}}, c:{id:'c', retainedBy:{sidebar:2}}}}), ['a', 'c'])
  assert.deepEqual(openSessionIds({byId:{a:{id:'a'}}, current:'a'}), ['a'])
  assert.deepEqual(openSessionIds({byId:{}}), [])
})

test('the stage package ships no boot-time client; the core imports it as the stage client asset', async () => {
  const manifest = JSON.parse(await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.dsh.client, undefined, 'a dsh.client entry would put the stage into every page')
  const main = await readFile(new URL('../tavern-plugin/src/client/main.js', import.meta.url), 'utf8')
  assert.match(main, /load: \(\) => import\('\/api\/dsh-tavern\/client-assets\/stage-client\.mjs'\)/)
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
  assert.match(bubbles, /const dialogue = useStageDialogue\(props\.sessionId\);\n\s*const data = useBubbles\(props\.sessionId, has \|\| dialogue && Boolean\(props\.voiceScope\), select\);/)
})
