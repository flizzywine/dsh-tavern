import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { download, downloadFile, downloadRuntime, DownloadError } = require('../bin/download.cjs')
const moduleFile = fileURLToPath(new URL('../bin/download.cjs', import.meta.url))
const execute = promisify(execFile)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

// Routes: path -> (req, res) handler. Returns base URL.
async function serve(t, routes) {
  const hits = new Map()
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url)
    hits.set(url, (hits.get(url) || 0) + 1)
    const handler = routes[url] || routes['*']
    if (!handler) { res.writeHead(404); res.end('missing'); return }
    handler(req, res, hits.get(url))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  return { base: `http://127.0.0.1:${server.address().port}`, hits }
}

// Sends `bytes` in `pieces` chunks, one every `interval` ms.

const hang = (req, res) => { res.writeHead(200, { 'content-length': 10 }); res.write('a') }

test('HTTP and connection failures keep the attempt history and underlying cause', async t => {
  const { base } = await serve(t, {})
  await assert.rejects(download([`${base}/missing`], { retryDelayMs: 1, attempts: 3 }), error => {
    assert.match(error.message, /missing 下载失败（已尝试 3 次）：HTTP 404/)
    assert.equal(error.cause.status, 404)
    return true
  })
  const closed = createServer()
  await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve))
  const port = closed.address().port
  await new Promise(resolve => closed.close(resolve))
  await assert.rejects(download([`http://127.0.0.1:${port}/x`], { retryDelayMs: 1, attempts: 1 }), error => {
    assert.match(error.reason, /连接被拒绝（ECONNREFUSED）/)
    assert.ok(error.cause)
    return true
  })
  const cause = new Error('connection reset')
  await assert.rejects(download(['https://example.invalid/a'], { retryDelayMs: 1, attempts: 2, fetch: async () => { throw cause } }),
    error => error.cause === cause && /connection reset/.test(error.message))
})

async function runtimeFixture(t, files, handler) {
  const root = await mkdtemp(path.join(tmpdir(), 'download-runtime-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const revision = 'c'.repeat(40)
  const listed = [...files].map(([file, bytes]) => ({ path: file, sha256: sha(bytes), size: bytes.length }))
  listed.push({ path: 'docs/private.md', sha256: 'a'.repeat(64) }, { path: 'patches/../escape.txt', sha256: 'a'.repeat(64) })
  const metadata = { schemaVersion: 2, revision, files: listed }
  const prefix = `/repo@${revision}/`
  const server = await serve(t, {
    '/manifest': (req, res) => res.end(JSON.stringify(metadata)),
    '*': (req, res, count) => {
      const url = decodeURIComponent(req.url)
      const bytes = url.startsWith(prefix) ? files.get(url.slice(prefix.length)) : undefined
      if (!bytes) { res.writeHead(404); res.end(); return }
      handler ? handler(req, res, bytes, url.slice(prefix.length), count) : res.end(bytes)
    },
  })
  return { root, metadata, ...server, args: { metadataUrl: `${server.base}/manifest`, rootUrl: `${server.base}/repo` } }
}

test('runtime download filters, reuses installed files, retries and writes the manifest', async t => {
  const files = new Map(Array.from({ length: 9 }, (_, n) => [`bin/文件 ${n}.js`, Buffer.from(`contents-${n}`)]))
  const { root, metadata, hits, args } = await runtimeFixture(t, files, (req, res, bytes, file, count) => {
    if (file === 'bin/文件 1.js' && count === 1) { res.writeHead(503); res.end(); return }
    res.end(bytes)
  })
  await mkdir(path.join(root, 'installed/bin'), { recursive: true })
  await writeFile(path.join(root, 'installed/bin/文件 0.js'), 'contents-0')
  const status = []
  await downloadRuntime({ ...args, destination: path.join(root, 'out'), installed: path.join(root, 'installed'), status: m => status.push(m) })
  for (const [file, bytes] of files) assert.deepEqual(await readFile(path.join(root, 'out', file)), bytes)
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'out/dsh-tavern-runtime.json'), 'utf8')), metadata)
  assert.equal(hits.get(`/repo@${metadata.revision}/bin/文件 0.js`), undefined, 'verified installed file is reused')
  assert.equal(hits.get(`/repo@${metadata.revision}/bin/文件 1.js`), 2)
  assert.ok(![...hits.keys()].some(url => /docs|escape/.test(url)), 'excluded paths are never requested')
  assert.ok(status.some(m => /HTTP 503.*尝试 1\/2，正在重试/.test(m)))
  assert.match(status.at(-1), /9\/9 文件，复用 1/)
})

