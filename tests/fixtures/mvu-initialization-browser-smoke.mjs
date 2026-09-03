// Real browser loader, execution lease, event gate and settlement. Only the model
// and persistence are isolated. Open /?fail=1 to reject the actual MVU import.
import { createServer } from 'node:http'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { readOfficialMvuBundle } from '../../tavern-plugin/lib/domain/official-mvu-assets.js'
import { createMvuSettlementModule } from '../../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { createTavernScriptHostAdapter } from '../../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { createTavernHelperEventGate } from '../../tavern-plugin/lib/domain/tavern-helper-event-gate.js'
import { projectTavernHelperContext } from '../../tavern-plugin/lib/domain/tavern-helper-context.js'
import { createTavernStaticResourceCache, rewriteCachedModuleImports } from '../../tavern-plugin/lib/domain/tavern-static-resource-cache.js'

const client = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url))
const bundle = await readOfficialMvuBundle()
const assets = createTavernStaticResourceCache({ rootDir: process.env.MVU_SMOKE_ASSET_CACHE || await mkdtemp(path.join(tmpdir(), 'mvu-init-assets-')) })
const gate = createTavernHelperEventGate()
const states = new Map()
function state(id) {
  if (!states.has(id)) {
    const variables = { stat_data: { hp: 10 }, schema: { type: 'object', properties: { hp: { type: 'number' } } }, display_data: {}, delta_data: {}, initialized_lorebooks: {} }
    states.set(id, { writes: 0, calls: 0, chat: { id, sessionId: id, mode: 'story', mvu: { enabled: true, owner: 'official' },
      messages: [{ role: 'assistant', text: '测试正文', swipeId: 0, swipes: ['测试正文'], variables: [variables] }] } })
  }
  return states.get(id)
}
const adapter = createTavernScriptHostAdapter({ resolveChat: async id => state(id).chat,
  writeChat: async chat => { state(chat.id).writes++; state(chat.id).chat = structuredClone(chat) },
  readCard: async () => ({ name: '测试卡' }), worldBooks: { bound: async () => null }, eventGate: gate })
const settlement = createMvuSettlementModule({ runtime: adapter, model: { async run(request) {
  const s = state(request.sessionId)
  await request.onToolCall({ name: 'posture_submit', arguments: { posture: '站立' } })
  s.calls++
  s.feedback = JSON.parse(await request.onToolCall({ name: 'mvu_submit_update', arguments: { operations: [{ op: 'replace', path: '/hp', value: 9 }] } }))
  return {}
} } })
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (url.pathname === '/client.js') return res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }).end(client)
    if (url.pathname === '/mvu.js') return res.writeHead(url.searchParams.has('fail') ? 503 : 200, { 'content-type': bundle.mediaType }).end(url.searchParams.has('fail') ? 'unavailable' : bundle.body)
    if (url.pathname === '/api/dsh-tavern/static-assets') {
      const asset = await assets.get(url.searchParams.get('url'))
      return res.writeHead(200, { 'content-type': asset.mediaType }).end(/javascript/.test(asset.mediaType) ? rewriteCachedModuleImports(asset.body.toString(), asset.finalUrl) : asset.body)
    }
    if (url.pathname === '/version') return res.end(JSON.stringify({ pkgVersion: '1.12.14' }))
    if (url.pathname === '/rpc') {
      let body = ''; for await (const part of req) body += part
      const { method, args = {}, sessionId } = JSON.parse(body)
      let result = {}
      if (method === 'pollTavernHelperEvent') result = adapter.pollEvent(sessionId, args.runtimeId, args.ready, args.initializationError)
      else if (method === 'completeTavernHelperEvent') result = gate.complete(sessionId, args.eventId, args.args, args.runtimeId, args.error, args.diagnostics)
      else if (method === 'releaseTavernHelperRuntime') result = gate.dispose(sessionId, args.runtimeId)
      else if (method === 'updateTavernHelperVariables') result = args.option?.type === 'global' ? { updated: true } : await adapter.updateVariables(sessionId, args.option, args.variables, 0)
      else if (method === 'updateTavernHelperMessages') result = await adapter.updateMessages(sessionId, args.messages, 0)
      else if (method === 'saveTavernExtensionSettings') result = { updated: true, extensionSettings: args.settings }
      else if (method === 'getTavernHelperWorldbook') result = { worldbook: null }
      else if (method === 'status') result = gate.status(sessionId)
      else if (method === 'run') {
        const s = state(sessionId); s.writes = 0
        const resultState = await settlement.settleVariables({ sessionId, operationId: 'op', chatId: sessionId, branchId: 'b', basedOnRevision: 0,
          messageId: 0, swipeId: 0, storyText: '测试正文', currentVariables: s.chat.messages[0].variables[0] })
        const failed = sessionId === 'failed'
        assert.equal(resultState.receipt.status, failed ? 'error' : 'updated')
        assert.equal(s.chat.messages[0].variables[0].stat_data.hp, failed ? 10 : 9)
        assert.equal(s.writes, failed ? 0 : 1)
        assert.equal(s.calls, 1)
        if (failed) { assert.equal(s.feedback.retryable, false); assert.match(JSON.stringify(resultState.receipt), /Failed to fetch dynamically imported module/) }
        result = { pass: true, hp: s.chat.messages[0].variables[0].stat_data.hp, writes: s.writes, calls: s.calls, receipt: resultState.receipt }
      }
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
    }
    const failed = url.searchParams.has('fail'), id = failed ? 'failed' : 'normal'
    const view = { chatId: id, card: { name: '测试卡' }, tavernHelper: projectTavernHelperContext(state(id).chat),
      tavernRuntimePolicy: { trustedCardMode: !url.searchParams.has('sandbox') }, tavernHelperScripts: [],
      tavernMvuRuntime: { owner: 'official', assetUrl: '/mvu.js' + (failed ? '?fail=1' : '') } }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><title>MVU 初始化验证</title>
      <button id="run" disabled>验证结算</button><pre id="result">加载中</pre>
      <script>window.__ModuleLoader__={load(d){window.client=d.factory(()=>({}));}};</script><script src="/client.js"></script>
      <script>
      const id=${JSON.stringify(id)},output=document.querySelector('#result');
      async function rpc(method,args={},sessionId=id){const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({method,args,sessionId})});const v=await r.json();if(!r.ok)throw Error(v.error);return v;}
      const execution=client.createTavernScriptExecutionModule({rpc,invalidate(){}});
      execution.sync(id,${JSON.stringify(view)});
      const timer=setInterval(async()=>{const s=await rpc('status');if(s.ready||s.initializationError){clearInterval(timer);output.textContent=s.initializationError||'MVU 已就绪';document.querySelector('#run').disabled=false;}},100);
      document.querySelector('#run').onclick=async()=>{document.querySelector('#run').disabled=true;try{output.textContent='PASS\\n'+JSON.stringify(await rpc('run'),null,2);}catch(e){output.textContent='FAIL: '+e.message;}};
      </script>`)
  } catch (error) { res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message })) }
})
server.listen(0, '127.0.0.1', () => console.log('MVU_INITIALIZATION_SMOKE_URL=http://127.0.0.1:' + server.address().port))
