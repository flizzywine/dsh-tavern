import http from 'node:http'
import test from 'node:test'
import { createFileSymlink } from '../../tests/helpers/file-symlink.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createReportServer } from '../report-ui.mjs'

test('report viewer lists nested results and exposes evidence without serving credentials or escaped paths', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-viewer-'))
  const results = path.join(root, 'results'), run = path.join(results, 'case/run-test')
  await mkdir(run, { recursive: true })
  await writeFile(path.join(run, 'report.json'), JSON.stringify({ name: '<script>bad()</script>', status: 'failed', steps: [{ action: 'say' }] }))
  await writeFile(path.join(run, '02-requests.json'), '[]')
  await writeFile(path.join(run, 'runtime.log'), 'private auth URL')
  await writeFile(path.join(root, 'secret.json'), 'secret')
  const server = await createReportServer(results)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    const runs = await (await fetch(base + '/api/runs')).json()
    assert.equal(runs.length, 1); assert.equal(runs[0].rounds, 1)
    const id = runs[0].id
    const detail = await (await fetch(base + '/api/run?id=' + id)).json()
    assert.deepEqual(detail.files.map(f => f.name), ['02-requests.json', 'report.json'])
    assert.equal(await (await fetch(base + '/api/file?' + new URLSearchParams({ id, name: '02-requests.json' }))).text(), '[]')
    for (const name of ['runtime.log', '../secret.json']) assert.equal((await fetch(base + '/api/file?' + new URLSearchParams({ id, name }))).status, 404)
    await t.test('refuses evidence symlinked outside the run', async t => {
      if (!createFileSymlink(t, path.join(root, 'secret.json'), path.join(run, 'failure-secret.json'))) return
      assert.equal((await fetch(base + '/api/file?' + new URLSearchParams({ id, name: 'failure-secret.json' }))).status, 404)
      assert.deepEqual((await (await fetch(base + '/api/run?id=' + id)).json()).files.map(file => file.name), ['02-requests.json', 'report.json'])
    })
    const escaped = Buffer.from('../').toString('base64url')
    assert.equal((await fetch(base + '/api/run?id=' + escaped)).status, 404)
    assert.equal((await fetch(base + '/api/runs', { headers: { Origin: 'https://example.com' } })).status, 403)
    const invalidHost = await new Promise((resolve, reject) => { http.get(base + '/api/runs', { headers: { Host: 'example.com' } }, res => { res.resume(); resolve(res.statusCode) }).on('error', reject) })
    assert.equal(invalidHost, 403)
    assert.equal((await fetch(base + '/api/runs', { method: 'POST' })).status, 405)
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('case catalog starts the existing runner once and reports process failures', async () => {
  const { EventEmitter } = await import('node:events')
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-cases-'))
  await mkdir(path.join(root, 'demo'))
  await writeFile(path.join(root, 'demo/scenario.yaml'), 'name: Demo\nmodel: { provider: test, model: test }\nsteps:\n  - { action: play, sourceCard: demo.json }\n  - { action: say, input: hello }\n')
  const children = [], calls = []
  const server = await createReportServer(path.join(root, 'results'), { casesRoot: root, runtimeHome: '/tmp/test-runtime', launch: (...args) => {
    calls.push(args); const child = new EventEmitter(); child.signals = []; child.kill = signal => { child.signals.push(signal); return true }; children.push(child); return child
  } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  const start = id => fetch(base + '/api/start?' + new URLSearchParams({ id }), { method: 'POST', headers: { Origin: base } })
  try {
    const cases = await (await fetch(base + '/api/cases')).json()
    assert.equal(cases.length, 1); assert.equal(cases[0].steps[1].input, 'hello')
    assert.equal((await fetch(base + '/api/start?id=demo', { method: 'POST' })).status, 403)
    assert.equal((await fetch(base + '/api/start?id=demo')).status, 405)
    assert.equal((await start('../secret')).status, 404)
    const responses = await Promise.all([start('demo'), start('demo')])
    assert.deepEqual(responses.map(r => r.status).sort(), [202, 409]); assert.equal(calls.length, 1)
    assert.equal(calls[0][1][0], path.join(root, 'test-play.mjs'))
    assert.equal(calls[0][1][1], path.join(root, 'demo/scenario.yaml'))
    assert.deepEqual(calls[0][1].slice(-2), ['--runtime-home', '/tmp/test-runtime'])
    assert.equal(calls[0][2].shell, false)
    const job = await (await fetch(base + '/api/job')).json()
    const stop = directory => fetch(base + '/api/stop?' + new URLSearchParams({ directory }), { method: 'POST', headers: { Origin: base } })
    assert.equal((await fetch(base + '/api/stop', { method: 'POST' })).status, 403)
    assert.equal((await stop('stale-job')).status, 409)
    assert.equal((await stop(job.directory)).status, 202)
    assert.equal((await (await fetch(base + '/api/job')).json()).status, 'stopping')
    assert.equal((await start('demo')).status, 409)
    assert.equal((await stop(job.directory)).status, 202)
    assert.deepEqual(children[0].signals, ['SIGTERM'])
    children[0].emit('exit', 1, null)
    assert.equal((await (await fetch(base + '/api/job')).json()).status, 'interrupted')
    assert.equal((await start('demo')).status, 202)
    children[1].emit('exit', 1, null)
    assert.equal((await (await fetch(base + '/api/job')).json()).status, 'failed')
    assert.equal((await start('demo')).status, 202)
    children[2].emit('error', new Error('private detail'))
    assert.equal((await (await fetch(base + '/api/job')).json()).error, '测试进程启动失败')
    assert.equal((await start('demo')).status, 202)
    children[3].emit('exit', 0, null)
    assert.equal((await (await fetch(base + '/api/job')).json()).status, 'completed')
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})
