// Production registered conversation owner + real React, iframe/module loader,
// postMessage bridge and event gate. Local fixture scripts only; no user data,
// external dependency downloads, model calls or paid API calls.
// STATUS_SMOKE_DSH_ROOT=/path/to/installed/dsh node tests/fixtures/card-lifecycle-browser-smoke.mjs
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createTavernScriptDispatch } from '../../tavern-plugin/lib/domain/tavern-script-dispatch.js'
import { createSessionSignalTransport } from '../../tavern-plugin/lib/domain/session-signal-transport.js'

const dsh = process.env.STATUS_SMOKE_DSH_ROOT
if (!dsh) throw Error('Set STATUS_SMOKE_DSH_ROOT to the installed DSH package')
const require = createRequire(path.join(dsh, 'node_modules/@deepseek-ai/dsh-client-ui-trajectory/package.json'))
const names = ['react', 'scheduler', 'react-dom', 'react-dom/client']
const files = ['react.production.js', 'scheduler.production.js', 'react-dom.production.js', 'react-dom-client.production.js']
let bundle = 'const modules={};\n'
for (let i = 0; i < names.length; i++) {
  const file = path.join(path.dirname(require.resolve(names[i])), 'cjs', files[i])
  bundle += `modules[${JSON.stringify(names[i])}]=(function(){const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${await readFile(file, 'utf8')}\nreturn module.exports;})();\n`
}
const client = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const signals = createSessionSignalTransport()
const gate = createTavernScriptDispatch({ timeoutMs: 10000, publishSignal: (sessionId, signal) => signals.publish(sessionId, signal) })
const calls = [], failures = []
const revisions = new Map()
function view(sessionId) {
  return { mode: 'story', chatId: sessionId, card: { name: 'Fixture' }, tavernRuntimePolicy: { trustedCardMode: true },
    tavernHelper: { version: 1, lifecycleRevision: 1, stateRevision: revisions.get(sessionId) || 1, messages: [], scriptVariables: {}, chatVariables: {} },
    tavernHelperScripts: [
      { id: 'broken', name: 'deliberate failure', content: 'throw new Error("fixture intentional initialization failure");' },
      { id: 'working', name: 'working companion', content: `
parent.postMessage({type:'fixture-script-start',sessionId:${JSON.stringify(sessionId)}},'*');
eventOn('CHAT_CHANGED',()=>parent.postMessage({type:'fixture-chat-changed',sessionId:${JSON.stringify(sessionId)}},'*'));
eventOn('fixture-update',async value=>{await replaceVariables({value},{type:'chat'});parent.postMessage({type:'fixture-update',sessionId:${JSON.stringify(sessionId)}},'*');return value;});
eventOn('fixture-fail',()=>{throw Error('fixture intentional event failure');});` }
    ] }
}
const runner = `
${bundle}
window.__ModuleLoader__={load(d){window.client=d.factory(name=>modules[name]||{});}};
${client}
const React=modules.react, root=modules['react-dom/client'].createRoot(document.querySelector('#app'));
let Slot;
client.createTavernAssistantRendererFeatureModule().register({ctx:{effect:run=>run()},slots:{inject:(_name,run)=>run(),register:(entry,component)=>{if(entry.id==='dsh-tavern-script-runtime')Slot=component;return ()=>{};}}});
const report=document.querySelector('#result'), starts=[], ready=[], updates=[];
addEventListener('message',e=>{if(e.data?.type==='fixture-script-start')starts.push(e.data.sessionId);if(e.data?.type==='fixture-chat-changed')ready.push(e.data.sessionId);if(e.data?.type==='fixture-update')updates.push(e.data.sessionId);});
const seen=[];
function check(ok,message){if(!ok)throw Error(message);seen.push(message);report.textContent='RUNNING\\n'+seen.join('\\n');}
async function waitFor(fn){const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('timeout '+seen.join(', '));}
const request=(url,body={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
const status=()=>request('/fixture/status');
function mount(sessionId){root.render(React.createElement(React.Fragment,null,React.createElement('p',null,'Current fixture conversation: '+sessionId),React.createElement(Slot,{sessionId})));}
(async()=>{
 check(typeof Slot==='function','production runtime slot registered');
 mount('A');await waitFor(()=>ready.includes('A'));
 await waitFor(async()=> (await status()).A.ready);
 check(starts.filter(x=>x==='A').length===1,'A: one shared sandbox despite failed companion script');
 const first=document.querySelector('#dsh-tavern-helper-script-host iframe');
 mount('A');mount('A');
 let result=await request('/fixture/dispatch',{sessionId:'A',name:'fixture-update',args:[7]});
 check(result.handled===true && updates.includes('A'),'event, Helper write and completion pass through real gate');
 check(document.querySelector('#dsh-tavern-helper-script-host iframe')===first,'variable refresh and parent rerender keep script iframe');
 result=await request('/fixture/dispatch',{sessionId:'A',name:'fixture-fail'});
 check(result.handled===false && result.error.includes('fixture intentional event failure'),'script failure returns observable event error');
 result=await request('/fixture/dispatch',{sessionId:'A',name:'fixture-update',args:[8]});
 check(result.handled===true,'event after failure still completes');
 mount('B');await waitFor(()=>ready.includes('B'));await waitFor(async()=>{const x=await status();return !x.A.present && x.B.ready;});
 check(!first.isConnected && document.querySelectorAll('#dsh-tavern-helper-script-host iframe').length===1,'switch A to B releases old owner and removes old iframe');
 mount('A');await waitFor(()=>ready.filter(x=>x==='A').length===2);await waitFor(async()=>{const x=await status();return x.A.ready && !x.B.present;});
 check(starts.filter(x=>x==='A').length===2,'return to A starts exactly one fresh runtime');
 root.unmount();await waitFor(async()=>!(await status()).A.present);
 check(document.querySelectorAll('#dsh-tavern-helper-script-host').length===0,'unmount releases server lease and removes script host');
 const before=(await status()).pollCount;await new Promise(r=>setTimeout(r,700));
 check((await status()).pollCount===before,'unmounted owner stops polling');
 report.textContent='PASS\\n'+seen.join('\\n');
})().catch(error=>{report.textContent='FAIL '+error.message+'\\n'+seen.join('\\n');});
`
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://fixture')
  if (url.pathname === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    return response.end('<!doctype html><meta charset="utf-8"><title>Card lifecycle regression</title><pre id="result">RUNNING</pre><div id="app"></div><script src="/runner.js"></script>')
  }
  if (url.pathname === '/runner.js') { response.setHeader('Content-Type', 'text/javascript'); return response.end(runner) }
  if (url.pathname === '/api/dsh-tavern/events') {
    const sessionId = url.searchParams.get('sessionId') || ''
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const stop = signals.subscribe(sessionId, [], signal => response.write('id: ' + signal.id + '\ndata: ' + JSON.stringify(signal) + '\n\n'))
    request.once('close', stop)
    return
  }
  if (url.pathname === '/api/dsh-tavern/static-assets') {
    const module = (url.searchParams.get('url') || '').includes('+esm')
    response.setHeader('Content-Type', module ? 'text/javascript' : 'text/plain')
    response.setHeader('Access-Control-Allow-Origin', '*')
    return response.end(module ? 'export {};' : '')
  }
  response.setHeader('Content-Type', 'application/json')
  try {
    let raw = ''; for await (const chunk of request) raw += chunk
    const body = raw ? JSON.parse(raw) : {}, sessionId = body.sessionId
    let result
    if (url.pathname === '/fixture/status') result = { A: gate.status('A'), B: gate.status('B'), pollCount: calls.filter(x => x.method === 'claimTavernScriptWork').length, failures }
    else if (url.pathname === '/fixture/dispatch') result = await gate.dispatch(sessionId, body.name, body.args || [])
    else {
      const method = url.pathname.split('/').at(-1)
      calls.push({ method, sessionId })
      if (method === 'getSession') result = { ok: true, view: view(sessionId) }
      else if (method === 'claimTavernScriptWork') result = { ok: true, ...gate.claim(sessionId, body.runtimeId, body.ready) }
      else if (method === 'heartbeatTavernScriptRuntime') result = { ok: true, active: gate.touch(sessionId, body.runtimeId, body.ready) }
      else if (method === 'completeTavernHelperEvent') result = { ok: true, completed: gate.complete(sessionId, body.eventId, body.args, body.runtimeId, body.error, body.diagnostics) }
      else if (method === 'releaseTavernHelperRuntime') result = { ok: true, released: gate.dispose(sessionId, body.runtimeId) }
      else if (method === 'updateTavernHelperVariables') { revisions.set(sessionId, (revisions.get(sessionId) || 1) + 1); result = { ok: true, updated: true } }
      else if (method === 'recordMvuRuntimeDiagnostic') { failures.push(body.diagnostic); result = { ok: true } }
      else throw Error('Unexpected fixture request: ' + method)
    }
    response.end(JSON.stringify(result))
  } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ ok: false, error: error.message })) }
})
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port))
