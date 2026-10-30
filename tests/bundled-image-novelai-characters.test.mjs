import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { parseImagePlan, parsePromptsBlock, formatPromptsBlock, preserveCharacterMetadata } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner.js'
import { apply, compileChannelJob, compileJob, expandRosterCalls } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'
import { generateImage } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-providers.js'
import { createMediaActions } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/media-actions.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex')
const channel = (provider = 'novelai', extra = {}) => ({ id: 'test', provider, baseUrl: 'https://image.test', model: 'nai-diffusion-5-full', apiKey: 'test', options: {}, ...extra })
const config = { imageBackend: 'novelai', promptMode: 'tags', traitMode: 'default', weightMode: 'auto', sizes: {} }

test('规划解析兼容角色块位于 prompts 外，并保留合法旧 scene；混合内外角色不漏项', () => {
  const [outside] = parseImagePlan('<image><regex>x</regex><prompts>1girl, old scene</prompts><character_1><prompt>one</prompt><center>C3</center><negative>bad one</negative></character_1></image>')
  assert.equal(outside.prompts, '1girl, old scene')
  assert.deepEqual(outside.characters, [{ prompt: 'one', centers: 'C3', uc: 'bad one' }])

  const [mixed] = parseImagePlan('<image><regex>x</regex><prompts><scene_composition>café</scene_composition><character_1><prompt>one</prompt><uc>bad</uc></character_1></prompts><character_2><prompt>two</prompt><centers>D4</centers><uc>worse</uc></character_2></image>')
  assert.equal(mixed.prompts, 'café')
  assert.deepEqual(mixed.characters, [
    { prompt: 'one', centers: '', uc: 'bad' },
    { prompt: 'two', centers: 'D4', uc: 'worse' },
  ])
})

test('编辑文本角色块可往返，显式删除全部角色时只留下 scene', () => {
  const text = formatPromptsBlock('night street', [{ prompt: 'A', centers: 'C3', uc: 'bad A' }])
  assert.deepEqual(parsePromptsBlock(text), { scene: 'night street', characters: [{ prompt: 'A', centers: 'C3', uc: 'bad A' }] })
  assert.deepEqual(parsePromptsBlock('<scene_composition>night street</scene_composition>'), { scene: 'night street', characters: [] })
})

test('改写模型漏掉 centers、uc 或整个角色块时按角色位置恢复原 metadata', () => {
  const original = formatPromptsBlock('old scene', [
    { prompt: 'old A', centers: 'C3', uc: 'bad A' },
    { prompt: 'old B', centers: 'D4', uc: 'bad B' },
  ])
  const partial = '<scene_composition>new scene</scene_composition><character_1><prompt>new A</prompt></character_1>'
  const merged = parsePromptsBlock(preserveCharacterMetadata(original, partial))
  assert.equal(merged.scene, 'new scene')
  assert.deepEqual(merged.characters, [
    { prompt: 'new A', centers: 'C3', uc: 'bad A' },
    { prompt: 'old B', centers: 'D4', uc: 'bad B' },
  ])
  const sceneOnly = parsePromptsBlock(preserveCharacterMetadata(original, 'rewritten scene'))
  assert.equal(sceneOnly.scene, 'rewritten scene')
  assert.equal(sceneOnly.characters.length, 2)
})

