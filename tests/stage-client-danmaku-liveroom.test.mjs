import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {JSDOM} from 'jsdom'
const {createStageLiveroom}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/danmaku-liveroom.cjs')
const model={online:10,peak:20,delta:1,trend:[],rate:4,total:20,buckets:[1],heat:30,rank:5,likes:2,follows:1,captains:0,revenue:0,top:[],events:[]}
const context={name:'主播',live:'直播中',history:false,uptime:'01:02',turn:'1',scene:'客厅',bgm:'',warn:'',cold:false,reduced:false,paintFace(){}}
test('liveroom uses recorded snapshots without borrowing unrelated history',()=>{
 const room=createStageLiveroom({}),shown={sessionId:'a',sequence:2},next={sessionId:'a',sequence:3}
 assert.equal(room.snapshot({batches:[{offsetMs:100,metrics:next}],mode:'history'},0,shown),shown)
 assert.equal(room.snapshot({batches:[{offsetMs:100,metrics:next}],mode:'history'},100,shown),next)
 assert.equal(room.snapshot({batches:[],mode:'history'},0,shown),null)
 assert.equal(room.snapshot({batches:[{offsetMs:100,metrics:next}],mode:'history'},0,{...shown,sessionId:'b'}),null)
 assert.equal(room.model(null),null)
 room.dispose()
})
test('liveroom owns dashboard nodes, toast timers and animations across disposal',()=>{
 const dom=new JSDOM(''),timers=new Map(),animations=[];let id=0
 dom.window.Element.prototype.animate=function(){const animation={finished:new Promise(()=>{}),cancelled:false,cancel(){this.cancelled=true}};animations.push(animation);return animation}
 const room=createStageLiveroom({spark:()=>({line:'',area:''}),count:String,price:n=>'¥'+n,setTimeout:fn=>{timers.set(++id,fn);return id},clearTimeout:key=>timers.delete(key)})
 try{
 for(const layout of ['band','float']){
 const dashboard=room.create(dom.window.document,layout);dom.window.document.body.append(dashboard.node)
 dashboard.paint(null,context)
 assert.equal(dashboard.node.dataset.empty,'true')
 assert.equal(dashboard.node.querySelector('.fork-lr-roll').getAttribute('aria-label'),'—')
 dashboard.paint(model,context)
 dashboard.paint({...model,rank:4,events:[{id:'event',kind:'follow',author:'观众',value:1}]},context)
 assert.equal(dashboard.node.getAttribute('aria-label'),'主播')
 assert.equal(dashboard.node.querySelector('.fork-lr-live-time').textContent,'01:02')
 }
 assert.equal(timers.size,1);assert.ok(animations.length>0)
 const late=[...timers.values()]
 room.dispose();room.dispose()
 assert.equal(timers.size,0);assert.equal(dom.window.document.body.children.length,0)
 assert.ok(animations.every(a=>a.cancelled))
 for(const callback of late)callback()
 assert.throws(()=>room.create(dom.window.document,'float'),/disposed/)
 }finally{room.dispose();dom.window.close()}
})
