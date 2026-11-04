import test from 'node:test'
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { imagePluginFixture, IMAGE_PNG, imageJson } from './fixtures/image-plugin-runtime.mjs'

const character = {
  id: 'lin', name: '林月', match: 'Lin Yue', traits: { face: 'red hair, violet eyes' },
  outfits: [{ id: 'shirt', name: '白衬衫', upper: 'white shirt' }],
}
const scene = '林月穿着白色衬衫，站在窗边。'

async function withFetch(t, fetchImpl) {
  const original = globalThis.fetch
  globalThis.fetch = fetchImpl
  t.after(() => { globalThis.fetch = original })
}

async function saveReferenceDefinitions(runtime) {
  const upload = async name => {
    const result = await runtime.request('reference-image', {
      data: IMAGE_PNG.toString('base64'), mediaType: 'image/png', name,
    })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    return result.body.referenceImage
  }
  const characterImage = await upload('林月.png')
  const outfitImage = await upload('白衬衫.png')
  const definitions = {
    characters: [{ ...structuredClone(character), referenceImage: characterImage, consistencyText: '保留眼角的小痣',
      outfits: [{ id: 'shirt', name: '白衬衫', upper: 'white shirt', referenceImage: outfitImage, consistencyText: '按服装图的刺绣还原' }] }],
    outfits: [], settings: [], props: [],
  }
  assert.equal((await runtime.request('definitions', { definitions })).status, 200)
  return { characterImage, outfitImage, definitions }
}

function atlasFetch(calls) {
  return async (url, init = {}) => {
    const parsed = new URL(url)
    calls.push({ path: parsed.pathname, method: init.method ?? 'GET', init })
    if (parsed.pathname.endsWith('/uploadMedia')) return imageJson({ data: { download_url: 'https://images.example.test/reference.png' } })
    if (parsed.pathname.endsWith('/generateImage')) return imageJson({ data: { id: 'text-job', status: 'completed', outputs: ['https://images.example.test/result.png'] } })
    if (String(url) === 'https://images.example.test/result.png') return new Response(IMAGE_PNG, { headers: { 'content-type': 'image/png' } })
    return imageJson({ data: { id: 'text-job', status: 'completed', outputs: ['https://images.example.test/result.png'] } })
  }
}

test('saved character and outfit references are optional for default and explicit text jobs', { timeout: 20000 }, async t => {
  const fixture = await imagePluginFixture(t, { config: { generationMode: 'text' } })
  const runtime = await fixture.start()
  const { characterImage, outfitImage } = await saveReferenceDefinitions(runtime)
  // If a text job tries to load either saved reference, the real store read fails.
  await Promise.all([characterImage, outfitImage].map(image => rm(join(fixture.pluginRoot, 'reference-images', image.id))))
  const calls = []
  await withFetch(t, atlasFetch(calls))

  for (const [name, mode] of [['global text default', undefined], ['explicit text', 'text']]) await t.test(name, async () => {
    const result = await runtime.request('jobs', { tag: scene, ...(mode ? { generationMode: mode } : {}) })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    const job = await runtime.terminal(result.body.id)
    assert.equal(job.state, 'done', job.error)
    assert.equal(job.generationMode, 'text')
    assert.match(job.submittedPrompt, /白色衬衫/)
    assert.equal(job.referenceSnapshot, undefined)
  })

  assert.equal(calls.filter(call => call.path.endsWith('/uploadMedia')).length, 0)
  const generate = calls.filter(call => call.path.endsWith('/generateImage'))
  assert.equal(generate.length, 2)
  for (const call of generate) {
    const body = JSON.parse(call.init.body)
    assert.match(body.prompt, /白色衬衫/)
    assert.equal('images' in body, false)
    assert.equal(JSON.stringify(body).includes(characterImage.id), false)
    assert.equal(JSON.stringify(body).includes(outfitImage.id), false)
  }
})

function textWorkflow() {
  return {
    format: 'dsh-tavern-comfy-v1', name: 'text-only workflow', outputNode: '10',
    prompt: {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'placeholder positive' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'placeholder negative' } },
      '3': { class_type: 'EmptyLatentImage', inputs: { width: 64, height: 64, batch_size: 2 } },
      '4': { class_type: 'KSampler', inputs: { seed: 1, steps: 2, cfg: 2 } },
      '10': { class_type: 'SaveImage', inputs: { images: ['4', 0] } },
    },
    bindings: { positive: [{ node: '1', input: 'text' }], negative: [{ node: '2', input: 'text' }] },
  }
}

