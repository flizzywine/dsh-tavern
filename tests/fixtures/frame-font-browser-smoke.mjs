// Real React + Tavern iframe, no model calls or user data. Open the printed URL
// with Playwright. DSH_FONT_SMOKE_ROOT points to the installed DSH package.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const dsh = process.env.DSH_FONT_SMOKE_ROOT
if (!dsh) throw new Error('Set DSH_FONT_SMOKE_ROOT to the installed DSH package')
const require = createRequire(path.join(dsh, 'node_modules/@deepseek-ai/dsh-client-ui-trajectory/package.json'))
const names = ['react', 'scheduler', 'react-dom', 'react-dom/client']
const files = ['react.production.js', 'scheduler.production.js', 'react-dom.production.js', 'react-dom-client.production.js']
let bundle = 'const modules={};\n'
for (let i = 0; i < names.length; i++) {
  const text = await readFile(path.join(path.dirname(require.resolve(names[i])), 'cjs', files[i]), 'utf8')
  bundle += `modules[${JSON.stringify(names[i])}]=(function(){const module={exports:{}},exports=module.exports,require=name=>modules[name];\n${text}\nreturn module.exports;})();\n`
}
const source = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const content = `<style>
  #fixed{font-size:20px!important;line-height:28px} #nested{font-size:1.2em}
  #title{font-size:2rem} #image{width:4em;height:2em} #control{width:160px;height:48px}
  @media(max-width:400px){#fixed{font-size:18px!important}}
</style>
<h2 id="title">标题</h2><p id="plain">默认正文</p>
<p id="fixed">固定字号 <span id="nested">嵌套正文</span></p>
<img id="image" alt="尺寸测试" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='50'%3E%3C/svg%3E">
<button id="control">固定尺寸按钮</button><div id="dynamic"></div>
<script>window.boots=(window.boots||0)+1;</script>`
const script = `${bundle}
window.__ModuleLoader__={load(d){window.client=d.factory(name=>modules[name]||{});}};
${source}
const React=modules.react, reports=[];window.reports=reports;
const root=modules['react-dom/client'].createRoot(document.querySelector('#app'));
const content=${JSON.stringify(content)};
root.render(React.createElement(React.Fragment,null,...[true,false].map(trusted=>React.createElement(client.TavernMessageFrame,{key:String(trusted),content,eager:true,persistent:true,trustedCardMode:trusted,sessionId:'fixture',turn:1,runtimeReporting:true}))));
addEventListener('message',event=>{if(event.data?.type==='dsh-tavern-frame-runtime')reports.push(event.data.runtime)});
document.querySelector('#increase').onclick=()=>document.body.style.setProperty('--dsh-content-font-size','17px');
document.querySelector('#reset').onclick=()=>document.body.style.setProperty('--dsh-content-font-size','14px');
`
const server = createServer((req, res) => {
  if (req.url === '/runner.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(script); return }
  if (req.url !== '/') { res.writeHead(200, { 'Content-Type': 'text/css' }); res.end(''); return }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end('<!doctype html><meta charset="utf-8"><title>iframe 字号验证</title><style>body{--dsh-content-font-size:14px;padding:24px;font-family:system-ui}.dsh-tavern-message-frame{border:1px solid #ccc;width:100%}.dsh-tavern-message-frame-slot{margin-top:16px}</style><button id="increase">字号17</button><button id="reset">字号14</button><p>上方信任 iframe，下方沙盒 iframe</p><div id="app"></div><script src="/runner.js"></script>')
})
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port))
