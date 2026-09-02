import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createSceneImagePlugin } from './fixtures/upstream-image-plugin.mjs'

const profile = { provider: 'openai', model: 'test-image', configured: true, defaultRatio: '1:1', defaultQuality: 'standard', ratioOptions: [{ value: '1:1' }], qualityOptions: [{ value: 'standard' }] }
const config = { activeProvider: 'openai', providers: [profile] }
const ref = { attachmentId: 'saved-by-plugin', mediaType: 'image/png' }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=', 'base64')

test('real loopback Studio contract: read configuration, generate once, reuse plugin attachment without credentials', async t => {
  const calls = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined
    calls.push({ method: req.method, url: req.url, headers: req.headers, body })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body ? { provider: 'openai', model: 'test-image', attachment: ref } : config))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const plugin = createSceneImagePlugin({ webServer: () => ({ port: server.address().port }), attachments: () => ({ readImage: async value => { assert.deepEqual(value, ref); return { data: png, mediaType: 'image/png' } } }) })
  const active = await plugin.resolve({ provider: 'dsh-image-gen' })
  assert.equal(active.pluginReady, true)
  assert.equal(calls.length, 1)
  const image = await plugin.generate({ ...active, prompt: 'A quiet garden', apiKey: 'never-forward' })
  assert.deepEqual(image.data, png)
  assert.deepEqual(image.attachment, ref)
  assert.deepEqual(calls.map(call => call.method), ['GET', 'GET', 'POST'])
  assert.ok(calls.every(call => call.url === '/plugins/dsh-image-gen/studio' && !call.headers.authorization))
  assert.deepEqual(calls[2].body, { mode: 'generate', provider: 'openai', model: 'test-image', prompt: 'A quiet garden', ratio: '1:1', quality: 'standard' })
})

test('missing plugin, invalid responses and missing Key fail closed without a generation request', async () => {
  for (const reply of [() => new Response(null, { status: 404 }), () => new Response('<html>'), () => Response.json({}), () => Response.json({ ...config, providers: [{ ...profile, configured: false }] })]) {
    const methods = []
    const plugin = createSceneImagePlugin({ webServer: () => ({ port: 3081 }), fetchImpl: async (_url, init) => { methods.push(init.method); return reply() } })
    const active = await plugin.resolve({ provider: 'dsh-image-gen' })
    assert.equal(active.pluginReady, false)
    await assert.rejects(plugin.generate({ ...active, prompt: 'garden' }))
    assert.ok(methods.every(method => method === 'GET'))
  }
})

test('changed model, long prompts and reference images never submit or silently truncate', async () => {
  const methods = []
  const plugin = createSceneImagePlugin({ webServer: () => ({ port: 3081 }), fetchImpl: async (_url, init) => { methods.push(init.method); return Response.json(config) } })
  const active = await plugin.resolve({ provider: 'dsh-image-gen' })
  await assert.rejects(plugin.generate({ ...active, model: 'old-model', prompt: 'garden' }), /配置已变化/)
  await assert.rejects(plugin.generate({ ...active, prompt: 'x'.repeat(2001) }), /2000/)
  await assert.rejects(plugin.generate({ ...active, prompt: 'garden', referenceImages: [{}] }), /参考图/)
  assert.ok(methods.every(method => method === 'GET'))
})

test('no arbitrary endpoints or credentials; malformed port never makes a request', async () => {
  const plugin = createSceneImagePlugin({ webServer: () => ({ port: 'https://evil.example' }), fetchImpl: async () => assert.fail('network not allowed') })
  const normal = { provider: 'openai', model: 'unchanged' }
  assert.equal(await plugin.resolve(normal), normal)
  assert.equal((await plugin.resolve({ provider: 'dsh-image-gen', baseURL: 'https://evil.example' })).pluginReady, false)
})

test('installed plugin owns new provider capabilities, including Grok, without a Tavern adapter', async () => {
  for (const provider of ['grok', 'another-image-provider']) {
    const calls = []
    const plugin = createSceneImagePlugin({ webServer: () => ({ port: 3081 }),
      attachments: () => ({ readImage: async () => ({ data: png, mediaType: 'image/png' }) }),
      fetchImpl: async (_url, init) => {
        calls.push(init)
        return Response.json(init.method === 'POST' ? { provider, model: 'plugin-model', attachment: ref }
          : { activeProvider: provider, providers: [{ ...profile, provider, model: 'plugin-model' }] })
      } })
    const active = await plugin.resolve({ provider: 'dsh-image-gen' })
    assert.equal(active.pluginReady, true)
    assert.equal((await plugin.generate({ ...active, prompt: 'A mountain lake' })).metadata.provider, provider)
    assert.equal(JSON.parse(calls.at(-1).body).provider, provider)
  }
})
