import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSceneIllustrations, sceneTarget, sceneInput, IMAGE_CREDENTIAL } from '../tavern-plugin/lib/domain/scene-illustration.js'
import { generateSceneImage, imageSettings, validateImageDownload } from '../tavern-plugin/lib/domain/scene-image-provider.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=', 'base64')
const chatFixture = () => ({ id: 'test-chat', mode: 'story', sessionId: 'parent', posture: '站在窗边，左手扶窗', messages: [{ role: 'user', text: '走到窗边' }, { role: 'assistant', turn: 2, sourceText: '她站在窗边看雨。', swipes: ['她站在窗边看雨。', '她坐在椅子上。'], swipeId: 0 }] })
async function until(check) { for (let n = 0; n < 400; n++) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)) } throw new Error('condition timeout') }

test('OpenAI compatible request, inline data and remote download never forward key', async () => {
  const calls = []
  const input = { baseURL: 'https://provider.example/v1', model: 'test-image', size: '1024x1024', prompt: 'scene', apiKey: 'secret', signal: new AbortController().signal }
  const inline = await generateSceneImage(input, { fetch: async (url, init) => { calls.push({ url, init }); return Response.json({ data: [{ b64_json: png.toString('base64') }] }) } })
  assert.deepEqual(inline.data, png)
  assert.equal(calls[0].url, 'https://provider.example/v1/images/generations')
  assert.equal(JSON.parse(calls[0].init.body).n, 1)
  assert.equal(calls[0].init.redirect, 'error')
  const remote = await generateSceneImage(input, { validateDownload: async url => url, fetch: async (url, init) => {
    if (url.includes('generations')) return Response.json({ images: [{ url: 'https://images.example/image.png' }] })
    assert.equal(init.headers, undefined)
    assert.equal(init.redirect, 'error')
    return new Response(png)
  } })
  assert.equal(remote.mediaType, 'image/png')
})

test('invalid image/config, oversize and raw provider secrets are rejected', async () => {
  const input = { baseURL: 'https://provider.example/v1', apiKey: 'secret' }
  for (const value of [{ data: [] }, { data: [{ b64_json: Buffer.from('<svg/>').toString('base64') }] }]) {
    await assert.rejects(generateSceneImage(input, { fetch: async () => Response.json(value) }))
  }
  await assert.rejects(generateSceneImage({ ...input, maxBytes: 8 }, { fetch: async () => Response.json({ data: [{ b64_json: png.toString('base64') }] }) }), /大小|过大/)
  await assert.rejects(generateSceneImage(input, { fetch: async () => new Response('secret', { status: 401 }) }), error => !error.message.includes('secret') && error.message.includes('401'))
  for (const baseURL of ['file:///tmp', 'https://key:secret@host/v1', 'https://host/v1?key=secret']) assert.throws(() => imageSettings({ baseURL }))
  await assert.rejects(validateImageDownload('https://127.0.0.1/private', input.baseURL), /内网/)
})

test('target survives later rounds but not swipe, rewrite or replaced history; no state/schema input', () => {
  const chat = chatFixture(), target = sceneTarget(chat, 2)
  chat.messages[1].variables = [{ stat_data: { schema: 'not sent' } }]
  chat.messages.push({ role: 'user', text: '继续' })
  assert.equal(sceneTarget(chat, 2).key, target.key)
  assert.deepEqual(sceneInput(chat, target), { text: '她站在窗边看雨。', posture: '站在窗边，左手扶窗' })
  chat.messages[1].swipeId = 1
  assert.notEqual(sceneTarget(chat, 2).key, target.key)
  chat.messages[1].swipeId = 0
  chat.messages[0].text = '不同的故事'
  assert.notEqual(sceneTarget(chat, 2).key, target.key)
})

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tavern-images-test-'))
  const store = createProfileDataStore({ dataRoot: root })
  let chat = chatFixture(), key = 'secret', imageCalls = 0
  const saved = new Map()
  const deps = {
    store, chatForSession: async () => structuredClone(chat), selection: () => ({ provider: 'test', model: 'text' }),
    credentials: () => ({ resolve: async ref => { assert.equal(ref, IMAGE_CREDENTIAL); return { value: key } }, set: async (_ref, value) => { key = value } }),
    attachments: () => ({ saveImage: async image => { const ref = { attachmentId: 'test-image', mediaType: image.mediaType }; saved.set(ref.attachmentId, image); return ref }, readImage: async ref => ({ ref, ...saved.get(ref.attachmentId) }) }),
    generate: async () => { imageCalls++; return { data: png, mediaType: 'image/png' } },
    runAgent: async input => { await input.onToolCall({ arguments: { prompt: 'A woman standing at a rainy window' } }); return { traceSessionId: 'image-child' } },
    ...overrides
  }
  const service = createSceneIllustrations(deps)
  t.after(async () => { await service.dispose(); await rm(root, { recursive: true, force: true }) })
  await service.configure({ model: 'test-image', baseURL: 'https://provider.example/v1', size: '1024x1024', apiKey: key })
  await service.configure({ enabled: true })
  return { service, deps, store, chat: () => chat, setChat: value => { chat = value }, imageCalls: () => imageCalls }
}

