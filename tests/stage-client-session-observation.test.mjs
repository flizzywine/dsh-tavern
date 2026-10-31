import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageSessionObservation}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/session-observation.cjs')
function fixture({characters=[],failCleanup=false}={}){
 const calls=[],pending=[],listeners=new Set(),events=new Map(),packListeners=new Set();let selected='a',shown=null,display=false,disposedSelectors=0
 const subscribe=fn=>{listeners.add(fn);return ()=>listeners.delete(fn)}
 const state={source:{sessionId:'a',authorityEpoch:1,turn:1},latestSource:{turn:1},settings:{config:{}},textIndex:new Map([[1,{text:{pages:[{voice:'v',anchor:{paragraphId:1}}]}}]]),opened:true}
 const store={getSnapshot:()=>state,dispatch:event=>calls.push(event.type),select:()=>({subscribe,dispose(){disposedSelectors++;if(failCleanup)throw Error('selector cleanup')}})}
 const media=Object.fromEntries(['music','background','ambience'].map(key=>[key,{activate:id=>calls.push([key,id]),invalidate:()=>calls.push([key,'invalidate']),kick(){},resume(){}}]))
 const input={owner:{get:id=>id==='a'?store:null},resources:{invalidate:id=>calls.push(['invalidate',id]),suspend:id=>calls.push(['suspend',id]),revoke:id=>calls.push(['revoke',id])},
 resourceOwner:{acquire:()=>new Promise(resolve=>pending.push(resolve)),invalidateDerived:()=>calls.push('derived')},
 selection:{current:()=>selected,list:{subscribe,getSnapshot:()=>({byId:{a:{}}})}},settings:{subscribe,get:()=>({config:{characters}})},
 packs:{subscribe:fn=>{packListeners.add(fn);return ()=>packListeners.delete(fn)},runtimeChanged:subscribe},
 entry:{hasDisplay:()=>display,entering:()=>false,shown:{subscribe,get:()=>shown}},
 voice:{available:()=>true,handle:()=>({prefetch:()=>calls.push('voice')}),retain(){}},
 portraits:{select:id=>calls.push(['portraits',id]),revision(){},get(){},prepare:()=>calls.push('prepare')},media,
 document:{hidden:false,addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:key=>events.delete(key)}}
 return {scope:createStageSessionObservation(input),input,calls,pending,listeners,events,packListeners,store,get disposedSelectors(){return disposedSelectors},show(value){display=value;shown=value?store:null;for(const fn of [...listeners])fn()}}
}
test('session policies continue in chat, revoke on deletion but only suspend on transport loss',()=>{
 const f=fixture();f.scope.start();f.scope.start()
 assert.ok(f.calls.includes('voice'));assert.ok(f.calls.some(x=>Array.isArray(x)&&x[0]==='music'&&x[1]==='a'))
 f.show(true);f.show(false)
 assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='music'&&x[1]===null),false)
 for(const fn of f.packListeners)fn({type:'unavailable'})
 assert.ok(f.calls.some(x=>x[0]==='suspend'));assert.equal(f.calls.some(x=>x[0]==='revoke'),false)
 for(const fn of f.packListeners)fn({packId:'p',revision:null})
 assert.ok(f.calls.includes('derived'));assert.ok(f.calls.some(x=>x[0]==='revoke'))
 f.scope.dispose();assert.equal(f.listeners.size,0);assert.equal(f.events.size,0);assert.equal(f.packListeners.size,0)
})
test('dispose releases late avatar pins, drains queued work without acquiring and fences captured callbacks',async()=>{
 const characters=[1,2,3].map(n=>({avatarMedia:{default:{ref:{packId:'p',id:n},revision:1}}}))
 const f=fixture({characters});f.scope.start();assert.equal(f.pending.length,2)
 const late=[...f.listeners,...f.packListeners,...f.events.values()];f.scope.dispose()
 const count=f.calls.length;for(const fn of late)fn();assert.equal(f.calls.length,count)
 let releases=0;for(const resolve of f.pending)resolve({handle:{url:'blob:test'},release:()=>releases++})
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal(releases,2);assert.equal(f.pending.length,2);assert.equal(f.calls.includes('prepare'),false)
})
test('selector cleanup errors do not leave other observers or media active',()=>{
 const f=fixture({failCleanup:true});f.scope.start()
 assert.throws(()=>f.scope.dispose(),/cleanup failed/)
 assert.equal(f.disposedSelectors,2);assert.equal(f.listeners.size,0);assert.equal(f.events.size,0);assert.equal(f.packListeners.size,0)
 for(const key of ['music','background','ambience'])assert.ok(f.calls.some(x=>x[0]===key&&x[1]===null))
 f.scope.dispose()
})
test('partial startup rolls back subscriptions and already selected media',()=>{
 const f=fixture();f.input.media.ambience.activate=id=>{if(id)throw Error('media unavailable')}
 assert.throws(()=>f.scope.start(),/media unavailable/)
 assert.equal(f.listeners.size,0);assert.equal(f.events.size,0);assert.equal(f.packListeners.size,0)
 assert.ok(f.calls.some(x=>x[0]==='music'&&x[1]===null));f.scope.dispose()
})
