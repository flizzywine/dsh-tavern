import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const load=(file,name)=>require('../tavern-plugin/packages/dsh-tavern-stage/src/client/'+file+'.cjs')[name]
const createDisplay=load('danmaku-display','createStageDanmakuDisplay'),createScheduler=load('danmaku-scheduler','createStageDanmakuScheduler'),createSession=load('danmaku-session','createStageDanmakuSession'),createAvatar=load('danmaku-avatar','createStageDanmakuAvatar'),createRoom=load('danmaku-liveroom','createStageLiveroom'),createRenderer=load('danmaku-renderer','createStageDanmaku')
function fixture(){
 const dom=new JSDOM('<div id="root"></div><div id="column"></div><div id="below"></div>'),window=dom.window,document=window.document
 window.HTMLCanvasElement.prototype.getContext=()=>null
 Object.defineProperty(document,'timeline',{value:{currentTime:1000}})
 const timers=new Map(),frames=new Map(),animations=[],images=[];let id=0,now=1000
 window.Element.prototype.animate=function(){const a={cancelled:false,pause(){},play(){},cancel(){this.cancelled=true},finished:new Promise(()=>{})};animations.push(a);return a}
 const clock={now:()=>now,setTimeout:fn=>{timers.set(++id,fn);return id},clearTimeout:key=>timers.delete(key)}
 const Image=class{constructor(){images.push(this)}}
 const display=createDisplay(),scheduler=createScheduler(display),session=createSession(display),renderers={}
 const liveroom=createRoom({spark:display.danmakuSparkPaths,count:display.danmakuCount,price:display.danmakuPrice,...clock})
 const manager=createRenderer({display,scheduler,session,liveroom,createAvatar,renderers,window,Image,getComputedStyle:window.getComputedStyle.bind(window),...clock,performance:{now:clock.now},requestAnimationFrame:fn=>{frames.set(++id,fn);return id},cancelAnimationFrame:key=>frames.delete(key)})
 return {window,document,timers,frames,animations,images,session,renderers,manager,root:document.getElementById('root'),clock,advance:t=>{now=t},close(){manager.dispose();liveroom.dispose();session.dispose();window.close()}}
}
const comment={id:'one',text:'<b>你好</b>',author:'观众',offsetMs:0,durationMs:6500}
const view=(kind,extra={})=>({version:1,modId:'dsh.danmaku',view:kind,mode:'live',active:true,activeTimeMs:1000,settings:{},batches:[{offsetMs:0,heat:50,heatExpiresAtMs:10000,online:100,comments:[comment,{...comment,id:'future',offsetMs:5000}]}],...extra})
const args=f=>({root:f.root,viewport:{width:800,height:600,safeRegions:[]},budget:{maxNodes:2000},context:{sessionId:'session'},clock:f.clock})
test('overlay preserves text and flight history; unload cancels work and unregisters renderers',()=>{
 const f=fixture()
 try{
 const layer=f.renderers['dsh.danmaku/view/overlay.js'](args(f));layer.update(view('overlay'))
 assert.equal(layer.stats().visible,1)
 assert.equal(f.root.querySelector('.fork-dm-item').textContent,comment.text)
 assert.equal(f.root.querySelector('.fork-dm-item b'),null)
 assert.ok(f.timers.size>0)
 const late=[...f.timers.values()],finish=f.animations[0].onfinish
 layer.dispose();assert.equal(f.root.children.length,0);assert.equal(f.timers.size,0)
 const second=f.manager.create(args(f));second.update(view('overlay'));assert.equal(second.stats().visible,0)
 f.manager.replay('session',true,'replay');second.update(view('overlay',{page:{visit:'old'}}));assert.equal(second.stats().visible,0)
 second.update(view('overlay',{page:{visit:'replay'}}));assert.equal(second.stats().visible,1)
 f.manager.dispose();assert.deepEqual(Object.keys(f.renderers),[])
 for(const fn of late)fn();finish();second.update(view('overlay'))
 assert.equal(f.timers.size,0);assert.equal(f.root.children.length,0)
 assert.ok(f.animations.every(a=>a.cancelled))
 assert.throws(()=>f.manager.create(args(f)),/disposed/)
 }finally{f.close()}
})
test('sidebar owns dock, avatar callbacks, timers, frames and detached input handlers',()=>{
 const f=fixture();let releases=0
 try{
 const column=f.document.getElementById('column'),below=f.document.getElementById('below')
 const layer=f.manager.create({...args(f),layer:'sidebar',dock:request=>{if(!request){releases++;return null}return {column,below}}})
 layer.update(view('sidebar',{streamer:{name:'主播',avatar:{src:'/avatar.png',crop:{x:0,y:0,w:1,h:1}}}}))
 assert.equal(layer.stats().rows,1);assert.equal(layer.stats().docked,true)
 assert.ok(below.querySelector('.fork-lr'));assert.ok(f.timers.size>0);assert.ok(f.frames.size>0)
 const latest=column.querySelector('.fork-dm-latest'),late=[...f.timers.values(),...f.frames.values()],image=f.images[0],onload=image.onload
 assert.ok(onload);const previous=latest.hidden
 f.manager.dispose()
 assert.equal(releases,1);assert.equal(column.children.length,0);assert.equal(below.children.length,0)
 assert.equal(f.timers.size,0);assert.equal(f.frames.size,0);assert.equal(image.onload,null)
 for(const fn of late)fn();onload();latest.dispatchEvent(new f.window.Event('click'))
 assert.equal(latest.hidden,previous);assert.equal(f.timers.size,0)
 }finally{f.close()}
})
test('scheduler avoids occupied safe regions and never overlaps concurrent placements',()=>{
 const display=createDisplay(),s=createScheduler(display)
 const lanes=s.danmakuLanes({width:800,height:600,laneHeight:30,safeRegions:[{x:0,y:400,width:800,height:200}]})
 assert.ok(lanes.every(l=>l.y+l.height<=396))
 const plan=s.danmakuPlan(Array.from({length:20},(_,i)=>({...comment,id:String(i),offsetMs:i*150})),[],3000,{viewWidth:800,lanes,lower:[],size:()=>({w:200,h:26}),warm:false,room:32})
 assert.ok(plan.place.length>1)
 for(let i=0;i<plan.place.length;i++)for(let j=i+1;j<plan.place.length;j++)assert.equal(s.danmakuClear(plan.place[i].motion,plan.place[j].motion),true)
})
