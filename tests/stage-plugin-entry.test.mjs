import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {readFile} from 'node:fs/promises'
import {loadStageClientPlugin} from './fixtures/stage-client-plugin.mjs'
import * as stage from '../tavern-plugin/packages/dsh-tavern-stage/lib/index.js'

test('independent stage plugin follows real Cordis load, unload and reload',async()=>{
  const require=createRequire(pathToFileURL(process.env.DSH_BOOT_MODULE))
  const {Context}=await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  const ctx=new Context(),seen=[]
  ctx.provide('tavernStageControl',{install:async()=>seen.push('enable'),uninstall:async()=>seen.push('disable')})
  ctx.provide('llm',{})
  const first=ctx.plugin(stage);await first.await()
  assert.deepEqual(seen,['enable'])
  await first.dispose();assert.deepEqual(seen,['enable','disable'])
  const second=ctx.plugin(stage);await second.await()
  assert.deepEqual(seen,['enable','disable','enable'])
  await ctx.fiber.dispose();assert.deepEqual(seen,['enable','disable','enable','disable'])
})


test('browser stage entry owns deferred startup, unloading and reloading on real Cordis', async () => {
  const require = createRequire(pathToFileURL(process.env.DSH_BOOT_MODULE))
  const local = createRequire(import.meta.url)
  const {Context} = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  const controllerSource=await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/controller.cjs',import.meta.url),'utf8')
  const controllerCalls=[...new Set([...controllerSource.matchAll(/stageViews\.([A-Za-z0-9_.]+)\(/g)].map(match=>match[1]))]
  const controllerComponents=[...new Set([...controllerSource.matchAll(/React\.createElement\(stageViews\.([A-Za-z0-9_.]+),/g)].map(match=>match[1]))]
  const styles = new Set()
  const document = {addEventListener(){},removeEventListener(){},querySelector:() => null, head:{appendChild:style => styles.add(style),insertBefore:style => styles.add(style)}, createElement:() => ({dataset:{},remove() {styles.delete(this)}})}
  const plugin = await loadStageClientPlugin({document, window:{}})
  assert.equal(plugin.name, 'dsh-tavern-stage')
  assert.deepEqual([...plugin.inject], ['tavernStageFrontend'])
  const assembled = []
  const forbidden = () => {throw new Error('host must not supply stage session access')}
  // The core's stage registrations (main.js stageEffect): the plugin runs them as one owned lifetime per activation.
  const seen = [], registrations = [
    input => {
      assert.equal(typeof input.createNavigation,'function')
      const React = {
        useState:value => [typeof value === 'function' ? value() : value,()=>{}],
        useRef:current => ({current}),useMemo:fn => fn(),useLayoutEffect:()=>{},useEffect:()=>{},
        createElement:(type,props,...children) => ({type,props,children}),
      }
      const views = input.createViews({React,GalStage:forbidden,skinResources:{getSession:forbidden,getResourceOwner:forbidden},backlogPaging:{hydrateText:forbidden,hasOlder:forbidden,loadOlder:forbidden},sceneColorMath:local('../tavern-plugin/shared/color-math.cjs'),navigation:{galEntering:{get:()=>false}},speech:{player:{cancelPrefetch(){}}},loader:{},video:{},music:{foreground:{clearTimeout(){}},audio:{}},bgm:{clock:{clearTimeout(){}}},admission:{performance:{now:() => 0}},
        text:{defaultTextSpeed:28},statusPanel:{}})
      assembled.push(views)
      assert.notEqual(views.controller.Stage,forbidden,'the plugin composes its own controller')
      for(const path of [...controllerCalls,...controllerComponents]) {
        const value=path.split('.').reduce((value,key)=>value?.[key],views)
        assert.equal(typeof value,'function','controller dependency '+path+' must exist on the compiled plugin')
      }
      assert.equal(views.sceneMath.galSpringValue(3).v,3)
      assert.equal(views.sceneMath.galClamp01(2),1)
      const state=views.runtimeKernel.createStageRuntimeState()
      assert.equal(views.runtimeKernel.stageRuntimeStatus(state),'idle')
      let stopped=0
      const session=views.sessionRuntime.createSessionOwner({sessions:{list:{getSnapshot:()=>({byId:{}}),subscribe:()=>()=>stopped++}}})
      session.start();session.dispose();assert.equal(stopped,1)
      for (const name of ['Host','Toggle','Typewriter','NarrationLines','HudLabels','NamePlate']) assert.equal(typeof views[name],'function')
      assert.equal(views.Typewriter({text:'完整文字',instant:true}).children[0][0].children[0],'完整文字')
      views.progress.store.begin('s',1)
      assert.equal(views.progress.store.get('s').id,1)
      seen.push('tab')
      return () => {views.dispose(); seen.push('remove-tab')}
    },
  ]
  const ctx = new Context()
  ctx.provide('tavernStageFrontend', {registrations,sessionInputs:()=>({
    native:{sessions:{list:{getSnapshot:()=>({byId:{}}),subscribe:()=>()=>{}}},selectedSessionId:()=>null,settings:{subscribe:()=>()=>{}}},
    io:{},assets:{createOwner:()=>{seen.push('sessions');let closed=false;return {dispose:()=>{if(!closed){closed=true;seen.push('stop-sessions')}}}}},dialogue:{},text:{},performance:{},
    observation:{packs:{subscribe:()=>()=>{},runtimeChanged:()=>()=>{}},portraits:{select(){}},media:{background:{activate(){}}}}
  })})
  assert.deepEqual(seen, [], 'core setup does not start the stage')
  assert.equal(styles.size,0)
  const first = ctx.plugin(plugin); await first.await()
  assert.deepEqual(seen,['tab','sessions'])
  // Exercise the compiled composition: private consumers resolve this activation's owner,
  // even when a legacy host tries to supply its own session callbacks.
  const views = assembled[0], calls = []
  const originalGet = views.sessions.get, originalOwner = views.sessions.owner
  const resourceOwner = views.sessions.resourceOwner
  views.sessions.get = id => ({getSnapshot:()=>({source:{sessionId:id,authorityEpoch:7}})})
  resourceOwner.acquire = async (resource,authority) => {calls.push(['acquire',authority]);return {release:()=>calls.push(['release'])}}
  views.sessions.owner = {hydrateText:(...args)=>calls.push(['hydrate',...args]),hasOlder:()=>true,loadOlder:(...args)=>calls.push(['older',...args])}
  try {
    views.skinResources.prefetch('s',{kind:'bundle'})
    const paging = views.backlogPaging.create('s',()=>{})
    paging.hydrate(new Map([[4,{unloaded:true}]]),[4])
    await paging.load(4)
    await Promise.resolve()
    assert.deepEqual(calls,[['acquire','["s",7]'],['older','s'],['release'],['hydrate','s',4]])
    paging.dispose()
  } finally {
    views.sessions.get = originalGet
    views.sessions.owner = originalOwner
  }
  // the theme, the source widgets' CSS and the phone, redaction, textcard and timer mods' stage feature CSS (mods/*/client/stage.css)
  assert.equal(styles.size,6)
  // Styles inserted after boot name their owner, or the module loader claims them for the next plugin it materializes.
  for (const style of styles) assert.equal(style.dataset.plugin, 'dsh-tavern-stage')
  assert.match([...styles][1].textContent, /fork-widget-source-controls/)
  const feature = id => [...styles].find(style => style.dataset.stageFeature === id)
  assert.match(feature('textcard').textContent, /fork-tc-layer/)
  assert.match(feature('timer').textContent, /fork-timer-pill/)
  assert.match(feature('phone').textContent, /fork-gal-phone-reader/)
  await first.dispose()
  assert.deepEqual(seen,['tab','sessions','stop-sessions','remove-tab'])
  assert.equal(styles.size,0)
  const second = ctx.plugin(plugin); await second.await()
  assert.deepEqual(seen.slice(-2),['tab','sessions'])
  await second.dispose()
  assert.equal(styles.size,0)
  await ctx.fiber.dispose()
})

test('card pages: a card without pages adds no frames, keys or menu rows; an open page keeps auto and skip paused', async () => {
  const local = createRequire(import.meta.url)
  const client = '../tavern-plugin/packages/dsh-tavern-stage/src/client/'
  const controls = local(client + 'controls.cjs').createStageControls()
  const menu = local(client + 'menu.cjs').createStageMenu({React:{},window:{},document:{},sounds:{},getSession(){}})
  const {createStageInput} = local(client + 'input.cjs')
  const {createStageNavigation} = local(client + 'navigation.cjs')
  const pages = [{id:'title',label:'标题',showOn:{event:'stage-enter'},size:'full'},{id:'status',label:'状态',shortcut:'s',menu:true,size:'window'}]
  // no pages: the built-in keys and rows only, and no entry page (so the controller never mounts a page frame).
  assert.deepEqual(controls.shortcuts({pages:[]}),controls.shortcuts({}))
  assert.ok(controls.shortcuts({pages:[]}).every(([, , action]) => !action.startsWith('page:')))
  assert.ok(menu.items({pages:[]}).every(item => !item.id.startsWith('page:')))
  assert.equal(controls.stageEnterPage({pages:[],fresh:true,skip:false}),null)
  assert.deepEqual(menu.items({pages}).filter(item => item.id.startsWith('page:')).map(item => item.id),['page:status'])
  const controllerSource = await readFile(new URL(client + 'controller.cjs', import.meta.url), 'utf8')
  assert.doesNotMatch(controllerSource,/statusOpen|statusPanel\.useStatusPanel|data-status-panel/)
  assert.match(controllerSource,/pageOpen \? h\(stageViews\.statusPanel\.Overlay/)
  // every pause the old status panel had reads pageOpen: the playback clock (auto / skip), the insert page's auto, read marks.
  assert.match(controllerSource,/usePlayback\(\{[^]*?overlay:backlog\|\|configOpen\|\|galleryOpen\|\|pageOpen\|\|menuOpen/)
  assert.match(controllerSource,/if \(!auto \|\| hidden \|\| backlog \|\| configOpen \|\| galleryOpen \|\| pageOpen \|\| menuOpen\) return;/)
  // the keyboard: with a page open neither A (auto) nor a held Ctrl (skip) reaches the reader; Esc closes the page.
  const handlers = new Map(), timers = [], sent = []
  const target = {addEventListener:(type,fn) => handlers.set(type,[...(handlers.get(type) || []),fn]),removeEventListener(){}}
  const fire = (type,init) => { const event = {key:'',repeat:false,preventDefault(){},target:null,...init,type}; for (const fn of handlers.get(type) || []) fn(event) }
  const input = createStageInput({React:{},window:target,document:target,clock:{setTimeout:fn => timers.push(fn),clearTimeout(){}},controls,navigation:{galKeyboardFocus:() => false}})
  let state = {page:'status',pages,auto:false,skipping:false,atEnd:false}
  const reader = input.attach(() => state,action => sent.push(action))
  fire('keydown',{key:'a'}); fire('keydown',{key:'Control'})
  assert.equal(timers.length,0,'a held Ctrl starts no skip while a page is open')
  assert.deepEqual(sent,[])
  fire('keydown',{key:'Escape'})
  assert.deepEqual(sent,[{type:'page',open:false}])
  state = {...state,page:null}; sent.length = 0
  fire('keydown',{key:'s'})
  assert.deepEqual(sent.filter(action => action.type !== 'held'),[{type:'page',open:true,id:'status'}])
  reader.dispose()
  // showOn counts entries from text mode: galOpen bumps the visit, leaving does not.
  const documentStub = {documentElement:{setAttribute(){},removeAttribute(){}},querySelectorAll:() => [],fullscreenElement:null}
  const navigation = createStageNavigation({window:{},document:documentStub,navigator:{},playCue(){},getSessionId:() => 's',getSettings:() => null})
  const stop = navigation.galStageLifetime()
  assert.equal(navigation.visit(),0)
  navigation.galOpen('s'); navigation.galLeave(); navigation.galOpen('s')
  assert.equal(navigation.visit(),2)
  stop()
})

test('failed browser stage mount rolls back registrations and can be retried', () => {
  const require = createRequire(import.meta.url)
  const {startStageClientLifetime} = require('../tavern-plugin/packages/dsh-tavern-stage/lib/client/lifetime.cjs')
  const {createStageClientEntry} = require('../tavern-plugin/packages/dsh-tavern-stage/lib/client/entry.cjs')
  let count = 0, fail = true
  const host = createStageClientEntry({startLifetime:startStageClientLifetime, install:[
    () => {count++; return () => count--},
    () => {if (fail) throw new Error('startup failed')},
  ]})
  assert.throws(() => host.mount(), /startup failed/)
  assert.equal(count,0)
  fail = false
  const stop = host.mount()
  assert.equal(count,1)
  assert.throws(() => host.mount(), /already mounted/)
  stop(); stop()
  assert.equal(count,0)
  host.dispose()
  assert.throws(() => host.mount(), /disposed/)
})


test('activation and rollback errors stay diagnostic and do not reject host startup',async()=>{
  let cleanup
  const styles=new Set(),failures=[]
  const document={querySelector:()=>null,createElement:()=>({dataset:{},remove(){styles.delete(this);throw Error('cleanup failed')}}),
    head:{insertBefore:s=>styles.add(s),appendChild:s=>styles.add(s)}}
  const plugin=await loadStageClientPlugin({document,console:{error:(...args)=>failures.push(args)},window:{}})
  assert.doesNotThrow(()=>plugin.apply({provide(){},get:()=>({registrations:[()=>{throw Error('mount failed')}]}),effect:run=>cleanup=run()}))
  assert.equal(styles.size,0)
  assert.equal(failures.length,1)
  assert.equal(failures[0][1].name,'AggregateError')
  assert.equal(failures[0][1].errors[0].message,'mount failed')
  assert.equal(failures[0][1].errors[1].errors.length,2)
  assert.doesNotThrow(()=>cleanup())
})
