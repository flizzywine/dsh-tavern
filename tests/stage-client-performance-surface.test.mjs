import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const {createStagePerformanceSurface}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/performance-surface.cjs')
function fixture({failRatio=false,failStop=false}={}){
 const dom=new JSDOM('<!doctype html><div id="root"></div>'),{window}=dom,document=window.document,root=document.getElementById('root')
 const frames=new Map();let serial=0,stops=0,changes=0,receipts=0
 const clock={now:()=>0,requestAnimationFrame:fn=>{const id=++serial;frames.set(id,fn);return id},cancelAnimationFrame:id=>frames.delete(id)}
 const surface=createStagePerformanceSurface({window,document,clock,resolution:()=>1,subscribeResolution:()=>{if(failRatio)throw Error('ratio unavailable');return ()=>{stops++;if(failStop)throw Error('ratio cleanup')}},policy:{},sessions:()=>({}),runtime:{}})
 const options={root,owner:{},foreground:clock,rects:{subscribe:()=>()=>stops++,getSnapshot:()=>({screen:{w:100,h:100}})},onChange:()=>changes++,onPresented:()=>receipts++}
 return {surface,root,options,frames,get stops(){return stops},get changes(){return changes},get receipts(){return receipts},close(){surface.dispose();dom.window.close()}}
}
test('plugin owns surface nodes and cancels late presentation receipts independently of React',async()=>{
 const f=fixture();try{
 const layer=f.surface.createSkinLayer(f.options);assert.equal(f.root.children.length,3)
 await layer.apply({type:'layer',value:{instanceKey:'a',dependencies:[],phase:'entry'},layer:{},snap:true})
 assert.equal(f.frames.size,1);const late=[...f.frames.values()][0]
 f.surface.dispose();assert.equal(f.root.children.length,0);assert.equal(f.frames.size,0);assert.equal(f.stops,2)
 late();assert.equal(f.frames.size,0);assert.equal(f.receipts,0)
 const changes=f.changes;await layer.apply({type:'clear'});assert.equal(f.changes,changes)
 assert.throws(()=>f.surface.createSkinLayer(f.options),/disposed/)
 }finally{f.close()}
})
test('partial performance construction removes appended canvases and installed observers',()=>{
 const f=fixture({failRatio:true});try{
 assert.throws(()=>f.surface.createSkinLayer(f.options),/ratio unavailable/)
 assert.equal(f.root.children.length,0);assert.equal(f.stops,1)
 }finally{f.close()}
})
test('one observer cleanup failure does not leave either performance instance mounted',()=>{
 const f=fixture({failStop:true});try{
 f.surface.createSkinLayer(f.options);f.surface.createSkinLayer(f.options)
 assert.throws(()=>f.surface.dispose(),/cleanup failed/);assert.equal(f.root.children.length,0);assert.equal(f.stops,4)
 }finally{f.close()}
})

test('font preparation borrows the shared library and does not start a late document load after disposal',async()=>{
 let finish,loads=0
 const surface=createStagePerformanceSurface({document:{fonts:{load:()=>{loads++;return Promise.resolve()}}},fonts:{ensure:()=>new Promise(resolve=>finish=resolve),get:()=>({family:'shared'})}})
 const work=surface.prepare({dependencies:[{document:{keyframes:{layers:[{text:{font:'f',size:24,value:'line'}}]}}}]})
 surface.dispose();finish();await work;assert.equal(loads,0)
 await assert.rejects(surface.prepare({dependencies:[]}),/disposed/)
})
