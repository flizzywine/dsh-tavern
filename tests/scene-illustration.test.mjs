import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSceneIllustrations, sceneTarget, sceneInput } from '../tavern-plugin/lib/domain/scene-illustration.js'
import { generateSceneImage, imageSettings, validateImageDownload } from '../tavern-plugin/lib/domain/scene-image-provider.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

import { createHash } from 'node:crypto'

import { comfyGraph } from './fixtures/scene-image-comfy-workflow.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=', 'base64')
const imagePath = 'scene-images/' + createHash('sha256').update('test-chat').digest('hex') + '/'
const chatFixture = () => ({ id: 'test-chat', mode: 'story', sessionId: 'parent', settleStatus: 'done', posture: '站在窗边，左手扶窗', messages: [{ role: 'user', text: '走到窗边' }, { role: 'assistant', turn: 2, sourceText: '她站在窗边看雨。', swipes: ['她站在窗边看雨。', '她坐在椅子上。'], swipeId: 0 }] })
const planFixture = (tags = 'A woman standing at a rainy window') => ({ description: '窗边一景', subjects: [], characters: [], continuity: 'uncertain', scene: { composition: { text: '窗边一景', tags } } })

// Scripted model adapter: existing scenario fixtures are emitted through the new tools.
async function submitPlanCall(input, call) {
  const { characters = [], expressions = [], ...layout } = call.arguments.plan
  const cleanFields = fields => Object.fromEntries(Object.entries(fields || {}).map(([key, { evidence, ...value }]) => [key, value]))
  for (const { identity, ...person } of characters) {
    const result = await input.onToolCall({ name: 'submit_scene_character', arguments: { ...person, fields: cleanFields(person.fields),
      expressions: Object.fromEntries(expressions.filter(e => e.owner === person.id).map(e => [e.field, e.tags])) } })
    if (result.includes('失败') || result.includes('不得重复')) return result
  }
  const result = await input.onToolCall({ name: 'submit_scene_layout', arguments: { ...layout,
    ...(layout.scene ? { scene: cleanFields(layout.scene) } : {}),
    expressions: Object.fromEntries(expressions.filter(e => e.owner === 'scene').map(e => [e.field, e.tags])) } })
  if (result.includes('失败') || result.includes('不得重复')) return result
  return input.onToolCall({ name: 'submit_scene_plan', arguments: {} })
}

async function until(check) { for (let n = 0; n < 400; n++) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)) } throw new Error('condition timeout') }

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
    runAgent: async input => { await submitPlanCall(input, { arguments: { plan: planFixture() } }); return { traceSessionId: 'image-child' } },
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

test('interrupted draft survives service restart; matching target resumes without rewriting saved characters', async t => {
  let attempt = 0
  const fx = await fixture(t, { runAgent: async input => {
    if (++attempt === 1) {
      await input.onToolCall({ name: 'submit_scene_character', arguments: { id: 'a', name: '甲', fields: { appearance: { text: '黑发', tags: 'black hair' } } } })
      throw new Error('simulated process interruption')
    }
    const material = JSON.parse(input.messages[0].content[0].text)
    assert.deepEqual(material.draft.characters.map(person => person.id), ['a'])
    assert.equal(await fx.store.readJson(imagePath + 'plans.json'), undefined)
    const { characters, ...layout } = planFixture()
    layout.subjects = ['a']
    await input.onToolCall({ name: 'submit_scene_layout', arguments: layout })
    await input.onToolCall({ name: 'submit_scene_plan', arguments: {} })
  } })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'failed')
  assert.equal(fx.imageCalls(), 0)
  await fx.service.dispose()
  const restarted = fx.createService()
  await restarted.start('parent', 2, key)
  await until(async () => (await restarted.status('parent', 2)).status === 'succeeded')
  assert.equal(fx.imageCalls(), 1)
})

for (const change of ['body', 'configuration']) test('interrupted draft is not reused after changing ' + change, async t => {
  let attempt = 0
  const fx = await fixture(t, { runAgent: async input => {
    if (++attempt === 1) {
      await input.onToolCall({ name: 'submit_scene_character', arguments: { id: 'old', name: '旧人物', fields: {} } })
      throw new Error('simulated interruption')
    }
    assert.equal(JSON.parse(input.messages[0].content[0].text).draft, undefined)
    await submitPlanCall(input, { arguments: { plan: planFixture() } })
  } })
  await fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'failed')
  if (change === 'body') fx.chat().messages[1].swipeId = 1
  else await fx.service.configure({ model: 'another-image-model' })
  await fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'succeeded')
  assert.equal(fx.imageCalls(), 1)
  assert.equal(Object.keys((await fx.store.readJson(imagePath + 'plans.json')).characters).length, 0)
})

