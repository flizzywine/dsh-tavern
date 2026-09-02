import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSceneIllustrations, sceneTarget, sceneInput, IMAGE_CREDENTIAL } from '../tavern-plugin/lib/domain/scene-illustration.js'
import { generateSceneImage, imageSettings, validateImageDownload } from '../tavern-plugin/lib/domain/scene-image-provider.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'
import { createHash } from 'node:crypto'
import { imageZip } from './fixtures/scene-image-zip.mjs'
import { comfyGraph } from './fixtures/scene-image-comfy-workflow.mjs'
import { createSceneImageDiagnostics } from '../tavern-plugin/lib/domain/scene-image-diagnostics.js'
import { readScenePlanInstruction, readSceneAdjustmentInstruction } from '../tavern-plugin/lib/scene-image-prompts.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=', 'base64')
const imagePath = 'scene-images/' + createHash('sha256').update('test-chat').digest('hex') + '/'
const chatFixture = () => ({ id: 'test-chat', mode: 'story', sessionId: 'parent', settleStatus: 'done', posture: '站在窗边，左手扶窗', messages: [{ role: 'user', text: '走到窗边' }, { role: 'assistant', turn: 2, sourceText: '她站在窗边看雨。', swipes: ['她站在窗边看雨。', '她坐在椅子上。'], swipeId: 0 }] })
const planFixture = (tags = 'A woman standing at a rainy window') => ({ description: '窗边一景', subjects: [], characters: [], continuity: 'uncertain', scene: { composition: { text: '窗边一景', tags, evidence: [] } } })

test('image Agent can cite historical character designs but not their default outfit as current clothing', async t => {
  const fx = await fixture(t, { runAgent: async input => {
    assert.ok(input.tools.some(tool => tool.name === 'character_design_read'))
    assert.ok(!input.tools.some(tool => tool.name === 'character_design_save'))
    const read = JSON.parse(await input.onToolCall({ name: 'character_design_read', arguments: { name: '林岚' } }))
    assert.equal(read.character.design.appearance, '黑色短发')
    const source = read.sources[0]
    const field = (text, tags) => ({ text, tags, evidence: [{ source: source.id, quote: text }] })
    const plan = planFixture()
    plan.subjects = ['lin']
    plan.characters = [{ id: 'lin', name: '林岚', identity: { source: source.id, quote: '林岚' }, fields: {
      appearance: field('黑色短发', 'short black hair'), clothing: field('白色外套', 'white coat')
    } }]
    assert.match(await input.onToolCall({ name: 'submit_scene_plan', arguments: { plan } }), /不能只引用初始设定/)
    delete plan.characters[0].fields.clothing
    assert.match(await input.onToolCall({ name: 'submit_scene_plan', arguments: { plan } }), /已校验保存/)
  } })
  fx.chat().characterDesignDocument = { revision: 1, characters: [{ name: '林岚', design: { appearance: '黑色短发', defaultPresentation: '白色外套' } }] }
  const historical = structuredClone(fx.chat())
  fx.deps.stateAtTarget = async () => historical
  fx.chat().messages.push({ role: 'assistant', turn: 3, text: '之后她染了红发。' })
  fx.chat().characterDesignDocument.characters[0].design.appearance = '红发'
  const before = structuredClone(fx.chat())
  await fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'succeeded')
  assert.deepEqual(fx.chat(), before)
})

test('image reader stays available when historical design snapshot is missing, without reading current designs', async t => {
  const fx = await fixture(t, { runAgent: async input => {
    assert.ok(input.tools.some(tool => tool.name === 'character_design_read'))
    const result = JSON.parse(await input.onToolCall({ name: 'character_design_read', arguments: { name: '林岚' } }))
    assert.equal(result.found, false)
    assert.equal(result.character, undefined)
    await input.onToolCall({ name: 'submit_scene_plan', arguments: { plan: planFixture() } })
  } })
  fx.chat().characterDesignDocument = { characters: [{ name: '林岚', design: { appearance: '未来红发' } }] }
  fx.chat().messages.push({ role: 'assistant', turn: 3, text: '未来。' })
  await fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'succeeded')
})

test('built-in module needs no plugin registration or Studio HTTP and survives restart', async t => {
  let posts = 0
  const fx = await fixture(t, {
    webServer: () => assert.fail('no loopback plugin lookup'),
    fetchImpl: async () => assert.fail('no Studio HTTP'),
    generate: async () => { posts++; return { data: png, mediaType: 'image/png' } }
  })
  const original = structuredClone(fx.chat())
  const preview = await fx.service.settings()
  assert.equal(preview.ready, true)
  assert.ok(!preview.channels.some(channel => channel.id === 'dsh-image-gen'))
  assert.equal(posts, 0)
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  const done = await until(async () => { const status = await fx.service.status('parent', 2); return status.status === 'succeeded' && status })
  assert.equal(posts, 1)
  assert.deepEqual(fx.chat(), original)
  assert.equal(done.model, 'test-image')
  const restarted = fx.createService()
  assert.equal((await restarted.status('parent', 2)).status, 'succeeded')
  await restarted.start('parent', 2, key)
  assert.equal(posts, 1)
})

test('legacy plugin selector resolves to a real provider without loading a plugin', async t => {
  const fx = await fixture(t)
  assert.equal((await fx.service.settings('dsh-image-gen')).provider, 'openai')
  assert.equal((await fx.service.settings('dsh-image-gen')).ready, true)
})
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
    credentials: () => ({ resolve: async () => ({ value: key }), set: async (_ref, value) => { key = value } }),
    attachments: () => ({ saveImage: async image => { const ref = { attachmentId: 'test-image-' + saved.size, mediaType: image.mediaType }; saved.set(ref.attachmentId, image); return ref }, readImage: async ref => ({ ref, ...saved.get(ref.attachmentId) }) }),
    generate: async () => { imageCalls++; return { data: png, mediaType: 'image/png' } },
    runAgent: async input => { await input.onToolCall({ arguments: { plan: planFixture() } }); return { traceSessionId: 'image-child' } },
    ...overrides
  }
  const services = []
  const createService = () => { const instance = createSceneIllustrations(deps); services.push(instance); return instance }
  const service = createService()
  t.after(async () => { for (const instance of services) await instance.dispose(); await rm(root, { recursive: true, force: true }) })
  await service.configure({ model: 'test-image', baseURL: 'https://provider.example/v1', size: '1024x1024', apiKey: key })
  await service.configure({ enabled: true })
  return { service, createService, deps, store, chat: () => chat, setChat: value => { chat = value }, imageCalls: () => imageCalls }
}

test('setup checks through illustration service do not save drafts or start agents/images', async t => {
  const calls = []
  const fx = await fixture(t, {
    runAgent: async () => assert.fail('connection checks must not run an Agent'),
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method })
      return init.headers.authorization ? Response.json({ data: [{ id: 'sample-image' }] }) : new Response(null, { status: 401 })
    }
  })
  const before = await fx.service.settings()
  const draft = { provider: 'openai', baseURL: 'https://new.example/v1', apiKey: 'unsaved-key' }
  assert.equal((await fx.service.testConnection(draft)).status, 'connected')
  assert.deepEqual((await fx.service.listModels(draft)).models, ['sample-image'])
  assert.deepEqual(await fx.service.settings(), before)
  assert.equal(fx.imageCalls(), 0)
  assert.deepEqual(calls.map(call => call.method), ['GET', 'GET', 'GET'])
})

