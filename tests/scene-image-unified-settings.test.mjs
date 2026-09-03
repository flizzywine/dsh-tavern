import assert from 'node:assert/strict'
import test from 'node:test'
import { createImageConfiguration } from '../tavern-plugin/packages/dsh-image-gen/src/configuration.js'
import { createModuleSceneImageSettings } from '../tavern-plugin/lib/domain/scene-image-module-settings.js'
import { comfyLinkedSeedGraph } from './fixtures/scene-image-comfy-workflow.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0l8AAAAASUVORK5CYII=', 'base64')
function fixture(initial = {}, doc, options = {}) {
  let plugin = { provider: 'google', ...initial }, stored = doc
  const keys = new Map(), calls = [], writes = []
  const credentials = { resolve: async ref => keys.has(ref) ? { value: keys.get(ref) } : undefined,
    set: async (ref, value) => { keys.set(ref, value) } }
  const service = createImageConfiguration({ read: () => plugin, write: async patch => { writes.push(patch); plugin = { ...plugin, ...patch } }, credentials,
    attachments: { saveImage: async () => { if (options.failAttachment) throw new Error('disk unavailable'); return { attachmentId: 'mock-image' } } },
    fetchImpl: async (url, request) => { calls.push({ url, options: request }); if (options.fetch) return options.fetch(url, request); return Response.json(url.endsWith('/images/generations') ? { data: [{ b64_json: png.toString('base64') }] } : { api_key_disabled: false, api_key_blocked: false, team_blocked: false }) } })
  const settings = createModuleSceneImageSettings({ imageModule: service, credentials: () => credentials,
    store: { readJson: async () => stored, updateJson: async (_path, fn) => { const next = await fn(stored); if (next !== undefined) stored = next } } })
  return { service, settings, keys, calls, writes, readPlugin: () => plugin, readDoc: () => stored }
}

test('统一 UI 保存到插件，Key 只在凭据库，捕获与生图使用同一配置', async () => {
  const f = fixture()
  let ui = await f.settings.settings('grok')
  assert.equal(ui.ready, false)
  assert.ok(!ui.channels.some(x => x.id === 'dsh-image-gen'))
  ui = await f.settings.configure({ provider: 'grok', baseURL: 'https://api.x.ai/v1', model: 'grok-imagine-image-2.0', size: '2k', aspectRatio: '16:9', apiKey: 'private-key' })
  assert.equal(ui.hasKey, true)
  assert.equal(ui.enabled, false, '保存渠道配置本身不自动开启生图')
  assert.equal(f.readPlugin().grokModel, ui.model)
  assert.equal(f.keys.get('XAI_API_KEY'), 'private-key')
  assert.equal(JSON.stringify(f.readPlugin()).includes('private-key'), false)
  assert.equal(f.readDoc().providers.grok, undefined)
  assert.equal((await f.settings.configure({ provider: 'grok', enabled: true })).enabled, true)
  const snapshot = await f.settings.capture()
  assert.equal(snapshot.apiKey, 'private-key')
  assert.equal(snapshot.active.backend, 'dsh-image-gen')
  assert.equal(snapshot.active.size, '2k')
  const probe = await f.settings.testConnection({ provider: 'grok' })
  assert.equal(probe.apiKeyStatus, 'verified')
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].url, 'https://api.x.ai/v1/api-key')
  assert.equal(f.calls[0].options.method, 'GET')
  assert.equal(f.calls[0].options.headers.authorization, 'Bearer private-key')
  assert.equal(JSON.stringify(probe).includes('private-key'), false)
})

async function promptly(promise) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('configuration blocked by image HTTP')), 1000) })]) }
  finally { clearTimeout(timer) }
}

test('生图中可保存新配置，旧请求保留原地址与 Key，下一次捕获得到新配对', async () => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  const f = fixture({}, undefined, { fetch: async () => { entered.resolve(); await release.promise; return Response.json({ data: [{ b64_json: png.toString('base64') }] }) } })
  await f.settings.configure({ provider: 'grok', apiKey: 'old-key' })
  const { active, apiKey } = await f.settings.capture()
  const generation = f.service.generate({ ...active, apiKey, prompt: 'a lake', signal: new AbortController().signal, maxBytes: 1024 * 1024 })
  try {
    await promptly(entered.promise)
    await promptly(f.settings.configure({ provider: 'grok', baseURL: 'https://new.example/v1', apiKey: 'new-key' }))
    const next = await promptly(f.settings.capture())
    assert.equal(next.active.baseURL, 'https://new.example/v1')
    assert.equal(next.apiKey, 'new-key')
    assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].url, 'https://api.x.ai/v1/images/generations')
    assert.equal(f.calls[0].options.headers.authorization, 'Bearer old-key')
  } finally { release.resolve(); await generation }
})

