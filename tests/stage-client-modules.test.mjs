import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url)
const factory = (file, name) => vm.runInNewContext(readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/lib/client/' + file + '.cjs', import.meta.url), 'utf8') + '\n' + name, {AbortController, Blob, Response, URL})

test('resource owner and runner compose without application globals or a module loader', async () => {
  const resources = factory('resources', 'createStageResourcesModule')()
  const {createStageResourceRunner} = factory('resource-runner', 'createStageResourceRunnerModule')({
    stageResourceMatches:resources.stageResourceMatches,
    stageRuntimeErrorText:require('../tavern-plugin/src/client/stage-runtime.cjs').stageRuntimeErrorText,
    ...require('../tavern-plugin/packages/dsh-presentation-protocol/src/performance-timeline.cjs'),
    ...require('../tavern-plugin/packages/dsh-presentation-protocol/src/performance-state.cjs'),
  })
  const released = [], revoked = []
  const owner = resources.createStageResourceOwner({
    service:{leaseMedia:async () => ({ticket:'t',url:'/media',revision:'v1'}),releaseLease:id => released.push(id)},
    fetch:async () => new Response('audio', {headers:{'content-type':'audio/wav'}}),
    urls:{createObjectURL: () => 'blob:test',revokeObjectURL:url => revoked.push(url)},
  })
  const pin = await owner.acquire({resource:true,kind:'media',ref:{packId:'p',kind:'music',assetId:'m'},hash:'h',identity:'p:h',revision:'v1'}, 'a')
  assert.equal(pin.handle.url, 'blob:test')
  assert.deepEqual(released, ['t'])
  const ready = [], played = []
  const runner = createStageResourceRunner({owner, clock:globalThis, read:async () => {throw new Error('unexpected read')},play:(id,value) => played.push([id,value.kind])})
  const token = {id:1}, descriptor = {kind:'title',text:'test'}
  runner.onEffect('a',{type:'prepare-one-shot',token,descriptor},event => ready.push(event.type),() => ({}))
  runner.onEffect('a',{type:'play-one-shot',token,descriptor},() => {},() => ({}))
  assert.deepEqual(ready, ['ONE_SHOT_READY'])
  assert.deepEqual(played, [['a','title']])
  runner.dispose()
  assert.deepEqual(revoked, ['blob:test'])
})

test('isolated director projects through its supplied protocol and discards a disposed read', async () => {
  const {createStageDirectorSource, projectStageDirection} = factory('director-source','createStageDirectorModule')({directorCommands:{recordOperation:op => ({op:'event',value:{op:op.kind}})}})
  const source = {sessionId:'s',turn:1}
  const value = {token:{digest:'d'},target:source,entries:[{ops:[{kind:'title'}]}]}
  assert.equal((await projectStageDirection(value,source)).entries[0].events[0].kind, 'title')
  let finish
  const events = []
  const director = createStageDirectorSource({read:() => new Promise(resolve => {finish = resolve}),watch:() => () => {}})
  director.runEffect('s',{type:'read-round',token:{id:1,source}},event => events.push(event),() => ({}))
  await Promise.resolve()
  director.dispose()
  finish(value)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events, [])
})
