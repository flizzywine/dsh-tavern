import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execute = promisify(execFile)
const proxyModule = new URL('../bin/system-proxy.mjs', import.meta.url).href
const updaterModule = new URL('../tavern-plugin/lib/application-updater.js', import.meta.url).href
const proxyKey = /^(https?_proxy|all_proxy|no_proxy|node_use_env_proxy)$/i

// A real CONNECT proxy routes an unresolvable fixture host to a local origin.
// Run in a child so global dispatcher changes cannot affect other tests.
for (const mode of ['system', 'environment', 'lowercase', 'all-proxy', 'native']) {
  test(`Node fetch and updater use ${mode} proxy and preserve localhost bypass`, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-proxy-fetch-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const requests = []
    const origin = http.createServer((request, response) => {
      requests.push(request.url)
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(request.url === '/commit' ? { sha: 'a'.repeat(40) } : { version: '3.2.0' }))
    })
    await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve))
    t.after(() => { origin.closeAllConnections(); origin.close() })
    const tunnels = []
    const sockets = new Set()
    const proxy = http.createServer()
    proxy.on('connect', (request, client, head) => {
      tunnels.push(request.url)
      const upstream = net.connect(origin.address().port, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        client.pipe(upstream).pipe(client)
      })
      for (const socket of [client, upstream]) {
        sockets.add(socket)
        socket.on('close', () => sockets.delete(socket))
        socket.on('error', () => { client.destroy(); upstream.destroy() })
      }
    })
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
    t.after(() => { for (const socket of sockets) socket.destroy(); proxy.close() })
    const proxyUrl = `http://127.0.0.1:${proxy.address().port}`
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !proxyKey.test(key) && key !== 'NODE_OPTIONS'))
    if (mode === 'environment' || mode === 'native') Object.assign(env, { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NO_PROXY: '127.0.0.1', NODE_USE_ENV_PROXY: '1' })
    if (mode === 'lowercase') Object.assign(env, { http_proxy: proxyUrl, https_proxy: proxyUrl, no_proxy: '127.0.0.1', NODE_USE_ENV_PROXY: '0' })
    if (mode === 'all-proxy') Object.assign(env, { ALL_PROXY: proxyUrl, NO_PROXY: '127.0.0.1' })
    await execute(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import http from 'node:http';
      import { createRequire } from 'node:module';
      import { applySystemProxy } from ${JSON.stringify(proxyModule)};
      import { createApplicationUpdater } from ${JSON.stringify(updaterModule)};
      // Force the Node 22 branch even on newer CI runtimes. The native branch
      // delegates to a real agent too, so both paths must actually carry bytes.
      http.setGlobalProxyFromEnv = ${mode === 'native' ? `(env) => {
        assert.equal(env.HTTPS_PROXY, ${JSON.stringify(proxyUrl)});
        const { EnvHttpProxyAgent, setGlobalDispatcher } = createRequire(${JSON.stringify(import.meta.url)})('undici');
        setGlobalDispatcher(new EnvHttpProxyAgent({ httpProxy: env.HTTP_PROXY, httpsProxy: env.HTTPS_PROXY, noProxy: env.NO_PROXY }));
      }` : 'undefined'};
      const result = applySystemProxy(process.env, { platform: 'darwin', exec() {
        assert.equal(${JSON.stringify(mode)}, 'system', 'explicit environment proxy must skip system discovery');
        return '  HTTPEnable : 1\\n  HTTPProxy : 127.0.0.1\\n  HTTPPort : ${proxy.address().port}\\n';
      } });
      assert.equal(result.source, ${JSON.stringify(mode === 'system' ? 'system' : 'environment')});
      assert.equal(result.activationFailed, undefined);
      const updater = createApplicationUpdater({
        sourceRoot: ${JSON.stringify(root)}, dataRoot: ${JSON.stringify(path.join(root, 'data'))}, runtimeHost: 'cli',
        readLocalIdentity: async () => ({ currentVersion: '3.2.0', currentCommit: 'a'.repeat(40) }),
        versionUrl: 'http://update-fixture.invalid/version', commitUrl: 'http://update-fixture.invalid/commit',
        cdnMetadataUrl: 'http://update-fixture.invalid/cdn',
      });
      const status = await updater.check();
      assert.equal(status.phase, 'up-to-date', status.error);
      assert.equal(status.checkSource, 'github');
      const local = await fetch('http://127.0.0.1:${origin.address().port}/bypass', { signal: AbortSignal.timeout(3000) });
      assert.equal(local.status, 200);
      await local.text();
    `], { env, timeout: 15000 })
    assert.ok(tunnels.length > 0)
    assert.ok(tunnels.every(authority => authority === 'update-fixture.invalid:80'), 'localhost must bypass the proxy')
    for (const file of ['/version', '/commit', '/cdn', '/bypass']) assert.ok(requests.includes(file), file)
  })
}