test('ComfyUI text generation submits a no-LoadImage workflow unchanged when references exist', { timeout: 20000 }, async t => {
  const fixture = await imagePluginFixture(t, {
    config: {
      imageBackend: 'comfyui', generationMode: 'reference', promptMode: 'structured', comfyMode: 'workflow',
      comfyUrl: 'http://127.0.0.1:8188', defaultWorkflow: 'text',
      workflows: [{ id: 'text', file: 'workflows/text.json', label: 'text-only workflow' }],
    },
    files: { 'workflows/text.json': textWorkflow() },
  })
  const runtime = await fixture.start()
  await saveReferenceDefinitions(runtime)
  const calls = []
  await withFetch(t, async (url, init = {}) => {
    const parsed = new URL(url)
    calls.push({ path: parsed.pathname, init })
    if (parsed.pathname === '/prompt') return imageJson({ prompt_id: 'text-prompt', number: 1 })
    return imageJson({ queue_running: [], queue_pending: [] })
  })

  const result = await runtime.request('jobs', { tag: scene, generationMode: 'text' })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  const promptCall = calls.find(call => call.path === '/prompt')
  assert.ok(promptCall)
  const submitted = JSON.parse(promptCall.init.body).prompt
  assert.equal(submitted['10'].class_type, 'SaveImage')
  assert.match(submitted['1'].inputs.text, /白色衬衫/)
  assert.equal(submitted['3'].inputs.batch_size, 1)
  assert.equal(calls.some(call => call.path === '/upload/image'), false)
  assert.equal(calls.some(call => call.path === '/history/text-prompt'), false)
})

test('unsupported NovelAI reference capability does not block text jobs under a reference default', { timeout: 20000 }, async t => {
  const fixture = await imagePluginFixture(t, {
    config: {
      generationMode: 'reference', imageBackend: 'custom', activeImageChannel: 'nai-chat',
      imageChannels: [{ id: 'nai-chat', provider: 'custom', name: 'NovelAI compatible', baseUrl: 'https://nai.example.test/api/v1', model: 'nai-diffusion-5-full', apiKey: 'test-key', options: { apiProtocol: 'novelai', protocol: 'chat' } }],
    },
  })
  const runtime = await fixture.start()
  const { characterImage, outfitImage } = await saveReferenceDefinitions(runtime)
  await Promise.all([characterImage, outfitImage].map(image => rm(join(fixture.pluginRoot, 'reference-images', image.id))))
  const calls = []
  await withFetch(t, async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/chat/completions')) {
      return imageJson({ choices: [{ message: { content: `![image](data:image/png;base64,${IMAGE_PNG.toString('base64')})` } }] })
    }
    assert.fail('text generation should not upload or fetch a reference image')
  })

  const result = await runtime.request('jobs', { tag: scene, generationMode: 'text' })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  const job = await runtime.terminal(result.body.id)
  assert.equal(job.state, 'done', job.error)
  assert.equal(job.generationMode, 'text')
  assert.equal(calls.length, 1)
  assert.match(JSON.parse(calls[0].init.body).messages[0].content, /白色衬衫/)
  assert.equal(JSON.stringify(JSON.parse(calls[0].init.body)).includes(characterImage.id), false)
  assert.equal(JSON.stringify(JSON.parse(calls[0].init.body)).includes(outfitImage.id), false)
})

