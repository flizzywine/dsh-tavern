import test from 'node:test'
import assert from 'node:assert/strict'
import { imagePluginFixture, IMAGE_PNG, imageJson } from './fixtures/image-plugin-runtime.mjs'
import { compileJob } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'

const workflow = {
  format: 'dsh-tavern-comfy-v1', name: 'redraw fixture', outputNode: '10',
  prompt: {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'old positive' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative' } },
    '3': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '4': { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 7 } },
    '10': { class_type: 'SaveImage', inputs: { images: ['4', 0] } },
  },
  bindings: {
    positive: [{ node: '1', input: 'text' }], negative: [{ node: '2', input: 'text' }],
    seed: [{ node: '4', input: 'seed' }], size: [{ node: '3' }],
    steps: [{ node: '4', input: 'steps' }], cfg: [{ node: '4', input: 'cfg' }],
  },
}

async function setup(t, files = {}) {
  return imagePluginFixture(t, {
    config: {
      imageBackend: 'comfyui', comfyMode: 'workflow', generationMode: 'text', promptMode: 'tags',
      comfyUrl: 'http://127.0.0.1:8188', defaultWorkflow: 'redraw',
      workflows: [{ id: 'redraw', file: 'workflows/redraw.json', label: 'redraw fixture' }],
      overrideSteps: true,
    },
    files: { 'workflows/redraw.json': workflow, ...files },
  })
}

function mockComfy(t) {
  const calls = [], prompts = []
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input)
    calls.push({ path: url.pathname, method: init.method ?? 'GET' })
    if (url.pathname === '/prompt') {
      const body = JSON.parse(init.body)
      prompts.push({ promptId: body.prompt_id, prompt: body.prompt })
      return imageJson({ prompt_id: body.prompt_id, number: prompts.length })
    }
    if (url.pathname.startsWith('/history/')) {
      const promptId = decodeURIComponent(url.pathname.slice('/history/'.length))
      return imageJson({ [promptId]: { status: { status_str: 'success', completed: true }, outputs: { '10': { images: [{ filename: promptId + '.png', subfolder: '', type: 'output' }] } } } })
    }
    if (url.pathname === '/view') return new Response(IMAGE_PNG, { headers: { 'content-type': 'image/png' } })
    if (url.pathname === '/queue') return imageJson({ queue_running: [], queue_pending: [] })
    throw new Error('unexpected Comfy endpoint: ' + url.pathname)
  }
  return { calls, prompts }
}

