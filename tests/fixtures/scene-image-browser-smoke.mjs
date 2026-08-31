// Real renderer + real DSH child Agent/tools/attachment store + local image HTTP API.
// DSH_BOOT_MODULE=/path/dsh-app-boot/lib/index.js node --expose-internals tests/fixtures/scene-image-browser-smoke.mjs
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createSceneImageNativeRuntime } from './scene-image-native-runtime.mjs'

const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE)
await runtime.service.configure({ enabled: false })
const bootUrl = pathToFileURL(process.env.DSH_BOOT_MODULE)
const require = createRequire(new URL('../../dsh-client-ui-trajectory/package.json', bootUrl))
let bundle = 'const modules={};\n'
const modules = ['react', 'scheduler', 'react-dom', 'react-dom/client']
const files = ['react.production.js', 'scheduler.production.js', 'react-dom.production.js', 'react-dom-client.production.js']
for (let i = 0; i < modules.length; i++) {
  const source = await readFile(join(dirname(require.resolve(modules[i])), 'cjs', files[i]), 'utf8')
  bundle += `modules[${JSON.stringify(modules[i])}]=(()=>{const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${source}\nreturn module.exports;})();\n`
}
const client = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
// The real sidebar populates this session metadata cache; this isolated host has
// no sidebar. Seed only that metadata, leaving the registered dock/renderers intact.
const fixtureClient = client.replace('const tavernSessionModes = { values: {},', 'const tavernSessionModes = { values: {"scene-parent":"story"},')
const settingsSource = client.slice(client.indexOf('function SceneImageSettings()'), client.indexOf('function TavernSettingsSection()'))
const css = client.match(/const TAVERN_CSS = `([\s\S]*?)`;/)[1]
const script = `${bundle}
const React=modules.react;
const primitives={MarkdownText:props=>React.createElement('p',null,props.text)};
window.__ModuleLoader__={load(d){window.client=d.factory(name=>modules[name]||primitives);}};
${fixtureClient}
const components={};
client.createTavernAssistantRendererFeatureModule().register({ctx:{effect:fn=>fn()},slots:{inject:(_name,fn)=>fn(),register:(spec,component)=>{components[spec.key]=component;return ()=>{};}}});
const dockSlots={};
client.createPlayControlsFeatureModule().register({ctx:{effect:fn=>fn(),betterSidebar:{registerTab:()=>()=>{}},sessions:{refresh:async()=>{}},remote:{commands:{execute:async()=>({ok:true})}}},slots:{inject:(_name,fn)=>fn(),register:(spec,component)=>{dockSlots[spec.id]=component;return ()=>{};}}});
const root=modules['react-dom/client'].createRoot(document.querySelector('#app'));
const props={sessionId:'scene-parent',node:{data:{status:'completed',blocks:[],finalNode:{seq:1}},location:{kind:'turn',turn:{turn:1,status:'closed'}}},useTurnData:()=>null,fileMentions:()=>undefined};
root.render(React.createElement(components['assistant-step'],props));
modules['react-dom/client'].createRoot(document.querySelector('#dock')).render(React.createElement(dockSlots['dsh-tavern-candidate-actions'],{sessionId:'scene-parent',useSession:select=>select({running:false}),useChat:select=>select({legacy:{nodes:[{kind:'assistant',messageId:'fixture-reply'}]}})}));
const rpc=async(method,args={})=>{const response=await fetch('/api/dsh-tavern/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});const result=await response.json();if(!result.ok)throw Error(result.error);return result;};
${settingsSource}
modules['react-dom/client'].createRoot(document.querySelector('#settings')).render(React.createElement(SceneImageSettings));
document.querySelector('#restart').onclick=async()=>{await rpc('fixtureRestart');location.reload();};
document.querySelector('#swipe').onclick=async()=>{await rpc('fixtureSwipe');location.reload();};
document.querySelector('#fail').onclick=async()=>{await rpc('fixtureFail');location.reload();};
document.querySelector('#evidence').onclick=async()=>{document.querySelector('#result').textContent=JSON.stringify(await rpc('fixtureEvidence'),null,2);};
`
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/runner.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(script); return }
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>场景生图完整流程验证</title><style>:root{--dsw-alias-label-primary:#222;--dsw-alias-label-secondary:#666;--dsw-alias-border-l2:#ddd;--dsw-specific-sidebar-fill:#fff}body{font:16px sans-serif;max-width:880px;margin:32px auto;padding:12px}${css}</style><h1>场景生图验证 · 测试图片</h1><div id="app"></div><div id="dock"></div><textarea aria-label="输入框" placeholder="输入下一步行动"></textarea><hr><div id="settings"></div><hr><button id="restart">模拟重启并刷新</button> <button id="swipe">切换正文版本</button> <button id="fail">下一张模拟失败</button> <button id="evidence">核对调用记录</button><pre id="result"></pre><script src="/runner.js"></script>`)
      return
    }
    const method = url.pathname.split('/').pop()
    if (method === 'scene-image') {
      const image = await runtime.service.readImage('scene-parent', 1, url.searchParams.get('key'), url.searchParams.get('versionId'))
      res.writeHead(200, { 'Content-Type': image.ref.mediaType }).end(image.data); return
    }
    let body = ''; for await (const chunk of req) body += chunk
    const args = body ? JSON.parse(body) : {}
    let result = {}
    if (method === 'getSession') result = { view: { mode: 'story', card: { name: '测试卡' }, replyProjections: [{ version: 2, turn: 1, parts: [{ kind: 'markdown', text: runtime.chat.messages[0].swipes[runtime.chat.messages[0].swipeId] }] }], tavernSwipes: [{ turn: 1, messageId: 0, count: 1, swipeId: runtime.chat.messages[0].swipeId }] } }
    else if (method === 'getSceneImageSettings') result = { settings: await runtime.service.settings(args?.provider) }
    else if (method === 'saveSceneImageSettings') result = { settings: await runtime.service.configure(args) }
    else if (method === 'sceneImageStatus') result = { illustration: await runtime.service.status('scene-parent', 1) }
    else if (method === 'generateSceneImage') result = { illustration: await runtime.service.start('scene-parent', 1, args.key, args) }
    else if (method === 'removeSceneImage') result = { illustration: await runtime.service.removeImage('scene-parent', 1, args.key, args.versionId) }
    else if (method === 'fixtureRestart') await runtime.restart()
    else if (method === 'fixtureSwipe') runtime.chat.messages[0].swipeId = 1 - runtime.chat.messages[0].swipeId
    else if (method === 'fixtureFail') runtime.failNext()
    else if (method === 'fixtureEvidence') result = { modelRequests: runtime.requests.length, imageRequests: runtime.imageRequests.length, parentMessages: runtime.parent.agent.session.events.filter(e => /message/.test(e.type)).length, prompt: runtime.imageRequests.at(-1)?.prompt, status: await runtime.service.status('scene-parent', 1) }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, ...result }))
  } catch (error) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: error.message })) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
console.log('http://127.0.0.1:' + server.address().port)
process.on('SIGINT', async () => { await runtime.dispose(); server.close(); process.exit(0) })
