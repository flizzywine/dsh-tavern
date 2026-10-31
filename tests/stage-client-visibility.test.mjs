import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../tavern-plugin/src/client/gal-stage-active.cjs', import.meta.url),'utf8')
function setup() {
  const gates = [], events = []
  const document = {fullscreenElement:null, documentElement:{requestFullscreen:async () => events.push('fullscreen')}, exitFullscreen:async () => events.push('exit')}
  const api = vm.runInNewContext(source + '\n({galStageAvailable, galStageLifetime, galEnter, galActive, galEntering, galLeaveNow})', {
    document, forkUiSfx:{play:cue => events.push(cue)},
    galUncover:() => events.push('uncover'), stageSetupGate:() => new Promise(resolve => gates.push(resolve)),
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
