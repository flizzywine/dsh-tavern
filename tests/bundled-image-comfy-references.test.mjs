import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { imagePluginFixture, IMAGE_PNG, imageJson } from './fixtures/image-plugin-runtime.mjs'
import { comfyLoadImageBindings, applyComfyReferenceImages } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/comfy-reference-images.js'

const character = { id: 'lin', name: '林月', match: 'Lin Yue', traits: { face: 'red hair, violet eyes' }, outfits: [] }
function workflow({ loaders = ['8'], bindings } = {}) {
  const prompt = {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'old positive' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative' } },
    '3': { class_type: 'EmptyLatentImage', inputs: { width: 64, height: 64, batch_size: 2 } },
    '4': { class_type: 'KSampler', inputs: { seed: 1, steps: 2, cfg: 2 } },
    '5': { class_type: 'LoraLoader', inputs: { lora_name: 'old.safetensors', strength_model: 1, strength_clip: 1 } },
    '10': { class_type: 'SaveImage', inputs: { images: ['4', 0] } },
  }
  for (const id of loaders) prompt[id] = { class_type: 'LoadImage', inputs: { image: `existing-${id}.png` } }
  return {
    format: 'dsh-tavern-comfy-v1', name: 'reference fixture', outputNode: '10', prompt,
    bindings: {
      positive: [{ node: '1', input: 'text' }], negative: [{ node: '2', input: 'text' }],
      seed: [{ node: '4', input: 'seed' }], size: [{ node: '3' }], steps: [{ node: '4', input: 'steps' }],
      cfg: [{ node: '4', input: 'cfg' }], loras: [{ node: '5', name: 'selected.safetensors', strengthModel: 0.65, strengthClip: 0.75 }],
      ...(bindings === undefined ? {} : { referenceImages: bindings }),
    },
  }
}

async function setup(t, graph, { comfyMode = 'workflow', extraConfig = {} } = {}) {
  const fixture = await imagePluginFixture(t, {
    config: {
      imageBackend: 'comfyui', generationMode: 'reference', promptMode: 'structured', comfyMode,
      comfyUrl: 'http://127.0.0.1:8188', comfyAuthMode: 'bearer', comfyAuthToken: 'comfy-test-token',
      defaultWorkflow: 'ref', workflows: [{ id: 'ref', file: 'workflows/ref.json', label: 'reference fixture' }],
      ...extraConfig,
    },
    files: { 'workflows/ref.json': graph },
  })
  const runtime = await fixture.start()
  const uploaded = await runtime.request('reference-image', { data: IMAGE_PNG.toString('base64'), mediaType: 'image/png', name: 'reference.png' })
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body))
  const image = uploaded.body.referenceImage
  const definitions = {
    characters: [{ ...structuredClone(character), referenceImage: image, consistencyText: '保留眼角的小痣', outfits: [] }],
    outfits: [{ id: 'robe', name: '礼服', body: 'red dress', referenceImage: image, consistencyText: '使用红色礼服参考图' }],
    settings: [], props: [],
  }
  assert.equal((await runtime.request('definitions', { definitions })).status, 200)
  return { fixture, runtime, image, definitions }
}

async function jobInput(runtime, { outfit = false, key = 'reference-job' } = {}) {
  return runtime.request('jobs', {
    key, tag: '【人物】\n林月\n\n【动作】\n站在窗边。', generationMode: 'reference',
    subjects: [{ characterId: 'lin', ...(outfit ? { outfitId: 'robe' } : {}) }],
    size: '横图', negative: '不要水印',
  })
}

test('ComfyUI binding 仅自动接受唯一 LoadImage，多节点必须明确配置用途顺序', () => {
  assert.deepEqual(comfyLoadImageBindings(workflow({ loaders: ['12'] })), [{ node: '12', input: 'image' }])
  assert.throws(() => comfyLoadImageBindings(workflow({ loaders: ['2', '12'] })), /无法判断.*明确配置 referenceImages/)
  assert.deepEqual(comfyLoadImageBindings(workflow({ loaders: ['2', '12'], bindings: [
    { node: '12', input: 'image' }, { node: '2', input: 'image' },
  ] })), [{ node: '12', input: 'image' }, { node: '2', input: 'image' }])
  assert.throws(() => applyComfyReferenceImages(workflow({ loaders: ['8'] }), ['a.png', 'b.png']), /只有 1 个.*有 2 张/)
})

