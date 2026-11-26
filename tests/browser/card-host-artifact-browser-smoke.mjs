// Real browser coverage for trusted card scripts that inject UI into the host document.
// node tests/browser/card-host-artifact-browser-smoke.mjs
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { projectTavernHelperScripts } from '../../tavern-plugin/lib/domain/tavern-helper-scripts.js'
import { projectCachedResourceBody } from '../../tavern-plugin/lib/domain/tavern-static-resource-cache.js'

const require = createRequire(new URL('../../package.json', import.meta.url))
const names = ['react', 'scheduler', 'react-dom', 'react-dom/client']
const files = ['react.production.js', 'scheduler.production.js', 'react-dom.production.js', 'react-dom-client.production.js']
let bundle = 'const modules={};\n'
for (let i = 0; i < names.length; i++) {
  const file = path.join(path.dirname(require.resolve(names[i])), 'cjs', files[i])
  bundle += `modules[${JSON.stringify(names[i])}]=(function(){const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${await readFile(file, 'utf8')}\nreturn module.exports;})();\n`
}
const client = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const assistantAsset = 'https://fixture.invalid/cards/assistant.js'
const phoneAsset = 'https://fixture.invalid/cards/phone.js'
const staticAsset = 'https://fixture.invalid/cards/shared.js'
const entry = projectTavernHelperScripts([{
  id: 'external-card', name: 'External card modules', type: 'script',
  content: `import ${JSON.stringify(staticAsset)};
    await import(${JSON.stringify(assistantAsset)});
    const phoneUrl = ${JSON.stringify(phoneAsset)};
    await import(phoneUrl);
    $('#other-card').on('click', () => { parent.__externalClicks = (parent.__externalClicks || 0) + 1; });
    parent.__reloadExternalCard = () => window.location.reload();
    parent.__externalLoads = (parent.__externalLoads || 0) + 1;`
}]).scripts[0].content
const external = new Map([
  [staticAsset, 'window.__externalCardSharedLoaded = true;'],
  [assistantAsset, `if (!window.__externalCardSharedLoaded) throw Error('static dependency not loaded');
    window.parent.document.body.insertAdjacentHTML('beforeend', '<button id="assistant-floater">Assistant</button>');`],
  [phoneAsset, `function mount(_mvu = globalThis.Mvu) {
    const doc = window.parent.document;
    const phone = doc.createElement('button');
    phone.id = 'phone-floater';
    phone.textContent = 'Phone';
    doc.body.append(phone);
  } mount();`]
])
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
  runtime.sync('A',view(\`parent.__lateCardMount=async()=>{const button=$('<button id="fixture-card-global">A</button>');$('body').append(button);$('head').append('<style id="fixture-card-style"></style>');await new Promise(resolve=>setTimeout(resolve,0));const mounted=$('#fixture-card-global')[0];mounted.addEventListener('click',()=>{parent.__cardClicks=(parent.__cardClicks||0)+1;});mounted.style.removeProperty('left');};parent.__cardReady=true;\`));
  await waitFor(()=>window.__cardReady);
  runtime.setForeground(false);
  const other=document.createElement('button');other.id='other-card';document.body.append(other);
  await window.__lateCardMount();
  check(true,'background delayed ID lookup binds events and updates style');
  await new Promise(resolve=>setTimeout(resolve,30));
  check(!document.querySelector('#fixture-card-global')&&!document.querySelector('#fixture-card-style'),'late mount stays hidden after switching away');
  check(other.isConnected,'other card UI remains intact');
  runtime.setForeground(true);
  await waitFor(()=>document.querySelector('#fixture-card-global'));
  document.querySelector('#fixture-card-global').click();
  check(window.__cardClicks===1,'return restores the same working button');
  runtime.setForeground(false);
  check(!document.querySelector('#fixture-card-global'),'switching away again removes the floating button');
  runtime.sync('B',view('void 0'));
  check(!document.querySelector('#fixture-card-global')&&!document.querySelector('#fixture-card-style'),'replacing the runtime cleans up the old artifacts');
  check(document.querySelectorAll('#dsh-tavern-helper-script-host iframe').length===1,'new card owns one fresh sandbox');
  runtime.setForeground(true);
  runtime.sync('external',view(${JSON.stringify(entry)}));
  const floaters = () => Array.from(document.querySelectorAll('#assistant-floater,#phone-floater'));
  await waitFor(()=>window.__externalLoads===1);
  const original = floaters();
  check(original.length===2 && original.every(node=>node.getAttribute('data-dsh-tavern-card-app-session')==='external'),'the literal and computed imports mount UI for the owning conversation');
  const dock = document.createElement('aside');
  document.body.append(dock);
  const phone = document.querySelector('#phone-floater');
  phone.style.display='flex';
  dock.append(phone);
  // Let the artifact observer see the move before changing visibility.
  await Promise.resolve();
  runtime.setForeground(false);
  check(floaters().every(node=>getComputedStyle(node).display==='none'),'both floating components disappear when switching away, including the docked one');
  runtime.setForeground(true);
  check(floaters().length===2 && floaters().every(node=>original.includes(node)) && phone.parentNode===dock && phone.style.display==='flex','return restores both original components and the dock placement');
  other.click();
  check(window.__externalClicks===1,'the card handler works before reload');
  window.__reloadExternalCard();
  await waitFor(()=>window.__externalLoads===2);
  check(floaters().length===2 && original.every(node=>!node.isConnected),'reload releases both original nodes, including the docked one');
  other.click();
  check(window.__externalClicks===2,'reload removes the old document handler from the shared page');
  runtime.sync('new',view('void 0'));
  check(floaters().length===0 && other.isConnected,'conversation replacement removes both external components');
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
  if (url.pathname === '/api/dsh-tavern/static-assets' && external.has(url.searchParams.get('url'))) {
    const source = url.searchParams.get('url')
    response.setHeader('Content-Type', 'text/javascript')
    return response.end(projectCachedResourceBody({ url: source, mediaType: 'text/javascript', body: external.get(source) }))
  }
  if (url.pathname === '/api/dsh-tavern/vendor/runtime-assets/zod/index.mjs' || url.pathname === '/api/dsh-tavern/vendor/runtime-assets/yaml/index.mjs') {
    response.setHeader('Content-Type', 'text/javascript')
    return response.end('export default {};')
  }
  const prefix='/api/dsh-tavern/vendor/runtime-assets/';
  if(url.pathname.startsWith(prefix)&&!url.pathname.includes('..')) {
    const asset=new URL('../../tavern-plugin/lib/vendor/runtime-assets/'+url.pathname.slice(prefix.length),import.meta.url);
    readFile(asset).then(bytes=>{response.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');response.end(bytes)},()=>{response.statusCode=404;response.end('')});return;
  }
  response.statusCode = 404
  response.end('')
})

server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port))