test('syntax errors give position, content errors give path; successful draft calls do not consume three corrections', async t => {
  const fx = await fixture(t, { runAgent: async input => {
    const malformed = await input.onToolCall({ name: 'submit_scene_character', arguments: {}, rawArguments: '{"id":"a","fields":{}}}' })
    assert.match(malformed, /JSON 语法错误.*行.*列.*附近.*剩余修正机会：3/s)
    await input.onToolCall({ name: 'submit_scene_character', arguments: { id: 'a', name: '甲', fields: {} } })
    const content = await input.onToolCall({ name: 'submit_scene_character', arguments: { id: 'a', fields: { clothing: { text: '外套', tags: [] } } } })
    assert.match(content, /fields.clothing.tags.*string.*array.*剩余修正机会：2/s)
    await input.onToolCall({ name: 'submit_scene_character', arguments: { id: 'a', fields: { clothing: { text: '外套', tags: 'coat' } } } })
    const premature = await input.onToolCall({ name: 'submit_scene_plan', arguments: {} })
    assert.match(premature, /缺少场景.*剩余修正机会：1/s)
    assert.equal(input.stopToolsWhen(), false)
    const { characters, ...layout } = planFixture()
    layout.subjects = ['a']
    await input.onToolCall({ name: 'submit_scene_layout', arguments: layout })
    assert.match(await input.onToolCall({ name: 'submit_scene_plan', arguments: {} }), /已校验保存/)
  } })
  await fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'succeeded')
  assert.equal(fx.imageCalls(), 1)
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
    runAgent: async input => { texts++; await submitPlanCall(input, { arguments: { plan: planFixture() } }) },
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
  assert.equal(ready.enabled, true, 'generation is always offered; readiness comes from the channel')
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

test('default-off, partial saves and legacy migration never cause paid requests', async t => {
  let agentCalls = 0
  const fx = await fixture(t, { runAgent: async () => { agentCalls++ } })
  await fx.store.writeJson('scene-images/settings.json', { model: 'legacy', baseURL: 'https://provider.example/v1' })
  assert.equal((await fx.service.settings()).enabled, false)
  assert.equal((await fx.service.settings()).ready, false)
  assert.equal((await fx.service.settings()).migrationPending, true)
  const target = sceneTarget(fx.chat(), 2)
  await assert.rejects(fx.service.start('parent', 2, target.key), /迁移旧生图配置/)
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
  await fx.service.configure({ enabled: true })
  assert.equal((await fx.service.settings()).enabled, true)
  assert.equal((await fx.service.settings()).ready, false)
  await assert.rejects(fx.service.start('parent', 2, target.key), /还没配置生图渠道/)
  assert.equal(agentCalls, 0)
  assert.equal(fx.imageCalls(), 0)
})

test('a channel change during planning cannot change the frozen paid request or its key', async t => {
  const keys = new Map(), generated = []
  let release, started
  const waiting = new Promise(resolve => { release = resolve })
  const began = new Promise(resolve => { started = resolve })
  t.after(() => release())
  const fx = await fixture(t, {
    credentials: () => ({ resolve: async ref => ({ value: keys.get(ref) }), set: async (ref, value) => { keys.set(ref, value) } }),
    runAgent: async input => { started(); await waiting; await submitPlanCall(input, { arguments: { plan: planFixture() } }); return {} },
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

test('saving failure is returned to the Agent as received-but-unsaved, duplicate calls cannot charge again', async t => {
  let receipt
  const fx = await fixture(t, { runAgent: async input => {
    receipt = JSON.parse(await submitPlanCall(input, { arguments: { plan: planFixture() } }))
    assert.match(await input.onToolCall({ name: 'submit_scene_plan', arguments: {} }), /不得重复/)
  } })
  const attachments = fx.deps.attachments()
  fx.deps.attachments = () => ({ ...attachments, saveImage: async () => { throw new Error('storage unavailable') } })
  await fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key)
  await until(() => receipt)
  assert.equal(receipt.ok, false)
  assert.equal(receipt.outcome, 'received')
  assert.equal(receipt.recovery, 'save')
  assert.match(receipt.instruction, /重试保存.*不要重新生图/)
  assert.equal(fx.imageCalls(), 1)
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
        await submitPlanCall(input, { arguments: { plan: planFixture() } })
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

test('initial failure plus three corrections stop before charging and preserve the concrete validation error', async t => {
  const fx = await fixture(t, { runAgent: async input => {
    await submitPlanCall(input, { arguments: { plan: {} } })
    await submitPlanCall(input, { arguments: { plan: {} } })
    await submitPlanCall(input, { arguments: { plan: {} } })
    assert.match(await submitPlanCall(input, { arguments: { plan: {} } }), /次数已用完/)
    assert.equal(input.stopToolsWhen(), true)
  } })
  await fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key)
  const status = await until(async () => { const value = await fx.service.status('parent', 2); return value.status === 'failed' && value })
  assert.match(status.error, /submit_scene_layout.description.*缺失/)
  assert.equal(fx.imageCalls(), 0)
})

test('historical source never borrows a later posture, and skipped rounds enter the next planning input', async t => {
  const chat = chatFixture(), target = sceneTarget(chat, 2)
  chat.messages.push({ role: 'assistant', turn: 3, text: '她走进室内，换了红衣。' })
  chat.posture = '未来的姿态'
  assert.equal(sceneInput(chat, target).posture, '')
  assert.equal(sceneInput(chat, target, { posture: '历史姿态' }).posture, '历史姿态')
  const inputs = []
  const fx = await fixture(t, { runAgent: async input => { inputs.push(JSON.parse(input.messages[0].content[0].text)); await submitPlanCall(input, { arguments: { plan: planFixture() } }); return {} } })
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
  const other = await fixture(t, { runAgent: async input => { await submitPlanCall(input, { arguments: { plan: planFixture('Scene') } }); throw new Error('final text failed') } })
  await other.service.start('parent', 2, sceneTarget(other.chat(), 2).key)
  await until(async () => (await other.service.status('parent', 2)).status === 'succeeded')
})

test('missing credentials/attachments reject before charging; timeout never retries automatically', async t => {
  const missing = await fixture(t, { attachments: () => undefined })
  await assert.rejects(missing.service.start('parent', 2, sceneTarget(missing.chat(), 2).key), /附件服务/)
  assert.equal(missing.imageCalls(), 0)
  let attempts = 0
  let enteredProvider
  const providerStarted = new Promise(resolve => { enteredProvider = resolve })
  const timed = await fixture(t, { timeoutMs: 300, generate: async input => {
    attempts++
    enteredProvider()
    await new Promise((resolve, reject) => { if (input.signal.aborted) reject(input.signal.reason); else input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }) })
  } })
  // Exercise the paid stage's timeout, not the speed of preceding disk/Agent work.
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await timed.service.start('parent', 2, sceneTarget(timed.chat(), 2).key)
  await providerStarted
  t.mock.timers.tick(300)
  t.mock.timers.reset()
  const status = await until(async () => { const value = await timed.service.status('parent', 2); return value.status === 'failed' && value })
  assert.match(status.error, /结果未确认.*可能已计费/)
  assert.equal(status.outcome, 'unconfirmed')
  assert.equal(attempts, 1)
})

test('repaint bypasses text Agent, retains each version and deduplicates replayed request IDs after restart', async t => {
  let agentCalls = 0
  const fx = await fixture(t, { runAgent: async input => { agentCalls++; await submitPlanCall(input, { arguments: { plan: planFixture() } }); return {} } })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  const first = await until(async () => { const state = await fx.service.status('parent', 2); return state.status === 'succeeded' && state })
  const versionId = first.versions[0].id
  assert.deepEqual(first.versions[0].configuration, { provider: 'openai', model: 'test-image', baseURL: 'https://provider.example/v1', size: '1024x1024', style: { preset: 'auto', custom: '' } })
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
    runAgent: async input => { calls++; await submitPlanCall(input, { arguments: { plan: planFixture() } }); return {} },
    generate: async input => {
      prompts.push(input.prompt)
      if (prompts.length === 1) await new Promise(resolve => { release = resolve })
      return { data: png, mediaType: 'image/png' }
    }
  })
  await fx.service.configure({ style: { preset: 'custom', custom: '  watercolor, 低饱和  ' } })
  assert.equal(calls, 0)
  assert.equal(prompts.length, 0)
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  await until(() => release)
  await fx.service.configure({ style: { orientation: 'fixed' } })
  assert.equal((await fx.service.settings()).style.custom, '  watercolor, 低饱和  ', 'partial style saves retain custom text')
  await fx.service.configure({ style: { custom: 'ink wash, 低饱和' } })
  release()
  const first = await until(async () => { const record = await fx.service.status('parent', 2); return record.status === 'succeeded' && record })
  assert.match(first.versions[0].prompt, /watercolor.*低饱和/)
  assert.equal(first.versions[0].configuration.style.custom, '  watercolor, 低饱和  ')
  assert.doesNotMatch(first.versions[0].prompt, /ink wash/)
  const canonical = await fx.store.readJson(imagePath + 'plans.json')
  const restarted = fx.createService()
  assert.equal((await restarted.settings()).style.preset, 'custom')
  await restarted.start('parent', 2, key, { kind: 'repaint', versionId: first.versions[0].id })
  const second = await until(async () => { const record = await restarted.status('parent', 2); return record.status === 'succeeded' && record })
  assert.match(second.versions[1].prompt, /ink wash.*低饱和/)
  assert.doesNotMatch(second.versions[1].prompt, /watercolor/)
  assert.equal(first.versions[0].prompt, second.versions[0].prompt)
  assert.equal(calls, 1, 'global style changes need no text reanalysis for the Images channel')
  assert.deepEqual(await fx.store.readJson(imagePath + 'plans.json'), canonical)
})

test('concurrent illustration status reads share only an in-flight chat read', async t => {
  const fx = await fixture(t)
  let reads = 0, release
  fx.deps.chatForSession = async () => { reads++; await new Promise(resolve => { release = resolve }); return structuredClone(fx.chat()) }
  const first = fx.service.status('parent', 2), second = fx.service.status('parent', 2)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 1, 'message mounts share the current read, not independent full chat loads')
  release();await Promise.all([first, second])
  fx.chat().messages[1].swipes[0] = '已修改的正文。'
  const next = fx.service.status('parent', 2)
  await new Promise(resolve => setImmediate(resolve));assert.equal(reads, 2)
  release();assert.equal((await next).key, sceneTarget(fx.chat(), 2).key, 'later reads see story edits')
})

