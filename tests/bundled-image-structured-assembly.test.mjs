import test from 'node:test'
import assert from 'node:assert/strict'
import { buildStructuredReferenceText, referencePlannerGuidance, referenceScopedDefinitions, resolveImageReferences } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/reference-images.js'
import { compileChannelJob, compileJob, expandRosterCalls } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'
import { imagePluginFixture, imageJson, IMAGE_PNG } from './fixtures/image-plugin-runtime.mjs'

test('默认规则升级接口预览并按指纹更新，陈旧预览不覆盖编辑', async t => {
  const fixture = await imagePluginFixture(t)
  const runtime = await fixture.start()
  const before = await runtime.request('worldbook-upgrade?book=main')
  assert.equal(before.status, 200)
  const entry = before.body.upgrade.entries[0]
  await runtime.request('worldbook-entry', { format: 'structured', book: 'main', index: 0, patch: { content: '用户自定义规则' } })
  const stale = await runtime.request('worldbook-upgrade', { book: 'main', expectedFingerprint: before.body.upgrade.fingerprint, entryIds: [entry.id] })
  assert.equal(stale.status, 409)
  const preview = await runtime.request('worldbook-upgrade?book=main')
  assert.equal(preview.body.upgrade.entries[0].state, 'customized')
  const updated = await runtime.request('worldbook-upgrade', { book: 'main', expectedFingerprint: preview.body.upgrade.fingerprint, entryIds: [entry.id] })
  assert.equal(updated.status, 200)
  assert.equal(updated.body.upgrade.entries[0].state, 'current')
  assert.ok(updated.body.upgrade.backupFile)
  assert.equal((await runtime.request('worldbook-upgrade?book=invalid')).status, 400)
})

const image = { id: 'a'.repeat(64), mediaType: 'image/png', byteLength: IMAGE_PNG.length, name: '身份.png' }
const defs = { characters: [{ id: 'jiang', name: '江铭', traits: { face: '旧外貌不应注入' }, referenceImage: image, outfits: [] }], outfits: [] }

test('结构化绑定按实际类型生成，不输出ID，不改用户的一致性补充', () => {
  const selected = resolveImageReferences({ subjects: [{ characterId: 'jiang' }], definitions: defs })
  selected.references[0].consistencyText = '保留[眉间痣]。\n不要改变黑发。'
  const text = buildStructuredReferenceText(selected.references)
  assert.equal(text, '人物的面部特征、发型和体型比例依据对应身份参考图及随附说明。\n\n参考图1 → 江铭（身份参考）：保留[眉间痣]。\n不要改变黑发。')
  assert.doesNotMatch(text, /服装图|characterId|outfitId/)
  assert.ok(text.includes(selected.references[0].consistencyText))
  assert.equal(buildStructuredReferenceText([]), '')
  assert.throws(() => buildStructuredReferenceText([{ ...selected.references[0], index: 2 }]))
})

test('身份参考规划禁止复述年龄性别，仍保留无身份图人物和剧情变化', () => {
  const guidance = referencePlannerGuidance(defs, { structured: true })
  assert.match(guidance, /不再描述年龄、性别、面部、发型或固有体型等固定身份属性/)
  assert.match(guidance, /不用“年轻男性”“青年男子”等概括词重新定义身份/)
  assert.match(guidance, /剧情明确的外观变化与用户明确的一致性补充仍须保留/)
  assert.match(guidance, /只有服装图或没有身份图的人物仍用库内文字与正文描述可见外貌/)
  assert.match(guidance, /不另设人物及参考图对应分节/)
  assert.doesNotMatch(referencePlannerGuidance(defs), /不用“年轻男性”/)
})

test('最终参考说明不携带无关状态示例，真实变化与用户补充保持原样', () => {
  const selected = resolveImageReferences({ subjects: [{ characterId: 'jiang' }], definitions: defs })
  const referenceText = buildStructuredReferenceText(selected.references)
  assert.doesNotMatch(referenceText, /换装|湿衣|破损|优先于|年轻男性|青年男子/)
  assert.match(referenceText, /参考图1 → 江铭（身份参考）$/)
  assert.doesNotMatch(referenceText, /以本张描述为准|一致性补充/)
  const raw = '【人物与表情】\n江铭眉头微蹙。\n\n【服装】\n上衣湿透，左袖破损。'
  const output = compileChannelJob({ params: { tag: raw, rawTag: raw, referenceText }, definitions: {},
    config: { promptMode: 'structured', imageBackend: 'atlascloud' }, channel: { provider: 'atlascloud' } })
  assert.ok(output.positive.includes(raw), 'actual scene changes must not be filtered as template words')
  assert.ok(output.positive.startsWith('【参考图对应与一致性】\n' + referenceText + '\n\n'))
  selected.references[0].consistencyText = '用户指定：保留破损的耳饰。'
  assert.match(buildStructuredReferenceText(selected.references), /用户指定：保留破损的耳饰。/)
})

