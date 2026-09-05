// Real browser coverage for trusted card scripts that inject UI into the host document.
// STATUS_SMOKE_DSH_ROOT=/path/to/installed/dsh node tests/fixtures/card-host-artifact-browser-smoke.mjs
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

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
const runner = `
${bundle}
window.__ModuleLoader__={load(d){window.client=d.factory(name=>modules[name]||{});}};
${client}
const report=document.querySelector('#result'),seen=[];
function check(ok,message){if(!ok)throw Error(message);seen.push(message);report.textContent='RUNNING\\n'+seen.join('\\n');}
async function waitFor(fn){const end=Date.now()+10000;while(Date.now()<end){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('timeout '+seen.join(', '));}
const runtime=client.createTavernHelperScriptRuntime({rpc(){return Promise.resolve({});},reportError(){}});
function view(content){return {card:{name:'Fixture'},tavernRuntimePolicy:{trustedCardMode:true},tavernHelper:{messages:[],scriptVariables:{}},tavernHelperScripts:[{id:'fixture',name:'fixture',content,data:{},buttons:[]}]};}
(async()=>{
  check(typeof runtime.sync==='function','production Helper runtime created');
  runtime.sync('A',view(\`const button=parent.document.createElement('button');button.id='fixture-card-global';parent.document.body.appendChild(button);const style=parent.document.createElement('style');style.id='fixture-card-style';parent.document.head.appendChild(style);\`));
  await waitFor(()=>document.querySelector('#fixture-card-global')&&document.querySelector('#fixture-card-style'));
  check(true,'trusted card installed host artifacts');
  runtime.sync('B',view('void 0'));
  check(!document.querySelector('#fixture-card-global')&&!document.querySelector('#fixture-card-style'),'switch removed old card host artifacts');
  check(document.querySelectorAll('#dsh-tavern-helper-script-host iframe').length===1,'new card owns one fresh sandbox');
  runtime.dispose();
  report.textContent='PASS\\n'+seen.join('\\n');
})().catch(error=>{report.textContent='FAIL '+error.message+'\\n'+seen.join('\\n');});
`

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture')
  if (url.pathname === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    return response.end('<!doctype html><meta charset="utf-8"><title>Card host artifact lifecycle</title><pre id="result">RUNNING</pre><script src="/runner.js"></script>')
  }
  if (url.pathname === '/runner.js') {
    response.setHeader('Content-Type', 'text/javascript')
    return response.end(runner)
  }
  if (url.pathname === '/api/dsh-tavern/vendor/runtime-assets/zod/index.mjs' || url.pathname === '/api/dsh-tavern/vendor/runtime-assets/yaml/index.mjs') {
    response.setHeader('Content-Type', 'text/javascript')
    return response.end('export default {};')
  }
  response.statusCode = 404
  response.end('')
})

server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port))
