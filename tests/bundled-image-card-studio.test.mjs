import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir, copyFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, request as httpRequest } from 'node:http'
import { imagePluginFixture, IMAGE_PNG as PNG, imageJson as json } from './fixtures/image-plugin-runtime.mjs'
import { cardSelection } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/card-app/generation.js'
import { createCardGallery } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/card-app/gallery.js'
import { createCardWorldbook } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/card-app/worldbook.js'
import { imageDimensions } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-output.js'
import { expandRosterCalls } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'

const b64 = PNG.toString('base64'), dataUrl = 'data:image/png;base64,' + b64
const png = () => new Response(PNG, { headers: { 'content-type': 'image/png' } })
const own = { agent: { session: { id: 'card-session-a' } } }
// 测试里需要「一次拿到图」的地方走异步提交和查询，
// 返回结构和原来的同步工具保持一致（ok / images / channel / preset），断言不必逐条重写。
async function draw(f, args, exec = own) {
  const submitted = await f.tools.get('gen_image_submit').execute(args, exec)
  const jobIds = submitted.jobs.map(item => item.jobId)
  const found = new Map(), pending = new Set(jobIds)
  while (pending.size) {
    const part = await f.tools.get('gen_image_status').execute({ jobIds: [...pending], wait: 10 }, exec)
    for (const job of part.jobs) if (['done', 'failed', 'cancelled', 'uncertain', 'unknown'].includes(job.state)) { found.set(job.jobId, job); pending.delete(job.jobId) }
    if (part.jobs.every(job => !['done', 'failed', 'cancelled', 'uncertain', 'unknown'].includes(job.state))) break
  }
  const state = { jobs: jobIds.map(id => found.get(id) || { jobId: id, state: 'pending' }) }
  const done = state.jobs.filter(item => item.markdown), rest = state.jobs.filter(item => !item.markdown)
  const images = done.map(item => Object.fromEntries(Object.entries({
    url: item.url, markdown: item.markdown, jobId: item.jobId, seed: item.seed, size: item.size, preset: item.preset,
    prompt: item.prompt, negative: item.negative, characters: item.characters,
  }).filter(([, value]) => value !== undefined)))
  return Object.fromEntries(Object.entries({
    ok: !rest.length && images.length === jobIds.length, images, jobs: state.jobs,
    channel: submitted.channel, promptMode: submitted.promptMode, preset: submitted.preset, raw: state,
    ...(rest.length ? { error: rest[0].error || '生图未完成' } : {}),
  }).filter(([, value]) => value !== undefined))
}
const channel = (provider, options = {}, extra = {}) => ({ id: provider, provider, name: provider, model: 'user-model', baseUrl: 'https://images.test/' + provider, apiKey: 'PRIVATE_KEY', options, ...extra })