test('reference mode requires a valid attached image selection and never silently falls back to text', { timeout: 20000 }, async t => {
  const missingFixture = await imagePluginFixture(t, { config: { generationMode: 'reference' } })
  const missingRuntime = await missingFixture.start()
  const missingCalls = []
  await withFetch(t, atlasFetch(missingCalls))
  const noImage = await missingRuntime.request('jobs', { tag: '一片森林', generationMode: 'reference' })
  assert.equal(noImage.status, 400)
  assert.match(noImage.body.error, /没有可用.*参考图/)
  assert.equal(missingCalls.length, 0)

  const fixture = await imagePluginFixture(t, { config: { generationMode: 'reference' } })
  const runtime = await fixture.start()
  await saveReferenceDefinitions(runtime)
  const calls = []
  await withFetch(t, atlasFetch(calls))
  const invalidSelection = await runtime.request('jobs', {
    tag: scene, generationMode: 'reference', subjects: [{ characterId: 'missing-character' }],
  })
  assert.equal(invalidSelection.status, 400)
  assert.match(invalidSelection.body.error, /找不到可用的参考图对象/)
  assert.equal(calls.length, 0)

  const valid = await runtime.request('jobs', {
    tag: scene, generationMode: 'reference', subjects: [{ characterId: 'lin', outfitId: 'shirt' }],
  })
  assert.equal(valid.status, 200, JSON.stringify(valid.body))
  const job = await runtime.terminal(valid.body.id)
  assert.equal(job.state, 'done', job.error)
  assert.equal(job.generationMode, 'reference')
  assert.equal(job.references.length, 2)
  assert.equal(calls.filter(call => call.path.endsWith('/uploadMedia')).length, 2)
  assert.equal(calls.filter(call => call.path.endsWith('/generateImage')).length, 1)
  const submitted = JSON.parse(calls.find(call => call.path.endsWith('/generateImage')).init.body)
  assert.equal(submitted.images.length, 2)
})

test('auto mode uses references when the picture has them and draws the rest as text', { timeout: 20000 }, async t => {
  const fixture = await imagePluginFixture(t, { config: { generationMode: 'auto', promptMode: 'structured' } })
  const runtime = await fixture.start()
  const { characterImage } = await saveReferenceDefinitions(runtime)
  const calls = []
  await withFetch(t, atlasFetch(calls))

  const background = await runtime.request('jobs', { tag: '一片森林，晨雾中的小路。' })
  assert.equal(background.status, 200, JSON.stringify(background.body))
  const textJob = await runtime.terminal(background.body.id)
  assert.equal(textJob.state, 'done', textJob.error)
  assert.equal(textJob.generationMode, 'text')
  assert.equal(textJob.requestedGenerationMode, 'auto')
  assert.equal(textJob.generationModeReason, 'no-references')
  assert.deepEqual(textJob.references, [])
  assert.equal(calls.filter(call => call.path.endsWith('/uploadMedia')).length, 0)
  const textBody = JSON.parse(calls.find(call => call.path.endsWith('/generateImage')).init.body)
  assert.equal('images' in textBody, false)
  assert.match(textBody.prompt, /一片森林/)
  const textInputs = await runtime.request('job-detail?id=' + background.body.id)
  assert.deepEqual([textInputs.body.job.promptAssembly.generationMode, textInputs.body.job.promptAssembly.requestedGenerationMode], ['text', 'auto'])
  assert.equal(textInputs.body.job.promptAssembly.referenceText, '')

  const portrait = await runtime.request('jobs', { tag: scene, subjects: [{ characterId: 'lin', outfitId: 'shirt' }] })
  assert.equal(portrait.status, 200, JSON.stringify(portrait.body))
  const referenceJob = await runtime.terminal(portrait.body.id)
  assert.equal(referenceJob.state, 'done', referenceJob.error)
  assert.equal(referenceJob.generationMode, 'reference')
  assert.equal(referenceJob.requestedGenerationMode, 'auto')
  assert.equal(referenceJob.generationModeReason, 'references')
  assert.equal(referenceJob.references.length, 2)
  assert.equal(calls.filter(call => call.path.endsWith('/uploadMedia')).length, 2)
  const referenceBody = JSON.parse(calls.filter(call => call.path.endsWith('/generateImage')).at(-1).init.body)
  assert.equal(referenceBody.images.length, 2)
  assert.equal((await runtime.request('job-detail?id=' + portrait.body.id)).body.job.promptAssembly.generationMode, 'reference')

  // The persisted record keeps the effective mode, so a redraw repeats what was actually drawn.
  const saved = await fixture.read('jobs-store.json')
  assert.deepEqual([saved[background.body.id].generationMode, saved[background.body.id].requestedGenerationMode], ['text', 'auto'])
  const redraw = await runtime.request('redraw', { jobId: background.body.id })
  assert.equal(redraw.status, 200, JSON.stringify(redraw.body))
  assert.equal((await runtime.terminal(redraw.body.jobId)).generationMode, 'text')
  assert.equal(JSON.stringify(calls.map(call => call.init.body ?? '')).includes(characterImage.id), false)

  runtime.close()
  const restarted = await fixture.start({ generationMode: 'text' })
  const restored = (await restarted.request('job-detail?id=' + portrait.body.id)).body.job
  assert.deepEqual([restored.generationMode, restored.requestedGenerationMode, restored.generationModeReason], ['reference', 'auto', 'references'])
  const repeat = await restarted.request('redraw', { jobId: portrait.body.id })
  const repeated = await restarted.terminal(repeat.body.jobId)
  assert.deepEqual([repeated.generationMode, repeated.requestedGenerationMode], ['reference', 'reference'])
  assert.deepEqual(repeated.references, restored.references)
})

