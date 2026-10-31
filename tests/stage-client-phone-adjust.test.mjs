import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStagePhoneAdjust}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/phone-adjust.cjs')
for(const stop of ['unmount','dispose'])test(`phone long press and pointer callbacks cannot act after ${stop}`,()=>{
  const effects=[],timers=new Map(),listeners=new Map(),actions=[]
  let serial=0
  const win={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)}
  const panel={current:{ownerDocument:{defaultView:win},setAttribute(){},closest:()=>null,style:{},classList:{remove(){}}}}
  const module=createStagePhoneAdjust({
    React:{useRef:value=>({current:value}),useEffect:fn=>effects.push(fn),useLayoutEffect(){},createElement:(type,props)=>({type,props})},
    window:win,document:{},navigator:{},sizes:{max:150,step:5},pad:8,
    setTimeout:fn=>{timers.set(++serial,fn);return serial},clearTimeout:id=>timers.delete(id),cancelAnimationFrame(){},
  })
  const controls=module.useAdjust({unlocked:false,phoneBase:{size:100},bounds:{x:0,y:0,width:100,height:200},presentation:{}},{adjust:value=>actions.push(value)},panel,()=>actions.push('menu'))
  const releases=effects.map(fn=>fn())
  const event={button:0,pointerId:1,pointerType:'touch',clientX:10,clientY:10,stopPropagation(){},currentTarget:{}}
  controls.grips[0].props.onPointerDown(event)
  assert.equal(listeners.size,3)
  assert.equal(timers.size,1)
  const late=[...timers.values()],pointer=[...listeners.values()]
  if(stop==='dispose')module.dispose();else releases.forEach(fn=>fn?.())
  assert.equal(listeners.size,0)
  assert.equal(timers.size,0)
  late.forEach(fn=>fn());pointer.forEach(fn=>fn(event));controls.grips[0].props.onPointerDown(event)
  assert.deepEqual(actions,[])
  assert.equal(timers.size,0)
  releases.forEach(fn=>fn?.());module.dispose()
})
