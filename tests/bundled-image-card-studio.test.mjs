import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { imagePluginFixture, IMAGE_PNG as PNG, imageJson as json } from './fixtures/image-plugin-runtime.mjs'
import { cardSelection } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/card-app/generation.js'
import { createCardGallery } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/card-app/gallery.js'
import { createCardWorldbook } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/card-app/worldbook.js'

const b64 = PNG.toString('base64'), dataUrl = 'data:image/png;base64,' + b64
const png = () => new Response(PNG, { headers: { 'content-type': 'image/png' } })
const own = { agent: { session: { id: 'card-session-a' } } }
const channel = (provider, options = {}, extra = {}) => ({ id: provider, provider, name: provider, model: 'user-model', baseUrl: 'https://images.test/' + provider, apiKey: 'PRIVATE_KEY', options, ...extra })

async function studio(t, options = {}) {
  const tools = new Map(), scopes = [], skills = [], galleries = []
  let registered
  const complete = new Promise(resolve => { registered = resolve })
  const fixture = await imagePluginFixture(t, { definitions: { characters: [], outfits: [] }, ...options,
    tools: { register(tool) { tools.set(tool.name, tool); if (tools.size === 5) registered(); return () => tools.delete(tool.name) } },
    tavern: { toolModes(value) { scopes.push(value); return () => {} }, skillSource(value) { skills.push(value); return () => {} },
      registerGalleryProvider(value) { galleries.push(value); return () => {} }, ...options.tavern },
  })
  const runtime = await fixture.start()
  await complete
  return { ...fixture, runtime, tools, scopes, skills, galleries }
}

test('workbench tools are scoped to card mode and do not install a global prompt or probe channels', async t => {
  let calls = 0
  const f = await studio(t)
  globalThis.fetch = async () => { calls++; throw new Error('should stay local') }
  const config = await f.tools.get('read_image_config').execute({})
  assert.equal(f.scopes.length, 5)
  assert.ok(f.scopes.every(item => item.modes.join() === 'card'))
  assert.ok(config.channels.some(item => item.provider === 'atlascloud'))
  assert.doesNotMatch(JSON.stringify(config), /PRIVATE|TEST_SECRET/)
  assert.equal(calls, 0)
  const state = await f.runtime.request('/dsh-tavern-gen/api/state')
  assert.equal(state.status, 200, JSON.stringify(state.body))
  assert.ok(state.body.worldbook.revision)
  assert.equal(state.body.characters.characters.length, 0, 'a fresh install works before definitions.json exists')
  assert.doesNotMatch(JSON.stringify(state.body), /TEST_SECRET/)
  const referenceRoot = join(f.pluginRoot, 'skills/image-prompt/references')
  assert.match(await readFile(join(referenceRoot, 'INDEX.md'), 'utf8'), /generated\/rule-/)
  f.runtime.close()
  assert.equal(f.tools.size, 0)
})

