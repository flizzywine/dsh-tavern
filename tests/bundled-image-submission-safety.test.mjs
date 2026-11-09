import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { generateImage } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-providers.js'

// Exercise exact runtime functions with in-memory disk/transport doubles. No
// host installation, repository mutation, real upload or paid generation.
const source = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js', import.meta.url), 'utf8')
const section = (startText, endText) => {
  const start = source.indexOf(startText), end = source.indexOf(endText, start)
  assert.ok(start >= 0 && end > start, `runtime section missing: ${startText}`)
  return source.slice(start, end)
}
const persistenceSource = section('let jobsDirty = false', '\n    await mkdir(cacheRoot(config)')
const drainSource = section('function drainImages()', '\n    function startJob(')
const copy = value => JSON.parse(JSON.stringify(value))
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex')
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

function persistence(jobs, writer) {
  const warnings = [], snapshots = []
  const persist = vm.runInNewContext(section('function jobSource(job)', '\n    function publicJob(') + '\n' + persistenceSource + '\npersistJobs;', {
    jobs, JOBS_STORE: 'virtual-jobs-store',
    writeJsonAtomic: async (_path, snapshot) => { snapshots.push(copy(snapshot)); await writer?.(snapshot, snapshots.length) },
    logger: { warn: message => warnings.push(message) },
  })
  return { persist, warnings, snapshots }
}
const trackedJob = extra => ({ id: 'tracked', state: 'running', backend: 'atlascloud', requestStarted: true, submissionTracked: true, createdAt: 1, ...extra })

test('required 落盘不能被前面的 best-effort 合并并吞掉失败', async () => {
  const { persist, snapshots, warnings } = persistence(new Map([['tracked', trackedJob()]]), async () => { throw new Error('mock disk full') })
  const optional = persist()
  await assert.rejects(persist({ required: true }), error => {
    assert.match(error.message, /保存生图任务失败/)
    assert.equal(error.submissionNotStarted, true)
    return true
  })
  await optional
  assert.equal(warnings.length, 1, 'best-effort 可以记警告，但不能代替提交前必需的写入')
  assert.equal(snapshots.length, 2, 'required 自己重新尝试写入，不以 jobsDirty=false 为成功依据')
})

test('best-effort 失败后 required 重新写成功，提交标记与参考图快照才可视为持久化', async () => {
  const job = trackedJob({ requestStarted: false, referenceSnapshot: { version: 1, references: [{ index: 1, image: { id: 'immutable-image' }, consistencyText: '原始一致性要求' }] } })
  let durable
  const { persist, snapshots } = persistence(new Map([[job.id, job]]), async (snapshot, attempt) => {
    if (attempt === 1) throw new Error('mock temporary write failure')
    durable = copy(snapshot)
  })
  const optional = persist()
  job.requestStarted = true
  await persist({ required: true })
  await optional
  assert.equal(snapshots.length, 2)
  assert.equal(durable.tracked.requestStarted, true)
  assert.equal(durable.tracked.submissionTracked, true)
  assert.deepEqual(durable.tracked.referenceSnapshot, job.referenceSnapshot)
})

test('required 失败不会毒化后续持久化队列，也不会被下一个 required 当成已完成', async () => {
  const { persist, snapshots } = persistence(new Map([['tracked', trackedJob()]]), async (_snapshot, attempt) => {
    if (attempt === 1) throw new Error('mock temporary write failure')
  })
  await assert.rejects(persist({ required: true }))
  await persist({ required: true })
  assert.equal(snapshots.length, 2)
  assert.equal(snapshots.at(-1).tracked.requestStarted, true)
})

