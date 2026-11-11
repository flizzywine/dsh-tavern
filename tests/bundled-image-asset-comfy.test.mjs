import test from 'node:test'
import assert from 'node:assert/strict'
import { imagePluginFixture, IMAGE_PNG, imageJson } from './fixtures/image-plugin-runtime.mjs'

const graph = {
  format: 'dsh-tavern-comfy-v1', name: 'asset fixture', outputNode: '10',
  prompt: {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'old positive' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative' } },
    '3': { class_type: 'EmptyLatentImage', inputs: { width: 64, height: 64, batch_size: 1 } },
    '4': { class_type: 'KSampler', inputs: { seed: 1, steps: 2, cfg: 2 } },
    '8': { class_type: 'LoadImage', inputs: { image: 'stale.png' } },
    '10': { class_type: 'SaveImage', inputs: { images: ['4', 0] } },
  },
  bindings: { positive: [{ node: '1', input: 'text' }], negative: [{ node: '2', input: 'text' }], seed: [{ node: '4', input: 'seed' }], size: [{ node: '3' }], referenceImages: [{ node: '8', input: 'image' }] },
}

test('the stage image provider renders raw reference pictures through the selected ComfyUI workflow as PNG', { timeout: 20000 }, async t => {
  let provider
  const tavern = new Proxy({ imageProvider(value) { provider = value; return () => {} } }, { get: (target, key) => key in target ? target[key] : () => () => {} })
  const fixture = await imagePluginFixture(t, {
    tavern,
    config: { imageBackend: 'comfyui', comfyMode: 'workflow', comfyUrl: 'http://127.0.0.1:8188', defaultWorkflow: 'asset', workflows: [{ id: 'asset', file: 'workflows/asset.json', label: 'asset fixture' }] },
    files: { 'workflows/asset.json': graph },
  })
  await fixture.start()
  for (let i = 0; i < 200 && !provider; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(provider, 'the plugin registers its image provider')
  assert.deepEqual(provider.status(), { ready: true, model: 'asset fixture', maxReferences: 1 })
  const calls = [], uploads = []; let submitted
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input)
    calls.push(url.pathname)
    if (url.pathname === '/upload/image') { uploads.push(Buffer.from(await init.body.get('image').arrayBuffer())); return imageJson({ name: 'ref.png', subfolder: '', type: 'input' }) }
    if (url.pathname === '/prompt') submitted = JSON.parse(init.body).prompt
    if (url.pathname === '/prompt') return imageJson({ prompt_id: JSON.parse(init.body).prompt_id, number: 1 })
    if (url.pathname.startsWith('/history/')) {
      const id = decodeURIComponent(url.pathname.split('/').pop())
      return imageJson({ [id]: { status: { completed: true }, outputs: { 10: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } } })
    }
    if (url.pathname === '/view') return new Response(IMAGE_PNG, { headers: { 'content-type': 'image/png' } })
    return imageJson({ queue_running: [], queue_pending: [] })
  }
  const result = await provider.generate({ prompt: 'a lone traveler', references: [{ data: new Uint8Array(IMAGE_PNG), mediaType: 'image/png' }], width: 128, height: 192, background: 'transparent' })
  assert.equal(result.mediaType, 'image/png')
  assert.deepEqual(Buffer.from(result.data), IMAGE_PNG)
  assert.deepEqual(uploads, [IMAGE_PNG])
  assert.ok(calls.includes('/prompt'))
  assert.equal(submitted['8'].inputs.image, 'ref.png')
  assert.match(submitted['1'].inputs.text, /a lone traveler/)
  assert.doesNotMatch(submitted['1'].inputs.text, /参考图/)
  assert.deepEqual([submitted['3'].inputs.width, submitted['3'].inputs.height], [128, 192])
  // A workflow with a reference input must not silently reuse its stale imported picture.
  await assert.rejects(provider.generate({ prompt: 'no refs' }), /参考图输入/)
})