test('旧快照占位标记经结构化编译清除，但保留姓名、无图人物资料和自定义分节', () => {
  const library = structuredClone(defs)
  library.characters.push({ id: 'chen', name: '陈安', traits: { face: '黑发，白衬衫' }, outfits: [] })
  const selected = resolveImageReferences({ subjects: [{ characterId: 'jiang' }, { characterId: 'chen' }], definitions: library })
  const legacy = referenceScopedDefinitions(library, selected.references, { subjects: selected.subjects })
  assert.match(legacy.characters[0].traits.face, /characterId/)
  const scoped = referenceScopedDefinitions(legacy, selected.references, { subjects: selected.subjects, markers: false })
  const source = '【自定义场面】\n${"name":"江铭"}$和陈安各拿一把伞。\n\n【用户约束】\n保留[文字]和 (记号:1.2)。'
  const expanded = expandRosterCalls(source, scoped, 'sfw', { style: 'structured' })
  assert.match(expanded, /江铭和陈安/)
  const output = compileChannelJob({ params: { tag: expanded, rawTag: source, referenceText: buildStructuredReferenceText(selected.references) }, definitions: scoped,
    config: { promptMode: 'structured', imageBackend: 'atlascloud' }, channel: { provider: 'atlascloud' } })
  assert.doesNotMatch(output.positive, /characterId|身份参照图|旧外貌|人物“江铭”：/)
  assert.match(output.positive, /黑发，白衬衫/)
  assert.ok(output.positive.includes('保留[文字]和 (记号:1.2)。'))
  assert.equal((output.positive.match(/参考图1 →/g) || []).length, 1)
  assert.match(legacy.characters[0].traits.face, /characterId/, 'old snapshot is immutable')
})

test('同名人物宏、服装归属与绑定使用同一短称呼；同图不同对象不合并', () => {
  const library = { characters: ['a', 'b'].map(id => ({ id, name: '江铭', referenceImage: image, outfits: [{ id: 'o', name: '常服', referenceImage: image }] })) }
  const selected = resolveImageReferences({ subjects: ['a', 'b'].map(characterId => ({ characterId, outfitId: 'o' })), definitions: library })
  assert.equal(selected.references.length, 4)
  const scoped = referenceScopedDefinitions(library, selected.references, { subjects: selected.subjects, markers: false })
  const expanded = expandRosterCalls('${"name":"a","angle":"左侧"}$\n${"name":"b","angle":"右侧"}$', scoped, 'sfw', { style: 'structured' })
  assert.match(expanded, /人物“江铭（对象1）”：左侧/)
  assert.match(expanded, /人物“江铭（对象3）”：右侧/)
  const bindings = buildStructuredReferenceText(selected.references)
  assert.match(bindings, /参考图2 → 江铭（对象1）／常服/)
  assert.match(bindings, /参考图4 → 江铭（对象3）／常服/)
  assert.match(bindings, /江铭（对象3）／常服（服装参考）/)
  assert.doesNotMatch(bindings, /characterId|outfitId/)
  const onlyOutfits = selected.references.filter(r => r.kind === 'outfit').map((r, index) => ({ ...r, index: index + 1 }))
  assert.doesNotMatch(buildStructuredReferenceText(onlyOutfits), /身份图/)
})

test('结构化Comfy编译保留组装来源', () => {
  const output = compileJob({ workflow: { id: 'wf', prompt: { '1': { inputs: { text: '' } } }, bindings: { positive: [{ node: '1', input: 'text' }] } },
    config: { promptMode: 'structured', imageBackend: 'comfyui' }, params: { tag: '【人物】\n陈安' }, definitions: { characters: [{ name: '陈安', traits: { face: '黑发' } }] } })
  assert.equal(output.promptAssembly.version, 2)
  assert.match(output.promptAssembly.definitionAdditions.join('\n'), /黑发/)
})

