import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageVideo} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/video.cjs')
test('plugin disposal releases every video and reclaims URLs arriving after unmount', async () => {
  const urls = [], revoked = [], released = [], timers = new Set()
  let finishLease
  const lease = new Promise(resolve => {finishLease=resolve})
  const nodes = []
  const doc = {createElement:type => {
    const attrs = new Map()
    const node = {type,dataset:{},style:{setProperty(){}},hidden:false,paused:true,
      setAttribute:(key,value) => attrs.set(key,value),getAttribute:key => attrs.get(key),
      removeAttribute:key => attrs.delete(key),append(){},remove(){this.removed=true},
      addEventListener(){},pause(){this.paused=true},load(){},play:async()=>{}}
    nodes.push(node)
    return node
  }}
  const host = {ownerDocument:doc,append(){}}
  const api = createStageVideo({
    getService:() => ({leaseBundle:() => lease,releaseLease:async ticket => released.push(ticket)}),
    fetch:async () => ({ok:true,blob:async () => ({})}),
    URL:{createObjectURL:() => {const url='blob:'+urls.length;urls.push(url);return url},revokeObjectURL:url => revoked.push(url)},
    setTimeout:fn => {timers.add(fn);return fn},clearTimeout:fn => timers.delete(fn),
  })
  const source = {packId:'p',bundleKey:'v',hash:'h',entry:'video.mp4',poster:'poster.png'}
  const a = api.player(host,source), b = api.player(host,source)
  api.dispose();api.dispose();a.dispose()
  assert.deepEqual(await Promise.all([a.ready,b.ready]),[false,false])
  assert.equal(a.state().status,'disposed')
  assert.equal(b.state().status,'disposed')
  assert.equal(timers.size,0)
  assert.equal(nodes.filter(node => node.type==='div' && node.removed).length,2)
  finishLease({ticket:'t',url:'/lease/t/'})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(urls.length,2,'both players share one video and poster read')
  assert.deepEqual([...revoked].sort(),[...urls].sort())
  assert.deepEqual(released,['t'])
  assert.throws(() => api.player(host,source),/disposed/)
})
