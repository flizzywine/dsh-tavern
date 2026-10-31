import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {createRequire} from 'node:module'
const {createStageNavigation} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/navigation.cjs')
function setup() {
  const gates = [], events = []
  const document = {fullscreenElement:null, documentElement:{requestFullscreen:async () => events.push('fullscreen')}, exitFullscreen:async () => events.push('exit')}
  const api = createStageNavigation({
    document, playCue:cue => events.push(cue),
    uncover:() => events.push('uncover'), checkSetup:() => new Promise(resolve => gates.push(resolve)),
  })
  return {api, gates, events, document}
}

test('disabled stage cannot enter; disposal closes it and invalidates pending admission across reload', async () => {
  const {api, gates, events, document} = setup()
  api.galEnter('a')
  assert.equal(gates.length,0)
  const stop = api.galStageLifetime()
  api.galEnter('a')
  gates[0](false); await Promise.resolve()
  assert.equal(api.galActive.get(),'a')
  document.fullscreenElement = {}
  api.galEnter('b')
  stop(); stop()
  assert.equal(api.galActive.get(),'')
  assert.equal(api.galEntering.get(),'')
  assert.equal(api.galStageAvailable.get(),false)
  assert.equal(events.filter(x => x === 'exit').length,1)
  assert.equal(events.filter(x => x === 'uncover').length,1)
  const stopNext = api.galStageLifetime()
  gates[1](false); await Promise.resolve()
  assert.equal(api.galActive.get(),'','old admission cannot reopen the new instance')
  stopNext()
})

test('only the latest entry request may open a stage', async () => {
  const {api,gates} = setup(), stop = api.galStageLifetime()
  api.galEnter('a'); api.galEnter('b')
  gates[0](false); await Promise.resolve()
  assert.equal(api.galActive.get(),'')
  assert.equal(api.galEntering.get(),'b')
  gates[1](false); await Promise.resolve()
  assert.equal(api.galActive.get(),'b')
  stop()
})


test('a stopped entry cannot open the delayed setup wizard or consume its offer', async () => {
  const source = readFileSync(new URL('../tavern-plugin/src/client/asset-pack-setup-ui.js', import.meta.url),'utf8')
  const start = source.indexOf('const stageSetup=')
  const end = source.indexOf('function useStageSetupAutoOpen',start)
  const setup = vm.runInNewContext(source.slice(start,end) + '\nstageSetup', {stageSetupReady:() => true})
  let finish, live = true, opened = 0
  const pending = setup.enter({service:{getStageSetupStatus:() => new Promise(resolve => {finish = resolve})}, path:'card',stageOn:true,
    open:() => opened++, current:() => live})
  live = false
  finish({shouldAutoOpen:true})
  assert.equal(await pending,false)
  assert.equal(opened,0)
  assert.equal(setup.offered('card'),false)
  assert.equal(setup.take('card'),false)
})

test('core navigation readers survive optional provider removal and replacement', () => {
  const calls = [], window = {navigator:{}}
  const document = {documentElement:{requestFullscreen:async () => {}},fullscreenElement:null}
  const bridge = vm.runInNewContext(readFileSync(new URL('../tavern-plugin/src/client/gal-stage-active.cjs',import.meta.url),'utf8') + '\n({bindStageNavigation,galStageLifetime,galActive,galStageAvailable,galEnter,galCurrentEntry,galHoldLeave,galLeave})', {
    window, document, forkUiSfx:{play:cue => calls.push(cue)}, stageSetupGate:() => null,
    tavernMainSessionId:() => 's',bubbleStore:{get:() => ({})},galUncover:null,
  })
  const snapshots = []
  const unsubscribe = bridge.galActive.subscribe(() => snapshots.push(bridge.galActive.get()))
  bridge.galEnter('absent')
  assert.equal(calls.length,0)
  for (let cycle=0; cycle<2; cycle++) {
    const unbind=bridge.bindStageNavigation(createStageNavigation,{sessions:{}})
    const stop=bridge.galStageLifetime()
    bridge.galEnter('s',{turn:2,para:3})
    assert.equal(bridge.galCurrentEntry().turn,2)
    assert.equal(bridge.galStageAvailable.get(),true)
    let finish
    const releaseHold=bridge.galHoldLeave(done => {finish=done;return true})
    bridge.galLeave()
    assert.equal(bridge.galActive.get(),'s')
    stop();unbind();releaseHold();finish()
    assert.equal(bridge.galActive.get(),'')
    assert.equal(bridge.galCurrentEntry(),null)
    assert.equal(bridge.galStageAvailable.get(),false)
  }
  assert.equal(snapshots.filter(value => value==='s').length,2)
  unsubscribe()
})
