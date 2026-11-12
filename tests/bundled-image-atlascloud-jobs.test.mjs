import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import vm from 'node:vm'
import { supportsImageTaskResume } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-providers.js'

const SOURCE = new URL('../tavern-plugin/packages/dsh-tavern-image-bundled/', import.meta.url)
const BASE = 'https://atlas.example.test/api/v1'
const CDN = 'https://images.example.test/result.png'
const ID = '11111111-1111-4111-8111-111111111111'
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex')
const json = data => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('原子 JSON 写入短暂遇到 Windows rename 锁会有界重试，最终失败只清理临时文件', async () => {
  const source = await readFile(new URL('lib/index.js', SOURCE), 'utf8')
  const start = source.indexOf('async function writeJsonAtomic(path, value) {')
  const next = source.indexOf('function cacheRoot(', start)
  const end = source.lastIndexOf('}', next)
  assert.ok(start >= 0 && end > start)
  const compile = dependencies => vm.runInNewContext(`(${source.slice(start, end + 1)})`, dependencies)

  const attempts = [], removed = [], written = []
  const transientRename = async (tmp, target) => {
    attempts.push([tmp, target])
    if (attempts.length < 3) throw Object.assign(new Error('sharing violation'), { code: 'EPERM' })
  }
  await compile({
    randomUUID: () => 'temporary-id', JSON, writeFile: async (...args) => written.push(args),
    rename: transientRename, rm: async (path, options) => removed.push([path, options]),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
  })('jobs-store.json', { state: 'cancelled' })
  assert.equal(attempts.length, 3)
  assert.deepEqual(attempts.map(([, target]) => target), Array(3).fill('jobs-store.json'))
  assert.equal(written.length, 1)
  assert.equal(removed[0][0], 'jobs-store.json.temporary-id.tmp')
  assert.equal(removed[0][1].force, true)

  const failedAttempts = [], failedRemoved = []
  await assert.rejects(compile({
    randomUUID: () => 'failed-id', JSON, writeFile: async () => {},
    rename: async (tmp, target) => {
      failedAttempts.push([tmp, target])
      throw Object.assign(new Error('sharing violation'), { code: 'EPERM' })
    },
    rm: async (path, options) => failedRemoved.push([path, options]),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
  })('jobs-store.json', { state: 'cancelled' }), error => error.code === 'EPERM')
  assert.equal(failedAttempts.length, 5, '重试次数有上限')
  assert.equal(failedRemoved.length, 1, '失败时只清理临时文件')
  assert.equal(failedRemoved[0][0], 'jobs-store.json.failed-id.tmp')
  assert.equal(failedRemoved[0][1].force, true)
})

