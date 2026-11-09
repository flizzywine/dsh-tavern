// Actual sidebar and iframe in real React; synthetic local card, no model calls.
// DSH_BROWSER_ROOT=/path/to/dsh node tests/browser/opening-retention-browser-smoke.mjs
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
const dsh = process.env.DSH_BROWSER_ROOT
if (!dsh) throw Error('Set DSH_BROWSER_ROOT to the installed DSH package')
const require = createRequire(path.join(dsh, 'node_modules/@deepseek-ai/dsh-client-ui-trajectory/package.json'))
let bundle = 'const modules={};\n'
for (const [name, file] of [['react','react.production.js'],['scheduler','scheduler.production.js'],['react-dom','react-dom.production.js'],['react-dom/client','react-dom-client.production.js']]) {
  const code = await readFile(path.join(path.dirname(require.resolve(name)), 'cjs', file), 'utf8')
  bundle += `modules[${JSON.stringify(name)}]=(function(){const module={exports:{}},exports=module.exports,require=name=>modules[name];\n${code}\nreturn module.exports;})();\n`
}
const client = await readFile(process.env.DSH_CLIENT_SOURCE || new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const css = await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const card = { path:'retention.json', name:'开局保留测试', first_mes:'表单', hasOpeningForm:true }
const content = '<label>角色名<input id="name"></label><label><input id="choice" type="checkbox">选项</label><button id="increment" onclick="window.chosen++;this.textContent=window.chosen">增加</button><script>window.chosen=0;window.instance=Math.random();</script>'
const calls = []
const runner = `${bundle}
window.__ModuleLoader__={load(d){window.client=d.factory(name=>modules[name]||{});}};
${client}
const React=modules.react, root=modules['react-dom/client'].createRoot(document.querySelector('#app'));
let Slot;const sessionState={current:'',byId:{}};
const sessions={create:async()=>{throw Error('fixture intentional start failure')},list:{getSnapshot:()=>sessionState},binding:()=>null,clear(){sessionState.current='';},open(id){sessionState.current=id;render();},refresh:async()=>{}};
const workspaces={create:async()=>({workspaceId:'workspace'}),list:{getSnapshot:()=>({byId:{}})}};
client.createTavernShellFeatureModule().register({ctx:{effect:(fn,label)=>label==='dsh-tavern: shell marker'?()=>{}:fn(),get:()=>({}),sessions,workspaces,layout:{toggleSidebar(){}},betterSidebar:{}},slots:{inject:(_,fn)=>fn(),register:(_,fn)=>{Slot=fn;return()=>{};}},appendMention(){},injectTaskPrompt(){}});
let wide=true;
function render(){root.render(React.createElement(Slot,{wide,expandSidebar(){wide=true;render();},useSessions:fn=>fn(sessionState),useWorkspaces:fn=>fn({byId:{}})}));}
window.fixtureCollapse=value=>{wide=!value;render();};render();
window.verifyOpeningRetention=async function(){
 const checks=[];
 function check(ok,label){if(!ok)throw Error(label);checks.push(label);}
 async function until(fn){const end=Date.now()+10000;while(Date.now()<end){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,20));}throw Error('fixture timeout');}
 const button=text=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text && b.getClientRects().length && !b.disabled);
 async function click(text){(await until(()=>button(text))).click();await new Promise(r=>setTimeout(r,30));}
 await click('＋ 选择人物卡 · 新开游玩');
 (await until(()=>document.querySelector('.dsh-tavern-card-pick'))).click();
 const frame=await until(()=>{const f=document.querySelector('iframe');return f?.contentWindow?.document.querySelector('#name')&&f;});
 const win=frame.contentWindow, instance=win.instance;
 check(win.getCharWorldbookNames().primary==='Fixture worldbook','deferred worldbook reaches opening iframe');
 win.document.querySelector('#name').value='保留的角色';
 win.document.querySelector('#choice').click();win.document.querySelector('#increment').click();
 function preserved(label){check(frame.isConnected && document.querySelector('iframe')===frame && frame.contentWindow.instance===instance && win.document.querySelector('#name').value==='保留的角色' && win.document.querySelector('#choice').checked && win.chosen===1,label);}
 await click(button('暂时收起')?'暂时收起':'关闭');preserved('close keeps original iframe, form and script state');
 await click('卡片');await click('关闭');await click('游玩');preserved('workbench round trip keeps original state');
 window.fixtureCollapse(true);await until(()=>document.querySelector('.dsh-tavern-sidebar.collapsed'));preserved('collapsed sidebar retains iframe');
 document.querySelector('[title="展开侧栏"]').click();await until(()=>button('开始新游戏'));preserved('expanded sidebar keeps state');
 await click('开始新游戏');await until(()=>button('开始新游戏'));preserved('failed start keeps form for retry');
 check(document.body.textContent.includes('fixture intentional start failure'),'start failure was exercised');
 await click('放弃开局');await click('取消');preserved('cancel discard keeps form');
 await click('放弃开局');await click('确认');await until(()=>!frame.isConnected);
 check(!document.querySelector('iframe'),'confirmed discard removes iframe');
 const calls=await fetch('/calls').then(r=>r.json());
 check(calls.filter(x=>x==='getCardOpenings').length===1,'switches never reinitialize opening');
 check(calls.includes('releaseOpeningPreparation'),'discard releases private draft');
 return checks;
};
`;
const server = createServer(async(req,res)=>{
  if(req.url==='/runner.js')return res.writeHead(200,{'Content-Type':'text/javascript'}).end(runner)
  if(req.url==='/style.css')return res.writeHead(200,{'Content-Type':'text/css'}).end(css)
  if(req.url==='/calls')return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(calls))
  if(req.url.startsWith('/api/dsh-tavern/static-assets') || req.url.startsWith('/api/dsh-tavern/vendor/'))return res.writeHead(200,{'Content-Type':'text/javascript'}).end('');
  if(req.url==='/favicon.ico')return res.writeHead(204).end();
  if(req.url.startsWith('/api/')){
    let raw='';for await(const chunk of req)raw+=chunk
    const body=raw?JSON.parse(raw):{};body.method=req.url.split("/").pop();calls.push(body.method)
    let result={}
    if(body.method==='listCards')result={cards:[card]}
    if(body.method==='listSessions')result={sessions:[],capabilities:{trustedCardMode:true}}
    if(body.method==='getUpdateStatus')result={status:{phase:'idle'}}
    if(body.method==='getResourceWorkspace')result={path:'/fixture'}
    if(body.method==='initializeOpeningTemplate'){if(body.compact!==true)throw Error('compact initialization required');result={runtime:null,worldbook:{name:'Fixture worldbook',entries:[]}}}
    if(body.method==='getCardOpenings')result={preparationId:'draft',previewTransport:'deferred-v1',trustedCardMode:true,openings:[{id:'primary',projection:{parts:[{kind:'html',content}]},openingPreview:{swipes:['表单'],openingIds:['primary'],selectedIndex:0,preparationId:'draft'}}]}
    return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ok:true,...result}))
  }
  res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><style>body{margin:0}#app{width:340px;height:100vh}</style><div id="app"></div><script src="/runner.js"></script>')
})
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port))