async function studio(t, options = {}) {
  const tools = new Map(), scopes = [], skills = [], galleries = []
  let registered
  const complete = new Promise(resolve => { registered = resolve })
  const fixture = await imagePluginFixture(t, { definitions: { characters: [], outfits: [] }, ...options,
    tools: { register(tool) { tools.set(tool.name, tool); if (tools.size === 7) registered(); return () => tools.delete(tool.name) } },
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
  assert.equal(f.scopes.length, 7)
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

test('card tool returns reachable absolute image Markdown on CLI HTTP, including alternate and desktop origins', async t => {
  let origin, calls = 0
  const f = await studio(t, { webOrigin: () => { if (!origin) throw new Error('not listening'); return origin },
    config: { imageBackend: 'openai', activeImageChannel: 'openai', imageChannels: [channel('openai')] } })
  globalThis.fetch = async () => { calls++; return json({ data: [{ b64_json: b64 }] }) }
  const tool = f.tools.get('gen_image_submit')
  await assert.rejects(tool.execute({ prompt: 'one traveler' }, own), { code: 'NOT_CONFIGURED' })
  assert.equal(calls, 0, 'origin failures must stop before a paid submission')
  const serve = () => createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    const handler = f.runtime.routes.get(path) || [...f.runtime.routes].find(([prefix]) => path.startsWith(prefix + '/'))?.[1]
    if (!handler) { res.writeHead(404); res.end(); return }
    Promise.resolve(handler(req, res)).catch(error => { res.writeHead(500); res.end(error.message) })
  })
  const servers = [serve(), serve()]
  t.after(async () => { for (const server of servers) { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)) } })
  for (const server of servers) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = 'http://127.0.0.1:' + servers[0].address().port
  const result = await draw(f, { prompt: 'one traveler' }, own), image = result.images[0]
  assert.equal(new URL(image.url).origin, origin)
  assert.equal(image.markdown, `![图片](${image.url})`)
  assert.equal(typeof result.preset, 'string', '预设字段必须是名字字符串：写进画廊的对象会让整页渲染崩掉')
  assert.ok(f.tools.get('gen_image_status').output.render({}, result.raw)[0].text.includes(image.markdown))
  const read = (url, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const request = httpRequest(url, { method, headers }, response => {
      const parts = []; response.on('data', part => parts.push(part)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(parts) }))
    }); request.on('error', reject); request.end()
  })
  for (const from of ['http://localhost:' + servers[0].address().port, 'dsh-app://app']) {
    const response = await read(image.url, { origin: from, 'sec-fetch-site': 'cross-site' })
    assert.equal(response.status, 200)
    assert.deepEqual(response.bytes, PNG)
    assert.equal(response.headers['access-control-allow-origin'], undefined, 'embedding does not open cross-origin API reads')
  }
  const head = await read(image.url, {}, 'HEAD')
  assert.equal(head.status, 200); assert.equal(head.bytes.length, 0)
  assert.equal(Number(head.headers['content-length']), PNG.length)
  const range = await read(image.url, { range: 'bytes=0-7' })
  assert.equal(range.status, 206); assert.deepEqual(range.bytes, PNG.subarray(0, 8))
  assert.equal((await read(image.url, {}, 'DELETE')).status, 405)
  assert.equal((await read(origin + '/dsh-tavern-gen/img/not-a-gallery-file.png')).status, 404)
  assert.equal((await read(origin + '/dsh-tavern-gen/api/gallery', { origin: 'https://evil.invalid', 'sec-fetch-site': 'cross-site' })).status, 403)
  origin = 'http://127.0.0.1:' + servers[1].address().port
  const next = await draw(f, { prompt: 'second traveler' }, own)
  assert.equal(new URL(next.images[0].url).origin, origin, 'read the current listener address for each tool call')
  assert.equal((await read(next.images[0].url)).status, 200)
  assert.ok((await f.runtime.request('/dsh-tavern-gen/api/gallery')).body.items.every(item => item.url.startsWith('/')), 'saved gallery paths survive port changes')
  assert.equal(calls, 2)
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
    const result = await draw(f, { channel: item.id, prompt: 'one adult traveler beside a window' }, own)
    assert.equal(result.ok, true, item.id)
    assert.equal(result.images.length, 1, item.id)
    assert.match(result.images[0].url, /^http:\/\/127\.0\.0\.1:31867\/dsh-tavern-gen\/img\//)
    assert.equal(result.images[0].markdown, `![图片](${result.images[0].url})`)
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result, item.id + ' 的返回对象必须能无损序列化成 JSON')
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
  await draw(f, { prompt: 'one traveler', seed: 42, seed_control: 'fixed' }, own)
  assert.equal(calls[0].headers.authorization, undefined)
  assert.equal(JSON.parse(calls[0].body).seed, 42)
  const result = await draw(f, { channel: 'openai', prompt: '成年旅人站在窗旁。窗外下着雨，室内是暖色灯光。' }, own)
  assert.equal(result.promptMode, 'natural')
  assert.match(JSON.parse(calls[1].body).prompt, /成年旅人站在窗旁/)
  assert.equal(calls[1].headers.authorization, 'Basic ' + Buffer.from('local:secret-pass').toString('base64'))
  await draw(f, { prompt: 'one traveler', count: 2, seed_control: 'increment' }, own)
  await draw(f, { prompt: 'one traveler', seed_control: 'decrement' }, own)
  await draw(f, { prompt: 'one traveler', seed_control: 'fixed' }, own)
  assert.deepEqual(calls.slice(2).map(call => JSON.parse(call.body).seed), [43, 44, 43, 43])
  await assert.rejects(draw(f, { channel: 'openai', prompt: 'p', seed: 4 }, own), /不提供种子/)
  await assert.rejects(draw(f, { channel: 'openai', prompt: 'p', sampler: 'Euler' }, own), /不支持临时采样器/)
  await assert.rejects(draw(f, { prompt: 'p', count: 1.5 }, own), /整数/)
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
  const result = await draw(f, { prompt: 'one traveler', seed: 27, seed_control: 'fixed' }, own)
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
  const result = await draw(f, { prompt: '【人物与表情】\n林月平静地看着窗外。', generation_mode: 'reference', subjects: [{ characterId: 'person', outfitId: 'coat' }] }, own)
  assert.equal(result.ok, true)
  await assert.rejects(draw(f, { channel: 'novelai', prompt: 'one traveler', generation_mode: 'reference', subjects: [{ characterId: 'person' }] }, own), /不支持参考图/)
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
  assert.equal(f.tools.size, 7)
})