test('角色×服装图走现有上传流程，使用一个 LoadImage 槽并保留两种用途', async t => {
  const { runtime, definitions, image } = await setup(t, workflow())
  definitions.characters[0].outfits = [{ id: 'robe', name: '礼服', upper: 'red dress', characterOutfitImage: image }]
  definitions.outfits = []
  assert.equal((await runtime.request('definitions', { definitions })).status, 200)
  let uploads = 0
  let submitted
  globalThis.fetch = async (input, init = {}) => {
    switch (new URL(input).pathname) {
      case '/upload/image':
        uploads++
        return imageJson({ name: 'sheet.png', type: 'input' })
      case '/prompt':
        submitted = JSON.parse(init.body)
        return imageJson({ prompt_id: submitted.prompt_id })
      default:
        return imageJson({})
    }
  }
  const result = await jobInput(runtime, { outfit: true, key: 'paired-reference' })
  assert.equal(result.status, 200)
  assert.equal(uploads, 1)
  assert.equal(submitted.prompt['8'].inputs.image, 'sheet.png')
  assert.match(submitted.prompt['1'].inputs.text, /角色×服装参考/)
})

test('真实 runtime 上传不可变快照并保留编译后的完整 prompt graph、output binding 与双图显式映射', { timeout: 20000 }, async t => {
  const graph = workflow({ loaders: ['8', '9'], bindings: [{ node: '9', input: 'image' }, { node: '8', input: 'image' }] })
  const { fixture, runtime } = await setup(t, graph)
  const calls = [], files = []
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input)
    calls.push({ url: url.href, init })
    if (url.pathname === '/upload/image') {
      assert.equal(init.method, 'POST')
      assert.equal(init.headers.authorization, 'Bearer comfy-test-token')
      const form = init.body
      assert.equal(form.get('type'), 'input')
      assert.equal(form.get('overwrite'), 'false')
      const file = form.get('image')
      files.push({ name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) })
      return imageJson({ name: `uploaded-${files.length}.png`, subfolder: 'input', type: 'input' })
    }
    if (url.pathname === '/prompt') {
      const body = JSON.parse(init.body)
      assert.equal(body.prompt_id, body.prompt_id)
      return imageJson({ prompt_id: body.prompt_id, number: 1 })
    }
    return imageJson({ queue_running: [], queue_pending: [] })
  }
  const result = await jobInput(runtime, { outfit: true })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(files.length, 2)
  assert.deepEqual(files.map(item => item.bytes), [IMAGE_PNG, IMAGE_PNG])
  assert.ok(files.every(item => item.type === 'image/png' && /^dsh-reference-/.test(item.name)))
  const promptRequest = calls.find(item => new URL(item.url).pathname === '/prompt')
  assert.ok(promptRequest)
  const submitted = JSON.parse(promptRequest.init.body).prompt
  assert.equal(submitted['9'].inputs.image, 'input/uploaded-1.png')
  assert.equal(submitted['8'].inputs.image, 'input/uploaded-2.png')
  assert.match(submitted['1'].inputs.text, /林月|reference/i)
  assert.match(submitted['2'].inputs.text, /不要水印/)
  assert.equal(submitted['3'].inputs.width, 768)
  assert.equal(submitted['3'].inputs.height, 512)
  assert.equal(submitted['3'].inputs.batch_size, 1)
  assert.equal(submitted['4'].inputs.seed > 1, true)
  assert.equal(submitted['5'].inputs.lora_name, 'selected.safetensors')
  assert.equal(submitted['5'].inputs.strength_model, 0.65)
  assert.equal(submitted['10'].class_type, 'SaveImage')
  const saved = await fixture.read('jobs-store.json')
  const job = Object.values(saved).find(item => item.backend === 'comfyui')
  assert.equal(job.requestStarted, true)
  assert.equal(job.referenceSnapshot.references.length, 2)
})