test('all built-in and custom protocols run from the card tool through the shared job engine', { timeout: 45000 }, async t => {
  const protocols = ['novelai', 'openai', 'gemini', 'gemini-chat', 'grok', 'seedream', 'qwen', 'atlascloud', 'sdwebui']
  const channels = protocols.flatMap(protocol => [
    ...(protocol === 'atlascloud' ? [] : [channel(protocol, { pollIntervalMs: 1 })]),
    channel('custom', { apiProtocol: protocol, pollIntervalMs: 1, sizeMode: 'none' }, { id: 'custom-' + protocol, name: 'custom-' + protocol, baseUrl: 'https://images.test/custom-' + protocol }),
  ])
  const f = await studio(t, { config: { imageBackend: 'openai', activeImageChannel: 'openai', imageChannels: channels } })
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input), provider = url.pathname.split('/')[1], protocol = provider.replace('custom-', '')
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
    calls.push({ protocol, method: init.method || 'GET', body, headers: init.headers })
    if (protocol === 'novelai') return png()
    if (protocol === 'gemini') return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64 } }] } }] })
    if (protocol === 'gemini-chat') return json({ choices: [{ message: { content: dataUrl } }] })
    if (protocol === 'sdwebui') return json({ images: [b64] })
    if (protocol === 'qwen') return json({ output: { choices: [{ message: { content: [{ image: dataUrl }] } }] } })
    if (protocol === 'atlascloud') return json({ code: 200, data: { id: 'atlas-task', status: 'completed', outputs: [dataUrl] } })
    return json({ data: [{ b64_json: b64 }] })
  }
  for (const item of channels) {
    const result = await f.tools.get('gen_image').execute({ channel: item.id, prompt: 'one adult traveler beside a window' }, own)
    assert.equal(result.ok, true, item.id)
    assert.equal(result.images.length, 1, item.id)
    assert.match(result.images[0].url, /^\/dsh-tavern-gen\/img\//)
    const history = await f.runtime.request('job-detail?id=' + result.images[0].jobId)
    assert.equal(history.body.job.state, 'done', item.id)
    assert.equal(history.body.job.channelId, item.id, item.id)
  }
  assert.equal(calls.filter(item => item.method === 'POST').length, channels.length, 'one paid POST per image')
  assert.equal((await f.runtime.request('state')).body.config.activeImageChannel, 'openai')
  assert.equal((await f.galleries[0].list({ sessionId: 'card-session-a' })).length, channels.length)
  assert.deepEqual(await f.galleries[0].list({ sessionId: 'other-card' }), [])
  const first = (await f.galleries[0].list({ sessionId: 'card-session-a' }))[0]
  assert.equal(await f.galleries[0].remove({ sessionId: 'other-card', id: first.id }), false)
  assert.equal(await f.galleries[0].remove({ sessionId: 'card-session-a', id: first.id }), true)
  assert.equal((await f.galleries[0].list({ sessionId: 'card-session-a' })).length, channels.length - 1)
})

test('no-auth and Basic channels work, Chinese prose survives, and capability errors precede submission', async t => {
  const channels = [channel('sdwebui', {}, { apiKey: '', authMode: 'none' }), channel('openai', {}, { apiKey: '', authMode: 'basic', username: 'local', password: 'secret-pass' })]
  const f = await studio(t, { config: { imageBackend: 'sdwebui', activeImageChannel: 'sdwebui', imageChannels: channels } })
  const calls = []
  globalThis.fetch = async (_input, init) => { calls.push(init); return json(init.body && JSON.parse(init.body).sampler_name ? { images: [b64] } : { data: [{ b64_json: b64 }] }) }
  await f.tools.get('gen_image').execute({ prompt: 'one traveler', seed: 42, seed_control: 'fixed' }, own)
  assert.equal(calls[0].headers.authorization, undefined)
  assert.equal(JSON.parse(calls[0].body).seed, 42)
  const result = await f.tools.get('gen_image').execute({ channel: 'openai', prompt: '成年旅人站在窗旁。窗外下着雨，室内是暖色灯光。' }, own)
  assert.equal(result.promptMode, 'natural')
  assert.match(JSON.parse(calls[1].body).prompt, /成年旅人站在窗旁/)
  assert.equal(calls[1].headers.authorization, 'Basic ' + Buffer.from('local:secret-pass').toString('base64'))
  await f.tools.get('gen_image').execute({ prompt: 'one traveler', count: 2, seed_control: 'increment' }, own)
  await f.tools.get('gen_image').execute({ prompt: 'one traveler', seed_control: 'decrement' }, own)
  await f.tools.get('gen_image').execute({ prompt: 'one traveler', seed_control: 'fixed' }, own)
  assert.deepEqual(calls.slice(2).map(call => JSON.parse(call.body).seed), [43, 44, 43, 43])
  await assert.rejects(f.tools.get('gen_image').execute({ channel: 'openai', prompt: 'p', seed: 4 }, own), /不提供种子/)
  await assert.rejects(f.tools.get('gen_image').execute({ channel: 'openai', prompt: 'p', sampler: 'Euler' }, own), /不支持临时采样器/)
  await assert.rejects(f.tools.get('gen_image').execute({ prompt: 'p', count: 1.5 }, own), /整数/)
  assert.equal(calls.length, 6)
})

