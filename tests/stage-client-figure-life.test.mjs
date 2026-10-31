import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {EventEmitter} from 'node:events'
const require=createRequire(import.meta.url)
const load=(file,name)=>require('../tavern-plugin/packages/dsh-tavern-stage/src/client/'+file+'.cjs')[name]
const createIdle=load('figure-idle','createStageFigureIdle'),createGeometry=load('figure-geometry','createStageFigureGeometry'),createTap=load('figure-tap','createStageFigureTap'),createWarp=load('figure-warp','createStageFigureWarp')
const {galSpring:spring,galSpringValue:springValue}=require('../tavern-plugin/src/client/gal-scene-helpers.cjs')
test('figure idle retains deterministic rhythms and restores runtime desync on unload',()=>{
 const idle=createIdle({spring,springValue}),seed=idle.galIdleSeed('figure',0.4)
 const a=idle.galIdleState(seed),b=idle.galIdleState(seed),other=idle.galIdleState(idle.galIdleSeed('another',0.4))
 for(let i=0;i<600;i++){
 const frame=idle.galStaticIdleStep(a,1/60,true)
 assert.deepEqual(frame,idle.galStaticIdleStep(b,1/60,true))
 assert.ok(frame.scaleY>=1 && frame.scaleY<=1.003)
 }
 assert.notEqual(a.phase,other.phase)
 const frame=idle.galLive2dIdleStep(other,1/60,true,true)
 assert.equal(frame.ParamEyeBallX,0);assert.equal(frame.ParamEyeBallY,0)
 const internal=new EventEmitter(),params=[{cycle:4}]
 internal.breath={_currentTime:1,getParameters:()=>params,setParameters(value){this.params=value}}
 internal.eyeBlink={_blinkingIntervalSeconds:4,setBlinkingInterval(value){this._blinkingIntervalSeconds=value}}
 idle.galLive2dDesync(internal,a.jitter)
 assert.notEqual(internal.breath.params,params);assert.equal(internal.listenerCount('destroy'),1)
 idle.dispose();idle.dispose()
 assert.equal(internal.breath.params,params);assert.equal(internal.breath._currentTime,1)
 assert.equal(internal.eyeBlink._blinkingIntervalSeconds,4);assert.equal(internal.listenerCount('destroy'),0)
 assert.equal(internal.breath.forkDesynced,undefined)
})
test('figure taps preserve deliberate double tap, drag rejection and reduced motion',()=>{
 const tap=createTap({geometry:createGeometry()}),tracker=tap.galTapTracker()
 const pointer={pointerId:1,isPrimary:true,button:0,clientX:10,clientY:10}
 tap.galTapPointer(tracker,{...pointer,type:'pointerdown',timeStamp:10})
 tap.galTapPointer(tracker,{...pointer,type:'pointerup',timeStamp:100})
 assert.equal(tap.galTapDeliberate(tracker,{button:0,timeStamp:101}),true)
 tap.galTapPointer(tracker,{...pointer,type:'pointerdown',timeStamp:200})
 tap.galTapPointer(tracker,{...pointer,type:'pointermove',clientX:40,timeStamp:250})
 tap.galTapPointer(tracker,{...pointer,type:'pointerup',timeStamp:280})
 assert.equal(tap.galTapDeliberate(tracker,{button:0,timeStamp:281}),false)
 const arm=tap.galTapArmState()
 assert.deepEqual(tap.galTapArm(arm,'figure',10,10,100),{claim:false,armed:false})
 assert.deepEqual(tap.galTapArm(arm,'figure',10,10,300),{claim:true,armed:true})
 assert.equal(tap.galTapArmed(arm,'figure',600),true);assert.equal(tap.galTapArmed(arm,'figure',6000),false)
 assert.deepEqual(tap.galTapFrame({start:0,region:'head',kind:'happy'},100,true),{scaleX:1,scaleY:1,dx:0,tilt:0,flinch:0})
 tap.dispose()
})
test('tap hit tests release temporary GPU textures even when extraction fails',()=>{
 const tap=createTap({geometry:createGeometry()});let destroyed=0
 const renderer={generateTexture:()=>({destroy(){destroyed++}}),plugins:{extract:{pixels(){throw new Error('read failed')}}}}
 assert.throws(()=>tap.galTapProbe({}, {x:3,y:5},renderer,{Rectangle:class{}}),/read failed/)
 assert.equal(destroyed,1);tap.dispose()
})
test('figure warp owns filter destruction and fences stale render callbacks',()=>{
 let destroyed=0,applied=0
 class Filter{constructor(vertex,fragment,uniforms){this.uniforms=uniforms}apply(){applied++}destroy(){destroyed++}}
 const warp=createWarp(),filter=warp.galWarpFilter({Filter}),late=filter.apply
 filter.apply();assert.equal(applied,1)
 warp.dispose();filter.destroy();late.call(filter)
 assert.equal(destroyed,1);assert.equal(applied,1)
 assert.throws(()=>warp.galWarpFilter({Filter}),/disposed/)
})
const createMotionMath=load('figure-motion-math','createStageFigureMotionMath'),createMotion=load('figure-motion','createStageFigureMotion')
function motionFixture(){
 let stopped=0,started=0,resolve,updates=0
 class Queue{setEventCallback(fn){this.callback=fn}stopAllMotions(){stopped++}startMotion(){started++}}
 const manager={queueManager:new Queue(),groups:{idle:'Idle'},definitions:{Gesture:[{}]},emit(){},
 startMotion(){return true},update(){updates++},stopAllMotions(){},createMotion(data){return data},loadMotion(){return new Promise(r=>{resolve=r})}}
 const internal=new EventEmitter(),values=new Float32Array([0])
 internal.motionManager=manager;internal.update=()=>{updates++}
 internal.coreModel={getModel:()=>({parameters:{values,ids:['ParamAngleX']},parts:{ids:[]}})}
 const math=createMotionMath({spring,fade:n=>Math.max(0.45,n||0)}),motion=createMotion({math,lipSyncIds:()=>['ParamMouthOpenY']})
 return {internal,manager,motion,resolve:value=>resolve(value),stopped:()=>stopped,started:()=>started,updates:()=>updates}
}
test('motion adapter restores runtime methods and fences pending clips on unload',async()=>{
 const f=motionFixture(),original=f.manager.startMotion,update=f.internal.update
 f.motion.install(f.internal)
 const state=f.manager.forkMotionLayers,lateUpdate=f.internal.update,lateStop=f.manager.stopAllMotions
 assert.equal(f.internal.listenerCount('beforeMotionUpdate'),1)
 const pending=f.manager.startMotion('Gesture',0,2)
 f.motion.dispose();f.motion.dispose()
 assert.equal(state.dead,true);assert.equal(f.manager.startMotion,original);assert.equal(f.internal.update,update)
 assert.equal(f.manager.forkMotionLayers,undefined);assert.equal(f.manager.stopMoodMotion,undefined)
 assert.equal(f.internal.eventNames().length,0)
 lateUpdate(16,100);lateStop();f.resolve({})
 assert.equal(await pending,false);assert.equal(f.started(),0);assert.equal(f.updates(),0)
})
test('motion adapter handles model destruction and rolls back failed setup',()=>{
 const f=motionFixture(),original=f.manager.update
 f.motion.install(f.internal);f.internal.emit('destroy')
 assert.equal(f.manager.update,original);assert.equal(f.internal.eventNames().length,0)
 f.motion.dispose()
 const broken=motionFixture(),start=broken.manager.startMotion,update=broken.internal.update
 delete broken.manager.definitions
 assert.throws(()=>broken.motion.install(broken.internal))
 assert.equal(broken.manager.startMotion,start);assert.equal(broken.internal.update,update)
 assert.equal(broken.manager.forkMotionLayers,undefined);assert.equal(broken.internal.eventNames().length,0)
 broken.motion.dispose()
})
test('motion copies preserve cached clips and discrete switches bypass blending',()=>{
 const math=createMotionMath({spring,fade:n=>Math.max(0.45,n||0)})
 const source={_motionData:{curves:[{type:2,id:'arm',fadeInTime:1,fadeOutTime:1},{type:1,id:'ParamAngleX',fadeInTime:0.1,fadeOutTime:0.2}]},
 setIsLoop(value){this.loop=value},getFadeInTime:()=>0.1,getFadeOutTime:()=>0.2,setFadeInTime(value){this.fadeIn=value},setFadeOutTime(value){this.fadeOut=value},setFinishedMotionHandler(value){this.handler=value}}
 const motion=math.galMotionClone(source,true,new Map(),true)
 assert.equal(motion.loop,true);assert.equal(source.loop,undefined)
 assert.equal(motion._motionData.curves[0].type,1);assert.equal(source._motionData.curves[0].type,2)
 assert.equal(motion._motionData.curves[0].fadeInTime,0);assert.equal(motion._motionData.curves[1].fadeInTime,-1)
 assert.equal(motion.fadeIn,0);assert.equal(math.galGestureWeight(0,1),0);assert.equal(math.galGestureWeight(0.5,1),1);assert.equal(math.galGestureWeight(1,1),0)
})