test('150 条历史上限不能挤掉更早的排队/上传/已提交/不确定任务和参考图快照', async () => {
  const jobs = new Map()
  const live = [
    trackedJob({ id: 'queued', state: 'pending', requestStarted: false }),
    trackedJob({ id: 'uploading', state: 'running', requestStarted: false }),
    trackedJob({ id: 'posted', state: 'running', providerTaskId: 'accepted-atlas-task' }),
    trackedJob({ id: 'unknown', state: 'uncertain' }),
    trackedJob({ id: 'cancel-may-continue', state: 'cancelled', cancelMayHaveContinued: true }),
    trackedJob({ id: 'known-paid-marker', state: 'cancelled', requestMayHaveSucceeded: true }),
    trackedJob({ id: 'legacy-cancel-only-started', state: 'cancelled', requestStarted: true, requestMayHaveSucceeded: false, cancelMayHaveContinued: false }),
  ]
  for (const job of live) {
    job.referenceSnapshot = { references: [{ image: { id: 'old-image-' + job.id }, consistencyText: '旧版文字' }] }
    jobs.set(job.id, job)
  }
  for (let i = 0; i < 170; i++) jobs.set('history-' + i, trackedJob({ id: 'history-' + i, state: 'done', createdAt: 100 + i }))
  jobs.set('cache-placeholder', { id: 'cache-placeholder', state: 'running', fromCache: true, createdAt: 10000 })
  const { persist, snapshots } = persistence(jobs)
  await persist({ required: true })
  const saved = snapshots.at(-1)
  assert.equal(Object.keys(saved).length, live.length + 150)
  for (const job of live) {
    assert.equal(saved[job.id].state, job.state)
    assert.equal(saved[job.id].requestStarted, job.requestStarted)
    assert.deepEqual(saved[job.id].referenceSnapshot, job.referenceSnapshot)
  }
  assert.equal(saved.posted.providerTaskId, 'accepted-atlas-task')
  assert.equal(saved['cache-placeholder'], undefined)
  assert.equal(saved['history-19'], undefined)
  assert.equal(saved['history-20'].state, 'done')
  assert.equal(saved['history-169'].state, 'done')
})

test('内存 sweep 与落盘使用相同风险边界，不能先删掉 uncertain 再让持久化保护落空', () => {
  const jobs = new Map(), byKey = new Map()
  const retained = [
    trackedJob({ id: 'queued', state: 'pending', requestStarted: false }),
    trackedJob({ id: 'uploading', state: 'running', requestStarted: false }),
    trackedJob({ id: 'uncertain', state: 'uncertain' }),
    trackedJob({ id: 'cancel-may-continue', state: 'cancelled', cancelMayHaveContinued: true }),
    trackedJob({ id: 'cancel-paid-marker', state: 'cancelled', requestMayHaveSucceeded: true }),
    trackedJob({ id: 'legacy-cancel-only-started', state: 'cancelled', requestStarted: true, requestMayHaveSucceeded: false, cancelMayHaveContinued: false }),
  ]
  for (const job of retained) {
    job.key = 'scene-' + job.id
    jobs.set(job.id, job); byKey.set(job.key, job.id)
  }
  for (let i = 0; i < 205; i++) {
    const job = trackedJob({ id: 'history-' + i, key: 'history-key-' + i, state: 'done', createdAt: 100 + i })
    jobs.set(job.id, job); byKey.set(job.key, job.id)
  }
  vm.runInNewContext(section('function sweep()', '\n    function publicJob(') + '\nsweep();', { jobs, byKey })
  assert.equal(jobs.size, 200)
  for (const job of retained) {
    assert.equal(jobs.get(job.id), job)
    assert.equal(byKey.get(job.key), job.id, '不能丢去重 key 再次提交可能付费的任务')
  }
  assert.equal(jobs.has('history-10'), false)
  assert.equal(byKey.has('history-key-10'), false)
  assert.equal(jobs.has('history-11'), true)
})

