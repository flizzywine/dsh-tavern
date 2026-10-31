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
test('markdown entry disposal restores original DOM marks and cannot be revived by queued observers',async()=>{
 const {JSDOM}=await import('jsdom')
 const dom=new JSDOM('<div id="root"><p class="original" data-fork-stage-turn="old">第一段</p><p>第二段</p></div>')
 const parent=dom.window.document.getElementById('root'),effects=[]
 let ref=0,observerCallback
 const React={createElement:(type,props,...children)=>({type,props,children}),useRef:value=>({current:++ref===1?parent:value}),useLayoutEffect:fn=>effects.push(fn),useEffect:fn=>effects.push(fn)}
 const entry=createStageChatEntry({React,plain:text=>text,blocks:text=>text.split('\n\n'),schedule:()=>1,cancel(){},MutationObserver:class {constructor(fn){observerCallback=fn}observe(){}disconnect(){}}})
 entry.Markdown({text:'第一段\n\n第二段',turn:2,base:0,markdownProps:{}})
 const stops=effects.map(fn=>fn())
 assert.equal(parent.querySelectorAll('button').length,2)
 const first=parent.querySelector('p');first.classList.add('is-long-pressed')
 entry.dispose()
 observerCallback([{type:'characterData',target:first}])
 assert.equal(parent.querySelectorAll('button').length,0)
 assert.equal(first.className,'original')
 assert.equal(first.getAttribute('data-fork-stage-turn'),'old')
 assert.equal(parent.querySelectorAll('[data-fork-stage-para]').length,0)
 stops.forEach(fn=>fn?.());dom.window.close()
})