test('image journal retains failed attempts, validation feedback, actual inputs and later success without exposing internals in status', async t => {
  let submissions = 0
  const fx = await fixture(t, { runAgent: async input => {
    assert.equal(input.system, readScenePlanInstruction())
    submissions++
    if (submissions === 1) {
      await input.onToolCall({ arguments: { plan: { broken: true } } })
      await input.onToolCall({ arguments: { plan: { broken: true } } })
    } else await input.onToolCall({ arguments: { plan: planFixture() } })
    return { traceSessionId: 'image-child-log' }
  } })
  const key = sceneTarget(fx.chat(), 2).key
  const first = await fx.service.start('parent', 2, key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'failed')
  await fx.service.dispose()
  const restarted = fx.createService()
  const second = await restarted.start('parent', 2, key)
  await until(async () => (await restarted.status('parent', 2)).status === 'succeeded')
  await restarted.dispose()
  const journal = await createSceneImageDiagnostics(fx.store).read('test-chat')
  assert.deepEqual(journal.records.map(item => item.requestId), [first.requestId, second.requestId])
  assert.equal(journal.records[0].details.diagnostics.validations.length, 2)
  assert.match(JSON.stringify(journal.records[0].details.diagnostics.input), /她站在窗边/)
  assert.equal(journal.records[0].outcome, 'not_requested')
  assert.equal(journal.records[1].status, 'succeeded')
  assert.equal(journal.records[1].traceSessionId, 'image-child-log')
  assert.equal(journal.records[1].usage.status, 'not-provided')
  assert.ok(journal.records[1].events.some(event => event.stage === 'saving'))
  assert.equal(fx.imageCalls(), 1)
  const visible = await restarted.status('parent', 2)
  assert.equal(visible.diagnosticContext, undefined)
  assert.equal(visible.diagnostics, undefined)
})

test('diagnostic storage failure cannot fail a successful paid image or trigger another request', async t => {
  let failures = 0
  const fx = await fixture(t, { diagnostics: { async record() { throw new Error('diagnostic storage broken') } }, onStorageError() { failures++ } })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'succeeded')
  assert.ok(failures > 0)
  assert.equal(fx.imageCalls(), 1)
  assert.ok((await fx.service.readImage('parent', 2, key)).data.length)
})

test('provider reports explicit rejection separately from ambiguous transport and response failures', async () => {
  const input = { provider: 'openai', baseURL: 'https://provider.example/v1', apiKey: 'secret', prompt: 'scene' }
  for (const status of [400, 401, 402, 403, 404, 422, 429, 500, 504]) {
    await assert.rejects(generateSceneImage(input, { fetch: async () => new Response('secret', { status }) }), error => {
      assert.equal(error.imageOutcome, [429, 500, 504].includes(status) ? 'unconfirmed' : 'rejected')
      assert.ok(!error.message.includes('secret')); return true
    })
  }
  await assert.rejects(generateSceneImage(input, { fetch: async () => { throw new Error('connection lost') } }), error => error.imageOutcome === 'unconfirmed')
  await assert.rejects(generateSceneImage(input, { fetch: async () => Response.json({ data: [] }) }), error => error.imageOutcome === 'unconfirmed')
  await assert.rejects(generateSceneImage({ ...input, baseURL: 'file:///tmp' }, { fetch: () => assert.fail('must not dispatch') }), error => error.imageOutcome === 'not_requested')
})

test('cancel during planning works with feature disabled and never requests an image', async t => {
  let entered = false
  const fx = await fixture(t, { runAgent: async input => {
    entered = true
    await new Promise((resolve, reject) => input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }))
  } })
  const key = sceneTarget(fx.chat(), 2).key
  const started = await fx.service.start('parent', 2, key)
  await until(() => entered)
  await fx.service.configure({ enabled: false })
  await fx.createService().cancel('parent', 2, key, started.requestId)
  const cancelled = await until(async () => { const value = await fx.service.status('parent', 2); return value.status === 'cancelled' && value })
  assert.equal(cancelled.outcome, 'not_requested')
  assert.match(cancelled.error, /尚未请求图片/)
  assert.equal(fx.imageCalls(), 0)
  await fx.service.cancel('parent', 2, key, started.requestId)
  assert.equal((await fx.service.status('parent', 2)).status, 'cancelled')
})

test('cancelled image response arriving late is not published; explicit save can recover received bytes', async t => {
  let entered = false, release
  const fx = await fixture(t, { generate: async () => { entered = true; await new Promise(resolve => { release = resolve }); return { data: png, mediaType: 'image/png' } } })
  const key = sceneTarget(fx.chat(), 2).key
  const started = await fx.service.start('parent', 2, key)
  await until(() => entered)
  const pending = await fx.service.cancel('parent', 2, key, started.requestId)
  assert.equal(pending.stage, 'cancelling')
  await assert.rejects(fx.service.cancel('parent', 2, key, 'stale-request'), /任务已变化/)
  release()
  const cancelled = await until(async () => { const value = await fx.service.status('parent', 2); return value.status === 'cancelled' && value })
  assert.equal(cancelled.versions.length, 0)
  assert.equal(cancelled.recovery, 'save')
  await fx.service.retrySave('parent', 2, key, started.requestId)
  const ready = await until(async () => { const value = await fx.service.status('parent', 2); return value.status === 'succeeded' && value })
  assert.equal(ready.versions.length, 1)
})

test('cancel at attachment publication cannot mount the new image or lose the existing version', async t => {
  const fx = await fixture(t), key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  const first = await until(async () => { const value = await fx.service.status('parent', 2); return value.status === 'succeeded' && value })
  let entered = false, release
  const attachments = fx.deps.attachments()
  fx.deps.attachments = () => ({ ...attachments, async saveImage(image) { entered = true; await new Promise(resolve => { release = resolve }); return attachments.saveImage(image) } })
  const next = await fx.service.start('parent', 2, key, { kind: 'repaint', versionId: first.versions[0].id })
  await until(() => entered)
  await fx.service.cancel('parent', 2, key, next.requestId)
  release()
  const cancelled = await until(async () => { const value = await fx.service.status('parent', 2); return value.status === 'cancelled' && value })
  assert.equal(cancelled.versions.length, 1)
  assert.deepEqual((await fx.service.readImage('parent', 2, key, first.versions[0].id)).data, png)
  assert.equal(cancelled.recovery, 'save')
})

test('unknown cancellation after dispatch requires confirmation bound to that exact attempt', async t => {
  let calls = 0, entered = false
  const fx = await fixture(t, { generate: async input => {
    calls++
    if (calls > 1) return { data: png, mediaType: 'image/png' }
    entered = true
    await new Promise((resolve, reject) => input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }))
  } })
  const key = sceneTarget(fx.chat(), 2).key
  const started = await fx.service.start('parent', 2, key)
  await until(() => entered)
  await fx.service.cancel('parent', 2, key, started.requestId)
  await until(async () => (await fx.service.status('parent', 2)).status === 'cancelled')
  await fx.service.dispose()
  const restarted = fx.createService()
  await assert.rejects(restarted.start('parent', 2, key), /确认重新生图/)
  await assert.rejects(restarted.start('parent', 2, key, { confirmNewRequestId: 'another-attempt' }), /确认重新生图/)
  assert.equal(calls, 1)
  const next = await restarted.start('parent', 2, key, { confirmNewRequestId: started.requestId })
  await until(async () => (await restarted.status('parent', 2)).status === 'succeeded')
  assert.equal(calls, 2)
  const stored = await fx.store.readJson(imagePath + key + '.json')
  assert.equal(stored.requests[started.requestId].outcome, 'unconfirmed')
  assert.equal(stored.requests[next.requestId].confirmedReplacementOf, started.requestId)
})

