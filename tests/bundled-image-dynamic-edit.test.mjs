import test from 'node:test'
import assert from 'node:assert/strict'
import { imagePluginFixture, IMAGE_PNG, imageJson } from './fixtures/image-plugin-runtime.mjs'
import { compactComfySchema } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/comfy-inputs.js'
import { applyComfyReferenceImages } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/comfy-reference-images.js'
import { comfyReferenceCapacity, normalizeImageMentions, applyDynamicLoras } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/comfy-dynamic.js'
import { patchWorkflowGraph, workflowRevision } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/workflow-graph.js'
import { generationMechanism } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/generation-mechanism.js'

const graph = {
  format: 'dsh-tavern-image-v1', name: '动态编辑', outputNode: '6', dynamicImages: true,
  nodeSchemas: {
    LoadImage: { inputs: { image: { type: 'COMBO', imageUpload: true } }, outputs: ['IMAGE', 'MASK'] },
    ImageScale: { inputs: { image: { type: 'IMAGE' }, width: { type: 'INT' } }, outputs: ['IMAGE'] },
    PrimitiveStringMultiline: { inputs: { value: { type: 'STRING' } }, outputs: ['STRING'] },
    Edit: compactComfySchema({ input: { required: { prompt: ['STRING'], images: ['COMFY_AUTOGROW_V3', { template: { input: { required: { image: ['IMAGE'] } }, names: ['image_1', 'image_2', 'image_3'] } }] } }, output: ['IMAGE'] }),
    SaveImage: { inputs: { images: { type: 'IMAGE' } }, outputs: [], outputNode: true },
  },
  prompt: {
    '1': { class_type: 'LoadImage', inputs: { image: 'old.png' } },
    '2': { class_type: 'ImageScale', inputs: { image: ['1', 0], width: 512 } },
    '3': { class_type: 'PrimitiveStringMultiline', inputs: { value: '%prompt' } },
    '4': { class_type: 'Edit', inputs: { prompt: ['3', 0], 'images.image_1': ['2', 0] } },
    '5': { class_type: 'RandomNoise', inputs: { noise_seed: 7 } },
    '6': { class_type: 'SaveImage', inputs: { images: ['4', 0] } },
  }, bindings: { positive: [{ node: '3', input: 'value' }], negative: [], referenceImages: [{ node: '1', input: 'image' }], seed: [{ node: '5', input: 'noise_seed' }], loras: [] },
}

test('single loader expands its image processing branch in source order and leaves saved graph unchanged', () => {
  const before = JSON.stringify(graph)
  const result = applyComfyReferenceImages(graph, ['first.png', 'second.png'])
  const branch = result.prompt['4'].inputs['images.image_2'][0]
  assert.equal(result.prompt[branch].class_type, 'ImageScale')
  const loader = result.prompt[branch].inputs.image[0]
  assert.equal(result.prompt[loader].inputs.image, 'second.png')
  assert.equal(result.prompt['1'].inputs.image, 'first.png')
  assert.equal(comfyReferenceCapacity(graph, graph.bindings.referenceImages), 3)
  assert.equal(JSON.stringify(graph), before)
  assert.equal(normalizeImageMentions('让 image<1> 换上 <image2> 的衣服', 2), '让 <image1> 换上 <image2> 的衣服')
  assert.throws(() => normalizeImageMentions('<image3>', 2), /只提供了 2/)
})

test('character LoRAs add lazy loaders without duplicating base or breaking MODEL/CLIP links', () => {
  const prompt = { root: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model' } },
    sampler: { class_type: 'KSampler', inputs: { model: ['root', 0] } }, text: { class_type: 'CLIPTextEncode', inputs: { clip: ['root', 1] } },
    vae: { class_type: 'VAEDecode', inputs: { vae: ['root', 2] } } }
  const lora = { name: 'person.safetensors', strengthModel: 0.7, strengthClip: 0.6 }
  applyDynamicLoras(prompt, [lora, lora, { ...lora, name: 'coat.safetensors' }])
  assert.equal(Object.values(prompt).filter(node => node.class_type === 'LoraLoader').length, 2)
  const last = prompt.sampler.inputs.model[0]
  assert.equal(prompt[last].inputs.lora_name, 'coat.safetensors')
  assert.deepEqual(prompt.text.inputs.clip, [last, 1])
  assert.deepEqual(prompt.vae.inputs.vae, ['root', 2])
})

