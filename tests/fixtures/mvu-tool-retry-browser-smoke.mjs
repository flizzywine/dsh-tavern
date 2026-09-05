// Isolated browser verification: real official MVU + production bridge/transaction,
// scripted Agent decisions (no paid model calls and no user chat writes).
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createMvuSettlementModule } from '../../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { createTavernScriptHostAdapter } from '../../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { createTavernScriptDispatch } from '../../tavern-plugin/lib/domain/tavern-script-dispatch.js'
import { projectTavernHelperContext } from '../../tavern-plugin/lib/domain/tavern-helper-context.js'
import { createTavernStaticResourceCache, rewriteCachedModuleImports } from '../../tavern-plugin/lib/domain/tavern-static-resource-cache.js'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = new URL('../../', import.meta.url)
const assets = createTavernStaticResourceCache({ rootDir: process.env.MVU_SMOKE_ASSET_CACHE || await mkdtemp(path.join(tmpdir(), 'mvu-retry-assets-')) })
const client = await readFile(new URL('tavern-plugin/lib/client.js', root))
const bundle = await readFile(new URL('tavern-plugin/lib/vendor/magvarupdate/host-build/artifact/bundle.js', root))
const runtimeAssets = new Map(await Promise.all([
  ['tavern.css', 'tavern-plugin/lib/client-assets/tavern.css'],
  ['fontawesome/css/all.min.css', 'tavern-plugin/lib/vendor/runtime-assets/fontawesome/css/all.min.css'],
  ['vue/vue.runtime.global.prod.js', 'tavern-plugin/lib/vendor/runtime-assets/vue/vue.runtime.global.prod.js'],
  ['vue-router/vue-router.global.prod.js', 'tavern-plugin/lib/vendor/runtime-assets/vue-router/vue-router.global.prod.js'],
  ['jquery/jquery.min.js', 'tavern-plugin/lib/vendor/runtime-assets/jquery/jquery.min.js'],
  ['lodash/lodash.min.js', 'tavern-plugin/lib/vendor/runtime-assets/lodash/lodash.min.js'],
  ['zod/index.mjs', 'tavern-plugin/lib/vendor/runtime-assets/zod/index.mjs'],
  ['yaml/index.mjs', 'tavern-plugin/lib/vendor/runtime-assets/yaml/index.mjs']
].map(async ([key, file]) => [key, await readFile(new URL(file, root))])))
const variables = { stat_data: { hp: 10, location: 'door', observer: '' }, schema: { type: 'object', properties: {
  hp: { type: 'number' }, location: { type: 'string' }, observer: { type: 'string' }
} }, display_data: {}, delta_data: {}, initialized_lorebooks: {} }
const chat = { id: 'fixture', sessionId: 'fixture', mode: 'story', mvu: { enabled: true, owner: 'official' },
  messages: [{ role: 'assistant', text: '测试正文', swipes: ['测试正文'], swipeId: 0, variables: [structuredClone(variables)] }] }