async function fixture(t, { jobs = {}, provider = 'atlascloud' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-atlas-jobs-'))
  const pluginRoot = join(root, 'plugin')
  await cp(SOURCE, pluginRoot, { recursive: true })
  await writeFile(join(pluginRoot, 'jobs-store.json'), JSON.stringify(jobs))
  const originalFetch = globalThis.fetch
  const runtimes = []
  let serial = 0
  const config = {
    imageBackend: provider, activeImageChannel: 'image-test', queryThrottleMs: 1,
    imageChannels: [{ id: 'image-test', provider, name: provider, baseUrl: BASE, apiKey: 'test-secret', options: { pollIntervalMs: 1 } }],
  }
  t.after(async () => {
    for (const runtime of runtimes) runtime.close()
    globalThis.fetch = originalFetch
    assert.ok(resolve(root).startsWith(resolve(tmpdir())))
    await rm(root, { recursive: true, force: true })
  })
  const stored = async () => JSON.parse(await readFile(join(pluginRoot, 'jobs-store.json'), 'utf8'))
  async function untilStored(id, predicate) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const job = (await stored())[id]
      if (job && predicate(job)) return job
      await new Promise(done => setTimeout(done, 5))
    }
    assert.fail('任务状态没有按期落盘：' + JSON.stringify(await stored()))
  }
  async function start(overrides = {}) {
    const routes = new Map(), disposers = [], handlers = []
    const ctx = {
      logger: { info() {}, warn() {}, error() {} },
      webServer: { register({ path, handler }) { routes.set(path, handler); return () => routes.delete(path) } },
      inject(names, install) { if (names.every(name => this[name])) install(this) },
      effect(install) { const dispose = install(); if (typeof dispose === 'function') disposers.push(dispose); return dispose },
      on(event, callback) { if (event === 'dispose') handlers.push(callback) },
    }
    const { apply } = await import(pathToFileURL(join(pluginRoot, 'lib/index.js')).href + '?runtime=' + ++serial)
    apply(ctx, { ...config, ...overrides })
    const runtime = {
      close() { for (const dispose of handlers.splice(0).reverse()) dispose(); for (const dispose of disposers.splice(0).reverse()) dispose() },
      request(route, body, method = body === undefined ? 'GET' : 'POST') {
        return new Promise((done, reject) => {
          const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
          Object.assign(request, { method, url: '/plugins/dsh-tavern-image/' + route, headers: { host: 'localhost', 'content-type': 'application/json' } })
          const response = {
            headersSent: false,
            writeHead(status) { this.status = status; this.headersSent = true },
            end(value) { try { done({ status: this.status, body: JSON.parse(String(value)) }) } catch (error) { reject(error) } },
          }
          const handler = routes.get(request.url.split('?')[0])
          if (!handler) return reject(new Error('unregistered route ' + route))
          handler(request, response)
        })
      },
    }
    runtimes.push(runtime)
    return runtime
  }
  return { config, pluginRoot, start, stored, untilStored }
}

const savedJob = (patch = {}) => ({
  id: ID, backend: 'atlascloud', channelId: 'image-test', channelEndpoint: BASE,
  state: 'running', providerTaskProvider: 'atlascloud', providerTaskId: 'already-accepted',
  requestStarted: true, createdAt: Date.now(), positive: 'mountain lake', negative: '',
  size: { width: 1024, height: 1024 }, params: {}, ...patch,
})

test('Atlas 重启恢复已接单任务，只读查询原任务、下载并保存图片，重复查询不重发', async t => {
  const f = await fixture(t, { jobs: { [ID]: savedJob() } })
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    assert.equal(init.method, 'GET')
    if (url === CDN) { assert.deepEqual(init.headers, {}); return new Response(PNG) }
    assert.equal(url, BASE + '/model/prediction/already-accepted')
    return json({ code: 200, data: { id: 'already-accepted', status: 'completed', outputs: [CDN] } })
  }
  const runtime = await f.start()
  const result = await runtime.request('jobs?id=' + ID)
  assert.equal(result.status, 200)
  assert.equal(result.body.job.state, 'done')
  assert.equal(result.body.job.providerTaskId, 'already-accepted')
  assert.equal(result.body.job.requestMayHaveSucceeded, false)
  assert.deepEqual(await readFile(join(f.pluginRoot, 'cache', ID + '.img')), PNG)
  await f.untilStored(ID, job => job.state === 'done')
  await runtime.request('jobs?id=' + ID)
  assert.equal(calls.length, 2)
})

test('Atlas 渠道地址变化不向新端点发送旧任务号；明确取消的记录不自动恢复', async t => {
  for (const patch of [{ channelEndpoint: 'https://old.example.test/api/v1' }, { state: 'cancelled', cancelMayHaveContinued: true }]) {
    await t.test(JSON.stringify(patch), async t => {
      const f = await fixture(t, { jobs: { [ID]: savedJob(patch) } })
      globalThis.fetch = () => assert.fail('不应查询平台')
      const runtime = await f.start()
      const result = await runtime.request('jobs?id=' + ID)
      assert.equal(result.status, 200)
      if (patch.state === 'cancelled') assert.equal(result.body.job.state, 'cancelled')
      else {
        assert.equal(result.body.job.state, 'uncertain')
        assert.match(result.body.job.error, /atlas cloud 渠道地址已变化/)
      }
    })
  }
})