test('auto mode on a channel without reference input submits text jobs', { timeout: 20000 }, async t => {
  const fixture = await imagePluginFixture(t, {
    config: {
      generationMode: 'auto', imageBackend: 'custom', activeImageChannel: 'nai-chat',
      imageChannels: [{ id: 'nai-chat', provider: 'custom', name: 'NovelAI compatible', baseUrl: 'https://nai.example.test/api/v1', model: 'nai-diffusion-5-full', apiKey: 'test-key', options: { apiProtocol: 'novelai', protocol: 'chat' } }],
    },
  })
  const runtime = await fixture.start()
  await saveReferenceDefinitions(runtime)
  const calls = []
  await withFetch(t, async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/chat/completions')) return imageJson({ choices: [{ message: { content: `![image](data:image/png;base64,${IMAGE_PNG.toString('base64')})` } }] })
    assert.fail('auto mode must not upload references to a channel without reference input')
  })
  const result = await runtime.request('jobs', { tag: scene, subjects: [{ characterId: 'lin', outfitId: 'shirt' }] })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  const job = await runtime.terminal(result.body.id)
  assert.equal(job.state, 'done', job.error)
  assert.equal(job.generationMode, 'text')
  assert.equal(job.requestedGenerationMode, 'auto')
  assert.equal(job.generationModeReason, 'unsupported-input')
  assert.equal(calls.length, 1)
})

