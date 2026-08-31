// Real browser module resolution through the production srcdoc/loader.
// Only unrelated bootstrap dependencies are stubbed; no user data or model calls.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

let descriptor
vm.runInNewContext(await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console
})
const client = descriptor.factory(() => ({}))
const base = '/api/dsh-tavern/remote-assets/' + '7'.repeat(64) + '/'
const scripts = [
  { id: 'core', system: 'official-mvu', content: `import '${base}side.js'; await new Promise(r => setTimeout(r, 30)); window.coreReady = true;` },
  { id: 'schema', content: `
    import value, { registerMvuSchema as register, count, increment } from '${base}mvu_zod.js';
    import * as all from '${base}mvu_zod.js';
    export { child } from '${base}child.js';
    if (!window.coreReady || !window.sideReady) throw Error('order');
    increment(); if(count !== 1 || all.count !== 1 || value !== 42) throw Error('bindings');
    const path = '${base}child.js'; const child = await import(path);
    const other = await import('${base}child.js');
    if(child.child !== 42 || other.child !== 42) throw Error('dynamic');
    register();` },
  { id: 'syntax', content: 'const = ;' },
  { id: 'missing-export', content: `import { missing } from '${base}child.js';` },
  { id: 'missing-file', content: `import '${base}missing.js';` },
  { id: 'throw', content: "throw Error('runtime error');" },
  { id: 'reject', content: "await Promise.reject(Error('await error'));" },
  { id: 'tail', content: "if(!window.schemaReady) throw Error('schema not registered'); window.tailReady = true;" }
]
let doc = client.buildTavernHelperScriptDocument({ token: 'smoke', scripts, context: {} })
doc = doc.replace(/<script data-dsh-tavern-helper-dependency[^>]*>[\s\S]*?<\/script>/g, '')
  .replace(/<link\b[^>]*>/g, '')
  .replace(/<script data-dsh-tavern-helper-script>[\s\S]*?<\/script>/, `<script>
  const results=[];
  window.__dshTavernHelperReady=Promise.resolve();
  window.__dshTavernHelperSetCurrentScript=()=>{};
  window.waitGlobalInitialized=async()=>{ if(!window.coreReady) throw Error('core not awaited'); };
  window.__dshTavernHelperSubscriptionsReady=id=>results.push({id,ok:true});
  window.__dshTavernHelperSubscriptionsFailed=(id,error)=>results.push({id,ok:false,error:String(error.message||error)});
  window.__dshTavernResolveCompanionScriptsReady=()=>parent.postMessage({type:'module-smoke',results,tail:window.tailReady===true},'*');
  <\/script>`)
const server = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  const url = new URL(request.url, 'http://localhost')
  const modules = {
    'side.js': 'window.sideReady = true;',
    'child.js': 'export const child = 42;',
    'mvu_zod.js': "import { child } from './child.js'; export default child; export let count = 0; export function increment(){count++} export function registerMvuSchema(){window.schemaReady=true}"
  }
  if (url.pathname.startsWith(base)) {
    const source = modules[url.pathname.slice(base.length)]
    response.writeHead(source === undefined ? 404 : 200, { 'Content-Type': 'text/javascript' })
    response.end(source ?? 'not found')
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/html' })
  response.end(`<!doctype html><title>Helper module smoke</title><pre id="result">RUNNING</pre>
    <script>addEventListener('message',e=>{if(e.data.type!=='module-smoke')return;const r=e.data;
    const pass=r.tail && JSON.stringify(r.results.map(x=>x.ok))===JSON.stringify([true,true,false,false,false,false,false,true]);
    document.querySelector('#result').textContent=(pass?'PASS':'FAIL')+'\\n'+JSON.stringify(r,null,2);});
    const frame=document.createElement('iframe');${url.searchParams.has('sandbox') ? "frame.sandbox='allow-scripts';" : ''}
    frame.srcdoc=${JSON.stringify(doc).replace(/</g, '\\u003c')};document.body.appendChild(frame);</script>`)
})
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port))