test('explicit opt-in, partial saves and legacy migration never cause paid requests', async t => {
  let agentCalls = 0
  const fx = await fixture(t, { runAgent: async () => { agentCalls++ } })
  await fx.store.writeJson('scene-images/settings.json', { model: 'legacy', baseURL: 'https://provider.example/v1' })
  assert.equal((await fx.service.settings()).enabled, false)
  assert.equal((await fx.service.settings()).ready, true)
  const target = sceneTarget(fx.chat(), 2)
  await assert.rejects(fx.service.start('parent', 2, target.key), /手动启用/)
  await fx.service.configure({ model: 'new-model' })
  assert.equal((await fx.service.settings()).enabled, false)
  await fx.service.configure({ enabled: true })
  assert.equal((await fx.service.settings()).model, 'new-model')
  assert.equal((await fx.service.settings()).enabled, true)
  await Promise.all([fx.service.configure({ model: 'concurrent' }), fx.service.configure({ enabled: false })])
  assert.equal((await fx.service.settings()).model, 'concurrent')
  assert.equal((await fx.service.settings()).enabled, false)
  await assert.rejects(fx.service.configure({ enabled: 'true' }), /布尔/)
  await fx.service.configure({ model: '' })
  await assert.rejects(fx.service.configure({ enabled: true, model: 'new' }), /先保存/)
  assert.equal(agentCalls, 0)
  assert.equal(fx.imageCalls(), 0)
})

test('disabling keeps saved images accessible but rejects generation from another client', async t => {
  const fx = await fixture(t), key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'succeeded')
  await fx.service.configure({ enabled: false })
  assert.equal((await fx.service.status('parent', 2)).status, 'succeeded')
  assert.deepEqual((await fx.service.readImage('parent', 2, key)).data, png)
  await assert.rejects(fx.service.start('parent', 2, key), /手动启用/)
  assert.equal(fx.imageCalls(), 1)
})

test('server rejects generation during foreground streaming before running an Agent', async t => {
  const fx = await fixture(t, { isRunning: () => true, runAgent: () => assert.fail('must not start') })
  await assert.rejects(fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key), /正文生成完成/)
  assert.equal(fx.imageCalls(), 0)
})