test('read_character gives the macro instead of traits and full traits only on request', async t => {
  const definitions = {
    characters: [{ id: 'c1', name: '春雪', match: 'Chun Xue', traits: { face: '银白长发，蓝绿色眼睛' }, outfits: [{ id: 'o1', name: '白裙', default: true, upper: '白色吊带', lower: '白色长裙摆' }] }],
    outfits: [],
  }
  const f = await studio(t, { definitions })
  const read = f.tools.get('read_character')
  // 默认：人物块换成宏，服装照旧给正文，由模型自己挑、自己整块照写。
  const brief = await read.execute({ name: '春雪' })
  assert.equal(brief.name, '春雪')
  assert.equal(brief.traits, undefined)
  assert.equal(brief.outfitMacro, undefined)
  assert.equal(brief.outfits[0].upper, '白色吊带')
  assert.equal(brief.outfits[0].lower, '白色长裙摆')
  // 宏体只能是 ${ 与 }$ 之间的一层键值对：多一层花括号会让引擎 JSON.parse 失败，整段宏被静默删掉。
  // name 用人物库里的英文别名，跟游玩模式一致：中文名在 allowChinesePrompt 关闭时会被清掉。
  assert.equal(brief.macroName, 'Chun Xue')
  assert.match(brief.macro, /^\$\{"name":"Chun Xue","angle":"from front","upperBody":"sfw","lowerBody":"sfw"\}\$$/)
  assert.equal(brief.macro.includes('{{'), false)
  const expanded = expandRosterCalls(brief.macro, { characters: definitions.characters }, 'replace', { style: 'tag' })
  assert.equal(expanded.includes('${'), false)
  assert.ok(expanded.trim().length > 0)
  assert.match(expanded, /银白长发/)
  // 衣服是模型照 outfits 正文写进串里的，跟宏拼起来照样能出对的衣服。
  const withOutfit = expandRosterCalls(brief.macro + ', ' + brief.outfits[0].upper, { characters: definitions.characters }, 'replace', { style: 'tag' })
  assert.equal(withOutfit.includes('${'), false)
  assert.match(withOutfit, /白色吊带/)
  // full 只服务于改外貌：给 traits 原文，不给宏。
  const full = await read.execute({ name: '春雪', full: true })
  assert.equal(full.traits.face, '银白长发，蓝绿色眼睛')
  assert.equal(full.macro, undefined)
  assert.equal(full.outfits[0].upper, '白色吊带')
})

test('read_image_config lists presets by name only and expands one on request', async t => {
  const f = await studio(t, {
    config: {
      imageChannels: [channel('openai')],
      stylePresets: [
        { id: 'p1', name: 'flat', artist: '1.3::artist:foo::, dot nose', negative: 'lowres, blurry', enabled: true },
        { id: 'p2', name: 'real', artist: 'photorealistic, skin texture', negative: 'cartoon', enabled: true },
        { id: 'p3', name: 'hidden', artist: 'should never appear', enabled: false },
      ],
      activePreset: 'p1',
    },
  })
  const config = await f.tools.get('read_image_config').execute({})
  // 清单只给名字和 ID：三十多套正面词合起来过万字，挑画风时用不上。
  assert.deepEqual(config.presets, [{ id: 'p1', name: 'flat', active: true }, { id: 'p2', name: 'real', active: false }])
  assert.equal(JSON.stringify(config).includes('dot nose'), false)
  assert.equal(JSON.stringify(config).includes('should never appear'), false)
  // 点名才展开，且只给正面词，负面词由引擎自动带上，不返回。
  const one = await f.tools.get('read_image_config').execute({ preset: 'flat' })
  assert.deepEqual(one, { id: 'p1', name: 'flat', artist: '1.3::artist:foo::, dot nose', active: true })
  assert.equal(JSON.stringify(one).includes('lowres'), false)
  // 按 ID 也能取。
  assert.equal((await f.tools.get('read_image_config').execute({ preset: 'p2' })).name, 'real')
  // 找不到就报错，不静默给空。
  await assert.rejects(f.tools.get('read_image_config').execute({ preset: '不存在的画风' }), /未找到|清单/)
})

