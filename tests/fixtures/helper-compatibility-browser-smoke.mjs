// Production sandbox, transport, diagnostic persistence/export; temporary Chat only.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createHelperChatDataHost } from './helper-chat-data-host.mjs'
import { createProfileDataStore } from '../../tavern-plugin/lib/profile-data-store.js'
import { TAVERN_COMPATIBILITY_CAPABILITIES, createTavernCompatibilityDiagnosticStore } from '../../tavern-plugin/lib/domain/tavern-compatibility-diagnostics.js'
import { createMvuDiagnosticStore, createMvuDiagnosticExport } from '../../tavern-plugin/lib/domain/mvu-diagnostics.js'

const host = await createHelperChatDataHost()
const storage = createProfileDataStore({ dataRoot: host.directory })
const store = createTavernCompatibilityDiagnosticStore(storage)
const baseline = JSON.stringify(await host.open().read('audit'))
const scripts = [
  { id: 'a', name: '兼容诊断脚本甲', content: `
    for(let n=0;n<100;n++) SillyTavern.scrollChatToBottom('PRIVATE_CHAT',{password:'PRIVATE_KEY'});
    if(typeof TavernHelper.generateRaw==='function') throw Error('false capability');
    try { SillyTavern.registerMacro('PRIVATE_CHAT',()=>{}); throw Error('false success'); }
    catch(error){ if(error.code!=='TAVERN_CAPABILITY_UNSUPPORTED') throw error; }
    eventOn('PROBE',()=>SillyTavern.hideLoader());
  ` },
  { id: 'b', name: '兼容诊断脚本乙', content: `
    SillyTavern.scrollChatToBottom();
    eventOn('PROBE',()=>SillyTavern.hideLoader());
  ` }
]
let source = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
source = source.replace('import("/api/dsh-tavern/vendor/runtime-assets/zod/index.mjs")', 'Promise.resolve({})')
source = source.replace('import("/api/dsh-tavern/vendor/runtime-assets/yaml/index.mjs")', 'Promise.resolve({})')
for (const dependency of ['tavernIconDependencies', 'tavernStaticAssetShim', 'tavernHelperScriptDependencies']) source = source.replaceAll('+ ' + dependency + '()', "+ ''")
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/client.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(source); return }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return }
    if (url.pathname === '/rpc') {
      let body = ''; for await (const chunk of req) body += chunk
      const { method, args, sessionId } = JSON.parse(body)
      if (method !== 'recordTavernCompatibilityCalls' || sessionId !== 'audit') throw Error('Unexpected RPC: ' + method)
      await store.record(sessionId, args.runtimeId, args.calls)
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ recorded: true })); return
    }
    if (url.pathname === '/proof') {
      const diagnostics = await createTavernCompatibilityDiagnosticStore(createProfileDataStore({ dataRoot: host.directory })).read('audit')
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ diagnostics, chatUnchanged: JSON.stringify(await host.open().read('audit')) === baseline })); return
    }
    if (url.pathname === '/export') {
      const exported = await createMvuDiagnosticExport({ sessionId: 'audit', store: createMvuDiagnosticStore(storage), compatibilityDiagnostics: await store.read('audit') })
      res.setHeader('Content-Type', 'application/zip'); res.end(exported.buffer); return
    }
    if (url.pathname !== '/') { res.writeHead(404); res.end(); return }
    const view = { chatId: 'audit', card: { name: '兼容诊断测试卡' }, tavernHelper: { ...await host.context(), compatibilityCapabilities: TAVERN_COMPATIBILITY_CAPABILITIES }, tavernHelperScripts: scripts, tavernRuntimePolicy: { trustedCardMode: url.searchParams.has('trusted') } }
    res.setHeader('Content-Type', 'text/html;charset=utf-8')
    res.end(`<!doctype html><title>缺失能力调用验证</title><h1>缺失能力调用验证</h1><pre id="result">RUNNING</pre><a href="/export" download="compatibility.zip">导出日志</a>
    <script>window.__ModuleLoader__={load(value){window.descriptor=value}};</script><script src="/client.js"></script><script>
    const client=descriptor.factory(()=>({}));
    const runtime=client.createTavernHelperScriptRuntime({window,document,
      rpc:async(method,args,sessionId)=>{const r=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args,sessionId})});if(!r.ok)throw Error(await r.text());return r.json()},
      reportError:(source,error)=>{window.smokeError=error.message;document.querySelector('#result').textContent='FAIL '+error.message},resolveError(){},onMutation(){throw Error('Chat mutation')},
      onReady:async()=>{await runtime.emit('PROBE',[],{messages:[]});await runtime.flushCompatibilityDiagnostics();const proof=await(await fetch('/proof')).json();window.smokeResult=proof;document.querySelector('#result').textContent=JSON.stringify(proof,null,2)}
    });window.runtime=runtime;runtime.sync('audit',${JSON.stringify(view).replace(/</g, '\\u003c')});</script>`)
  } catch (error) { res.writeHead(500); res.end(error.message) }
})
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port))
async function close() { server.close(); await host.cleanup(); process.exit(0) }
process.on('SIGINT', close); process.on('SIGTERM', close)
