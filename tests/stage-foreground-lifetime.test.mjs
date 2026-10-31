import test from 'node:test'
import assert from 'node:assert/strict'
import {createForegroundCapabilities} from '../tavern-plugin/lib/domain/foreground-capabilities.js'
import {normalizeBubbleConfig} from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}
const chat=()=>({id:'chat',sessionId:'game',mode:'story',cardPath:'cards/a.json',messages:[]})
const book={view:{entries:[{ref:'author',content:'keep'},{ref:'stage',foregroundCapability:true,content:'drop'}]}}
const render=async(_chat,book)=>({renderedEntries:book.view.entries.map(row=>({ref:row.ref,text:row.content})),diagnostics:[]})

test('foreground projection disposed during configuration read leaves ordinary content and does not save',async()=>{
  const gate=deferred(),current=chat()
  const owner=createForegroundCapabilities({session:()=>null,readConfig:()=>gate.promise,render,save(){assert.fail('late save')}})
  const pending=owner.project(current,book)
  owner.dispose();gate.resolve(normalizeBubbleConfig({enabled:false}))
  assert.deepEqual((await pending).view.entries,[book.view.entries[0]])
  assert.equal(current.foregroundCapabilities,undefined)
  assert.deepEqual(await owner.preview(current),[])
  assert.equal(await owner.rosterAddendum(current),'')
  await assert.rejects(owner.refresh(current,[]),{code:'STAGE_UNAVAILABLE'})
})

test('foreground snapshot publication checks disposal at the storage boundary',async()=>{
  const gate=deferred();let entered=false,published=false
  const owner=createForegroundCapabilities({session:()=>null,readConfig:async()=>normalizeBubbleConfig({enabled:false}),render,
    save:async(_chat,_snapshot,options)=>{entered=true;await gate.promise;options.assertCurrent();published=true}})
  const current=chat(),pending=owner.project(current,book)
  await new Promise(resolve=>setImmediate(resolve));assert.equal(entered,true)
  owner.dispose();gate.resolve()
  assert.deepEqual((await pending).view.entries,[book.view.entries[0]])
  assert.equal(published,false);assert.equal(current.foregroundCapabilities,undefined)
})