test('independent batch tasks keep the pictures that succeeded when one fails', async t => {
  const f = await studio(t, { config: { imageBackend: 'openai', activeImageChannel: 'openai', imageChannels: [channel('openai')] } })
  let calls = 0
  globalThis.fetch = async () => ++calls <= 2
    ? json({ data: [{ b64_json: b64 }] })
    : new Response(JSON.stringify({ error: 'quota reached' }), { status: 400, headers: { 'content-type': 'application/json' } })
  const result = await draw(f, { prompt: 'one traveler', count: 4 }, own)
  assert.equal(result.ok, false)
  assert.equal(result.images.length, 2, '一个任务失败不影响其余任务')
  assert.equal(calls, 4, '四个任务各自提交，不再因为中间一个失败就掐掉整批')
  assert.equal((await f.galleries[0].list({ sessionId: 'card-session-a' })).length, 2)
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
  const cards = Promise.all([draw(f, { prompt: 'card one' }, own), draw(f, { prompt: 'card two' }, own)])
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

test('async card tools return at once and hand back each picture as it lands', { timeout: 30000 }, async t => {
  const f = await studio(t, { config: { imageBackend: 'openai', activeImageChannel: 'relay-a', imageConcurrency: 2,
    imageChannels: [channel('openai', {}, { id: 'relay-a', name: 'relay a' }), channel('openai', {}, { id: 'relay-b', name: 'relay b' })] } })
  const releases = []
  globalThis.fetch = async () => new Promise(resolve => releases.push(() => resolve(json({ data: [{ b64_json: b64 }] }))))
  const submit = f.tools.get('gen_image_submit'), poll = f.tools.get('gen_image_status')
  const first = await submit.execute({ channel: 'relay-a', prompt: 'a traveler' }, own)
  const second = await submit.execute({ channel: 'relay-b', prompt: 'another traveler' }, own)
  assert.equal(first.channel, 'relay a')
  assert.equal(second.channel, 'relay b')
  assert.notEqual(first.jobs[0].jobId, second.jobs[0].jobId)
  for (let i = 0; releases.length < 2 && i < 400; i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(releases.length, 2, '两个渠道同时到达传输层：提交互不等待')
  const waiting = await poll.execute({ jobIds: [first.jobs[0].jobId], wait: 0 }, own)
  assert.equal(waiting.jobs[0].state, 'running')
  assert.equal(waiting.jobs[0].markdown, undefined)
  const pending = poll.execute({ jobIds: [first.jobs[0].jobId, second.jobs[0].jobId], wait: 10 }, own)
  releases.shift()()
  const one = await pending
  assert.equal(one.settled, 1, '出来一张就先交一张，不等另一张')
  const image = one.jobs.find(item => item.state === 'done')
  assert.match(image.markdown, /^!\[图片\]\(http:\/\/127\.0\.0\.1:\d+\/dsh-tavern-gen\/img\/[^)]+\)$/)
  assert.doesNotMatch(poll.output.render({}, one)[0].text, /种子：/, '不支持种子的渠道不能显示随机占位数')
  releases.shift()()
  await f.runtime.terminal(second.jobs[0].jobId)
  const rest = await poll.execute({ jobIds: [first.jobs[0].jobId, second.jobs[0].jobId], wait: 10 }, own)
  assert.equal(rest.settled, 2)
  assert.equal((await f.runtime.request('/dsh-tavern-gen/api/gallery')).body.items.length, 2)
  const again = await poll.execute({ jobIds: [first.jobs[0].jobId], wait: 0 }, own)
  assert.equal(again.jobs[0].url, rest.jobs.find(item => item.jobId === first.jobs[0].jobId).url, '重复查询复用同一条记录')
  assert.equal((await f.runtime.request('/dsh-tavern-gen/api/gallery')).body.items.length, 2, '重复查询不重复建记录')
})


test('sync compatibility and async results remain scoped, accurate and recoverable', { timeout: 30000 }, async t => {
  const f = await studio(t, { config: { imageBackend: 'openai', activeImageChannel: 'openai', imageConcurrency: 2,
    imageChannels: [channel('openai')], stylePresets: [{ id: 'p', name: '测试画风', artist: 'style', enabled: true }] } })
  const requests = []
  globalThis.fetch = async (_url, init) => new Promise(resolve => requests.push({ body: JSON.parse(init.body), finish: () => resolve(json({ data: [{ b64_json: b64 }] })) }))
  const submit = f.tools.get('gen_image_submit'), status = f.tools.get('gen_image_status')
  const sent = await submit.execute({ prompt: 'a traveler', preset: 'p', count: 2 }, own)
  const [first, second] = sent.jobs.map(item => item.jobId)
  for (let i = 0; requests.length < 2 && i < 400; i++) await new Promise(resolve => setTimeout(resolve, 5))
  requests[0].finish(); await f.runtime.terminal(first)
  const started = Date.now()
  const partial = await status.execute({ jobIds: [first, second], wait: 3 }, own)
  assert.ok(Date.now() - started < 2000, '已有图片立即返回')
  assert.equal(partial.jobs[0].state, 'done')
  assert.equal(partial.jobs[0].seed, undefined)
  assert.equal(Object.hasOwn(requests[0].body, 'seed'), false)
  const other = await status.execute({ jobIds: [first], wait: 0 }, { agent: { session: { id: 'other' } } })
  assert.equal(other.jobs[0].state, 'unknown')
  assert.equal(other.jobs[0].markdown, undefined)
  requests[1].finish(); await f.runtime.terminal(second)
  let saved
  for (let i = 0; i < 100; i++) { saved = await f.read('jobs-store.json'); if (saved[first]?.state === 'done') break; await new Promise(resolve => setTimeout(resolve, 10)) }
  assert.equal(saved[first].cardPreset, '测试画风')
  assert.equal(saved[first].cardSeedSupported, false)
  f.runtime.close()
  const restarted = await f.start()
  // A fresh registration belongs to the restarted runtime; its tool map replaces the old one.
  for (let i = 0; !f.tools.has('gen_image_status') && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 10))
  const current = await f.tools.get('gen_image_status').execute({ jobIds: [first], wait: 0 }, own)
  assert.equal(current.jobs[0].preset, '测试画风')
  assert.equal(current.jobs[0].prompt, partial.jobs[0].prompt)
  assert.equal(current.jobs[0].negative, partial.jobs[0].negative)
  assert.deepEqual(current.jobs[0].characters, partial.jobs[0].characters)
  assert.equal(current.jobs[0].seed, undefined)
  globalThis.fetch = async () => json({ data: [{ b64_json: b64 }] })
  const sync = await f.tools.get('gen_image').execute({ prompt: 'sync compatibility' }, own)
  assert.equal(sync.ok, true)
  assert.match(sync.images[0].markdown, /^!\[图片\]\(http/)
  restarted.close()
})

test('async status output retains uncertainty guidance', async t => {
  const f = await studio(t)
  const rendered = f.tools.get('gen_image_status').output.render({}, { jobs: [{ jobId: 'id', error: '连接失败', note: '平台可能已接单，不要重复提交' }] })[0].text
  assert.match(rendered, /连接失败/)
  assert.match(rendered, /不要重复提交/)
})

test('async submission survives the tool call that started it', { timeout: 30000 }, async t => {
  const f = await studio(t, { config: { imageBackend: 'openai', activeImageChannel: 'openai', imageChannels: [channel('openai')] } })
  globalThis.fetch = async () => new Promise(resolve => setTimeout(() => resolve(json({ data: [{ b64_json: b64 }] })), 120))
  const controller = new AbortController()
  const submitted = await f.tools.get('gen_image_submit').execute({ prompt: 'a traveler' }, { ...own, signal: controller.signal })
  controller.abort(new Error('stop after submit'))
  const done = await f.tools.get('gen_image_status').execute({ jobIds: [submitted.jobs[0].jobId], wait: 10 }, own)
  assert.equal(done.jobs[0].state, 'done', '工具返回后的取消信号不能带走已经提交的任务')
  assert.ok(done.jobs[0].markdown)
})

test('async status separates a definitive failure from an ambiguous one', { timeout: 30000 }, async t => {
  const f = await studio(t, { config: { imageBackend: 'openai', activeImageChannel: 'openai', imageChannels: [channel('openai')] } })
  // 站点明确拒绝（HTTP 429）时请求没有计费，重新提交是安全的。
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429, headers: { 'content-type': 'application/json' } })
  const submitted = await f.tools.get('gen_image_submit').execute({ prompt: 'a traveler' }, own)
  const state = await f.tools.get('gen_image_status').execute({ jobIds: [submitted.jobs[0].jobId], wait: 10 }, own)
  assert.equal(state.jobs[0].state, 'failed')
  assert.equal(state.jobs[0].retryable, true, '站点明确拒绝时不算花过额度，可以重新提交')
  assert.match(state.jobs[0].error, /429/)
})

