import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { resolveServiceWebUrl } from '../bin/dsh-tavern.mjs'

const execute = promisify(execFile)
const launcher = fileURLToPath(new URL('../bin/dsh-tavern.mjs', import.meta.url))

test('仅使用本次启动的链接，验证 token 且不跟随跳转', async () => {
  const old = '旧日志\ndsh web: http://127.0.0.1:3081/?token=old\n'
  const fresh = 'dsh web: http://127.0.0.1:3081/?token=fresh\r\n'
  const calls = []
  const result = await resolveServiceWebUrl({
    port: 3081, log: Buffer.from(old + fresh), record: { logOffset: Buffer.byteLength(old) },
    request: async (url, options) => {
      calls.push(url)
      assert.equal(options.redirect, 'manual')
      return { status: 303 }
    },
  })
  assert.equal(result, 'http://127.0.0.1:3081/?token=fresh')
  assert.deepEqual(calls, [result])
})

test('旧 token、缺失链接和错误来源不冒充有效访问地址；无鉴权旧版仍可用', async () => {
  for (const candidate of ['', 'http://127.0.0.1:3081/?token=expired', 'https://example.com/?token=secret', 'http://127.0.0.1:9999/?token=other']) {
    const calls = []
    assert.equal(await resolveServiceWebUrl({
      port: 3081, log: `dsh web: ${candidate}\n`,
      request: async url => { calls.push(url); return { status: 401 } },
    }), '')
    assert.ok(calls.every(url => new URL(url).origin === 'http://127.0.0.1:3081'))
  }
  assert.equal(await resolveServiceWebUrl({ port: 3081, request: async () => ({ status: 200 }) }), 'http://127.0.0.1:3081/')
  assert.equal(await resolveServiceWebUrl({ port: 3081, request: async () => { throw new Error('offline') } }), '')
  const old = 'dsh web: http://127.0.0.1:3081/?token=old\n'
  const calls = []
  await resolveServiceWebUrl({ port: 3081, record: { logOffset: Buffer.byteLength(old) }, log: old,
    request: async url => { calls.push(url); return { status: 401 } },
  })
  assert.deepEqual(calls, ['http://127.0.0.1:3081/'])
})

test('实际 CLI 的 status、重复 start、open 都使用当前链接；过期链接不打开', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-web-access-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const server = http.createServer((req, res) => {
    const accepted = new URL(req.url, 'http://local').searchParams.get('token') === 'current-test-token'
    res.writeHead(accepted ? 303 : 401, accepted ? { location: '/' } : {})
    res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const port = server.address().port
  const url = `http://127.0.0.1:${port}/?token=current-test-token`
  const logs = path.join(root, 'logs')
  const profile = path.join(root, 'profiles/tavern')
  const mocks = path.join(root, 'bin')
  await Promise.all([mkdir(logs), mkdir(profile, { recursive: true }), mkdir(mocks)])
  await writeFile(path.join(profile, 'package.json'), '{}')
  await writeFile(path.join(profile, 'cordis.patch.yml'), '[]')
  await writeFile(path.join(logs, 'tavern.frontend-bootstrap.json'), '{"version":2}')
  await writeFile(path.join(logs, 'tavern.pid.json'), JSON.stringify({ pid: process.pid, port, logOffset: 0 }))
  await writeFile(path.join(logs, 'tavern.log'), `dsh web: ${url}\n`)
  const opened = path.join(root, 'opened-url')
  await writeFile(path.join(mocks, process.platform === 'darwin' ? 'open' : 'xdg-open'), '#!/bin/sh\nprintf "%s" "$1" > "$TAVERN_TEST_OPENED"\n', { mode: 0o755 })
  const env = { ...process.env, DSH_HOME: root, DSH_TAVERN_PORT: String(port), PATH: `${mocks}:${process.env.PATH}`, TAVERN_TEST_OPENED: opened }
  const run = action => execute(process.execPath, [launcher, action], { env, timeout: 10000 })
  for (const action of ['status', 'start', 'open']) {
    const { stdout } = await run(action)
    assert.ok(stdout.includes(url), action)
    assert.match(stdout, /请勿分享/)
  }
  let actual = ''
  for (let i = 0; i < 50 && !actual; i++) {
    try { actual = await readFile(opened, 'utf8') } catch {}
    if (!actual) await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(actual, url)
  await rm(opened)
  await writeFile(path.join(logs, 'tavern.log'), `dsh web: http://127.0.0.1:${port}/?token=expired\n`)
  const { stdout } = await run('status')
  assert.match(stdout, /尚未取得有效/)
  assert.ok(!stdout.includes('token=expired'))
  await assert.rejects(run('open'), error => error.code === 1 && error.stdout.includes('尚未取得有效'))
  await assert.rejects(readFile(opened), { code: 'ENOENT' })
})
