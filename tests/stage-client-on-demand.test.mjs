// On-demand stage client: plain and bubble-only cards download nothing and ask the stage for
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
  host.open('stage'); host.publish('stage', {dialogue:true, stage:false})
  await settle()
  assert.equal(runtime.reads, 0, 'opening only bubbles does not ask the stage runtime')
  assert.equal(loads.length, 0)
  host.publish('stage', {dialogue:true, stage:true})
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

test('transcript bubbles read the card dialogue flag before fetching bubble settings', async () => {
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
  const bubbles = await readFile(new URL('../tavern-plugin/src/client/bubbles.js', import.meta.url), 'utf8')
  assert.match(bubbles, /const dialogue = useStageDialogue\(props\.sessionId\);\r?\n\s*const data = useBubbles\(props\.sessionId, has \|\| dialogue && Boolean\(props\.voiceScope\), select\);/)
})
