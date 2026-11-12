import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { imagePluginFixture, IMAGE_PNG, imageJson } from './fixtures/image-plugin-runtime.mjs'

const character = { id: 'lin', name: '林月', match: 'Lin Yue', traits: { face: 'red hair, violet eyes' }, outfits: [{ id: 'shirt', name: '白衬衫', upper: 'white shirt' }] }
function atlasMock(calls, { failUpload = false, uploadWait } = {}) {
  return async (url, init = {}) => {
    calls.push({ url, init })
    if (url.endsWith('/uploadMedia')) {
      if (uploadWait) await uploadWait(init.signal)
      if (failUpload) throw new Error('upload interrupted')
      return imageJson({ data: { download_url: 'https://images.example.test/ref-' + calls.length + '.png' } })
    }
    if (url.endsWith('/generateImage')) return imageJson({ data: { id: 'image-' + calls.length, status: 'completed', outputs: ['https://images.example.test/result.png'] } })
    return new Response(IMAGE_PNG)
  }
}
async function prepare(t, options = {}) {
  const fixture = await imagePluginFixture(t, { config: { generationMode: 'reference', promptMode: 'structured', ...options.config }, llm: options.llm })
  const runtime = await fixture.start()
  const uploaded = await runtime.request('reference-image', { data: IMAGE_PNG.toString('base64'), mediaType: 'image/png', name: '角色.png' })
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body))
  const referenceImage = uploaded.body.referenceImage
  const defs = { characters: [{ ...structuredClone(character), referenceImage, consistencyText: '保留眼角的小痣' }], outfits: [], settings: [], props: [] }
  assert.equal((await runtime.request('definitions', { definitions: defs })).status, 200)
  return { fixture, runtime, referenceImage, defs }
}
const raw = '【人物】\n林月\n\n【动作】\n站在窗边。'

test('本地上传预览、保存定义、只传本张参考图；实际输入包含编号和补充而非旧外貌', async t => {
  const calls = []; globalThis.fetch = atlasMock(calls)
  const { fixture, runtime, referenceImage, defs } = await prepare(t)
  const preview = await runtime.request('reference-image?id=' + referenceImage.id)
  assert.deepEqual(preview.bytes, IMAGE_PNG)
  assert.equal(preview.headers['content-type'], 'image/png')
  assert.equal((await fixture.read('definitions.json')).characters[0].referenceImage.id, referenceImage.id)
  defs.characters.push({ id: 'not-here', name: '没出场', referenceImage })
  defs.characters[0].outfits[0].referenceImage = referenceImage
  await runtime.request('definitions', { definitions: defs })
  const start = await runtime.request('jobs', { tag: raw, subjects: [{ characterId: 'lin', outfitId: 'shirt' }] })
  assert.equal(start.status, 200, JSON.stringify(start.body))
  const job = await runtime.terminal(start.body.id)
  assert.equal(job.state, 'done', job.error)
  assert.equal(job.generationMode, 'reference')
  assert.deepEqual(job.references.map(r => [r.index, r.kind]), [[1, 'character'], [2, 'outfit']])
  assert.match(job.submittedPrompt, /保留眼角的小痣/)
  assert.doesNotMatch(job.submittedPrompt, /red hair|violet eyes|没出场/)
  const generate = JSON.parse(calls.find(c => c.url.endsWith('/generateImage')).init.body)
  assert.equal(generate.prompt, job.submittedPrompt)
  assert.equal(generate.model, 'test-edit')
  assert.equal(generate.images.length, 2, 'same image serving distinct objects keeps both bindings')
  assert.equal(calls.filter(c => c.url.endsWith('/uploadMedia')).length, 2)
})

test('参考模式全无图或协议不支持时明确拒绝，单图明确文生图可继续且不上传', async t => {
  const calls = []; globalThis.fetch = atlasMock(calls)
  const { runtime } = await prepare(t)
  const missing = await runtime.request('jobs', { tag: '一片森林', subjects: [] })
  assert.equal(missing.status, 400)
  assert.match(missing.body.error, /没有可用.*参考图/)
  assert.equal(calls.length, 0)
  const text = await runtime.request('jobs', { tag: '一片森林', generationMode: 'text' })
  assert.equal((await runtime.terminal(text.body.id)).state, 'done')
  assert.equal(calls.filter(c => c.url.endsWith('/uploadMedia')).length, 0)
  const bad = await runtime.request('jobs', { tag: raw, generationMode: 'unknown' })
  assert.equal(bad.status, 400)
  const configured = await runtime.request('config', { imageBackend: 'custom', activeImageChannel: 'nai-reference-test', imageChannels: [{ id: 'nai-reference-test', provider: 'custom', name: 'NovelAI', baseUrl: 'https://nai.example.test', model: 'nai-diffusion-5-full', options: { apiProtocol: 'novelai' } }] })
  assert.equal(configured.body.state.imageProvider, 'novelai')
  const count = calls.length
  const unsupported = await runtime.request('jobs', { tag: raw, subjects: [{ characterId: 'lin' }], generationMode: 'reference' })
  assert.equal(unsupported.status, 400)
  assert.match(unsupported.body.error, /协议不支持参考图/)
  assert.equal(calls.length, count, 'unsupported protocol must make zero HTTP/paid requests')
})

