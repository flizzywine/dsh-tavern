import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageWidgets}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/widgets.cjs')
test('widget menu follows presentation and available layout actions',()=>{
  const view=createStageWidgets({React:{}})
  const item={placed:true,presentation:{state:'open',surface:'stage',pinned:true}}
  assert.deepEqual(view.menuEntries(item,{narrow:true,portrait:false}).map(x=>x.type),['collapse','pin','sheet','reset','hide'])
  assert.equal(view.menuEntries(item,{})[1].checked,true)
  view.dispose()
})
test('widget launcher removes listeners and registration and fences stale controls on unload',()=>{
  const effects=[],listeners=new Map(),calls=[]
  let entry,removed=false
  const target={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)}
  const view=createStageWidgets({
    React:{useState:value=>[value===false?true:value,()=>calls.push('state')],useRef:value=>({current:value}),useEffect:fn=>effects.push(fn),useLayoutEffect(){},createElement:(type,props,...children)=>({type,props,children})},
    window:target,document:target,entries:{register:value=>{entry=value;return()=>{removed=true}}},clearTimeout(){},
  })
  const items=['a','b'].map(key=>({key,definition:{title:key},presentation:{state:'compact',attention:{}}}))
  const component=entry.render({widgets:{items,action:()=>calls.push('action')}})
  const tree=component.type(component.props)
  const releases=effects.map(fn=>fn())
  assert.equal(listeners.size,2)
  const late=[...listeners.values()]
  const button=tree.children[0]
  view.dispose()
  assert.equal(removed,true)
  assert.equal(listeners.size,0)
  late.forEach(fn=>fn({key:'Escape'}))
  button.props.onClick()
  assert.deepEqual(calls,[])
  releases.forEach(fn=>fn?.());view.dispose()
})
