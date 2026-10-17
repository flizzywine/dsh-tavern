import test from 'node:test'
import assert from 'node:assert/strict'
import { comfyWorkflow, compileComfyWorkflow } from '../tavern-plugin/lib/domain/scene-image-comfy-workflow.js'
import { generateSceneImage } from '../tavern-plugin/lib/domain/scene-image-provider.js'

import { comfyGraph, comfyLinkedSeedGraph } from './fixtures/scene-image-comfy-workflow.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=', 'base64')
const input = () => ({ provider: 'comfyui', baseURL: 'http://localhost:8188/prefix', workflow: comfyGraph(), prompt: 'rainy window' })

test('ComfyUI mapping errors identify missing fields, types, unsafe integers and duplicates without leaking values', () => {
  for (const [value, expected] of [['PRIVATE_SENTINEL', /节点 8.*seed.*安全整数/], [2 ** 53, /节点 8.*seed.*安全整数/], [1.5, /节点 8.*seed.*安全整数/]]) {
    const graph = comfyLinkedSeedGraph(); graph['8'].inputs.seed = value
    assert.throws(() => comfyWorkflow(graph), error => expected.test(error.message) && !error.message.includes('PRIVATE_SENTINEL'))
  }
  const missing = comfyLinkedSeedGraph(); delete missing['8'].inputs.seed
  assert.throws(() => comfyWorkflow(missing), /节点 8.*seed.*不存在/)
  const duplicate = comfyWorkflow(comfyGraph())
  duplicate.bindings.seed.push({ ...duplicate.bindings.seed[0] })
  assert.throws(() => comfyWorkflow(duplicate), /映射重复.*节点 5.*seed/)
  const linked = comfyWorkflow(comfyLinkedSeedGraph())
  linked.bindings.seed = [{ node: '5', input: 'seed' }]
  assert.throws(() => comfyWorkflow(linked), /节点 5.*seed.*连接.*源节点/)
  const badPositive = comfyWorkflow(comfyGraph()); badPositive.prompt['3'].inputs.text = 5
  assert.throws(() => comfyWorkflow(badPositive), /节点 3.*text.*字符串/)
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
