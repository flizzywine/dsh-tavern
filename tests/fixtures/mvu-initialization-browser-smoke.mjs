// Real browser loader, execution lease, event gate and settlement. Only the model
// and persistence are isolated. ?mode=manual|auto|unsafe|json covers recovery/diagnostics.
import { createServer } from 'node:http'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { readOfficialMvuBundle, createOfficialMvuBundleReader } from '../../tavern-plugin/lib/domain/official-mvu-assets.js'
import { createMvuDiagnosticStore, createMvuDiagnosticExport, sanitizeMvuLoadDiagnostic } from '../../tavern-plugin/lib/domain/mvu-diagnostics.js'
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
const records = new Map()
const diagnostics = createMvuDiagnosticStore({ readJson: async key => records.get(key), updateJson: async (key, update) => { records.set(key, update(records.get(key))) } })
const failingReader = createOfficialMvuBundleReader({ read: async () => { throw Object.assign(new Error("ENOENT: open 'C:\\Users\\PRIVATE_USER\\bundle.js'; apiKey=SECRET_VALUE"), { code: 'ENOENT' }) } })
function state(id) {
  if (!states.has(id)) {
    const variables = { stat_data: { hp: 10 }, schema: { type: 'object', properties: { hp: { type: 'number' } } }, display_data: {}, delta_data: {}, initialized_lorebooks: {} }
    states.set(id, { downloads: 0, writes: 0, hpWrites: 0, resumes: 0, calls: 0, chat: { id, sessionId: id, mode: 'story', mvu: { enabled: true, owner: 'official' },
      messages: [{ role: 'assistant', text: '测试正文', swipeId: 0, swipes: ['测试正文'], variables: [variables] }] } })
  }
  return states.get(id)
}
const adapter = createTavernScriptHostAdapter({ resolveChat: async id => state(id).chat,
  writeChat: async chat => {
    const s = state(chat.id)
    if (s.chat.messages[0].variables[0].stat_data.hp !== chat.messages[0].variables[0].stat_data.hp) s.hpWrites++
    s.writes++; s.chat = structuredClone(chat)
  },
  readCard: async () => ({ name: '测试卡' }), worldBooks: { bound: async () => null }, eventGate: gate })