test('快照独立于人物库与全局模式，旧图重绘默认原版，明确更新才取新一致性文字', async t => {
  const calls = []; globalThis.fetch = atlasMock(calls)
  const { fixture, runtime, defs, referenceImage } = await prepare(t)
  const first = await runtime.request('jobs', { tag: raw, subjects: [{ characterId: 'lin', outfitId: '' }] })
  assert.equal((await runtime.terminal(first.body.id)).state, 'done')
  defs.characters[0].referenceImage = null
  defs.characters[0].consistencyText = '新的文字'
  await runtime.request('definitions', { definitions: defs })
  await runtime.request('config', { generationMode: 'text' })
  const redraw = await runtime.request('redraw', { jobId: first.body.id })
  assert.equal(redraw.status, 200, JSON.stringify(redraw.body))
  const second = await runtime.terminal(redraw.body.jobId)
  assert.equal(second.generationMode, 'reference')
  assert.match(second.submittedPrompt, /保留眼角的小痣/)
  assert.doesNotMatch(second.submittedPrompt, /新的文字/)
  assert.equal((await runtime.request('reference-image?id=' + referenceImage.id)).status, 200)
  const refresh = await runtime.request('redraw', { jobId: first.body.id, refreshReferences: true })
  assert.equal(refresh.status, 400)
  defs.characters[0].referenceImage = referenceImage
  await runtime.request('definitions', { definitions: defs })
  const changed = await runtime.request('redraw', { jobId: first.body.id, refreshReferences: true })
  const updated = await runtime.terminal(changed.body.jobId)
  assert.match(updated.submittedPrompt, /新的文字/)
  assert.doesNotMatch(updated.submittedPrompt, /保留眼角的小痣/)
  const saved = await fixture.read('jobs-store.json')
  assert.equal(saved[first.body.id].referenceSnapshot.references[0].consistencyText, '保留眼角的小痣')
  const restart = await fixture.start()
  const afterRestart = await restart.request('redraw', { jobId: first.body.id })
  assert.equal((await restart.terminal(afterRestart.body.jobId)).generationMode, 'reference')
})

test('本地参考图损坏和上传失败不标记付费请求已提交、不静默丢图', async t => {
  for (const scenario of ['upload', 'corrupt']) await t.test(scenario, async t => {
    const calls = []; globalThis.fetch = atlasMock(calls, { failUpload: scenario === 'upload' })
    const { fixture, runtime, referenceImage } = await prepare(t)
    if (scenario === 'corrupt') await writeFile(join(fixture.pluginRoot, 'reference-images', referenceImage.id), 'not-an-image')
    const first = await runtime.request('jobs', { tag: raw, subjects: [{ characterId: 'lin' }] })
    const job = await runtime.terminal(first.body.id)
    assert.equal(job.state, 'failed')
    assert.equal(job.requestStarted, false)
    assert.equal(job.requestMayHaveSucceeded, false)
    assert.equal(calls.filter(c => c.url.endsWith('/generateImage')).length, 0)
    assert.equal(job.references.length, 1)
  })
})

