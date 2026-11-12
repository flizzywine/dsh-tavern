import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { imagePluginFixture, IMAGE_PNG, imageJson } from './fixtures/image-plugin-runtime.mjs'
import { scanWorkflowLoras, applyWorkflowLora, loraOrderPairs } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/comfy-lora.js'

const graph = {
  format: 'dsh-tavern-image-v1', name: 'LoRA 对照', outputNode: '9',
  prompt: {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'scene' } },
    '2': { class_type: 'LoraLoader', inputs: { lora_name: 'first.safetensors', strength_model: 0.6, strength_clip: 0.5 } },
    '3': { class_type: 'LoraLoader', inputs: { model: ['2', 0], clip: ['2', 1], lora_name: 'second.safetensors', strength_model: 0.8, strength_clip: 0.7 } },
    '4': { class_type: 'KSampler', inputs: { seed: 123, steps: 1, cfg: 4 } },
    '9': { class_type: 'SaveImage', inputs: { images: ['4', 0] } },
    '10': { class_type: 'PreviewImage', inputs: { images: ['4', 0] } },
  },
  bindings: { positive: [{ node: '1', input: 'text' }], seed: [{ node: '4', input: 'seed' }], loras: [] },
}

test('LoRA stack slots retain their graph shape and independent model/CLIP weights', () => {
  const prompt = {
    a: { class_type: 'Power Lora Loader', inputs: { lora_1: { lora: 'power', strength: 1, strengthTwo: 0.5, on: true, custom: 9 } } },
    b: { class_type: 'LoraManager', inputs: { loras: { __value__: [{ name: 'stack', strength: 1, clipStrength: 1, active: true }] } } },
    c: { class_type: 'Lora Stacker', inputs: { lora_name_1: 'stacker', model_weight_1: 0.7, clip_weight_1: 0.4 } },
    d: { class_type: 'LoraTagLoader', inputs: { text: 'keep, <lora:first:0.4>, <lora:second:0.8:0.5>, end' } },
  }
  const bindings = scanWorkflowLoras(prompt)
  assert.equal(bindings.length, 5)
  applyWorkflowLora(prompt, { ...bindings[0], strengthModel: 0.2, strengthClip: 0.3 })
  applyWorkflowLora(prompt, { ...bindings[1], enabled: false })
  applyWorkflowLora(prompt, { ...bindings[2], strengthModel: 0 })
  assert.deepEqual(prompt.a.inputs.lora_1, { lora: 'power', strength: 0.2, strengthTwo: 0.3, on: true, custom: 9 })
  assert.equal(prompt.b.inputs.loras.__value__[0].active, false)
  assert.equal(prompt.c.inputs.model_weight_1, 0)
  assert.equal(prompt.c.inputs.clip_weight_1, 0.4)
  applyWorkflowLora(prompt, { ...bindings[3], strengthModel: 0.2, strengthClip: 0.3 })
  applyWorkflowLora(prompt, { ...bindings[4], enabled: false })
  assert.equal(prompt.d.inputs.text, 'keep, <lora:first:0.2:0.3>, <lora:second:0:0>, end')
  assert.deepEqual(loraOrderPairs(graph.prompt, scanWorkflowLoras(graph.prompt)), [['2', '3']])
})

test('multiple unnamed ComfyUI API imports keep separate files, bindings and the original default after restart', async t => {
  const fixture = await imagePluginFixture(t, { config: { imageBackend: 'comfyui', comfyMode: 'workflow' } })
  const runtime = await fixture.start()
  globalThis.fetch = async () => imageJson({})
  const makeGraph = text => ({ ...graph.prompt, '1': { class_type: 'CLIPTextEncode', inputs: { text: '%prompt ' + text } } })
  const first = await runtime.request('workflow-import', { workflow: makeGraph('original') })
  assert.equal(first.status, 200, JSON.stringify(first.body))
  const original = (await runtime.request('state')).body.workflows.find(item => item.current)
  const others = await Promise.all(['second', 'third'].map(text => runtime.request('workflow-import', { workflow: makeGraph(text) })))
  for (const imported of others) assert.equal(imported.status, 200, JSON.stringify(imported.body))
  const files = [first, ...others].map(result => result.body.file)
  assert.equal(new Set(files).size, 3)
  assert.match((await fixture.read('workflows/' + files[0])).prompt['1'].inputs.text, /original/)
  const detail = await runtime.request('workflow-graph', { file: files[1] })
  const save = await runtime.request('workflow-graph', { file: files[1], revision: detail.body.revision, patch: { outputNode: '10' } })
  assert.equal(save.status, 200, JSON.stringify(save.body))
  runtime.close()
  const reopened = await fixture.start()
  const state = (await reopened.request('state')).body
  assert.equal(state.workflows.length, 3)
  assert.equal(new Set(state.workflows.map(item => item.id)).size, 3)
  assert.equal(new Set(state.workflows.map(item => item.label)).size, 3)
  assert.equal(state.workflows.find(item => item.current).id, original.id)
  assert.equal((await fixture.read('workflows/' + files[0])).outputNode, '9')
  assert.equal((await fixture.read('workflows/' + files[1])).outputNode, '10')
  assert.equal((await fixture.read('workflows/' + files[2])).outputNode, '9')
})