test('explicit rejected request permits ordinary retry while an unknown restart never does', async t => {
  let calls = 0
  const fx = await fixture(t, { generate: async () => { if (++calls === 1) throw Object.assign(new Error('API key rejected'), { imageOutcome: 'rejected' }); return { data: png, mediaType: 'image/png' } } })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'failed')
  await fx.service.start('parent', 2, key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'succeeded')
  assert.equal(calls, 2)
  await fx.service.dispose()
  await fx.store.updateJson(imagePath + key + '.json', record => ({ ...record, status: 'running', outcome: 'unconfirmed', stage: 'generating', versions: [] }))
  const restarted = fx.createService()
  assert.equal((await restarted.status('parent', 2)).outcome, 'unconfirmed')
  await assert.rejects(restarted.start('parent', 2, key), /确认重新生图/)
  assert.equal(calls, 2)
})

test('durable cancellation flag aborts the owner without an in-memory notification', async t => {
  let entered = false
  const fx = await fixture(t, { generate: async input => {
    entered = true
    await new Promise((resolve, reject) => input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }))
  } })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  await until(() => entered)
  // Same durable write used by another process; deliberately do not call the
  // current process's cancellation/AbortController interface.
  await fx.store.updateJson(imagePath + key + '.json', current => ({ ...current, cancelRequestedAt: Date.now(), stage: 'cancelling' }))
  const stopped = await until(async () => { const value = await fx.service.status('parent', 2); return value.status === 'cancelled' && value })
  assert.equal(stopped.outcome, 'unconfirmed')
  assert.equal(stopped.versions.length, 0)
})

test('cancelling one conversation does not interrupt another pending image', async t => {
  const requests = []
  const fx = await fixture(t, { generate: async input => new Promise((resolve, reject) => {
    requests.push({ signal: input.signal, resolve })
    input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true })
  }) })
  fx.deps.chatForSession = async sessionId => ({ ...structuredClone(fx.chat()), id: sessionId })
  const a = await fx.service.status('chat-a', 2), b = await fx.service.status('chat-b', 2)
  const started = await fx.service.start('chat-a', 2, a.key)
  await until(() => requests.length === 1)
  await fx.service.start('chat-b', 2, b.key)
  await until(async () => (await fx.service.status('chat-b', 2)).stage === 'queued')
  assert.equal(requests.length, 1, 'second conversation must not dispatch concurrently')
  await fx.service.cancel('chat-a', 2, a.key, started.requestId)
  await until(async () => (await fx.service.status('chat-a', 2)).status === 'cancelled')
  await until(() => requests.length === 2)
  assert.equal(requests[1].signal.aborted, false)
  requests[1].resolve({ data: png, mediaType: 'image/png' })
  await until(async () => (await fx.service.status('chat-b', 2)).status === 'succeeded')
})

test('cancelling while queued never sends its image request or interrupts the active one', async t => {
  let calls = 0, release
  const fx = await fixture(t, { generate: async () => { calls++; await new Promise(resolve => { release = resolve }); return { data: png, mediaType: 'image/png' } } })
  fx.deps.chatForSession = async sessionId => ({ ...structuredClone(fx.chat()), id: sessionId })
  const a = await fx.service.status('chat-a', 2), b = await fx.service.status('chat-b', 2)
  await fx.service.start('chat-a', 2, a.key)
  await until(() => calls === 1)
  const second = await fx.service.start('chat-b', 2, b.key)
  await until(async () => (await fx.service.status('chat-b', 2)).stage === 'queued')
  await fx.service.cancel('chat-b', 2, b.key, second.requestId)
  const cancelled = await until(async () => { const value = await fx.service.status('chat-b', 2); return value.status === 'cancelled' && value })
  assert.equal(cancelled.outcome, 'not_requested')
  assert.equal(calls, 1)
  assert.equal((await fx.service.status('chat-a', 2)).status, 'running')
  release()
  await until(async () => (await fx.service.status('chat-a', 2)).status === 'succeeded')
})

test('NovelAI service sends frozen structured people and saves the exact key-free request across restart/repaint', async t => {
  let agentCalls = 0
  const requests = []
  const fx = await fixture(t, {
    credentials: () => ({ resolve: async () => ({ value: 'nai-secret' }), set: async () => {} }),
    runAgent: async input => {
      agentCalls++
      assert.match(JSON.stringify(input.messages), /NovelAI.*英文绘图标签/)
      const makeField = (text, tags, quote) => ({ text, tags, evidence: [{ source: 'target', quote }] })
      await input.onToolCall({ arguments: { plan: {
        description: '两人在站台', subjects: ['a', 'b'], continuity: 'uncertain',
        characters: [
          { id: 'a', name: '林岚', identity: { source: 'target', quote: '林岚黑发蓝衣' }, fields: { appearance: makeField('黑发', 'black hair', '林岚黑发蓝衣'), clothing: makeField('蓝衣', 'blue coat', '林岚黑发蓝衣') } },
          { id: 'b', name: '白青', identity: { source: 'target', quote: '白青银发白衣' }, fields: { appearance: makeField('银发', 'silver hair', '白青银发白衣'), clothing: makeField('白衣', 'white jacket', '白青银发白衣') } }
        ], scene: { composition: { text: '两人站台远景', tags: 'two people, station, wide shot', evidence: [] } }
      } } })
    },
    generate: input => generateSceneImage(input, { fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); return new Response(imageZip(png)) } })
  })
  fx.chat().messages[1].sourceText = '林岚黑发蓝衣，白青银发白衣，两人在站台等车。'
  delete fx.chat().messages[1].swipes
  await fx.service.configure({ provider: 'novelai' })
  await fx.service.configure({ enabled: true })
  const target = sceneTarget(fx.chat(), 2)
  await fx.service.start('parent', 2, target.key)
  const first = await until(async () => { const result = await fx.service.status('parent', 2); return result.status !== 'running' && result })
  assert.equal(first.status, 'succeeded', first.error)
  assert.equal(requests[0].input, 'two people, station, wide shot')
  assert.deepEqual(requests[0].parameters.v4_prompt.caption.char_captions.map(item => item.char_caption), ['black hair, blue coat', 'silver hair, white jacket'])
  assert.deepEqual(first.versions[0].generation.request, requests[0])
  const next = fx.createService()
  await next.start('parent', 2, target.key, { kind: 'repaint', versionId: first.versions[0].id })
  const second = await until(async () => { const result = await next.status('parent', 2); return result.status !== 'running' && result })
  assert.equal(second.status, 'succeeded', second.error)
  assert.equal(agentCalls, 1)
  assert.equal(second.versions.length, 2)
  assert.deepEqual(second.versions[0].generation.request, requests[0])
  assert.deepEqual(second.versions[1].generation.request, requests[1])
  assert.equal(requests.length, 2)
  assert.equal(JSON.stringify(second).includes('nai-secret'), false)
})

