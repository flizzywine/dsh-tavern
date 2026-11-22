import test from 'node:test'
import assert from 'node:assert/strict'
import { IMAGE_PROVIDERS, generateImage } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-providers.js'

// All transport in this file is mocked. Never uploads or generates a real image.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex')
const BASE = 'https://api.atlascloud.ai/api/v1'
const CDN = 'https://images.example.test/result.png'
const uploadUrl = index => `https://files.example.test/reference-${index}.png?signature=temporary-${index}`
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const uploaded = index => json({ code: 200, data: { download_url: uploadUrl(index), filename: 'remote.png', size: PNG.length } })
const generated = () => json({ code: 200, data: { id: 'reference-task', status: 'completed', outputs: [CDN] } })
const png = () => new Response(PNG, { headers: { 'content-type': 'image/png' } })
const channel = (options = {}, fields = {}) => ({ provider: 'atlascloud', apiKey: 'atlas-reference-secret', model: 'custom/future-image-model', options: { sizeMode: 'none', pollIntervalMs: 1, ...options }, ...fields })
const reference = (patch = {}) => ({ data: PNG, mediaType: 'image/png', name: 'private-name.png', ...patch })
const notStarted = error => {
  assert.equal(error.submissionNotStarted, true)
  assert.equal(error.requestMayHaveSucceeded, false)
  return true
}

test('Atlas 上传同时兼容官方技能 data.download_url 与文档 url 响应', async t => {
  for (const [name, response] of [
    ['skill', { code: 200, data: { download_url: uploadUrl(1) } }],
    ['docs', { url: uploadUrl(1) }],
    ['wrapped-url', { code: 200, data: { url: uploadUrl(1) } }],
  ]) await t.test(name, async () => {
    await generateImage(channel(), { references: [reference()] }, { fetchImpl: async (url, init) => {
      if (url.endsWith('/uploadMedia')) return json(response)
      if (init.method === 'POST') {
        assert.deepEqual(JSON.parse(init.body).images, [uploadUrl(1)])
        return generated()
      }
      return png()
    } })
  })
})

test('Atlas 自定义根地址仍在同一 API 根上传，不把密钥发到返回的参考图 URL', async () => {
  const calls = []
  await generateImage(channel({ generatePath: '/custom/generate' }, { baseUrl: 'https://relay.example.test/atlas' }), { references: [reference()] }, {
    fetchImpl: async (url, init) => {
      calls.push(url)
      if (url.endsWith('/uploadMedia')) return uploaded(1)
      if (init.method === 'POST') {
        assert.equal(url, 'https://relay.example.test/atlas/custom/generate')
        assert.deepEqual(JSON.parse(init.body).images, [uploadUrl(1)])
        return generated()
      }
      assert.equal(url, CDN, 'provider 不读取已上传参考图 URL')
      return png()
    },
  })
  assert.deepEqual(calls, ['https://relay.example.test/atlas/model/uploadMedia', 'https://relay.example.test/atlas/custom/generate', CDN])
})

test('参考图参数和全部本地图片先校验，错误时不上传任何子集、不读取路径或 URL', async t => {
  const cases = [
    ['非数组', 'https://user:pass@private.test/image'],
    ['null', null],
    ['缺少本地字节', [reference(), { path: '/home/private/face.png', url: 'https://secret.test/image', mediaType: 'image/png' }]],
    ['字符串不当作路径或编码', [reference({ data: 'C:\\private\\face.png' })]],
    ['Buffer JSON 不当作字节', [reference({ data: { type: 'Buffer', data: [...PNG] } })]],
    ['稀疏数组不能漏掉参考图', [reference(), , reference()]],
    ['空字节', [reference({ data: new Uint8Array() })]],
    ['伪图片', [reference({ data: Buffer.from('not an image') })]],
    ['缺少 MIME', [reference({ mediaType: undefined })]],
    ['不支持的 MIME', [reference({ mediaType: 'application/pdf' })]],
    ['MIME 内容不符', [reference({ mediaType: 'image/jpeg' })]],
    ['超出单文件大小限制', [reference({ data: Buffer.concat([PNG, Buffer.alloc(1024)]) })]],
  ]
  for (const [name, references] of cases) await t.test(name, async () => {
    await assert.rejects(generateImage(channel(), { references }, {
      maxImageBytes: 1024,
      onGenerationSubmit: () => assert.fail('校验失败不能标记生图提交'),
      fetchImpl: () => assert.fail('所有图片校验后才允许联网'),
    }), error => notStarted(error) && /参考图/.test(error.message) && !/private|secret\.test/.test(error.message))
  })
})