test('native point status finds existing legacy images, including disabled generation and restored branches',async t=>{
  const fx=await fixture(t),original=structuredClone(fx.chat()),key=sceneTarget(original,2).key
  await fx.service.start('parent',2,key)
  const done=await until(async()=>{const state=await fx.service.status('parent',2);return state.status==='succeeded'&&state})
  const root=await mkdtemp(join(tmpdir(),'scene-native-images-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const db=createChatPersistence({store:createChatJournalStore({dataRoot:root,newConversations:true})})
  await db.write({...original,sceneImagesEnabled:false})
  fx.deps.sceneStateForSession=(_session,options)=>db.readSceneImageState(original.id,options)
  fx.deps.chatForSession=()=>assert.fail('image status must use point projection')
  const status=await fx.service.status('parent',2)
  assert.equal(status.enabled,true);assert.equal(status.key,key);assert.deepEqual(status.versions,done.versions)
  await fx.store.writeJson(imagePath+'references.json',{version:1,records:[{id:'existing-reference',source:{key,turn:2,versionId:done.versions[0].id},activation:{key,turn:2},person:{id:'person',name:'人物'},enabled:true}]})
  assert.equal((await fx.service.status('parent',2)).reference.bindings[0].versionId,done.versions[0].id)
  await db.update(original.id,chat=>{chat.messages[0].text='另一条分支';return chat})
  assert.deepEqual((await fx.service.status('parent',2)).versions,[])
  assert.deepEqual((await fx.service.status('parent',2)).reference.bindings,[])
  await db.update(original.id,chat=>{chat.messages[0].text=original.messages[0].text;return chat})
  assert.deepEqual((await fx.service.status('parent',2)).versions,done.versions)
})

test('after a picture of an earlier moment, the next planning input re-reads the rest of that turn', async t => {
  const inputs = []
  let moment = 'earlier'
  const fx = await fixture(t, { runAgent: async input => { inputs.push(JSON.parse(input.messages[0].content[0].text)); await submitPlanCall(input, { arguments: { plan: { ...planFixture(), moment } } }); moment = 'end'; return {} } })
  await fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'succeeded')
  fx.chat().messages.push({ role: 'assistant', turn: 3, text: '她坐下。' })
  await fx.service.start('parent', 3, sceneTarget(fx.chat(), 3).key)
  await until(async () => (await fx.service.status('parent', 3)).status === 'succeeded')
  assert.ok(inputs[1].sources.some(source => source.turn === 2 && source.id !== 'target'), 'the earlier-moment turn is resent as history')
})

test('retry after a failed image request reuses the committed plan without the text Agent', async t => {
  let agentCalls = 0, imageAttempts = 0
  const fx = await fixture(t, {
    runAgent: async input => { agentCalls++; await submitPlanCall(input, { arguments: { plan: planFixture() } }); return {} },
    generate: async () => { imageAttempts++; if (imageAttempts === 1) throw Object.assign(new Error('provider down'), { imageOutcome: 'rejected' }); return { data: png, mediaType: 'image/png' } }
  })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'failed')
  await fx.service.start('parent', 2, key)
  await until(async () => (await fx.service.status('parent', 2)).status === 'succeeded')
  assert.equal(agentCalls, 1)
  assert.equal(imageAttempts, 2)
})