test('ComfyUI retry after restart or attachment failure queries the saved job without another generation', async t => {
  let posts = 0, texts = 0, offline = true, jobId, failSave = true
  const fx = await fixture(t, {
    credentials: () => ({ resolve: async () => ({ value: 'fixture-key' }), set: async () => {} }),
    runAgent: async input => { texts++; await input.onToolCall({ arguments: { plan: planFixture() } }) },
    generate: input => generateSceneImage(input, { fetch: async (url, init) => {
      if (url.endsWith('/prompt')) { posts++; jobId = JSON.parse(init.body).prompt_id; return Response.json({ prompt_id: jobId }) }
      if (offline) throw new Error('offline')
      if (url.includes('/history/')) { assert.ok(url.endsWith(jobId)); return Response.json({ [jobId]: { status: { status_str: 'success', completed: true }, outputs: { '7': { images: [{ filename: 'saved.png', subfolder: '', type: 'output' }] } } } }) }
      return new Response(png)
    } }),
    attachments: () => ({ saveImage: async () => { if (failSave) { failSave = false; throw new Error('disk unavailable') } return { attachmentId: 'comfy-image', mediaType: 'image/png' } }, readImage: async ref => ({ ref, data: png }) })
  })
  await fx.service.configure({ provider: 'comfyui', baseURL: 'http://localhost:8188', workflow: comfyGraph() })
  await fx.service.configure({ enabled: true })
  const target = sceneTarget(fx.chat(), 2)
  const finish = async service => { await service.start('parent', 2, target.key); return until(async () => { const value = await service.status('parent', 2); return value.status !== 'running' && value }) }
  const first = await finish(fx.service)
  assert.equal(first.status, 'failed'); assert.equal(first.providerTask.promptId, jobId)
  assert.equal(first.providerTask.state, 'pending')
  const restarted = fx.createService()
  await restarted.configure({ baseURL: 'http://localhost:8199' })
  await assert.rejects(restarted.start('parent', 2, target.key), /恢复原渠道/)
  assert.equal(posts, 1)
  await restarted.configure({ baseURL: 'http://localhost:8188' })
  offline = false
  const second = await finish(restarted)
  assert.equal(second.status, 'failed'); assert.equal(second.recovery, 'save')
  assert.equal(second.providerTask.state, 'succeeded')
  const finalService = fx.createService()
  await finalService.retrySave('parent', 2, target.key, second.requestId)
  const third = await until(async () => { const value = await finalService.status('parent', 2); return value.status !== 'running' && value })
  assert.equal(third.status, 'succeeded', third.error)
  assert.equal(posts, 1); assert.equal(texts, 1)
  assert.equal(third.versions[0].generation.promptId, jobId)
  assert.equal(third.configuration.workflow.prompt, undefined, 'polling must not return a complete workflow graph')
})

test('ComfyUI cancellation retains its task identity and explicit resume queries instead of buying again', async t => {
  let posts = 0, jobId, entered = false
  const fx = await fixture(t, {
    credentials: () => ({ resolve: async () => ({ value: 'fixture-key' }), set: async () => {} }),
    generate: input => generateSceneImage(input, { fetch: async (url, init) => {
      if (url.endsWith('/prompt')) {
        posts++; jobId = JSON.parse(init.body).prompt_id; entered = true
        await new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
      }
      if (url.includes('/history/')) return Response.json({ [jobId]: { status: { status_str: 'success', completed: true }, outputs: { '7': { images: [{ filename: 'saved.png', subfolder: '', type: 'output' }] } } } })
      return new Response(png)
    } })
  })
  await fx.service.configure({ provider: 'comfyui', baseURL: 'http://localhost:8188', workflow: comfyGraph() })
  await fx.service.configure({ enabled: true })
  const key = sceneTarget(fx.chat(), 2).key
  const started = await fx.service.start('parent', 2, key)
  await until(() => entered)
  await fx.service.cancel('parent', 2, key, started.requestId)
  const cancelled = await until(async () => { const value = await fx.service.status('parent', 2); return value.status === 'cancelled' && value })
  assert.equal(cancelled.providerTask.promptId, jobId)
  await fx.service.dispose()
  const next = fx.createService()
  await next.start('parent', 2, key)
  const ready = await until(async () => { const value = await next.status('parent', 2); return value.status === 'succeeded' && value })
  assert.equal(posts, 1)
  assert.equal(ready.versions[0].generation.promptId, jobId)
})

test('attachment failure recovers received bytes after restart with settings disabled and no credentials or model', async t => {
  let saves = 0, texts = 0, images = 0
  const fx = await fixture(t, {
    runAgent: async input => { texts++; await input.onToolCall({ arguments: { plan: planFixture() } }) },
    generate: async () => { images++; return { data: png, mediaType: 'image/png', metadata: { seed: 71, model: 'original-model' } } },
    attachments: () => ({ saveImage: async () => { if (++saves === 1) throw new Error('storage offline'); return { attachmentId: 'recovered-image' } }, readImage: async ref => ({ ref, data: png }) })
  })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key, { requestId: 'original-image-request' })
  const failed = await until(async () => { const value = await fx.service.status('parent', 2); return value.status === 'failed' && value })
  assert.equal(failed.recovery, 'save')
  assert.equal(failed.savedAttachment, undefined)
  assert.ok(!JSON.stringify(failed).includes(png.toString('base64')))
  await assert.rejects(fx.service.start('parent', 2, key), /重试保存/)
  await fx.service.configure({ enabled: false, model: 'different-model' })
  await fx.service.dispose()
  fx.deps.credentials = () => { throw new Error('save must not resolve credentials') }
  fx.deps.selection = () => { throw new Error('save must not select an Agent') }
  const restarted = fx.createService()
  await assert.rejects(restarted.retrySave('parent', 2, key, 'another-request'), /任务已变化/)
  await Promise.all([restarted.retrySave('parent', 2, key, failed.requestId), fx.createService().retrySave('parent', 2, key, failed.requestId)])
  const ready = await until(async () => { const value = await restarted.status('parent', 2); return value.status === 'succeeded' && value })
  assert.equal(ready.enabled, false)
  assert.equal(ready.recovery, undefined)
  assert.equal(ready.versions.length, 1)
  assert.equal(ready.versions[0].model, 'original-model')
  assert.equal(ready.versions[0].generation.seed, 71)
  assert.equal(ready.versions[0].id, failed.requestId)
  await restarted.retrySave('parent', 2, key, failed.requestId)
  assert.equal(images, 1); assert.equal(texts, 1); assert.equal(saves, 2)
  assert.deepEqual((await restarted.readImage('parent', 2, key)).data, png)
  const pendingPath = imagePath + key + '.json.received-' + createHash('sha256').update(failed.requestId).digest('hex') + '.json'
  await until(async () => (await fx.store.readJson(pendingPath)) === undefined)
})

test('failed final publication retains the attachment reference and original image version', async t => {
  const fx = await fixture(t)
  const underlying = fx.deps.store
  let breakPublish = true, saves = 0
  const attachments = fx.deps.attachments()
  fx.deps.attachments = () => ({ ...attachments, saveImage: async image => { saves++; return attachments.saveImage(image) } })
  fx.deps.store = { ...underlying, updateJson: (path, updater) => underlying.updateJson(path, async current => {
    const value = await updater(current)
    if (value?.status === 'succeeded' && breakPublish) { breakPublish = false; throw new Error('publication disk failure') }
    return value
  }) }
  const service = fx.createService(), key = sceneTarget(fx.chat(), 2).key
  await service.start('parent', 2, key)
  const failed = await until(async () => { const value = await service.status('parent', 2); return value.status === 'failed' && value })
  assert.equal(failed.recovery, 'save')
  assert.equal(failed.savedAttachment, undefined, 'internal attachment handle is not exposed')
  const restarted = fx.createService()
  await restarted.retrySave('parent', 2, key, failed.requestId)
  await until(async () => (await restarted.status('parent', 2)).status === 'succeeded')
  assert.equal(saves, 1); assert.equal(fx.imageCalls(), 1)
})

