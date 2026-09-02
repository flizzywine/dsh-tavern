import assert from 'node:assert/strict'
import test from 'node:test'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'

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