test('real runtime 重画沿用 Comfy workflow、参数、尺寸、轮次和人物快照；默认 seed 不显式复用', { timeout: 20000 }, async t => {
  const fixture = await setup(t)
  const runtime = await fixture.start()
  const comfy = mockComfy(t)
  const characterSnapshot = { version: 1, characters: [{ id: 'lin', traits: { face: 'blue eyes' } }] }
  const created = await runtime.request('jobs', {
    key: 'source', tag: 'old prompt', negative: 'no watermark', size: '横图', steps: 31, cfg: 5.5,
    sessionId: 'game-1', turn: 4, textVersion: 'turn-v4', characterSnapshot,
  })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const source = await runtime.terminal(created.body.id)
  assert.equal(source.state, 'done')
  const savedSource = (await fixture.read('jobs-store.json'))[source.id]
  const sourcePrompt = comfy.prompts[0]
  assert.equal(sourcePrompt.prompt['1'].inputs.text, 'old prompt')
  assert.equal(sourcePrompt.prompt['2'].inputs.text, 'no watermark')
  assert.equal(sourcePrompt.prompt['3'].inputs.width, 768)
  assert.equal(sourcePrompt.prompt['3'].inputs.height, 512)
  assert.equal(sourcePrompt.prompt['4'].inputs.seed, savedSource.seed)
  assert.equal(sourcePrompt.prompt['4'].inputs.steps, 31)
  assert.equal(sourcePrompt.prompt['4'].inputs.cfg, 5.5)

  const redraw = await runtime.request('redraw', { jobId: source.id, prompt: 'new prompt' })
  assert.equal(redraw.status, 200, JSON.stringify(redraw.body))
  const replacementId = redraw.body.jobId
  for (let i = 0; i < 100 && comfy.prompts.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(comfy.prompts.length, 2, 'redraw POSTs a second Comfy prompt')
  const saved = await fixture.read('jobs-store.json')
  assert.ok(saved[source.id], 'original job remains in durable history')
  assert.ok(saved[replacementId], 'replacement is persisted')
  assert.equal(saved[replacementId].workflowId, savedSource.workflowId)
  assert.ok(Number.isSafeInteger(saved[replacementId].seed) && saved[replacementId].seed >= 0 && saved[replacementId].seed < 2 ** 47)
  assert.equal(saved[replacementId].params.size, savedSource.params.size)
  assert.equal(saved[replacementId].params.steps, savedSource.params.steps)
  assert.equal(saved[replacementId].params.cfg, savedSource.params.cfg)
  assert.equal(saved[replacementId].params.rawTag, 'new prompt')
  assert.equal(savedSource.params.seed, undefined, 'random workflow seed is not written as an explicit reuse parameter')
  assert.equal(saved[replacementId].params.seed, undefined, 'redraw does not pass the source seed back into compilation')
  assert.equal(saved[replacementId].gameId, savedSource.gameId)
  assert.equal(saved[replacementId].turn, savedSource.turn)
  assert.equal(saved[replacementId].textVersion, savedSource.textVersion)
  assert.deepEqual(saved[replacementId].characterSnapshot, savedSource.characterSnapshot)
  assert.equal(comfy.prompts[1].prompt['1'].inputs.text, 'new prompt')
  assert.equal(comfy.prompts[1].prompt['2'].inputs.text, 'no watermark')
  assert.equal(comfy.prompts[1].prompt['3'].inputs.width, 768)
  assert.equal(comfy.prompts[1].prompt['3'].inputs.height, 512)
  assert.equal(comfy.prompts[1].prompt['4'].inputs.seed, saved[replacementId].seed)
  assert.equal(comfy.prompts[1].prompt['4'].inputs.steps, 31)
  assert.equal(comfy.prompts[1].prompt['4'].inputs.cfg, 5.5)
})

test('workflow.fixedSeed 仍高于默认随机 seed', () => {
  const fixedSeed = 246813579
  const compiled = compileJob({ workflow: { ...workflow, fixedSeed },
    config: { imageBackend: 'comfyui', promptMode: 'tags', negativeMode: 'merge', weightMode: 'keep' },
    params: { tag: 'fixed seed prompt' }, definitions: {} })
  assert.equal(compiled.seed, fixedSeed)
  assert.equal(compiled.prompt['4'].inputs.seed, fixedSeed)
})

test('缺失 workflow 和 retired simple 作业返回可读错误且不提交 Comfy', { timeout: 20000 }, async t => {
  for (const [name, workflowId, message] of [
    ['missing', 'removed-workflow', /原 ComfyUI 工作流已不存在/],
    ['simple', 'simple-flux', /简易模式/],
  ]) await t.test(name, async t => {
    const jobId = '11111111-1111-4111-8111-111111111111'
    const fixture = await setup(t, { 'jobs-store.json': { [jobId]: {
      id: jobId, backend: 'comfyui', state: 'done', workflowId, comfyEndpoint: 'http://127.0.0.1:8188',
      params: { rawTag: 'saved prompt', tag: 'saved prompt', size: '竖图' }, promptText: 'saved prompt',
      seed: 77, createdAt: 1, gameId: 'game-1', turn: 1, textVersion: 'v1',
    } } })
    const runtime = await fixture.start()
    const comfy = mockComfy(t)
    const result = await runtime.request('redraw', { jobId, prompt: 'try redraw' })
    assert.equal(result.status, 400)
    assert.match(result.body.error, message)
    assert.deepEqual(comfy.calls, [])
    assert.deepEqual(comfy.prompts, [])
  })
})