test('等待配置锁时取消，解锁后不能开始付费请求', async () => {
  const f = fixture()
  await f.settings.configure({ provider: 'grok', apiKey: 'test-key' })
  const { active, apiKey } = await f.settings.capture()
  const gate = Promise.withResolvers()
  const lock = f.service.serial(() => gate.promise)
  const controller = new AbortController()
  const rejected = assert.rejects(f.service.generate({ ...active, apiKey, prompt: 'a lake', signal: controller.signal }), { name: 'AbortError' })
  controller.abort()
  gate.resolve()
  await lock
  await rejected
  assert.equal(f.calls.length, 0)
})

test('统一服务请求一次图片并复用附件；配置变化在付费请求前拒绝', async () => {
  const f = fixture()
  await f.settings.configure({ provider: 'grok', apiKey: 'test-key' })
  const { active, apiKey } = await f.settings.capture()
  const input = { ...active, apiKey, prompt: 'a mountain', signal: new AbortController().signal, maxBytes: 1024 * 1024 }
  const result = await f.service.generate(input)
  assert.deepEqual(result.data, png)
  assert.equal(result.attachment.attachmentId, 'mock-image')
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].options.method, 'POST')
  assert.equal(JSON.parse(f.calls[0].options.body).model, active.model)
  await f.settings.configure({ provider: 'grok', model: 'other-image-model' })
  await assert.rejects(f.service.generate(input), error => error.imageOutcome === 'not_requested')
  assert.equal(f.calls.length, 1)
})

test('插件附件写入失败仍返回已收到的图片供本地恢复，不重复请求供应商', async () => {
  const f = fixture({}, undefined, { failAttachment: true })
  await f.settings.configure({ provider: 'grok', apiKey: 'test-key' })
  const { active, apiKey } = await f.settings.capture()
  const result = await f.service.generate({ ...active, apiKey, prompt: 'a mountain', signal: new AbortController().signal, maxBytes: 1024 * 1024 })
  assert.deepEqual(result.data, png)
  assert.equal(result.attachment, undefined)
  assert.equal(f.calls.length, 1)
})

test('凭据保存失败回滚地址和模型；配置保存失败不写 Key', async () => {
  let value = { provider: 'grok', grokBaseURL: 'https://api.x.ai/v1', grokModel: 'previous', tavernChannels: '{}' }, failSettings = false, keysWritten = 0
  const before = { ...value }
  const service = createImageConfiguration({ read: () => value, write: async patch => { if (failSettings) throw new Error('settings unavailable'); value = { ...value, ...patch } },
    credentials: { resolve: async () => ({ value: 'old-key' }), set: async () => { keysWritten++; throw new Error('credential store unavailable') } } })
  await assert.rejects(service.configure({ provider: 'grok', baseURL: 'https://other.example/v1', apiKey: 'new-key' }), /已回滚/)
  assert.deepEqual(value, before)
  failSettings = true
  await assert.rejects(service.configure({ provider: 'grok', apiKey: 'another-key' }), /settings unavailable/)
  assert.equal(keysWritten, 1)
})