test('node editor rewires typed inputs; generation mechanisms preserve one seed for LoRA comparison', () => {
  const next = patchWorkflowGraph(graph, { connections: [{ node: '4', input: 'images.image_2', source: '2', output: 0 }] }, workflowRevision(graph))
  assert.deepEqual(next.prompt['4'].inputs['images.image_2'], ['2', 0])
  assert.throws(() => patchWorkflowGraph(graph, { connections: [{ node: '4', input: 'images.image_2', source: '3', output: 0 }] }, workflowRevision(graph)), /数据类型/)
  const workflow = { ...graph, id: 'test', prompt: { ...graph.prompt, lora: { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'a', strength_model: 1 } } } }
  const structure = { blocks: [{ kind: 'mechanism', title: '对照', mechanism: 'lora_sweep', workflowId: 'test', node: 'lora', weights: '0.4/0.2, 0.8/0.6', seed: 123 }] }
  const recipe = generationMechanism(structure, 'plugin', workflow, 9)
  assert.deepEqual(recipe.map(item => item.seed), [123, 123])
  assert.deepEqual(recipe.map(item => item.loraOverride.strengthModel), [0.4, 0.8])
})

test('image edit route accepts two uploaded sources, submits dynamic nodes and reuses its completed result', async t => {
  const fixture = await imagePluginFixture(t, { config: { promptSystem: 'workbench', jpegOutput: true, imageBackend: 'comfyui', comfyMode: 'workflow', comfyUrl: 'http://localhost:8188', defaultWorkflow: 'edit', promptDefault: null, activePromptPreset: 'stage-edit', promptPresets: [{ id: 'stage-edit', name: '舞台编辑', independent: true, structure: { format: 'natural', purpose: 'edit', targets: [{ kind: 'workflow', id: 'edit' }], blocks: [{ kind: 'scene', title: '编辑指令', text: '' }] } }], workflows: [{ id: 'edit', file: 'workflows/edit.json' }] }, files: { 'workflows/edit.json': graph } })
  const runtime = await fixture.start(), submissions = [], uploads = []
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname
    if (path === '/upload/image') { uploads.push(init.body); return imageJson({ name: 'upload-' + uploads.length + '.png', type: 'input' }) }
    if (path === '/prompt') { submissions.push(JSON.parse(init.body)); return imageJson({ prompt_id: 'edit-' + submissions.length }) }
    if (path.startsWith('/history/')) { const id = path.split('/').pop(); return imageJson({ [id]: { outputs: { '6': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] } }, status: { completed: true, status_str: 'success' } } }) }
    if (path === '/view') return new Response(IMAGE_PNG, { headers: { 'content-type': 'image/png' } })
    return imageJson({ queue_running: [], queue_pending: [] })
  }
  const uploaded = await runtime.request('reference-image', { data: IMAGE_PNG.toString('base64'), mediaType: 'image/png', name: 'source.png' })
  const source = uploaded.body.referenceImage
  const edit = await runtime.request('image-edit', { workflowId: 'edit', sourceImages: [source, source], prompt: '把 image<1> 的背景换成 <image2> 的背景', requestId: 'two-images' })
  assert.equal(edit.status, 200, JSON.stringify(edit.body))
  assert.equal(uploads.length, 2)
  const sent = submissions[0].prompt
  assert.match(sent['3'].inputs.value, /<image1>/)
  assert.ok(sent['4'].inputs['images.image_2'])
  const job = await runtime.terminal(edit.body.jobId)
  assert.equal(job.state, 'done', job.error)
  const again = await runtime.request('image-edit', { workflowId: 'edit', jobId: job.id, prompt: '让 <image1> 的背景变为舞台', requestId: 'edit-result' })
  assert.equal(again.status, 200, JSON.stringify(again.body))
  assert.equal(submissions.length, 2)
  assert.equal(submissions[1].prompt['4'].inputs['images.image_2'], undefined)
})

