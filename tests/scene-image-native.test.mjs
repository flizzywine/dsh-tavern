import assert from 'node:assert/strict'
import test from 'node:test'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'
import { SCENE_IMAGE_CHANNELS } from '../tavern-plugin/lib/domain/scene-image-channels.js'
import { comfyGraph } from './fixtures/scene-image-comfy-workflow.mjs'

test('原生 DSH 仅接收已就绪可视变量，引用衣着片段并跨重启复用，不写前台', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE)
  t.after(() => runtime.dispose())
  runtime.chat.settleStatus = 'done'
  const message = runtime.chat.messages[0]
  message.swipes[0] = message.sourceText = '林岚站在窗边。'
  message.mvu = { pending: false }
  message.variables = [{ stat_data: { 人物: { 林岚: { 衣着: '青色外套', 好感度: '秘密数值' }, 路人: { 衣着: '无关人物衣着' } },
    场景: { 天气: '小雨' } }, schema: { secret: '不能发送结构' }, display_data: { secret: '不能发送镜像' } }]
  runtime.useVisualState()
  const before = runtime.parent.agent.session.events.length
  const target = await runtime.service.status('scene-parent', 1)
  await runtime.service.start('scene-parent', 1, target.key)
  // A late state update must not alter the already captured task material.
  message.variables[0].stat_data.人物.林岚.衣着 = '未来红色衣服'
  const after = JSON.stringify(runtime.chat)
  async function finished() {
    for (let index = 0; index < 300; index++) {
      const status = await runtime.service.status('scene-parent', 1)
      if (status.status !== 'running') { assert.equal(status.status, 'succeeded', status.error); return status }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.fail('state image flow did not finish')
  }
  const first = await finished()
  assert.equal(runtime.requests.length, 2)
  const request = JSON.stringify(runtime.requests[0])
  assert.match(request, /青色外套/)
  assert.match(request, /mvu-state/)
  assert.doesNotMatch(request, /秘密数值|无关人物衣着|不能发送结构|不能发送镜像|未来红色衣服/)
  assert.match(runtime.imageRequests[0].prompt, /blue coat/)
  await runtime.restart()
  await runtime.service.start('scene-parent', 1, target.key, { kind: 'repaint', versionId: first.versions[0].id })
  await finished()
  assert.equal(runtime.requests.length, 2, 'repaint does not rerun the text model or pick up future clothes')
  assert.equal(runtime.imageRequests.length, 2)
  assert.match(runtime.imageRequests[1].prompt, /blue coat/)
  assert.equal(JSON.stringify(runtime.chat), after)
  assert.equal(runtime.parent.agent.session.events.length, before)
})

test('日志 ZIP 连接真实生图子 Session 与成功失败诊断，不导出密钥或图片字节', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE)
  t.after(() => runtime.dispose())
  const before = runtime.parent.agent.session.events.length
  const target = await runtime.service.status('scene-parent', 1)
  async function finish() {
    for (let index = 0; index < 300; index++) {
      const result = await runtime.service.status('scene-parent', 1)
      if (result.status !== 'running') return result
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.fail('log fixture timed out')
  }
  runtime.failNext()
  const failed = await runtime.service.start('scene-parent', 1, target.key)
  assert.equal((await finish()).status, 'failed')
  await runtime.restart()
  await runtime.service.start('scene-parent', 1, target.key, { confirmNewRequestId: failed.requestId })
  assert.equal((await finish()).status, 'succeeded')
  const exported = await runtime.exportLogs()
  const zip = exported.buffer.toString('utf8')
  assert.match(zip, /scene-images\/diagnostics.json/)
  assert.match(zip, /subagents\/[^/]+\/session.jsonl/)
  assert.match(zip, /submit_scene_plan/)
  assert.match(zip, /providerRequests/)
  assert.match(zip, /503/)
  assert.match(zip, /stageDurationsMs/)
  assert.match(zip, /not-provided/)
  assert.doesNotMatch(zip, /fixture-key|iVBORw0KGgo|media\//)
  assert.equal(runtime.imageRequests.length, 2)
  assert.equal(runtime.parent.agent.session.events.length, before)
})

test('原生 DSH 生图 Agent 按需读历史设定、引用片段，前台不注入且重画不重读', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE)
  t.after(() => runtime.dispose())
  runtime.chat.cardContextSnapshotVersion = 5
  runtime.chat.cardContextSnapshot = '【故事设定 · 人物卡】\n名字: 林岚\n\n设定: 林岚留着黑色短发。\n\n【文风示例】\n林岚必须泄漏秘密。'
  runtime.lookupReferences('林岚')
  const before = runtime.parent.agent.session.events.length
  const target = await runtime.service.status('scene-parent', 1)
  async function finish(options) {
    await runtime.service.start('scene-parent', 1, target.key, options)
    for (let index = 0; index < 300; index++) {
      const status = await runtime.service.status('scene-parent', 1)
      if (status.status !== 'running') { assert.equal(status.status, 'succeeded', status.error); return status }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.fail('reference flow did not complete')
  }
  const first = await finish()
  assert.equal(runtime.requests.length, 3, 'lookup, submit, acknowledgement are one native Agent task, three model requests')
  assert.doesNotMatch(JSON.stringify(runtime.requests[0]), /黑色短发|泄漏秘密/)
  assert.match(JSON.stringify(runtime.requests[1]), /黑色短发/)
  assert.doesNotMatch(JSON.stringify(runtime.requests), /泄漏秘密/)
  assert.match(runtime.imageRequests[0].prompt, /short black hair/)
  assert.equal(runtime.imageRequests.length, 1)
  assert.equal(runtime.parent.agent.session.events.length, before)
  await runtime.restart()
  await finish({ kind: 'repaint', versionId: first.versions[0].id })
  assert.equal(runtime.requests.length, 3)
  assert.equal(runtime.imageRequests.length, 2)
  assert.equal(runtime.parent.agent.session.events.length, before)
})

