import test from 'node:test'
import assert from 'node:assert/strict'
import { comfyWorkflow, compileComfyWorkflow } from '../tavern-plugin/lib/domain/scene-image-comfy-workflow.js'
import { generateSceneImage } from '../tavern-plugin/lib/domain/scene-image-provider.js'
import { channelSettings, channelReady, imageExpressionProfile, imageCredentialRef } from '../tavern-plugin/lib/domain/scene-image-channels.js'
import { comfyGraph } from './fixtures/scene-image-comfy-workflow.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=', 'base64')
const input = () => ({ provider: 'comfyui', baseURL: 'http://localhost:8188/prefix', workflow: comfyGraph(), prompt: 'rainy window' })
test('ComfyUI imports API graph once, preserves unrelated parameters, sets one image and random seed', () => {
  const graph = comfyGraph(), snapshot = structuredClone(graph), template = comfyWorkflow(graph)
  assert.deepEqual(comfyWorkflow(template), template)
  const result = compileComfyWorkflow(template, 'new picture')
  assert.equal(result.prompt['3'].inputs.text, 'new picture')
  assert.equal(result.prompt['4'].inputs.text, 'negative stays')
  assert.equal(result.prompt['1'].inputs.ckpt_name, 'fixture-model.safetensors')
  assert.equal(result.prompt['2'].inputs.batch_size, 1)
  assert.equal(result.prompt['5'].inputs.seed, result.seed)
  assert.equal(result.outputNode, '7')
  assert.deepEqual(graph, snapshot)
  assert.equal(channelReady(channelSettings(input()), ''), true)
  assert.equal(channelReady(channelSettings({ ...input(), workflow: null }), ''), false)
  assert.notEqual(imageExpressionProfile(channelSettings(input())), imageExpressionProfile(channelSettings({ ...input(), workflow: { ...graph, '4': { ...graph['4'], inputs: { ...graph['4'].inputs, text: 'changed' } } } })))
  assert.equal(imageCredentialRef('comfyui', 'basic'), 'DSH_TAVERN_IMAGE_COMFYUI_PASSWORD')
})

test('ComfyUI supports explicit maintainer mapping and prunes unrelated output branches', () => {
  const graph = comfyGraph()
  graph['extra'] = { class_type: 'SaveImage', inputs: { images: ['6', 0] } }
  const template = { format: 'dsh-tavern-comfy-v1', name: '维护者模板', prompt: graph, outputNode: '7', bindings: { positive: [{ node: '3', input: 'text' }], seed: [{ node: '5', input: 'seed' }], batch: [{ node: '2', input: 'batch_size' }] } }
  const result = compileComfyWorkflow(template, 'one subject')
  assert.equal(result.prompt.extra, undefined)
  assert.equal(result.prompt['2'].inputs.batch_size, 1)
  assert.equal(comfyWorkflow(template).name, '维护者模板')
  assert.throws(() => comfyWorkflow(graph), /唯一/)
  assert.throws(() => comfyWorkflow({ ...template, bindings: { positive: [{ node: 'extra', input: 'text' }] } }), /未连接/)
})

test('ComfyUI rejects canvas files, secrets, cycles, broken links and ambiguous prompt mapping before HTTP', () => {
  assert.throws(() => comfyWorkflow({ nodes: [], links: [] }), /API/)
  for (const mutate of [
    g => { g['3'].inputs.token = 'secret' },
    g => { g['5'].inputs.positive = ['4', 0] },
    g => { g['6'].inputs.samples = ['6', 0] },
    g => { g['6'].inputs.samples = ['missing', 0] },
    g => { g['2'].inputs.__proto__ = 'x'; g['2'].inputs = JSON.parse('{"__proto__":"x"}') }
  ]) { const graph = comfyGraph(); mutate(graph); assert.throws(() => comfyWorkflow(graph), /工作流/) }
  const graph = comfyGraph(); graph['2'].inputs.batch_size = ['1', 0]
  assert.throws(() => compileComfyWorkflow(comfyWorkflow(graph), 'scene'), /批量/)
})