test('failed outbox write keeps received bytes in the live host and never resubmits generation', async t => {
  const fx = await fixture(t), underlying = fx.deps.store
  let failPending = true
  fx.deps.store = { ...underlying, writeJson: async (path, value) => {
    if (path.includes('.received-') && failPending) { failPending = false; throw new Error('disk temporarily full') }
    return underlying.writeJson(path, value)
  } }
  const service = fx.createService(), key = sceneTarget(fx.chat(), 2).key
  await service.start('parent', 2, key)
  const failed = await until(async () => { const value = await service.status('parent', 2); return value.status === 'failed' && value })
  assert.equal(failed.recovery, 'save')
  await service.retrySave('parent', 2, key, failed.requestId)
  await until(async () => (await service.status('parent', 2)).status === 'succeeded')
  assert.equal(fx.imageCalls(), 1)
})

test('missing pending bytes cannot silently fall back to paid generation', async t => {
  const fx = await fixture(t, { attachments: () => ({ saveImage: async () => { throw new Error('disk offline') }, readImage() {} }) })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  const failed = await until(async () => { const value = await fx.service.status('parent', 2); return value.status === 'failed' && value })
  const pendingPath = imagePath + key + '.json.received-' + createHash('sha256').update(failed.requestId).digest('hex') + '.json'
  await fx.store.remove(pendingPath)
  await fx.service.retrySave('parent', 2, key, failed.requestId)
  await until(async () => (await fx.service.status('parent', 2)).status === 'failed')
  await assert.rejects(fx.service.start('parent', 2, key), /重试保存/)
  assert.equal(fx.imageCalls(), 1)
})

test('abandoned task discovers durable bytes even if saving stage was never published', async t => {
  const fx = await fixture(t, { attachments: () => ({ saveImage: async () => { throw new Error('storage offline') }, readImage() {} }) })
  const key = sceneTarget(fx.chat(), 2).key, path = imagePath + key + '.json'
  await fx.service.start('parent', 2, key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'failed')
  await fx.service.dispose()
  await fx.store.updateJson(path, record => ({ ...record, status: 'running', stage: 'generating', recovery: undefined }))
  const restarted = fx.createService()
  const recovered = await restarted.status('parent', 2)
  assert.equal(recovered.status, 'failed')
  assert.equal(recovered.recovery, 'save')
  assert.match(recovered.error, /不会重新生图/)
  assert.equal(fx.imageCalls(), 1)
})

test('pending-file cleanup failure does not turn a published image into a failed job', async t => {
  const fx = await fixture(t), underlying = fx.deps.store
  let warnings = 0
  fx.deps.onStorageError = () => { warnings++ }
  fx.deps.store = { ...underlying, remove: async () => { throw new Error('cleanup unavailable') } }
  const service = fx.createService(), key = sceneTarget(fx.chat(), 2).key
  await service.start('parent', 2, key)
  const ready = await until(async () => { const value = await service.status('parent', 2); return value.status === 'succeeded' && value })
  await until(() => warnings === 1)
  await service.retrySave('parent', 2, key, ready.requestId)
  assert.equal((await service.status('parent', 2)).versions.length, 1)
  assert.equal(fx.imageCalls(), 1)
})

test('corrupted received bytes fail closed without a new paid request', async t => {
  let saves = 0
  const fx = await fixture(t, { attachments: () => ({ saveImage: async () => { saves++; throw new Error('storage offline') }, readImage() {} }) })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  const failed = await until(async () => { const value = await fx.service.status('parent', 2); return value.status === 'failed' && value })
  const pendingPath = imagePath + key + '.json.received-' + createHash('sha256').update(failed.requestId).digest('hex') + '.json'
  await fx.store.updateJson(pendingPath, image => ({ ...image, data: Buffer.from('damaged').toString('base64') }))
  await fx.service.retrySave('parent', 2, key, failed.requestId)
  await until(async () => (await fx.service.status('parent', 2)).status === 'failed')
  assert.equal(saves, 1, 'corrupt bytes must not reach the attachment service')
  assert.equal(fx.imageCalls(), 1)
})

test('default enablement, partial saves and legacy migration never cause paid requests', async t => {
  let agentCalls = 0
  const fx = await fixture(t, { runAgent: async () => { agentCalls++ } })
  await fx.store.writeJson('scene-images/settings.json', { model: 'legacy', baseURL: 'https://provider.example/v1' })
  assert.equal((await fx.service.settings()).enabled, true)
  assert.equal((await fx.service.settings()).ready, false)
  assert.equal((await fx.service.settings()).migrationPending, true)
  const target = sceneTarget(fx.chat(), 2)
  await assert.rejects(fx.service.start('parent', 2, target.key), /迁移旧生图配置/)
  await fx.service.configure({ model: 'new-model' })
  assert.equal((await fx.service.settings()).enabled, true)
  await fx.service.configure({ enabled: true })
  assert.equal((await fx.service.settings()).model, 'new-model')
  assert.equal((await fx.service.settings()).enabled, true)
  await Promise.all([fx.service.configure({ model: 'concurrent' }), fx.service.configure({ enabled: false })])
  assert.equal((await fx.service.settings()).model, 'concurrent')
  assert.equal((await fx.service.settings()).enabled, false)
  await assert.rejects(fx.service.configure({ enabled: 'true' }), /布尔/)
  await fx.service.configure({ model: '' })
  await assert.rejects(fx.service.configure({ enabled: true, model: 'new' }), /先保存/)
  await fx.service.configure({ enabled: true })
  assert.equal((await fx.service.settings()).enabled, true)
  assert.equal((await fx.service.settings()).ready, false)
  await assert.rejects(fx.service.start('parent', 2, target.key), /完成生图渠道配置/)
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

test('WebUI can run without a key and its failure message remains readable', async t => {
  const keys = new Map()
  const fx = await fixture(t, {
    credentials: () => ({ resolve: async ref => ({ value: keys.get(ref) }), set: async (ref, value) => { keys.set(ref, value) } }),
    generate: async input => { assert.equal(input.apiKey, ''); throw new Error('WebUI connection unavailable') }
  })
  await fx.service.configure({ provider: 'webui', baseURL: 'http://localhost:7860' })
  await fx.service.configure({ enabled: true })
  await fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'failed')
  assert.match((await fx.service.status('parent', 2)).error, /结果未确认/)
  const stored = await fx.store.readJson(imagePath + sceneTarget(fx.chat(), 2).key + '.json')
  assert.equal(stored.diagnostics.failure, 'WebUI connection unavailable')
})

test('a channel change during planning cannot change the frozen paid request or its key', async t => {
  const keys = new Map(), generated = []
  let release, started
  const waiting = new Promise(resolve => { release = resolve })
  const began = new Promise(resolve => { started = resolve })
  t.after(() => release())
  const fx = await fixture(t, {
    credentials: () => ({ resolve: async ref => ({ value: keys.get(ref) }), set: async (ref, value) => { keys.set(ref, value) } }),
    runAgent: async input => { started(); await waiting; await input.onToolCall({ arguments: { plan: planFixture() } }); return {} },
    generate: async input => { generated.push(input); return { data: png, mediaType: 'image/png' } }
  })
  await fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key)
  await began
  await fx.service.configure({ baseURL: 'https://new.example/v1', apiKey: 'rotated-openai-key' })
  await fx.service.configure({ provider: 'gemini', apiKey: 'gemini-key' })
  release()
  await until(async () => (await fx.service.status('parent', 2)).status === 'failed')
  assert.equal(generated.length, 0)
  const current = await fx.service.status('parent', 2)
  assert.equal(current.outcome, 'not_requested')
  assert.match(current.error, /配置已变化/)
  assert.match(current.profile, /gemini/)
  assert.equal(current.enabled, true)
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
        await registered.execute({ plan: planFixture('A woman at a rainy window') })
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
  assert.equal(disposed, 0, 'image Agent remains resident after the task')
  assert.equal(descriptor.mode, 'continuable')
  assert.equal((await fx.store.readJson(imagePath + 'agent.json')).sessionId, childOptions.sessionId)
  t.after(() => runner.dispose())
  assert.deepEqual(fx.chat(), before)
  assert.equal(status.attachment, undefined)
  const restarted = fx.createService()
  assert.equal((await restarted.status('parent', 2)).status, 'succeeded')
  assert.deepEqual((await restarted.readImage('parent', 2, target.key)).data, png)
  await restarted.start('parent', 2, target.key)
  assert.equal(fx.imageCalls(), 1)
  const settings = await restarted.settings()
  assert.equal(settings.hasKey, true)
  assert.equal(JSON.stringify(await fx.store.readJson('scene-images/settings.json')).includes('secret'), false)
})