test('auto text fallback expands library macros and preserves explicit per-job mode overrides', async t => {
  const fixture = await imagePluginFixture(t, { config: { generationMode: 'auto', promptMode: 'structured' },
    definitions: { characters: [structuredClone(character)], outfits: [], settings: [], props: [] } })
  const runtime = await fixture.start()
  const calls = []
  await withFetch(t, atlasFetch(calls))
  const result = await runtime.request('jobs', { tag: '林月在窗边。', characters: [{ prompt: '${"name":"林月"}$', centers: '0.5,0.5' }] })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  const job = await runtime.terminal(result.body.id)
  assert.equal(job.generationMode, 'text')
  assert.match(job.submittedPrompt, /red hair/)
  assert.match(job.submittedPrompt, /violet eyes/)
  assert.doesNotMatch(job.submittedPrompt, /\$\{/)

  await saveReferenceDefinitions(runtime)
  const text = await runtime.request('jobs', { tag: scene, generationMode: 'text' })
  assert.equal((await runtime.terminal(text.body.id)).generationMode, 'text')
  const count = calls.length
  const strict = await runtime.request('jobs', { tag: '没有人物的森林', generationMode: 'reference' })
  assert.equal(strict.status, 400)
  assert.match(strict.body.error, /没有可用.*参考图/)
  assert.equal(calls.length, count)
  assert.equal(calls.filter(call => call.path.endsWith('/uploadMedia')).length, 0)
})

test('auto mode never treats invalid subjects, missing files or failed uploads as text fallback', async t => {
  for (const failure of ['invalid-subject', 'missing-file', 'upload-failure']) await t.test(failure, async t => {
    const fixture = await imagePluginFixture(t, { config: { generationMode: 'auto' } })
    const runtime = await fixture.start()
    const { characterImage } = await saveReferenceDefinitions(runtime)
    if (failure === 'missing-file') await rm(join(fixture.pluginRoot, 'reference-images', characterImage.id))
    const calls = []
    const normalFetch = atlasFetch(calls)
    await withFetch(t, async (url, init) => {
      if (failure === 'upload-failure' && String(url).endsWith('/uploadMedia')) {
        calls.push({ path: '/uploadMedia' })
        throw new Error('reference upload interrupted')
      }
      return normalFetch(url, init)
    })
    const result = await runtime.request('jobs', { tag: scene, subjects: [{ characterId: failure === 'invalid-subject' ? 'missing' : 'lin', outfitId: '' }] })
    if (failure === 'invalid-subject') {
      assert.equal(result.status, 400)
      assert.match(result.body.error, /找不到可用的参考图对象/)
    } else {
      assert.equal(result.status, 200, JSON.stringify(result.body))
      const job = await runtime.terminal(result.body.id)
      assert.equal(job.state, 'failed', job.error)
      assert.equal(job.generationMode, 'reference')
      assert.equal(job.requestMayHaveSucceeded, false)
    }
    assert.equal(calls.some(call => call.path.endsWith('/generateImage')), false, 'no paid text retry')
    assert.equal(calls.length, failure === 'upload-failure' ? 1 : 0)
  })
})

test('auto mode uses the existing reference path for every built-in and custom online protocol', { timeout: 30000 }, async t => {
  const protocols = ['novelai', 'openai', 'gemini', 'gemini-chat', 'grok', 'seedream', 'qwen', 'atlascloud', 'sdwebui']
  const channels = protocols.flatMap(protocol => [
    ...(protocol === 'atlascloud' ? [] : [{ id: protocol, provider: protocol }]),
    { id: 'custom-' + protocol, provider: 'custom' },
  ].map(item => ({ ...item, name: item.id, model: 'user-model', apiKey: 'test', baseUrl: 'https://images.test/' + item.id,
    options: { apiProtocol: protocol, pollIntervalMs: 1, sizeMode: 'none' } })))
  const fixture = await imagePluginFixture(t, { config: { generationMode: 'auto', imageBackend: 'openai', activeImageChannel: 'openai', imageChannels: channels } })
  const runtime = await fixture.start()
  await saveReferenceDefinitions(runtime)
  const calls = [], b64 = IMAGE_PNG.toString('base64'), dataUrl = 'data:image/png;base64,' + b64
  await withFetch(t, async (url, init = {}) => {
    const parsed = new URL(url), protocol = parsed.pathname.split('/')[1].replace('custom-', '')
    calls.push({ path: parsed.pathname, method: init.method || 'GET' })
    if (parsed.pathname.endsWith('/uploadMedia')) return imageJson({ data: { download_url: 'https://images.test/reference.png' } })
    if (protocol === 'novelai') return new Response(IMAGE_PNG, { headers: { 'content-type': 'image/png' } })
    if (protocol === 'gemini') return imageJson({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64 } }] } }] })
    if (protocol === 'gemini-chat') return imageJson({ choices: [{ message: { content: dataUrl } }] })
    if (protocol === 'sdwebui') return imageJson({ images: [b64] })
    if (protocol === 'qwen') return imageJson({ output: { choices: [{ message: { content: [{ image: dataUrl }] } }] } })
    if (protocol === 'atlascloud') return imageJson({ data: { id: 'auto-task', status: 'completed', outputs: [dataUrl] } })
    return imageJson({ data: [{ b64_json: b64 }] })
  })
  for (const channel of channels) await t.test(channel.id, async () => {
    assert.equal((await runtime.request('config', { imageBackend: channel.provider, activeImageChannel: channel.id })).status, 200)
    for (const hasSubject of [false, true]) {
      const result = await runtime.request('jobs', { tag: hasSubject ? scene : '没有人物的森林', subjects: hasSubject ? [{ characterId: 'lin', outfitId: '' }] : [] })
      assert.equal(result.status, 200, JSON.stringify(result.body))
      const job = await runtime.terminal(result.body.id)
      assert.equal(job.state, 'done', job.error)
      const expectedReference = hasSubject && channel.options.apiProtocol !== 'novelai'
      assert.deepEqual([job.generationMode, job.requestedGenerationMode, job.references.length], [expectedReference ? 'reference' : 'text', 'auto', expectedReference ? 1 : 0])
    }
  })
  const paid = calls.filter(call => call.method === 'POST' && !call.path.endsWith('/uploadMedia'))
  assert.equal(paid.length, channels.length * 2, 'exactly one generation POST per picture')
})
