import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import { DEFAULT_BIND_HOST, resolveBindHost, serviceOrigin, isLoopbackHost } from '../bin/service-address.mjs'
import { legacyBindHostMatches, isServiceReady, resolveServiceWebUrl, restartBrowserTarget } from '../bin/service-lifecycle.mjs'

const execute = promisify(execFile)
const launcher = fileURLToPath(new URL('../bin/dsh-tavern.mjs', import.meta.url))
const environmentModule = new URL('../bin/launcher-environment.mjs', import.meta.url).href
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"

test('绑定地址保持本机默认，只接受具体 IP，不接受通配、域名、URL 或 IPv6 scope', () => {
  assert.equal(DEFAULT_BIND_HOST, '127.0.0.1')
  for (const value of [undefined, null, '', '  ']) assert.equal(resolveBindHost(value), DEFAULT_BIND_HOST)
  for (const value of ['127.0.0.2', '192.168.1.10', '100.64.1.2', '::1', 'fd00::1234']) {
    assert.equal(resolveBindHost(value), value)
  }
  for (const value of ['0.0.0.0', '::', '0:0:0:0:0:0:0:0', '::ffff:0.0.0.0', '::ffff:0:0', 'localhost', 'example.com', 'http://127.0.0.1', '127.0.0.1:3081', '[::1]', 'fe80::1%eth0', '256.1.2.3', '127.1', '--host']) {
    assert.throws(() => resolveBindHost(value), /DSH_TAVERN_BIND/, value)
  }
  for (const value of ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopbackHost(value), true, value)
  for (const value of ['192.168.1.10', '100.64.1.2', 'fd00::1234']) assert.equal(isLoopbackHost(value), false, value)
  assert.equal(serviceOrigin('127.0.0.2', 3081), 'http://127.0.0.2:3081')
  assert.equal(serviceOrigin('fd00::1234', 3081), 'http://[fd00::1234]:3081')
  assert.equal(serviceOrigin('192.168.1.10', 80), 'http://192.168.1.10')
  assert.equal(serviceOrigin('fd00::1234', 80), 'http://[fd00::1234]')
})