test('provider failure is visible, not auto-retried, explicit retry works', async t => {
  let calls = 0, agentCalls = 0
  const fx = await fixture(t, {
    runAgent: async input => { agentCalls++; await input.onToolCall({ arguments: { plan: planFixture() } }); return { traceSessionId: 'image-child' } },
    generate: async () => { if (++calls === 1) throw new Error('service failed'); return { data: png, mediaType: 'image/png' } }
  })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  const failed = await until(async () => { const s = await fx.service.status('parent', 2); return s.status === 'failed' && s })
  assert.match(failed.error, /结果未确认/)
  assert.equal(calls, 1)
  await assert.rejects(fx.service.start('parent', 2, key), /确认重新生图/)
  await fx.service.start('parent', 2, key, { confirmNewRequestId: failed.requestId })
  await until(async () => (await fx.service.status('parent', 2)).status === 'succeeded')
  assert.equal(calls, 2)
  assert.equal(agentCalls, 1, 'valid persistent plan survives provider failure and is reused')
})

test('scene references stay out of initial input, bind evidence and cannot alone establish current clothing', async t => {
  const fx = await fixture(t, { runAgent: async input => {
    assert.deepEqual(input.tools.map(tool => tool.name), ['submit_scene_plan', 'character_design_read', 'read_scene_reference'])
    assert.equal(input.maxToolCalls, 5)
    assert.doesNotMatch(input.messages[0].content[0].text, /黑色短发|白色裙子/)
    const read = JSON.parse(await input.onToolCall({ name: 'read_scene_reference', arguments: { query: '林岚' } }))
    const source = read.sources[0]
    assert.match(source.text, /黑色短发/)
    const plan = planFixture()
    const appearance = { text: '黑色短发', tags: 'short black hair', evidence: [{ source: source.id, quote: '黑色短发' }] }
    plan.subjects = ['local-person']
    plan.characters = [{ id: 'local-person', name: '林岚', identity: { source: source.id, quote: '林岚' }, fields: {
      appearance, clothing: { text: '白色裙子', tags: 'white dress', evidence: [{ source: source.id, quote: '白色裙子' }] }
    } }]
    const rejected = await input.onToolCall({ name: 'submit_scene_plan', arguments: { plan } })
    assert.match(rejected, /不能只引用初始设定/)
    assert.equal(fx.imageCalls(), 0)
    delete plan.characters[0].fields.clothing
    assert.match(await input.onToolCall({ name: 'submit_scene_plan', arguments: { plan } }), /已校验保存/)
    return {}
  } })
  fx.chat().cardContextSnapshotVersion = 5
  fx.chat().cardContextSnapshot = '【故事设定 · 人物卡】\n名字: 林岚\n\n设定: 林岚留着黑色短发，开场穿白色裙子。'
  const before = structuredClone(fx.chat()), target = sceneTarget(fx.chat(), 2)
  await fx.service.start('parent', 2, target.key)
  const result = await until(async () => { const value = await fx.service.status('parent', 2); return value.status !== 'running' && value })
  assert.equal(result.status, 'succeeded', result.error)
  assert.match(result.versions[0].prompt, /short black hair/)
  assert.doesNotMatch(result.versions[0].prompt, /white dress/)
  const record = await fx.store.readJson(imagePath + target.key + '.json')
  assert.equal(record.plan.people[0].identity.origin.kind, 'play-card-snapshot')
  assert.equal(record.plan.people[0].fields.appearance.evidence[0].origin.snapshotVersion, 5)
  assert.equal(record.diagnostics.references[0].query, '林岚')
  assert.equal(fx.imageCalls(), 1)
  assert.deepEqual(fx.chat(), before)
})

test('historical reference lookup uses that target snapshot or omits references, never the latest edited card', async t => {
  for (const hasHistorical of [false, true]) {
    const fx = await fixture(t, {
      stateAtTarget: async () => hasHistorical ? { cardContextSnapshotVersion: 5, cardContextSnapshot: '【故事设定 · 人物卡】\n名字: 林岚\n\n设定: 林岚留着历史黑发。' } : undefined,
      runAgent: async input => {
        assert.equal(input.tools.some(tool => tool.name === 'read_scene_reference'), hasHistorical)
        if (hasHistorical) {
          const read = await input.onToolCall({ name: 'read_scene_reference', arguments: { query: '林岚' } })
          assert.match(read, /历史黑发/)
          assert.doesNotMatch(read, /未来红发/)
        }
        await input.onToolCall({ arguments: { plan: planFixture() } })
        return {}
      }
    })
    fx.chat().cardContextSnapshotVersion = 5
    fx.chat().cardContextSnapshot = '【故事设定 · 人物卡】\n名字: 林岚\n\n设定: 林岚改成未来红发。'
    fx.chat().messages.push({ role: 'assistant', turn: 3, text: '下一天。' })
    await fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key)
    const result = await until(async () => { const value = await fx.service.status('parent', 2); return value.status !== 'running' && value })
    assert.equal(result.status, 'succeeded', result.error)
  }
})

test('format repair happens before image request; a saved plan survives failed final acknowledgement', async t => {
  const fx = await fixture(t, { runAgent: async input => {
    assert.deepEqual(input.tools.map(tool => tool.name), ['submit_scene_plan', 'character_design_read'])
    assert.equal(input.maxToolCalls, 2)
    const error = await input.onToolCall({ arguments: { plan: { prompt: 'not the schema' } } })
    assert.match(error, /未知字段.*尚未收费.*修正一次/)
    assert.equal(fx.imageCalls(), 0)
    assert.equal(input.stopToolsWhen(), false)
    const result = await input.onToolCall({ arguments: { plan: planFixture() } })
    assert.match(result, /已校验保存/)
    assert.equal(input.stopToolsWhen(), true)
    assert.equal(fx.imageCalls(), 0, 'image request is host-controlled, not a tool side effect')
    await input.onToolCall({ arguments: { plan: planFixture('duplicate') } })
    throw new Error('acknowledgement failed')
  } })
  await fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'succeeded')
  assert.equal(fx.imageCalls(), 1)
})

