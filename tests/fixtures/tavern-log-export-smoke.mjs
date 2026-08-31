// Isolated UI check: actual export component, simulated Session, real ZIP builder.
// Does not open or mutate a user's Tavern conversation.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createMvuDiagnosticExport, createMvuDiagnosticStore } from '../../tavern-plugin/lib/domain/mvu-diagnostics.js'

const source = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function TavernConversationExportAction(')
const component = source.slice(start, source.indexOf('function TavernCompactionAction(', start))
const state = new Map()
const store = createMvuDiagnosticStore({ readJson: async key => state.get(key), updateJson: async (key, update) => state.set(key, update(state.get(key))) })
await store.record('fixture', { stage: 'runtime-completed', diagnosticId: 'fixture:1', diagnostics: [{ level: 'warn', message: '测试警告' }] })
const archive = await createMvuDiagnosticExport({ sessionId: 'fixture', store, persistence: { readRaw: async () => ({ content: '{"type":"session","id":"fixture"}\n' }) } })
const html = `<!doctype html><meta charset="utf-8"><style>
body{font:16px system-ui;padding:48px;background:#fff;--dsw-alias-border-l2:#ddd;--dsw-alias-label-primary:#16181b}
header{display:flex;gap:12px;align-items:center;border-bottom:1px solid #eee;padding:16px}h1{font-size:20px;margin-right:auto}
.fixture_sessionLogButton{display:inline-flex}.dsh-tavern-export-action{border:1px solid #ddd;border-radius:18px;background:white;padding:6px 12px;height:32px}
</style><header><h1>DSH Tavern · 日志验证</h1><button class="fixture_sessionLogButton">Session 日志 ↓</button><span id="actions"></span></header><pre id="result">等待点击“日志”</pre><script>
let hookIndex=0;
const React={Fragment:'fragment',useState(){const value=hookIndex++===0;return [value,()=>{}]},useEffect(){},createElement(type,props,...children){
const node=type==='fragment'?document.createDocumentFragment():['svg','path'].includes(type)?document.createElementNS('http://www.w3.org/2000/svg',type):document.createElement(type);
for(const [key,value] of Object.entries(props||{})){if(key==='onClick')node.addEventListener('click',value);else if(key==='className')node.setAttribute('class',value);else if(value!==false&&value!=null)node.setAttribute(key.replace('strokeWidth','stroke-width').replace('strokeLinecap','stroke-linecap').replace('strokeLinejoin','stroke-linejoin'),value===true?'':value)}
for(const child of children.flat(Infinity))if(child!=null&&child!==false)node.append(child instanceof Node?child:document.createTextNode(String(child)));return node}};
const tavernErrorHub={report(_source,error){document.querySelector('#result').textContent='FAIL: '+error.message}};
async function rpc(method){if(method!=='exportTavernLogs')throw Error('unexpected RPC');const response=await fetch('/archive');const data=await response.json();document.querySelector('#result').textContent='PASS: 已生成 ZIP，包含 Session 与 MVU 记录';return data}
document.addEventListener('click',event=>{if(event.target.matches('a[download]')){event.preventDefault();document.querySelector('#result').textContent+='；已触发下载：'+event.target.download}});
${component}
document.querySelector('#actions').append(TavernConversationExportAction({sessionId:'fixture'}));
</script>`
const server = createServer((req, res) => {
  if (req.url === '/archive') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ filename: archive.filename, base64: archive.buffer.toString('base64') })); return }
  res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html)
})
server.listen(0, '127.0.0.1', () => console.log('Log export fixture: http://127.0.0.1:' + server.address().port))
