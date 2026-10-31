import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageNotices} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/notices.cjs')
const h=(type,props,...children)=>({type,props,children})
test('retry completion cannot update an unmounted or disposed stage notice', async () => {
  for (const mode of ['unmount','dispose']) {
    let effect, resolve, updates=0, calls=0
    const React={createElement:h,useState:value=>[value,()=>updates++],useRef:value=>({current:value}),useEffect:fn=>{effect=fn}}
    const views=createStageNotices({React})
    const button=views.Retry({onRetry:()=>{calls++;return new Promise(done=>{resolve=done})}})
    const unmount=effect(),event={preventDefault(){},stopPropagation(){}}
    const pending=button.props.onClick(event)
    assert.equal(updates,1)
    if(mode==='unmount') unmount();else views.dispose()
    resolve();await pending
    await button.props.onClick(event)
    assert.equal(updates,1)
    assert.equal(calls,1)
  }
})
test('stage errors hide technical details by default and retain their reload action', () => {
  const views=createStageNotices({React:{createElement:h},document:{body:{classList:{contains:()=>false}}}})
  const tree=views.Status({sceneError:'WebGL renderer SECRET_INTERNAL',onReloadScene(){}})
  const rendered=JSON.stringify(tree)
  assert.match(rendered,/画面渲染组件没能载入/)
  assert.doesNotMatch(rendered,/SECRET_INTERNAL/)
  const functions=[]
  const walk=node=>{if(!node||typeof node!=='object')return;if(typeof node.type==='function')functions.push(node);for(const child of node.children||[])Array.isArray(child)?child.forEach(walk):walk(child)}
  walk(tree)
  assert.ok(functions.some(node=>node.props?.onReload))
})
test('capability notices isolate sessions and cancel all pending expiry work on disposal',()=>{
  let state=null, effects=[], updates=0
  const timers=new Set(),callbacks=[]
  const React={useState:()=>[state,next=>{updates++;state=typeof next==='function'?next(state):next}],useEffect:fn=>effects.push(fn)}
  const views=createStageNotices({React,foreground:{setTimeout:fn=>{callbacks.push(fn);timers.add(fn);return fn},clearTimeout:fn=>timers.delete(fn)}})
  const render=(id,rows)=>{effects=[];const value=views.useCapabilityNotice(id,true,rows);effects.forEach(fn=>fn());return value}
  assert.equal(render('a',[{message:'A missing'}]),null)
  assert.equal(render('a',[]),'A missing')
  const expireA=callbacks[0]
  assert.equal(render('b',[{message:'B missing'}]),null)
  assert.equal(render('b',[]),'B missing')
  timers.delete(expireA);expireA()
  assert.equal(state.message,'B missing')
  views.dispose()
  const before=updates
  callbacks.forEach(fn=>fn())
  assert.equal(updates,before)
  assert.equal(timers.size,0)
  render('c',[{message:'C missing'}])
  assert.equal(updates,before)
})