let writes = 0, started = false
const feedback = []
const gate = createTavernScriptDispatch()
const adapter = createTavernScriptHostAdapter({
  resolveChat: async () => chat, writeChat: async draft => { writes++; Object.assign(chat, structuredClone(draft)) },
  readCard: async () => ({ name: '测试卡' }), worldBooks: { bound: async () => null }, scriptDispatch: gate
})
const module = createMvuSettlementModule({ runtime: adapter, model: { async run(request) {
  assert(!request.turnContext.includes('"display_data"'))
  assert(!request.turnContext.includes('"delta_data"'))
  assert(!request.turnContext.includes('"schema"'))
  assert(request.turnContext.includes(JSON.stringify(variables.schema)), 'schema remains available once')
  await request.onToolCall({ name: 'posture_submit', arguments: { posture: '原地站立' } })
  for (const location of ['invalid', 'hall']) {
    feedback.push(JSON.parse(await request.onToolCall({ name: 'mvu_submit_update', arguments: { operations: [
      { op: 'delta', path: '/stat_data/hp', value: -1 },
      { op: 'replace', path: '/stat_data/location', value: location },
      { op: 'replace', path: '/stat_data/observer', value: '{{user}}' }
    ] } })))
  }
  return { text: '{}' }
} } })
const view = { chatId: chat.id, card: { name: '测试卡' }, tavernHelper: projectTavernHelperContext(chat),
  tavernHelperWorldbook: { name: '测试世界书', entries: [{ uid: 1, name: '[initvar]初始值', enabled: true,
    content: 'hp: 10\nlocation: door' }] },
  tavernRuntimePolicy: { trustedCardMode: true },
  tavernMvuRuntime: { owner: 'official', assetUrl: '/mvu.js' },
  tavernHelperScripts: [{ id: 'guard', name: '位置校验', data: {}, buttons: [], content: `
    eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, (next, before) => {
      if (next.stat_data.location === 'invalid') {
        next.stat_data.location = before.stat_data.location;
        console.warn('location: 只允许 hall，请修正位置字段');
      }
    });` }]
}
const page = `<!doctype html><meta charset="utf-8"><title>MVU 自动修正验证</title>
<h1>MVU 自动修正验证</h1><button id="run" disabled>验证</button><pre id="result">加载官方 MVU…</pre>
<script>window.__ModuleLoader__={load(d){window.client=d.factory(()=>({}));}};</script><script src="/client.js"></script>
<script>
const output=document.querySelector('#result');
async function rpc(method,args={}) { const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({method,args})});
 const value=await r.json(); if(!r.ok)throw new Error(value.error); return value; }
const runtime=client.createTavernHelperScriptRuntime({rpc,onMutation(){},resolveError(){},
 reportError(source,error){output.textContent=source+': '+error.message;},
 async onReady(){await runtime.emit('CHAT_CHANGED',['fixture'],${JSON.stringify(view.tavernHelper)});output.textContent='官方 MVU 已就绪';document.querySelector('#run').disabled=false;}
});
runtime.sync('fixture',${JSON.stringify(view)});
let polling=true;
async function poll(){while(polling){
 const state=await rpc('poll');
 if(state.event){const event=state.event,diagnostics=[];let error='',args=[];
  try{args=await runtime.emit(event.name,event.args,event.context,diagnostics,event.id);}catch(e){error=e.message;}
  await rpc('complete',{id:event.id,leaseToken:event.leaseToken,args,error,diagnostics});
 }
 await new Promise(r=>setTimeout(r,30));
}}
document.querySelector('#run').onclick=async()=>{
 document.querySelector('#run').disabled=true; output.textContent='执行中…';poll();
 try{const result=await rpc('run');output.textContent='PASS\\n'+JSON.stringify(result,null,2);}
 catch(e){output.textContent='FAIL: '+e.message;}finally{polling=false;}
};
</script>`
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/client.js' || url.pathname === '/mvu.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' }).end(url.pathname === '/client.js' ? client : bundle); return
    }
    const runtimeAssetKey = url.pathname === '/api/dsh-tavern/client-assets/tavern.css'
      ? 'tavern.css'
      : url.pathname.replace('/api/dsh-tavern/vendor/runtime-assets/', '')
    if (runtimeAssets.has(runtimeAssetKey)) {
      response.writeHead(200, { 'content-type': runtimeAssetKey.endsWith('.css') ? 'text/css' : 'text/javascript' }).end(runtimeAssets.get(runtimeAssetKey)); return
    }
    if (url.pathname === '/api/dsh-tavern/static-assets') {
      const target = url.searchParams.get('url')
      const asset = await assets.get(target)
      response.writeHead(200, { 'content-type': asset.mediaType }).end(/javascript/.test(asset.mediaType)
        ? rewriteCachedModuleImports(asset.body.toString(), asset.finalUrl) : asset.body); return
    }
    if (url.pathname === '/version') { response.end(JSON.stringify({ pkgVersion: '1.12.14' })); return }
    if (url.pathname === '/rpc') {
      let body = ''; for await (const chunk of request) body += chunk
      const { method, args } = JSON.parse(body)
      let result = {}
      if (method === 'recordMvuRuntimeDiagnostic') console.log('FIXTURE_DIAGNOSTIC', JSON.stringify(args))
      if (method === 'poll') {
        result = gate.claim('fixture', 'browser', true)
        if (result.event) {
          assert.equal(gate.start('fixture', result.event.id, result.leaseToken, 'browser').started, true)
          result.event.leaseToken = result.leaseToken
        }
      }
      else if (method === 'complete') result = gate.complete('fixture', args.id, args.args, 'browser', args.leaseToken, args.error, args.diagnostics)
      else if (method === 'updateTavernHelperMessages') result = await adapter.updateMessages('fixture', args.messages, 0, args.eventId)
      else if (method === 'updateTavernHelperVariables') {
        // MVU's settings initialization is outside this isolated chat fixture.
        result = args.option?.type === 'global' ? { updated: true }
          : await adapter.updateVariables('fixture', args.option, args.variables, 0, args.eventId)
      }
      else if (method === 'getTavernHelperWorldbook') result = { worldbook: view.tavernHelperWorldbook }
      else if (method === 'run') {
        if (started) throw new Error('reload fixture server before repeating')
        started = true; writes = 0
        gate.touch('fixture', 'browser', true)
        const settled = await module.settleVariables({ operationId: 'fixture', chatId: 'fixture', branchId: 'b', basedOnRevision: 1,
          sessionId: 'fixture', messageId: 0, swipeId: 0, storyText: '测试正文', currentVariables: variables,
          charName: '测试卡', macroState: { userName: '测试玩家', local: {}, global: {} } })
        assert.equal(feedback.length, 2)
        assert.equal(feedback[0].ok, false)
        assert.equal(feedback[0].retryable, true)
        assert.equal(feedback[0].currentVariables.display_data, undefined)
        assert.equal(feedback[0].currentVariables.schema, undefined)
        assert.match(JSON.stringify(feedback[0].runtimeDiagnostics), /只允许 hall/)
        assert.equal(feedback[1].ok, true)
        assert.equal(settled.variables.stat_data.hp, 9)
        assert.equal(settled.variables.stat_data.observer, '测试玩家')
        assert.equal(writes, 0, '结算阶段只返回效果，不直接写入权威 Chat')
        result = { attempts: feedback.length, writes, hp: settled.variables.stat_data.hp, observer: settled.variables.stat_data.observer, status: settled.receipt.status,
          firstError: feedback[0].runtimeDiagnostics }
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result)); return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page)
  } catch (error) { response.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message + '\n' + JSON.stringify(feedback) })) }
})
server.listen(0, '127.0.0.1', () => console.log('MVU_RETRY_SMOKE_URL=http://127.0.0.1:' + server.address().port))