async function drainHarness({ failRequiredWrite = 0, localFailure = '', stop = '' } = {}) {
  const job = trackedJob({ state: 'pending', requestStarted: false, controller: new AbortController(), params: {}, referenceSnapshot: { references: [{ image: { id: 'frozen-reference' } }] } })
  const finished = deferred(), events = [], disk = []
  let requiredWrites = 0, uploads = 0, posts = 0, outputWrites = 0
  const channel = { provider: 'atlascloud', model: 'unchanged-model', options: { sizeMode: 'none', pollIntervalMs: 1 } }
  const context = {
    imageDisposed: false, imageRunning: 0,
    imageQueue: [{ job, channel, compiled: { positive: '使用参考图1', negative: '', size: { width: 64, height: 64 } }, maxImageBytes: 1024 * 1024 }],
    config: { imageConcurrency: 1 }, jobs: new Map([[job.id, job]]),
    persistJobs: async (options = {}) => {
      if (options.required) {
        events.push('required-write-' + ++requiredWrites)
        if (requiredWrites === failRequiredWrite) throw Object.assign(new Error('mock required persistence failure'), { submissionNotStarted: true })
      }
      disk.push({ state: job.state, requestStarted: job.requestStarted, requestMayHaveSucceeded: job.requestMayHaveSucceeded, providerTaskId: job.providerTaskId })
      if (!options.required) finished.resolve()
    },
    referenceStore: { read: async image => {
      assert.equal(image.id, 'frozen-reference')
      return { data: PNG, mediaType: 'image/png' }
    } },
    generateImage: (target, request, options) => generateImage(target, request, { ...options, fetchImpl: async (url, init) => {
      assert.equal(init.method, 'POST', 'completed mocked response does not need network polling/download')
      if (url.endsWith('/uploadMedia')) {
        uploads++; events.push('upload')
        assert.equal(job.requestStarted, false, '上传本身不能算付费生图提交')
        if (stop === 'cancel-upload' || stop === 'dispose-upload') {
          if (stop === 'dispose-upload') context.imageDisposed = true
          else job.state = 'cancelled'
          job.controller.abort(new Error(stop))
          throw job.controller.signal.reason
        }
        return json({ data: { download_url: 'https://reference.example.test/one.png' } })
      }
      assert.ok(url.endsWith('/generateImage'))
      posts++; events.push('paid-post')
      assert.equal(job.requestStarted, true)
      assert.equal(disk.at(-1).requestStarted, true, '真的发送 POST 前提交标记必须已写入')
      if (stop === 'cancel-post' || stop === 'dispose-post') {
        if (stop === 'dispose-post') context.imageDisposed = true
        else job.state = 'cancelled'
        job.controller.abort(new Error(stop))
        throw job.controller.signal.reason
      }
      return json({ data: { id: 'paid-task', status: 'completed', outputs: ['data:image/png;base64,' + PNG.toString('base64')] } })
    } }),
    transcodeImageOutputAsync: async () => {
      assert.equal(job.providerTaskId, 'paid-task')
      if (localFailure === 'transcode') throw new Error('mock local transcode failure')
      return { bytes: PNG, mediaType: 'image/png' }
    },
    cacheRoot: () => 'virtual-cache', join: (...parts) => parts.join('/'),
    writeFile: async () => { outputWrites++; if (localFailure === 'write') throw new Error('mock local output write failure') },
    rm: async () => {}, logger: { warn() {} },
  }
  vm.runInNewContext(drainSource + '\ndrainImages();', context)
  await finished.promise
  assert.equal(context.imageRunning, 0)
  return { job, disk, events, requiredWrites, uploads, posts, outputWrites }
}

test('平台已返回图片后本地转码/写盘失败保持 uncertain，可查原任务而非无提示重新计费', async t => {
  for (const stage of ['transcode', 'write']) await t.test(stage, async () => {
    const result = await drainHarness({ localFailure: stage })
    assert.equal(result.job.state, 'uncertain')
    assert.equal(result.job.requestStarted, true)
    assert.equal(result.job.requestMayHaveSucceeded, true)
    assert.equal(result.job.providerTaskId, 'paid-task')
    assert.equal(result.posts, 1)
    assert.equal(result.uploads, 1)
    assert.equal(result.outputWrites, stage === 'write' ? 1 : 0)
    assert.equal(result.disk.at(-1).state, 'uncertain')
  })
})

test('初始与 POST 前的 required 落盘失败都禁止生图，任务号回调落盘失败则保持已提交不确定', async t => {
  for (const failRequiredWrite of [1, 2, 3]) await t.test('required-write-' + failRequiredWrite, async () => {
    const result = await drainHarness({ failRequiredWrite })
    const wasSubmitted = failRequiredWrite === 3
    assert.equal(result.job.state, wasSubmitted ? 'uncertain' : 'failed')
    assert.equal(result.job.requestStarted, wasSubmitted)
    assert.equal(result.job.requestMayHaveSucceeded, wasSubmitted)
    assert.equal(result.posts, wasSubmitted ? 1 : 0)
    assert.equal(result.uploads, failRequiredWrite === 1 ? 0 : 1)
    if (wasSubmitted) assert.equal(result.job.providerTaskId, 'paid-task')
    assert.equal(result.outputWrites, 0)
  })
})

