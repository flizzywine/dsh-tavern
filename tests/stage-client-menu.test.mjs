import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageMenu}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/menu.cjs')
const {createStageControls}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/controls.cjs')
const {createStageInput}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/input.cjs')
test('stage menu preserves historical actions and keyboard focus wrapping',()=>{
 const menu=createStageMenu({})
 const items=menu.items({historical:true,latestTurn:5,controls:['skip'],atEnd:true})
 assert.equal(items.some(item=>item.id==='regenerate'),false)
 assert.equal(items.find(item=>item.id==='latest').note,'第 5 轮')
 assert.equal(items.find(item=>item.id==='skip').disabled,true)
 assert.equal(menu.step(0,4,'Tab',true),3)
 assert.equal(menu.step(3,4,'ArrowDown'),0)
 assert.equal(menu.step(2,4,'Home'),0)
})
test('stage menu disposal removes keyboard and director subscriptions before React unmount',()=>{
 const effects=[],listeners=new Map();let released=0,closed=0
 const React={createElement:(type,props,...children)=>({type,props,children}),useState:value=>[typeof value==='function'?value():value,()=>{}],useRef:value=>({current:value}),useMemo:fn=>fn(),useEffect:fn=>effects.push(fn),useLayoutEffect:fn=>effects.push(fn),useSyncExternalStore:(_,get)=>get()}
 const menu=createStageMenu({React,document:{activeElement:null,querySelectorAll:()=>[]},window:{addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)},sounds:{play(){}},getSession:()=>({select:()=>({subscribe(){},getSnapshot:()=>false,dispose(){released++}})})})
 menu.Menu({sessionId:'s',latestTurn:1,onClose:()=>closed++})
 const stops=effects.map(fn=>fn())
 const late=listeners.get('keydown')
 assert.equal(typeof late,'function')
 menu.dispose();menu.dispose()
 late({key:'Escape',preventDefault(){},stopImmediatePropagation(){}})
 assert.equal(listeners.size,0)
 assert.equal(released,1)
 assert.equal(closed,0)
 stops.forEach(fn=>fn?.())
 assert.equal(released,1)
})
test('stage menu labels are Chinese only and a touch screen gets no shortcut entry',()=>{
 const menu=createStageMenu({})
 const items=menu.items({controls:[]})
 assert.equal(items.some(item=>'sub' in item),false)
 assert.equal(items.some(item=>item.id==='keys'),true)
 assert.equal(menu.items({controls:[],touch:true}).some(item=>item.id==='keys'),false)
})

test('the 状态 row exists only with a status panel, after 履历 and the auto/skip rows, and a touch screen still has no keys row',()=>{
 const menu=createStageMenu({})
 const ids=options=>menu.items(options).map(item=>item.id)
 assert.equal(ids({controls:['auto','skip']}).includes('status'),false)
 assert.deepEqual(ids({controls:['auto','skip'],statusPanel:true}),['resume','backlog','auto','skip','status','gallery','regenerate','config','keys','leave'])
 assert.equal(menu.items({controls:['auto','skip'],statusPanel:true}).find(item=>item.id==='status').label,'状态')
 assert.deepEqual(ids({controls:[],statusPanel:true,touch:true}),['resume','backlog','status','gallery','regenerate','config','leave'])
})

test('the S shortcut is listed and handled only for a card with a status panel',()=>{
 const controls=createStageControls()
 assert.equal(controls.shortcuts().some(([,,action])=>action==='status'),false)
 assert.deepEqual(controls.shortcuts({statusPanel:true}).find(([,,action])=>action==='status'),['状态','S','status'])
 const listeners=[]
 const target={addEventListener(type,handler){listeners.push([type,handler])},removeEventListener(){}}
 const window=target, document={hidden:false,addEventListener(){},removeEventListener(){}}
 const input=createStageInput({React:{},window,document,clock:{setTimeout:()=>1,clearTimeout(){}},controls,navigation:{galKeyboardFocus:()=>false}})
 let state={statusPanel:false,status:false}
 const sent=[]
 const instance=input.attach(()=>state,action=>sent.push(action))
 const onKey=listeners.find(([type])=>type==='keydown')[1]
 const press=key=>onKey({key,preventDefault(){},stopImmediatePropagation(){},repeat:false,isComposing:false})
 press('s')
 assert.deepEqual(sent,[])
 state={statusPanel:true,status:false}
 press('s')
 assert.deepEqual(sent,[{type:'status',open:true}])
 state={statusPanel:true,status:true}
 press('Escape')
 press('s')
 assert.deepEqual(sent.slice(1),[{type:'status',open:false},{type:'status',open:false}])
 instance.dispose()
})