test('规划只收文字及清单，结构化subjects到实际图片编号绑定，非法subjects不提交', async t => {
  const prompts = [], calls = []
  let output = '<images><image><regex>林月站在窗边。</regex><prompts>【人物】\n林月\n\n【动作】\n站在窗边。</prompts><subjects>[{"characterId":"lin","outfitId":""}]</subjects></image></images>'
  globalThis.fetch = atlasMock(calls)
  const { runtime } = await prepare(t, { config: { promptSystem: 'workbench' }, llm: { async *stream(input) { prompts.push(input); yield { type: 'text-delta', text: output } } } })
  const result = await runtime.request('plan', { text: '林月站在窗边。', messageId: 'turn-1', count: 1, manual: true })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.plans.length, 1, JSON.stringify(result.body))
  const job = await runtime.terminal(result.body.plans[0].jobId)
  assert.equal(job.references[0].characterId, 'lin')
  assert.equal(prompts[0].messages.length, 1)
  assert.ok(prompts[0].messages[0].content.every(part => part.type === 'text'))
  assert.match(prompts[0].system, /subjects/)
  assert.match(prompts[0].system, /不再描述年龄、性别、面部、发型或固有体型等固定身份属性/)
  assert.match(prompts[0].system, /一个可同时成立的定格姿态/)
  assert.match(prompts[0].system, /不为解释光线新增窗帘、开口、掀布或光源/)
  assert.match(prompts[0].system, /不擅自改设画风/)
  assert.doesNotMatch(prompts[0].system, /data:image\/|iVBORw0KGgo/)
  assert.doesNotMatch(job.submittedPrompt, /换装|湿衣|破损|年轻男性|生成规则/)
  assert.equal((job.submittedPrompt.match(/参考图1 →/g) || []).length, 1)
  output = output.replace('[{"characterId":"lin","outfitId":""}]', '{broken}')
  const count = calls.length
  const invalid = await runtime.request('plan', { text: '林月站在窗边。', messageId: 'turn-2', count: 1, manual: true })
  assert.ok(invalid.status === 400 || invalid.body.error, JSON.stringify(invalid.body))
  assert.equal(calls.length, count)
})

test('多人含无图人物与未知人物时保留文字，明确更新快照可按新提示词重新选人', async t => {
  const calls = []; globalThis.fetch = atlasMock(calls)
  const { runtime, referenceImage, defs } = await prepare(t)
  defs.characters.push({ id: 'chen', name: '陈安', match: 'Chen An', traits: { face: '短黑发，蓝色眼睛' }, outfits: [] })
  await runtime.request('definitions', { definitions: defs })
  const first = await runtime.request('jobs', { tag: '【人物】\n林月、陈安和一名旅人\n\n【动作】\n坐在桌旁。', subjects: [{ characterId: 'lin' }, { characterId: 'chen' }, { name: '旅人' }] })
  assert.equal(first.status, 200, JSON.stringify(first.body))
  const job = await runtime.terminal(first.body.id)
  assert.equal(job.state, 'done', job.error)
  assert.equal(job.references.length, 1)
  assert.match(job.submittedPrompt, /短黑发，蓝色眼睛/)
  assert.match(job.submittedPrompt, /旅人/)
  defs.characters[1].referenceImage = referenceImage
  await runtime.request('definitions', { definitions: defs })
  const changed = await runtime.request('redraw', { jobId: first.body.id, prompt: '【人物】\n陈安\n\n【动作】\n在门口等待。', refreshReferences: true })
  assert.equal(changed.status, 200, JSON.stringify(changed.body))
  const updated = await runtime.terminal(changed.body.jobId)
  assert.deepEqual(updated.references.map(r => r.characterId), ['chen'])
  assert.doesNotMatch(updated.submittedPrompt, /短黑发，蓝色眼睛|林月/)
})

test('纯服装参考图的历史快照允许明确更新，不把legacy空subjects误判为用户排空', async t => {
  const calls = []; globalThis.fetch = atlasMock(calls)
  const { runtime, referenceImage, defs } = await prepare(t)
  defs.outfits.push({ id: 'robe', name: '礼服', body: 'red dress', referenceImage })
  await runtime.request('definitions', { definitions: defs })
  const first = await runtime.request('jobs', { tag: '【服装】\n${"name":"礼服"}$\n\n【环境】\n陈列柜。' })
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.equal((await runtime.terminal(first.body.id)).references.length, 1)
  const refreshed = await runtime.request('redraw', { jobId: first.body.id, refreshReferences: true })
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body))
  const updated = await runtime.terminal(refreshed.body.jobId)
  assert.deepEqual(updated.references.map(r => r.outfitId), ['robe'])
})

test('新Atlas上传中断记录在重启时是未提交失败而非不确定；旧版running保持保守语义', async t => {
  const saved = {
    'tracked-upload': { id: 'tracked-upload', backend: 'atlascloud', state: 'running', requestStarted: false, submissionTracked: true, params: {}, createdAt: 1 },
    'legacy-running': { id: 'legacy-running', backend: 'atlascloud', state: 'running', requestStarted: false, params: {}, createdAt: 1 },
  }
  const fixture = await imagePluginFixture(t, { files: { 'jobs-store.json': saved } })
  const runtime = await fixture.start()
  const current = await runtime.request('jobs?id=tracked-upload')
  assert.equal(current.body.job.state, 'failed')
  const legacy = await runtime.request('jobs?id=legacy-running')
  assert.equal(legacy.body.job.state, 'uncertain')
})