test('DSH_TAVERN_BIND 只影响 CLI，不改变 desktop / android 默认地址', async () => {
  const probe = host => execute(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(environmentModule)}); console.log(m.CLI_HOST)`], {
    env: { ...process.env, DSH_TAVERN_RUNTIME_HOST: host, DSH_TAVERN_BIND: '100.64.1.2' },
  })
  assert.equal((await probe('cli')).stdout.trim(), '100.64.1.2')
  for (const host of ['desktop', 'android']) assert.equal((await probe(host)).stdout.trim(), DEFAULT_BIND_HOST)
})

test('自检和重启链接使用具体 IPv4/IPv6 地址；探测不会跟随重定向', async () => {
  for (const host of ['192.168.1.10', 'fd00::1234']) {
    const origin = serviceOrigin(host, 3081)
    const calls = []
    assert.equal(await isServiceReady(3081, async (url, options) => {
      calls.push(url)
      assert.equal(options.redirect, 'manual')
      return { ok: false, status: 401 }
    }, 'cli', host), true)
    assert.deepEqual(calls, [`${origin}/`])
    assert.equal(await isServiceReady(3081, async () => ({ ok: false, status: 303 }), 'cli', host), true)
    const target = new URL(restartBrowserTarget(3081, 'generation', undefined, host))
    assert.equal(target.origin, origin)
    assert.equal(target.searchParams.get('tavern-boot'), 'generation')
  }
})

test('链接仅信任记录的绑定地址，不把 token 发给其他来源', async () => {
  for (const bindHost of ['192.168.1.10', 'fd00::1234']) {
    const origin = serviceOrigin(bindHost, 3081)
    const accepted = `${origin}/?token=owned-token`
    const request = async (url, options) => {
      assert.equal(new URL(url).origin, origin)
      assert.equal(options.redirect, 'manual')
      return { status: url === accepted ? 303 : 401 }
    }
    assert.equal(await resolveServiceWebUrl({ port: 3081, bindHost, log: `dsh web: ${accepted}\n`, request }), accepted)
    assert.equal(await resolveServiceWebUrl({ port: 3081, bindHost: '127.0.0.1', record: { bindHost }, log: `dsh web: ${accepted}\n`, request }), accepted)
    for (const wrong of ['http://127.0.0.1:3081/?token=secret', `${origin.replace(':3081', ':3082')}/?token=secret`, `${origin.replace('http:', 'https:')}/?token=secret`, `${origin.replace('http://', 'http://user:password@')}/?token=secret`]) {
      const calls = []
      assert.equal(await resolveServiceWebUrl({ port: 3081, bindHost, log: `dsh web: ${wrong}\n`, request: async url => { calls.push(url); return { status: 401 } } }), '')
      assert.deepEqual(calls, [`${origin}/`])
    }
  }
})

for (const bindHost of ['127.0.0.2', '::1']) {
  test(`实际 CLI 在 ${bindHost} 启动、状态、打开、重启、停止，环境变化不覆盖运行记录`, { skip: process.platform === 'win32', timeout: 30000 }, async t => {
    const reserve = createServer()
    try {
      await new Promise((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, bindHost, resolve) })
    } catch (error) {
      if (bindHost === '::1' && ['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(error.code)) { t.skip('IPv6 loopback unavailable'); return }
      throw error
    }
    const port = reserve.address().port
    await new Promise(resolve => reserve.close(resolve))
    const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-bind-'))
    const bin = path.join(root, 'runtime/bin'), profile = path.join(root, 'profiles/tavern')
    await mkdir(bin, { recursive: true })
    await mkdir(profile, { recursive: true })
    await writeFile(path.join(profile, 'package.json'), '{}')
    await writeFile(path.join(profile, 'cordis.patch.yml'), '[]')
    const pidFile = path.join(root, 'logs/tavern.pid.json')
    const opened = path.join(root, 'opened-url')
    t.after(async () => {
      try { process.kill(JSON.parse(await readFile(pidFile, 'utf8')).pid, 'SIGTERM') } catch {}
      await rm(root, { recursive: true, force: true })
    })
    const fixture = path.join(root, 'fixture.mjs')
    await writeFile(fixture, `import { createServer } from 'node:http';
const option = name => process.argv[process.argv.indexOf(name) + 1];
const host = option('--host'), port = Number(option('--port'));
const origin = 'http://' + (host.includes(':') ? '[' + host + ']' : host) + ':' + port;
const server = createServer((req, res) => {
  const accepted = new URL(req.url, origin).searchParams.get('token') === 'fixture-token';
  res.writeHead(accepted ? 303 : 401, accepted ? { location: '/' } : {}); res.end();
});
server.listen(port, host, () => console.log('dsh web: ' + origin + '/?token=fixture-token'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`)
    await writeFile(path.join(bin, 'dsh'), '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(fixture) + ' "$@"\n', { mode: 0o755 })
    await writeFile(path.join(bin, process.platform === 'darwin' ? 'open' : 'xdg-open'), '#!/bin/sh\nprintf "%s" "$1" > "$TAVERN_TEST_OPENED"\n', { mode: 0o755 })
    // Fixture traffic is local-only; an inherited HTTP proxy must not intercept it.
    const env = { ...process.env, NODE_USE_ENV_PROXY: '0', DSH_TAVERN_RUNTIME_HOST: 'cli', DSH_HOME: root, DSH_TAVERN_CLI_HOME: root, DSH_TAVERN_PORT: String(port), DSH_TAVERN_BIND: bindHost, DSH_TAVERN_NO_OPEN: '1', PATH: bin + path.delimiter + process.env.PATH, TAVERN_TEST_OPENED: opened }
    const run = (action, overrides = {}) => execute(process.execPath, [launcher, action], { env: { ...env, ...overrides }, timeout: 12000 }).catch(async error => { error.message += '\nFixture log: ' + await readFile(path.join(root, 'logs/tavern.log'), 'utf8').catch(() => 'missing'); throw error })
    const url = `${serviceOrigin(bindHost, port)}/?token=fixture-token`
    assert.ok((await run('start')).stdout.includes(url))
    const first = JSON.parse(await readFile(pidFile, 'utf8'))
    assert.equal(first.bindHost, bindHost)
    assert.equal(first.port, port)
    for (const action of ['status', 'start', 'open']) {
      const result = await run(action, { DSH_TAVERN_BIND: '' })
      assert.ok(result.stdout.includes(url), action + ' without binding env uses recorded address')
      assert.equal(JSON.parse(await readFile(pidFile, 'utf8')).pid, first.pid)
    }
    assert.equal(await readFile(opened, 'utf8'), url)
    assert.ok((await run('status', { DSH_TAVERN_BIND: '127.0.0.1' })).stdout.includes(url))
    assert.ok((await run('restart')).stdout.includes(url))
    const second = JSON.parse(await readFile(pidFile, 'utf8'))
    assert.notEqual(second.pid, first.pid)
    assert.equal(second.bindHost, bindHost)
    const localUrl = `http://127.0.0.1:${port}/?token=fixture-token`
    assert.ok((await run('restart', { DSH_TAVERN_BIND: '' })).stdout.includes(localUrl))
    assert.equal(JSON.parse(await readFile(pidFile, 'utf8')).bindHost, '127.0.0.1')
    // Records written before DSH_TAVERN_BIND existed always describe loopback,
    // even if the next shell supplies a different default.
    const legacy = JSON.parse(await readFile(pidFile, 'utf8'))
    delete legacy.bindHost
    await writeFile(pidFile, JSON.stringify(legacy))
    assert.ok((await run('status')).stdout.includes(localUrl))
    assert.match((await run('stop')).stdout, /已停止/)
    await assert.rejects(readFile(pidFile), { code: 'ENOENT' })
  })
}


test('legacy listener adoption requires matching bind address as well as port', () => {
  assert.equal(legacyBindHostMatches('dsh --profile tavern --host 127.0.0.2', '127.0.0.2'), true)
  assert.equal(legacyBindHostMatches('dsh --profile tavern --host=fd00:0:0:0:0:0:0:1', 'fd00::1'), true)
  assert.equal(legacyBindHostMatches('dsh --profile tavern --host 127.0.0.1', '127.0.0.2'), false)
  assert.equal(legacyBindHostMatches('dsh --profile tavern', '127.0.0.1'), true)
  assert.equal(legacyBindHostMatches('dsh --profile tavern', '127.0.0.2'), false)
  assert.equal(legacyBindHostMatches('dsh --profile tavern --host 0.0.0.0', '127.0.0.1'), false)
})


test('port 80 log URLs compare canonical origins and preserve token access', async () => {
  for (const bindHost of ['192.168.1.10', 'fd00::1234']) {
    const authority = bindHost.includes(':') ? `[${bindHost}]` : bindHost
    const candidate = `http://${authority}:80/?token=fixture-token`
    const canonical = `http://${authority}/?token=fixture-token`
    const calls = []
    assert.equal(await resolveServiceWebUrl({ port: 80, bindHost, log: `dsh web: ${candidate}\n`, request: async url => {
      calls.push(url)
      return { status: url === canonical ? 303 : 401 }
    } }), canonical)
    assert.deepEqual(calls, [canonical])
  }
})