test('Atlas 恢复遇到平台终态失败/空输出结束追踪，不无限轮询', async t => {
  for (const task of [{ status: 'failed', error: 'render failed' }, { status: 'completed', outputs: [], has_nsfw_contents: [true] }]) {
    await t.test(task.status, async t => {
      const f = await fixture(t, { jobs: { [ID]: savedJob({ state: 'uncertain' }) } })
      let calls = 0
      globalThis.fetch = async (_url, init) => { calls++; assert.equal(init.method, 'GET'); return json({ code: 200, data: task }) }
      const runtime = await f.start()
      const result = await runtime.request('jobs?id=' + ID)
      assert.equal(result.body.job.state, 'failed')
      assert.equal(result.body.job.requestMayHaveSucceeded, false)
      if (task.status === 'completed') assert.match(result.body.job.error, /平台内容过滤/)
      await f.untilStored(ID, job => job.state === 'failed')
      await runtime.request('jobs?id=' + ID)
      assert.equal(calls, 1)
    })
  }
})

test('Atlas 正常卸载保留待恢复任务和已落盘编号；重载仅 GET、不重复收费', async t => {
  const f = await fixture(t)
  const polling = deferred()
  let posts = 0, savedDuringPoll
  globalThis.fetch = async (_url, init) => {
    if (init.method === 'POST') {
      posts++
      const submitted = Object.values(await f.stored()).find(job => job.key === 'no-duplicate')
      assert.equal(submitted.state, 'running', '先保存已开始提交的状态，再发 POST')
      assert.equal(submitted.requestStarted, true)
      return json({ code: 200, data: { id: 'reload-task', status: 'created' } })
    }
    savedDuringPoll = Object.values(await f.stored()).find(job => job.providerTaskId === 'reload-task')
    polling.resolve()
    return new Promise((_, reject) => {
      if (init.signal.aborted) reject(init.signal.reason)
      else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    })
  }
  const first = await f.start()
  const created = await first.request('jobs', { tag: 'mountain lake', size: '1024x1024', key: 'no-duplicate' })
  assert.equal(created.status, 200)
  await polling.promise
  assert.equal(savedDuringPoll.id, created.body.id)
  assert.equal(savedDuringPoll.providerTaskProvider, 'atlascloud')
  first.close()
  const saved = await f.untilStored(created.body.id, job => job.state === 'uncertain')
  assert.equal(saved.providerTaskId, 'reload-task')
  assert.equal(saved.requestMayHaveSucceeded, true)
  globalThis.fetch = async (url, init) => {
    assert.equal(init.method, 'GET', '重载不能重新提交')
    return url === CDN ? new Response(PNG) : json({ code: 200, data: { status: 'completed', outputs: [CDN] } })
  }
  const second = await f.start()
  const recovered = await second.request('jobs?key=no-duplicate')
  assert.equal(recovered.body.job.state, 'done')
  assert.equal(recovered.body.job.id, created.body.id)
  await f.untilStored(created.body.id, job => job.state === 'done')
  const reused = await second.request('jobs', { tag: 'mountain lake', key: 'no-duplicate' })
  assert.equal(reused.body.id, created.body.id)
  assert.equal(posts, 1)
})

