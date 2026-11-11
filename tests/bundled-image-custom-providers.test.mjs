import test from 'node:test'
import assert from 'node:assert/strict'
import { generateImage } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-providers.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex')
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const output = () => json({ data: [{ b64_json: PNG.toString('base64') }] })
const ref = (data = PNG) => ({ data, mediaType: 'image/png' })
const custom = (apiProtocol = 'openai', options = {}) => ({
  id: 'custom-test', provider: 'custom', name: 'My relay', baseUrl: 'https://relay.example.test/api/v1',
  model: 'user-model', apiKey: 'user-secret-key', options: { apiProtocol, ...options },
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
    await generateImage(custom('seedream', { quality: 'max', moderation: 'low' }), { positive: 'edit this', quality: 'xhigh', references: [ref()] }, { fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      assert.deepEqual(body.image, [`data:image/png;base64,${PNG.toString('base64')}`])
      assert.equal(Object.hasOwn(body, 'quality'), false)
      assert.equal(Object.hasOwn(body, 'moderation'), false)
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

test('OpenAI Images sends the same quality and moderation in JSON generation and multipart edits', async t => {
  const named = { ...custom(), provider: 'openai', model: 'gpt-image-2.5-flare' }
  const cases = [
    ['unset', named, {}, {}],
    ['legacy empty', { ...named, options: { quality: '', moderation: '' } }, {}, {}],
    ...['auto', 'low', 'medium', 'high', 'xhigh', 'max'].map((quality, index) => {
      const moderation = index % 2 ? 'low' : 'auto'
      const options = { quality, moderation }
      return [quality, custom('openai', options), {}, options]
    }),
    ['request override', custom('openai', { quality: 'medium' }), { quality: 'max' }, { quality: 'max' }],
    ['request override xhigh', { ...named, options: { quality: 'medium' } }, { quality: 'xhigh' }, { quality: 'xhigh' }],
    ['invalid override', custom('openai', { quality: 'auto', moderation: 'invalid' }), { quality: 'invalid' }, { quality: 'auto' }],
    ['invalid channel options', custom('openai', { quality: 'invalid', moderation: 'invalid' }), {}, {}],
  ]
  for (const [name, channel, override, expected] of cases) await t.test(name, async () => {
    for (const editing of [false, true]) {
      const references = editing ? [ref()] : []
      let calls = 0
      await generateImage(channel, { positive: 'A lake at sunrise', references, ...override }, { fetchImpl: async (url, init) => {
        calls++
        assert.ok(url.endsWith(editing ? '/images/edits' : '/images/generations'))
        assert.equal(init.body instanceof FormData, editing)
        const payload = editing ? Object.fromEntries(init.body) : JSON.parse(init.body)
        assert.equal(payload.model, channel.model)
        assert.equal(payload.quality, expected.quality)
        assert.equal(payload.moderation, expected.moderation)
        if (editing) assert.deepEqual(Buffer.from(await payload['image[]'].arrayBuffer()), PNG)
        return output()
      } })
      assert.equal(calls, 1)
    }
  })
})

test('custom provider errors redact entered keys and endpoint URLs', async () => {
  await assert.rejects(generateImage(custom(), { positive: 'lake' }, { fetchImpl: async () => json({ message: 'user-secret-key https://relay.example.test/private/path' }, 401) }), error => {
    assert.doesNotMatch(error.message, /user-secret-key|relay\.example\.test|private\/path/)
    assert.match(error.message, /redacted/)
    return true
  })
})