test('card ComfyUI uses the existing imported workflow, seed, dimensions and authenticated job tracking', async t => {
  const graph = { format: 'dsh-tavern-comfy-v1', name: 'card workflow', outputNode: '5', prompt: {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'old positive' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative' } },
    '3': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 1024, batch_size: 3 } },
    '4': { class_type: 'KSampler', inputs: { seed: 1, steps: 2, cfg: 3 } },
    '5': { class_type: 'SaveImage', inputs: { images: ['4', 0] } },
  }, bindings: { positive: [{ node: '1', input: 'text' }], negative: [{ node: '2', input: 'text' }], seed: [{ node: '4', input: 'seed' }], size: [{ node: '3' }] } }
  const f = await studio(t, { config: { imageBackend: 'comfyui', comfyMode: 'workflow', comfyUrl: 'http://127.0.0.1:8188', comfyAuthMode: 'basic', comfyAuthUser: 'local', comfyAuthPass: 'password',
    queryThrottleMs: 1, defaultWorkflow: 'card', workflows: [{ id: 'card', label: 'card workflow', file: 'workflows/card.json' }] }, files: { 'workflows/card.json': graph } })
  let submitted, posts = 0
  globalThis.fetch = async (input, init = {}) => {
    assert.equal(init.headers.authorization, 'Basic ' + Buffer.from('local:password').toString('base64'))
    const url = new URL(input)
    if (url.pathname === '/prompt') { posts++; submitted = JSON.parse(init.body); return json({ prompt_id: submitted.prompt_id }) }
    if (url.pathname.startsWith('/history/')) return json({ [submitted.prompt_id]: { status: { status_str: 'success', completed: true }, outputs: { '5': { images: [{ filename: 'result.png', type: 'output' }] } } } })
    if (url.pathname === '/view') return png()
    if (url.pathname === '/queue') return json({ queue_running: [], queue_pending: [] })
    return json({})
  }
  const result = await f.tools.get('gen_image').execute({ prompt: 'one traveler', seed: 27, seed_control: 'fixed' }, own)
  assert.equal(result.ok, true)
  assert.equal(posts, 1)
  assert.equal(submitted.prompt['4'].inputs.seed, 27)
  assert.equal(submitted.prompt['3'].inputs.width, 768)
  assert.equal(submitted.prompt['3'].inputs.height, 1024)
  assert.equal(submitted.prompt['3'].inputs.batch_size, 1)
  assert.equal(result.images[0].seed, 27)
})

test('card reference mode uses paired library images and rejects unsupported references before a paid POST', async t => {
  const f = await studio(t, { config: { imageBackend: 'openai', activeImageChannel: 'openai', imageChannels: [channel('openai'), channel('novelai')], promptMode: 'structured' } })
  const upload = await f.runtime.request('reference-image', { data: b64, mediaType: 'image/png', name: 'paired.png' })
  const state = (await f.runtime.request('state')).body
  const definitions = { ...state.definitions, characters: [{ id: 'person', name: '林月', outfits: [{ id: 'coat', name: '大衣', characterOutfitImage: upload.body.referenceImage }] }] }
  assert.equal((await f.runtime.request('definitions', { definitions })).status, 200)
  let calls = 0
  globalThis.fetch = async (input, init) => {
    calls++
    assert.match(String(input), /images\/edits$/)
    assert.ok(init.body instanceof FormData)
    assert.equal(init.body.getAll('image[]').length, 1)
    assert.match(init.body.get('prompt'), /角色×服装/)
    return json({ data: [{ b64_json: b64 }] })
  }
  const result = await f.tools.get('gen_image').execute({ prompt: '【人物与表情】\n林月平静地看着窗外。', generation_mode: 'reference', subjects: [{ characterId: 'person', outfitId: 'coat' }] }, own)
  assert.equal(result.ok, true)
  await assert.rejects(f.tools.get('gen_image').execute({ channel: 'novelai', prompt: 'one traveler', generation_mode: 'reference', subjects: [{ characterId: 'person' }] }, own), /不支持参考图/)
  assert.equal(calls, 1)
})

