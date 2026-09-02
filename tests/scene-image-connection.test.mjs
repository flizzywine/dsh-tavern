import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createSceneImageConnection } from '../tavern-plugin/lib/domain/scene-image-connection.js'
import { sceneImageChannel, SCENE_IMAGE_CHANNELS } from '../tavern-plugin/lib/domain/scene-image-channels.js'

function fixture(overrides = {}) {
  const calls = [], reads = []
  const service = createSceneImageConnection({
    settings: async provider => ({ ...sceneImageChannel(provider), hasKey: true }),
    credentials: () => ({ resolve: async ref => { reads.push(ref); return { value: 'stored-secret' } }, set: () => assert.fail('probe must not save a key') }),
    fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 200 }) },
    ...overrides
  })
  return { service, calls, reads }
}

test('every channel check only sends read-only requests without body, redirects or generation', async () => {
  for (const channel of SCENE_IMAGE_CHANNELS) {
    const fx = fixture()
    const result = await fx.service.test({ provider: channel.id, baseURL: 'https://example.test/api', apiKey: 'draft-secret' })
    assert.equal(result.apiKeyStatus === 'verified', false)
    assert.equal(fx.calls.length, 1)
    assert.equal(fx.calls[0].url, 'https://example.test/api/' + (channel.canListModels ? 'models' : ''))
    assert.equal(fx.calls[0].init.method, channel.canListModels ? 'GET' : 'HEAD')
    assert.equal(fx.calls[0].init.body, undefined)
    assert.equal(fx.calls[0].init.redirect, 'manual')
    assert.equal(fx.reads.length, 0, 'supplied key does not read stored credentials')
  }
})

test('NovelAI selector exposes all locally supported versions without network discovery', () => {
  const channel = SCENE_IMAGE_CHANNELS.find(item => item.id === 'novelai')
  assert.equal(channel.canListModels, false)
  assert.ok(channel.models.includes('nai-diffusion-5-full'))
  assert.ok(channel.models.includes('nai-diffusion-4-5-curated'))
  assert.ok(channel.models.includes('nai-diffusion-3'))
})

test('only unchanged endpoint may use the saved key; edited address needs an explicit key', async () => {
  const fx = fixture()
  await fx.service.test({ provider: 'openai', apiKey: '' })
  assert.equal(fx.calls[0].init.headers.authorization, 'Bearer stored-secret')
  await assert.rejects(fx.service.test({ provider: 'openai', baseURL: 'https://other.example/v1' }), /旧密钥不会发送/)
  assert.equal(fx.calls.length, 1)
  await fx.service.test({ provider: 'openai', baseURL: 'https://other.example/v1', apiKey: 'replacement' })
  assert.equal(fx.calls[1].init.headers.authorization, 'Bearer replacement')
})

test('auth, reachable errors, and redirects never claim generation works', async () => {
  for (const status of [401, 403, 404, 405, 429, 500, 302]) {
    const fx = fixture({ fetchImpl: async () => new Response(null, { status }) })
    const result = await fx.service.test({ provider: 'novelai' })
    assert.equal(result.httpStatus, status)
    assert.equal(result.status, [401, 403].includes(status) ? 'auth_failed' : 'reachable')
  }
})

test('Grok verification endpoint 404 must not claim the Key is valid', async () => {
  const fx = fixture({ fetchImpl: async () => new Response(null, { status: 404 }) })
  const result = await fx.service.test({ provider: 'grok' })
  assert.match(result.message, /无法完成 Key 验证/)
  assert.equal(result.apiKeyStatus, 'unverified')
  assert.equal(result.probePath, '/api-key')
  assert.equal(result.httpStatus, 404)
  assert.equal(result.status, 'reachable')
})

test('network failures and timeout are bounded and never echo secret transport errors', async () => {
  const broken = fixture({ fetchImpl: async () => { throw new Error('leaked stored-secret') } })
  const failed = await broken.service.test({ provider: 'openai' })
  assert.equal(failed.status, 'failed')
  assert.ok(!JSON.stringify(failed).includes('stored-secret'))
  const slow = fixture({ timeoutMs: 5, fetchImpl: async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('abort')))) })
  assert.match((await slow.service.test({ provider: 'openai' })).message, /超时/)
})