test('Atlas 用户主动取消不被卸载恢复逻辑覆盖，保留取消和平台可能继续的提示', async t => {
  const f = await fixture(t)
  const polling = deferred()
  globalThis.fetch = async (_url, init) => {
    if (init.method === 'POST') return json({ code: 200, data: { id: 'cancel-task', status: 'created' } })
    polling.resolve()
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
  }
  const runtime = await f.start()
  const created = await runtime.request('jobs', { tag: 'mountain lake', size: '1024x1024' })
  await polling.promise
  const cancelled = await runtime.request('cancel', { id: created.body.id })
  assert.equal(cancelled.body.job.state, 'cancelled')
  assert.equal((await f.stored())[created.body.id].state, 'cancelled', 'HTTP 成功响应前必须确认取消状态已落盘')
  runtime.close()
  const saved = await f.untilStored(created.body.id, job => job.state === 'cancelled')
  assert.equal(saved.cancelMayHaveContinued, true)
  assert.equal(saved.providerTaskId, 'cancel-task')
})

test('Atlas 恢复在转码或写盘期间取消/删除，不覆盖取消状态或留下复活缓存', async t => {
  // Pause exact async boundaries in the real refresh function. Route tests above
  // exercise real disk/network plumbing; here only the slow operations are stubbed.
  const source = await readFile(new URL('lib/index.js', SOURCE), 'utf8')
  const start = source.indexOf('    async function refresh(job, options = {}) {')
  const end = source.indexOf('    // ── 后台轮询', start)
  assert.ok(start >= 0 && end > start)
  for (const stage of ['transcode', 'write']) for (const action of ['cancel', 'delete']) {
    await t.test(stage + '/' + action, async () => {
      const paused = deferred(), release = deferred(), writes = [], removed = []
      const job = savedJob({ state: 'uncertain', queryAt: 0 })
      const jobs = new Map([[ID, job]])
      const channel = { id: 'image-test', provider: 'atlascloud', baseUrl: BASE }
      const refresh = vm.runInNewContext(`(${source.slice(start, end)}\n)`, {
        AbortController, supportsImageTaskResume, structuredClone, jobs, join,
        config: { imageChannels: [channel], queryThrottleMs: 1 },
        resumableChannelForJob: item => item?.channelId === channel.id && supportsImageTaskResume(channel) ? channel : null,
        channelEndpointOf: item => item.baseUrl,
        imageOutputConfig: () => ({}), cacheRoot: () => 'virtual-cache', persistJobs: async () => {},
        generateImage: async () => ({ bytes: PNG, mediaType: 'image/png' }),
        transcodeImageOutputAsync: async (_bytes, _type, _config, options) => {
          assert.equal(options.signal, job.controller.signal)
          if (stage === 'transcode') { paused.resolve(); await release.promise }
          return { bytes: PNG, mediaType: 'image/png' }
        },
        writeFile: async file => { writes.push(file); paused.resolve(); await release.promise },
        rm: async file => { removed.push(file) },
      })
      const pending = refresh(job)
      await paused.promise
      job.controller.abort(new Error(action))
      if (action === 'cancel') job.state = 'cancelled'
      else jobs.delete(ID)
      release.resolve()
      await pending
      assert.notEqual(job.state, 'done')
      if (action === 'cancel') assert.equal(job.state, 'cancelled')
      else assert.equal(jobs.has(ID), false)
      assert.equal(job.refreshing, null)
      assert.deepEqual(writes, stage === 'write' ? [join('virtual-cache', ID + '.img')] : [])
      assert.deepEqual(removed, writes, '写盘中发生取消/删除时清理刚写入的文件')
    })
  }
})

test('共享恢复路径仍兼容 Qwen 异步任务，不发送 Atlas 请求', async t => {
  const f = await fixture(t, { provider: 'qwen', jobs: { [ID]: savedJob({ backend: 'qwen', providerTaskProvider: 'qwen' }) } })
  globalThis.fetch = async (url, init) => {
    assert.equal(init.method, 'GET')
    if (url === CDN) return new Response(PNG)
    assert.equal(url, BASE + '/tasks/already-accepted')
    return json({ output: { task_status: 'SUCCEEDED', results: [{ url: CDN }] } })
  }
  const runtime = await f.start()
  const result = await runtime.request('jobs?id=' + ID)
  assert.equal(result.body.job.state, 'done')
  await f.untilStored(ID, job => job.state === 'done')
})
