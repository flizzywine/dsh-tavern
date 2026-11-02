import test from 'node:test'
import assert from 'node:assert/strict'
import {createFigureRuntimes} from '../tavern-plugin/packages/dsh-tavern-stage/lib/figure-runtimes.js'
import {createExtensionRequests} from '../tavern-plugin/lib/domain/extension-requests.js'

test('figure runtimes attach before or after RPC startup without losing authority or file ownership', async () => {
  const runtimes = createFigureRuntimes(), requests = createExtensionRequests(), files = {available:() => true}
  const authority = {origin:'https://game.test'}
  const off = runtimes.register('model', {files, routes:{readModel:(args, auth, template, owner) => ({args,auth,template,same:owner === files})}})
  assert.equal(await runtimes.available('model'),true)
  runtimes.bind(requests)
  assert.deepEqual(await requests.call('readModel',{id:1},authority,true),{args:{id:1},auth:authority,template:true,same:true})
  assert.equal(requests.remoteRead('readModel'),false)
  assert.throws(() => runtimes.register('model',{}),/already registered/)
  off();off()
  assert.equal(requests.handles('readModel'),false)
  assert.equal(await runtimes.available('model'),false)
  runtimes.register('another',{routes:{late:() => 2}})
  assert.equal(await requests.call('late'),2)
  runtimes.dispose()
  assert.equal(requests.handles('late'),false)
  assert.throws(() => runtimes.register('another',{}),/disposed/)
})

test('runtime removal fences pending results and occupied methods remain reserved', async () => {
  const runtimes = createFigureRuntimes(), requests = createExtensionRequests({reserved:['core']})
  runtimes.bind(requests)
  assert.throws(() => runtimes.register('bad',{routes:{core(){}}}),/occupied/)
  let resolve
  const off = runtimes.register('model',{routes:{load:() => new Promise(done => {resolve=done})}})
  const result = requests.call('load')
  off();resolve('late')
  await assert.rejects(result,{code:'EXTENSION_UNAVAILABLE'})
})
