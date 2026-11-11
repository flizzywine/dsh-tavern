// node tests/browser/opening-setup-template-sandbox-browser-smoke.mjs [--serve] [--port N] [--cdp URL]
// The template tier of opening setup v2 (docs/specs/opening-setup-v2.md §4) in real Chromium: a hostile template is compiled
// by the host, mounted with sandbox="allow-same-origin" only, and must run nothing, load nothing and navigate nowhere, while
// the page's own controls inside it still change values and <dsh-value>. --serve keeps the page open; --cdp runs the same checks in a
// remote browser, e.g. Android Chrome/WebView: adb reverse tcp:N tcp:N, adb forward tcp:9555 localabstract:chrome_devtools_remote, --port N --cdp http://127.0.0.1:9555.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { compileOpeningTemplate } from '../../tavern-plugin/lib/domain/opening-setup.js'
import { openingThemeVariables } from '../../tavern-plugin/lib/domain/opening-setup.js'

const pluginRequire = createRequire(new URL('../../tavern-plugin/package.json', import.meta.url))
const hostRequire = createRequire(pluginRequire.resolve('@deepseek-ai/dsh-tools'))
const reactDomClient = hostRequire.resolve('react-dom/client')
const reactRequire = createRequire(reactDomClient)
const reactFile = reactRequire.resolve('react'), reactDomFile = reactRequire.resolve('react-dom')
const modules = new Map()
async function bundle(file) {
  if (modules.has(file)) return
  modules.set(file, '')
  let code = await readFile(file, 'utf8')
  const local = createRequire(file)
  for (const match of [...code.matchAll(/require\(['"]([^'"]+)['"]\)/g)]) {
    const target = match[1] === 'react' ? reactFile : local.resolve(match[1])
    await bundle(target)
    code = code.replaceAll(match[0], 'require(' + JSON.stringify(target) + ')')
  }
  modules.set(file, 'function(module,exports,require){' + code + '\n}')
}
await bundle(reactFile); await bundle(reactDomFile); await bundle(reactDomClient)
const libraries = 'const process={env:{NODE_ENV:"production"}};const modules={' + [...modules].map(([file, code]) => JSON.stringify(file) + ':' + code).join(',') + '};const cache={};function require(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](m,m.exports,require);return m.exports;}'
  + 'const React=require(' + JSON.stringify(reactFile) + ');const ReactDOM=Object.assign({},require(' + JSON.stringify(reactDomFile) + '),require(' + JSON.stringify(reactDomClient) + '));'
const source = path => readFile(new URL('../../tavern-plugin/src/client/' + path, import.meta.url), 'utf8')
const css = (await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')) + (await readFile(new URL('../../tavern-plugin/lib/client-assets/theme.css', import.meta.url), 'utf8'))

const hostile = [
  '<html><head><base href="https://evil.invalid/"><meta http-equiv="refresh" content="0;url=https://evil.invalid/"><link rel="stylesheet" href="https://evil.invalid/x.css"></head><body>',
  '<h1 class="t">契约申请书</h1><script>parent.__pwned = 1; window.__pwned = 1</script><img src=x onerror="parent.__pwned=2">',
  '<a id="js" href="javascript:parent.__pwned=3">js</a><a id="top" href="https://evil.invalid/" target="_top">top</a>',
  '<form action="https://evil.invalid/"><button id="submit">提交</button></form><iframe srcdoc="<script>parent.parent.__pwned=4</script>"></iframe>',
  '<style>@import url(https://evil.invalid/a.css); .t{background:url(https://evil.invalid/t.png)}</style>',
  '<label>称呼</label><dsh-field key="name"></dsh-field><dsh-field key="city"></dsh-field>',
  '<p id="echo">草案：<dsh-value key="name" fallback="（待填写）"></dsh-value> · <dsh-value key="city" part="label"></dsh-value></p>',
  '<dsh-start id="go">交易成立</dsh-start></body></html>'
].join('\n')
const spec = { version: 2, title: '契约申请书', theme: { accent: '#e8578f' }, template: hostile, message: '{name}{city}',
  fields: [{ key: 'name', type: 'name', label: '你的称呼' }, { key: 'city', type: 'choice', label: '初始城市', options: [{ value: 'a', label: '东港市' }, { value: 'b', label: '西岭市' }] }] }
const setup = { ...spec, style: openingThemeVariables(spec.theme), fields: [{ ...spec.fields[0], default: '小林' }, spec.fields[1]], template: compileOpeningTemplate(spec, { userName: '小林' }) }

const page = `<!doctype html><html><head><meta charset="utf-8"><title>开局模板沙箱</title><style>${css}</style></head><body class="dsh-tavern-root">
<div id="root"></div><pre id="log"></pre>
<script>${libraries}
${await source('inline-field.js')}
${await source('spinner.js')}
${await source('features/opening-setup-form.js')}
${await source('features/opening-setup-template.js')}
window.__starts = [];
// The greeting frame behind the form records what the form sends it.
function Greeting() { return React.createElement('iframe', { className: 'dsh-tavern-message-frame', srcDoc: '<script>addEventListener("message", e => parent.__starts.push(e.data))<\\/script>' }); }
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(OpeningSetupForm, { setup: ${JSON.stringify(setup)}, card: { path: 'cards/a.json', hasImage: false } }, React.createElement(Greeting)));

</script></body></html>`

const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(req.url === '/' ? page : '') })
const option = name => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1] }
await new Promise(resolve => server.listen(Number(option('--port') || 0), '127.0.0.1', resolve))
const url = 'http://127.0.0.1:' + server.address().port + '/'
if (process.argv.includes('--serve')) { console.log(url); await new Promise(() => {}) }