test('workflow preflight does not write files; LoRA ordering and series compile through real job routes', async t => {
  const fixture = await imagePluginFixture(t, {
    config: { imageBackend: 'comfyui', comfyMode: 'workflow', generationMode: 'text',
      defaultWorkflow: 'series', workflows: [{ id: 'series', file: 'workflows/series.json' }] },
    files: { 'workflows/series.json': graph },
  })
  const runtime = await fixture.start()
  const sent = []
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname
    if (path === '/prompt') {
      sent.push(JSON.parse(init.body))
      return imageJson({ prompt_id: 'series-' + sent.length })
    }
    return imageJson({ queue_running: [], queue_pending: [] })
  }
  const preflight = await runtime.request('workflow-import', { workflow: graph.prompt, filename: 'LoRA试跑.json', preview: true })
  assert.equal(preflight.status, 200, JSON.stringify(preflight.body))
  assert.equal(preflight.body.name, 'LoRA试跑')
  assert.equal(preflight.body.outputs.length, 2)
  assert.deepEqual((await fixture.read('workflows/series.json')).prompt, graph.prompt)
  const swap = await runtime.request('workflow-bindings', { file: 'series.json', patch: { loraSwap: ['2', '3'] } })
  assert.equal(swap.status, 200, JSON.stringify(swap.body))
  assert.equal(swap.body.workflow.bindings.loras[0].name, 'second.safetensors')
  assert.deepEqual(swap.body.workflow.prompt, graph.prompt)
  const input = { workflowId: 'series', lora: '2', tag: 'portrait of a traveler', seed: 456,
    weights: [[0.2, 0.3], [0.9, 0.8]], requestId: 'c'.repeat(32) }
  const series = await runtime.request('workflow-series', input)
  assert.equal(series.status, 200, JSON.stringify(series.body))
  assert.equal(series.body.jobs.length, 2)
  assert.equal(sent.length, 2)
  assert.deepEqual(sent.map(item => item.prompt['4'].inputs.seed), [456, 456])
  assert.deepEqual(sent.map(item => [item.prompt['2'].inputs.strength_model, item.prompt['2'].inputs.strength_clip]), [[0.2, 0.3], [0.9, 0.8]])
  assert.deepEqual(sent.map(item => item.prompt['2'].inputs.lora_name), ['second.safetensors', 'second.safetensors'])
  const again = await runtime.request('workflow-series', input)
  assert.equal(again.status, 200, JSON.stringify(again.body))
  assert.deepEqual(again.body.jobs.map(job => job.id), series.body.jobs.map(job => job.id))
  assert.equal(sent.length, 2)
})

test('gallery trash and favorites persist and restore without deleting the image', async t => {
  const fixture = await imagePluginFixture(t)
  const runtime = await fixture.start()
  globalThis.fetch = async url => String(url).endsWith('/generateImage')
    ? imageJson({ data: { id: 'archive', status: 'completed', outputs: ['https://images.example.test/out.png'] } })
    : new Response(IMAGE_PNG)
  const start = await runtime.request('jobs', { tag: 'tree by the river' })
  const job = await runtime.terminal(start.body.id)
  assert.equal(job.state, 'done')
  assert.equal((await runtime.request('gallery-item', { id: job.id, operation: 'favorite' })).status, 200)
  assert.equal((await runtime.request('history?gallery=favorite')).body.jobs[0].favorite, true)
  assert.equal((await runtime.request('gallery-item', { id: job.id, operation: 'trash' })).status, 200)
  assert.equal((await runtime.request('history')).body.jobs.length, 0)
  const restarted = await fixture.start()
  assert.equal((await restarted.request('history?gallery=trash')).body.jobs[0].id, job.id)
  assert.equal((await restarted.request('jobs?id=' + job.id + '&image=1')).status, 200)
  assert.equal((await restarted.request('gallery-item', { id: job.id, operation: 'restore' })).status, 200)
  assert.equal((await restarted.request('history?gallery=favorite')).body.jobs[0].id, job.id)
  assert.equal((await restarted.request('history?gallery=trash')).body.jobs.length, 0)
})


