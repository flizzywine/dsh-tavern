import test from 'node:test'
import assert from 'node:assert/strict'
import { IMAGE_PROVIDERS, generateImage, supportsImageTaskResume, testImageChannel } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-providers.js'
import { activeChannel, channelConfigPatch, migrateLegacyImageConfig, normalizeChannels, publicChannels } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-channels.js'
import { resolvePromptMode } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-presets.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex')
const CDN = 'https://images.example.test/result.png'
const BASE = 'https://api.atlascloud.ai/api/v1'
const channel = (options = {}, fields = {}) => ({ id: 'atlas-test', provider: 'atlascloud', apiKey: 'atlas-test-secret', authMode: 'bearer', options: { pollIntervalMs: 1, ...options }, ...fields })
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const prediction = (data, status = 200) => json({ code: status, data }, status)
const png = () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })

test('旧 Atlas channel/backend 无损迁移为 custom 协议，用户 provider 列表不再单列 Atlas', () => {
  assert.equal(IMAGE_PROVIDERS.some(item => item.id === 'atlascloud'), false)
  const legacyChannel = channel({ sizeMode: 'none' }, { name: '我的 Atlas', baseUrl: BASE, model: 'custom/model' })
  const configured = migrateLegacyImageConfig({ imageBackend: 'atlascloud', activeImageChannel: 'atlas-test', imageChannels: [legacyChannel] })
  const active = activeChannel(configured)
  assert.equal(configured.imageBackend, 'custom')
  assert.equal(active.provider, 'custom')
  assert.equal(active.options.apiProtocol, 'atlascloud')
  assert.equal(active.id, legacyChannel.id)
  assert.equal(active.name, legacyChannel.name)
  assert.equal(active.baseUrl, legacyChannel.baseUrl)
  assert.equal(active.model, legacyChannel.model)
  assert.equal(active.apiKey, legacyChannel.apiKey)
  assert.equal(supportsImageTaskResume(active), true)

  const patched = channelConfigPatch({ imageBackend: 'comfyui', imageChannels: [] }, {
    imageBackend: 'atlascloud', activeImageChannel: 'atlas-test', imageChannels: [legacyChannel],
  })
  assert.equal(activeChannel(patched).provider, 'custom')
  const publicValue = publicChannels(configured.imageChannels)
  assert.equal(publicValue[0].hasApiKey, true)
  assert.equal('apiKey' in publicValue[0], false)
  const saved = channelConfigPatch(configured, { imageChannels: publicValue })
  assert.equal(activeChannel(saved).apiKey, 'atlas-test-secret')
  assert.equal(normalizeChannels([legacyChannel])[0].options.apiProtocol, 'atlascloud')
  assert.equal(resolvePromptMode({}, 'atlascloud'), 'natural')
})

test('升级前已接单的 Atlas task 可通过迁移后的 custom channel 继续恢复', async () => {
  const migratedChannel = activeChannel(migrateLegacyImageConfig({ imageBackend: 'atlascloud', activeImageChannel: 'atlas-test', imageChannels: [channel({ sizeMode: 'none' }, { baseUrl: BASE })] }))
  const calls = []
  await generateImage(migratedChannel, { positive: 'old task snapshot' }, { resumeTaskId: 'accepted-before-upgrade', fetchImpl: async (url, init) => {
    calls.push([url, init.method])
    assert.equal(init.method, 'GET', 'restoring must never submit or upload a new generation')
    return prediction({ id: 'accepted-before-upgrade', status: 'completed', outputs: [`data:image/png;base64,${PNG.toString('base64')}`] })
  } })
  assert.deepEqual(calls, [[BASE + '/model/prediction/accepted-before-upgrade', 'GET']])
})

test('遮蔽后的 Atlas channel form 只从同协议旧配置恢复密钥，clear 标记和协议切换优先', () => {
  const previous = channel({ sizeMode: 'none' }, { baseUrl: BASE, model: 'my-model' })
  const hidden = publicChannels([previous])[0]
  assert.equal(hidden.provider, 'custom')
  assert.equal(hidden.options.apiProtocol, 'atlascloud')
  assert.equal('apiKey' in hidden, false)
  assert.equal(hidden.hasApiKey, true)

  const retained = normalizeChannels([hidden], [previous])[0]
  assert.equal(retained.apiKey, previous.apiKey)
  assert.equal('apiKey' in publicChannels([retained])[0], false)

  const cleared = normalizeChannels([{ ...hidden, clearApiKey: true }], [previous])[0]
  assert.equal(cleared.apiKey, '')

  const switched = normalizeChannels([{ ...hidden, options: { ...hidden.options, apiProtocol: 'qwen' } }], [previous])[0]
  assert.equal(switched.apiKey, '', 'a key from Atlas must not carry over to another protocol')
})