test('ComfyUI persists before POST, polls only its ID and authenticates same-origin /view', async () => {
  const calls = [], tasks = []
  let id, historyReads = 0
  const result = await generateSceneImage({ ...input(), authType: 'basic', username: 'reader', apiKey: ' secret ', onProviderTask: async task => tasks.push(task) }, { wait: async () => {}, fetch: async (url, init) => {
    calls.push({ url, init }); assert.equal(init.headers.authorization, 'Basic ' + Buffer.from('reader: secret ').toString('base64'))
    assert.equal(init.redirect, 'error')
    if (url.endsWith('/prompt')) {
      const body = JSON.parse(init.body); id = body.prompt_id
      assert.equal(tasks[0].promptId, id); assert.equal(tasks[0].state, 'submitting')
      assert.equal(body.prompt['2'].inputs.batch_size, 1)
      return Response.json({ prompt_id: id, number: 8, node_errors: { unrelated: {} } })
    }
    if (url.includes('/history/')) {
      assert.ok(url.endsWith('/history/' + id)); historyReads++
      return Response.json(historyReads === 1 ? {} : { [id]: { status: { status_str: 'success', completed: true }, outputs: { '7': { images: [{ filename: 'picture 1.png', subfolder: 'tavern', type: 'output' }] }, other: { images: [{ filename: 'wrong.png', subfolder: '', type: 'output' }] } } } })
    }
    assert.equal(new URL(url).searchParams.get('filename'), 'picture 1.png')
    assert.equal(new URL(url).pathname, '/prefix/view')
    return new Response(png)
  } })
  assert.deepEqual(result.data, png); assert.equal(calls.filter(c => c.init.method === 'POST').length, 1)
  assert.equal(tasks.at(-1).state, 'succeeded'); assert.equal(result.metadata.promptId, id)
  assert.equal(JSON.stringify(tasks).includes(' secret '), false)
})

test('ComfyUI lost submit response reconciles queued task and never POSTs again, including unknown history', async () => {
  let saved, posts = 0
  const params = { ...input(), onProviderTask: async task => { saved = task } }
  await assert.rejects(generateSceneImage(params, { fetch: async () => { posts++; throw new Error('connection lost') } }), /connection lost/)
  assert.equal(saved.state, 'submitting')
  const initial = saved
  let reads = 0
  const result = await generateSceneImage({ ...params, providerTask: initial }, { wait: async () => {}, fetch: async (url, init) => {
    assert.notEqual(init.method, 'POST')
    if (url.endsWith('/queue')) return Response.json({ queue_pending: [[0, initial.promptId, {}, { client_id: initial.clientId }]], queue_running: [] })
    if (url.includes('/history/')) return Response.json(reads++ === 0 ? {} : { [initial.promptId]: { status: { status_str: 'success', completed: true }, outputs: { '7': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } })
    return new Response(png)
  } })
  assert.deepEqual(result.data, png); assert.equal(posts, 1)
  await assert.rejects(generateSceneImage({ ...params, providerTask: initial }, { fetch: async (_url, init) => { assert.notEqual(init.method, 'POST'); return Response.json({}) } }), /结果未确认/)
})

test('ComfyUI error history is terminal even with completed:false; rejected submission and cancellation do not retry', async () => {
  let saved, posts = 0
  const params = { ...input(), onProviderTask: async task => { saved = task } }
  await assert.rejects(generateSceneImage(params, { fetch: async (url) => {
    if (url.endsWith('/prompt')) { posts++; return Response.json({ prompt_id: saved.promptId }) }
    return Response.json({ [saved.promptId]: { status: { status_str: 'error', completed: false, messages: [['execution_error', { exception_message: 'private key' }]] } } })
  } }), error => /执行失败/.test(error.message) && !error.message.includes('private key'))
  assert.equal(saved.state, 'failed'); assert.equal(posts, 1)
  await assert.rejects(generateSceneImage(params, { fetch: async () => new Response('secret', { status: 400 }) }), /HTTP 400/)
  assert.equal(saved.state, 'rejected')
  const controller = new AbortController()
  await assert.rejects(generateSceneImage({ ...params, signal: controller.signal }, { wait: async () => { controller.abort() }, fetch: async url => url.endsWith('/prompt') ? Response.json({ prompt_id: saved.promptId }) : Response.json({}) }), /abort/i)
  assert.equal(saved.state, 'pending')
})

test('ComfyUI rejects missing/multiple output, unsafe descriptors and non-images without following returned URLs', async () => {
  for (const image of [null, { filename: '../private.png', subfolder: '', type: 'output' }, { filename: 'a.png', subfolder: '', type: 'input' }, { filename: 'a.png', subfolder: '../private', type: 'temp' }, { filename: 'a.png', subfolder: '', type: 'output' }]) {
    let saved, calls = 0
    await assert.rejects(generateSceneImage({ ...input(), onProviderTask: async task => { saved = task } }, { fetch: async (url, init) => {
      calls++
      if (init.method === 'POST') return Response.json({ prompt_id: saved.promptId })
      if (url.includes('/history/')) return Response.json({ [saved.promptId]: { status: { completed: true }, outputs: { '7': { images: image ? [image] : [] } } } })
      assert.ok(url.startsWith('http://localhost:8188/prefix/view?'))
      return new Response('<html>not an image</html>')
    } }), /唯一图片|位置不合法|图片格式/)
    assert.ok(calls <= 3)
  }
})
