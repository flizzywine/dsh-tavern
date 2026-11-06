import test from 'node:test'
import assert from 'node:assert/strict'
import { IMAGE_PROVIDERS, generateImage, effectiveImageProvider, supportsImageReferences, supportsImageTaskResume } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-providers.js'
import { channelConfigPatch, publicChannels } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-channels.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex')
const pngResponse = () => new Response(PNG, { headers: { 'content-type': 'image/png' } })
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const output = () => json({ data: [{ b64_json: PNG.toString('base64') }] })
const ref = (data = PNG) => ({ data, mediaType: 'image/png' })
const custom = (apiProtocol = 'openai', options = {}) => ({
  id: 'custom-test', provider: 'custom', name: 'My relay', baseUrl: 'https://relay.example.test/api/v1',
  model: 'user-model', apiKey: 'user-secret-key', options: { apiProtocol, ...options },
})

test('custom channel uses an allowlisted explicit protocol, defaults to OpenAI, and keeps credentials private', () => {
  assert.equal(IMAGE_PROVIDERS.some(item => item.id === 'custom'), true)
  assert.equal(effectiveImageProvider({ provider: 'custom' }), 'openai')
  assert.equal(effectiveImageProvider(custom('qwen')), 'qwen')
  assert.equal(supportsImageReferences(custom('qwen')), true)
  assert.equal(supportsImageReferences(custom('qwen', { apiMode: 'async' })), false)
  assert.equal(supportsImageReferences(custom('novelai')), false)
  assert.equal(supportsImageTaskResume(custom('atlascloud')), true)
  assert.equal(supportsImageTaskResume(custom('qwen')), true)
  assert.equal(supportsImageTaskResume(custom('openai')), false)
  const saved = channelConfigPatch({ imageBackend: 'comfyui', imageChannels: [] }, {
    imageBackend: 'custom', activeImageChannel: 'custom-test', imageChannels: [custom('atlascloud')],
  })
  const publicChannel = publicChannels(saved.imageChannels)[0]
  assert.equal(publicChannel.hasApiKey, true)
  assert.equal('apiKey' in publicChannel, false)
  assert.equal(publicChannel.options.apiProtocol, 'atlascloud')
  assert.throws(() => channelConfigPatch({ imageBackend: 'comfyui', imageChannels: [] }, {
    imageBackend: 'custom', activeImageChannel: 'custom-test', imageChannels: [custom('execute-this')],
  }), /协议无效/)
})

test('custom OpenAI protocol sends selected reference bytes as multipart edits to the entered URL once', async () => {
  const calls = []
  const selected = [ref(), ref(PNG)]
  let persisted = false
  await generateImage(custom(), { positive: 'use selected refs', references: selected }, { onGenerationSubmit: async () => { await Promise.resolve(); persisted = true }, fetchImpl: async (url, init) => {
    calls.push({ url, init })
    assert.equal(persisted, true, 'submission marker is awaited immediately before the paid POST')
    assert.equal(url, 'https://relay.example.test/api/v1/images/edits')
    assert.match(init.headers.authorization, /^Bearer /)
    assert.equal(init.headers.authorization, 'Bearer user-secret-key', 'key goes only through the established authorization header')
    assert.equal(init.body instanceof FormData, true)
    assert.equal(init.headers['content-type'], undefined)
    assert.equal(init.body.get('model'), 'user-model')
    assert.equal(init.body.get('prompt'), 'use selected refs')
    const images = init.body.getAll('image[]')
    assert.equal(images.length, selected.length)
    for (const image of images) assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG)
    assert.doesNotMatch([...init.body.keys()].join(','), /unselected/)
    return output()
  } })
  assert.equal(calls.length, 1, 'a paid generation is submitted once')
})

test('image quality choice reaches OpenAI Images quality; the empty automatic choice keeps the previous request', async () => {
  const bodies = []
  const fetchImpl = async (_url, init) => { bodies.push(init.body); return output() }
  const openai = options => ({ id: 'openai-test', provider: 'openai', name: 'OpenAI', baseUrl: 'https://images.example.test/v1', model: 'gpt-image-1', apiKey: 'user-secret-key', options })
  await generateImage(openai({}), { positive: 'a cat' }, { fetchImpl })
  await generateImage(openai({ quality: '' }), { positive: 'a cat' }, { fetchImpl })
  await generateImage(openai({ quality: 'low' }), { positive: 'a cat' }, { fetchImpl })
  await generateImage({ ...custom('openai', { quality: 'high' }), model: 'gpt-image-1' }, { positive: 'a cat' }, { fetchImpl })
  assert.equal(bodies[1], bodies[0], 'automatic is byte-identical to a channel that never chose a quality')
  assert.deepEqual(bodies.map(body => JSON.parse(body).quality), ['medium', 'medium', 'low', 'high'])
  // A Tavern stage-asset request still wins over the channel choice.
  await generateImage(openai({ quality: 'low' }), { positive: 'a cat', quality: 'high' }, { fetchImpl })
  assert.equal(JSON.parse(bodies.at(-1)).quality, 'high')
})

