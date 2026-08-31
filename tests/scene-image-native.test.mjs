import assert from 'node:assert/strict'
import test from 'node:test'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'
import { SCENE_IMAGE_CHANNELS } from '../tavern-plugin/lib/domain/scene-image-channels.js'

test('六种云端协议均通过真实 DSH 子任务和附件持久化，渠道配置不会自动收费', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE)
  t.after(() => runtime.dispose())
  const before = runtime.parent.agent.session.events.length
  let count = 0
  for (const { id: provider } of SCENE_IMAGE_CHANNELS) {
    await runtime.service.configure({ provider, baseURL: runtime.endpoint, ...(provider === 'banana' ? { model: 'fixture-relay-image' } : {}), apiKey: 'fixture-' + provider })
    await runtime.service.configure({ enabled: true })
    assert.equal(runtime.imageRequests.length, count)
    runtime.chat.messages.push({ role: 'assistant', turn: count + 2, sourceText: '她站在窗边看雨。' })
    const target = await runtime.service.status('scene-parent', count + 2)
    await runtime.service.start('scene-parent', count + 2, target.key)
    let result
    for (let n = 0; n < 300; n++) {
      result = await runtime.service.status('scene-parent', count + 2)
      if (result.status !== 'running') break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(result.status, 'succeeded', provider + ': ' + result.error)
    assert.equal(result.versions.at(-1).configuration.provider, provider)
    await runtime.restart()
    assert.equal((await runtime.service.readImage('scene-parent', count + 2, target.key)).ref.mediaType, 'image/png')
    assert.equal(runtime.imageRequests.length, ++count)
    assert.equal(runtime.parent.agent.session.events.length, before)
  }
})

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
  const originalVersion = status.versions[0].id
  async function finish(options) {
    await runtime.service.start('scene-parent', 1, initial.key, options)
    for (let n = 0; n < 300; n++) {
      const next = await runtime.service.status('scene-parent', 1)
      if (next.status !== 'running') { assert.equal(next.status, 'succeeded', next.error); return next }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.fail('native image flow did not complete')
  }
  const repaint = await finish({ kind: 'repaint', versionId: originalVersion })
  assert.equal(runtime.requests.length, 2, 'repaint must not call the text model')
  assert.equal(runtime.imageRequests.length, 2)
  assert.equal(repaint.versions.length, 2)
  const adjusted = await finish({ kind: 'adjust', versionId: originalVersion, instruction: '改成雨夜近景' })
  assert.equal(runtime.requests.length, 4)
  assert.equal(runtime.imageRequests.length, 3)
  assert.deepEqual(runtime.requests[2].tools.map(tool => tool.name), ['submit_image_adjustment'])
  assert.doesNotMatch(JSON.stringify(runtime.requests[2].messages), /左手轻轻搭着窗框/)
  assert.match(runtime.imageRequests[2].prompt, /close-up/)
  assert.equal(adjusted.versions.length, 3)
  assert.equal(runtime.parent.agent.session.events.length, before)
  assert.equal(JSON.stringify(runtime.chat), runtime.before)
  await runtime.restart()
  assert.equal((await runtime.service.status('scene-parent', 1)).versions.length, 3)
  assert.ok((await runtime.service.readImage('scene-parent', 1, initial.key, originalVersion)).data.length)
  await runtime.service.configure({ style: { preset: 'watercolor', custom: '低饱和' } })
  const styled = await finish({ kind: 'repaint', versionId: originalVersion })
  assert.match(styled.versions.at(-1).prompt, /watercolor.*低饱和/)
  assert.equal(runtime.requests.length, 4, 'global style is composed without another Agent request')
  const localStyle = await finish({ kind: 'adjust', versionId: styled.versions.at(-1).id, instruction: '仅这张改成胶片风格' })
  assert.match(localStyle.versions.at(-1).prompt, /film grain/)
  assert.doesNotMatch(localStyle.versions.at(-1).prompt, /watercolor/)
  assert.equal(runtime.requests.length, 6)
  assert.equal((await runtime.service.settings()).style.preset, 'watercolor')
  assert.equal(runtime.parent.agent.session.events.length, before)
  assert.equal(JSON.stringify(runtime.chat), runtime.before)
})
