import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageMenu}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/menu.cjs')
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
