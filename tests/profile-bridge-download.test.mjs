import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const execute = promisify(execFile)
const library = new URL('../tavern-plugin/packages/dsh-tavern/lib/', import.meta.url)
const proxyKeys = /^(https?_proxy|all_proxy|no_proxy|node_use_env_proxy|node_options)$/i

async function runInstaller(t, setup, env = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tavern-launcher-download-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const pending = join(root, 'install-pending')
  const runtime = join(pending, 'runtime')
  await mkdir(pending)
  await cp(library, runtime, { recursive: true })
  const job = join(pending, 'request.json')
  await writeFile(job, JSON.stringify({ mode: 'install', host: 'desktop', stateDir: root, home: root, pids: [0, 0], stamp: 'test' }))
  const runner = join(root, 'run.mjs')
  await writeFile(runner, `${setup}
    const { runSwitchJob } = await import(${JSON.stringify(pathToFileURL(join(runtime, 'worker.mjs')).href)})
    console.log(await runSwitchJob(${JSON.stringify(job)}))
  `)
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !proxyKeys.test(key)))
  const { stdout } = await execute(process.execPath, [runner], { env: { ...clean, ...env }, timeout: 30000 })
  return {
    code: Number(stdout.trim()),
    result: JSON.parse(await readFile(join(root, 'last-result.json'), 'utf8')),
    log: await readFile(join(root, 'last-run.log'), 'utf8'),
    transcript: await readFile(join(root, 'last-run.log.out'), 'utf8'),
  }
}

test('detached installer uses system proxy, logs sanitized causes and executes the first compatible mirror', async t => {
  const result = await runInstaller(t, `
    import assert from 'node:assert/strict'
    import childProcess from 'node:child_process'
    import http from 'node:http'
    import { syncBuiltinESMExports } from 'node:module'
    childProcess.execFileSync = (command, args) => {
      if (command === 'reg') return '    ProxyEnable    REG_DWORD    0x1\\n    ProxyServer    REG_SZ    127.0.0.1:7890\\n'
      if (command === 'scutil') return '  HTTPEnable : 1\\n  HTTPProxy : 127.0.0.1\\n  HTTPPort : 7890\\n'
      if (command === 'gsettings') return args.at(-1) === 'mode' ? "'manual'" : args.at(-1) === 'host' ? "'127.0.0.1'" : '7890'
      throw new Error('unexpected system proxy query')
    }
    syncBuiltinESMExports()
    let proxyActive = false
    http.setGlobalProxyFromEnv = ({ HTTPS_PROXY }) => {
      assert.equal(HTTPS_PROXY, 'http://127.0.0.1:7890')
      proxyActive = true
      return () => { proxyActive = false }
    }
    globalThis.fetch = async source => {
      assert.equal(proxyActive, true)
      assert.equal(process.env.HTTPS_PROXY, undefined)
      const host = new URL(source).hostname
      if (host === 'cdn.jsdelivr.net') {
        const reasons = ['ENOTFOUND', 'ECONNRESET'].map(code => Object.assign(new Error('http://user:secret@proxy.test'), { code }))
        throw new TypeError('fetch failed', { cause: new AggregateError(reasons) })
      }
      if (host === 'raw.githubusercontent.com') return new Response('unavailable', { status: 503 })
      if (host === 'fastly.jsdelivr.net') return new Response('old script')
      assert.equal(host, 'gcore.jsdelivr.net')
      return new Response(process.platform === 'win32'
        ? '# DSH_TAVERN_INSTALL_INACTIVE\\nWrite-Output $env:HTTPS_PROXY'
        : '# DSH_TAVERN_INSTALL_INACTIVE\\nprintf "%s\\\\n" "$HTTPS_PROXY"')
    }
  `)
  assert.equal(result.code, 0, result.log)
  assert.equal(result.result.status, 'succeeded')
  assert.match(result.log, /cdn\.jsdelivr\.net.*ENOTFOUND.*ECONNRESET/)
  assert.match(result.log, /raw\.githubusercontent\.com.*HTTP 503/)
  assert.match(result.log, /fastly\.jsdelivr\.net.*安装脚本尚未同步/)
  assert.match(result.log, /gcore\.jsdelivr\.net.*下载酒馆安装脚本/)
  assert.doesNotMatch(result.log, /user:secret/)
  assert.equal(result.transcript.trim(), 'http://127.0.0.1:7890')
})

test('older runtimes use curl through the explicit proxy and report proxy HTTP errors', async t => {
  const requests = []
  const proxy = createServer()
  proxy.on('connect', (request, socket) => {
    requests.push(request.url)
    socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => proxy.close(resolve)))
  const result = await runInstaller(t, `
    import http from 'node:http'
    http.setGlobalProxyFromEnv = undefined
  `, { HTTPS_PROXY: `http://user:secret@127.0.0.1:${proxy.address().port}` })
  assert.equal(result.code, 1)
  assert.match(result.result.message, /无法获取可用的酒馆安装脚本.*复制诊断日志/)
  assert.deepEqual(requests, ['cdn.jsdelivr.net:443', 'raw.githubusercontent.com:443', 'fastly.jsdelivr.net:443', 'gcore.jsdelivr.net:443'])
  assert.equal(result.log.match(/HTTP 407/g)?.length, 4)
  assert.doesNotMatch(result.log, /secret/)
  assert.equal(result.transcript, '')
})
