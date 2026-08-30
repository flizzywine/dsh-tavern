import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const root = new URL('../../', import.meta.url)
const clientSource = await readFile(new URL('tavern-plugin/lib/client.js', root), 'utf8')
const officialBundle = await readFile(
  new URL('tavern-plugin/lib/vendor/magvarupdate/host-build/artifact/bundle.js', root)
)

let descriptor
vm.runInNewContext(clientSource, {
  window: { __ModuleLoader__: { load(value) { descriptor = value } } },
  console
})
const client = descriptor.factory(() => ({}))

const initialMvu = {
  stat_data: { 角色: { 络络: { 好感度: 1 } } },
  schema: { type: 'object', properties: {} },
  display_data: {},
  delta_data: {},
  initialized_lorebooks: {}
}

const probe = String.raw`
const output = document.createElement('pre');
output.id = 'official-mvu-smoke-result';
document.body.appendChild(output);
try {
  if (!window.Mvu || typeof window.Mvu.parseMessage !== 'function') throw new Error('Mvu.parseMessage 不存在');
  const before = ${JSON.stringify(initialMvu)};
  const after = await window.Mvu.parseMessage("_.set('角色.络络.好感度', 30); // browser smoke", before);
  const value = _.get(after, 'stat_data.角色.络络.好感度');
  if (value !== 30) throw new Error('parseMessage 结果错误: ' + String(value));
  output.dataset.status = 'pass';
  output.textContent = 'MVU_READY\nPARSE_MESSAGE=30\nCOMPANION_SHARED_INSTANCE=' + String(window.Mvu === window.parent.Mvu);
} catch (error) {
  output.dataset.status = 'fail';
  output.textContent = 'MVU_ERROR: ' + String(error && error.stack || error);
}
`

const document = client.buildTavernHelperScriptDocument({
  token: 'official-mvu-browser-smoke',
  scripts: [
    {
      id: '__dsh_official_mvu__',
      name: '官方 MVU Core',
      system: 'official-mvu',
      content: "await import(new URL('/api/dsh-tavern/vendor/magvarupdate/bundle.js', document.baseURI).href);",
      data: {},
      buttons: []
    },
    {
      id: 'mvu-browser-probe',
      name: '人物卡配套脚本探针',
      content: probe,
      data: {},
      buttons: []
    }
  ],
  context: {
    chatId: 'official-mvu-browser-smoke-chat',
    playerName: '你',
    characterName: '络络',
    character: { name: '络络', data: { name: '络络' } },
    messages: [{
      message_id: 0,
      role: 'assistant',
      message: '开场白',
      swipe_id: 0,
      swipes: ['开场白'],
      variables: initialMvu,
      swipes_data: [initialMvu]
    }],
    chatVariables: initialMvu,
    scriptVariables: {},
    worldbook: null
  }
})

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(document)
    return
  }
  if (url.pathname === '/api/dsh-tavern/vendor/magvarupdate/bundle.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    response.end(officialBundle)
    return
  }
  if (url.pathname === '/version') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ pkgVersion: '1.12.14' }))
    return
  }
  if (url.pathname === '/favicon.ico') {
    response.writeHead(204).end()
    return
  }
  if (url.pathname === '/api/dsh-tavern/static-assets') {
    const target = url.searchParams.get('url')
    if (!target || !/^https:\/\//.test(target)) {
      response.writeHead(400).end('invalid static asset target')
      return
    }
    response.writeHead(302, { location: target, 'cache-control': 'no-store' })
    response.end()
    return
  }
  response.writeHead(404).end('not found')
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  process.stdout.write(`OFFICIAL_MVU_SMOKE_URL=http://127.0.0.1:${address.port}/\n`)
})