test('workbench saves share the live definitions store and reject stale versions and cross-origin writes', async t => {
  const f = await studio(t, { definitions: { characters: [{ id: 'a', name: '原来的名字', traits: { face: '保留外貌' }, outfits: [] }], outfits: [{ id: 'coat', name: '大衣', body: '保留衣服' }] }, config: { comfyAuthToken: 'PRIVATE_COMFY_TOKEN', comfyAuthPass: 'PRIVATE_COMFY_PASSWORD' } })
  const old = (await f.runtime.request('/dsh-tavern-gen/api/state')).body
  assert.doesNotMatch(JSON.stringify(old), /PRIVATE_COMFY/)
  const next = structuredClone(old.characters)
  next.characters[0].name = '工作台改名'
  assert.equal((await f.runtime.request('/dsh-tavern-gen/api/save', { target: 'characters', content: next })).status, 200)
  assert.equal((await f.tools.get('read_character').execute({ name: 'a' })).name, '工作台改名')
  const stale = await f.runtime.request('definitions', { definitions: old.characters })
  assert.equal(stale.status, 409)
  assert.equal((await f.runtime.request('/dsh-tavern-gen/api/save', { target: 'outfits', content: old.outfits })).status, 409)
  assert.equal((await f.runtime.request('state')).body.definitions.outfits[0].body, '保留衣服')
  const hostile = await f.runtime.request('/dsh-tavern-gen/api/gallery-clear', {}, 'POST', { origin: 'https://evil.invalid' })
  assert.equal(hostile.status, 403)
  assert.equal((await f.runtime.request('/dsh-tavern-gen/api/tools-enabled', { enabled: false })).body.enabled, false)
  assert.equal(f.tools.size, 0)
  assert.equal((await f.runtime.request('/dsh-tavern-gen/api/tools-enabled', { enabled: true })).body.enabled, true)
  assert.equal(f.tools.size, 5)
})

test('partial batches retain generated pictures and stop after one definitive failure', async t => {
  const f = await studio(t, { config: { imageBackend: 'openai', activeImageChannel: 'openai', imageChannels: [channel('openai')] } })
  let calls = 0
  globalThis.fetch = async () => ++calls === 1 ? json({ data: [{ b64_json: b64 }] }) : json({ error: 'quota reached' }, 400)
  const result = await f.tools.get('gen_image').execute({ prompt: 'one traveler', count: 4 }, own)
  assert.equal(result.ok, false)
  assert.equal(result.images.length, 1)
  assert.equal(calls, 2)
  assert.equal((await f.galleries[0].list({ sessionId: 'card-session-a' })).length, 1)
})

test('card requests and story images share the configured concurrency limit', async t => {
  const f = await studio(t, { config: { imageBackend: 'openai', activeImageChannel: 'openai', imageChannels: [channel('openai')], imageConcurrency: 1 } })
  let active = 0, peak = 0, calls = 0
  const releases = []
  globalThis.fetch = async () => {
    calls++; peak = Math.max(peak, ++active)
    return new Promise(resolve => releases.push(() => { active--; resolve(json({ data: [{ b64_json: b64 }] })) }))
  }
  const ordinary = await f.runtime.request('jobs', { tag: 'one story image', key: 'ordinary' })
  const cards = Promise.all([f.tools.get('gen_image').execute({ prompt: 'card one' }, own), f.tools.get('gen_image').execute({ prompt: 'card two' }, own)])
  for (let index = 0; index < 3; index++) {
    for (let i = 0; releases.length < 1 && i < 400; i++) await new Promise(resolve => setTimeout(resolve, 5))
    assert.ok(releases.length, 'next queued image reaches the shared transport')
    assert.equal(active, 1)
    releases.shift()()
  }
  assert.ok((await cards).every(result => result.ok))
  assert.equal((await f.runtime.terminal(ordinary.body.id)).state, 'done')
  assert.equal(peak, 1)
  assert.equal(calls, 3)
})