test('行内引用不重复朝向，独立宏保留朝向，歧义别名不改写', () => {
  const characters = [
    { id: 'yue', name: '洛玥', match: '洛凰，月姐' },
    { id: 'mi', name: '洛米', match: '洛璃，月姐' }
  ]
  const raw = '洛璃扶着${"name":"yue","angle":"低头"}$。月姐站在门口。\n${"name":"mi","angle":"侧身朝窗"}$'
  const expanded = expandRosterCalls(raw, { characters }, 'sfw', { style: 'structured' })
  assert.equal(expanded, '洛米扶着洛玥。月姐站在门口。\n人物“洛米”：侧身朝窗')
})

test('真实任务组装一次绑定；改词重画、重启仍使用快照，不累积说明', async t => {
  const calls = []
  const fixture = await imagePluginFixture(t, { config: { generationMode: 'reference', promptMode: 'structured' } })
  globalThis.fetch = async (url, init = {}) => {
    if (url.endsWith('/uploadMedia')) return imageJson({ data: { download_url: 'https://images.example.test/ref.png' } })
    if (url.endsWith('/generateImage')) { calls.push(JSON.parse(init.body)); return imageJson({ data: { id: 'img-' + calls.length, status: 'completed', outputs: ['https://images.example.test/out.png'] } }) }
    return new Response(IMAGE_PNG)
  }
  const runtime = await fixture.start()
  const upload = await runtime.request('reference-image', { data: IMAGE_PNG.toString('base64'), mediaType: 'image/png' })
  const library = structuredClone(defs)
  library.characters[0].referenceImage = upload.body.referenceImage
  await runtime.request('definitions', { definitions: library })
  const raw = '人物\n江铭，一名年轻男子。\n\n动作\n一手撑住床沿，侧转回望。'
  const start = await runtime.request('jobs', { tag: raw, subjects: [{ characterId: 'jiang' }] })
  assert.equal(start.status, 200)
  const original = await runtime.terminal(start.body.id)
  assert.equal(original.state, 'done')
  const detail = (await runtime.request('job-detail?id=' + original.id)).body.job
  assert.equal(detail.rawPrompt, raw)
  assert.equal(detail.promptAssembly.version, 2)
  assert.deepEqual(detail.promptAssembly.definitionAdditions, [])
  assert.equal(detail.rawPromptSource, 'rawTag')
  const restarted = await fixture.start()
  const redraw = await restarted.request('redraw', { jobId: original.id, prompt: raw + '\n神情警觉。' })
  assert.equal(redraw.status, 200)
  assert.equal((await restarted.terminal(redraw.body.jobId)).state, 'done')
  assert.equal(calls.length, 2)
  for (const payload of calls) {
    assert.ok(payload.prompt.startsWith('【参考图对应与一致性】\n'))
    assert.equal((payload.prompt.match(/参考图1 →/g) || []).length, 1)
    assert.doesNotMatch(payload.prompt, /characterId|outfitId|人物“江铭”：|服装图|换装|湿衣|破损/)
    assert.ok(payload.prompt.includes(raw), 'manual/redraw text is not destructively rewritten by keyword removal')
  }
})