test('stage uses the same ComfyUI image upload, dynamic graph and persistent job result', async t => {
  let provider
  const fixture = await imagePluginFixture(t, {
    tavern: { apiVersion: 5, attach() {}, promptSection() {}, onTurnSettled() {}, list: async () => [], imageProvider(value) { provider = value; return () => {} } },
    config: { promptSystem: 'workbench', jpegOutput: true, imageBackend: 'comfyui', comfyMode: 'workflow', comfyUrl: 'http://localhost:8188', defaultWorkflow: 'edit', promptDefault: null, activePromptPreset: 'stage-edit', promptPresets: [{ id: 'stage-edit', name: '舞台编辑', independent: true, structure: { format: 'natural', purpose: 'edit', targets: [{ kind: 'workflow', id: 'edit' }], blocks: [{ kind: 'scene', title: '编辑指令', text: '' }] } }], workflows: [{ id: 'edit', file: 'workflows/edit.json' }] }, files: { 'workflows/edit.json': graph },
  })
  const runtime = await fixture.start(), submitted = []
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname
    if (path === '/upload/image') return imageJson({ name: 'stage-source.png', type: 'input' })
    if (path === '/prompt') { submitted.push(JSON.parse(init.body).prompt); return imageJson({ prompt_id: 'stage-edit' }) }
    if (path.startsWith('/history/')) return imageJson({ 'stage-edit': { outputs: { '6': { images: [{ filename: 'stage.png', type: 'output', subfolder: '' }] } }, status: { completed: true, status_str: 'success' } } })
    if (path === '/view') return new Response(IMAGE_PNG, { headers: { 'content-type': 'image/png' } })
    return imageJson({ queue_running: [], queue_pending: [] })
  }
  await runtime.request('state')
  for (let index = 0; index < 100 && !provider; index++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(provider, fixture.logs.join('\n'))
  assert.equal(provider.status().maxReferences, 3)
  assert.ok(provider.models().some(item => item.id === 'template:stage-edit'))
  const result = await provider.generate({ prompt: '给 <image1> 增加舞台灯光', background: 'transparent', references: [{ data: IMAGE_PNG, mediaType: 'image/png' }], modelId: 'template:stage-edit' })
  assert.deepEqual(Buffer.from(result.data), IMAGE_PNG)
  assert.match(submitted[0]['3'].inputs.value, /舞台灯光/)
})

test('template mechanisms execute through the previewed prompt pipeline with bounded per-image seeds', async t => {
  const textGraph = structuredClone(graph)
  textGraph.dynamicImages = false
  textGraph.bindings.referenceImages = []
  delete textGraph.prompt['1']; delete textGraph.prompt['2']; delete textGraph.prompt['4'].inputs['images.image_1']
  const fixture = await imagePluginFixture(t, { config: { imageBackend: 'comfyui', comfyMode: 'workflow', comfyUrl: 'http://localhost:8188', defaultWorkflow: 'text', workflows: [{ id: 'text', file: 'workflows/text.json' }] }, files: { 'workflows/text.json': textGraph } })
  const runtime = await fixture.start(), submitted = []
  globalThis.fetch = async (url, init = {}) => {
    if (new URL(url).pathname === '/prompt') { submitted.push(JSON.parse(init.body).prompt); return imageJson({ prompt_id: 'mechanism-' + submitted.length }) }
    return imageJson({ queue_running: [], queue_pending: [] })
  }
  const input = { text: '舞台背景', target: { kind: 'workflow', id: 'text' }, generationMode: 'text', usage: 'plugin',
    template: { name: '机制', independent: true, structure: { format: 'natural', blocks: [{ kind: 'scene', title: '场景', text: '' }, { kind: 'mechanism', title: '种子对照', mechanism: 'seed_series', count: 2, seed: 123 }] } } }
  const preview = await runtime.request('prompt-preview', input)
  assert.equal(preview.status, 200, JSON.stringify(preview.body))
  const result = await runtime.request('prompt-tryout', { ...input, token: preview.body.result.token, requestId: 'a'.repeat(32), runMechanism: true })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.jobs.length, 2)
  assert.deepEqual(submitted.map(prompt => prompt['5'].inputs.noise_seed), [123, 124])
})