test('上传中取消/卸载不记为已提交；真正 POST 后取消/卸载保留计费风险标记', async t => {
  for (const stop of ['cancel-upload', 'dispose-upload', 'cancel-post', 'dispose-post']) await t.test(stop, async () => {
    const result = await drainHarness({ stop })
    const wasSubmitted = stop.endsWith('post')
    assert.equal(result.job.requestStarted, wasSubmitted)
    assert.equal(result.job.requestMayHaveSucceeded, wasSubmitted)
    assert.equal(result.posts, wasSubmitted ? 1 : 0)
    assert.equal(result.uploads, 1)
    assert.equal(result.job.state, stop.startsWith('cancel') ? 'cancelled' : wasSubmitted ? 'uncertain' : 'failed')
    if (stop.startsWith('cancel')) assert.equal(result.job.cancelMayHaveContinued, wasSubmitted)
  })
})

test('同 key 已取消记录只要任一已提交风险标记存在就拒绝重新生成，包括旧盘面不一致的标记', async t => {
  // Only execute the original dedupe/validation preamble, stopping before any
  // channel/model/compiler work. The sentinel denotes reaching a new job path.
  const preamble = section('async function createJob(', '      const channel = forceWorkflow')
  const invoke = existing => vm.runInNewContext(preamble + 'return "new-job-path"; }\ncreateJob;', {
    config: {}, activeArtistText: () => ({ text: '' }), findJob: () => existing, publicJob: job => ({ id: job.id, state: job.state }),
  })({ key: 'same-scene-key', tag: '人物肖像' })
  for (const flag of ['requestStarted', 'cancelMayHaveContinued', 'requestMayHaveSucceeded']) await t.test(flag, async () => {
    const old = trackedJob({ state: 'cancelled', requestStarted: false, cancelMayHaveContinued: false, requestMayHaveSucceeded: false, [flag]: true })
    await assert.rejects(invoke(old), /同一请求.*不确定/)
  })
  assert.equal(await invoke(trackedJob({ state: 'cancelled', requestStarted: false, cancelMayHaveContinued: false, requestMayHaveSucceeded: false })), 'new-job-path', '明确未提交的取消仍允许手动重试')
  assert.equal(await invoke(trackedJob({ state: 'failed', requestStarted: true, requestMayHaveSucceeded: false })), 'new-job-path', '平台明确拒绝不因曾尝试 POST 而永久锁死')
  for (const state of ['pending', 'running', 'done']) {
    assert.equal((await invoke(trackedJob({ state }))).id, 'tracked', '已有任务应复用，不能另建')
  }
})

test('cancelJob 返回之前同步保存计费风险，不能依赖 provider 的异步 abort catch', async t => {
  const cancelSource = section('function cancelJob(id)', '\n    // ---- 生图规划')
  for (const scenario of [
    { name: '排队尚未提交', state: 'pending', requestStarted: false, removed: true },
    { name: '仅在上传参考图', state: 'running', requestStarted: false, removed: false },
    { name: '已发出生成 POST', state: 'running', requestStarted: true, removed: false },
  ]) await t.test(scenario.name, () => {
    const job = trackedJob({ state: scenario.state, requestStarted: scenario.requestStarted, requestMayHaveSucceeded: false, cancelMayHaveContinued: false, controller: new AbortController() })
    const imageQueue = [{ job }], disk = []
    const cancel = vm.runInNewContext('(' + cancelSource + '\n)', {
      getJob: () => job, imageQueue,
      persistJobs: () => { disk.push({ state: job.state, requestStarted: job.requestStarted, requestMayHaveSucceeded: job.requestMayHaveSucceeded, cancelMayHaveContinued: job.cancelMayHaveContinued }) },
      publicJob: value => ({ ...value }),
    })
    const result = cancel(job.id)
    assert.equal(result.state, 'cancelled')
    assert.equal(result.requestMayHaveSucceeded, scenario.requestStarted)
    assert.equal(result.cancelMayHaveContinued, scenario.requestStarted)
    assert.equal(job.controller.signal.aborted, true)
    assert.equal(imageQueue.length, scenario.removed ? 0 : 1)
    assert.equal(disk.length, 1)
    assert.equal(disk[0].requestMayHaveSucceeded, scenario.requestStarted, '重启时必须已经能看到计费风险')
  })
})
