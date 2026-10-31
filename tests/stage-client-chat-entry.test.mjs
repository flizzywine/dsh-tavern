import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageChatEntry}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/chat-entry.cjs')
test('chat stage entry releases long-press timers and ignores late clicks on plugin disposal',()=>{
 const effects=[],timers=new Set();let updates=0,entered=0,callback
 const React={createElement:(type,props,...children)=>({type,props,children}),useState:value=>[value,()=>updates++],useRef:value=>({current:value}),useEffect:fn=>effects.push(fn),useLayoutEffect:fn=>effects.push(fn)}
 const entry=createStageChatEntry({React,enter:()=>entered++,schedule:fn=>{callback=fn;timers.add(fn);return fn},cancel:fn=>timers.delete(fn)})
 const paragraph=entry.Paragraph({turn:1,para:2,children:'text'})
 const button=entry.EnterHere({sessionId:'s',turn:1,para:2})
 const stops=effects.map(fn=>fn())
 paragraph.props.onPointerDown({pointerType:'touch'})
 assert.equal(timers.size,1)
 entry.dispose();callback()
 button.props.onClick({preventDefault(){},stopPropagation(){}})
 assert.equal(timers.size,0)
 assert.equal(updates,0)
 assert.equal(entered,0)
 stops.forEach(fn=>fn?.())
})
test('rendered paragraph targets retain source offsets across formatted text',()=>{
 const entry=createStageChatEntry({plain:text=>text.replace(/\*/g,'')})
 assert.deepEqual(entry.targets(['**第一段**','第二段'],['第一段','第二段'],3),[4,5])
})