test('Atlas 原生异步提交、持久化任务号、轮询、下载；图片服务器不收到密钥', async () => {
  const calls = [], tasks = []
  let polls = 0, taskSaved = false
  const result = await generateImage(channel(), { positive: 'A mountain lake', negative: 'watermark', width: 832, height: 1216, seed: 42, steps: 20, cfg: 7 }, {
    onTask: async task => { tasks.push(task); await Promise.resolve(); taskSaved = true },
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      assert.equal(init.redirect, 'error')
      if (init.method === 'POST') return prediction({ id: 'prediction-123', status: 'created' })
      assert.equal(taskSaved, true, '任务号回调完成后才查询结果')
      if (url === CDN) return png()
      polls++
      return prediction({ id: 'prediction-123', status: polls === 1 ? 'queued' : polls === 2 ? 'processing' : 'completed', outputs: polls === 3 ? [CDN] : [] })
    },
  })
  assert.equal(calls[0].url, BASE + '/model/generateImage')
  assert.deepEqual(JSON.parse(calls[0].init.body), { model: 'black-forest-labs/flux-schnell', prompt: 'A mountain lake\n\nAvoid: watermark', size: '832*1216' })
  assert.deepEqual(tasks, [{ provider: 'atlascloud', taskId: 'prediction-123' }])
  assert.equal(calls.filter(call => call.init.method === 'POST').length, 1)
  for (const call of calls.slice(0, -1)) {
    assert.equal(call.init.headers.authorization, 'Bearer atlas-test-secret')
    assert.match(call.init.headers['user-agent'], /^dsh-tavern-image\//)
  }
  assert.ok(calls.slice(1, -1).every(call => call.url === BASE + '/model/prediction/prediction-123'))
  assert.deepEqual(calls.at(-1).init.headers, {})
  assert.equal(result.mediaType, 'image/png')
  assert.deepEqual(result.bytes, PNG)
})

test('Atlas 同步完成/成功别名兼容 outputs、旧 output、对象 URL 和内嵌图片', async t => {
  for (const [status, output] of [
    ['completed', { outputs: [CDN] }], ['succeeded', { output: CDN }], ['SUCCESS', { output: [CDN] }],
    ['completed', { outputs: [{ download_url: CDN }] }],
    ['completed', { outputs: ['data:image/png;base64,' + PNG.toString('base64')] }],
  ]) await t.test(status + ' ' + Object.keys(output)[0] + ' ' + typeof Object.values(output)[0], async () => {
    let submitted = 0
    const result = await generateImage(channel(), { positive: 'lake' }, { fetchImpl: async (url, init) => {
      if (init.method === 'POST') { submitted++; return prediction({ status, ...output }) }
      assert.equal(url, CDN, '同步完成不轮询')
      return png()
    } })
    assert.equal(submitted, 1)
    assert.deepEqual(result.bytes, PNG)
  })
})

test('Atlas 尺寸模式按模型选择，仅发送对应字段，支持自定义根地址与路径', async t => {
  for (const [options, expected] of [
    [{}, { size: '1024*1536' }],
    [{ size: ' 2048 × 2048 ' }, { size: '2048 × 2048' }],
    [{ size: '1024x1024' }, { size: '1024x1024' }],
    [{ size: '1024X1024' }, { size: '1024X1024' }],
    [{ size: '1024*1024' }, { size: '1024*1024' }],
    [{ sizeMode: 'aspect_ratio' }, { aspect_ratio: '2:3' }],
    [{ sizeMode: 'aspect_ratio', aspectRatio: '16:9', size: '2048x2048' }, { aspect_ratio: '16:9' }],
    [{ sizeMode: 'none', size: '2048x2048', aspectRatio: '16:9' }, {}],
  ]) await t.test(JSON.stringify(options), async () => {
    let payload
    await generateImage(channel({ ...options, generatePath: '/custom/generate' }, { model: 'custom/image-model', baseUrl: 'https://relay.test/atlas/' }), { positive: 'lake', width: 1024, height: 1536 }, {
      fetchImpl: async (url, init) => {
        if (init.method === 'POST') {
          assert.equal(url, 'https://relay.test/atlas/custom/generate')
          payload = JSON.parse(init.body)
          return prediction({ status: 'completed', outputs: [CDN] })
        }
        return png()
      },
    })
    assert.deepEqual(payload, { model: 'custom/image-model', prompt: 'lake', ...expected })
  })
})