test('无接图节点、多 LoadImage 未显式绑定、图片多于绑定都在上传和 prompt 前失败', { timeout: 20000 }, async t => {
  const scenarios = [
    ['no-load-image', workflow({ loaders: [] }), false, /没有 LoadImage/],
    ['ambiguous-load-images', workflow({ loaders: ['8', '9'] }), false, /无法判断.*referenceImages/],
    ['too-many-images', workflow({ loaders: ['8'] }), true, /只有 1 个.*有 2 张/],
  ]
  for (const [name, graph, twoReferences, message] of scenarios) await t.test(name, async t => {
    const { runtime } = await setup(t, graph)
    const calls = [], originalFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = originalFetch })
    globalThis.fetch = async input => { calls.push(new URL(input).pathname); return imageJson({ name: 'uploaded.png', subfolder: '', type: 'input' }) }
    const result = await jobInput(runtime, { outfit: twoReferences })
    assert.equal(result.status, 200)
    assert.equal(result.body.state, 'failed')
    assert.match(result.body.error, message)
    assert.equal(calls.includes('/upload/image'), false)
    assert.equal(calls.includes('/prompt'), false)
  })
})

test('Comfy 参考图上传鉴权失败不会 POST workflow 或标记已提交', { timeout: 20000 }, async t => {
  const { runtime } = await setup(t, workflow())
  const calls = [], originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async (input, init) => {
    calls.push({ path: new URL(input).pathname, authorization: init.headers.authorization })
    return new Response('unauthorized', { status: 401 })
  }
  const result = await jobInput(runtime)
  assert.equal(result.status, 200)
  assert.equal(result.body.state, 'failed')
  assert.equal(result.body.requestStarted, false)
  assert.match(result.body.error, /第 1 张参考图上传失败.*401/)
  assert.deepEqual(calls.map(call => call.path), ['/upload/image'])
  assert.equal(calls[0].authorization, 'Bearer comfy-test-token')
})

test('Comfy 提交前必需落盘失败保持未提交且不会 POST', { timeout: 20000 }, async t => {
  const { fixture, runtime } = await setup(t, workflow())
  const storePath = join(fixture.pluginRoot, 'jobs-store.json')
  await rm(storePath, { force: true })
  await mkdir(storePath)
  const paths = [], originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async input => {
    paths.push(new URL(input).pathname)
    return imageJson({ prompt_id: 'unexpected' })
  }
  const result = await runtime.request('jobs', { key: 'write-before-post', tag: '一片森林', generationMode: 'text' })
  assert.equal(result.body.state, 'failed')
  assert.equal(result.body.requestStarted, false)
  assert.equal(result.body.requestMayHaveSucceeded, false)
  assert.match(result.body.error, /保存生图任务失败/)
  assert.deepEqual(paths, [])
})

test('取消上传时不提交；取消在 prompt 已发出后按原 key 重试也不重复 POST', { timeout: 20000 }, async t => {
  for (const stage of ['upload', 'prompt']) await t.test(stage, async t => {
    const { fixture, runtime } = await setup(t, workflow())
    const calls = [], originalFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = originalFetch })
    let cancelled = false
    globalThis.fetch = async (input, init = {}) => {
      const path = new URL(input).pathname
      calls.push(path)
      if ((stage === 'upload' && path === '/upload/image') || (stage === 'prompt' && path === '/prompt')) {
        const saved = await fixture.read('jobs-store.json')
        const job = Object.values(saved).find(item => item.key === 'cancel-' + stage)
        assert.ok(job, '提交标记应在请求前保存')
        assert.equal(job.requestStarted, stage === 'prompt')
        const cancel = await runtime.request('cancel', { id: job.id })
        assert.equal(cancel.status, 200)
        cancelled = true
        await new Promise((resolve, reject) => {
          if (init.signal.aborted) return reject(init.signal.reason)
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        })
      }
      return imageJson({ name: 'uploaded.png', subfolder: '', type: 'input' })
    }
    const body = { key: 'cancel-' + stage, tag: '林月在窗边', generationMode: 'reference', subjects: [{ characterId: 'lin' }] }
    const result = await runtime.request('jobs', body)
    assert.equal(cancelled, true)
    assert.equal(result.body.state, 'cancelled')
    const firstPosts = calls.filter(path => path === '/prompt').length
    assert.equal(firstPosts, stage === 'upload' ? 0 : 1)
    if (stage === 'prompt') {
      const retry = await runtime.request('jobs', body)
      assert.equal(retry.status, 400)
      assert.equal(calls.filter(path => path === '/prompt').length, 1)
    }
  })
})