test('two invalid submissions stop before charging and preserve the concrete validation error', async t => {
  const fx = await fixture(t, { runAgent: async input => {
    await input.onToolCall({ arguments: { plan: {} } })
    assert.match(await input.onToolCall({ arguments: { plan: {} } }), /次数已用完/)
    assert.equal(input.stopToolsWhen(), true)
  } })
  await fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key)
  const status = await until(async () => { const value = await fx.service.status('parent', 2); return value.status === 'failed' && value })
  assert.match(status.error, /continuity/)
  assert.equal(fx.imageCalls(), 0)
})

test('historical visual variables reach planning with durable evidence, never future values or full mirrors', async t => {
  let history, material
  const fx = await fixture(t, { stateAtTarget: async () => structuredClone(history), runAgent: async input => {
    material = JSON.parse(input.messages[0].content[0].text)
    const source = material.sources.find(item => item.origin?.kind === 'mvu-state')
    assert.ok(source)
    const plan = planFixture()
    plan.subjects = ['local-person']
    plan.characters = [{ id: 'local-person', name: '林岚', identity: { source: 'target', quote: '林岚' }, fields: {
      clothing: { text: '青色外套', tags: 'blue coat', evidence: [{ source: source.id, quote: '青色外套' }] }
    } }]
    const reply = await input.onToolCall({ arguments: { plan } })
    assert.match(reply, /已校验保存/)
    return { traceSessionId: 'state-child' }
  } })
  fx.chat().messages[1].sourceText = fx.chat().messages[1].swipes[0] = '林岚站在窗边。'
  fx.chat().messages[1].variables = [{ stat_data: { 人物: { 林岚: { 衣着: '青色外套' } } } }]
  fx.chat().messages[1].mvu = { pending: false }
  history = structuredClone(fx.chat())
  fx.chat().messages.push({ role: 'assistant', turn: 3, text: '后续正文', variables: [{ stat_data: { 林岚: { 衣着: '未来红衣' } } }] })
  const target = sceneTarget(fx.chat(), 2), unchanged = structuredClone(fx.chat())
  await fx.service.start('parent', 2, target.key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'succeeded')
  assert.doesNotMatch(JSON.stringify(material), /未来红衣/)
  assert.deepEqual(material.sources.find(source => source.origin?.kind === 'mvu-state').origin, { kind: 'mvu-state' }, 'state provenance hashes stay host-side')
  assert.ok(material.sources.reduce((sum, source) => sum + source.text.length, 0) <= 12000)
  const plans = await fx.store.readJson(imagePath + 'plans.json')
  const person = Object.values(plans.characters)[0]
  assert.equal(person.fields.clothing.evidence[0].origin.path, '/stat_data/人物/林岚/衣着')
  assert.equal(person.fields.clothing.evidence[0].origin.bodyDigest, target.sourceDigest)
  assert.deepEqual(fx.chat(), unchanged)
})

test('historical source never borrows a later posture, and skipped rounds enter the next planning input', async t => {
  const chat = chatFixture(), target = sceneTarget(chat, 2)
  chat.messages.push({ role: 'assistant', turn: 3, text: '她走进室内，换了红衣。' })
  chat.posture = '未来的姿态'
  assert.equal(sceneInput(chat, target).posture, '')
  assert.equal(sceneInput(chat, target, { posture: '历史姿态' }).posture, '历史姿态')
  const inputs = []
  const fx = await fixture(t, { runAgent: async input => { inputs.push(JSON.parse(input.messages[0].content[0].text)); await input.onToolCall({ arguments: { plan: planFixture() } }); return {} } })
  await fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'succeeded')
  fx.chat().messages.push({ role: 'assistant', turn: 3, text: '她走进室内，换了红衣。' }, { role: 'assistant', turn: 4, text: '她坐下。' })
  await fx.service.start('parent', 4, sceneTarget(fx.chat(), 4).key)
  await until(async () => (await fx.service.status('parent', 4)).status === 'succeeded')
  assert.ok(inputs[1].sources.some(source => source.turn === 3 && source.text.includes('红衣')))
  assert.equal(inputs[1].sources.some(source => source.turn === 2), false, 'already aligned body is not resent')
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
  const other = await fixture(t, { runAgent: async input => { await input.onToolCall({ arguments: { plan: planFixture('Scene') } }); throw new Error('final text failed') } })
  await other.service.start('parent', 2, sceneTarget(other.chat(), 2).key)
  await until(async () => (await other.service.status('parent', 2)).status === 'succeeded')
})

test('missing credentials/attachments reject before charging; timeout never retries automatically', async t => {
  const missing = await fixture(t, { attachments: () => undefined })
  await assert.rejects(missing.service.start('parent', 2, sceneTarget(missing.chat(), 2).key), /附件服务/)
  assert.equal(missing.imageCalls(), 0)
  let attempts = 0
  const timed = await fixture(t, { timeoutMs: 300, generate: async input => {
    attempts++
    await new Promise((resolve, reject) => { if (input.signal.aborted) reject(input.signal.reason); else input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }) })
  } })
  await timed.service.start('parent', 2, sceneTarget(timed.chat(), 2).key)
  const status = await until(async () => { const value = await timed.service.status('parent', 2); return value.status === 'failed' && value })
  assert.match(status.error, /结果未确认.*可能已计费/)
  assert.equal(status.outcome, 'unconfirmed')
  assert.equal(attempts, 1)
})

test('repaint bypasses text Agent, retains each version and deduplicates replayed request IDs after restart', async t => {
  let agentCalls = 0
  const fx = await fixture(t, { runAgent: async input => { agentCalls++; await input.onToolCall({ arguments: { plan: planFixture() } }); return {} } })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  const first = await until(async () => { const state = await fx.service.status('parent', 2); return state.status === 'succeeded' && state })
  const versionId = first.versions[0].id
  assert.deepEqual(first.versions[0].configuration, { provider: 'openai', model: 'test-image', baseURL: 'https://provider.example/v1', size: '1024x1024', style: { preset: 'default', custom: '' } })
  const options = { kind: 'repaint', versionId, requestId: 'same-request-id' }
  const values = await Promise.all([fx.service.start('parent', 2, key, options), fx.service.start('parent', 2, key, options)])
  assert.equal(values[0].requestId, values[1].requestId)
  await until(async () => (await fx.service.status('parent', 2)).status === 'succeeded')
  const restarted = fx.createService()
  await restarted.start('parent', 2, key, options)
  const final = await restarted.status('parent', 2)
  assert.equal(final.versions.length, 2)
  assert.equal(agentCalls, 1)
  assert.equal(fx.imageCalls(), 2)
  assert.equal(final.versions.some(version => version.attachment || version.plan), false)
  assert.notEqual((await restarted.readImage('parent', 2, key, versionId)).ref.attachmentId, (await restarted.readImage('parent', 2, key, final.versions[1].id)).ref.attachmentId)
  await restarted.removeImage('parent', 2, key, final.versions[1].id)
  assert.equal((await restarted.status('parent', 2)).versions.length, 1)
  await assert.rejects(restarted.readImage('parent', 2, key, final.versions[1].id), /已删除/)
  await restarted.start('parent', 2, key, options)
  assert.equal(fx.imageCalls(), 2, 'deleting a version cannot replay its paid request')
})

