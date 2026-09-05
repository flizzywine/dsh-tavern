// Real opening/profile components and initialization, isolated from user data and model calls.
// DSH_ROOT=/path/to/installed/dsh node tests/fixtures/user-profile-sidebar-ui.mjs
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createUserPreferenceProfile } from '../../tavern-plugin/lib/domain/user-preference-profile.js'
import { initializationFixture } from './conversation-initialization.mjs'

let stored, current, sequence = 0
const profile = createUserPreferenceProfile({ store: {
  readJson: async () => structuredClone(stored),
  updateJson: async (_path, update) => { stored = await update(structuredClone(stored)); return structuredClone(stored) }
} })
const draft = await profile.saveDraft({ summary: '演示偏好', injectionText: '偏好慢热但持续推进。' })
await profile.confirm({ draftRevision: draft.draft.revision, confirmation: '确认保存用户画像' })
const fixture = initializationFixture({ userPreferenceProfile: profile })
const require = createRequire(join(process.env.DSH_ROOT, 'node_modules/@deepseek-ai/dsh-client-ui-trajectory/package.json'))
const source = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const opening = source.slice(source.indexOf('const openingChoice ='), source.indexOf('const playPicker ='))
const profileComponent = source.slice(source.indexOf('function UserPreferenceProfileTab('), source.indexOf('function createUserPreferenceProfileFeatureModule('))
let script = 'const modules={};\n'
for (const [name, file] of [['react', 'react.production.js'], ['scheduler', 'scheduler.production.js'], ['react-dom', 'react-dom.production.js'], ['react-dom/client', 'react-dom-client.production.js']]) {
  script += `modules[${JSON.stringify(name)}]=(()=>{const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${await readFile(join(dirname(require.resolve(name)), 'cjs', file), 'utf8')}\nreturn module.exports;})();\n`
}
script += `const React=modules.react,h=React.createElement;
const usePersistentError=()=>React.useState('');
const tavernDataChangeAffects=()=>true;
const notifyTavernDataChanged=()=>window.dispatchEvent(new Event('dsh-tavern-data-changed'));
async function rpc(method,args){const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({method,args})});const value=await r.json();if(value.error)throw Error(value.error);return value;}
${profileComponent}
function Opening(){
 const [openingPicker,setOpeningPicker]=React.useState({card:{name:'演示人物卡',path:'cards/one.json'},userName:'你',index:0,openings:[{id:'primary',usesUser:true,projection:{text:'你来到一座安静的小镇。'}},{id:'alternate:0',usesUser:true,projection:{text:'你推开了书店的门。'}}]});
 const [busy,setBusy]=React.useState(false),[result,setResult]=React.useState('');
 const selectedOpening=openingPicker&&openingPicker.openings[openingPicker.index];
 const playPrewarmRef={current:{cancel(){}}},closePicker=()=>setOpeningPicker(null);
 const renderTavernProjection=projection=>h('p',null,projection.text);
 async function newConversation(card,mode,openingId,userName){setBusy(true);try{const r=await rpc('startChat',{openingId,userName});setResult('新游戏画像：'+(r.enabled?'已启用':'未启用'));notifyTavernDataChanged();}finally{setBusy(false);}}
 ${opening}
 return h('section',{'aria-label':'游戏准备'},openingChoice,h('p',{role:'status'},result));
}
function App(){const [task,setTask]=React.useState('');React.useEffect(()=>{const listener=()=>setTask('已请求建立画像工作台');window.addEventListener('dsh-tavern-open-user-profile-task',listener);return()=>window.removeEventListener('dsh-tavern-open-user-profile-task',listener);},[]);return h(React.Fragment,null,h('h1',null,'画像入口验证 · 隔离演示'),h('main',null,h(Opening),h('aside',{'aria-label':'右侧栏'},h(UserPreferenceProfileTab,{scope:{sessionId:'demo'}}),h('p',{role:'status'},task))));}
modules['react-dom/client'].createRoot(document.querySelector('#app')).render(h(App));`
const css = await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const page = `<!doctype html><meta charset="utf-8"><title>画像入口隔离验证</title><style>${css}
body{font:16px system-ui;background:#1d1d1d;color:#eee;padding:24px}main{display:grid;grid-template-columns:2fr 1fr;gap:32px}section,aside{padding:20px;border:1px solid #555;border-radius:12px}button,input,textarea{font:inherit}button{cursor:pointer}input,textarea{color:#eee;background:#333}h1{font-size:20px}.dsh-tavern-user-profile{position:static}@media(max-width:700px){main{grid-template-columns:1fr}}</style><div id="app"></div><script>${script.replaceAll('</script', '<\\/script')}</script>`
const server = createServer(async (req, res) => {
  if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page)
  if (req.url !== '/rpc') return res.writeHead(404).end()
  try {
    let raw = ''; for await (const chunk of req) raw += chunk
    const { method, args } = JSON.parse(raw)
    if (method === 'startChat') {
      current = await fixture.make().start({ ...fixture.input, ...args, sessionId: 'demo-' + ++sequence })
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ enabled: current.userProfileEnabled }))
    }
    if (method === 'setUserPreferenceProfileDefaultEnabled') await profile.setDefaultEnabled(args.enabled)
    else if (method === 'updateUserPreferenceProfile') await profile.updateConfirmed(args)
    else if (method !== 'getUserPreferenceProfile') throw Error('Unknown method')
    const value = await profile.read()
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      userProfile: { ...value, confirmedRevision: value.confirmed?.profileRevision || 0 },
      currentConversation: current ? { enabled: current.userProfileEnabled, revision: current.userProfileRevision } : null
    }))
  } catch (error) { res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message })) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
console.log(`http://127.0.0.1:${server.address().port}/`)
process.on('SIGINT', () => server.close(() => process.exit(0)))
