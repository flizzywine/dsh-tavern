// 语音后端 › a saved service's Base URL: 最近用过的网址 (⏲) switches the 网址 + API Key pair at once, renames, forgets, clears.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {assetRenderer,walk,text} from './fixtures/asset-editor-renderer.mjs'
const source = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-tts/src/client.js',import.meta.url),'utf8')

test('最近用过的网址: the ⏲ lists the pairs with key tails only; 使用 switches, × forgets, 清空记录… asks once', async t => {
  const r=assetRenderer(),exports={},effects=[],calls=[];let Panel
  t.after(()=>{r.dispose();effects.forEach(fn=>fn?.())})
  const local={id:'e1',label:'本地',url:'http://127.0.0.1:9884',keyTail:'',keyed:false,usedAt:2,current:true}
  const cloud={id:'e2',label:'api.fish.audio',url:'https://api.fish.audio',keyTail:'1234',keyed:true,usedAt:1}
  let row={id:'fish-local',kind:'fish-audio',label:'Drama 3',config:{url:'http://127.0.0.1:9884'},revision:'r1',category:'custom',selfHosted:true,secrets:{key:{configured:false,writable:true}},check:{status:'connected'},models:[],recent:[local,cloud]}
  const kinds=[{kind:'fish-audio',label:'Fish Audio',fields:[{key:'url',label:'Base URL',required:true,advanced:true,secret:false},{key:'key',label:'API Key',secret:true}]}]
  const fetch=async (_url,options)=>{
    const {method,args}=JSON.parse(options.body);calls.push({method,args})
    if(method==='useEndpoint'){row={...row,config:{url:cloud.url},revision:'r2',secrets:{key:{configured:true,writable:true}},recent:[{...cloud,current:true},{...local,current:undefined}]};return {ok:true,json:async()=>row}}
    if(['forgetEndpoint','renameEndpoint','clearEndpoints'].includes(method))return {ok:true,json:async()=>({recent:[]})}
    const values={services:{configured:[row],running:[]},providerKinds:kinds,cache:{maxBytes:1024**3,maxAgeDays:30,bytes:0,count:0}}
    return {ok:true,json:async()=>values[method] ?? {}}
  }
  const React={...r.React,createElement:(type,props,...children)=>r.React.createElement(type,props,...(children.length ? children : [props?.children])),useSyncExternalStore:(_subscribe,get)=>get()}
  vm.runInNewContext(source,{exports,require:()=>React,fetch,EventSource:class{close(){}},AbortController,Date,Set,setTimeout,clearTimeout,window:Object.assign(new EventTarget(),{sessionStorage:{getItem:()=>null,removeItem(){}}})})
  exports.apply({slots:{inject:(_name,fn)=>fn(),register:(_options,view)=>{Panel=view}},effect:fn=>effects.push(fn()),inject:()=>{},get:()=>undefined,provide:()=>()=>{}})
  r.render(Panel);let tree=await r.settle()
  walk(tree).find(n=>n.props?.className==='dtts-line-main'&&text(n).includes('Drama 3')).props.onClick();tree=await r.settle()
  const toggle=()=>walk(tree).find(n=>n.props?.['aria-label']==='最近用过的网址'&&n.type==='button')
  const pop=()=>walk(tree).find(n=>n.props?.className==='dtts-menu dtts-recent-pop')
  assert.ok(toggle(),'the ⏲ sits at the Base URL'); assert.equal(pop(),undefined)
  toggle().props.onClick({stopPropagation(){}});tree=await r.settle()
  assert.equal(pop().props.role,'dialog')
  const rows=walk(pop()).filter(n=>n.props?.className==='dtts-recent-row')
  assert.equal(rows.length,2)
  assert.match(text(rows[0]),/使用中/); assert.match(text(rows[0]),/无 API Key/)
  assert.match(text(rows[1]),/https:\/\/api\.fish\.audio · API Key …1234/)
  // 使用: one request with the entry and the row's revision; the open form takes the saved address
  walk(rows[1]).find(n=>n.props?.['aria-label']==='使用「api.fish.audio」').props.onClick();tree=await r.settle()
  assert.deepEqual(calls.find(c=>c.method==='useEndpoint').args,{id:'fish-local',entry:'e2',expectedRevision:'r1'})
  assert.equal(pop(),undefined,'a switch closes the list')
  assert.match(text(tree),/已切换到「api\.fish\.audio」/)
  assert.ok(walk(tree).some(n=>n.type==='input'&&n.props?.['aria-label']==='Base URL'&&n.props.value==='https://api.fish.audio'))
  assert.equal(calls.some(c=>c.method==='saveService'),false)
  // × forgets one; 清空记录… asks before clearing
  toggle().props.onClick({stopPropagation(){}});tree=await r.settle()
  walk(pop()).find(n=>n.props?.['aria-label']==='删除记录「本地」').props.onClick();tree=await r.settle()
  assert.deepEqual(calls.find(c=>c.method==='forgetEndpoint').args,{id:'fish-local',entry:'e1'})
  walk(pop()).find(n=>n.type==='button'&&text(n)==='清空记录…').props.onClick();tree=await r.settle()
  assert.equal(calls.some(c=>c.method==='clearEndpoints'),false)
  const confirm=walk(pop()).find(n=>n.props?.role==='alertdialog')
  assert.match(confirm.props['aria-label'],/清空「Drama 3」的 2 条记录？/)
  walk(confirm).find(n=>n.type==='button'&&text(n)==='清空').props.onClick();tree=await r.settle()
  assert.deepEqual(calls.find(c=>c.method==='clearEndpoints').args,{id:'fish-local'})
  // keys never reach the page: the rows carry tails only
  assert.equal(JSON.stringify(calls).includes('sk-'),false)
})

