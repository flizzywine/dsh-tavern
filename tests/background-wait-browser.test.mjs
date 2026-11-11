import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {dirname,join} from 'node:path'
import {chromium} from 'playwright'
import { sourceFunction } from './fixtures/source-function.mjs'
const require=createRequire(import.meta.url)
// the same action also appears for parallel-only director work.
for (const directorOnly of [false,true]) test('working background stop button in Chromium; directorOnly='+directorOnly,async()=>{
 let script='const modules={};\n'
 for(const [name,file] of [['react','react.production.js'],['scheduler','scheduler.production.js'],['react-dom','react-dom.production.js'],['react-dom/client','react-dom-client.production.js']]) {
  script+=`modules[${JSON.stringify(name)}]=(()=>{const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${await readFile(join(dirname(require.resolve(name)),'cjs',file),'utf8')}\nreturn module.exports;})();\n`
 }
 const source=await readFile(new URL('../tavern-plugin/lib/client.js',import.meta.url),'utf8')
 const stop=sourceFunction(source, 'TavernStopBackgroundAction')
 const wait=await readFile(new URL('../tavern-plugin/src/client/modules/background-wait.js',import.meta.url),'utf8')
 script+=`const React=modules.react;window.calls=[];const activity=${directorOnly ? "{busy:false,phase:'idle',operationId:'old-core',director:{busy:true,phase:'running',operationId:'op-1'}}" : "{busy:true,phase:'running',operationId:'op-1',updatedAt:Date.now()-90000}"};
 const useTavernCoordination=()=>({view:{activity}});const liveTavernView={invalidate(){}};const tavernCoordination={invalidate(){}};const tavernErrorHub={report(){throw Error('unexpected error')}};
 async function rpc(method,args,sessionId){window.calls.push({method,args,sessionId});return {progress:{phase:'model',startedAt:Date.now()-90000,lastProgressAt:Date.now()-90000}}}
 ${wait}\n${stop}\nmodules['react-dom/client'].createRoot(document.querySelector('main')).render(React.createElement(${directorOnly ? 'TavernStopBackgroundAction' : 'TavernBackgroundWait'},{sessionId:'game',activity}));`
 const browser=await chromium.launch({headless:true})
 try {
  const page=await browser.newPage();page.on('pageerror', error => { throw error });await page.setContent('<main></main>');await page.addScriptTag({content:script})
  if (!directorOnly) await page.getByText(/正在等待模型 API/).waitFor()
  await page.getByRole('button',{name:'停止后台',exact:true}).click()
  const calls=await page.evaluate(()=>window.calls)
  assert.deepEqual(calls.find(call=>call.method==='stopBackground'),{method:'stopBackground',args:{operationId:'op-1'},sessionId:'game'})
 } finally {await browser.close()}
})
test('后台任务页在 Chromium 中按轮显示流程：时刻、它启动的任务、做完后接着跑的任务；时序图和全部任务折叠在下面',async()=>{
 let script='const modules={};\n'
 for(const [name,file] of [['react','react.production.js'],['scheduler','scheduler.production.js'],['react-dom','react-dom.production.js'],['react-dom/client','react-dom-client.production.js']]) {
  script+=`modules[${JSON.stringify(name)}]=(()=>{const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${await readFile(join(dirname(require.resolve(name)),'cjs',file),'utf8')}\nreturn module.exports;})();\n`
 }
 const wait=await readFile(new URL('../tavern-plugin/src/client/modules/background-wait.js',import.meta.url),'utf8')
 script+=`const React=modules.react;const t=Date.now();
 function TavernStopBackgroundAction(){return React.createElement('button',null,'停止后台')}
 const settle={key:'run:run-1',name:'变量结算',task:'settlement',status:'running',at:t-8000,agents:[{id:'run-1',status:'running',member:'background',lane:'resident',queuedAt:t-8000,startedAt:t-8000,model:'m'}],then:[
   {key:'job:locate',name:'插件「地图」定位',task:'plugin:地图:locate',status:'failed',at:t-4000,endedAt:t-3000,error:'信号读取失败',agents:[],then:[]}]}
 async function rpc(method){return {runs:[
  {id:'run-2',task:'candidate',name:'生成选项',lane:'resident',member:'background',turn:5,model:'m',status:'queued',queuedAt:t-2000},
  {id:'run-1',task:'settlement',name:'变量结算',lane:'resident',turn:5,model:'m',status:'running',queuedAt:t-8000,startedAt:t-8000,agentSessionId:'session-abcd',member:'background'},
  {id:'run-0',task:'ledger',name:'手动记账',lane:'resident',turn:4,model:'m',status:'discarded',queuedAt:t-20000,startedAt:t-20000,endedAt:t-15000,agentSessionId:'session-abcd',member:'background'}],
  turns:[
   {turn:5,at:t-9000,moments:[{event:'turn-started',name:'玩家发送',at:t-9000,tasks:[]},{event:'reply-committed',name:'正文写完',at:t-8500,tasks:[
     {key:'job:polish',name:'自动精修',task:'polish',status:'completed',at:t-8400,endedAt:t-8300,agents:[],then:[]},settle]}],
    others:[{key:'run:run-2',name:'生成选项',task:'candidate',status:'queued',at:t-2000,agents:[{id:'run-2',status:'queued',member:'background',lane:'resident',queuedAt:t-2000}],then:[]}]},
   {turn:4,at:t-21000,moments:[{event:'turn-started',name:'玩家发送',at:t-21000,tasks:[]}],
    others:[{key:'run:run-0',name:'手动记账',task:'ledger',status:'discarded',at:t-20000,endedAt:t-15000,agents:[],then:[]}]}],
  catalog:[{task:'plugin:npc:diary',name:'露娜日记',plugin:'npc',member:'plugin:npc:luna',lane:'resident',does:'写日记',trigger:'结算后',waits:'不等其他任务',lock:false},{task:'settlement',name:'变量结算',lane:'resident',member:'background',does:'更新变量',trigger:'正文写完后',reads:'正文',writes:'变量',waits:'下一轮开始前要等它',lock:true,
   spec:{on:[{moments:['正文写完'],needs:[],condition:'有待结算的回复时',flow:true}],manual:['重新生成正文后'],needs:[],neededBy:['生成选项'],cancelOn:[],blocksNextTurn:true,idleForeground:false,lock:true,note:''}}],
  members:[{id:'background',name:'书记'},{id:'plugin:npc:luna',name:'露娜',plugin:'npc'}],
  locks:[{kind:'held',slot:'background',role:'settlement',operationId:'op',from:t-8000},{kind:'refused',slot:'background',role:'candidate',holder:'settlement',at:t-2000}],
  moments:[{event:'reply-committed',name:'正文写完',at:t-8500}]}}
 ${wait}\nmodules['react-dom/client'].createRoot(document.querySelector('main')).render(React.createElement(TavernBackgroundTasksTab,{sessionId:'game'}));`
 const browser=await chromium.launch({headless:true})
 try {
  const page=await browser.newPage();page.on('pageerror', error => { throw error });await page.setContent('<main></main>');await page.addScriptTag({content:script})
  await page.getByText('运行 1 · 排队 1').waitFor()
  const flow=await page.locator('section').first().innerText()
  // The newest turn is open: its moments in order, the tasks each started, and what ran after a task, indented under it.
  assert.match(flow, /每轮流程[\s\S]*第 5 轮[\s\S]*4 项任务 · 2 项进行中 · 1 项失败[\s\S]*玩家发送[\s\S]*正文写完[\s\S]*✓\s*自动精修[\s\S]*●\s*变量结算[\s\S]*书记 · m[\s\S]*✕\s*插件「地图」定位[\s\S]*信号读取失败[\s\S]*手动或插件启动[\s\S]*…\s*生成选项/)
  assert.match(flow, /第 4 轮/)
  assert.equal(await page.locator('.dsh-tavern-run-then .dsh-tavern-run-name').innerText(), '插件「地图」定位')
  // A task opens to what it does and waits for, from the catalog.
  await page.locator('.dsh-tavern-run-node-head', { hasText: '变量结算' }).click()
  assert.match(await page.locator('.dsh-tavern-run-detail').innerText(), /做什么：更新变量[\s\S]*等待：下一轮开始前要等它[\s\S]*Agent 运行：运行中/)
  assert.match(await page.locator('body').innerText(), /停止后台/)
  // Each turn opens its own timeline: one row per member, fresh Agents last, a refused lock as ✕.
  await page.getByRole('button', { name: '时序 ▾' }).first().click()
  const rows=await page.locator('.dsh-tavern-tl-row').allInnerTexts()
  assert.match(rows[1], /书记[\s\S]*变量结算[\s\S]*✕/)
  assert.match(rows[2], /插件「npc」·露娜/)
  assert.match(rows.at(-1), /临时 Agent/)
  // Members, with their tasks; a task opens its definition below.
  const members=await page.locator('.dsh-tavern-member').allInnerTexts()
  assert.match(members[0], /书记[\s\S]*常驻[\s\S]*正在跑：变量结算，1 个排队[\s\S]*变量结算/)
  assert.match(members[1], /插件「npc」·露娜[\s\S]*空闲[\s\S]*露娜日记/)
  assert.match(members.at(-1), /临时 Agent[\s\S]*还没有登记任务/)
  await page.locator('.dsh-tavern-member-tasks button', { hasText: '变量结算' }).click()
  assert.equal(await page.locator('.dsh-tavern-run-fold').evaluate(node => node.open), true)
  const [diary, settlement]=await page.locator('.dsh-tavern-task-spec').allInnerTexts()
  assert.match(diary, /插件「npc」露娜日记[\s\S]*plugin:npc:diary[\s\S]*成员\s*插件「npc」·露娜/)
  assert.match(settlement, /变量结算\s*settlement[\s\S]*成员\s*书记（常驻，保留历史），占锁[\s\S]*启动\s*正文写完\s*if 有待结算的回复时\s*流程直接启动[\s\S]*其他入口\s*重新生成正文后[\s\S]*需要\s*—[\s\S]*被需要\s*生成选项 等它[\s\S]*下一轮\s*开始前要等它做完[\s\S]*做什么\s*更新变量/)
 } finally {await browser.close()}
})
