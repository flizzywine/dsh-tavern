// Real iframe, module loader and RPC bridge backed by disposable worldbook files.
// Excludes only unrelated CDN assets; does not start the user's app or call a model.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createHelperWorldbookHost } from './helper-worldbook-host.mjs'

const host = await createHelperWorldbookHost(process.argv.includes('--embedded'))
async function browserClientSource() {
let source = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
source = source.replace('import("/api/dsh-tavern/vendor/runtime-assets/zod/index.mjs")', 'Promise.resolve({})')
source = source.replace('import("/api/dsh-tavern/vendor/runtime-assets/yaml/index.mjs")', 'Promise.resolve({})')
for (const dependency of ['tavernIconDependencies', 'tavernStaticAssetShim', 'tavernHelperScriptDependencies']) source = source.replaceAll('+ ' + dependency + '()', "+ ''")
return source
}
function cardScript(readonly) {
  return `
    const api = window.TavernHelper;
    const ctx = SillyTavern.getContext();
    if(window.Mvu !== undefined) throw Error('ordinary script received fake MVU');
    if(api !== SillyTavern.getContext().TavernHelper || getContext().chatId !== 'audit') throw Error('API discovery');
    ${readonly ? '' : `await api.createWorldbookEntries('审计书', [{ name:'浏览器新增', content:'已落盘的内容', strategy:{keys:[/浏览器/u]}, position:{type:'at_depth',role:'user',depth:0,order:321} }]);
    await api.setLorebookEntries('审计书',[{uid:7,content:'浏览器改写'}]);
    ctx.extensionSettings.phone = { scale:80, nested:{keep:true} };
    const held = ctx.extensionSettings.phone;
    await ctx.saveSettingsDebounced();
    if(held !== ctx.extensionSettings.phone) throw Error('settings reference changed');
    const toSave = await ctx.loadWorldInfo('审计书');
    toSave.entries[7].content = '原生浏览器改写';
    toSave.entries[7].customNative = {preserved:true};
    toSave.entries[7].position = 4; toSave.entries[7].depth = 0;
    await ctx.saveWorldInfo('审计书',toSave,true);`}
    if(ctx.extensionSettings.phone?.scale !== 80 || !ctx.extensionSettings.phone?.nested?.keep) throw Error('settings recovery');
    const native = await ctx.loadWorldInfo('审计书');
    if(Array.isArray(native.entries) || native.entries[7].content !== '原生浏览器改写' || !native.entries[7].customNative?.preserved || native.entries[7].position!==4 || native.entries[7].depth!==0) throw Error('native recovery');
    const rows = await api.getLorebookEntries('审计书');
    const added = rows.find(e=>e.comment==='浏览器新增');
    if(!added || added.depth!==0 || added.position!=='at_depth_as_user' || added.order!==321 || added.keys[0]!=='/浏览器/u') throw Error('worldbook roundtrip');
    const popup = new (getContext().Popup)('弹窗内容', 'display', '接口验证');
    const closed = popup.show();
    if (!document.querySelector('[data-dsh-helper-popup]')) throw Error('popup missing');
    popup.completeAffirmative();
    if (await closed !== true || document.querySelector('[data-dsh-helper-popup]')) throw Error('popup cleanup');
    const events=[];
    eventOn('MESSAGE_SENT',()=>events.push('normal'));
    SillyTavern.getContext().eventSource.makeFirst('message_sent',()=>events.push('first'));
    eventOnce('MESSAGE_SENT',()=>events.push('once'));
    eventOn('audit-check',()=>parent.postMessage({type:'host-smoke-result',events,rows,popupVerified:true,settings:ctx.extensionSettings,native,mvuPresent:window.Mvu!==undefined,readonly:${readonly}},'*'));
  `
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname === '/client.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(await browserClientSource()); return }
    if (url.pathname === '/rpc') {
      let body = ''; for await (const chunk of request) body += chunk
      const { method, args } = JSON.parse(body)
      const result = await host.invoke(method, args)
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result)); return
    }
    if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return }
    if (url.pathname !== '/') { response.writeHead(404); response.end(); return }
    const readonly = url.searchParams.has('read')
    const initial = await host.adapter.getWorldbook('audit', 'current')
    const view = { chatId: 'audit', card: { name: '测试卡' }, playerName: '测试者', tavernHelper: { messages: [], mvuEnabled: false, extensionSettings: await host.extensionSettings.read() }, tavernHelperWorldbook: initial.worldbook,
      tavernHelperScripts: [{ id: 'smoke', name: 'API 验证', content: cardScript(readonly) }], tavernRuntimePolicy: { trustedCardMode: url.searchParams.has('trusted') } }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(`<!doctype html><title>宿主接口回归验证</title><h1>宿主接口回归验证</h1><a href="/?read">销毁脚本环境并从文件回读</a><pre id="result">RUNNING</pre>
      <script>window.__ModuleLoader__={load(value){window.clientDescriptor=value}};</script><script src="/client.js"></script>
      <script>
      const client=clientDescriptor.factory(()=>({}));
      const showError=(source,error)=>document.querySelector('#result').textContent='FAIL '+source+': '+error.message;
      addEventListener('message',event=>{if(event.data.type!=='host-smoke-result')return;
        const value=event.data, pass=JSON.stringify(value.events)===JSON.stringify(['first','normal','once','first','normal']);
        window.smokeResult={pass,...value};document.querySelector('#result').textContent=(pass?'PASS':'FAIL')+'\\n'+JSON.stringify(value,null,2);
      });
      const runtime=client.createTavernHelperScriptRuntime({window,document,
        rpc:async(method,args)=>{const r=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})});if(!r.ok)throw Error(await r.text());return r.json()},
        reportError:showError,resolveError(){},onMutation(){},
        onReady:async()=>{await runtime.emit('MESSAGE_SENT',[1]);await runtime.emit('MESSAGE_SENT',[2]);await runtime.emit('audit-check',[])}
      });window.smokeRuntime=runtime;
      runtime.sync('audit',${JSON.stringify(view).replace(/</g, '\\u003c')});
      </script>`)
  } catch (error) { response.writeHead(500); response.end(error.message) }
})
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port))
async function close() { server.close(); await host.cleanup(); process.exit(0) }
process.on('SIGINT', close)
process.on('SIGTERM', close)
