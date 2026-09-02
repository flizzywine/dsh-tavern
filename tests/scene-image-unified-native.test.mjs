import assert from 'node:assert/strict'
import test from 'node:test'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'

async function promptly(promise, label) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' blocked by image request')), 1000) })])
  } finally { clearTimeout(timer) }
}

test('慢速生图不阻塞状态和关闭设置，关闭后仍可取消且不重发', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE, { unifiedPlugin: true })
  t.after(() => runtime.dispose())
  const target = await runtime.service.status('scene-parent', 1)
  runtime.holdNextImage()
  const started = await runtime.service.start('scene-parent', 1, target.key)
  try {
    for (let n = 0; n < 100 && !runtime.imageRequests.length; n++) await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(runtime.imageRequests.length, 1, 'must reach the deliberately stalled image HTTP request')
    const status = await promptly(runtime.service.status('scene-parent', 1), 'status')
    assert.equal(status.status, 'running')
    const disabled = await promptly(runtime.service.configure({ enabled: false }), 'disable')
    assert.equal(disabled.enabled, false)
    assert.equal((await promptly(runtime.service.settings(), 'settings')).enabled, false)
  } finally { await promptly(runtime.service.cancel('scene-parent', 1, target.key, started.requestId), 'cancel') }
  let result
  for (let n = 0; n < 100; n++) {
    result = await promptly(runtime.service.status('scene-parent', 1), 'cancelled status')
    if (result.status !== 'running') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(result.status, 'cancelled')
  await runtime.restart()
  assert.equal((await runtime.service.settings()).enabled, false)
  assert.equal(runtime.imageRequests.length, 1)
})

test('统一设置 → 插件生成 → 真实 DSH 附件，关闭和重启不丢图或重复生成', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE, { unifiedPlugin: true })
  t.after(() => runtime.dispose())
  const before = runtime.parent.agent.session.events.length
  await runtime.service.configure({ provider: 'grok', baseURL: runtime.endpoint, model: 'fixture-grok-image', apiKey: 'fixture-key' })
  await runtime.service.configure({ enabled: true })
  const target = await runtime.service.status('scene-parent', 1)
  await runtime.service.start('scene-parent', 1, target.key)
  let result
  for (let index = 0; index < 300; index++) {
    result = await runtime.service.status('scene-parent', 1)
    if (result.status !== 'running') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(result.status, 'succeeded', result.error)
  assert.equal(runtime.imageRequests.length, 1)
  assert.equal(runtime.imageRequests[0].model, 'fixture-grok-image')
  assert.equal(runtime.imageRequests[0].resolution, '1k')
  assert.equal(runtime.parent.agent.session.events.length, before)
  assert.equal(JSON.stringify(runtime.chat), runtime.before)
  await runtime.service.configure({ enabled: false })
  await runtime.restart()
  const config = await runtime.service.settings()
  assert.equal(config.enabled, false)
  assert.equal(config.model, 'fixture-grok-image')
  assert.equal(config.hasKey, true)
  const image = await runtime.service.readImage('scene-parent', 1, target.key)
  assert.equal(image.ref.mediaType, 'image/png')
  assert.ok(image.data.length)
  assert.equal(runtime.imageRequests.length, 1)
})

test('生图读取参考、提交方案、调整图片的 Schema 在真实模型边界均有效', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE, { unifiedPlugin: true })
  t.after(() => runtime.dispose())
  runtime.chat.cardContextSnapshotVersion = 5
  runtime.chat.cardContextSnapshot = '【故事设定 · 人物卡】\n名字: 林岚\n\n设定: 林岚留着黑色短发。'
  runtime.lookupReferences('林岚')
  const target = await runtime.service.status('scene-parent', 1)
  async function finish(options) {
    await runtime.service.start('scene-parent', 1, target.key, options)
    for (let n = 0; n < 300; n++) {
      const status = await runtime.service.status('scene-parent', 1)
      if (status.status !== 'running') { assert.equal(status.status, 'succeeded', status.error); return status }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.fail('image task timed out')
  }
  const first = await finish()
  await finish({ kind: 'adjust', versionId: first.versions[0].id, instruction: '改成雨夜近景' })
  const observed = new Map(runtime.requests.flatMap(request => (request.tools || []).map(tool => [tool.name, tool.parameters])))
  for (const [name, property] of [['read_scene_reference', 'query'], ['submit_scene_plan', 'plan'], ['submit_image_adjustment', 'update']]) {
    const schema = observed.get(name)
    assert.equal(schema?.type, 'object', name)
    assert.ok(schema.properties[property], name)
    assert.deepEqual(schema.required, [property], name)
  }
  assert.equal(runtime.imageRequests.length, 2)
})