test('旧配置只预览；保存时迁移，不覆盖已有插件 Key 直到明确保存', async () => {
  const f = fixture({ grokBaseURL: 'https://old-plugin.example/v1', grokModel: 'plugin-model' }, { version: 2, provider: 'grok', enabled: true,
    providers: { grok: { baseURL: 'https://api.x.ai/v1', model: 'game-model', size: '1k', aspectRatio: '1:1' } } })
  f.keys.set('XAI_API_KEY', 'old-plugin-key')
  f.keys.set('DSH_TAVERN_IMAGE_GROK_API_KEY', 'old-tavern-key')
  const preview = await f.settings.settings()
  assert.equal(preview.model, 'game-model')
  assert.equal(preview.migrationPending, true)
  assert.equal(preview.enabled, true)
  assert.equal(f.writes.length, 0)
  await assert.rejects(f.settings.capture(), /迁移/)
  await f.settings.configure({ provider: 'grok', model: preview.model })
  assert.equal(f.keys.get('XAI_API_KEY'), 'old-tavern-key')
  assert.equal(f.keys.get('DSH_TAVERN_IMAGE_GROK_API_KEY'), 'old-tavern-key')
  assert.equal(f.readDoc().providers.grok, undefined)
  assert.equal((await f.settings.settings()).migrationPending, undefined)
  assert.equal(f.readPlugin().grokBaseURL, 'https://api.x.ai/v1')
})

test('旧密钥和插件密钥都不能静默发送到修改后的地址', async () => {
  const f = fixture({ grokBaseURL: 'https://api.x.ai/v1' })
  f.keys.set('XAI_API_KEY', 'existing')
  await assert.rejects(f.settings.configure({ provider: 'grok', baseURL: 'https://different.example' }), /重新填写/)
  await assert.rejects(f.settings.testConnection({ provider: 'grok', baseURL: 'https://different.example' }), /重新填写/)
  assert.equal(f.calls.length, 0)
  assert.equal(f.writes.length, 0)
})

test('开启、关闭只保存场景开关，不重写供应商配置或删除密钥', async () => {
  const f = fixture()
  await f.settings.configure({ provider: 'grok', apiKey: 'key' })
  await f.settings.configure({ provider: 'grok', enabled: true })
  const writes = f.writes.length
  await f.settings.configure({ enabled: false })
  assert.equal(f.writes.length, writes)
  assert.equal(f.keys.get('XAI_API_KEY'), 'key')
  assert.equal((await f.settings.settings()).enabled, false)
})

test('NovelAI / WebUI / Banana 等渠道保留，额外配置同样归插件持久化', async () => {
  const f = fixture()
  const ui = await f.settings.settings('webui')
  for (const id of ['webui', 'comfyui', 'novelai', 'banana', 'grok', 'gemini', 'qwen']) assert.ok(ui.channels.some(x => x.id === id))
  await f.settings.configure({ provider: 'webui', baseURL: 'http://127.0.0.1:7860', authType: 'none', size: '512x512' })
  assert.equal(JSON.parse(f.readPlugin().tavernChannels).webui.baseURL, 'http://127.0.0.1:7860')
  assert.equal((await f.settings.settings('webui')).ready, true)
  assert.equal(f.readDoc().providers.webui, undefined)
})

test('ComfyUI 保存并启用接受独立种子节点，重载后映射不丢失且不试画', async () => {
  const f = fixture()
  // Match the UI's save-then-enable RPC sequence, not an unsupported combined write.
  const saved = await f.settings.configure({ provider: 'comfyui', baseURL: 'http://127.0.0.1:8188', authType: 'none', workflow: comfyLinkedSeedGraph() })
  assert.equal(saved.ready, true)
  assert.equal(saved.enabled, false)
  const ui = await f.settings.configure({ provider: saved.provider, enabled: true })
  assert.equal(ui.ready, true)
  assert.equal(ui.enabled, true)
  assert.deepEqual(ui.workflow.bindings.seed, [{ node: '8', input: 'seed' }])
  const reloaded = fixture(JSON.parse(JSON.stringify(f.readPlugin())), JSON.parse(JSON.stringify(f.readDoc())))
  const snapshot = await reloaded.settings.capture()
  assert.deepEqual(snapshot.active.workflow.bindings.seed, [{ node: '8', input: 'seed' }])
  assert.deepEqual(snapshot.active.workflow.prompt['5'].inputs.seed, ['8', 0])
  assert.equal(f.calls.length, 0)
  assert.equal(reloaded.calls.length, 0)
})

test('模块并发保存与 capture 不混配地址和密钥', async () => {
  const f = fixture()
  await Promise.all([
    f.settings.configure({ provider: 'grok', baseURL: 'https://gateway.example/v1', apiKey: 'new-key' }),
    f.settings.capture().then(value => { assert.equal(value.active.baseURL, 'https://gateway.example/v1'); assert.equal(value.apiKey, 'new-key') }),
  ])
})