test('自动模式规划：有参考图的画面用参考图，纯背景画面这一张改用文生图', async t => {
  const calls = []
  const output = '<images><image><regex>林月站在窗边。</regex><prompts>【人物】\n林月\n\n【动作】\n站在窗边。</prompts><subjects>[{"characterId":"lin","outfitId":""}]</subjects></image>'
    + '<image><regex>窗外是一片森林。</regex><prompts>【环境】\n晨雾中的森林，没有人物。</prompts><subjects>[]</subjects></image></images>'
  globalThis.fetch = atlasMock(calls)
  const { runtime } = await prepare(t, { config: { generationMode: 'auto' }, llm: { async *stream() { yield { type: 'text-delta', text: output } } } })
  const result = await runtime.request('plan', { text: '林月站在窗边。窗外是一片森林。', messageId: 'turn-auto', count: 2, manual: true })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.plans.length, 2, JSON.stringify(result.body))
  const [portrait, background] = await Promise.all(result.body.plans.map(plan => runtime.terminal(plan.jobId)))
  assert.equal(portrait.state, 'done', portrait.error)
  assert.deepEqual([portrait.generationMode, portrait.requestedGenerationMode, portrait.references.length], ['reference', 'auto', 1])
  assert.equal(background.state, 'done', background.error)
  assert.deepEqual([background.generationMode, background.requestedGenerationMode, background.references.length], ['text', 'auto', 0])
  assert.match(background.submittedPrompt, /森林/)
  assert.equal(calls.filter(c => c.url.endsWith('/uploadMedia')).length, 1)
})

test('自动规划在不支持接图的渠道仍记录自动选择，按文生图展开角色', async t => {
  const calls = []
  const output = '<images><image><regex>林月站在窗边。</regex><prompts>林月站在窗边。</prompts><subjects>[{"characterId":"lin","outfitId":""}]</subjects></image></images>'
  const { runtime } = await prepare(t, { config: {
    generationMode: 'auto', imageBackend: 'custom', activeImageChannel: 'text-only',
    imageChannels: [{ id: 'text-only', provider: 'custom', name: 'text', baseUrl: 'https://nai.example.test/v1', model: 'nai-diffusion-5-full', options: { apiProtocol: 'novelai', protocol: 'chat' } }],
  }, llm: { async *stream() { yield { type: 'text-delta', text: output } } } })
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    assert.match(String(url), /\/chat\/completions$/)
    return imageJson({ choices: [{ message: { content: `![image](data:image/png;base64,${IMAGE_PNG.toString('base64')})` } }] })
  }
  const result = await runtime.request('plan', { text: '林月站在窗边。', messageId: 'auto-text-channel', count: 1, manual: true })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.plans.length, 1)
  const job = await runtime.terminal(result.body.plans[0].jobId)
  assert.equal(job.state, 'done', job.error)
  assert.deepEqual([job.generationMode, job.requestedGenerationMode, job.generationModeReason], ['text', 'auto', 'unsupported-input'])
  assert.match(job.submittedPrompt, /red hair/)
  assert.equal(calls.length, 1)
})