test('改写角色按 DSL 编号恢复 metadata，补回缺失编号且不改变解析器输出格式', () => {
  const original = '<scene_composition>old</scene_composition>'
    + '<character_1><prompt>old one</prompt><centers>C3</centers><uc>bad one</uc></character_1>'
    + '<character_2><prompt>old two</prompt><centers>D4</centers><uc>bad two</uc></character_2>'
  const revised = '<scene_composition>new</scene_composition>'
    + '<character_2><prompt>new two</prompt></character_2>'
  const mergedText = preserveCharacterMetadata(original, revised)
  const merged = parsePromptsBlock(mergedText)
  assert.deepEqual(merged.characters, [
    { prompt: 'new two', centers: 'D4', uc: 'bad two' },
    { prompt: 'old one', centers: 'C3', uc: 'bad one' },
  ])
  assert.match(mergedText, /<character_2>[\s\S]*new two[\s\S]*D4[\s\S]*bad two[\s\S]*<\/character_2>/)
  assert.match(mergedText, /<character_1>[\s\S]*old one[\s\S]*C3[\s\S]*bad one[\s\S]*<\/character_1>/)
  const reversed = parsePromptsBlock(preserveCharacterMetadata(original,
    '<scene_composition>new</scene_composition>'
      + '<character_2><prompt>revised two</prompt></character_2>'
      + '<character_1><prompt>revised one</prompt></character_1>'))
  assert.deepEqual(reversed.characters, [
    { prompt: 'revised two', centers: 'D4', uc: 'bad two' },
    { prompt: 'revised one', centers: 'C3', uc: 'bad one' },
  ])
})

test('真实 /redraw handler 接受显式空角色 DSL，并只对原始角色数据编译一次', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-image-redraw-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const packageSource = new URL('../tavern-plugin/packages/dsh-tavern-image-bundled/', import.meta.url)
  const packagePath = join(temp, 'plugin')
  await cp(packageSource, packagePath, { recursive: true })
  const sourceId = '11111111-1111-4111-8111-111111111111'
  await writeFile(join(packagePath, 'jobs-store.json'), JSON.stringify({ [sourceId]: {
    id: sourceId, state: 'done', backend: 'novelai', channelId: 'test-nai', createdAt: Date.now(),
    params: { rawTag: 'old scene', tag: 'old scene', size: '832x1216', characters: [{ prompt: 'Alice', centers: 'C3', uc: '' }] },
  } }))
  await writeFile(join(packagePath, 'definitions.json'), JSON.stringify({ version: 3, characters: [
    { id: 'alice', name: 'Alice', match: 'Alice', enabled: true, traits: { negative: 'wrong eye color' }, outfits: [] },
  ], outfits: [], settings: [], props: [] }))
  const { apply: isolatedApply } = await import(pathToFileURL(join(packagePath, 'lib', 'index.js')).href)
  const routes = new Map()
  const disposers = []
  const disposeHandlers = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    webServer: { register({ path, handler }) { routes.set(path, handler); return () => routes.delete(path) } },
    inject(names, install) { if (names.every(name => this[name])) install(this) },
    effect(install) { const cleanup = install(); if (typeof cleanup === 'function') disposers.push(cleanup); return cleanup },
    on(event, callback) { if (event === 'dispose') disposeHandlers.push(callback) },
  }
  isolatedApply(ctx, {
    imageBackend: 'novelai', activeImageChannel: 'test-nai',
    imageChannels: [{ id: 'test-nai', name: 'test', provider: 'novelai', enabled: true, baseUrl: 'https://image.test', apiKey: 'test-key', options: {} }],
    promptMode: 'tags', traitMode: 'default',
  })
  t.after(() => { for (const dispose of disposeHandlers.splice(0).reverse()) dispose(); for (const dispose of disposers.splice(0).reverse()) dispose() })
  const handler = routes.get('/plugins/dsh-tavern-image/redraw')
  assert.equal(typeof handler, 'function')
  const oldFetch = globalThis.fetch
  const payloads = []
  globalThis.fetch = async (_url, init) => {
    payloads.push(JSON.parse(init.body))
    return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
  }
  // The plugin's job runner keeps going after the test; stop it before the real fetch is back, or a late job
  // reaches the network (image.test) and keeps the process alive.
  t.after(() => { for (const dispose of disposeHandlers.splice(0).reverse()) dispose(); for (const dispose of disposers.splice(0).reverse()) dispose(); globalThis.fetch = oldFetch })
  const request = (route, body, method = 'POST') => new Promise((resolve, reject) => {
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    Object.assign(request, { url: route, method, headers: { host: 'localhost', 'content-type': 'application/json' } })
    const response = {
      headersSent: false,
      writeHead(status) { this.status = status; this.headersSent = true },
      end(body) { try { resolve({ status: this.status, body: JSON.parse(String(body)) }) } catch (error) { reject(error) } },
    }
    const handler = routes.get(request.url.split('?')[0])
    if (!handler) return reject(new Error('route not registered: ' + request.url))
    handler(request, response)
  })
  const emptyResult = await request('/plugins/dsh-tavern-image/redraw', { jobId: sourceId, prompt: '<scene_composition>new scene</scene_composition>' })
  assert.equal(emptyResult.status, 200)
  assert.equal(emptyResult.body.ok, true)
  // Jobs run in the background; a busy machine (the full suite in parallel) can take seconds to send one.
  const sent = async count => { for (const deadline = Date.now() + 10000; payloads.length < count && Date.now() < deadline;) await new Promise(resolve => setTimeout(resolve, 10)) }
  await sent(1)
  assert.deepEqual(payloads[0]?.parameters.v4_prompt.caption.char_captions, [])
  assert.equal(payloads[0]?.parameters.v4_negative_prompt.caption.char_captions.length, 0)

  const roleResult = await request('/plugins/dsh-tavern-image/redraw', { jobId: sourceId, prompt: '<scene_composition>new scene</scene_composition><character_1><prompt>Alice</prompt><uc>manual exclusion</uc></character_1>' })
  assert.equal(roleResult.status, 200)
  assert.equal(roleResult.body.ok, true)
  const detailResult = await request('/plugins/dsh-tavern-image/job-detail?id=' + roleResult.body.jobId, undefined, 'GET')
  assert.equal(detailResult.status, 200)
  assert.deepEqual(detailResult.body.job.characters, [{ prompt: 'Alice', centers: '', uc: 'manual exclusion' }])
  await sent(2)
  const rolePayload = payloads[1]
  assert.equal(rolePayload?.parameters.v4_prompt.caption.char_captions[0]?.char_caption, 'Alice')
  const roleNegative = rolePayload?.parameters.v4_negative_prompt.caption.char_captions[0]?.char_caption ?? ''
  assert.match(roleNegative, /manual exclusion/)
  assert.equal(roleNegative.match(/wrong eye color/g)?.length, 1)
})