test('Atlas 上传失败/响应丢失不是付费生图结果不明，不继续生成也不自动重传', async t => {
  const cases = [
    ['上传丢响应', () => { throw new Error('upload connection reset') }],
    ['HTTP 401', () => json({ message: 'upload unauthorized' }, 401)],
    ['HTTP 503', () => json({ message: 'upload unavailable' }, 503)],
    ['业务拒绝', () => json({ code: 400, message: 'file rejected' })],
    ['错误终态', () => json({ code: 200, data: { status: 'failed', error: 'file rejected' } })],
    ['无效 JSON', () => new Response('broken JSON')],
    ['缺少 URL', () => json({ data: { filename: 'face.png' } })],
    ['非 HTTP URL', () => json({ data: { download_url: 'file:///home/private/face.png' } })],
    ['URL 带登录凭据', () => json({ data: { download_url: 'https://username:password@files.example.test/face.png' } })],
  ]
  for (const [name, fail] of cases) await t.test(name, async () => {
    let calls = 0
    await assert.rejects(generateImage(channel(), { references: [reference(), reference()] }, {
      onGenerationSubmit: () => assert.fail('上传失败不能标记生图提交'),
      onTask: () => assert.fail('上传结果不是生图任务'),
      fetchImpl: async (url, init) => {
        assert.equal(url, BASE + '/model/uploadMedia')
        assert.equal(init.method, 'POST')
        if (++calls === 1) return uploaded(1)
        return fail()
      },
    }), error => notStarted(error) && /第 2 张参考图上传失败/.test(error.message))
    assert.equal(calls, 2)
  })
})

test('Atlas 上传过程和 POST 前取消/持久化失败均标记 submissionNotStarted', async t => {
  for (const stage of ['before', 'upload', 'after-upload', 'hook-abort', 'hook-error']) await t.test(stage, async () => {
    const controller = new AbortController()
    let uploads = 0, hooks = 0
    if (stage === 'before') controller.abort(new Error('cancel before upload'))
    await assert.rejects(generateImage(channel(), { references: [reference()] }, {
      signal: controller.signal,
      onGenerationSubmit: async () => {
        hooks++
        if (stage === 'hook-abort') controller.abort(new DOMException('cancelled before POST', 'AbortError'))
        if (stage === 'hook-error') throw new Error('could not persist submission marker')
      },
      fetchImpl: async url => {
        assert.equal(url, BASE + '/model/uploadMedia', '只能有上传，不能有生图 POST')
        uploads++
        if (stage === 'upload') {
          controller.abort(new DOMException('cancelled during upload', 'AbortError'))
          throw controller.signal.reason
        }
        if (stage === 'after-upload') controller.abort(new Error('cancel after upload'))
        return uploaded(1)
      },
    }), notStarted)
    assert.equal(uploads, stage === 'before' ? 0 : 1)
    assert.equal(hooks, stage.startsWith('hook-') ? 1 : 0)
  })
})

test('Atlas 上传超时未提交生图，错误保留安全重试标记', async () => {
  await assert.rejects(generateImage(channel({ timeoutMs: 1000 }), { references: [reference()] }, {
    fetchImpl: async (url, init) => {
      assert.equal(url, BASE + '/model/uploadMedia')
      return new Promise((_, reject) => {
        // Keep a ref'ed timer so the provider's unref'ed timeout can fire under node:test.
        const keepAlive = setTimeout(() => reject(new Error('test guard timeout')), 3000)
        init.signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(init.signal.reason) }, { once: true })
      })
    },
  }), error => notStarted(error) && /生图请求超时/.test(error.message))
})

test('Atlas 恢复已接单任务不访问参考图字节，不上传、不 POST、不调用提交 hook', async () => {
  const request = Object.defineProperty({}, 'references', { get() { assert.fail('恢复时不得要求旧参考图仍能加载') } })
  const calls = [], tasks = []
  const result = await generateImage(channel(), request, {
    resumeTaskId: 'accepted-before-restart',
    onGenerationSubmit: () => assert.fail('恢复不发生生图提交'),
    onTask: task => tasks.push(task),
    fetchImpl: async (url, init) => {
      calls.push(url)
      assert.equal(init.method, 'GET')
      if (url === CDN) { assert.deepEqual(init.headers, {}); return png() }
      assert.equal(url, BASE + '/model/prediction/accepted-before-restart')
      return json({ data: { status: 'completed', outputs: [CDN] } })
    },
  })
  assert.deepEqual(result.bytes, PNG)
  assert.equal(calls.length, 2)
  assert.deepEqual(tasks, [{ provider: 'atlascloud', taskId: 'accepted-before-restart' }])
  await assert.rejects(generateImage(channel(), request, {
    resumeTaskId: 'accepted-before-restart', fetchImpl: async () => { throw new Error('polling connection reset') },
  }), error => error.submissionNotStarted === false && error.requestMayHaveSucceeded === true)
})

