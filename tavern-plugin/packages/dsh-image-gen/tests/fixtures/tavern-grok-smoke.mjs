// Build first. No external API or user credentials; fake image server on loopback.
// TAVERN_ROOT=/path/dsh-tavern node tests/fixtures/tavern-grok-smoke.mjs
// Optional DSH_BOOT_MODULE=/path/dsh-app-boot/lib/index.js + BROWSER_SMOKE=1 serves real plugin UI.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const { apply } = await import(process.env.IMAGE_PLUGIN_ENTRY ? pathToFileURL(process.env.IMAGE_PLUGIN_ENTRY).href : new URL('../../lib/index.js', import.meta.url).href)

const root = process.env.TAVERN_ROOT
if (!root) throw Error('Set TAVERN_ROOT to the Tavern checkout')
const { createSceneImagePlugin } = await import(pathToFileURL(join(root, 'tests/fixtures/upstream-image-plugin.mjs')))
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const attachment = { attachmentId: 'sha256:fixture', mediaType: 'image/png', bytes: png.length, width: 1, height: 1 }
const routes = new Map(), calls = []
let page = ''
const server = createServer(async (req, res) => {
  if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page)
  if (req.url === '/xai/images/generations') {
    let body = ''; for await (const chunk of req) body += chunk
    calls.push(JSON.parse(body))
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }))
  }
  const route = routes.get(req.url)
  if (route) return route(req, res)
  res.writeHead(404).end()
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const ctx = {
  tools: { register() {} }, effect: fn => fn(), inject() {},
  credentials: { resolve: async () => ({ value: 'fixture-only-key' }) },
  attachments: { imageLimits: { maxImageBytes: 1024 * 1024, mediaTypes: ['image/png'] },
    saveImage: async input => { assert.deepEqual(Buffer.from(input.data), png); return attachment } },
  webServer: { register: ({ path, handler }) => { routes.set(path, handler); return () => routes.delete(path) } }, logger: { warn() {} }
}
apply(ctx, { registerAgentTools: false, provider: 'grok', grokBaseURL: `http://127.0.0.1:${port}/xai`, saveToWorkspace: false })
try {
  const bridge = createSceneImagePlugin({ webServer: () => ({ port }), attachments: () => ({ readImage: async () => ({ data: png, mediaType: 'image/png' }) }) })
  const active = await bridge.resolve({ provider: 'dsh-image-gen' })
  assert.equal(active.pluginProvider, 'grok')
  assert.equal(active.pluginReady, true)
  assert.equal(calls.length, 0, 'configuration does not generate')
  const image = await bridge.generate({ ...active, prompt: 'A quiet mountain lake' })
  assert.deepEqual(image.data, png)
  assert.equal(image.attachment.attachmentId, attachment.attachmentId)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].resolution, '1k')
  assert.equal(calls[0].response_format, 'b64_json')
  console.log('PASS: Tavern -> built plugin Studio -> mock Grok -> DSH attachment; one request, no external API')
  if (process.env.BROWSER_SMOKE === '1') {
    const require = createRequire(new URL('../../dsh-client-ui-trajectory/package.json', pathToFileURL(process.env.DSH_BOOT_MODULE)))
    let script = 'const modules={};\n'
    for (const [name, file] of [['react', 'react.production.js'], ['react/jsx-runtime', 'react-jsx-runtime.production.js'], ['scheduler', 'scheduler.production.js'], ['react-dom', 'react-dom.production.js'], ['react-dom/client', 'react-dom-client.production.js']]) {
      const source = await readFile(join(dirname(require.resolve(name)), 'cjs', file), 'utf8')
      script += `modules[${JSON.stringify(name)}]=(()=>{const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${source}\nreturn module.exports;})();\n`
    }
    script += `window.__ModuleLoader__={load:d=>window.plugin=d.factory(name=>modules[name])};\n` + await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
    script += `
const listeners=new Set();let settings={provider:'google',openaiModel:'existing-openai',grokModel:'grok-imagine-image-2.0',saveToWorkspace:false};
const scope={getSnapshot:()=>({value:settings}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},set:async(k,v)=>{settings={...settings,[k]:v};for(const fn of listeners)fn();document.querySelector('#evidence').textContent=JSON.stringify(settings)}};
const credentials={describe:async()=>({ok:true,value:{}}),set:async()=>({ok:true})};
plugin.apply({settingsScope:{bind:()=>scope},get:()=>undefined,effect:fn=>fn(),inject:()=>{},slots:{register:()=>()=>{},inject:()=>{}}});
modules['react-dom/client'].createRoot(document.querySelector('#app')).render(modules.react.createElement(plugin.ImageGenerationSettingsCard,{scope,credentials}));`
    page = `<!doctype html><meta charset="utf-8"><title>Grok 插件设置验证（模拟）</title><style>body{font:16px sans-serif;padding:32px;max-width:850px;margin:auto}#app{list-style:none}</style><ul id="app"></ul><pre id="evidence">No writes</pre><script>${script.replaceAll('</script', '<\\/script')}</script>`
    console.log(`Browser fixture: http://127.0.0.1:${port}/`)
    process.on('SIGINT', () => server.close(() => process.exit(0)))
  } else server.close()
} catch (error) { server.close(); throw error }