const settlement = createMvuSettlementModule({ runtime: adapter, model: { async run(request) {
  const s = state(request.sessionId)
  await request.onToolCall({ name: 'posture_submit', arguments: { posture: '站立' } })
  s.calls++
  s.feedback = JSON.parse(await request.onToolCall({ name: 'mvu_submit_update', arguments: { operations: [{ op: 'replace', path: '/hp', value: 9 }] } }))
  return {}
} } })
function settlementInput(id) {
  const s = state(id)
  return { sessionId: id, operationId: 'op', chatId: id, branchId: 'b', basedOnRevision: 0,
    messageId: 0, swipeId: 0, storyText: '测试正文', currentVariables: s.chat.messages[0].variables[0] }
}
async function resume(id) {
  const s = state(id)
  if (!s.pending || s.resuming || !gate.status(id).ready) return
  s.resuming = true
  s.resumes++
  try {
    s.result = await settlement.resumeVariables({ ...settlementInput(id), submission: s.pending })
    assert.equal(s.result.receipt.status, 'updated')
    assert.equal(s.chat.messages[0].variables[0].stat_data.hp, 9)
    assert.equal(s.calls, 1)
    // Core initializes its schema once before settlement; count game mutations separately.
    assert.equal(s.hpWrites, 1)
    assert.equal(s.resumes, 1)
    s.pending = null
  } catch (error) { s.resumeError = error.message } finally { s.resuming = false }
}
gate.subscribeReady(sessionId => { void resume(sessionId) })
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (url.pathname === '/client.js') return res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }).end(client)
    if (url.pathname === '/mvu.js') {
      const id = url.searchParams.get('id'), s = state(id); s.downloads++
      if (id.startsWith('json')) {
        try { await failingReader.read() } catch (error) {
          return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: error.message, body: 'DO_NOT_LOG_BODY' }))
        }
      }
      const fail = id.startsWith('manual') ? !s.available : id.startsWith('auto') && s.downloads < 3
      const body = id.startsWith('unsafe') ? 'window.partialWrites=(window.partialWrites||0)+1;throw Error("partial initialization");' : bundle.body
      return res.writeHead(fail ? 503 : 200, { 'content-type': bundle.mediaType }).end(fail ? 'unavailable' : body)
    }
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
      else if (method === 'recover') { state(sessionId).available = true; result = { available: true } }
      else if (method === 'recordMvuRuntimeDiagnostic' && args.diagnostic?.kind === 'mvu-load') {
        const diagnostic = sanitizeMvuLoadDiagnostic(args.diagnostic)
        if (diagnostic) await diagnostics.record(sessionId, { stage: 'mvu-load', diagnostic })
      }
      else if (method === 'diagnostics') {
        const log = await diagnostics.read(sessionId)
        const zip = await createMvuDiagnosticExport({ sessionId, store: diagnostics, environment: { mvuAsset: failingReader.inspect() } })
        const text = zip.buffer.toString()
        assert.doesNotMatch(text, /PRIVATE_USER|SECRET_VALUE|DO_NOT_LOG_BODY/)
        if (sessionId.startsWith('json')) {
          assert.match(text, /json-error/)
          assert.match(text, /ENOENT/)
          assert.match(text, /execution-failed/)
          assert.match(text, /read-failed/)
          assert.equal(state(sessionId).downloads, 1)
          assert.equal(state(sessionId).writes, 0)
        }
        result = { pass: true, zipBytes: zip.buffer.length, records: log.records }
      }
      else if (method === 'status') {
        const s = state(sessionId)
        result = { ...gate.status(sessionId), downloads: s.downloads, calls: s.calls, writes: s.writes, hpWrites: s.hpWrites, resumes: s.resumes,
          hp: s.chat.messages[0].variables[0].stat_data.hp, receipt: s.result?.receipt, resumeError: s.resumeError }
      }
      else if (method === 'run') {
        const s = state(sessionId); s.writes = 0
        const resultState = await settlement.settleVariables(settlementInput(sessionId))
        const failed = /^(unsafe|json)/.test(sessionId), waiting = !gate.status(sessionId).ready && !failed
        assert.equal(resultState.receipt.status, failed ? 'error' : waiting ? 'pending' : 'updated')
        assert.equal(s.chat.messages[0].variables[0].stat_data.hp, failed || waiting ? 10 : 9)
        assert.equal(s.writes, failed || waiting ? 0 : 1)
        assert.equal(s.calls, 1)
        if (failed) { assert.equal(s.feedback.retryable, false); assert.match(JSON.stringify(resultState.receipt), sessionId.startsWith('json') ? /Unexpected token/ : /partial initialization/) }
        s.result = resultState
        if (waiting) { s.pending = resultState.submission; void resume(sessionId) }
        result = { pass: true, hp: s.chat.messages[0].variables[0].stat_data.hp, writes: s.writes, calls: s.calls, receipt: resultState.receipt }
      }
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
    }
    const mode = url.searchParams.get('mode') || 'normal', id = mode + (url.searchParams.has('sandbox') ? '-sandbox' : '-trusted')
    const view = { chatId: id, card: { name: '测试卡' }, tavernHelper: projectTavernHelperContext(state(id).chat),
      tavernRuntimePolicy: { trustedCardMode: !url.searchParams.has('sandbox') }, tavernHelperScripts: [],
      tavernMvuRuntime: { owner: 'official', assetUrl: '/mvu.js?id=' + id } }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><title>MVU 初始化验证</title>
      <div id="recovery"></div><button id="network">恢复下载服务</button><button id="run" disabled>验证结算</button><button id="diagnostics">验证诊断包</button><pre id="logs"></pre><pre id="result">加载中</pre>
      <script>
      const react={createElement(tag,props,...children){const node=document.createElement(tag);for(const [key,value] of Object.entries(props||{})){if(key==='onClick')node.onclick=value;else if(key==='style')Object.assign(node.style,value);else if(key==='className')node.className=value;else node.setAttribute(key,value);}for(const child of children)if(child!==null&&child!==false)node.append(child);return node;}};
      window.__ModuleLoader__={load(d){window.client=d.factory(name=>name==='react'?react:{});}};</script><script src="/client.js"></script>
      <script>
      const id=${JSON.stringify(id)},output=document.querySelector('#result');
      async function rpc(method,args={},sessionId=id){const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({method,args,sessionId})});const v=await r.json();if(!r.ok)throw Error(v.error);return v;}
      const execution=client.createTavernScriptExecutionModule({rpc,invalidate(){},onMvuLoadState(state){const node=client.TavernMvuLoadRecovery({state,retry(){execution.retryMvuLoad();}});document.querySelector('#recovery').replaceChildren(...(node?[node]:[]));}});
      execution.sync(id,${JSON.stringify(view)});
      let ran=false;const timer=setInterval(async()=>{const s=await rpc('status');output.textContent=JSON.stringify(s,null,2);if(!ran&&(s.ready||s.initializationError||s.downloads>=3))document.querySelector('#run').disabled=false;},100);
      document.querySelector('#network').onclick=()=>rpc('recover');
      document.querySelector('#diagnostics').onclick=async()=>{try{document.querySelector('#logs').textContent=JSON.stringify(await rpc('diagnostics'),null,2);}catch(e){document.querySelector('#logs').textContent='FAIL: '+e.message;}};
      document.querySelector('#run').onclick=async()=>{ran=true;document.querySelector('#run').disabled=true;try{await rpc('run');}catch(e){clearInterval(timer);output.textContent='FAIL: '+e.message;}};
      </script>`)
  } catch (error) { res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message })) }
})
server.listen(0, '127.0.0.1', () => console.log('MVU_INITIALIZATION_SMOKE_URL=http://127.0.0.1:' + server.address().port))