test('未知角色宏在 char caption 保留服装和角度；非 NovelAI 平铺角色负面', () => {
  const macro = '${"name":"Lu Qi","outfit":"light green ruqun","angle":"from front"}$'
  const expanded = expandRosterCalls(macro, { characters: [] }, 'default')
  assert.match(expanded, /light green ruqun/)
  assert.match(expanded, /from front/)
  const params = { tag: 'café', rawTag: 'café', size: '832x1216', characters: [{ prompt: macro, centers: 'C3', uc: 'bad anatomy' }] }
  const nai = compileChannelJob({ params, config, definitions: { characters: [] }, channel: channel() })
  assert.match(nai.characters[0].prompt, /light green ruqun/)
  assert.match(nai.characters[0].prompt, /from front/)
  assert.equal(nai.characters[0].uc, 'bad anatomy')
  const flat = compileChannelJob({ params, config: { ...config, imageBackend: 'openai' }, definitions: { characters: [] }, channel: channel('openai') })
  assert.deepEqual(flat.characters, [])
  assert.match(flat.positive, /light green ruqun/)
  assert.match(flat.negative, /bad anatomy/)
})

test('Comfy 工作流把角色库特征与角色负面注入对应的工作流绑定', () => {
  const workflow = {
    prompt: { positive: { inputs: { text: '' } }, negative: { inputs: { text: '' } } },
    bindings: { positive: [{ node: 'positive', input: 'text' }], negative: [{ node: 'negative', input: 'text' }] },
    sizes: {},
  }
  const definitions = { characters: [{ id: 'a', name: '阿梅', match: 'A Mei', enabled: true, traits: { face: 'MEI FACE', negative: 'wrong eye color' }, outfits: [] }] }
  const params = { tag: 'café', rawTag: 'café', size: '832x1216', characters: [{ prompt: 'A Mei, smiling', centers: 'C3', uc: 'bad anatomy' }] }
  const compiled = compileJob({ workflow, params, config: { ...config, imageBackend: 'comfyui', weightMode: 'keep', negativeMode: 'merge' }, definitions })
  assert.match(compiled.prompt.positive.inputs.text, /café/)
  assert.match(compiled.prompt.positive.inputs.text, /MEI FACE/)
  assert.match(compiled.prompt.positive.inputs.text, /smiling/)
  assert.match(compiled.prompt.negative.inputs.text, /bad anatomy/)
  assert.match(compiled.prompt.negative.inputs.text, /wrong eye color/)
})

