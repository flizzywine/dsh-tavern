import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const {createStageModSurface}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/mod-surface.cjs')
const timing=require('../tavern-plugin/src/client/stage-auto-timing.cjs')
function fixture(extra={}) {
 const dom=new JSDOM('<!doctype html><main><div id="stage"></div></main>'),{window}=dom,root=window.document.getElementById('stage')
 const tasks=new Map();let serial=0
 window.setTimeout=fn=>{tasks.set(++serial,fn);return serial};window.clearTimeout=id=>tasks.delete(id)
 const plugin=createStageModSurface({window,document:window.document,timing:{validate:timing.validateStagePerformanceTiming,overlaps:timing.stagePerformanceRegionsOverlap},...extra})
 return {plugin,window,root,tasks,close(){plugin.dispose();window.close()}}
}
const definition={kind:'test',regions:['screen'],autoHold:{minMs:50,until:'complete'},media:()=>({image:{}})}
const descriptor={kind:'mod-performance',performance:{kind:'test',id:'one',source:{}}},token={id:'one',source:{turn:1}}
test('plugin stop settles pending Mod presentation and releases late media without reviving it',async()=>{
 const f=fixture();let finish,released=0,created=0,shown=[]
 try {
 const surface=f.plugin.createSurface({definitions:[definition],readMedia:()=>new Promise(resolve=>finish=resolve),createURL:()=>{created++;return 'blob:test'},revokeURL(){},onChange:rows=>shown.push(rows.length)})
 surface.reset(true);const pending=surface.play(descriptor,token)
 f.plugin.dispose();await pending
 finish({pin:{release:()=>released++}});await Promise.resolve();await Promise.resolve()
 assert.equal(released,1);assert.equal(created,0);assert.equal(shown.at(-1),0);assert.equal(f.tasks.size,0)
 surface.reset(true);await surface.play(descriptor,token);assert.equal(created,0)
 }finally{f.close()}
})