test('beforeImageGenerate: the host releases each picture with its subjects, or skips it with a reason', async t => {
  for (const skip of [false, true]) await t.test(skip ? 'skipped' : 'released', async t => {
    const calls = [], asked = []
    const output = '<images><image><regex>林月站在窗边。</regex><prompts>【人物】\n林月\n\n【动作】\n站在窗边。</prompts><subjects>[{"characterId":"lin","outfitId":""}]</subjects></image></images>'
    globalThis.fetch = atlasMock(calls)
    const tavern = { async beforeImageGenerate(input) { asked.push(input); return skip ? { skip: true, reason: 'not ready yet' } : {} } }
    const fixture = await imagePluginFixture(t, { tavern, config: { generationMode: 'reference', promptMode: 'structured' }, llm: { async *stream() { yield { type: 'text-delta', text: output } } } })
    const runtime = await fixture.start()
    const referenceImage = (await runtime.request('reference-image', { data: IMAGE_PNG.toString('base64'), mediaType: 'image/png', name: '角色.png' })).body.referenceImage
    assert.equal((await runtime.request('definitions', { definitions: { characters: [{ ...structuredClone(character), referenceImage }], outfits: [], settings: [], props: [] } })).status, 200)
    const result = await runtime.request('plan', { text: '林月站在窗边。', messageId: 'turn-gate', count: 1, manual: true, sessionId: 'game-1' })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.deepEqual(asked.map(input => [input.gameId, input.subjects, input.manual, input.signal instanceof AbortSignal]), [['game-1', [{ characterId: 'lin', outfitId: '' }], true, true]])
    assert.equal(result.body.plans.length, skip ? 0 : 1, JSON.stringify(result.body))
    if (skip) assert.ok(JSON.stringify(result.body).includes('not ready yet'), 'the reason reaches the turn warnings')
  })
})
test('beforeImageGenerate: a plan that names its people only by roster macro, without <subjects>, still waits for them', async t => {
  const calls = [], asked = []
  let runtime, referenceImage
  // As planners often write it: the person is named only by macro, the <subjects> block is left out.
  const output = '<images><image><regex>林月站在窗边。</regex><prompts>${"name":"林月","angle":"from front"}$ standing by the window.</prompts></image></images>'
  globalThis.fetch = atlasMock(calls)
  const tavern = { async beforeImageGenerate({ subjects }) {
    asked.push(subjects.map(subject => subject.characterId))
    // The host prepares the reference of whoever the picture is drawn with before releasing it.
    if (subjects.some(subject => subject.characterId === 'lin')) {
      referenceImage = (await runtime.request('reference-image', { data: IMAGE_PNG.toString('base64'), mediaType: 'image/png', name: 'new-reference.png' })).body.referenceImage
      assert.equal((await runtime.request('definitions', { definitions: { characters: [{ ...structuredClone(character), referenceImage }] } })).status, 200)
    }
    return {}
  } }
  const fixture = await imagePluginFixture(t, { tavern, definitions: { characters: [character] }, config: { generationMode: 'auto', promptMode: 'structured' }, llm: { async *stream() { yield { type: 'text-delta', text: output } } } })
  runtime = await fixture.start()
  const result = await runtime.request('plan', { text: '林月站在窗边。', messageId: 'turn-macro-only', count: 1, manual: true, sessionId: 'game-1' })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.deepEqual(asked, [['lin']], 'the host is told the person the picture will be drawn with')
  const job = await runtime.terminal(result.body.plans[0].jobId)
  assert.equal(job.state, 'done', job.error)
  assert.equal(job.references?.[0]?.image.id, referenceImage.id, 'the picture is drawn with the reference the host prepared')
})
test('a waiting picture uses the reference added by the host while other pictures can proceed', async t => {
  let release, entered = false
  const ready = new Promise(resolve => { release = resolve })
  const calls = []; globalThis.fetch = atlasMock(calls)
  const output = '<images><image><regex>林月站在窗边。</regex><prompts>林月站在窗边。</prompts><subjects>[{"characterId":"lin"}]</subjects></image><image><regex>花园里开着白花。</regex><prompts>花园里开着白花。</prompts><subjects>[]</subjects></image></images>'
  const tavern = { async beforeImageGenerate({ subjects }) { if (subjects.some(item => item.characterId === 'lin')) { entered = true; await ready } } }
  const fixture = await imagePluginFixture(t, { tavern, definitions: { characters: [character] }, config: { generationMode: 'auto', promptMode: 'structured' }, llm: { async *stream() { yield { type: 'text-delta', text: output } } } })
  const runtime = await fixture.start()
  const drawing = runtime.request('plan', { text: '林月站在窗边。花园里开着白花。', messageId: 'independent-gates', count: 2, manual: true, sessionId: 'game-1' })
  try {
    for (let i = 0; i < 200 && !entered; i++) await new Promise(resolve => setTimeout(resolve, 5))
    assert.ok(entered)
    for (let i = 0; i < 200 && !calls.some(item => item.url.endsWith('/generateImage')); i++) await new Promise(resolve => setTimeout(resolve, 5))
    assert.ok(calls.some(item => item.url.endsWith('/generateImage')), 'the garden picture proceeds while the character reference waits')
    const referenceImage = (await runtime.request('reference-image', { data: IMAGE_PNG.toString('base64'), mediaType: 'image/png', name: 'new-reference.png' })).body.referenceImage
    const update = await runtime.request('definitions', { definitions: { characters: [{ ...structuredClone(character), referenceImage }] } })
    assert.equal(update.status, 200)
    release()
    const result = await drawing
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.plans.length, 2)
    const person = result.body.plans.find(item => item.subjects?.some(subject => subject.characterId === 'lin'))
    const job = await runtime.terminal(person.jobId)
    assert.equal(job.state, 'done', job.error)
    assert.equal(job.references[0].image.id, referenceImage.id)
  } finally { release(); await drawing }
})