test('CLI reports failures in Chinese with a nonzero exit code', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'download-cli-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bytes = Buffer.from('cli')
  const { base } = await serve(t, { '/ok': (req, res) => res.end(bytes), '/stall': hang })
  await execute(process.execPath, [moduleFile, 'file', path.join(directory, 'ok'), '--sha256', sha(bytes), `${base}/ok`])
  assert.deepEqual(await readFile(path.join(directory, 'ok')), bytes)
  await assert.rejects(execute(process.execPath, [moduleFile, 'file', path.join(directory, 'stall'), '--stall', '0.2', '--attempts', '1', `${base}/stall`]),
    error => error.code === 1 && /stall 下载失败（已尝试 1 次）：0\.2 秒没有收到数据/.test(error.stderr))
  await assert.rejects(execute(process.execPath, [moduleFile, 'nope']), error => /未知命令/.test(error.stderr))
})

test('runtime download bounds parallel requests and never writes corrupt files', async t => {
  const files = new Map(Array.from({ length: 12 }, (_, n) => [`bin/p${n}.js`, Buffer.from(`p${n}`)]))
  let active = 0, maximum = 0
  const { root, args } = await runtimeFixture(t, files, (req, res, bytes, file) => {
    active++; maximum = Math.max(maximum, active)
    setTimeout(() => { active--; res.end(file === 'bin/p7.js' ? 'corrupt' : bytes) }, 30)
  })
  await assert.rejects(downloadRuntime({ ...args, destination: path.join(root, 'out'), concurrency: 4 }), /bin\/p7\.js 下载失败（已尝试 2 次）：SHA-256 校验不符/)
  assert.ok(maximum > 1 && maximum <= 4, `bounded parallelism: ${maximum}`)
  await assert.rejects(readFile(path.join(root, 'out/bin/p7.js')), { code: 'ENOENT' })
  await assert.rejects(readFile(path.join(root, 'out/dsh-tavern-runtime.json')), { code: 'ENOENT' })
})

test('Windows system proxy becomes standard proxy variables', () => {
  const { proxyEnvironment, applyProxyEnvironment } = require('../bin/download.cjs')
  const windows = settings => ({ platform: 'win32', readSettings: () => settings })
  assert.deepEqual(proxyEnvironment({}, windows({ ProxyEnable: '0x1', ProxyServer: '127.0.0.1:7890', ProxyOverride: 'localhost;127.*;*.lan;intranet;<local>' })), {
    added: { HTTP_PROXY: 'http://127.0.0.1:7890', HTTPS_PROXY: 'http://127.0.0.1:7890', NO_PROXY: 'localhost,127.0.0.1,::1,.lan,intranet', NODE_USE_ENV_PROXY: '1' },
    source: 'system', summary: '127.0.0.1:7890',
  })
  const perScheme = proxyEnvironment({ no_proxy: 'corp' }, windows({ ProxyEnable: '0x1', ProxyServer: 'http=127.0.0.1:8080;https=http://user:pw@10.0.0.2:8443;socks=127.0.0.1:1080' }))
  assert.equal(perScheme.added.HTTP_PROXY, 'http://127.0.0.1:8080')
  assert.equal(perScheme.added.HTTPS_PROXY, 'http://user:pw@10.0.0.2:8443')
  assert.equal(perScheme.added.NO_PROXY, undefined, 'existing NO_PROXY in any case is kept')
  assert.equal(perScheme.summary, '10.0.0.2:8443', 'summary never shows credentials')
  assert.equal(proxyEnvironment({}, windows({ ProxyEnable: '0x1', ProxyServer: 'socks=127.0.0.1:1080' })).source, 'unsupported')
  assert.equal(proxyEnvironment({}, windows({ ProxyEnable: '0x0', ProxyServer: '127.0.0.1:7890', AutoConfigURL: 'http://127.0.0.1/pac' })).source, 'pac')
  assert.deepEqual(proxyEnvironment({}, windows({ ProxyEnable: '0x0', ProxyServer: '127.0.0.1:7890' })), { added: {}, source: null })
  assert.deepEqual(proxyEnvironment({}, { platform: 'win32', readSettings: () => { throw new Error('no reg') } }), { added: {}, source: null })
  assert.deepEqual(proxyEnvironment({}, { platform: 'darwin', readSettings: () => assert.fail('registry is Windows only') }), { added: {}, source: null })
  // A user-provided proxy wins; only Node's opt-in is added.
  assert.deepEqual(proxyEnvironment({ https_proxy: 'http://corp:3128' }, windows({ ProxyEnable: '0x1', ProxyServer: '127.0.0.1:7890' })).added, { NODE_USE_ENV_PROXY: '1' })
  assert.deepEqual(proxyEnvironment({ HTTPS_PROXY: 'http://corp:3128', node_use_env_proxy: '1' }).added, {})
  const env = {}
  applyProxyEnvironment(env, windows({ ProxyEnable: '0x1', ProxyServer: '127.0.0.1:7890' }))
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7890')
})

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
// NODE_USE_ENV_PROXY exists since Node 22.21 / 24.0; older Node ignores it (curl and git still use the variables).
test('downloads honour proxy variables through NODE_USE_ENV_PROXY', { skip: nodeMajor === 22 && nodeMinor < 21 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'download-proxy-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const seen = []
  const proxy = createServer((req, res) => { seen.push(req.url); res.end('via proxy') })
  // undici tunnels plain HTTP through CONNECT as well; answer with a tiny upstream.
  const upstream = createServer((req, res) => { seen.push(`upstream ${req.url}`); res.end('via proxy') })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  proxy.on('connect', (req, socket) => {
    seen.push(`CONNECT ${req.url}`)
    const target = require('node:net').connect(upstream.address().port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); target.pipe(socket); socket.pipe(target)
    })
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  t.after(() => { proxy.closeAllConnections(); proxy.close(); upstream.closeAllConnections(); upstream.close() })
  const env = { ...process.env, NODE_USE_ENV_PROXY: '1', HTTP_PROXY: `http://127.0.0.1:${proxy.address().port}`, NO_PROXY: '' }
  // An unroutable host proves the request never left through a direct connection.
  await execute(process.execPath, [moduleFile, 'file', path.join(directory, 'out'), '--stall', '5', '--attempts', '1', 'http://unreachable.test/file'], { env })
  assert.equal(await readFile(path.join(directory, 'out'), 'utf8'), 'via proxy')
  assert.ok(seen.some(entry => entry.includes('unreachable.test')), seen.join('\n'))
})

