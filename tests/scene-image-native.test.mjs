import assert from 'node:assert/strict'
import test from 'node:test'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'

test('真实 DSH 子 Agent 调用生图工具，HTTP 返回图经宿主校验落盘，前台不新增消息', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE)
  t.after(() => runtime.dispose())
  const before = runtime.parent.agent.session.events.length
  const initial = await runtime.service.status('scene-parent', 1)
  await runtime.service.start('scene-parent', 1, initial.key)
  let status
  for (let n = 0; n < 300; n++) {
    status = await runtime.service.status('scene-parent', 1)
    if (status.status !== 'running') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(status.status, 'succeeded', status.error)
  assert.equal(runtime.imageRequests.length, 1)
  assert.match(runtime.imageRequests[0].prompt, /window/)
  assert.equal(runtime.requests.length, 2)
  assert.deepEqual(runtime.requests[0].tools.map(tool => tool.name), ['submit_scene_plan'])
  assert.equal(runtime.requests[1].tools?.length || 0, 0)
  assert.match(JSON.stringify(runtime.requests[0]), /左手轻轻搭着窗框/)
  assert.equal(runtime.parent.agent.session.events.length, before)
  assert.equal(JSON.stringify(runtime.chat), runtime.before)
  await runtime.restart()
  const image = await runtime.service.readImage('scene-parent', 1, initial.key)
  assert.equal(image.ref.mediaType, 'image/png')
  assert.ok(image.data.length > 0)
})