test('参考生图的跨分节人物称呼、动作宏和参考绑定在提交前统一', async t => {
  const calls = []
  const fixture = await imagePluginFixture(t, { config: { generationMode: 'reference', promptMode: 'structured' } })
  globalThis.fetch = async (url, init = {}) => {
    if (url.endsWith('/uploadMedia')) return imageJson({ data: { download_url: 'https://images.example.test/ref.png' } })
    if (url.endsWith('/generateImage')) { calls.push(JSON.parse(init.body)); return imageJson({ data: { id: 'issue-731', status: 'completed', outputs: ['https://images.example.test/out.png'] } }) }
    return new Response(IMAGE_PNG)
  }
  const runtime = await fixture.start()
  const upload = await runtime.request('reference-image', { data: IMAGE_PNG.toString('base64'), mediaType: 'image/png' })
  const library = { characters: [
    { id: 'yue', name: '洛玥', match: '洛凰', referenceImage: upload.body.referenceImage, consistencyText: '18岁少女。', traits: {}, outfits: [] },
    { id: 'mi', name: '洛米', match: '洛璃', referenceImage: upload.body.referenceImage, consistencyText: '9岁小女孩。', traits: {}, outfits: [] }
  ] }
  await runtime.request('definitions', { definitions: library })
  const unknownId = 'c1794034469564y2pj'
  const raw = [
    '【人物与表情】\n${"name":"mi","angle":"仰脸"}$仰起小脸。',
    '【服装】\n${"name":"洛凰","angle":"垂眸"}$穿玄黑色上袄。洛璃穿浅色外套。',
    '【动作】\n洛璃紧贴洛凰身侧。${"name":"' + unknownId + '","angle":"侧脸朝桥头"}$被洛凰抱着。',
    '【约束】\n洛璃的手不越到洛凰手臂；' + unknownId + '侧身坐稳。'
  ].join('\n\n')
  const start = await runtime.request('jobs', { tag: raw, negative: '洛璃的手不要遮住洛凰。', subjects: [{ characterId: 'yue' }, { characterId: 'mi' }] })
  assert.equal(start.status, 200)
  const job = await runtime.terminal(start.body.id)
  assert.equal(job.state, 'done')
  const detail = (await runtime.request('job-detail?id=' + job.id)).body.job
  assert.equal(detail.rawPrompt, raw)
  assert.deepEqual(detail.promptAssembly.unresolvedCharacterIds, [unknownId])
  assert.equal(calls.length, 1)
  const prompt = calls[0].prompt
  assert.ok(prompt.startsWith('【参考图对应与一致性】\n人物的面部特征、发型和体型比例依据对应身份参考图及随附说明。\n\n参考图1 → 洛玥（身份参考）：18岁少女。\n参考图2 → 洛米（身份参考）：9岁小女孩。'))
  assert.doesNotMatch(prompt, /洛凰|洛璃|c1794034469564y2pj|仰脸|垂眸|以本张描述为准|一致性补充/)
  assert.match(prompt, /洛米仰起小脸/)
  assert.match(prompt, /洛玥穿玄黑色上袄。洛米穿浅色外套/)
  assert.match(prompt, /洛米紧贴洛玥身侧。未匹配人物1；侧脸朝桥头；被洛玥抱着/)
  assert.match(prompt, /洛米的手不越到洛玥手臂；未匹配人物1侧身坐稳/)
  assert.match(prompt, /洛米的手不要遮住洛玥/)
})

test('sync: saving and restarting preserves structured mode alongside the Chinese switch', async t => {
  const fixture = await imagePluginFixture(t)
  const runtime = await fixture.start()
  assert.equal((await runtime.request('config', { promptMode: 'structured', allowChinesePrompt: true })).status, 200)
  const saved = await fixture.read('config.json')
  assert.equal(saved.promptMode, 'structured')
  assert.equal(saved.allowChinesePrompt, true)
  const restarted = await fixture.start()
  const state = await restarted.request('state')
  assert.equal(state.body.config.promptMode, 'structured')
  assert.equal(state.body.config.allowChinesePrompt, true)
  assert.equal((await restarted.request('config', { allowChinesePrompt: false })).status, 200)
  assert.equal((await fixture.read('config.json')).allowChinesePrompt, false)
  assert.equal((await restarted.request('config', { allowChinesePrompt: 'true' })).status, 200)
  assert.equal((await fixture.read('config.json')).allowChinesePrompt, false, 'string true must not enable the switch')
})

test('sync: compiled character positive and negative prompts honor Chinese opt-in without flattening structured text', () => {
  const source = '【人物】\n黑发，白衬衫。\n\n【约束】\n保留[文字]。'
  for (const allowChinesePrompt of [false, true]) {
    const structured = compileChannelJob({ params: { tag: source, characters: [{ prompt: source, uc: '不要帽子。\n不要眼镜。' }] },
      definitions: {}, config: { promptMode: 'structured', imageBackend: 'comfyui', allowChinesePrompt }, channel: { provider: 'comfyui' } })
    assert.ok(structured.positive.includes(source))
    assert.match(structured.negative, /不要帽子。\n不要眼镜。/)
    const tags = compileChannelJob({ params: { tag: 'portrait', characters: [{ prompt: '黑发, portrait', uc: '帽子, hat' }] },
      definitions: {}, config: { promptMode: 'tags', imageBackend: 'comfyui', allowChinesePrompt }, channel: { provider: 'comfyui' } })
    assert.equal(tags.positive.includes('黑发'), allowChinesePrompt)
    assert.equal(tags.negative.includes('帽子'), allowChinesePrompt)
  }
})