test('jsDelivr 运行清单：各节点取最新的发布序号；都比安装器旧时明确提示稍后重试；指定清单时只用它', async () => {
  const { readManifest, manifestCandidates } = require('../bin/download.cjs')
  const manifest = (version, releaseSequence) => ({ schemaVersion: 2, revision: String(releaseSequence).padStart(40, 'a'), releaseSequence, version,
    files: [{ path: 'package.json', sha256: 'b'.repeat(64), size: 1 }] })
  const url = 'https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/dsh-tavern-runtime.json'
  const serveNodes = nodes => async request => {
    const body = nodes[new URL(String(request.url || request)).hostname]
    return body ? new Response(JSON.stringify(body)) : new Response('missing', { status: 404 })
  }
  // 主源是 raw：jsDelivr 的 @branch 别名最长缓存 12 小时，raw 按分支直读。
  assert.deepEqual(manifestCandidates(url).map(each => new URL(each).hostname),
    ['raw.githubusercontent.com', 'cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net'])
  assert.equal(manifestCandidates(url)[0], 'https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/dsh-tavern-runtime.json')
  // 分发分支名回溯到源码分支。
  assert.equal(manifestCandidates('https://cdn.jsdelivr.net/gh/o/r@runtime-archive-main/dsh-tavern-runtime.json')[0],
    'https://raw.githubusercontent.com/o/r/main/dsh-tavern-runtime.json')
  assert.deepEqual(manifestCandidates(url, true), [url])
  assert.deepEqual(manifestCandidates('http://127.0.0.1:1/repo@main/dsh-tavern-runtime.json'), ['http://127.0.0.1:1/repo@main/dsh-tavern-runtime.json'])

  const status = []
  const newest = await readManifest({ metadataUrl: url, minVersion: '3.0.0', stallMs: 1000, attempts: 1, status: m => status.push(m),
    fetch: serveNodes({ 'cdn.jsdelivr.net': manifest('2.7.0', 90), 'fastly.jsdelivr.net': manifest('3.0.0', 120), 'gcore.jsdelivr.net': manifest('3.0.0', 110) }) })
  assert.equal(newest.releaseSequence, 120, '同一版本里也取发布序号最大的')
  assert.match(status.join('\n'), /fastly\.jsdelivr\.net/)

  // raw 比所有 CDN 节点新时，直接用 raw（这正是 CDN 缓存滞后时的情况）。
  const fresh = await readManifest({ metadataUrl: url, minVersion: '3.0.0', stallMs: 1000, attempts: 1, status: m => status.push(m),
    fetch: serveNodes({ 'raw.githubusercontent.com': manifest('3.1.0', 130), 'cdn.jsdelivr.net': manifest('2.7.0', 90),
      'fastly.jsdelivr.net': manifest('2.7.0', 91), 'gcore.jsdelivr.net': manifest('2.7.0', 92) }) })
  assert.equal(fresh.releaseSequence, 130)
  assert.equal(fresh.version, '3.1.0')
  assert.match(status.join('\n'), /raw\.githubusercontent\.com/)

  await assert.rejects(readManifest({ metadataUrl: url, minVersion: '3.0.0', stallMs: 1000, attempts: 1,
    fetch: serveNodes({ 'cdn.jsdelivr.net': manifest('2.7.0', 90), 'fastly.jsdelivr.net': manifest('2.7.0', 91) }) }),
  error => error.code === 'DSH_TAVERN_CDN_STALE' && /还没更新到 v3\.0\.0，当前只有 v2\.7\.0.*稍后|重试/.test(error.message))

  const pinned = 'https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@7f7372c2/dsh-tavern-runtime.json'
  const asked = []
  const exact = await readManifest({ metadataUrl: pinned, exact: true, minVersion: '3.0.0', stallMs: 1000, attempts: 1,
    fetch: async request => { asked.push(String(request.url || request)); return new Response(JSON.stringify(manifest('3.0.0', 100))) } })
  assert.equal(exact.version, '3.0.0')
  assert.deepEqual(asked, [pinned], '指定的清单不换节点')
})