test('card and play galleries stay separate while task history, reload and legacy records preserve both pictures', async t => {
  const f = await studio(t, { config: { imageBackend: 'openai', activeImageChannel: 'openai', imageChannels: [channel('openai')] } })
  globalThis.fetch = async () => json({ data: [{ b64_json: b64 }] })
  const card = await draw(f, { prompt: 'card portrait' }, own)
  const play = await f.runtime.request('jobs', { tag: 'story scene', key: 'play-scene', sessionId: 'play-session' })
  await f.runtime.terminal(play.body.id)
  const cardId = card.images[0].jobId
  assert.deepEqual((await f.runtime.request('history?source=play')).body.jobs.map(job => job.id), [play.body.id])
  assert.deepEqual((await f.runtime.request('history?source=card')).body.jobs.map(job => job.id), [cardId])
  assert.equal((await f.runtime.request('history')).body.jobs.length, 2, 'shared task diagnostics retain both sources')
  assert.deepEqual((await f.runtime.request('/dsh-tavern-gen/api/gallery')).body.items.map(job => job.id), [cardId])
  assert.deepEqual(await f.galleries[0].list({ sessionId: 'play-session' }), [], 'card provider does not add pictures to a play session')
  assert.equal((await f.runtime.request('history?source=invalid')).status, 400)
  let saved
  for (let i = 0; i < 100; i++) {
    saved = await f.read('jobs-store.json')
    if (saved[cardId]?.source === 'card' && saved[play.body.id]?.source === 'play') break
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal(saved[cardId].source, 'card')
  f.runtime.close()
  delete saved[cardId].source; delete saved[play.body.id].source
  const legacyId = '11111111-2222-4333-8444-555555555555'
  const legacyFile = join(dirname(saved[cardId].file), legacyId + '.png')
  await copyFile(saved[cardId].file, legacyFile)
  await createCardGallery(join(f.pluginRoot, '../../image-cache/dsh-tavern-gen')).add({ jobId: legacyId, file: legacyFile, mediaType: 'image/png', prompt: 'older card portrait' }, { sessionId: 'card-session-a' })
  saved[legacyId] = { ...saved[cardId], id: legacyId, file: legacyFile, key: 'card-older-version' }
  await writeFile(join(f.pluginRoot, 'jobs-store.json'), JSON.stringify(saved))
  const restarted = await f.start()
  assert.deepEqual((await restarted.request('history?source=play')).body.jobs.map(job => job.id), [play.body.id])
  assert.deepEqual(new Set((await restarted.request('history?source=card')).body.jobs.map(job => job.id)), new Set([cardId, legacyId]), 'pre-fix UUID card jobs are recognized without deleting or regenerating them')
  assert.equal((await restarted.request('/dsh-tavern-gen/api/gallery')).body.items.length, 2)
  restarted.close()
  await writeFile(join(f.pluginRoot, 'jobs-store.json'), '{}')
  const recovered = await f.start()
  assert.deepEqual((await recovered.request('history?source=play')).body.jobs.map(job => job.id), [play.body.id])
  assert.deepEqual(new Set((await recovered.request('history?source=card')).body.jobs.map(job => job.id)), new Set([cardId, legacyId]), 'cache-only recovery retains card sources for prefixed IDs and old gallery UUIDs')
})

test('cancelling a status call stops only the wait, never the job or a second paid request', async t => {
  const f = await studio(t, { config: { imageBackend: 'openai', activeImageChannel: 'openai', imageChannels: [channel('openai')] } })
  let calls = 0, started
  const submitted = new Promise(resolve => { started = resolve })
  globalThis.fetch = async () => {
    calls++; started()
    return new Promise(resolve => setTimeout(() => resolve(json({ data: [{ b64_json: b64 }] })), 600))
  }
  const controller = new AbortController()
  const first = await f.tools.get('gen_image_submit').execute({ prompt: 'one traveler' }, { ...own, signal: controller.signal })
  await submitted
  const polling = f.tools.get('gen_image_status').execute({ jobIds: [first.jobs[0].jobId], wait: 30 }, { ...own, signal: controller.signal })
  controller.abort(new Error('stop the poll'))
  await assert.rejects(polling)
  assert.equal(calls, 1, '取消查询不会补发第二次付费请求')
  const done = await f.tools.get('gen_image_status').execute({ jobIds: [first.jobs[0].jobId], wait: 10 }, own)
  assert.equal(done.jobs[0].state, 'done', '任务在后台照常跑完，没有被这次查询的取消带走')
})

test('selection detects ambiguous names and leaves global config unchanged', () => {
  const config = { imageBackend: 'comfyui', imageChannels: [channel('openai', {}, { id: 'a', name: 'relay alpha' }), channel('openai', {}, { id: 'b', name: 'relay beta' })], stylePresets: [] }
  assert.throws(() => cardSelection(config, [], { channel: 'relay' }), /不唯一/)
  const before = structuredClone(config)
  assert.equal(cardSelection(config, [], { channel: 'b' }).config.activeImageChannel, 'b')
  assert.deepEqual(config, before)
})

test('preset overrides only touch the copy used for this generation', () => {
  const config = {
    imageBackend: 'openai', activeImageChannel: 'a', imageChannels: [channel('openai', {}, { id: 'a', name: 'relay alpha' })],
    stylePresets: [{ id: 'p1', name: 'flat', artist: '1.3::artist:foo::, dot nose', negative: 'lowres', position: 'prefix', enabled: true }],
    activePreset: 'p1',
  }
  const before = structuredClone(config)
  const picked = cardSelection(config, [], { preset_positive: '2::artist:foo::', preset_negative: '' })
  const patched = picked.config.stylePresets.find(item => item.id === 'p1')
  assert.equal(patched.artist, '2::artist:foo::')
  assert.equal(patched.negative, '')
  assert.equal(picked.preset.artist, '2::artist:foo::', '返回里带出本次实际用的那套')
  assert.deepEqual(config, before, '调用方的配置不能被改')
  // 没选预设时，覆盖值自己撑起一条临时预设
  const bare = cardSelection(Object.assign({}, config, { activePreset: '' }), [], { preset_positive: 'artist:bar' })
  assert.equal(bare.config.activePreset, 'preset-override')
  assert.equal(bare.preset.artist, 'artist:bar')
  assert.deepEqual(config, before)
})

test('workbench preset overrides match the submitted prompt and keep the saved preset intact', async t => {
  const f = await studio(t, { config: {
    imageBackend: 'openai', activeImageChannel: 'openai',
    imageChannels: [channel('openai', {}, { name: '工作台渠道' })],
    styleArtists: 'fallback artist', activePreset: 'p1',
    stylePresets: [{ id: 'p1', name: '工作台画风', artist: 'saved artist', negative: 'saved exclusion', enabled: true }],
  } })
  let payload
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(init.body)
    return json({ data: [{ b64_json: b64 }] })
  }
  const args = { prompt: 'quiet forest', channel: '工作台渠道', preset: 'p1', preset_positive: '', preset_negative: 'watermark' }
  const result = await draw(f, args)
  assert.equal(result.channel, '工作台渠道')
  assert.equal(result.images[0].prompt, payload.prompt)
  assert.doesNotMatch(payload.prompt, /fallback artist|saved artist|saved exclusion/)
  const rendered = f.tools.get('gen_image_status').output.render(args, result.raw)[0].text
  // #688 之后回执不再回显实际提交的正负面提示词和角色提示词，只留渠道、画风预设和图片链接，
  // 所以这里断言「不含」。preset_negative 的 watermark 仍应生效在提交给渠道的排除项里，
  // 但那属于 payload 层，第 370 行已经验过正面提示词没被污染。
  assert.doesNotMatch(rendered, /watermark|saved artist|fallback artist/)
  assert.equal((await f.runtime.request('/dsh-tavern-gen/api/gallery')).body.items[0].preset, '工作台画风')
  assert.equal((await f.tools.get('read_image_config').execute({ preset: 'p1' }, own)).artist, 'saved artist')
})

