// Browser regression using the REAL frame component, Helper transport and card
// HTML. Supply a local card resource; it is read only, never committed or edited.
// STATUS_SMOKE_CARD=/path/card.json STATUS_SMOKE_DSH_ROOT=/path/dsh node <this file>
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const dsh = process.env.STATUS_SMOKE_DSH_ROOT
if (!dsh) throw Error('Set STATUS_SMOKE_DSH_ROOT to the installed DSH package')
const require = createRequire(path.join(dsh, 'node_modules/@deepseek-ai/dsh-client-ui-trajectory/package.json'))
const moduleNames = ['react', 'scheduler', 'react-dom', 'react-dom/client']
const filenames = ['react.production.js', 'scheduler.production.js', 'react-dom.production.js', 'react-dom-client.production.js']
let bundle = 'const modules={};\n'
for (let i = 0; i < moduleNames.length; i++) {
  const file = path.join(path.dirname(require.resolve(moduleNames[i])), 'cjs', filenames[i])
  bundle += `modules[${JSON.stringify(moduleNames[i])}]=(function(){const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${await readFile(file, 'utf8')}\nreturn module.exports;})();\n`
}
const currentSource = process.env.STATUS_SMOKE_BASELINE
  ? execFileSync('git', ['show', process.env.STATUS_SMOKE_BASELINE + ':tavern-plugin/lib/client.js'], { encoding: 'utf8' })
  : await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
// Only dependency downloads are stubbed. The card, frame lifecycle, refresh
// fallback, context mirror, event dispatch and render functions are unchanged.
let source = currentSource.replace('? tavernHelperMessageDependencies() :', '? "" :')
// Older commits predate the production component export; retain baseline comparison.
if (process.env.STATUS_SMOKE_BASELINE && !source.includes('exports.TavernMessageFrame =')) {
  source = source.replace('exports.apply = apply;', 'exports.TavernMessageFrame = TavernMessageFrame; exports.apply = apply;')
}
let template = '<div id="xx-place-value"></div><script>document.querySelector("#xx-place-value").textContent=getAllVariables().stat_data?.世界系统?.地点||"变量未就绪";</script>'
if (process.env.STATUS_SMOKE_CARD) {
  const resource = JSON.parse(await readFile(process.env.STATUS_SMOKE_CARD, 'utf8'))
  const card = resource.raw?.data || resource.data || resource
  const regex = card.extensions.regex_scripts.find(item => item.scriptName === '状态栏')
  template = regex.replaceString.replace(/^\s*```html\s*/i, '').replace(/\s*```\s*$/, '')
}
const script = `
${bundle}
window.__ModuleLoader__={load(d){window.client=d.factory(name=>modules[name]||{});}};
${source}
const template=${JSON.stringify(template).replace(/</g, '\\u003c')};
const React=modules.react, root=modules['react-dom/client'].createRoot(document.querySelector('#app'));
let revision=0, turn=1, stage=0, deadline=Date.now()+15000, beforeFrame, ready=false;
const report=document.querySelector('#result'), seen=[];
function mount(place){
 revision++;
 const variables=place?{stat_data:{世界系统:{地点:place}}}:{};
 const messages=turn===1?[{variables}]:[{variables:{stat_data:{世界系统:{地点:'山门'}}}},{variables}];
 const helperContext={version:1,stateRevision:revision,lifecycleRevision:1,messages,chatVariables:{},turnMessageIds:{1:0,2:1}};
 root.render(React.createElement(client.TavernMessageFrame,{content:template,helperContext,turn,eager:true,persistent:true,observeMvuView:false,runtimeReporting:false,trustedCardMode:true}));
}
addEventListener('message',e=>{if(e.data?.type==='dsh-tavern-frame-ready')ready=true;});
mount();
const timer=setInterval(()=>{
 const frame=document.querySelector('iframe:not([aria-hidden])');
 const doc=frame?.contentDocument, text=doc?.body?.textContent||'';
 const place=doc?.querySelector('#xx-place-value')?.textContent;
 if(stage===0 && ready && (text.includes('变量未就绪')||place==='变量未就绪')){seen.push('initial: 变量未就绪');stage=1;beforeFrame=frame;mount('山门');deadline=Date.now()+12000;}
 else if(stage===1 && place==='山门'){seen.push('late init: 山门');stage=2;turn=2;mount('庭院');deadline=Date.now()+12000;}
 else if(stage===2 && place==='庭院'){seen.push('next turn: 庭院');stage=3;mount('山门');deadline=Date.now()+12000;}
 else if(stage===3 && place==='山门'){seen.push('rollback: 山门');stage=4;beforeFrame=frame;mount('山门');deadline=Date.now()+6500;}
 else if(stage===4 && Date.now()>deadline){seen.push(frame===beforeFrame?'unchanged: same iframe':'FAIL unchanged remount');clearInterval(timer);report.textContent=(frame===beforeFrame?'PASS':'FAIL')+'\\n'+seen.join('\\n');return;}
 if(stage<4 && Date.now()>deadline){clearInterval(timer);report.textContent='FAIL stage '+stage+' place='+place+'\\n'+seen.join('\\n');return;}
 report.textContent='RUNNING stage '+stage+'\\n'+seen.join('\\n');
},100);
`
const server = createServer((request, response) => {
  if (request.url === '/runner.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
    response.end(script)
    return
  }
  if (request.url !== '/') {
    response.writeHead(200, { 'Content-Type': 'text/javascript', 'Access-Control-Allow-Origin': '*' })
    response.end('export {};')
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><meta charset="utf-8"><title>Status refresh regression</title><pre id="result">RUNNING</pre><div id="app"></div><script>addEventListener("error",e=>document.querySelector("#result").textContent="FAIL "+e.message+" line "+e.lineno+":"+e.colno);</script><script src="/runner.js"></script>')
})
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port))