test('Atlas 非法尺寸/参数模式在提交前拒绝', async () => {
  for (const options of [{ size: '2K' }, { size: '00x100' }, { sizeMode: 'invalid' }]) {
    await assert.rejects(generateImage(channel(options), { positive: 'lake' }, {
      fetchImpl: () => assert.fail('不应创建付费任务'),
    }), error => error.requestMayHaveSucceeded === false && /尺寸/.test(error.message))
  }
})

test('Atlas 任务失败终态含 HTTP 5xx 均明确失败、错误脱敏、不重发', async t => {
  for (const status of ['failed', 'canceled', 'cancelled', 'error', 'timeout']) {
    for (const httpStatus of [200, 500]) await t.test(status + '/' + httpStatus, async () => {
      let posts = 0, polls = 0
      await assert.rejects(generateImage(channel(), { positive: 'lake' }, {
        fetchImpl: async (_url, init) => {
          if (init.method === 'POST') { posts++; return prediction({ id: 'failed-task', status: 'created' }) }
          polls++
          return prediction({ status, error: { message: 'provider failed: atlas-test-secret' } }, httpStatus)
        },
      }), error => {
        assert.equal(error.requestMayHaveSucceeded, false)
        assert.match(error.message, /provider failed: \[redacted\]/)
        assert.doesNotMatch(error.message, /atlas-test-secret/)
        return true
      })
      assert.equal(posts, 1)
      assert.equal(polls, 1)
    })
  }
})

test('Atlas HTTP 200 业务拒绝、HTTP 鉴权拒绝不被当成已接单；5xx 未知结果保留不确定性', async () => {
  for (const [body, httpStatus, uncertain] of [
    [{ code: '400', message: 'bad request' }, 200, false],
    [null, 401, false],
    [{ code: 500, message: 'upstream unavailable' }, 500, true],
  ]) {
    let calls = 0
    await assert.rejects(generateImage(channel(), { positive: 'lake' }, { fetchImpl: async () => { calls++; return json(body, httpStatus) } }), error => error.requestMayHaveSucceeded === uncertain)
    assert.equal(calls, 1)
  }
})

test('Atlas 提交响应丢失、完成后下载失败或空输出均不自动重发', async () => {
  for (const mode of ['lost-post', 'download', 'empty', 'unsafe-url', 'bad-task-id']) {
    let posts = 0
    await assert.rejects(generateImage(channel(), { positive: 'lake' }, { fetchImpl: async (_url, init) => {
      if (init.method === 'POST') {
        posts++
        if (mode === 'lost-post') throw new Error('connection reset atlas-test-secret')
        if (mode === 'bad-task-id') return prediction({ id: '../other', status: 'created' })
        return prediction({ id: 'accepted-task', status: 'completed', outputs: mode === 'empty' ? [] : mode === 'unsafe-url' ? ['file:///secret'] : [CDN] })
      }
      return json({ message: 'cdn unavailable' }, 503)
    } }), error => error.requestMayHaveSucceeded === (mode !== 'empty' && mode !== 'unsafe-url') && !error.message.includes('atlas-test-secret'))
    assert.equal(posts, 1)
  }
})

test('Atlas 恢复任务只 GET 原任务，不提交；验证任务编号和渠道类型', async () => {
  const calls = [], tasks = []
  const result = await generateImage(channel({ taskPath: '/custom/tasks/' }, { baseUrl: 'https://relay.test/atlas' }), {}, {
    resumeTaskId: 'existing-task', onTask: task => tasks.push(task),
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      assert.equal(init.method, 'GET')
      if (url === CDN) return png()
      assert.equal(url, 'https://relay.test/atlas/custom/tasks/existing-task')
      return prediction({ id: 'existing-task', status: 'succeeded', outputs: [CDN] })
    },
  })
  assert.deepEqual(result.bytes, PNG)
  assert.deepEqual(tasks, [{ provider: 'atlascloud', taskId: 'existing-task' }])
  assert.equal(calls.length, 2)
  for (const id of ['', '../task', 'task?secret', 123, 'x'.repeat(201)]) await assert.rejects(generateImage(channel(), {}, {
    resumeTaskId: id, fetchImpl: () => assert.fail('非法任务号不发请求'),
  }), /无效的平台任务编号/)
  await assert.rejects(generateImage({ provider: 'openai' }, {}, { resumeTaskId: 'existing-task' }), /无效的平台任务编号/)
})

