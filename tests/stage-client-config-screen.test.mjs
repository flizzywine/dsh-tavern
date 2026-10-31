import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageConfigScreen}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/config-screen.cjs')
test('config mounts only selected tab and cleans listeners before late mod results',async()=>{
  const effects=[],listeners=new Map(),mediaListeners=new Set(),writes=[]
  let resolve,closed=0,reads=0
  const view=createStageConfigScreen({
    React:{useState:value=>[typeof value==='function'?value():value,next=>writes.push(next)],useRef:value=>({current:value}),useEffect:fn=>effects.push(fn),createElement:(type,props,...children)=>({type,props,children})},
    window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},document:{},
    matchMedia:()=>({matches:true,addEventListener:(_,fn)=>mediaListeners.add(fn),removeEventListener:(_,fn)=>mediaListeners.delete(fn)}),
    rpc:()=>{reads++;return new Promise(done=>resolve=done)},sections:{},useSounds(){},Sound:'sound-tab',Text:'text-tab',Appearance:'screen-tab',
  })
  view.select('text')
  const tree=view.Screen({sessionId:'s',onClose:()=>closed++})
  const types=[]
  function walk(node){if(!node||typeof node!=='object')return;if(Array.isArray(node))return node.forEach(walk);types.push(node.type);node.children?.forEach(walk)}
  walk(tree)
  assert.ok(types.includes('text-tab'));assert.ok(!types.includes('sound-tab'));assert.ok(!types.includes('screen-tab'))
  const releases=effects.map(fn=>fn()),late=[...listeners.values()],lateMedia=[...mediaListeners]
  assert.equal(reads,1)
  view.dispose()
  const count=writes.length
  resolve({mods:[{id:'late'}]});await Promise.resolve();await Promise.resolve()
  late.forEach(fn=>fn({key:'Escape'}));lateMedia.forEach(fn=>fn())
  tree.props.onContextMenu({preventDefault(){},stopPropagation(){}})
  assert.equal(writes.length,count);assert.equal(reads,1);assert.equal(closed,0)
  assert.equal(listeners.size,0);assert.equal(mediaListeners.size,0)
  releases.forEach(fn=>fn?.());view.dispose()
})