test('invalid addresses and credential header injection fail before network access', async () => {
  const fx = fixture()
  for (const baseURL of ['bad', 'file:///etc', 'https://user:key@example.test', 'https://example.test?key=secret', 'https://example.test/#secret']) {
    await assert.rejects(fx.service.test({ provider: 'openai', baseURL, apiKey: 'draft' }))
  }
  await assert.rejects(fx.service.test({ provider: 'openai', apiKey: 'a\nb' }), /格式/)
  assert.equal(fx.calls.length, 0)
})

test('Gemini and local server authentication use the correct header and never query strings', async () => {
  const fx = fixture()
  await fx.service.test({ provider: 'gemini', apiKey: 'gemini-key' })
  assert.equal(fx.calls[0].init.headers['x-goog-api-key'], 'gemini-key')
  assert.equal(fx.calls[0].init.headers.authorization, undefined)
  await fx.service.test({ provider: 'comfyui', baseURL: 'http://localhost:8188', authType: 'basic', username: 'alice', apiKey: 'pw' })
  assert.equal(fx.calls[1].init.headers.authorization, 'Basic ' + Buffer.from('alice:pw').toString('base64'))
  await fx.service.test({ provider: 'webui', baseURL: 'http://localhost:7860', authType: 'none' })
  assert.equal(fx.calls[2].init.headers.authorization, undefined)
})

test('model discovery is a separate read-only action with deduplication and manual fallback', async () => {
  const calls = []
  const fx = fixture({ fetchImpl: async (url, init) => {
    calls.push({ url, init })
    return Response.json({ data: [{ id: 'picture-a' }, { id: 'picture-a' }, { id: 'text-b' }, { id: 123 }] })
  } })
  const result = await fx.service.models({ provider: 'openai' })
  assert.deepEqual(result.models, ['picture-a', 'text-b'])
  assert.match(result.message, /不保证/)
  assert.equal(calls[0].url, 'https://api.openai.com/v1/models')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.body, undefined)
  assert.deepEqual((await fx.service.models({ provider: 'novelai' })).models, [])
  assert.equal(calls.length, 1, 'unsupported list must not guess an endpoint')
})

test('Gemini model discovery strips models/ and malformed or oversized lists fall back safely', async () => {
  const fx = fixture({ fetchImpl: async () => Response.json({ models: [{ name: 'models/image-a' }] }) })
  assert.deepEqual((await fx.service.models({ provider: 'gemini' })).models, ['image-a'])
  for (const response of [new Response('<html>secret</html>'), new Response('x'.repeat(300000)), Response.json({ bad: [] }), new Response('stored-secret', { status: 401 })]) {
    const broken = fixture({ fetchImpl: async () => response })
    const result = await broken.service.models({ provider: 'openai' })
    assert.deepEqual(result.models, [])
    assert.ok(!JSON.stringify(result).includes('stored-secret'))
  }
})

test('real HTTP check sends exactly one GET and does not follow redirect to another server', async t => {
  const requests = []
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url })
    res.writeHead(302, { Location: '/images/generations' }); res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const fx = fixture({ fetchImpl: fetch })
  const result = await fx.service.test({ provider: 'openai', baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'test-key' })
  assert.equal(result.status, 'reachable')
  assert.deepEqual(requests, [{ method: 'GET', url: '/v1/models' }])
})