test('Atlas 真正生图 POST 后才标记结果不明，明确拒绝则保留平台错误，不重试/裁剪/降级', async t => {
  const cases = [
    ['POST 丢响应', true], ['HTTP 503', true], ['损坏 JSON', true], ['HTTP 400', false], ['业务拒绝', false], ['平台失败', false], ['下载失败', true],
  ]
  for (const [name, uncertain] of cases) await t.test(name, async () => {
    let uploads = 0, posts = 0, hooks = 0
    await assert.rejects(generateImage(channel(), { references: [reference()] }, {
      onGenerationSubmit: () => { hooks++ },
      fetchImpl: async (url, init) => {
        if (url.endsWith('/uploadMedia')) return uploaded(++uploads)
        if (init.method === 'POST') {
          posts++
          assert.equal(hooks, 1)
          assert.deepEqual(JSON.parse(init.body).images, [uploadUrl(1)])
          if (name === 'POST 丢响应') throw new Error('generation connection reset')
          if (name === 'HTTP 503') return json({ message: 'upstream unavailable' }, 503)
          if (name === '损坏 JSON') return new Response('broken JSON')
          if (name === 'HTTP 400') return json({ message: 'too many reference images' }, 400)
          if (name === '业务拒绝') return json({ code: 400, message: 'model does not accept images' })
          if (name === '平台失败') return json({ data: { status: 'failed', error: 'image render failed' } })
          return generated()
        }
        assert.equal(url, CDN)
        assert.deepEqual(init.headers, {})
        return json({ message: 'cdn unavailable' }, 503)
      },
    }), error => error.submissionNotStarted === false && error.requestMayHaveSucceeded === uncertain)
    assert.equal(uploads, 1)
    assert.equal(posts, 1)
  })
})

test('Atlas 生图已经提交后取消必须保持已接单不确定性', async () => {
  const controller = new AbortController()
  let uploads = 0, posts = 0
  await assert.rejects(generateImage(channel(), { references: [reference()] }, {
    signal: controller.signal,
    onTask: () => controller.abort(new DOMException('cancel after generation POST', 'AbortError')),
    fetchImpl: async (url, init) => {
      if (url.endsWith('/uploadMedia')) return uploaded(++uploads)
      assert.equal(init.method, 'POST')
      posts++
      return json({ data: { id: 'accepted-but-cancelled', status: 'created' } })
    },
  }), error => error.submissionNotStarted === false && error.requestMayHaveSucceeded === true)
  assert.equal(uploads, 1)
  assert.equal(posts, 1)
})

test('Atlas 参考图错误脱敏：密钥、Basic、签名 URL、URL 凭据及本地路径不进入错误', async () => {
  const key = 'atlas-reference-secret', password = 'private-basic-password', username = 'private-basic-user'
  const leak = [
    'invalid reference image', key, encodeURIComponent(key), Buffer.from(key).toString('base64'),
    Buffer.from(`${username}:${password}`).toString('base64'),
    'https://login:private-url-password@files.example.test/private-name.png?token=private-token',
    'https%3A%2F%2Ffiles.example.test%2Fphoto.png%3Ftoken%3Dencoded-secret',
    'file:///home/private-user/reference.png', '/home/private-user/reference.png', '"/home/private user/reference photo.png"',
    '"C:\\Users\\private-user\\reference image.png"', '"\\\\private-server\\share\\reference.png"',
  ].join(' ')
  for (const stage of ['upload', 'generate', 'download']) {
    await assert.rejects(generateImage(channel({}, { apiKey: key, authMode: 'basic', username, password }), { references: [reference()] }, {
      fetchImpl: async (url, init) => {
        if (url.endsWith('/uploadMedia')) return stage === 'upload' ? json({ message: leak }, 400) : uploaded(1)
        if (init.method === 'POST') return stage === 'generate' ? json({ message: leak }, 400) : generated()
        return json({ message: leak }, 503)
      },
    }), error => {
      assert.match(error.message, /invalid reference image/)
      assert.doesNotMatch(error.message, /atlas-reference-secret|private-|encoded-secret|files\.example|C:|https|file:\/\//)
      assert.doesNotMatch(error.message, new RegExp(Buffer.from(`${username}:${password}`).toString('base64')))
      return true
    })
  }
})