test('image-only adjustment uses just old plan plus instruction, persists through provider failure, and does not change canonical plans', async t => {
  let calls = 0, generated = 0
  const outputBudgets = []
  const fx = await fixture(t, {
    generate: async input => { generated++; if (generated === 2) throw new Error('temporary image error'); return { data: png, mediaType: 'image/png' } },
    runAgent: async input => {
      calls++
      outputBudgets.push(input.maxTokens)
      if (input.tools[0].name === 'submit_scene_plan') await input.onToolCall({ arguments: { plan: planFixture() } })
      else {
        assert.equal(input.tools[0].name, 'submit_image_adjustment')
        assert.equal(input.system, readSceneAdjustmentInstruction())
        const context = JSON.parse(input.messages[0].content[0].text)
        assert.equal(context.instruction, '改成雨夜')
        assert.equal(context.sources, undefined)
        assert.equal(context.characters, undefined)
        await input.onToolCall({ arguments: { update: { description: '雨夜', patches: [{ owner: 'scene', field: 'composition', text: '雨夜', tags: 'rainy night' }] } } })
      }
      return {}
    }
  })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  const first = await until(async () => { const state = await fx.service.status('parent', 2); return state.status === 'succeeded' && state })
  const options = { kind: 'adjust', versionId: first.versions[0].id, instruction: '改成雨夜' }
  const originalPlans = await fx.store.readJson(imagePath + 'plans.json')
  await fx.service.start('parent', 2, key, options)
  const failed = await until(async () => { const state = await fx.service.status('parent', 2); return state.status === 'failed' && state })
  assert.equal(failed.versions.length, 1)
  assert.ok(await fx.service.readImage('parent', 2, key, first.versions[0].id))
  await fx.service.start('parent', 2, key, { ...options, confirmNewRequestId: failed.requestId })
  const adjusted = await until(async () => { const state = await fx.service.status('parent', 2); return state.status === 'succeeded' && state })
  assert.equal(calls, 2, 'failed image retry reuses saved adjustment, not another text task')
  assert.deepEqual(outputBudgets, [undefined, undefined], 'planning and adjustment must inherit the background model output budget')
  assert.equal(adjusted.versions[1].prompt, 'rainy night')
  assert.equal(adjusted.versions[0].prompt, first.versions[0].prompt)
  await fx.service.start('parent', 2, key, { kind: 'repaint', versionId: first.versions[0].id })
  const repainted = await until(async () => { const state = await fx.service.status('parent', 2); return state.status === 'succeeded' && state })
  assert.equal(repainted.versions[2].prompt, first.versions[0].prompt)
  assert.equal(calls, 2)
  assert.deepEqual(await fx.store.readJson(imagePath + 'plans.json'), originalPlans)
})

test('another service instance cannot steal a live paid job, and switching away then back keeps its image', async t => {
  let release
  const fx = await fixture(t, { generate: () => new Promise(resolve => { release = () => resolve({ data: png, mediaType: 'image/png' }) }) })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  await until(() => release)
  const other = fx.createService()
  assert.equal((await other.status('parent', 2)).status, 'running')
  assert.equal((await other.start('parent', 2, key)).status, 'running')
  fx.chat().messages[1].swipeId = 1
  release()
  await until(async () => (await fx.store.readJson(imagePath + key + '.json')).status === 'succeeded')
  assert.equal((await other.status('parent', 2)).versions.length, 0)
  fx.chat().messages[1].swipeId = 0
  assert.equal((await other.status('parent', 2)).versions.length, 1)
  assert.ok(await other.readImage('parent', 2, key))
})

test('style saves do not charge; repaint restyles without text work, frozen jobs keep their style and canonical plans stay unchanged', async t => {
  const prompts = []
  let calls = 0, release
  const fx = await fixture(t, {
    runAgent: async input => { calls++; await input.onToolCall({ arguments: { plan: planFixture() } }); return {} },
    generate: async input => {
      prompts.push(input.prompt)
      if (prompts.length === 1) await new Promise(resolve => { release = resolve })
      return { data: png, mediaType: 'image/png' }
    }
  })
  await fx.service.configure({ style: { preset: 'watercolor', custom: '  低饱和  ' } })
  assert.equal(calls, 0)
  assert.equal(prompts.length, 0)
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  await until(() => release)
  await fx.service.configure({ style: { preset: 'ink' } })
  assert.equal((await fx.service.settings()).style.custom, '  低饱和  ', 'partial style saves retain custom text')
  release()
  const first = await until(async () => { const record = await fx.service.status('parent', 2); return record.status === 'succeeded' && record })
  assert.match(first.versions[0].prompt, /watercolor.*低饱和/)
  assert.equal(first.versions[0].configuration.style.preset, 'watercolor')
  assert.doesNotMatch(first.versions[0].prompt, /ink wash/)
  const canonical = await fx.store.readJson(imagePath + 'plans.json')
  const restarted = fx.createService()
  assert.equal((await restarted.settings()).style.preset, 'ink')
  await restarted.start('parent', 2, key, { kind: 'repaint', versionId: first.versions[0].id })
  const second = await until(async () => { const record = await restarted.status('parent', 2); return record.status === 'succeeded' && record })
  assert.match(second.versions[1].prompt, /ink wash.*低饱和/)
  assert.doesNotMatch(second.versions[1].prompt, /watercolor/)
  assert.equal(first.versions[0].prompt, second.versions[0].prompt)
  assert.equal(calls, 1, 'global style changes need no text reanalysis for the Images channel')
  assert.deepEqual(await fx.store.readJson(imagePath + 'plans.json'), canonical)
})

test('image-only style adjustment is saved only on its picture and global style wins after a settings change', async t => {
  let calls = 0
  const fx = await fixture(t, { runAgent: async input => {
    calls++
    if (input.tools[0].name === 'submit_scene_plan') await input.onToolCall({ arguments: { plan: planFixture() } })
    else await input.onToolCall({ arguments: { update: { description: '单图胶片', patches: [], style: { text: '胶片', tags: 'film grain' } } } })
    return {}
  } })
  await fx.service.configure({ style: { preset: 'watercolor' } })
  const key = sceneTarget(fx.chat(), 2).key
  const complete = () => until(async () => { const record = await fx.service.status('parent', 2); return record.status === 'succeeded' && record })
  await fx.service.start('parent', 2, key)
  const first = await complete(), id = first.versions[0].id
  const canonical = await fx.store.readJson(imagePath + 'plans.json')
  await fx.service.start('parent', 2, key, { kind: 'adjust', versionId: id, instruction: '仅这张改胶片' })
  const adjusted = await complete()
  assert.match(adjusted.versions[1].prompt, /film grain/)
  assert.doesNotMatch(adjusted.versions[1].prompt, /watercolor/)
  assert.equal((await fx.service.settings()).style.preset, 'watercolor')
  await fx.service.start('parent', 2, key, { kind: 'repaint', versionId: adjusted.versions[1].id })
  assert.match((await complete()).versions[2].prompt, /film grain/)
  await fx.service.start('parent', 2, key, { kind: 'repaint', versionId: id })
  assert.match((await complete()).versions[3].prompt, /watercolor/)
  await fx.service.configure({ style: { preset: 'ink' } })
  await fx.service.start('parent', 2, key, { kind: 'repaint', versionId: adjusted.versions[1].id })
  const changed = await complete()
  assert.match(changed.versions[4].prompt, /ink wash/)
  assert.doesNotMatch(changed.versions[4].prompt, /film grain/)
  assert.equal(calls, 2)
  assert.deepEqual(await fx.store.readJson(imagePath + 'plans.json'), canonical)
})