test('NovelAI V5 payload发送角色正负面和坐标；缺任一坐标则关闭 use_coords', async () => {
  let body
  const fetchImpl = async (_url, init) => { body = JSON.parse(init.body); return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }) }
  await generateImage(channel(), { positive: 'café', negative: 'lowres', width: 832, height: 1216,
    characters: [{ prompt: 'one', centers: 'C3', uc: 'bad one' }, { prompt: 'two', centers: 'D4', uc: 'bad two' }] }, { fetchImpl })
  assert.equal(body.parameters.params_version, 4)
  assert.equal(body.parameters.v4_prompt.use_coords, true)
  assert.deepEqual(body.parameters.v4_prompt.caption.char_captions.map(item => item.centers), [[{ x: 0.5, y: 0.5 }], [{ x: 0.7, y: 0.7 }]])
  assert.deepEqual(body.parameters.v4_negative_prompt.caption.char_captions.map(item => item.char_caption), ['bad one', 'bad two'])
  await generateImage(channel(), { positive: 'café', width: 832, height: 1216, characters: [{ prompt: 'one', centers: 'C3', uc: 'bad' }, { prompt: 'two', centers: '', uc: 'worse' }] }, { fetchImpl })
  assert.equal(body.parameters.v4_prompt.use_coords, false)
  assert.equal(body.parameters.v4_negative_prompt.caption.char_captions[1].char_caption, 'worse')
})

test('Tavern media revise把分角色结构交给改写器并把角色数据交给替换作业', async t => {
  const promptText = '<scene_composition>old scene</scene_composition>\n<character_1>\n<prompt>old outfit</prompt>\n<centers>C3</centers>\n<uc>bad detail</uc>\n</character_1>'
  const item = { id: 'm', kind: 'dsh-tavern-image/image', turn: 2, textVersion: 'v', status: 'ready', attachment: {}, data: { jobId: 'j' } }
  const sourceJob = { id: 'j', state: 'done', params: { rawTag: 'old scene', characters: [{ prompt: 'old outfit', centers: 'C3', uc: 'bad detail' }] } }
  const revised = [], started = []
  const actions = createMediaActions({
    tavern: { getTurn: async () => ({ textVersion: 'v' }), list: async () => [item], update: async (_id, changes) => Object.assign(item, changes) },
    attachments: { saveImage: async () => ({}) }, readFileAsBytes: async () => new Uint8Array(),
    getJob: async id => id === 'j' ? sourceJob : { id, state: 'running' },
    startReplacement: async input => { started.push(input); return { jobId: 'j2' } },
    revisePrompt: async input => { revised.push(input); return promptText }, cancelJob: async () => {}, pollMs: 1,
  })
  t.after(() => actions.dispose())
  await actions.handle({ gameId: 'g', turn: 2, textVersion: 'v', mediaId: 'm', operation: 'revise', instruction: '改动作' })
  assert.equal(revised[0].prompt, 'old scene')
  assert.deepEqual(revised[0].characters, sourceJob.params.characters)
  assert.equal(started[0].prompt, promptText)
  assert.deepEqual(started[0].characters, sourceJob.params.characters)
})