test('complete one-click native child Agent flow, no foreground writes, durable image, duplicate suppression', async t => {
  let followup, registered, childOptions, persona, descriptor, disposed = 0
  const runner = createBackgroundAgentRunner({ agents: {
    get: () => ({ id: 'parent', session: { header: {} } }),
    async create(options) {
      childOptions = options
      const events = []
      const hooks = {}
      const session = { id: options.sessionId, events, append(type, data) { if (type === 'subagent/descriptor') descriptor = data; events.push({ type, data }) } }
      await options.setup({
        systemPrompt: { section: value => { persona = value.text }, variable() {}, suppressRuntimeContext() {} },
        tools: { restrict() {}, register(tool) { registered = tool; return () => {} } }, on(name, fn) { hooks[name] = fn }
      })
      const agent = { session, followup: value => { followup = value }, async whenIdle() {
        await hooks['agent/pre-step']({ agent, turn: 1, step: 1 }, async () => ({ kind: 'enter', messages: [] }))
        await registered.execute({ prompt: 'A woman at a rainy window' })
        events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '完成' }] } } })
      } }
      return { agent, async dispose() { disposed++ } }
    }
  } })
  const fx = await fixture(t, { runAgent: runner.run })
  const before = structuredClone(fx.chat()), target = sceneTarget(fx.chat(), 2)
  const starts = await Promise.all([fx.service.start('parent', 2, target.key), fx.service.start('parent', 2, target.key)])
  assert.equal(starts[0].requestId, starts[1].requestId)
  const status = await until(async () => { const s = await fx.service.status('parent', 2); return s.status === 'succeeded' && s })
  assert.equal(fx.imageCalls(), 1)
  assert.equal(childOptions.meta.origin, 'subagent')
  assert.equal(childOptions.meta.parentSession, 'parent')
  assert.match(persona, /独立的场景生图/)
  assert.ok(descriptor)
  assert.match(followup.content[0].text, /她站在窗边看雨/)
  assert.match(followup.content[0].text, /左手扶窗/)
  assert.equal(disposed, 1)
  assert.deepEqual(fx.chat(), before)
  assert.equal(status.attachment, undefined)
  const restarted = createSceneIllustrations(fx.deps)
  assert.equal((await restarted.status('parent', 2)).status, 'succeeded')
  assert.deepEqual((await restarted.readImage('parent', 2, target.key)).data, png)
  await restarted.start('parent', 2, target.key)
  assert.equal(fx.imageCalls(), 1)
  const settings = await restarted.settings()
  assert.equal(settings.hasKey, true)
  assert.equal(JSON.stringify(await fx.store.readJson('scene-images/settings.json')).includes('secret'), false)
})

test('provider failure is visible, not auto-retried, explicit retry works', async t => {
  let calls = 0
  const fx = await fixture(t, { generate: async () => { if (++calls === 1) throw new Error('service failed'); return { data: png, mediaType: 'image/png' } } })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  const failed = await until(async () => { const s = await fx.service.status('parent', 2); return s.status === 'failed' && s })
  assert.match(failed.error, /service failed/)
  assert.equal(calls, 1)
  await fx.service.start('parent', 2, key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'succeeded')
  assert.equal(calls, 2)
})

test('late picture cannot attach to a replaced swipe; saved picture survives failed Agent acknowledgement', async t => {
  let release
  const fx = await fixture(t, { generate: () => new Promise(resolve => { release = () => resolve({ data: png, mediaType: 'image/png' }) }) })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  await until(() => release)
  fx.chat().messages[1].swipeId = 1
  release()
  await fx.service.dispose()
  assert.equal((await fx.service.status('parent', 2)).status, 'idle')
  await assert.rejects(fx.service.readImage('parent', 2, key), /版本/)
  const other = await fixture(t, { runAgent: async input => { await input.onToolCall({ arguments: { prompt: 'Scene' } }); throw new Error('final text failed') } })
  await other.service.start('parent', 2, sceneTarget(other.chat(), 2).key)
  await until(async () => (await other.service.status('parent', 2)).status === 'succeeded')
})

test('missing credentials/attachments reject before charging; timeout never retries automatically', async t => {
  const missing = await fixture(t, { attachments: () => undefined })
  await assert.rejects(missing.service.start('parent', 2, sceneTarget(missing.chat(), 2).key), /附件服务/)
  assert.equal(missing.imageCalls(), 0)
  let attempts = 0
  const timed = await fixture(t, { timeoutMs: 25, generate: async input => {
    attempts++
    await new Promise((resolve, reject) => { if (input.signal.aborted) reject(input.signal.reason); else input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }) })
  } })
  await timed.service.start('parent', 2, sceneTarget(timed.chat(), 2).key)
  const status = await until(async () => { const value = await timed.service.status('parent', 2); return value.status === 'failed' && value })
  assert.match(status.error, /超时或取消.*可能已计费/)
  assert.equal(attempts, 1)
})