test('test generation uses the saved channel once, returns the picture and keeps nothing', async t => {
  let request
  const fx = await fixture(t, { generate: async input => { request = input; return { data: png, mediaType: 'image/png' } } })
  const result = await fx.service.testGenerate()
  assert.equal(Buffer.from(result.data, 'base64').equals(png), true)
  assert.equal(result.mediaType, 'image/png')
  assert.match(request.prompt, /long black hair/)
  assert.equal((await fx.service.status('parent', 2)).status, 'idle')
})

test('auto style: each picture uses the style its plan wrote; the next plan is given it as the previous style', async t => {
  const prompts = [], inputs = []
  const fx = await fixture(t, {
    runAgent: async input => {
      const request = JSON.parse(input.messages[0].content[0].text)
      inputs.push(request)
      const plan = planFixture()
      plan.style = inputs.length === 1 ? { text: '国风厚涂', tags: 'Chinese xianxia painting' } : { text: '国风厚涂，夜色', tags: 'Chinese xianxia painting, night' }
      await submitPlanCall(input, { arguments: { plan } })
      return {}
    },
    generate: async input => { prompts.push(input.prompt); return { data: png, mediaType: 'image/png' } }
  })
  await fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key)
  const first = await until(async () => { const state = await fx.service.status('parent', 2); return state.status === 'succeeded' && state })
  assert.equal(inputs[0].styleRequest.previous, undefined)
  assert.match(prompts[0], /Visual style only[^\n]*Chinese xianxia painting$/)
  assert.equal(first.versions[0].style, '自动：国风厚涂（Chinese xianxia painting）')
  fx.chat().messages.push({ role: 'assistant', turn: 3, text: '她走进室内。' })
  await fx.service.start('parent', 3, sceneTarget(fx.chat(), 3).key)
  await until(async () => (await fx.service.status('parent', 3)).status === 'succeeded')
  assert.deepEqual(inputs[1].styleRequest.previous, { text: '国风厚涂', tags: 'Chinese xianxia painting' })
  assert.match(prompts[1], /Chinese xianxia painting, night$/)
  await fx.service.start('parent', 2, sceneTarget(fx.chat(), 2).key, { kind: 'repaint', versionId: first.versions[0].id })
  await until(async () => (await fx.service.status('parent', 2)).versions.length === 2)
  assert.match(prompts[2], /Chinese xianxia painting$/, 'repainting keeps that picture\'s own style')
})