const { chromium } = await import('playwright')
const remote = option('--cdp')
const browser = remote ? await chromium.connectOverCDP(remote) : await chromium.launch({ headless: true, args: ['--mute-audio'] })
const failures = []
let tab
try {
  tab = remote ? await browser.contexts()[0].newPage() : await browser.newPage()
  const requests = [], errors = []
  tab.on('request', request => { if (request.url() !== url && !request.url().startsWith('data:') && request.url() !== 'about:srcdoc') requests.push(request.url()) })
  tab.on('pageerror', error => errors.push(String(error)))
  await tab.goto(url)
  await tab.waitForSelector('iframe.dsh-opening-template')
  const frame = tab.frameLocator('iframe.dsh-opening-template')
  await frame.locator('dsh-field[key="name"] input').waitFor({ timeout: 10000 })
  const sandbox = await tab.getAttribute('iframe.dsh-opening-template', 'sandbox')
  if (sandbox !== 'allow-same-origin') failures.push('sandbox is ' + sandbox)
  if (!/^\s*小林\s*$/.test(await frame.locator('dsh-value[key="name"]').textContent())) failures.push('dsh-value did not show the default name')
  await frame.locator('dsh-field[key="name"] input').fill('环彩羽')
  await frame.locator('dsh-field[key="name"] input').press('Enter')
  await frame.locator('dsh-field[key="city"] [role="radio"]').nth(1).click()
  await tab.waitForTimeout(200)
  const echo = await frame.locator('#echo').textContent()
  if (!/环彩羽/.test(echo) || !/西岭市/.test(echo)) failures.push('controls did not reach <dsh-value>: ' + echo)
  for (const id of ['#js', '#top']) await frame.locator(id).click({ force: true, timeout: 2000 }).catch(() => {})
  await frame.locator('#submit').click({ timeout: 2000 }).catch(() => {})
  await frame.locator('#go').click()
  await tab.waitForTimeout(500)
  const state = await tab.evaluate(() => ({ parent: window.__pwned, child: document.querySelector('iframe.dsh-opening-template').contentWindow.__pwned, href: location.href,
    childHref: document.querySelector('iframe.dsh-opening-template').contentWindow.location.href, starts: window.__starts.length }))
  if (state.parent !== undefined || state.child !== undefined) failures.push('a script ran: ' + JSON.stringify(state))
  if (state.href !== url || state.childHref !== 'about:srcdoc') failures.push('navigated: ' + JSON.stringify(state))
  const starts = await tab.evaluate(() => JSON.parse(JSON.stringify(window.__starts)))
  if (starts.length !== 1 || JSON.stringify(starts[0]) !== JSON.stringify({ type: 'dsh-tavern-opening-setup-start', values: { name: '环彩羽', city: 'b' } })) failures.push('<dsh-start> did not send one start: ' + JSON.stringify(starts))
  if (requests.length) failures.push('network requests: ' + requests.join(', '))
  if (errors.length) failures.push('page errors: ' + errors.join(' | '))
  const html = await tab.evaluate(() => document.querySelector('iframe.dsh-opening-template').contentDocument.documentElement.outerHTML)
  if (/<script|<iframe|<form|<base|http-equiv="refresh"|onerror=|javascript:/i.test(html.replace(/<style[\s\S]*?<\/style>/g, ''))) failures.push('hostile markup survived compilation')
  const agent = await tab.evaluate(() => navigator.userAgent)
  console.log(JSON.stringify({ ok: failures.length === 0, agent, sandbox, echo: echo.trim(), state, requests, failures }))
} finally {
  if (remote) await tab?.close()
  await browser.close()
  // A remote browser keeps its connections alive; close them so the process exits.
  server.closeAllConnections()
  server.close()
}
process.exitCode = failures.length ? 1 : 0
