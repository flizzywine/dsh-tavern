import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const {createStageInput}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/input.cjs')
function fixture(){
 const dom=new JSDOM('<!doctype html><div id="stage" tabindex="0"><input><button>control</button><button data-action="skip">skip</button></div><input id="chat">')
 const {window}=dom,document=window.document,root=document.getElementById('stage'),calls=[],jobs=new Map();let next=0,keyboard=false
 const frame={root,modal:false,backlog:false,hidden:false,auto:false,skipping:false,atEnd:false,widgetOpen:false}
 const clock={setTimeout:(fn,ms)=>{const id=++next;jobs.set(id,{fn,ms});return id},clearTimeout:id=>jobs.delete(id)}
 const scope=createStageInput({window,document,clock,controls:{skipSelector:'[data-action="skip"]',pressRegenerate:()=>false},navigation:{galKeyboardFocus:()=>keyboard}})
 const input=scope.attach(()=>frame,action=>{calls.push(action);if(action.type==='skip')frame.skipping=action.value})
 function key(value,options={},target=window,type='keydown'){const event=new window.KeyboardEvent(type,{key:value,bubbles:true,cancelable:true,...options});target.dispatchEvent(event);return event}
 return {window,document,root,calls,jobs,frame,scope,input,clock,key,setKeyboard:value=>keyboard=value,cleanup(){scope.dispose();dom.window.close()}}
}
test('keyboard respects stage editors, modal UI, IME and keyboard focused controls while chat focus cannot trap stage keys',()=>{
 const f=fixture();try{
 f.key('Enter',{},f.root.querySelector('input'));assert.equal(f.calls.some(x=>x.type==='page'),false)
 f.key('Enter',{isComposing:true});assert.equal(f.calls.some(x=>x.type==='page'),false)
 f.frame.modal=true;f.key('Enter');assert.equal(f.calls.some(x=>x.type==='page'),false)
 f.frame.modal=false;f.setKeyboard(true);f.key('Enter',{},f.root.querySelector('button'));assert.equal(f.calls.some(x=>x.type==='page'),false)
 f.key('Enter',{},f.document.getElementById('chat'));assert.deepEqual(f.calls.at(-1),{type:'page',delta:1})
 const down=f.key(' '),up=f.key(' ',{},f.window,'keyup');assert.equal(down.defaultPrevented,true);assert.equal(up.defaultPrevented,true)
 f.frame.backlog=true;f.key('Escape');assert.deepEqual(f.calls.at(-1),{type:'backlog',open:false})
 }finally{f.cleanup()}
})
test('Ctrl hold arms once, shortcuts cancel it, and the interrupting press is consumed only once',()=>{
 const f=fixture();try{
 f.key('Control');assert.equal([...f.jobs.values()][0].ms,160)
 const stale=[...f.jobs.values()][0].fn;f.key('a',{ctrlKey:true});assert.equal(f.jobs.size,0)
 const count=f.calls.length;stale();assert.equal(f.calls.length,count)
 f.key('Control');const job=[...f.jobs.values()][0];job.fn();assert.deepEqual(f.calls.slice(-2),[{type:'auto',value:false},{type:'held',value:true}])
 f.frame.skipping=true;f.key('ArrowRight');assert.equal(f.input.wasInterrupted(),true);assert.equal(f.input.consumeInterrupted(),true);assert.equal(f.input.consumeInterrupted(),false)
 f.frame.skipping=true;f.root.querySelector('[data-action="skip"]').dispatchEvent(new f.window.Event('pointerdown',{bubbles:true}));assert.equal(f.input.wasInterrupted(),false);assert.equal(f.frame.skipping,true)
 }finally{f.cleanup()}
})
test('plugin disposal removes listeners and fences an already captured arm callback',()=>{
 const f=fixture();try{
 f.key('Control');const late=[...f.jobs.values()][0].fn
 f.scope.dispose();assert.equal(f.jobs.size,0);const count=f.calls.length
 late();f.key('Enter');f.key('Control');assert.equal(f.calls.length,count);assert.equal(f.jobs.size,0)
 f.input.dispose();assert.throws(()=>f.scope.attach(()=>f.frame,()=>{}),/disposed/)
 }finally{f.cleanup()}
})
test('failed timer cleanup still removes all input listeners',()=>{
 const f=fixture();try{
 f.key('Control');f.clock.clearTimeout=()=>{throw Error('timer failure')}
 assert.throws(()=>f.scope.dispose(),/cleanup failed/);const count=f.calls.length
 f.key('Enter');for(const {fn} of f.jobs.values())fn();assert.equal(f.calls.length,count)
 }finally{f.cleanup()}
})
test('partial listener installation failure rolls back listeners already installed',()=>{
 const window=new EventTarget(),document=new EventTarget();let adds=0,removes=0
 const add=window.addEventListener.bind(window),remove=window.removeEventListener.bind(window)
 window.addEventListener=(...args)=>{if(++adds===4)throw Error('install failed');add(...args)}
 window.removeEventListener=(...args)=>{removes++;remove(...args)}
 const calls=[],scope=createStageInput({window,document,clock:{clearTimeout(){}},controls:{},navigation:{}})
 assert.throws(()=>scope.attach(()=>({}),action=>calls.push(action)),/install failed/)
 assert.equal(removes,4);const count=calls.length;window.dispatchEvent(new Event('keydown'));assert.equal(calls.length,count);scope.dispose()
})