test('非恒定世界书归档跨重启按正文读取，真实 DSH 生图请求不借用后来编辑的内容', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE)
  t.after(() => runtime.dispose())
  runtime.chat.messages[0].swipes[0] = '林岚站在窗边看雨。'
  const book = { view: { entries: [{ ref: 'entry:hero', title: '林岚', content: '林岚留着黑色短发。', constant: false }] } }
  const ref = await runtime.archiveWorldbook(book)
  book.view.entries[0].content = '林岚改为未来红发。'
  runtime.lookupReferences('林岚')
  const before = runtime.parent.agent.session.events.length
  await runtime.restart()
  const target = await runtime.service.status('scene-parent', 1)
  await runtime.service.start('scene-parent', 1, target.key)
  let result
  for (let index = 0; index < 300; index++) {
    result = await runtime.service.status('scene-parent', 1)
    if (result.status !== 'running') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(result.status, 'succeeded', result.error)
  assert.equal(runtime.requests.length, 3)
  assert.equal(runtime.imageRequests.length, 1)
  assert.doesNotMatch(JSON.stringify(runtime.requests[0]), /黑色短发|entry:hero/)
  assert.match(JSON.stringify(runtime.requests[1]), /worldbook-snapshot/)
  assert.match(JSON.stringify(runtime.requests[1]), new RegExp(ref.digest))
  assert.doesNotMatch(JSON.stringify(runtime.requests), /未来红发/)
  assert.match(runtime.imageRequests[0].prompt, /short black hair/)
  assert.equal(runtime.parent.agent.session.events.length, before)
})

test('九渠道正在等待 HTTP 时均可取消；关开关后仍可取消，重启不重发', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE)
  t.after(() => runtime.dispose())
  const before = runtime.parent.agent.session.events.length
  let count = 0
  let childId
  for (const { id: provider } of SCENE_IMAGE_CHANNELS) {
    await runtime.service.configure({ provider, baseURL: runtime.endpoint, ...(provider === 'comfyui' ? { workflow: comfyGraph() } : {}), ...(provider === 'banana' ? { model: 'fixture-relay-image' } : {}), ...(['webui', 'comfyui'].includes(provider) ? {} : { apiKey: 'fixture-' + provider }) })
    await runtime.service.configure({ enabled: true })
    const turn = ++count + 1
    runtime.chat.messages.push({ role: 'assistant', turn, sourceText: '她站在窗边看雨。' })
    runtime.holdNextImage()
    const target = await runtime.service.status('scene-parent', turn)
    const started = await runtime.service.start('scene-parent', turn, target.key)
    for (let n = 0; n < 300 && runtime.imageRequests.length < count; n++) await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(runtime.imageRequests.length, count, provider)
    await runtime.service.configure({ enabled: false })
    await runtime.service.cancel('scene-parent', turn, target.key, started.requestId)
    let result
    for (let n = 0; n < 300; n++) {
      result = await runtime.service.status('scene-parent', turn)
      if (result.status !== 'running') break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(result.status, 'cancelled', provider + ': ' + result.error)
    childId ||= result.traceSessionId
    assert.ok(childId)
    assert.equal(result.traceSessionId, childId, 'next turn resumes the same durable native child')
    assert.equal(result.outcome, 'unconfirmed')
    assert.equal(result.versions.length, 0)
    await runtime.restart()
    assert.equal((await runtime.service.status('scene-parent', turn)).status, 'cancelled')
    assert.equal(runtime.imageRequests.length, count)
    assert.equal(runtime.parent.agent.session.events.length, before)
  }
})

test('九种协议通过真实 DSH 子任务；附件失败后重启仅保存，不再请求文字或图片', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE)
  t.after(() => runtime.dispose())
  const before = runtime.parent.agent.session.events.length
  let count = 0
  for (const { id: provider } of SCENE_IMAGE_CHANNELS) {
    await runtime.service.configure({ provider, baseURL: runtime.endpoint, ...(provider === 'comfyui' ? { workflow: comfyGraph() } : {}), ...(provider === 'banana' ? { model: 'fixture-relay-image' } : {}), ...(['webui', 'comfyui'].includes(provider) ? {} : { apiKey: 'fixture-' + provider }) })
    await runtime.service.configure({ enabled: true })
    assert.equal(runtime.imageRequests.length, count)
    runtime.chat.messages.push({ role: 'assistant', turn: count + 2, sourceText: '她站在窗边看雨。' })
    const target = await runtime.service.status('scene-parent', count + 2)
    runtime.failNextSave()
    await runtime.service.start('scene-parent', count + 2, target.key)
    let result
    for (let n = 0; n < 300; n++) {
      result = await runtime.service.status('scene-parent', count + 2)
      if (result.status !== 'running') break
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
      if (result.status !== 'running') break
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
  assert.equal(adjusted.traceSessionId, status.traceSessionId, 'adjustment resumes the original child after runner disposal')
  assert.match(JSON.stringify(runtime.requests[2].messages), /左手轻轻搭着窗框/, 'original planning history remains in the child')
  assert.doesNotMatch(JSON.stringify(runtime.requests[2].messages.at(-1)), /左手轻轻搭着窗框/, 'new adjustment input does not resend the source text')
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
