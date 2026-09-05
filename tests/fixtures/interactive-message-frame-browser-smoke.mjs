import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
let descriptor
vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console })
const client = descriptor.factory(function () { return {} })
const token = 'interactive-browser-token'
const documentHtml = client.buildTavernFrameDocument({
  token,
  turn: 1,
  helperContext: {
    lifecycleRevision: 1,
    messages: [{ role: 'assistant', variables: { stat_data: {} } }],
    turnMessageIds: { 1: 0 }
  },
  content: `<main id="result">RUNNING</main><script>(async function () {
    try {
      await deleteWorldbookEntries('群星的资料库 v4.0', function (entry) { return entry.name === 'USER档案'; });
      await createWorldbookEntries('群星的资料库 v4.0', [{ name: 'USER档案', content: '新档案', strategy: { type: 'constant' } }]);
      await triggerSlash('/send 开始冒险|/trigger');
      await updateVariablesWith(function (variables) { variables.stat_data.ready = true; return variables; }, { type: 'message', message_id: 0 });
      document.querySelector('#result').textContent = 'PASS';
      parent.postMessage({ type: 'interactive-smoke-proof', token: ${JSON.stringify(token)} }, '*');
    } catch (error) {
      document.querySelector('#result').textContent = 'FAIL ' + error.message;
    }
  })();<\/script>`
})

const server = createServer(function (request, response) {
	if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return }
	if (request.url && request.url.startsWith('/api/dsh-tavern/vendor/runtime-assets/')) {
		response.setHeader('access-control-allow-origin', '*')
		if (request.url.endsWith('/zod/index.mjs')) {
			response.setHeader('content-type', 'text/javascript')
			response.end('export {};')
			return
		}
		response.writeHead(204)
		response.end()
		return
	}
  if (request.url !== '/') { response.writeHead(404); response.end(); return }
  response.setHeader('content-type', 'text/html;charset=utf-8')
  response.end(`<!doctype html><title>Interactive message smoke</title><h1 id="proof">RUNNING</h1><iframe id="card" sandbox="allow-scripts"></iframe><script>
    const token = ${JSON.stringify(token)};
    const entries = [{ uid: 7, name: 'USER档案', content: '旧档案' }, { uid: 8, name: '保留', content: '保留' }];
    let nextUid = 9;
    const calls = [];
    addEventListener('message', function (event) {
      const data = event.data;
      if (!data || data.token !== token) return;
      if (data.type === 'interactive-smoke-proof') {
        const names = entries.map(function (entry) { return entry.name; });
        document.querySelector('#proof').textContent = calls.join(' > ') + ' | ' + names.join(',');
        return;
      }
      if (data.type !== 'dsh-tavern-helper-call') return;
      calls.push(data.method);
      let result = {};
      if (data.method === 'getTavernHelperWorldbook') result = { worldbook: { name: data.args.name, entries: structuredClone(entries) } };
      else if (data.method === 'replaceTavernHelperWorldbook') {
        entries.splice(0, entries.length, ...data.args.entries.map(function (entry) { return Object.assign({ uid: entry.uid || nextUid++ }, entry); }));
        result = { worldbook: { name: data.args.name, entries: structuredClone(entries) } };
      } else if (data.method === 'triggerTavernSlash') result = { submitted: true };
      else if (data.method === 'updateTavernHelperVariables') result = { updated: true };
      else { event.source.postMessage({ type: 'dsh-tavern-helper-response', token, requestId: data.requestId, ok: false, error: 'unexpected ' + data.method }, '*'); return; }
      event.source.postMessage({ type: 'dsh-tavern-helper-response', token, requestId: data.requestId, ok: true, result }, '*');
    });
    document.querySelector('#card').srcdoc = ${JSON.stringify(documentHtml).replace(/</g, '\\u003c')};
  <\/script>`)
})

server.listen(0, '127.0.0.1', function () { console.log('http://127.0.0.1:' + server.address().port) })
function close() { server.close(function () { process.exit(0) }) }
process.on('SIGINT', close)
process.on('SIGTERM', close)