test('Comfy 地址在参考图上传期间变更时不把后续图或 workflow 发往新 endpoint', { timeout: 20000 }, async t => {
  const graph = workflow({ loaders: ['8', '9'], bindings: [{ node: '8', input: 'image' }, { node: '9', input: 'image' }] })
  const { runtime } = await setup(t, graph)
  const calls = [], originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async input => {
    const url = new URL(input)
    calls.push(url.origin + url.pathname)
    if (url.pathname === '/upload/image') {
      await runtime.request('config', { comfyUrl: 'http://127.0.0.1:8199' })
      return imageJson({ name: 'uploaded.png', subfolder: '', type: 'input' })
    }
    return imageJson({ prompt_id: 'unexpected' })
  }
  const result = await jobInput(runtime, { outfit: true })
  assert.equal(result.body.state, 'failed')
  assert.equal(result.body.requestStarted, false)
  assert.match(result.body.error, /ComfyUI 地址在提交期间发生变化/)
  assert.deepEqual(calls, ['http://127.0.0.1:8188/upload/image'])
})

test('旧 simple 配置显式迁移到已存 workflow 后可用且保留原 comfySimple 数据', { timeout: 20000 }, async t => {
  const savedSimple = { template: 'flux', checkpoint: 'my-model.safetensors', customField: { keep: true } }
  const { fixture, runtime } = await setup(t, workflow(), { comfyMode: 'simple', extraConfig: { comfySimple: savedSimple } })
  const state = await runtime.request('state')
  assert.equal(state.body.referenceSupported, false)
  assert.match(state.body.configurationWarning, /旧版 ComfyUI 简易模式已停用/)
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const calls = []
  globalThis.fetch = async input => {
    const path = new URL(input).pathname
    calls.push(path)
    return path === '/prompt' ? imageJson({ prompt_id: 'accepted' }) : imageJson({ name: 'uploaded.png', subfolder: '', type: 'input' })
  }
  const blocked = await jobInput(runtime)
  assert.equal(blocked.status, 400)
  assert.match(blocked.body.error, /简易模式已停用.*导入完整 ComfyUI API workflow/)
  assert.deepEqual(calls, [])
  const migrated = await runtime.request('config', { defaultWorkflow: 'ref' })
  assert.equal(migrated.status, 200)
  const persisted = await fixture.read('config.json')
  assert.equal(persisted.comfyMode, 'workflow')
  assert.deepEqual(persisted.comfySimple, savedSimple)
})

test('旧 Atlas 已接单 job 在 provider 无损迁移到 custom 后仅查询原 task，不重新生成', { timeout: 20000 }, async t => {
  const endpoint = 'https://atlas.example.test/api/v1'
  const savedJob = {
    id: '11111111-1111-4111-8111-111111111111', backend: 'atlascloud', channelId: 'atlas',
    channelEndpoint: endpoint, providerTaskProvider: 'atlascloud', providerTaskId: 'already-accepted',
    state: 'running', requestStarted: true, submissionTracked: true, createdAt: 1,
    positive: 'mountain lake', negative: '', size: { width: 1024, height: 1024 }, params: {},
  }
  const fixture = await imagePluginFixture(t, {
    config: {
      imageBackend: 'atlascloud', activeImageChannel: 'atlas', queryThrottleMs: 1,
      imageChannels: [{ id: 'atlas', provider: 'atlascloud', name: 'legacy Atlas', baseUrl: endpoint, model: 'test-model', apiKey: 'legacy-secret', options: { pollIntervalMs: 1 } }],
    },
    files: { 'jobs-store.json': { [savedJob.id]: savedJob } },
  })
  const runtime = await fixture.start()
  const calls = [], originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' })
    if (String(url) === 'https://images.example.test/result.png') return new Response(IMAGE_PNG)
    return imageJson({ code: 200, data: { id: 'already-accepted', status: 'completed', outputs: ['https://images.example.test/result.png'] } })
  }
  const state = await runtime.request('state')
  assert.equal(state.body.config.imageBackend, 'custom')
  assert.equal(state.body.config.imageChannels[0].provider, 'custom')
  assert.equal(state.body.config.imageChannels[0].options.apiProtocol, 'atlascloud')
  const result = await runtime.request('jobs?id=' + savedJob.id)
  assert.equal(result.body.job.state, 'done')
  assert.equal(result.body.job.backend, 'atlascloud', 'historical job identity remains intact')
  assert.deepEqual(calls.map(call => [call.url, call.method]), [
    [endpoint + '/model/prediction/already-accepted', 'GET'],
    ['https://images.example.test/result.png', 'GET'],
  ])
})