test('最近用过的网址: no ⏲ while a service has no recorded pair', async t => {
  const r=assetRenderer(),exports={},effects=[];let Panel
  t.after(()=>{r.dispose();effects.forEach(fn=>fn?.())})
  const row={id:'fish',kind:'fish-audio',label:'Fish Audio',config:{url:'https://api.fish.audio'},revision:'r1',category:'builtin',secrets:{key:{configured:true,writable:true}},check:{status:'connected'},models:[],recent:[]}
  const kinds=[{kind:'fish-audio',label:'Fish Audio',fields:[{key:'url',label:'Base URL',required:true,advanced:true,secret:false},{key:'key',label:'API Key',secret:true}]}]
  const fetch=async (_url,options)=>{ const {method}=JSON.parse(options.body); const values={services:{configured:[row],running:[]},providerKinds:kinds,cache:{maxBytes:1024**3,maxAgeDays:30,bytes:0,count:0}}; return {ok:true,json:async()=>values[method] ?? {}} }
  const React={...r.React,createElement:(type,props,...children)=>r.React.createElement(type,props,...(children.length ? children : [props?.children])),useSyncExternalStore:(_subscribe,get)=>get()}
  vm.runInNewContext(source,{exports,require:()=>React,fetch,EventSource:class{close(){}},AbortController,Date,Set,setTimeout,clearTimeout,window:Object.assign(new EventTarget(),{sessionStorage:{getItem:()=>null,removeItem(){}}})})
  exports.apply({slots:{inject:(_name,fn)=>fn(),register:(_options,view)=>{Panel=view}},effect:fn=>effects.push(fn()),inject:()=>{},get:()=>undefined,provide:()=>()=>{}})
  r.render(Panel);let tree=await r.settle()
  walk(tree).find(n=>n.props?.className==='dtts-line-main'&&text(n).includes('Fish Audio')).props.onClick();tree=await r.settle()
  assert.ok(walk(tree).some(n=>n.type==='input'&&n.props?.['aria-label']==='Base URL'))
  assert.equal(walk(tree).some(n=>n.props?.['aria-label']==='最近用过的网址'),false)
})