test('Atlas 轮询鉴权/网络故障保持已接单标记，可供只读恢复', async () => {
  for (const failure of ['auth', 'network']) {
    let saved
    await assert.rejects(generateImage(channel(), {}, { onTask: task => { saved = task.taskId }, fetchImpl: async (_url, init) => {
      if (init.method === 'POST') return prediction({ id: 'recover-later', status: 'created' })
      if (failure === 'network') throw new Error('network reset')
      return json(null, 401)
    } }), error => error.requestMayHaveSucceeded === true)
    assert.equal(saved, 'recover-later')
  }
})

test('Atlas 轮询超时保留任务号与不确定状态', async t => {
  let now = 1000, saved, calls = 0
  t.mock.method(Date, 'now', () => now)
  await assert.rejects(generateImage(channel({ pollTimeoutMs: 1000 }), {}, {
    onTask: task => { saved = task.taskId },
    fetchImpl: async (_url, init) => {
      calls++
      if (init.method === 'POST') return prediction({ id: 'slow-task', status: 'created' })
      now += 1001
      return prediction({ status: 'processing' })
    },
  }), error => error.requestMayHaveSucceeded === true && /等待超时/.test(error.message))
  assert.equal(saved, 'slow-task')
  assert.equal(calls, 2)
})

test('Atlas 提交前取消不发请求；提交后取消仅停止轮询', async () => {
  const before = new AbortController()
  before.abort(new Error('cancel before submit'))
  await assert.rejects(generateImage(channel(), {}, { signal: before.signal, fetchImpl: () => assert.fail('已取消') }), error => error.requestMayHaveSucceeded === false)
  const after = new AbortController()
  let calls = 0, saved
  await assert.rejects(generateImage(channel(), {}, {
    signal: after.signal,
    onTask: task => { saved = task.taskId; after.abort(new Error('cancel after submit')) },
    fetchImpl: async () => { calls++; return prediction({ id: 'cancelled-locally', status: 'created' }) },
  }), error => error.requestMayHaveSucceeded === true)
  assert.equal(saved, 'cancelled-locally')
  assert.equal(calls, 1)
})

test('Atlas 连接测试先鉴权查历史，再读文生图模型目录；不生成、不泄露密钥给目录', async () => {
  const calls = []
  const result = await testImageChannel(channel(), { fetchImpl: async (url, init) => {
    calls.push({ url, init })
    assert.equal(init.method, 'GET')
    if (url.endsWith('/model/history?no=1&size=1')) return json({ code: 200, data: { items: [], pageNo: 1, pageSize: 1, total: 0 } })
    assert.equal(url, BASE + '/models')
    return json({ code: 200, data: [
      { uuid: 'do-not-use', model: 'black-forest-labs/flux-schnell', type: 'Image', tags: ['TEXT-TO-IMAGE'], display_console: true },
      { model: 'nano/image', type: 'Image', tags: ['text_to_image'] },
      { model: 'nano/image', type: 'Image', tags: ['TEXT-TO-IMAGE'] },
      { model: 'hidden', type: 'Image', tags: ['TEXT-TO-IMAGE'], display_console: false },
      { model: 'video', type: 'Video', tags: ['TEXT-TO-IMAGE'] },
      { model: 'image-edit', type: 'Image', tags: ['IMAGE-TO-IMAGE'] },
      { model: 'image-tool', type: 'Image' },
    ] })
  } })
  assert.equal(result.ok, true)
  assert.equal(result.status, 'reachable')
  assert.match(result.message, /鉴权与任务查询正常/)
  assert.deepEqual(result.models, ['black-forest-labs/flux-schnell', 'nano/image'])
  assert.equal(calls.length, 2)
  assert.equal(calls[0].init.headers.authorization, 'Bearer atlas-test-secret')
  assert.equal(calls[1].init.headers.authorization, undefined)
})

test('Atlas 连接测试不把无权限、业务错误或错误响应当成功，也不靠公开目录验证 Key', async () => {
  for (const [body, status] of [[null, 401], [null, 403], [{ code: 400, message: 'bad atlas-test-secret' }, 200], [{ data: [] }, 200]]) {
    let calls = 0
    const result = await testImageChannel(channel(), { fetchImpl: async () => { calls++; return json(body, status) } })
    assert.equal(result.ok, false)
    assert.equal(calls, 1)
    assert.doesNotMatch(result.message, /atlas-test-secret/)
  }
  const result = await testImageChannel(channel(), { fetchImpl: async url => url.endsWith('/models') ? json(null, 503) : json({ code: 200, data: { items: [] } }) })
  assert.equal(result.ok, true, '公开目录不可用不否定已成功的鉴权查询')
  assert.equal(result.models, undefined)
})