test('replan reruns the shared Agent with a rethink request, replaces its saved plan and keeps the earlier picture as a version', async t => {
  const agents = []
  let tags = 'A woman standing at a rainy window'
  const fx = await fixture(t, { runAgent: async input => {
    agents.push({ persistent: input.persistent, resumes: typeof input.resolvePersistentSessionId === 'function', request: JSON.parse(input.messages[0].content[0].text) })
    const plan = planFixture(tags)
    if (agents.length > 1) plan.scene.composition.text = '低机位逆光特写'
    await submitPlanCall(input, { arguments: { plan } })
    return {}
  } })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  const first = await until(async () => { const state = await fx.service.status('parent', 2); return state.status === 'succeeded' && state })
  assert.equal(first.versions[0].composition, '窗边一景')
  tags = 'low angle close-up, backlit, she turns from the window'
  await fx.service.start('parent', 2, key, { kind: 'replan', versionId: first.versions[0].id })
  const second = await until(async () => { const state = await fx.service.status('parent', 2); return state.status === 'succeeded' && state.versions.length === 2 && state })
  assert.deepEqual(agents.map(item => [item.persistent, item.resumes]), [[true, true], [true, true]], 'no one-shot Agent per rethink')
  assert.equal(agents[0].request.rethink, undefined)
  assert.match(agents[1].request.rethink.instruction, /重新构思/)
  assert.equal(agents[1].request.rethink.rejected.composition, '窗边一景')
  assert.match(second.versions[1].prompt, /^low angle close-up/)
  assert.match(second.versions[0].prompt, /^A woman standing/)
  const plans = await fx.store.readJson(imagePath + 'plans.json')
  assert.match(Object.values(plans.frames[key])[0].prompt, /^low angle close-up/, 'the turn keeps the rethought plan')
  await fx.service.start('parent', 2, key, { kind: 'repaint', versionId: second.versions[1].id })
  const third = await until(async () => { const state = await fx.service.status('parent', 2); return state.status === 'succeeded' && state.versions.length === 3 && state })
  assert.equal(agents.length, 2, 'repaint still skips the Agent')
  assert.match(third.versions[2].prompt, /^low angle close-up/)
})