test('gallery permanently deletes single, selected and all trash beyond the history page, without resurrection', async t => {
  const fixture = await imagePluginFixture(t)
  const cache = join(fixture.pluginRoot, 'cache')
  await mkdir(cache, { recursive: true })
  const stored = {}
  for (let index = 0; index < 67; index++) {
    const id = '00000000-0000-4000-8000-' + String(index).padStart(12, '0')
    const file = join(cache, id + '.img')
    await writeFile(file, IMAGE_PNG)
    stored[id] = { id, file, state: 'done', byteLength: IMAGE_PNG.length, createdAt: index + 1,
      source: index === 66 ? 'card' : 'play', key: 'gallery-' + index, positive: 'tree',
      trashedAt: index === 65 ? null : 1, favorite: index === 65 }
  }
  const ids = Object.keys(stored), trash = ids.slice(0, 65)
  await writeFile(join(fixture.pluginRoot, 'jobs-store.json'), JSON.stringify(stored))
  await writeFile(join(fixture.pluginRoot, 'plans-store.json'), JSON.stringify({ scene: { plans: ids.map(jobId => ({ jobId })) } }))
  const runtime = await fixture.start()
  assert.equal((await runtime.request('history?source=play&gallery=trash')).body.jobs.length, 60)
  // Ordinary gallery images and card workbench images must remain untouched.
  assert.equal((await runtime.request('gallery-delete', { ids: [ids[65]] })).status, 409)
  assert.equal((await runtime.request('gallery-delete', { ids: [ids[66]] })).status, 409)
  const single = await runtime.request('gallery-delete', { ids: [trash[0]] })
  assert.deepEqual(single.body, { ok: true, deleted: [trash[0]], failed: [] })
  assert.equal((await runtime.request('jobs?id=' + trash[0] + '&image=1')).status, 404)
  assert.equal((await runtime.request('jobs?key=gallery-0')).status, 404)
  const batch = await runtime.request('gallery-delete', { ids: trash.slice(1, 3) })
  assert.deepEqual(batch.body.deleted, trash.slice(1, 3))
  const clear = await runtime.request('gallery-delete', { all: true })
  assert.equal(clear.body.deleted.length, 62, 'clear includes trash outside the first 60 history entries')
  assert.deepEqual(clear.body.failed, [])
  for (const id of trash) await assert.rejects(access(stored[id].file), { code: 'ENOENT' })
  assert.deepEqual(Object.keys(await fixture.read('jobs-store.json')).sort(), ids.slice(65).sort())
  assert.deepEqual((await fixture.read('plans-store.json')).scene.plans.map(item => item.jobId), ids.slice(65))
  runtime.close()
  const restarted = await fixture.start()
  assert.equal((await restarted.request('history?source=play&gallery=trash')).body.jobs.length, 0)
  assert.equal((await restarted.request('history?source=play&gallery=favorite')).body.jobs[0].id, ids[65])
  assert.equal((await restarted.request('jobs?id=' + ids[66] + '&image=1')).status, 200)
})

test('gallery deletion keeps failed items available instead of reporting false success', async t => {
  const fixture = await imagePluginFixture(t)
  const file = join(fixture.pluginRoot, 'cache', 'blocked.img')
  await mkdir(file, { recursive: true })
  const job = { id: 'blocked', file, state: 'done', source: 'play', trashedAt: 1, positive: 'tree' }
  await writeFile(join(fixture.pluginRoot, 'jobs-store.json'), JSON.stringify({ blocked: job }))
  const runtime = await fixture.start()
  const result = await runtime.request('gallery-delete', { ids: ['blocked'] })
  assert.deepEqual(result.body.deleted, [])
  assert.equal(result.body.failed[0].id, 'blocked')
  assert.ok(result.body.failed[0].error)
  assert.equal((await runtime.request('history?source=play&gallery=trash')).body.jobs[0].id, 'blocked')
})
