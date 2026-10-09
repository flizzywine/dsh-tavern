import { zipText } from './fixtures/zip-text.mjs'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'
import { SCENE_IMAGE_CHANNELS } from '../tavern-plugin/lib/domain/scene-image-channels.js'
import { comfyGraph } from './fixtures/scene-image-comfy-workflow.mjs'

test('显式单人参考跨轮与重启传给 Gemini，取消后不再发送，也不进入文字轨迹或日志字节', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE)
  t.after(() => runtime.dispose())
  await runtime.service.configure({ provider: 'gemini', model: 'gemini-3.1-flash-image', baseURL: runtime.endpoint, apiKey: 'fixture-reference-key' })
  await runtime.service.configure({ enabled: true })
  runtime.chat.settleStatus = 'done'
  const message = runtime.chat.messages[0]
  Object.assign(message, { sourceText: '林岚站在窗边。', swipes: ['林岚站在窗边。'], swipeId: 0, mvu: { pending: false },
    variables: [{ stat_data: { 人物: { 林岚: { 衣着: '青色外套' } } } }] })
  runtime.useVisualState()
  const before = sessionEvents(runtime.parent.agent.session).length
  async function finish(turn, options) {
    const target = await runtime.service.status('scene-parent', turn)
    await runtime.service.start('scene-parent', turn, target.key, options)
    for (let index = 0; index < 300; index++) {
      const status = await runtime.service.status('scene-parent', turn)
      if (status.status !== 'running' && !runtime.agentRunning) { assert.equal(status.status, 'succeeded', status.error); return status }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.fail('reference fixture timed out')
  }
  const first = await finish(1)
  assert.equal(first.versions[0].referencePerson, '林岚')
  await runtime.service.setReference('scene-parent', 1, first.key, first.versions[0].id, first.reference.gateway)
  assert.equal(runtime.imageRequests.length, 1, 'binding alone does not request an image')
  assert.equal(runtime.imageRequests[0].input.some(item => item.type === 'image'), false)
  runtime.chat.messages.push({ ...structuredClone(message), turn: 2, greeting: false, sourceText: '林岚来到窗前，回头微笑。', swipes: ['林岚来到窗前，回头微笑。'] })
  await runtime.restart()
  const second = await finish(2)
  const image = runtime.imageRequests[1].input.find(item => item.type === 'image')
  assert.ok(image?.data)
  assert.equal(image.mime_type, 'image/png')
  assert.equal(second.versions[0].referenceImages[0].source.versionId, first.versions[0].id)
  assert.equal(second.versions[0].referenceImages[0].person.name, '林岚')
  assert.equal(JSON.stringify(runtime.requests).includes(image.data.slice(0, 100)), false)
  assert.equal(zipText((await runtime.exportLogs()).buffer).includes(image.data.slice(0, 100)), false)
  await runtime.service.configure({ provider: 'openai' })
  await runtime.service.configure({ enabled: true })
  assert.match((await runtime.service.status('scene-parent', 2)).reference.warning, /仅使用文字/)
  await runtime.service.configure({ enabled: false })
  const current = await runtime.service.status('scene-parent', 1)
  assert.ok(current.reference.versions.includes(first.versions[0].id), 'can revoke even when disabled or using an unsupported channel')
  await runtime.service.setReference('scene-parent', 1, first.key, first.versions[0].id, current.reference.gateway, false)
  await runtime.service.configure({ provider: 'gemini' })
  await runtime.service.configure({ enabled: true })
  const textRequests = runtime.requests.length
  await finish(2, { kind: 'repaint', versionId: second.versions[0].id })
  assert.equal(runtime.imageRequests[2].input.some(item => item.type === 'image'), false)
  assert.equal(runtime.requests.length, textRequests)
  assert.equal(sessionEvents(runtime.parent.agent.session).length, before)
})

test('九种协议通过真实 DSH 子任务；附件失败后重启仅保存，不再请求文字或图片', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE)
  t.after(() => runtime.dispose())
  const before = sessionEvents(runtime.parent.agent.session).length
  let count = 0
  for (const { id: provider } of SCENE_IMAGE_CHANNELS) {
    await runtime.service.configure({ provider, baseURL: runtime.endpoint, ...(provider === 'comfyui' ? { workflow: comfyGraph() } : {}), ...(provider === 'banana' ? { model: 'fixture-custom-image' } : {}), ...(['webui', 'comfyui'].includes(provider) ? {} : { apiKey: 'fixture-' + provider }) })
    await runtime.service.configure({ enabled: true })
    assert.equal(runtime.imageRequests.length, count)
    runtime.chat.messages.push({ role: 'assistant', turn: count + 2, sourceText: '她站在窗边看雨。' })
    const target = await runtime.service.status('scene-parent', count + 2)
    runtime.failNextSave()
    await runtime.service.start('scene-parent', count + 2, target.key)
    let result
    for (let n = 0; n < 300; n++) {
      result = await runtime.service.status('scene-parent', count + 2)
      if (result.status !== 'running' && !runtime.agentRunning) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(result.status, 'failed', provider + ': must reach injected attachment failure')
    assert.equal(result.recovery, 'save')
    const textCount = runtime.requests.length
    await runtime.service.configure({ enabled: false })
    await runtime.restart()
    await runtime.service.retrySave('scene-parent', count + 2, target.key, result.requestId)
    for (let n = 0; n < 300; n++) {
      result = await runtime.service.status('scene-parent', count + 2)
      if (result.status !== 'running' && !runtime.agentRunning) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(result.status, 'succeeded', provider + ': ' + result.error)
    assert.equal(runtime.requests.length, textCount, 'saving must not call the Agent again')
    assert.equal(result.versions.at(-1).configuration.provider, provider)
    if (provider === 'webui') {
      assert.equal((await runtime.service.settings()).hasKey, false)
      assert.equal(result.versions.at(-1).model, 'fixture-server-model')
      assert.equal(result.versions.at(-1).generation.seed, 42)
    }
    if (provider === 'novelai') {
      const generation = result.versions.at(-1).generation
      assert.equal(generation.request.action, 'generate')
      assert.equal(generation.request.parameters.n_samples, 1)
      assert.equal(generation.request.parameters.seed, generation.seed)
      assert.match(generation.request.input, /window/)
      assert.equal(generation.request.parameters.v4_prompt.caption.char_captions.length, 0)
      assert.equal(JSON.stringify(generation).includes('fixture-novelai'), false)
    }
    if (provider === 'comfyui') {
      assert.equal((await runtime.service.settings()).hasKey, false)
      assert.equal(runtime.imageRequests.at(-1).prompt['2'].inputs.batch_size, 1)
      assert.equal(result.versions.at(-1).generation.promptId, runtime.imageRequests.at(-1).prompt_id)
      assert.equal(result.providerTask.state, 'succeeded')
    }
    await runtime.restart()
    assert.equal((await runtime.service.readImage('scene-parent', count + 2, target.key)).ref.mediaType, 'image/png')
    assert.equal(runtime.imageRequests.length, ++count)
    assert.equal(sessionEvents(runtime.parent.agent.session).length, before)
  }
})