test('gallery writes do not lose concurrent additions and remove compares stable IDs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'card-gallery-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'output.png'); await writeFile(file, PNG)
  const gallery = createCardGallery(join(root, 'gallery'))
  await Promise.all(Array.from({ length: 20 }, (_, i) => gallery.add({ jobId: 'job-' + i, file, mediaType: 'image/png' }, { sessionId: 'a' })))
  assert.equal((await gallery.list('a')).length, 20)
  // 预设必须是字符串：写进索引的对象会被画廊设置页当 children 渲染，整页白屏。
  await gallery.add({ jobId: 'job-object', file, mediaType: 'image/png', preset: { id: 'p1', name: '伪3D' } }, { sessionId: 'object' })
  const objectEntry = (await gallery.list('object'))[0]
  assert.equal(typeof objectEntry.preset, 'string', '预设对象不能进画廊索引')
  assert.equal(objectEntry.preset, '', '没有合法字符串时落空串，绝不落对象')
  assert.equal(await gallery.remove('job-3', 'a'), true)
  assert.equal((await gallery.list('a')).length, 19)
  assert.equal(await gallery.remove('job-4', 'b'), false)
  await assert.rejects(gallery.file('../output.png'))
})

test('a locked image keeps its gallery record for retry, including partial clear failures', async t => {
  const root = await mkdtemp(join(tmpdir(), 'card-gallery-delete-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'output.png'); await writeFile(file, PNG)
  let locked = true
  const gallery = createCardGallery(join(root, 'gallery'), { removeFile: async (file, options) => {
    if (locked && file.endsWith('one.png')) throw Object.assign(new Error('file in use'), { code: 'EPERM' })
    return rm(file, options)
  } })
  for (const jobId of ['one', 'two']) await gallery.add({ jobId, file, mediaType: 'image/png' }, { sessionId: 'a' })
  await assert.rejects(gallery.remove('one', 'a'), { code: 'EPERM' })
  assert.equal((await gallery.list()).length, 2)
  await assert.rejects(gallery.clear(), { code: 'GALLERY_DELETE_FAILED', removed: 1 })
  assert.deepEqual((await gallery.list()).map(item => item.id), ['one'])
  assert.deepEqual((await gallery.read('one', 'a')).data, PNG)
  locked = false
  assert.equal(await gallery.clear(), 1)
  assert.deepEqual(await gallery.list(), [])
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

test('card worldbook entry routes add, edit and remove a rule without changing other entries', async t => {
  const f = await studio(t)
  const before = (await f.runtime.request('/dsh-tavern-gen/api/worldbook')).body.worldbook
  const bucket = before.buckets[0].id
  const added = await f.runtime.request('/dsh-tavern-gen/api/worldbook-add', { bucket, entry: { title: '新增规则', content: '规则正文' } })
  assert.equal(added.status, 200, JSON.stringify(added.body))
  const id = added.body.entry.id
  const edited = await f.runtime.request('/dsh-tavern-gen/api/worldbook-entry', { bucket, id, patch: { title: '检索规则', content: '角色与服装素材', mode: 'lookup', enabled: false } })
  assert.equal(edited.status, 200, JSON.stringify(edited.body))
  assert.deepEqual(edited.body.entry, { id, title: '检索规则', content: '角色与服装素材', mode: 'lookup', enabled: false })
  const saved = (await f.runtime.request('/dsh-tavern-gen/api/worldbook')).body.worldbook
  assert.deepEqual(saved.buckets[0].entries.at(-1), edited.body.entry)
  const removed = await f.runtime.request('/dsh-tavern-gen/api/worldbook-entry', { bucket, id, remove: true })
  assert.equal(removed.status, 200)
  assert.deepEqual(removed.body.book.buckets, before.buckets)
})