// A minimal zip writer for tests (stored or deflated entries, UTF-8 names).
function zipOf(entries) {
  const { deflateRawSync } = require('node:zlib')
  const locals = [], centrals = []
  let offset = 0
  for (const [name, bytes, deflate] of entries) {
    const data = deflate ? deflateRawSync(bytes) : bytes
    const nameBytes = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8)
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(deflate ? 8 : 0, 10)
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data); centrals.push(central, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

test('运行时压缩包：只下一个文件，逐个核对后写出；压缩包坏了就退回逐个文件下载', async t => {
  const { unzipEntries } = require('../bin/download.cjs')
  const files = new Map([['bin/入口.js', Buffer.from('a'.repeat(5000))], ['tavern-plugin/lib/x.js', Buffer.from('small')]])
  const zip = zipOf([...files].map(([name, bytes], index) => [name, bytes, index === 0]).concat([['tavern-plugin/', Buffer.alloc(0), false]]))
  assert.deepEqual([...unzipEntries(zip)].map(([name, bytes]) => [name, bytes.toString()]), [...files].map(([name, bytes]) => [name, bytes.toString()]))

  for (const broken of [false, true]) {
    const root = await mkdtemp(path.join(tmpdir(), 'download-archive-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const revision = 'd'.repeat(40), commit = 'e'.repeat(40)
    const served = broken ? Buffer.from(zip).fill(0, 0, 4) : zip
    const metadata = { schemaVersion: 2, revision, files: [...files].map(([file, bytes]) => ({ path: file, sha256: sha(bytes), size: bytes.length })),
      archive: { commit, path: 'runtime.zip', sha256: sha(zip), size: zip.length } }
    const { base, hits } = await serve(t, {
      '/manifest': (req, res) => res.end(JSON.stringify(metadata)),
      [`/repo@${commit}/runtime.zip`]: (req, res) => res.end(served),
      '*': (req, res) => {
        const file = decodeURIComponent(req.url).slice(`/repo@${revision}/`.length)
        if (!files.has(file)) { res.writeHead(404); res.end(); return }
        res.end(files.get(file))
      }
    })
    const status = []
    await downloadRuntime({ metadataUrl: `${base}/manifest`, rootUrl: `${base}/repo`, destination: path.join(root, 'out'), attempts: 1, status: m => status.push(m) })
    for (const [file, bytes] of files) assert.deepEqual(await readFile(path.join(root, 'out', file)), bytes)
    const perFile = [...hits.keys()].filter(url => url.includes(`@${revision}/`)).length
    if (broken) {
      assert.equal(perFile, files.size, '压缩包坏了就逐个文件下载')
      assert.ok(status.some(m => /代码压缩包不可用.*改为逐个文件下载/.test(m)))
    } else {
      assert.equal(perFile, 0, '有压缩包时不再逐个请求文件')
      assert.match(status.at(-1), /代码已就绪：2 个文件/)
    }
  }
})