test('tool cancellation stops local waiting and never retries an accepted ambiguous request', async t => {
  const f = await studio(t, { config: { imageBackend: 'openai', activeImageChannel: 'openai', imageChannels: [channel('openai')] } })
  let submitted, calls = 0
  const started = new Promise(resolve => { submitted = resolve })
  globalThis.fetch = async (_url, init) => { calls++; submitted(); return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })) }
  const controller = new AbortController()
  const pending = f.tools.get('gen_image').execute({ prompt: 'one traveler' }, { ...own, signal: controller.signal })
  await started
  controller.abort(new Error('stop card tool'))
  await assert.rejects(pending)
  assert.equal(calls, 1)
  const jobs = (await f.runtime.request('history')).body.jobs
  assert.equal(jobs[0].state, 'cancelled')
  assert.equal(jobs[0].requestMayHaveSucceeded, true)
})

test('selection detects ambiguous names and leaves global config unchanged', () => {
  const config = { imageBackend: 'comfyui', imageChannels: [channel('openai', {}, { id: 'a', name: 'relay alpha' }), channel('openai', {}, { id: 'b', name: 'relay beta' })], stylePresets: [] }
  assert.throws(() => cardSelection(config, [], { channel: 'relay' }), /不唯一/)
  const before = structuredClone(config)
  assert.equal(cardSelection(config, [], { channel: 'b' }).config.activeImageChannel, 'b')
  assert.deepEqual(config, before)
})

test('gallery writes do not lose concurrent additions and remove compares stable IDs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'card-gallery-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'output.png'); await writeFile(file, PNG)
  const gallery = createCardGallery(join(root, 'gallery'))
  await Promise.all(Array.from({ length: 20 }, (_, i) => gallery.add({ jobId: 'job-' + i, file, mediaType: 'image/png' }, { sessionId: 'a' })))
  assert.equal((await gallery.list('a')).length, 20)
  assert.equal(await gallery.remove('job-3', 'a'), true)
  assert.equal((await gallery.list('a')).length, 19)
  assert.equal(await gallery.remove('job-4', 'b'), false)
  await assert.rejects(gallery.file('../output.png'))
})

test('worldbook projections preserve Unicode identities, reject stale saves and never replace malformed user books', async t => {
  const root = await mkdtemp(join(tmpdir(), 'card-worldbook-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const initial = { buckets: [{ id: 'rules', label: '规则', entries: [{ id: '角色甲', title: '甲', content: '甲规则', mode: 'always' }, { id: '角色乙', title: '乙', content: '乙规则', mode: 'always' }] }] }
  await writeFile(join(root, 'card-worldbook.default.json'), JSON.stringify(initial))
  const store = createCardWorldbook(root), book = await store.load()
  assert.equal((await readdir(join(root, 'skills/image-prompt/references/generated'))).filter(file => file.endsWith('.md')).length, 2)
  const edited = structuredClone(book); edited.buckets[0].entries[0].content = '新规则'
  await store.save(edited)
  await assert.rejects(store.save(book), { code: 'REVISION_CONFLICT' })
  const invalid = await store.load(); invalid.buckets[0].id = '../outside'
  await assert.rejects(store.save(invalid), /分册 ID/)
  await writeFile(join(root, 'card-worldbook.json'), '{ broken JSON')
  await assert.rejects(createCardWorldbook(root).load())
  assert.equal(await readFile(join(root, 'card-worldbook.json'), 'utf8'), '{ broken JSON')
})