test('Grok official Key validation uses the read-only Key endpoint and returns no account metadata', async () => {
  const calls = []
  const fx = fixture({ fetchImpl: async (url, init) => {
    calls.push({ url, init })
    return Response.json({ api_key_disabled: false, api_key_blocked: false, team_blocked: false, name: 'private-name', team_id: 'private-team', redacted_api_key: 'secret-fragment' })
  } })
  const result = await fx.service.test({ provider: 'grok' })
  assert.equal(result.apiKeyStatus, 'verified')
  assert.match(result.message, /API Key 验证通过/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.x.ai/v1/api-key')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.headers.authorization, 'Bearer stored-secret')
  assert.equal(calls[0].init.body, undefined)
  assert.doesNotMatch(JSON.stringify(result), /private|secret-fragment/)
})

test('Grok disabled/blocked flags and authentication refusals never pass validation', async () => {
  for (const flag of ['api_key_disabled', 'api_key_blocked', 'team_blocked']) {
    const fx = fixture({ fetchImpl: async () => Response.json({ api_key_disabled: false, api_key_blocked: false, team_blocked: false, [flag]: true }) })
    assert.equal((await fx.service.test({ provider: 'grok' })).apiKeyStatus, 'rejected')
  }
  for (const status of [400, 401, 403]) {
    const fx = fixture({ fetchImpl: async () => new Response('stored-secret', { status }) })
    const result = await fx.service.test({ provider: 'grok' })
    assert.equal(result.apiKeyStatus, 'rejected')
    assert.doesNotMatch(JSON.stringify(result), /stored-secret/)
  }
  for (const payload of [{}, { api_key_disabled: false }, { api_key_disabled: 'false', api_key_blocked: false, team_blocked: false }]) {
    const fx = fixture({ fetchImpl: async () => Response.json(payload) })
    assert.equal((await fx.service.test({ provider: 'grok' })).apiKeyStatus, 'unverified')
  }
})

test('official OpenAI and Gemini validate through their authenticated model catalogs', async () => {
  for (const provider of ['openai', 'gemini']) {
    const calls = []
    const fx = fixture({ fetchImpl: async (url, init) => { calls.push({ url, init }); return Response.json(provider === 'gemini' ? { models: [] } : { data: [] }) } })
    const result = await fx.service.test({ provider })
    assert.equal(result.apiKeyStatus, 'verified')
    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/models'))
  }
})

test('custom gateways only validate when anonymous access is explicitly refused', async () => {
  for (const anonymousStatus of [200, 401, 403, 404, 429, 500]) {
    const calls = []
    const fx = fixture({ fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return init.headers.authorization ? Response.json({ data: [{ id: 'image-model' }] }) : new Response(null, { status: anonymousStatus })
    } })
    const result = await fx.service.test({ provider: 'grok', baseURL: 'https://gateway.example/v1', apiKey: 'draft-key' })
    assert.equal(result.apiKeyStatus, [401, 403].includes(anonymousStatus) ? 'verified' : 'unverified')
    assert.deepEqual(calls.map(call => call.url), ['https://gateway.example/v1/models', 'https://gateway.example/v1/models'])
    assert.deepEqual(calls.map(call => call.init.method), ['GET', 'GET'])
    assert.equal(calls[1].init.headers.authorization, undefined)
  }
})

test('missing keys, unsupported providers and public local servers never report Key verification', async () => {
  const fx = fixture({ credentials: () => ({ resolve: async () => undefined }), settings: async provider => ({ ...sceneImageChannel(provider), hasKey: false }) })
  assert.equal((await fx.service.test({ provider: 'grok' })).apiKeyStatus, 'missing')
  assert.equal(fx.calls[0].init.method, 'HEAD')
  assert.equal((await fx.service.test({ provider: 'novelai', apiKey: 'draft-key' })).apiKeyStatus, 'unsupported')
  assert.equal((await fx.service.test({ provider: 'novelai', apiKey: 'draft-key' })).status, 'reachable', 'unsupported auth must not appear as a successful validation')
  assert.equal((await fx.service.test({ provider: 'comfyui', baseURL: 'http://localhost:8188' })).apiKeyStatus, 'not_required')
})

test('invalid JSON, HTML and API error envelopes cannot masquerade as successful auth', async () => {
  for (const response of [new Response('<html>OK</html>'), Response.json({ error: { message: 'stored-secret' } }), Response.json({ data: [null] })]) {
    const fx = fixture({ fetchImpl: async () => response })
    const result = await fx.service.test({ provider: 'openai' })
    assert.equal(result.apiKeyStatus, 'unverified')
    assert.doesNotMatch(JSON.stringify(result), /stored-secret/)
  }
})
