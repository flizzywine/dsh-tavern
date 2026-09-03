// Real settings and mode-switch render code, isolated from user data and models.
// DSH_ROOT=/path/to/installed/dsh node tests/fixtures/compatibility-retirement-ui.mjs
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { applyTavernSettingsPatch, presentTavernSettings } from '../../tavern-plugin/lib/domain/tavern-settings.js'

const require = createRequire(join(process.env.DSH_ROOT, 'node_modules/@deepseek-ai/dsh-client-ui-trajectory/package.json'))
const source = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
let script = 'const modules={};\n'
for (const [name, file] of [['react', 'react.production.js'], ['scheduler', 'scheduler.production.js'], ['react-dom', 'react-dom.production.js'], ['react-dom/client', 'react-dom-client.production.js']]) {
  script += `modules[${JSON.stringify(name)}]=(()=>{const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${await readFile(join(dirname(require.resolve(name)), 'cjs', file), 'utf8')}\nreturn module.exports;})();\n`
}
const settings = source.slice(source.indexOf('function TavernSettingsSection()'), source.indexOf('function SystemPromptSidebarTab()'))
const switchStart = source.indexOf('h("div", { className: "dsh-tavern-mode-switch" }')
const modeSwitch = source.slice(switchStart, source.indexOf('h("button", { className: "dsh-tavern-side-new"', switchStart)).trim().replace(/,$/, '')
script += `const React=modules.react;const h=React.createElement;
async function rpc(method,args){const response=await fetch('/rpc',{method:'POST',body:JSON.stringify({method,args})});const value=await response.json();if(value.error)throw Error(value.error);return value;}
${settings}
function ModeSwitch(){const [uiMode,setMode]=React.useState('play');const requestMode='dsh',busy=false;const switchMode=setMode;const switchPlayRequestMode=()=>setMode('play');return ${modeSwitch};}
modules['react-dom/client'].createRoot(document.querySelector('#app')).render(h(React.Fragment,null,h(ModeSwitch),h(TavernSettingsSection)));
`
const css = source.split('const TAVERN_CSS = `')[1].split('`;')[0]
const page = `<!doctype html><meta charset="utf-8"><title>兼容模式关闭验证</title><style>body{font:16px sans-serif;max-width:680px;margin:40px auto;color:#222}${css}</style><div id="app"></div><script>${script.replaceAll('</script', '<\\/script')}</script>`
let document = { compatibilityMode: true, unknown: 'preserved' }
const server = createServer(async (req, res) => {
  if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page)
  try {
    let raw = ''; for await (const chunk of req) raw += chunk
    const { method, args } = JSON.parse(raw)
    if (method === 'updateTavernSettings') document = applyTavernSettingsPatch(document, args.patch)
    else if (method !== 'getTavernSettings') throw Error('Unknown method')
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ settings: presentTavernSettings(document, {}), modelCatalog: [], releaseCapabilities: { sceneImages: false } }))
  } catch (error) { res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message })) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
console.log(`http://127.0.0.1:${server.address().port}/`)
process.on('SIGINT', () => server.close(() => process.exit(0)))
