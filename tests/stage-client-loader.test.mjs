import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageLoader} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/loader.cjs')
const skin = {ref:{packId:'p'},bundleKey:'v',document:{art:{spinner:{image:'a.png'}}}}
function fixture(decodeImage = async () => ({width:10,height:20})) {
  const released = [], revoked = [], signals = []
  const loader = createStageLoader({
    getService:() => ({leaseBundle:async () => ({ticket:'t',url:'/lease/t/'}),releaseLease:async ticket => released.push(ticket)}),
    fetch:async (_,options) => {signals.push(options.signal);return {ok:true,blob:async () => ({})}},
    URL:{createObjectURL:() => 'blob:a',revokeObjectURL:url => revoked.push(url)},AbortController,
    decodeImage,spinnerArt:(_,images) => images,
  })
  return {loader,released,revoked,signals}
}
test('loader shares reads and releases its lease and cached URLs on disposal', async () => {
  const {loader,released,revoked,signals} = fixture()
  const key = loader.key(skin), first = loader.read(key,skin)
  assert.equal(loader.read(key,skin),first)
  assert.equal((await first)['a.png'].width,10)
  assert.deepEqual(released,['t'])
  assert.deepEqual(revoked,[])
  loader.dispose();loader.dispose()
  assert.deepEqual(revoked,['blob:a'])
  assert.equal(signals[0].aborted,true)
  assert.equal(loader.has(key),false)
  await assert.rejects(loader.read(key,skin),/disposed/)
})
test('late decode after unload cannot publish art and still releases the lease', async () => {
  let resolveDecode, decoding
  const started = new Promise(resolve => {decoding=resolve})
  const {loader,released,revoked} = fixture(() => {decoding();return new Promise(resolve => {resolveDecode=resolve})})
  const key = loader.key(skin), read = loader.read(key,skin)
  await started
  loader.dispose()
  resolveDecode({width:10,height:20})
  await assert.rejects(read,/disposed/)
  assert.equal(loader.has(key),false)
  assert.deepEqual(revoked,['blob:a'])
  assert.deepEqual(released,['t'])
})
test('decode failure revokes allocated URL and permits a subsequent read', async () => {
  let fail = true
  const {loader,revoked,released} = fixture(async () => {if(fail) throw new Error('decode failed');return {width:1,height:1}})
  const key = loader.key(skin)
  await assert.rejects(loader.read(key,skin),/decode failed/)
  assert.deepEqual(revoked,['blob:a'])
  fail = false
  assert.equal((await loader.read(key,skin))['a.png'].width,1)
  assert.deepEqual(released,['t','t'])
  loader.dispose()
})
