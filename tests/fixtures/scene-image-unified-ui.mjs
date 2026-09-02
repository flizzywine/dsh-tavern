// Real Tavern settings component + built plugin, fake DSH persistence/credentials.
// All supplier traffic is intercepted. Never loads user data or makes paid calls.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { apply, Config } from '../../tavern-plugin/packages/dsh-image-gen/lib/index.js'
import { createPluginSceneImageSettings } from '../../tavern-plugin/lib/domain/scene-image-plugin-settings.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const requests = [], keys = new Map([['XAI_API_KEY', 'fixture-only']]), services = new Map()
globalThis.fetch = async (url, options) => {
  assert.equal(new URL(url).origin, 'https://api.x.ai')
  requests.push({ path: new URL(url).pathname, method: options.method })
  return Response.json(new URL(url).pathname.endsWith('/api-key')
    ? { api_key_disabled: false, api_key_blocked: false, team_blocked: false }
    : new URL(url).pathname.endsWith('/models') ? { data: [{ id: 'grok-imagine-image-2.0' }, { id: 'fixture-image-model' }] }
      : { data: [{ b64_json: png.toString('base64') }] })
}
let plugin = Config({ provider: 'grok', registerAgentTools: false, saveToWorkspace: false })
let doc = { version: 3, provider: 'grok', enabled: false, providers: {} }
const credentials = { resolve: async key => keys.has(key) ? { value: keys.get(key) } : undefined, set: async (key, value) => keys.set(key, value) }
const settings = { installSection(_ctx, _ns, _schema, _entry, hooks) { hooks.setSource(() => plugin) },
  async update(_ns, patch) { plugin = Config({ ...plugin, ...patch }) } }
const ctx = { credentials, settings, get: name => name === 'settings' ? settings : services.get(name), provide: (name, service) => services.set(name, service),
  inject(names, callback) { if (names.includes('settings')) callback(ctx) }, effect: setup => setup(),
  tools: { register() { throw Error('Tavern must not expose image tools') } }, webServer: { register: () => () => {} }, logger: { warn() {} },
  attachments: { imageLimits: { maxImageBytes: 1024 * 1024, mediaTypes: ['image/png'] }, saveImage: async () => ({ attachmentId: 'fixture', mediaType: 'image/png' }) } }
apply(ctx, plugin)
const setup = createPluginSceneImageSettings({ imagePluginService: () => services.get('tavernImageConfiguration'), credentials: () => credentials,
  store: { readJson: async () => doc, updateJson: async (_key, fn) => { const next = await fn(doc); if (next !== undefined) doc = next } } })
const component = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const source = component.slice(component.indexOf('function SceneImageSettings()'), component.indexOf('function TavernSettingsSection()'))
const css = component.split('const TAVERN_CSS = `')[1].split('`;')[0]
const require = createRequire(new URL('../../dsh-client-ui-trajectory/package.json', pathToFileURL(process.env.DSH_BOOT_MODULE)))
let script = 'const modules={};\n'
for (const [name, file] of [['react', 'react.production.js'], ['react/jsx-runtime', 'react-jsx-runtime.production.js'], ['scheduler', 'scheduler.production.js'], ['react-dom', 'react-dom.production.js'], ['react-dom/client', 'react-dom-client.production.js']]) {
  script += `modules[${JSON.stringify(name)}]=(()=>{const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${await readFile(join(dirname(require.resolve(name)), 'cjs', file), 'utf8')}\nreturn module.exports;})();\n`
}
script += `const React=modules.react;async function rpc(method,args){const r=await fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,args})});const d=await r.json();if(d.error)throw Error(d.error);return d;}\n${source}\nmodules['react-dom/client'].createRoot(document.querySelector('#app')).render(React.createElement(SceneImageSettings));`
const page = `<!doctype html><meta charset="utf-8"><title>Tavern 统一生图设置（模拟验证）</title><style>:root{--dsw-alias-border-l2:#ddd;--dsw-specific-sidebar-fill:#f9fafb;--dsw-alias-text-primary:#222;--dsw-alias-brand-primary:#985e2c}body{font:16px sans-serif;max-width:780px;margin:32px auto;padding:16px}${css}</style><div id="app"></div><script>${script.replaceAll('</script', '<\\/script')}</script>`
const server = createServer(async (req, res) => {
  if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page)
  if (req.url === '/evidence') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ requests, plugin, doc, keyPresent: keys.has('XAI_API_KEY') }))
  try {
    let raw = ''; for await (const chunk of req) raw += chunk
    const { method, args } = JSON.parse(raw)
    const result = method === 'getSceneImageSettings' ? { settings: await setup.settings(args?.provider) }
      : method === 'saveSceneImageSettings' ? { settings: await setup.configure(args) }
        : method === 'testSceneImageConnection' ? await setup.testConnection(args)
          : method === 'listSceneImageModels' ? await setup.listModels(args) : { error: 'Unknown method' }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
  } catch (error) { res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message })) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
console.log(`Unified settings fixture: http://127.0.0.1:${server.address().port}/`)
process.on('SIGINT', () => server.close(() => process.exit(0)))