test('a hand-edited prompt repaints without the Agent and leaves the turn plan alone', async t => {
  let agents = 0
  const prompts = []
  const fx = await fixture(t, {
    runAgent: async input => { agents++; await submitPlanCall(input, { arguments: { plan: planFixture('A woman standing at a rainy window') } }); return {} },
    generate: async input => { prompts.push(input.prompt); return { data: png, mediaType: 'image/png' } },
  })
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  const first = await until(async () => { const state = await fx.service.status('parent', 2); return state.status === 'succeeded' && state })
  assert.match(first.versions[0].planPrompt, /^A woman standing/)
  assert.equal(first.versions[0].style, '自动（未写画风）')
  await assert.rejects(fx.service.start('parent', 2, key, { kind: 'prompt', versionId: first.versions[0].id, prompt: '  ' }), /提示词须为/)
  await fx.service.start('parent', 2, key, { kind: 'prompt', versionId: first.versions[0].id, prompt: 'dutch angle, she slams the window shut' })
  const second = await until(async () => { const state = await fx.service.status('parent', 2); return state.status === 'succeeded' && state.versions.length === 2 && state })
  assert.equal(agents, 1)
  assert.match(prompts[1], /^dutch angle, she slams the window shut/)
  assert.equal(second.versions[1].planPrompt, 'dutch angle, she slams the window shut')
  assert.equal(second.versions[1].description, first.versions[0].description)
  const plans = await fx.store.readJson(imagePath + 'plans.json')
  assert.match(Object.values(plans.frames[key])[0].prompt, /^A woman standing/)
})

test('history lists pictures across games by chat id, reads and removes them without resolving a session', async t => {
  const fx = await fixture(t)
  const key = sceneTarget(fx.chat(), 2).key
  await fx.service.start('parent', 2, key)
  const first = await until(async () => { const state = await fx.service.status('parent', 2); return state.status === 'succeeded' && state })
  await fx.service.start('parent', 2, key, { kind: 'repaint', versionId: first.versions[0].id })
  const second = await until(async () => { const state = await fx.service.status('parent', 2); return state.status === 'succeeded' && state.versions.length === 2 && state })
  let items = await fx.service.history()
  assert.deepEqual(items.map(item => [item.chatId, item.key, item.turn, item.deleted, item.versions.length]), [['test-chat', key, 2, true, 2]])
  fx.deps.chatSummaries = async () => [{ id: 'test-chat', cardName: '段莹莹', title: '晨起' }]
  items = await fx.service.history()
  assert.deepEqual([items[0].cardName, items[0].title, items[0].deleted], ['段莹莹', '晨起', false])
  fx.deps.chatForSession = async () => { throw new Error('session closed') }
  assert.deepEqual((await fx.service.readStoredImage('test-chat', key, second.versions[0].id)).data, png)
  await assert.rejects(fx.service.readStoredImage('test-chat', '../plans', second.versions[0].id), /图片地址不合法/)
  const results = await fx.service.removeStoredImages([{ chatId: 'test-chat', key, versionId: second.versions[0].id }, { chatId: 'test-chat', key, versionId: 'missing' }])
  assert.deepEqual(results.map(row => row.ok), [true, false])
  const record = await fx.store.readJson(imagePath + key + '.json')
  assert.deepEqual(record.versions.map(item => item.id), [second.versions[1].id])
  assert.equal(record.deletedVersions.length, 1)
  assert.equal((await fx.service.history())[0].versions.length, 1)
})