test('protocols without a quality parameter never send one, even with a stored quality option', async () => {
  for (const protocol of ['seedream', 'grok']) {
    await generateImage(custom(protocol, { quality: 'high' }), { positive: 'a cat' }, { fetchImpl: async (_url, init) => {
      assert.equal(Object.hasOwn(JSON.parse(init.body), 'quality'), false, protocol)
      return output()
    } })
  }
})

test('custom Gemini inlineData, Gemini Chat image parts, Seedream and Grok use documented input shapes', async t => {
  await t.test('Gemini', async () => {
    await generateImage(custom('gemini'), { positive: 'edit this', references: [ref()] }, { fetchImpl: async (url, init) => {
      assert.equal(url, 'https://relay.example.test/api/v1/models/user-model:generateContent')
      assert.equal(init.headers['x-goog-api-key'], 'user-secret-key')
      assert.equal(init.headers.authorization, undefined)
      const body = JSON.parse(init.body)
      assert.deepEqual(body.contents[0].parts[0], { inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } })
      assert.equal(body.contents[0].parts.at(-1).text, 'edit this')
      return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] })
    } })
  })
  await t.test('Gemini Chat', async () => {
    await generateImage(custom('gemini-chat'), { positive: 'edit this', references: [ref()] }, { fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      assert.deepEqual(body.messages[0].content[0], { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG.toString('base64')}` } })
      assert.deepEqual(body.messages[0].content[1], { type: 'text', text: 'edit this' })
      return json({ choices: [{ message: { content: `data:image/png;base64,${PNG.toString('base64')}` } }] })
    } })
  })
  await t.test('Seedream', async () => {
    await generateImage(custom('seedream'), { positive: 'edit this', references: [ref()] }, { fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      assert.deepEqual(body.image, [`data:image/png;base64,${PNG.toString('base64')}`])
      return output()
    } })
  })
  await t.test('Grok', async () => {
    await generateImage(custom('grok'), { positive: 'edit this', references: [ref()] }, { fetchImpl: async (url, init) => {
      assert.equal(url, 'https://relay.example.test/api/v1/images/edits')
      assert.deepEqual(JSON.parse(init.body).image, { url: `data:image/png;base64,${PNG.toString('base64')}`, type: 'image_url' })
      return output()
    } })
    let submitted = false
    await assert.rejects(generateImage(custom('grok'), { references: [ref(), ref()] }, { fetchImpl: () => { submitted = true } }), /一次只接受 1 张/)
    assert.equal(submitted, false)
  })
})

test('custom SD WebUI and Qwen carry the exact reference bytes; Qwen rejects legacy async edits', async t => {
  await t.test('SD WebUI', async () => {
    await generateImage(custom('sdwebui'), { positive: 'edit this', references: [ref()] }, { fetchImpl: async (url, init) => {
      assert.equal(url, 'https://relay.example.test/api/v1/sdapi/v1/img2img')
      const body = JSON.parse(init.body)
      assert.deepEqual(body.init_images, [PNG.toString('base64')])
      return json({ images: [PNG.toString('base64')] })
    } })
    let submitted = false
    await assert.rejects(generateImage(custom('sdwebui'), { references: [ref(), ref()] }, { fetchImpl: () => { submitted = true } }), /一次只支持 1 张参考图/)
    assert.equal(submitted, false, 'multiple references are rejected before the img2img POST')
  })
  await t.test('Qwen', async () => {
    await generateImage(custom('qwen'), { positive: 'edit this', references: [ref()] }, { fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      assert.deepEqual(body.input.messages[0].content[0], { image: `data:image/png;base64,${PNG.toString('base64')}` })
      assert.deepEqual(body.input.messages[0].content[1], { text: 'edit this' })
      return json({ output: { choices: [{ message: { content: [{ image: `data:image/png;base64,${PNG.toString('base64')}` }] } }] } })
    } })
    let calls = 0
    await assert.rejects(generateImage(custom('qwen', { apiMode: 'async' }), { references: [ref()] }, { fetchImpl: () => { calls++ } }), /不支持参考图/)
    assert.equal(calls, 0)
  })
})

test('custom Atlas resumes at its configured URL without reupload or duplicate generation POST', async () => {
  const channel = custom('atlascloud', { sizeMode: 'none', pollIntervalMs: 1 })
  const calls = [], tasks = []
  await generateImage(channel, { references: [ref()] }, { onTask: task => tasks.push(task), onGenerationSubmit: async () => {
    assert.deepEqual(calls, [['https://relay.example.test/api/v1/model/uploadMedia', 'POST']], 'all reference uploads finish before submit marker')
  }, fetchImpl: async (url, init) => {
    calls.push([url, init.method])
    if (url.endsWith('/uploadMedia')) return json({ data: { download_url: 'https://files.example.test/ref.png' } })
    if (init.method === 'POST') return json({ data: { id: 'atlas-custom-task', status: 'created' } })
    return json({ data: { id: 'atlas-custom-task', status: 'completed', outputs: [`data:image/png;base64,${PNG.toString('base64')}`] } })
  } })
  assert.deepEqual(tasks, [{ provider: 'atlascloud', taskId: 'atlas-custom-task' }])
  assert.equal(calls.filter(([, method]) => method === 'POST').length, 2, 'one upload and one billable generation')
  calls.length = 0
  await generateImage(channel, { references: [ref()] }, { resumeTaskId: 'atlas-custom-task', onGenerationSubmit: () => assert.fail('resume must not submit again'), fetchImpl: async (url, init) => {
    calls.push([url, init.method])
    assert.equal(init.method, 'GET')
    return json({ data: { id: 'atlas-custom-task', status: 'completed', outputs: [`data:image/png;base64,${PNG.toString('base64')}`] } })
  } })
  assert.deepEqual(calls, [['https://relay.example.test/api/v1/model/prediction/atlas-custom-task', 'GET']])
})

test('custom Qwen async task callback records effective protocol and resume polls without another submission', async () => {
  const channel = custom('qwen', { apiMode: 'async', pollIntervalMs: 1 })
  const calls = [], tasks = []
  const fetchImpl = async (url, init) => {
    calls.push([url, init.method])
    if (init.method === 'POST') return json({ output: { task_id: 'qwen-custom-task' } })
    if (url.endsWith('/tasks/qwen-custom-task')) return json({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://files.example.test/result.png' }] } })
    return pngResponse()
  }
  let submitCount = 0
  await generateImage(channel, { positive: 'lake' }, { onTask: task => tasks.push(task), onGenerationSubmit: () => { submitCount++ }, fetchImpl })
  assert.deepEqual(tasks, [{ provider: 'qwen', taskId: 'qwen-custom-task' }])
  calls.length = 0
  await generateImage(channel, { positive: 'lake' }, { resumeTaskId: 'qwen-custom-task', onGenerationSubmit: () => assert.fail('resume must not submit again'), fetchImpl })
  assert.equal(calls.some(([, method]) => method === 'POST'), false)
  assert.equal(calls[0][1], 'GET')
  assert.equal(submitCount, 1)
})

test('Qwen, Grok and Seedream image-edit rejections remain platform errors with no text-only fallback', async t => {
  for (const protocol of ['qwen', 'grok', 'seedream']) await t.test(protocol, async () => {
    const calls = []
    await assert.rejects(generateImage(custom(protocol), { positive: 'edit', references: [ref()] }, { fetchImpl: async (url, init) => {
      calls.push([url, init.method])
      return json({ message: `${protocol} model does not accept image input` }, 400)
    } }), new RegExp(`${protocol} model does not accept image input`))
    assert.equal(calls.length, 1, 'a rejected edit is never retried as text-to-image')
    assert.equal(calls[0][1], 'POST')
  })
})

test('unsupported NovelAI references fail before HTTP; custom text generation remains compatible', async t => {
  await t.test('explicit unsupported error', async () => {
    let calls = 0
    await assert.rejects(generateImage(custom('novelai'), { positive: 'portrait', references: [ref()] }, { fetchImpl: () => { calls++ } }), /不支持参考图/)
    assert.equal(calls, 0)
  })
  await t.test('OpenAI text-only generation', async () => {
    let calls = 0
    await generateImage(custom('openai'), { positive: 'lake' }, { fetchImpl: async (url, init) => {
      calls++
      assert.equal(url, 'https://relay.example.test/api/v1/images/generations')
      assert.deepEqual(JSON.parse(init.body).prompt, 'lake')
      assert.equal(init.headers.authorization, 'Bearer user-secret-key')
      return output()
    } })
    assert.equal(calls, 1)
  })
})

test('custom provider errors redact entered keys and endpoint URLs', async () => {
  await assert.rejects(generateImage(custom(), { positive: 'lake' }, { fetchImpl: async () => json({ message: 'user-secret-key https://relay.example.test/private/path' }, 401) }), error => {
    assert.doesNotMatch(error.message, /user-secret-key|relay\.example\.test|private\/path/)
    assert.match(error.message, /redacted/)
    return true
  })
})
