// The real 世界书库 tab (built client.js) on one isolated fixture book, with the real resource update behind a tiny RPC server.
// Prints its URL; a browser test opens it.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { inspectWorldBookDocument, updateWorldBookDocument } from '../../tavern-plugin/lib/domain/worldbook-resource.js'
import { browserReactScript } from './browser-react.mjs'

let document = { name: '世界书改造验证', entries: {
  0: { uid: 0, comment: '角色库开头', content: '<角色库>', constant: true, order: 10, position: 0 },
  1: { uid: 1, comment: 'Alice', content: 'Alice 在钟楼值班。', key: ['Alice'], order: 20, position: 0 },
  2: { uid: 2, comment: '角色库结尾', content: '</角色库>', constant: true, order: 30, position: 0 }
} }
let revision = 1
const source = { kind: 'standalone', path: 'worldbooks/fixture.json' }
const record = () => ({ source, view: inspectWorldBookDocument(document), revision: String(revision), globalEnabled: false })
const css = await readFile(new URL('../../tavern-plugin/lib/client-assets/theme.css', import.meta.url), 'utf8') + '\n' + await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const client = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const mount = `window.__ModuleLoader__={load(d){window.client=d.factory(name=>name==='react'?modules.react:{});}};`
const start = `(() => {
  let library, tab = { id: 'wb-tab', meta: { worldBookSource: ${JSON.stringify(source)} } }
  const root = modules['react-dom/client'].createRoot(document.querySelector('main'))
  const ctx = {
    effect(run, label) { if (label === 'dsh-tavern: Better Sidebar worldbook library tab') return run() },
    inject() { return { dispose() {} } }, get() {}, provide() {}, slots: {}, tavernSessionSignals: { subscribe() { return () => {} } },
    betterSidebar: { registerTab(spec) { library = spec.component }, updateTab(id, patch) { tab = { ...tab, ...patch }; render() } }
  }
  const render = () => root.render(modules.react.createElement(library, { tab, scope: { sessionId: 'fixture' }, ctx, visible: true }))
  window.client.apply(ctx)
  render()
})()`
const script = body => `<script>${body.replaceAll('</script', '<\\/script')}</script>`
const page = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>世界书编辑验证</title><style>${css}\nhtml,body{margin:0;height:100%}main{height:100vh;display:flex;flex-direction:column}</style>` +
  `<body data-fk-context="chat-dark"><main></main>${script(await browserReactScript())}${script(mount)}${script(client)}${script(start)}</body></html>`
const server = createServer(async (req, res) => {
  if (req.method === 'GET') return req.url === '/' ? res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page) : res.writeHead(404).end()
  let body = ''
  for await (const chunk of req) body += chunk
  const method = new URL(req.url, 'http://fixture').pathname.split('/').at(-1), args = body ? JSON.parse(body) : {}
  const answer = json => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, ...json }))
  if (method === 'listWorldBooks') return answer({ standalone: [{ path: source.path, name: document.name, entryCount: 3, enabledCount: 3, globalEnabled: false, importedAt: 1 }], embedded: [] })
  if (method === 'getWorldBook') return answer(args.ifRevision === String(revision) ? { unchanged: true } : record())
  if (method === 'getWorldBookAssociations') return answer({ associations: { cards: [], boundCards: [], conflict: false } })
  if (method === 'updateWorldBook') {
    try { document = updateWorldBookDocument(document, args.update).document; revision++ } catch (error) { return res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: error.message })) }
    return answer(record())
  }
  answer({})
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
console.log(`http://127.0.0.1:${server.address().port}/`)
process.on('SIGINT', () => server.close(() => process.exit(0)))
