// Real sandboxed script runtime and host storage, with no user Profile or model calls.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createHelperChatDataHost } from './helper-chat-data-host.mjs'

const host = await createHelperChatDataHost()
const diagnostics = []
async function browserSource() {
  let source = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  source = source.replace('import("/api/dsh-tavern/vendor/runtime-assets/zod/index.mjs")', 'Promise.resolve({})')
  for (const dependency of ['tavernIconDependencies', 'tavernStaticAssetShim', 'tavernHelperScriptDependencies']) source = source.replaceAll('+ ' + dependency + '()', "+ ''")
  return source
}
function script(readonly) {
  return `
    const ctx = SillyTavern.getContext(), chat = ctx.chat, message = chat[0], metadata = ctx.chatMetadata;
    if(window.Mvu !== undefined) throw Error('fake MVU');
    ${readonly ? '' : `
    message.TavernDB_ACU_IsolatedData = { rows:[{location:'门口'}], old:1 };
    const held = message.TavernDB_ACU_IsolatedData;
    ctx.updateChatMetadata({ phone:{active:'联系人甲'}, old:1 });
    await ctx.saveChat();
    if(ctx.chat !== chat || ctx.chat[0] !== message || ctx.chatMetadata !== metadata || message.TavernDB_ACU_IsolatedData !== held) throw Error('reference lost');
    delete message.TavernDB_ACU_IsolatedData.old; delete metadata.old;
    await ctx.saveMetadataDebounced();
    message.mes = '禁止改写的旧正文';
    let rejected=false;
    try { await ctx.saveChat(); } catch(error) { rejected=/不支持/.test(error.message); }
    if(!rejected) throw Error('history mutation accepted');
    message.mes = '她回到了家。';
    `}
    if(message.TavernDB_ACU_IsolatedData?.rows[0]?.location!=='门口' || message.TavernDB_ACU_IsolatedData.old!==undefined || metadata.old!==undefined || metadata.phone?.active!=='联系人甲' || message.mes!=='她回到了家。') throw Error('persistence mismatch');
    parent.postMessage({type:'chat-data-smoke',pass:true,readonly:${readonly},data:message.TavernDB_ACU_IsolatedData,metadata},'*');
  `
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/client.js') { res.setHeader('Content-Type','text/javascript'); res.end(await browserSource()); return }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return }
    if (url.pathname === '/rpc') {
      let body=''; for await (const chunk of req) body+=chunk
      const {method,args}=JSON.parse(body)
      if (method === 'recordMvuRuntimeDiagnostic') { diagnostics.push(args); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({recorded:true})); return }
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(await host.invoke(method,args))); return
    }
    if (url.pathname === '/proof') {
      const chat=await host.open().read('audit')
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({body:chat.messages[0].text,frame:chat.foregroundFrame,timeline:chat.timeline,data:chat.messages[0].tavernPluginData,metadata:chat.tavernPluginMetadata})); return
    }
    if (url.pathname !== '/') { res.writeHead(404); res.end(); return }
    const view={chatId:'audit',card:{name:'存档测试卡'},tavernHelper:await host.context(),tavernHelperScripts:[{id:'storage-smoke',name:'插件存档验证',content:script(url.searchParams.has('read'))}],tavernRuntimePolicy:{trustedCardMode:url.searchParams.has('trusted')}}
    res.setHeader('Content-Type','text/html;charset=utf-8')
    res.end(`<!doctype html><title>插件聊天存档验证</title><h1>插件聊天存档验证</h1><a href="/?read">销毁页面并回读存档</a><pre id="result">RUNNING</pre>
      <script>window.__ModuleLoader__={load(value){window.descriptor=value}};</script><script src="/client.js"></script><script>
      const client=descriptor.factory(()=>({}));
      addEventListener('message',event=>{if(event.data?.type==='chat-data-smoke'){window.smokeResult=event.data;document.querySelector('#result').textContent='PASS\\n'+JSON.stringify(event.data,null,2)}});
      const runtime=client.createTavernHelperScriptRuntime({window,document,
        rpc:async(method,args)=>{const r=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})});if(!r.ok)throw Error(await r.text());return r.json()},
        reportError:(source,error)=>{document.querySelector('#result').textContent='FAIL '+error.message},resolveError(){},onMutation(){},onReady(){}
      });window.runtime=runtime;runtime.sync('audit',${JSON.stringify(view).replace(/</g,'\\u003c')});</script>`)
  } catch(error) { res.writeHead(500);res.end(error.message) }
})
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port))
async function close(){server.close();await host.cleanup();process.exit(0)}
process.on('SIGINT',close);process.on('SIGTERM',close)
