// Mount the complete bundled client in real React; all plugin HTTP is stubbed.
// node tests/browser/bundled-image-reference-settings-browser-smoke.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { comfyWorkflowFields } from '../../tavern-plugin/packages/dsh-tavern-image-bundled/lib/comfy-inputs.js'
import { fillPromptInputs, selectPromptMaterials } from '../../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-materials.js'
import { STRUCTURED_PROMPT_TEMPLATE } from '../../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-presets.js'
import { matchPromptEntries, normalizePromptEntries } from '../../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-entries.js'
import { listTemplateModules, materializeTemplateModules } from '../../tavern-plugin/packages/dsh-tavern-image-bundled/lib/template-modules.js'
import { browserReactScript } from '../fixtures/browser-react.mjs'

const executablePath = [process.env.DSH_BROWSER_EXECUTABLE, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(path => path && existsSync(path)) || chromium.executablePath()
const screenshotPath = join(tmpdir(), 'dsh-tavern-pr421-image-settings.png')
const clientSource = await readFile(new URL('../../tavern-plugin/packages/dsh-tavern-image-bundled/client.js', import.meta.url), 'utf8')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==', 'base64')
const clone = value => JSON.parse(JSON.stringify(value))
const calls = [], errors = []
let uploads = 0, libraryRevision = 1, promptRevision = 1, cardEnabled = false
let playDeleted = false, failGalleryDelete = false
let cardBook = { version: 3, revision: 'card-1', buckets: ['rules', 'examples'].map(id => ({ id, label: id, entries: [{ id: 'shared-entry', title: id + ' title', content: id + ' original', enabled: true, mode: 'always' }] })) }
let cardRevision = 1
let failCardWrites = 0
const savedApiKeys = new Map()
const playGalleryJob = { id: 'play-only', source: 'play', label: '剧情配图', hasImage: true, state: 'done', gameId: 'play-session', createdAt: 2 }
const workflowDetail = { file: 'workflow-a.json', outputNode: '25', nodeSchemas: {
  CustomString: { name: '自定义文字', inputs: { caption: { type: 'STRING', multiline: true } } },
  CustomMedia: { name: '自定义接图', inputs: { file_a: { type: 'COMBO', imageUpload: true }, file_b: { type: 'COMBO', imageUpload: true } } },
  ImageScale: { inputs: { images: { type: 'IMAGE' }, mode: { type: 'COMBO', choices: ['nearest', 'bilinear'] }, width: { type: 'INT', min: 64, max: 2048, step: 8 } } },
}, prompt: {
  '80': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_06b_base.safetensors', type: 'stable_diffusion', device: 'default' } },
  '22': { class_type: 'CustomString', inputs: { caption: 'Keep this line' } },
  '23': { class_type: 'CustomMedia', inputs: { file_a: 'a.png', file_b: 'b.png' } },
  '24': { class_type: 'ImageScale', inputs: { images: ['23', 0], mode: 'nearest', width: 512 } },
  '25': { class_type: 'SaveImage', inputs: { images: ['24', 0] } },
  '26': { class_type: 'PreviewImage', inputs: { images: ['24', 0] } },
  '2': { class_type: 'LoadImage', inputs: { image: 'pose.png' }, _meta: { title: 'Pose input (not a character ref)' } },
  '15': { class_type: 'LoadImage', inputs: { image: 'character.png' }, _meta: { title: 'Character reference input' } },
  '18': { class_type: 'LoadImage', inputs: { image: 'outfit.png' }, _meta: { title: 'Outfit reference input' } },
  '19': { class_type: 'LoraLoader', inputs: { lora_name: 'original.safetensors', strength_model: 1, strength_clip: 1 } },
}, bindings: { positive: [], negative: [], loras: [{ node: '19', name: 'original.safetensors', strengthModel: 1, strengthClip: 1 }] } }
const books = format => [{ key: 'main', name: format + '规则', count: 1, entries: [{ index: 0, comment: format + '条目', content: format + ' content', enabled: true, activation: 'always', backends: [] }] }, { key: 'outfits', name: format + '服装规则', count: 0, entries: [] }]
const worldbooks = Object.fromEntries(['tags', 'natural', 'mixed', 'structured'].map(format => [format, books(format)]))
const state = {
  referenceSupported: true, configurationWarning: '旧版 ComfyUI 简易模式已停用；原配置和数据已保留。', imageProvider: 'openai', config: { promptSystem: 'workbench', imageEnabled: true, imageBackend: 'openai', comfyMode: 'simple', comfySimple: { checkpoint: 'keep-legacy-checkpoint' }, generationMode: 'text', promptMode: 'tags', promptEffectiveFormat: 'tags', activeImageChannel: 'openai-channel',
    designPromptMode: 'auto', characterDesignRequirements: '', outfitDesignRequirements: '', libraryPromptEditing: true, libraryDetailsEditing: true, promptDefaultEditable: true, promptWorkbench: true, promptWorkbenchDraw: true, promptEntries: [], promptModuleTypes: listTemplateModules(), promptPresetLibrary: [STRUCTURED_PROMPT_TEMPLATE], promptEntryLimit: 200, promptPresetLimit: 200, promptRevision: 'prompt-1', promptDefaultSections: ['人物与表情', '服装', '动作', '环境', '镜头与光线', '风格', '约束'],
    imageChannels: [{ id: 'openai-channel', provider: 'openai', name: 'OpenAI 渠道', baseUrl: 'https://openai.mock.invalid/v1', model: 'keep-exact-model', options: {} }], stylePresets: [{ id: 'preset-fold', name: '折叠测试套', artist: 'artist:fold_test', negative: 'lowres', position: 'prefix', enabled: true }], promptPresets: [{ id: 'legacy-entry', name: '旧提示词条目', positive: 'legacy positive', negative: 'legacy negative', enabled: true,
      structure: { format: 'auto', blocks: [], targets: [], generationRules: '优先写当前画面的主体。' } }] },
  definitions: { revision: String(libraryRevision), characters: [{ id: 'person-a', name: '林月', match: 'Lin Yue', cards: ['cards/story.json'], traits: { face: 'keep original traits', faceBack: 'dark hair tied loosely' }, outfits: [{ id: 'outfit-a', name: '白衬衫', upper: 'white shirt', enabled: true }] }, { id: 'person-b', name: '另一张卡的角色', cards: ['cards/other.json'] }], scenes: [], props: [] },
  outfits: [{ id: 'shared-a', name: '通用外套', body: 'coat', enabled: true }],
  worldbookFormat: 'tags', worldbookBooks: clone(worldbooks.tags), tasks: [], workflows: [{ id: 'workflow-a', label: 'Reference workflow', file: 'workflow-a.json', enabled: true, current: true, summary: { nodeCount: 5 } }], imageProviders: [{ id: 'openai', label: 'OpenAI 兼容' }, { id: 'custom', label: '自定义 API' }],
}
const preservedWorldbooks = clone(worldbooks)
const preservedPromptPresets = clone(state.config.promptPresets)
const preservedCharacterEntry = clone(state.definitions.characters[0])
function publicState() {
  const next = clone(state)
  for (const channel of next.config.imageChannels || []) {
    channel.hasApiKey = savedApiKeys.has(channel.id)
    delete channel.apiKey
    delete channel.password
  }
  return next
}
const browser = await chromium.launch({ headless: true, executablePath })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(8000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/plugins/dsh-tavern-image', ''), method = route.request().method()
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' })
    if (path === '/reference-image' && method === 'GET') return route.fulfill({ contentType: 'image/png', body: png })
    if (path === '/jobs' && url.searchParams.has('image') || url.pathname.startsWith('/dsh-tavern-gen/img/')) return route.fulfill({ contentType: 'image/png', body: png })
    const body = method === 'POST' ? route.request().postDataJSON() : null
    calls.push({ path, method, query: Object.fromEntries(url.searchParams), body })
    let response = { ok: true }
    if (url.pathname === '/dsh-tavern-gen/api/tools-enabled') {
      if (method === 'POST') cardEnabled = body.enabled
      response = { ok: true, enabled: cardEnabled }
    }
    else if (url.pathname === '/dsh-tavern-gen/api/state' || url.pathname === '/dsh-tavern-gen/api/worldbook') response = { worldbook: clone(cardBook), config: { enabled: cardEnabled } }
    else if (url.pathname === '/dsh-tavern-gen/api/gallery') response = { items: [{ id: 'card-only', file: 'card-only.png', url: '/dsh-tavern-gen/img/card-only.png', prompt: '卡片专用图片', session: 'card-session', at: 1 }, { id: 'card-next', file: 'card-next.png', url: '/dsh-tavern-gen/img/card-next.png', prompt: '下一张卡片图', session: 'card-session', at: 2 }] }
    else if (url.pathname === '/dsh-tavern-gen/api/save') {
      if (body.content.revision !== cardBook.revision) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'REVISION_CONFLICT', error: '卡片世界书已在别处修改' }) })
      cardBook = { ...clone(body.content), revision: 'card-' + (++cardRevision) }
      response = { ok: true, worldbook: clone(cardBook) }
    }
    else if (url.pathname === '/dsh-tavern-gen/api/worldbook-entry') {
      if (failCardWrites > 0) { failCardWrites--; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'fixture rejected card write' }) }) }
      const bucket = cardBook.buckets.find(item => item.id === body.bucket)
      const entry = bucket.entries.find(item => item.id === body.id)
      if (body.remove === true) bucket.entries.splice(bucket.entries.indexOf(entry), 1)
      else Object.assign(entry, body.patch)
      cardBook = { ...clone(cardBook), revision: 'card-' + (++cardRevision) }
      response = { ok: true, book: clone(cardBook), entry: clone(entry) }
    }
    else if (url.pathname === '/dsh-tavern-gen/api/worldbook-add') {
      const bucket = cardBook.buckets.find(item => item.id === body.bucket)
      const entry = { id: 'added-entry', title: body.entry.title, content: body.entry.content, mode: body.entry.mode, enabled: body.entry.enabled }
      bucket.entries.push(entry)
      cardBook = { ...clone(cardBook), revision: 'card-' + (++cardRevision) }
      response = { ok: true, book: clone(cardBook), entry: clone(entry) }
    }
    else if (path === '/state') response = publicState()
    else if (path === '/worldbook-entry') {
      const book = worldbooks[body.format].find(item => item.key === body.book)
      Object.assign(book.entries[body.index], body.patch)
      response = { ok: true }
    }
    else if (path === '/worldbook') response = { ok: true, worldbookBooks: clone(worldbooks[url.searchParams.get('format') || 'tags']) }
    else if (path === '/config') {
      if (body.config.promptRevision && body.config.promptRevision !== state.config.promptRevision) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'REVISION_CONFLICT', error: '模板资料已变化' }) })
      if (Array.isArray(body.config.imageChannels)) {
        for (const channel of body.config.imageChannels) {
          if (channel.apiKey) savedApiKeys.set(channel.id, channel.apiKey)
          delete channel.apiKey
          channel.hasApiKey = savedApiKeys.has(channel.id)
        }
      }
      Object.assign(state.config, body.config)
      if (['promptPresets', 'promptDefault', 'activePromptPreset', 'promptEntries'].some(key => Object.hasOwn(body.config, key))) state.config.promptRevision = 'prompt-' + (++promptRevision)
      state.referenceSupported = state.config.imageBackend === 'custom' ? ['openai', 'gemini', 'gemini-chat', 'atlascloud', 'seedream', 'grok', 'qwen', 'sdwebui'].includes(state.config.imageChannels.find(channel => channel.id === state.config.activeImageChannel)?.options?.apiProtocol || 'openai') : ['openai', 'atlascloud', 'comfyui'].includes(state.config.imageBackend)
      state.imageProvider = state.config.imageBackend
      if (body.config.comfyMode === 'workflow') state.configurationWarning = ''
      response = { ok: true, state: publicState() }
    }
    else if (path === '/prompt-preview') {
      const style = state.config.stylePresets.find(item => item.id === state.config.activePreset)
      const independent = body.template?.independent === true
      const filled = fillPromptInputs(body.template?.structure, body.inputs)
      const resolved = materializeTemplateModules(filled.structure, { scene: body.text, inputs: filled.values, usage: body.usage || 'story' })
      const blocks = (resolved.structure?.blocks || []).filter(block => block.enabled !== false && (!block.usage || block.usage === (body.usage || 'story')))
      const linked = block => state.config.stylePresets.find(style => style.id === block.styleId && style.enabled !== false)
      const additions = blocks.filter(block => ['positive', 'style'].includes(block.kind)).flatMap(block => [linked(block)?.artist, block.text])
      const positive = (independent ? [body.text, ...additions]
        : [body.source?.artist ?? (style?.artist || state.config.styleArtists), body.text, body.template?.positive, ...additions,
          body.source?.positive ?? state.config.promptManualPositive]).filter(Boolean).join('\n')
      const negative = [body.template?.negative, ...blocks.flatMap(block => block.kind === 'negative' ? [block.text]
        : block.kind === 'style' ? [linked(block)?.negative] : [])].filter(Boolean).join('\n')
      const result = { positive, negative, promptMode: body.template?.structure?.format || 'structured', target: body.target?.label || '当前渠道', template: body.template?.name, token: 'fixture-preview' }
      const materials = selectPromptMaterials(resolved.structure, { ...state.definitions, outfits: state.outfits }, { subjects: body.subjects, usage: body.usage || 'story' })
      result.assembly = { inputs: filled.values, materials: materials.selected.map(({ references, ...item }) => ({ ...item, referenceCount: references.length })) }
      result.entryTrace = matchPromptEntries(normalizePromptEntries(state.config.promptEntries), blocks, body.text, { explain: true })
      result.entryMatches = result.entryTrace.matches
      response = { ok: true, result, comparison: body.compare ? { ...result, positive: body.text, negative: '', template: '', entryMatches: [] } : null }
    }
    else if (path === '/prompt-plan') response = { ok: true, plans: [{ title: '窗边晨光', mount: '窗外晨光', prompts: '窗边站着一位旅人。' }] }
    else if (path === '/prompt-tryout') {
      assert.equal(body.token, 'fixture-preview')
      response = { ok: true, job: { id: 'tryout-image', state: 'pending' } }
    }
    else if (path === '/image-edit') response = { ok: true, jobId: 'edited-image', job: { id: 'edited-image', state: 'done' } }
    else if (path === '/image-channel-test') response = { ok: true, status: 'reachable', message: 'mock connection' }
    else if (path === '/comfy-test') response = { ok: true, version: 'mock' }
    else if (path === '/reference-image') { uploads++; response.referenceImage = { id: uploads.toString(16).repeat(64), name: body.name, mediaType: body.mediaType, byteLength: png.length } }
    else if (path === '/definitions') {
      if (body.definitions.revision !== state.definitions.revision) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'REVISION_CONFLICT', error: '人物库已在别处修改，请重新载入；当前草稿仍保留' }) })
      state.definitions = { ...clone(body.definitions), revision: String(++libraryRevision) }
      state.outfits = clone(body.definitions.outfits || []); response = { ok: true, state: clone(state) }
    }
    else if (path === '/worldbook') { const format = url.searchParams.get('format'); assert.ok(worldbooks[format]); response = { ok: true, worldbookFormat: format, worldbook: { name: format, entries: clone(worldbooks[format].flatMap(book => book.entries)) }, worldbookBooks: clone(worldbooks[format]) } }
    else if (path === '/worldbook-entry') { const book = worldbooks[body.format]?.find(book => book.key === body.book); assert.ok(book); Object.assign(book.entries[body.index], body.patch) }
    else if (path === '/workflow-bindings') {
      if (body.patch?.bindings?.referenceImages) Object.assign(workflowDetail.bindings, clone(body.patch.bindings))
      for (const field of body.patch?.textFields || []) workflowDetail.prompt[field.node].inputs[field.input] = field.text
      response = { ok: true, workflow: clone(workflowDetail), fields: comfyWorkflowFields(workflowDetail), revision: 'workflow-1',
        ...(body.refreshNodes ? { discovery: { recognized: 6, unavailable: [] } } : {}) }
    }
    else if (path === '/workflow-graph') {
      if (body.patch) {
        for (const [node, fields] of Object.entries(body.patch.inputs || {})) Object.assign(workflowDetail.prompt[node].inputs, fields)
        if (body.patch.referenceImages) workflowDetail.bindings.referenceImages = body.patch.referenceImages
        if (body.patch.outputNode) workflowDetail.outputNode = body.patch.outputNode
      }
      response = { ok: true, workflow: clone(workflowDetail), fields: comfyWorkflowFields(workflowDetail), revision: 'workflow-1' }
    }
    else if (path === '/workflow-import') {
      if (body.preview) response = { ok: true, name: body.filename?.replace(/\.json$/i, '') || '预检工作流', nodes: 5,
        bindings: { positive: [] }, hasImageInput: true, outputs: [{ id: '10', label: 'SaveImage' }], outputNode: '10' }
      else {
        const file = 'imported-workflow.json'
        state.workflows.push({ id: 'imported-workflow', label: body.name, file, enabled: true, current: false })
        response = { ok: true, name: body.name, file }
      }
    }
    else if (path === '/workflow-series') response = { ok: true, jobs: body.weights.map((_, index) => ({ id: 'series-' + index, state: 'pending' })) }
    else if (path === '/workflow-values') response = { ok: true, values: { positive: '', negative: '' } }
    else if (path === '/loras-available') response = { ok: true, loras: [] }
    else if (path === '/history') {
      const mode = url.searchParams.get('gallery')
      response = { ok: true, jobs: (playDeleted ? [] : [playGalleryJob]).filter(job => mode === 'trash' ? job.trashedAt : !job.trashedAt && (mode !== 'favorite' || job.favorite)) }
    }
    else if (path === '/gallery-item') {
      if (body.operation === 'favorite' || body.operation === 'unfavorite') playGalleryJob.favorite = body.operation === 'favorite'
      else playGalleryJob.trashedAt = body.operation === 'trash' ? 1 : null
      response = { ok: true, job: clone(playGalleryJob) }
    }
    else if (path === '/gallery-delete') {
      if (failGalleryDelete) response = { ok: true, deleted: [], failed: [{ id: playGalleryJob.id, error: '测试文件被占用' }] }
      else { playDeleted = true; response = { ok: true, deleted: [playGalleryJob.id], failed: [] } }
    }
    else if (path === '/jobs') response = { ok: true, job: url.searchParams.get('id') === 'tryout-image' ? { id: 'tryout-image', state: 'done' } : url.searchParams.get('id') === 'play-only' ? { ...clone(playGalleryJob), positive: '完整测试正面提示词：茶室门口的成年旅人', negative: '' } : {} }
    else if (path === '/tasks') response = { tasks: [] }
    else if (path === '/cards') response = { ok: true, cards: [
      { path: 'cards/story.json', name: '林月故事' }, { path: 'cards/other.json', name: '另一张卡' },
    ] }
    else if (path === '/import-characters') {
      const person = { name: '车站管理员', traits: { face: '棕色短发' } }
      response = body.dryRun ? { ok: true, cardName: '另一张卡', candidates: [{ action: 'add', person }] }
        : { ok: true, added: [person.name], state: publicState() }
    }
    else if (path === '/providers' || path === '/llm-models') response = { ok: true, providers: [], models: [] }
    else if (path === '/report') response = { ok: true }
    else { errors.push('unexpected HTTP ' + method + ' ' + path); response = { ok: false, error: 'unexpected request' } }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) })
  })
  await page.goto('http://reference-ui.test/')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: 'window.__ModuleLoader__={load(spec){window.__plugin=spec.factory(name=>modules[name])}};' })
  await page.addScriptTag({ content: clientSource })
  await page.evaluate(() => {
    let Settings, Overlay, Placement
    window.__plugin.apply({ slots: { inject(_name, install) { return install() }, register(spec, component) { if (spec.name === 'settings.section') Settings = component; if (spec.id === 'dsh-tavern-image-overlay') Overlay = component; if (spec.id === 'dsh-tavern-image-placement') Placement = component; return () => {} } }, inject() {} })
    if (!Settings) throw new Error('SettingsPanel not registered')
    const root = modules['react-dom/client'].createRoot(document.querySelector('#root'))
    const h = modules.react.createElement
    root.render(h(modules.react.Fragment, null, h(Settings), h(Overlay), h(Placement)))
  })
  // 设置页里的断言先做完：默认生图模式来回切
  for (const title of ['生图世界书', '试规划']) assert.equal(await page.locator('summary').filter({ hasText: title }).count(), 0)
  for (const title of ['生成设置', '生图位置和大小', '图片输出']) {
    const summary = page.locator('summary').filter({ hasText: title })
    assert.equal(await summary.evaluate(node => node.parentElement.open), false, title + '默认折叠')
    await summary.click()
    assert.equal(await summary.evaluate(node => node.parentElement.open), true, title + '可以展开')
    await summary.click()
  }
  await page.waitForFunction(() => document.querySelector('[aria-label="启用卡片生图"]')?.disabled === false)
  assert.equal(await page.getByLabel('启用卡片生图', { exact: true }).isChecked(), false)
  assert.equal(await page.getByRole('button', { name: '卡片世界书', exact: true }).count(), 0)
  assert.equal(calls.some(call => call.path === '/dsh-tavern-gen/api/worldbook'), false, '关闭卡片生图时不读取卡片世界书')
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/dsh-tavern-gen/api/tools-enabled') && response.request().method() === 'POST'), page.getByLabel('启用卡片生图', { exact: true }).click()])
  await page.getByRole('button', { name: '卡片世界书', exact: true }).waitFor()
  assert.equal(calls.some(call => call.path === '/dsh-tavern-gen/api/worldbook'), false, '启用后进入独立页面才读取卡片世界书')
  await page.locator('summary').filter({ hasText: '生图位置和大小' }).click()
  await page.getByLabel('生图显示位置').selectOption('right')
  await page.evaluate(() => {
    for (let index = 0; index < 2; index++) {
      const row = document.createElement('article')
      row.setAttribute('data-chat-turn', String(index + 1))
      row.style.cssText = 'height: 500px; padding-top: 30px'
      const figure = document.createElement('figure')
      figure.className = 'dsh-tavern-illustration'
      figure.setAttribute('data-kind', 'dsh-tavern-image/image')
      figure.innerHTML = '<img src="/dsh-tavern-gen/img/test-' + index + '.png" alt="正文测试图片 ' + index + '"><figcaption>图片位置 ' + index + '</figcaption>'
      row.append(figure)
      document.body.append(row)
    }
  })
  const placement = page.getByLabel('正文图片查看器', { exact: true })
  await placement.waitFor()
  await page.getByLabel('正文跟图方式').selectOption('off')
  const first = await placement.locator('img').getAttribute('alt')
  const next = first === '正文测试图片 0' ? '下一张正文图片' : '上一张正文图片'
  await placement.getByLabel(next).click()
  assert.notEqual(await placement.locator('img').getAttribute('alt'), first)
  await page.getByLabel('正文跟图方式').selectOption('pointer')
  await page.evaluate(() => {
    const row = document.querySelector('article[data-chat-turn="2"]')
    row.scrollIntoView({ block: 'center' })
    row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: innerHeight / 2 }))
  })
  await placement.locator('img[alt="正文测试图片 1"]').waitFor()
  await page.getByLabel('正文跟图方式').selectOption('scroll')
  await page.evaluate(() => {
    document.querySelector('article[data-chat-turn="1"] figure').scrollIntoView({ block: 'center' })
    window.dispatchEvent(new Event('scroll'))
  })
  await placement.locator('img[alt="正文测试图片 0"]').waitFor()

  await page.getByLabel('生图显示位置').selectOption('floating')
  await page.locator('[data-dti-placement="floating"]').waitFor()
  await page.getByLabel('生图显示位置').selectOption('inline')
  await placement.waitFor({ state: 'hidden' })
  await page.evaluate(() => document.querySelectorAll('article[data-chat-turn]').forEach(element => element.remove()))
  await page.locator('summary').filter({ hasText: '生图位置和大小' }).click()
  await page.locator('summary').filter({ hasText: '生成设置' }).click()
  await page.getByLabel('一轮几张', { exact: true }).waitFor()
  await page.getByLabel('默认生图模式').selectOption('auto')
  await page.waitForFunction(() => document.querySelector('[aria-label="默认生图模式"]')?.value === 'auto')
  assert.equal(state.config.generationMode, 'auto')
  await page.getByLabel('默认生图模式').selectOption('reference')
  await page.waitForFunction(() => document.querySelector('[aria-label="默认生图模式"]')?.value === 'reference')
  const ensureDisclosure = async title => {
    const summary = page.locator('summary').filter({ hasText: new RegExp('^' + title) })
    if (!await summary.evaluate(node => node.parentElement.open)) await summary.click()
  }
  const openPromptModule = async title => {
    const details = page.locator('[data-prompt-block]').filter({ has: page.locator('summary strong', { hasText: new RegExp('^' + title + '$') }) }).locator(':scope > details')
    if (!await details.evaluate(node => node.open)) await details.locator(':scope > summary').click()
  }
  await page.getByRole('button', { name: '生图工作台', exact: true }).click()
  for (const label of ['旧版设置与画风库', '未指定模板时的提示词格式', '剧情挂载']) {
    assert.equal(await page.getByText(label, { exact: true }).count(), 0)
  }
  assert.equal(await page.getByLabel('生图资料库', { exact: true }).count(), 0)
  assert.equal(await page.getByLabel('人物概览', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '📥 导入工作流', exact: true }).count(), 0)
  await page.getByRole('button', { name: '资料库', exact: true }).click()
  const styleLibrary = page.locator('summary').filter({ hasText: /^画风库/ })
  await styleLibrary.click()
  await page.getByRole('button', { name: '编辑 折叠测试套', exact: true }).click()
  assert.equal(await page.getByLabel('这套画风的正面词', { exact: true }).inputValue(), 'artist:fold_test')
  const oldBackup = { data: { config: { stylePresets: [{ id: 'backup-style', name: '备份画风', artist: 'soft light', negative: 'lowres' }] } } }
  await page.getByLabel('导入旧画风', { exact: true }).setInputFiles({ name: 'backup.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(oldBackup)) })
  await page.getByText('已导入 1 套画风', { exact: true }).waitFor()
  assert.deepEqual(state.config.stylePresets.map(item => item.id), ['preset-fold', 'backup-style'])
  await styleLibrary.click()

  await ensureDisclosure('生图词条库')
  await page.getByRole('button', { name: '新建词条', exact: true }).click()
  const entryEditor = page.getByLabel('编辑生图词条', { exact: true })
  await entryEditor.getByLabel('词条名称', { exact: true }).fill('老窗框')
  await entryEditor.getByLabel('分组', { exact: true }).fill('地点')
  await entryEditor.getByLabel('视觉资料', { exact: true }).fill('深绿色铸铁窗框')
  await entryEditor.getByLabel('命中任一词', { exact: true }).fill('窗边，晨光')
  await entryEditor.getByLabel('视觉资料', { exact: true }).fill('临时修改')
  await entryEditor.getByRole('button', { name: '撤销词条修改', exact: true }).click()
  assert.equal(await entryEditor.getByLabel('视觉资料', { exact: true }).inputValue(), '深绿色铸铁窗框')
  await page.getByRole('button', { name: '生图工作台', exact: true }).click()
  await page.getByRole('button', { name: '资料库', exact: true }).click()
  await ensureDisclosure('生图词条库')
  assert.equal(await entryEditor.getByLabel('词条名称', { exact: true }).inputValue(), '老窗框')
  await entryEditor.getByRole('button', { name: '保存词条', exact: true }).click()
  await page.getByText('词条已保存', { exact: true }).waitFor()
  assert.deepEqual(state.config.promptEntries[0].any, ['窗边', '晨光'])
  assert.equal(state.config.generationMode, 'reference')
  assert.equal(state.config.promptMode, 'tags')
  assert.equal(state.config.imageChannels[0].model, 'keep-exact-model')
  assert.ok(calls.filter(call => call.path === '/config').every(call => !Object.hasOwn(call.body.config, 'imageChannels')), 'mode switches never alter model/channel configuration')

  const waitForConfigPatch = expected => page.waitForResponse(response => {
    if (!response.url().endsWith('/config') || response.request().method() !== 'POST') return false
    const patch = response.request().postDataJSON()?.config
    return Object.entries(expected).every(([key, value]) => patch?.[key] === value)
  })
  await page.getByRole('button', { name: '人物库', exact: true }).click()
  await ensureDisclosure('角色与服装生成规则')
  const selectDesignMode = async value => {
    const response = waitForConfigPatch({ designPromptMode: value })
    await page.getByLabel('角色与服装生成写法', { exact: true }).selectOption(value)
    await response
    assert.equal(state.config.designPromptMode, value)
  }
  const saveDesignRequirements = async (characterText, outfitText) => {
    const expected = { characterDesignRequirements: characterText, outfitDesignRequirements: outfitText }
    const response = waitForConfigPatch(expected)
    await page.getByRole('button', { name: '保存角色与服装要求', exact: true }).click()
    const saved = await response
    assert.deepEqual(saved.request().postDataJSON().config, expected, 'the save button POSTs both requirement fields')
    assert.deepEqual({
      characterDesignRequirements: state.config.characterDesignRequirements,
      outfitDesignRequirements: state.config.outfitDesignRequirements,
    }, expected)
  }
  const chineseCharacterRequirements = '人物外貌使用完整中文短句，保留角色已有特征。'
  const chineseOutfitRequirements = '服装名称简洁；颜色与款式使用中文描述。'
  await selectDesignMode('chinese')
  await page.getByLabel('角色生成要求', { exact: true }).fill(chineseCharacterRequirements)
  await page.getByLabel('服装生成要求', { exact: true }).fill(chineseOutfitRequirements)
  await saveDesignRequirements(chineseCharacterRequirements, chineseOutfitRequirements)
  await page.getByRole('button', { name: '生图工作台', exact: true }).click()
  await page.getByRole('button', { name: '人物库', exact: true }).click()
  await ensureDisclosure('角色与服装生成规则')
  assert.equal(await page.getByLabel('角色与服装生成写法', { exact: true }).inputValue(), 'chinese', 'the saved language mode survives leaving and reopening settings')
  assert.equal(await page.getByLabel('角色生成要求', { exact: true }).inputValue(), chineseCharacterRequirements)
  assert.equal(await page.getByLabel('服装生成要求', { exact: true }).inputValue(), chineseOutfitRequirements)

  const englishCharacterRequirements = 'Use concise English prose; preserve established character traits.'
  const englishOutfitRequirements = 'Use descriptive English tags with explicit colors and garment shapes.'
  await selectDesignMode('tags')
  await page.getByLabel('角色生成要求', { exact: true }).fill(englishCharacterRequirements)
  await page.getByLabel('服装生成要求', { exact: true }).fill(englishOutfitRequirements)
  await saveDesignRequirements(englishCharacterRequirements, englishOutfitRequirements)
  await page.getByRole('button', { name: '生图工作台', exact: true }).click()
  await page.getByRole('button', { name: '人物库', exact: true }).click()
  await ensureDisclosure('角色与服装生成规则')
  assert.equal(await page.getByLabel('角色与服装生成写法', { exact: true }).inputValue(), 'tags', 'the English Tag mode survives leaving and reopening settings')
  assert.equal(await page.getByLabel('角色生成要求', { exact: true }).inputValue(), englishCharacterRequirements)
  assert.equal(await page.getByLabel('服装生成要求', { exact: true }).inputValue(), englishOutfitRequirements)
  assert.deepEqual(state.config.promptPresets, preservedPromptPresets, 'saving design instructions does not rewrite an existing prompt preset entry')
  assert.deepEqual(state.definitions.characters[0], preservedCharacterEntry, 'saving design instructions does not rewrite existing character/outfit records')
  assert.deepEqual(worldbooks, preservedWorldbooks, 'saving design instructions does not rewrite existing worldbook entries')

  await page.getByRole('button', { name: '生图工作台', exact: true }).click()
  await page.getByLabel('正在编辑的模板').selectOption('legacy-entry')
  await openPromptModule('生成方式')
  assert.equal(await page.getByLabel('生成规则', { exact: true }).inputValue(), '优先写当前画面的主体。')
  await page.getByRole('button', { name: '保存并设为默认', exact: true }).click()
  await page.getByText('当前渠道使用：旧提示词条目', { exact: false }).waitFor()
  assert.equal(state.config.activePromptPreset, 'legacy-entry')
  assert.equal(state.config.promptPresets[0].positive, 'legacy positive')
  assert.equal(state.config.promptPresets[0].negative, 'legacy negative')
  assert.equal(state.config.promptPresets[0].structure.blocks[0].kind, 'output')
  assert.equal(state.config.promptPresets[0].structure.generationRules, undefined)

  await page.getByRole('button', { name: '人物库', exact: true }).click()
  const openDisclosure = title => page.getByText(title, { exact: true }).click()
  const characterTile = page.getByRole('button', { name: '查看角色 林月', exact: true })
  const cardFilter = page.getByLabel('按卡筛选人物')
  await cardFilter.selectOption('cards/story.json')
  assert.equal(await page.getByRole('button', { name: '查看角色 另一张卡的角色', exact: true }).count(), 0)
  assert.equal(await characterTile.locator('img').count(), 0)
  await characterTile.click()
  await page.getByLabel('角色与参考图设置', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Agent 角色工具', exact: true }).click()
  for (const name of ['从照片识别', '设计新角色', '改这个角色']) await page.getByRole('button', { name, exact: true }).waitFor()
  await page.getByRole('button', { name: 'Agent 角色工具', exact: true }).click()
  await openDisclosure('角色生图提示词')
  const role = page.getByLabel('角色提示词', { exact: true })
  await role.getByRole('button', { name: /^外貌背面/ }).click()
  assert.equal(await role.getByLabel('角色资料原文').inputValue(), 'dark hair tied loosely')
  await role.getByLabel('角色资料原文').fill('背影可见松挽的长发。')
  await role.getByLabel('角色资料原文').fill('临时背影修改')
  await page.getByRole('button', { name: '撤销人物修改', exact: true }).click()
  assert.equal(await role.getByLabel('角色资料原文').inputValue(), '背影可见松挽的长发。')
  await role.getByRole('button', { name: '添加资料', exact: true }).click()
  await role.getByLabel('资料名称', { exact: true }).fill('辨识物')
  await role.getByLabel('资料内容', { exact: true }).fill('左手戴一枚细银戒。')
  await role.getByLabel('用于生图', { exact: true }).check()
  await role.getByRole('button', { name: '生图原文', exact: true }).click()
  const rolePrompt = page.getByLabel('角色正面提示词', { exact: true })
  assert.equal(await rolePrompt.inputValue(), 'keep original traits')
  const customRole = '林月的头发自然垂落。\n她看向窗外。'
  await rolePrompt.fill(customRole)
  await page.getByLabel('角色负面提示词', { exact: true }).fill('避免改变发色')
  await openDisclosure('角色服装（1）')
  const customOutfit = '白衬衫的领口敞开一颗纽扣。\n袖口整齐。'
  await page.getByLabel('服装正面提示词', { exact: true }).fill(customOutfit)
  const outfitEditor = page.getByLabel('服装提示词', { exact: true })
  await outfitEditor.getByRole('button', { name: '添加资料', exact: true }).click()
  await outfitEditor.getByLabel('资料名称', { exact: true }).fill('收藏来源')
  await outfitEditor.getByLabel('资料内容', { exact: true }).fill('常用衣橱')
  await openDisclosure('服装参考图')
  const saveLibrary = async label => {
    await Promise.all([page.waitForResponse(response => response.url().endsWith('/definitions') && response.request().method() === 'POST'), page.getByRole('button', { name: label, exact: true }).click()])
    await page.getByText('人物库已保存', { exact: false }).first().waitFor()
  }
  const upload = async (label, name) => {
    await page.getByLabel(label, { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer: png })
    const section = page.getByLabel(label.replace('上传参考图', '参考图设置'), { exact: true })
    await section.getByRole('img').waitFor()
  }
  await upload('角色「林月」上传参考图', 'person.png')
  await page.getByLabel('角色「林月」一致性补充', { exact: true }).fill('保持脸型，动作由正文决定')
  await upload('服装「白衬衫」上传参考图', 'shirt.png')
  await page.getByLabel('服装「白衬衫」一致性补充', { exact: true }).fill('保持领口设计')
  assert.equal(state.definitions.characters[0].referenceImage, undefined, 'uploads remain drafts until library save')
  await saveLibrary('保存人物库')
  assert.equal(state.definitions.characters[0].referenceImage.name, 'person.png')
  assert.equal(state.definitions.characters[0].outfits[0].referenceImage.name, 'shirt.png')
  assert.equal(state.definitions.characters[0].consistencyText, '保持脸型，动作由正文决定')
  assert.equal(state.definitions.characters[0].outfits[0].consistencyText, '保持领口设计')
  assert.equal(state.definitions.characters[0].traits.face, 'keep original traits')
  assert.equal(state.definitions.characters[0].traits.faceBack, '背影可见松挽的长发。')
  assert.equal(state.definitions.characters[0].traits.negative, '避免改变发色')
  assert.equal(state.definitions.characters[0].imagePrompt, customRole)
  assert.equal(state.definitions.characters[0].outfits[0].imagePrompt, customOutfit)
  assert.deepEqual(state.definitions.characters[0].imageDetails, [{ name: '辨识物', text: '左手戴一枚细银戒。', useForImage: true }])
  assert.deepEqual(state.definitions.characters[0].outfits[0].imageDetails, [{ name: '收藏来源', text: '常用衣橱', useForImage: false }])

  await page.getByRole('button', { name: '返回概览', exact: true }).click()
  await characterTile.locator('img').waitFor()
  assert.ok(await characterTile.locator('img').evaluate(img => img.decode().then(() => img.naturalWidth)))
  const bounds = await characterTile.boundingBox()
  assert.ok(bounds && bounds.width <= 92 && Math.abs(bounds.width - bounds.height) <= 1, 'character thumbnail stays compact and square')
  await page.getByLabel('人物概览').screenshot({ path: join(tmpdir(), 'dsh-image-character-grid.png') })
  await characterTile.click()
  await openDisclosure('通用服装库')
  const sharedPrompt = page.getByLabel('通用服装正面提示词', { exact: true })
  assert.equal(await sharedPrompt.inputValue(), 'coat')
  await sharedPrompt.fill('一件深灰外套，袖口缀有银色纽扣。')
  await openDisclosure('通用服装参考图')
  await upload('通用服装「通用外套」上传参考图', 'coat.png')
  await page.getByLabel('通用服装「通用外套」一致性补充', { exact: true }).fill('保持袖口')
  await saveLibrary('保存服装库')
  assert.equal(state.outfits[0].referenceImage.name, 'coat.png')
  assert.equal(state.outfits[0].consistencyText, '保持袖口')
  assert.equal(state.outfits[0].imagePrompt, '一件深灰外套，袖口缀有银色纽扣。')
  await page.getByLabel('角色「林月」移除参考图', { exact: true }).click()
  await saveLibrary('保存人物库')
  assert.equal(state.definitions.characters[0].referenceImage, null)
  assert.equal(state.definitions.characters[0].consistencyText, '保持脸型，动作由正文决定')
  assert.equal(calls.some(call => call.method === 'DELETE'), false)

  // A stale draft survives a rejected save; explicit reload obtains the other editor's revision.
  await page.getByLabel('角色「林月」一致性补充', { exact: true }).fill('未保存的草稿')
  state.definitions.characters[0].consistencyText = '另一处已保存的文字'
  state.definitions.revision = String(++libraryRevision)
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/definitions') && response.status() === 409), page.getByRole('button', { name: '保存人物库', exact: true }).click()])
  await page.getByRole('button', { name: '重新载入最新人物库', exact: true }).waitFor()
  assert.equal(await page.getByLabel('角色「林月」一致性补充', { exact: true }).inputValue(), '未保存的草稿')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '重新载入最新人物库', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="角色「林月」一致性补充"]')?.value === '另一处已保存的文字')
  await saveLibrary('保存人物库')
  assert.equal(state.definitions.characters[0].consistencyText, '另一处已保存的文字')

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByText('管理生图接口', { exact: true }).click()
  await page.getByLabel('生图提供商').selectOption('custom')
  await page.getByLabel('API 协议', { exact: true }).selectOption('novelai')
  await page.waitForFunction(() => document.querySelector('[aria-label="API 协议"]')?.value === 'novelai' && document.querySelector('[aria-label="默认生图模式"] option[value="reference"]')?.disabled === true)
  assert.equal(await page.locator('[aria-label="默认生图模式"] option[value="reference"]').evaluate(option => option.disabled), true, 'NovelAI protocol cannot select reference mode')
  await page.getByLabel('默认生图模式').selectOption('auto')
  await page.getByText('当前渠道不支持参考图输入；自动模式下每张都按文生图提交。', { exact: true }).waitFor()
  assert.equal(state.config.generationMode, 'auto')
  await page.getByLabel('API 协议', { exact: true }).selectOption('openai')
  assert.equal(await page.locator('[aria-label="默认生图模式"] option[value="reference"]').evaluate(option => option.disabled), false, 'OpenAI protocol exposes reference mode')
  await page.getByLabel('API 协议', { exact: true }).selectOption('atlascloud')
  await page.getByLabel('尺寸参数格式', { exact: true }).waitFor()
  assert.equal(await page.locator('[aria-label="默认生图模式"] option[value="reference"]').evaluate(option => option.disabled), false, 'AtlasCloud compatibility protocol exposes reference mode')
  await page.getByLabel('渠道名称', { exact: true }).fill('mock custom channel')
  await page.getByLabel('API 根地址', { exact: true }).fill('https://images.mock.invalid/v1')
  await page.getByLabel('模型', { exact: true }).fill('mock-image-model')
  await page.getByLabel('渠道 API Key', { exact: true }).fill('fake-browser-test-key')
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/image-channel-test')), page.getByRole('button', { name: '保存并测试连接' }).click()])
  const customChannel = state.config.imageChannels.find(channel => channel.provider === 'custom')
  assert.ok(customChannel)
  assert.equal(customChannel.baseUrl, 'https://images.mock.invalid/v1')
  assert.equal(customChannel.model, 'mock-image-model')
  assert.equal(customChannel.options.apiProtocol, 'atlascloud')
  assert.equal(customChannel.hasApiKey, true)
  assert.equal(savedApiKeys.get(customChannel.id), 'fake-browser-test-key')
  assert.equal(Object.hasOwn(customChannel, 'apiKey'), false, 'saved state exposes only the key presence flag')
  assert.equal(await page.getByLabel('渠道 API Key', { exact: true }).inputValue(), '', 'saved key is never rendered back into the UI')
  await page.screenshot({ path: screenshotPath, fullPage: true })

  await page.getByRole('button', { name: '本地部署', exact: true }).click()
  await page.getByRole('button', { name: '启用选定的完整工作流' }).waitFor()
  assert.match(await page.getByRole('status').filter({ hasText: '旧版 ComfyUI 简易模式' }).textContent(), /原配置和数据已保留/)
  assert.equal(await page.getByRole('button', { name: '设为默认', exact: true }).count(), 0, '工作台不再设置默认工作流')
  assert.equal(await page.getByText('锁定（不管别处选什么都用这张）', { exact: true }).count(), 0)
  await page.getByRole('button', { name: /编辑 \/ LoRA/ }).click()
  await page.getByLabel('参考图 1 接入节点').count().then(count => assert.equal(count, 0, 'multiple LoadImage nodes are never auto-selected'))
  assert.match(await page.getByText(/尚未保存明确映射/).textContent(), /多个接图节点时不会猜测/)
  await page.getByText('手动调整接入', { exact: true }).click()
  await page.getByText('参考图接入顺序', { exact: true }).click()
  await page.getByRole('button', { name: '＋ 添加接入节点' }).click()
  assert.equal(await page.getByLabel('参考图 1 接入节点').inputValue(), '', 'new mappings require an explicit node choice')
  await page.getByLabel('参考图 1 接入节点').selectOption(JSON.stringify(['15', 'image']))
  await page.getByRole('button', { name: '＋ 添加接入节点' }).click()
  await page.getByLabel('参考图 2 接入节点').selectOption(JSON.stringify(['23', 'file_b']))
  await page.getByText('节点输入已保存', { exact: true }).waitFor()
  assert.deepEqual(workflowDetail.bindings.referenceImages, [{ node: '15', input: 'image' }, { node: '23', input: 'file_b' }])
  await page.getByRole('button', { name: '自动识别' }).click()
  await page.getByText('识别 6 种节点', { exact: true }).waitFor()
  await page.getByText('提示词输入', { exact: true }).click()
  await page.getByLabel('提示词节点字段', { exact: true }).selectOption(JSON.stringify(['22', 'caption']))
  await page.getByRole('button', { name: '插入 %prompt', exact: true }).click()
  await page.getByRole('button', { name: '保存节点文字', exact: true }).click()
  await page.getByText('节点输入已保存', { exact: true }).waitFor()
  assert.equal(workflowDetail.prompt['22'].inputs.caption, 'Keep this line\n%prompt')
  await page.getByRole('button', { name: '打开节点图' }).click()
  const graph = page.getByRole('dialog', { name: '工作流可视化编辑器' })
  assert.ok((await graph.boundingBox()).y >= 48)
  assert.ok((await graph.getByRole('button', { name: '关闭工作流图' }).boundingBox()).x < 200)
  const searchNode = graph.getByLabel('查找工作流节点')
  await searchNode.fill('CLIPLoader')
  await graph.getByRole('button', { name: '#80 CLIPLoader', exact: true }).click()
  assert.equal(await graph.getByRole('button', { name: '插入 %prompt', exact: true }).count(), 0)
  assert.equal(await graph.getByRole('button', { name: '插入 %negative', exact: true }).count(), 0)
  await searchNode.fill('width')
  await graph.getByRole('button', { name: '#24 ImageScale' }).click()
  await graph.getByLabel('mode', { exact: true }).selectOption('bilinear')
  await graph.getByRole('button', { name: /来自 #23.*IMAGE/ }).click()
  await graph.getByRole('button', { name: '接入参考图 3', exact: true }).click()
  await searchNode.fill('PreviewImage')
  await graph.getByRole('button', { name: '#26 PreviewImage' }).click()
  await graph.getByRole('button', { name: '设为图片输出', exact: true }).click()
  await page.screenshot({ path: join(tmpdir(), 'dsh-comfy-node-workbench.png') })
  await graph.getByRole('button', { name: '保存工作流图' }).click()
  await graph.waitFor({ state: 'hidden' })
  assert.equal(workflowDetail.prompt['24'].inputs.mode, 'bilinear')
  assert.equal(workflowDetail.outputNode, '26')
  assert.deepEqual(workflowDetail.bindings.referenceImages[2], { node: '23', input: 'file_a' })
  await page.getByRole('button', { name: /编辑 \/ LoRA/ }).click()
  assert.equal(await page.locator('summary').filter({ hasText: /^LoRA 连续生图$/ }).count(), 0)
  await page.getByRole('button', { name: '图片编辑', exact: true }).click()
  const editImages = page.getByRole('dialog', { name: '图片编辑', exact: true })
  await editImages.locator('input[type=file]').setInputFiles([{ name: 'stage.png', mimeType: 'image/png', buffer: png }, { name: 'palette.png', mimeType: 'image/png', buffer: png }])
  await editImages.getByRole('button', { name: 'image2', exact: true }).waitFor()
  await editImages.getByLabel('图片编辑指令').fill('让 image<1> 采用 <image2> 的配色')
  await editImages.getByRole('button', { name: '生成编辑图片', exact: true }).click()
  await editImages.getByText('编辑完成', { exact: true }).waitFor()
  assert.equal(calls.find(call => call.path === '/image-edit').body.sourceImages.length, 2)
  await editImages.getByRole('button', { name: '用结果继续图生图', exact: true }).click()
  await editImages.getByRole('button', { name: 'image2', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await editImages.getByRole('button', { name: 'image1', exact: true }).count(), 1)
  await editImages.getByRole('button', { name: '返回画廊', exact: true }).click()
  await page.getByRole('button', { name: '📥 导入工作流', exact: true }).click()
  const importGraph = { '1': { class_type: 'LoadImage', inputs: { image: 'test.png' } } }
  await page.getByLabel('选 JSON 文件').setInputFiles({ name: '放大用.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(importGraph)) })
  const preview = page.getByLabel('工作流导入预检', { exact: true })
  await preview.waitFor()
  const importName = preview.getByLabel('工作流名称', { exact: true })
  assert.equal(await importName.inputValue(), '放大用')
  assert.equal(calls.some(call => call.path === '/workflow-import' && call.body.preview !== true), false)
  await importName.fill('局部放大')
  await preview.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByText('局部放大', { exact: true }).waitFor()
  await page.getByText('Reference workflow', { exact: true }).waitFor()
  assert.deepEqual(calls.filter(call => call.path === '/workflow-import').at(-1).body, { workflow: importGraph, name: '局部放大', outputNode: '10' })
  await page.getByRole('button', { name: '启用选定的完整工作流' }).click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="生图提供商"]')?.value === 'comfyui')
  assert.equal(state.config.comfyMode, 'workflow')
  assert.equal(state.config.defaultWorkflow, 'workflow-a')
  assert.deepEqual(state.config.comfySimple, { checkpoint: 'keep-legacy-checkpoint' }, 'migration preserves the old settings as recovery data')
  assert.equal(state.configurationWarning, '')

  await page.getByRole('button', { name: '生图工作台', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '从结构化模板新建', exact: true }).count(), 0)
  await page.getByLabel('正在编辑的模板', { exact: true }).selectOption('')
  assert.equal(await page.locator('.dti-module-disclosure[open]').count(), 0)
  await openPromptModule('生成方式')
  const builtInOutput = page.getByLabel('输出写法', { exact: true })
  await builtInOutput.selectOption('natural')
  await builtInOutput.selectOption('structured')
  assert.equal(await page.getByLabel('给模型的填写要求').count(), 5)
  assert.equal(await page.getByText('模板格式', { exact: true }).count(), 0)
  await page.getByRole('button', { name: '新建模板', exact: true }).click()
  await ensureDisclosure('管理模板')
  await page.getByLabel('预设名称', { exact: true }).fill('场景模板')
  await page.getByLabel('项目', { exact: true }).fill('剧情插图')
  const templateBeforeSwitch = await page.getByLabel('正在编辑的模板').inputValue()
  await page.getByRole('button', { name: '资料库', exact: true }).click()
  await page.getByRole('button', { name: '生图工作台', exact: true }).click()
  assert.equal(await page.getByLabel('正在编辑的模板').inputValue(), templateBeforeSwitch)
  await ensureDisclosure('管理模板')
  assert.equal(await page.getByLabel('预设名称', { exact: true }).inputValue(), '场景模板')
  const modules = page.getByLabel('提示词模块', { exact: true })
  assert.equal(await modules.getByRole('button', { name: '画风', exact: true }).count(), 0)
  assert.equal(await page.getByLabel('画风正面', { exact: true }).count(), 0)
  assert.equal(await page.getByLabel('预设正面指导', { exact: true }).count(), 0)
  const tryoutSummary = page.locator('summary').filter({ hasText: /^试写台$/ })
  assert.equal(await tryoutSummary.evaluate(element => element.parentElement.open), false)
  assert.equal(await modules.getByLabel('分节名称').first().inputValue(), '场景')
  assert.equal(await modules.getByLabel('生成规则', { exact: true }).count(), 1)
  await page.getByText('模板输入', { exact: true }).click()
  await page.getByRole('button', { name: '添加模板输入', exact: true }).click()
  await page.getByLabel('输入名称', { exact: true }).fill('地点')
  await page.getByLabel('输入标识', { exact: true }).fill('place')
  await page.getByLabel('默认内容', { exact: true }).fill('旧车站')
  await page.getByRole('button', { name: '添加分节', exact: true }).click()
  await page.getByLabel('分节名称', { exact: true }).last().fill('构图')
  await page.getByRole('button', { name: '添加分节', exact: true }).click()
  await page.getByLabel('分节名称', { exact: true }).last().fill('光线')
  await page.getByRole('button', { name: '上移分节', exact: true }).last().click()
  await page.locator('[data-prompt-block="光线"]').dragTo(page.locator('[data-prompt-block="构图"]'))
  await page.waitForFunction(() => document.querySelectorAll('[data-prompt-block]')[2]?.dataset.promptBlock === '构图')
  await page.getByRole('button', { name: '上移分节', exact: true }).last().click()
  await page.getByLabel('新增分节类型', { exact: true }).selectOption('negative')
  await page.getByRole('button', { name: '添加分节', exact: true }).click()
  await page.getByLabel('固定内容', { exact: true }).fill('避免水印')
  await page.getByLabel('绑定目标', { exact: true }).selectOption('workflow:workflow-a')
  await page.getByRole('button', { name: '添加绑定', exact: true }).click()
  await page.getByLabel('新增分节类型', { exact: true }).selectOption('style')
  await page.getByRole('button', { name: '添加分节', exact: true }).click()
  await page.getByLabel('分节名称', { exact: true }).last().fill('画风')
  const styleRow = page.locator('[data-prompt-block="画风"]')
  await styleRow.getByLabel('画风来源', { exact: true }).selectOption('preset-fold')
  const styleModule = styleRow.getByLabel('补充画风', { exact: true })
  await styleModule.fill('柔和的水彩质感')
  await styleRow.getByRole('button', { name: '就地编辑引用资料', exact: true }).click()
  const inlineStyle = styleRow.getByLabel('引用画风正面词', { exact: true })
  await inlineStyle.fill('artist:inline_edit')
  await inlineStyle.blur()
  await page.waitForResponse(response => response.url().endsWith('/config') && response.request().postDataJSON()?.config?.stylePresets?.some(item => item.artist === 'artist:inline_edit'))
  assert.equal(state.config.stylePresets.find(item => item.id === 'preset-fold').artist, 'artist:inline_edit')
  await inlineStyle.fill('artist:fold_test')
  await inlineStyle.blur()
  await page.waitForResponse(response => response.url().endsWith('/config') && response.request().postDataJSON()?.config?.stylePresets?.some(item => item.artist === 'artist:fold_test'))
  await styleRow.getByRole('button', { name: '收起引用编辑', exact: true }).click()
  const styleUsage = styleRow.getByLabel('限定用途', { exact: true })
  await styleUsage.selectOption('plugin')
  await styleUsage.selectOption('stage')
  assert.equal(await styleUsage.inputValue(), 'stage')
  await styleUsage.selectOption('__custom__')
  await styleRow.getByLabel('限定用途标识', { exact: true }).fill('custom-studio')
  await page.getByLabel('新增分节类型', { exact: true }).selectOption('lora')
  await page.getByRole('button', { name: '添加分节', exact: true }).click()
  await page.getByLabel('LoRA 工作流', { exact: true }).selectOption('workflow-a')
  await page.getByLabel('LoRA 节点', { exact: true }).selectOption('19')
  await page.getByLabel('LoRA 文件', { exact: true }).fill('studio.safetensors')
  const loraModule = page.locator('[data-prompt-block="ComfyUI LoRA"]')
  await loraModule.getByRole('button', { name: '就地编辑工作流', exact: true }).click()
  await loraModule.getByRole('region', { name: '工作流可视化编辑器' }).waitFor()
  assert.equal(await page.getByLabel('模块引用编辑', { exact: true }).count(), 1)
  await loraModule.getByRole('button', { name: '收起引用编辑', exact: true }).click()
  await page.getByLabel('新增分节类型', { exact: true }).selectOption('entries')
  await page.getByRole('button', { name: '添加分节', exact: true }).click()
  await page.getByLabel('引用词条分组', { exact: true }).selectOption('地点')
  const entriesModule = page.locator('[data-prompt-block="词条库"]')
  await entriesModule.getByRole('button', { name: '就地编辑引用资料', exact: true }).click()
  const inlineEntry = entriesModule.getByLabel('引用词条编辑', { exact: true })
  await inlineEntry.getByLabel('编辑引用词条', { exact: true }).selectOption(state.config.promptEntries[0].id)
  await inlineEntry.getByLabel('视觉资料', { exact: true }).fill('深绿色铸铁窗框，玻璃有细小雨痕')
  await inlineEntry.getByRole('button', { name: '保存词条', exact: true }).click()
  await inlineEntry.getByText('词条已保存', { exact: true }).waitFor()
  assert.match(state.config.promptEntries[0].content, /雨痕/)
  await entriesModule.getByRole('button', { name: '收起引用编辑', exact: true }).click()
  await page.getByLabel('新增分节类型', { exact: true }).selectOption('library')
  await page.getByRole('button', { name: '添加分节', exact: true }).click()
  await page.getByLabel('引用对象', { exact: true }).selectOption('outfits')
  await page.getByLabel('引用规则', { exact: true }).fill('按原名引用实际穿着的服装。')
  const peopleModule = page.locator('[data-prompt-block="角色与服装引用"]')
  await peopleModule.getByLabel('指定角色', { exact: true }).selectOption('person-a')
  await peopleModule.getByRole('button', { name: '就地编辑引用资料', exact: true }).click()
  const inlinePerson = peopleModule.getByLabel('引用人物资料', { exact: true })
  assert.equal(await inlinePerson.getByRole('button', { name: '保存人物资料', exact: true }).count(), 1)
  assert.equal(await inlinePerson.getByText('从世界书生成角色', { exact: true }).count(), 0)
  await peopleModule.getByRole('button', { name: '收起引用编辑', exact: true }).click()
  await peopleModule.getByLabel('指定角色', { exact: true }).selectOption('')
  await page.getByLabel('绑定目标', { exact: true }).selectOption('channel:openai-channel')
  await page.getByRole('button', { name: '添加绑定', exact: true }).click()
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/config') && response.request().postDataJSON()?.config?.promptPresets?.some(item => item.name === '场景模板')),
    page.getByRole('button', { name: '保存工作台', exact: true }).click(),
  ])
  assert.deepEqual(state.config.promptPresets.find(item => item.name === '场景模板').structure, {
    format: 'structured', blocks: [
      { kind: 'scene', title: '场景', text: '' }, STRUCTURED_PROMPT_TEMPLATE.structure.blocks[0],
      { kind: 'section', title: '光线', text: '' }, { kind: 'section', title: '构图', text: '' },
      { kind: 'negative', title: '排除词', text: '避免水印' }, { kind: 'style', title: '画风', text: '柔和的水彩质感', usage: 'custom-studio', styleId: 'preset-fold' },
      { kind: 'lora', title: 'ComfyUI LoRA', text: 'studio.safetensors', workflowId: 'workflow-a', node: '19', slot: '' },
      { kind: 'entries', title: '词条库', text: '', entryGroup: '地点' },
      { kind: 'library', title: '角色与服装引用', text: '按原名引用实际穿着的服装。', librarySource: 'outfits', characterId: '', outfitId: '' },
    ], inputs: [{ key: 'place', label: '地点', default: '旧车站', required: false }], targets: [{ kind: 'workflow', id: 'workflow-a' }, { kind: 'channel', id: 'openai-channel' }],
  })
  assert.equal(state.config.promptPresets.find(item => item.name === '场景模板').project, '剧情插图')
  await page.getByLabel('筛选项目', { exact: true }).selectOption('project:剧情插图')
  assert.equal(await page.getByRole('button', { name: /^场景模板/ }).count(), 1)
  await page.getByLabel('搜索模板', { exact: true }).fill('不匹配')
  await page.getByText('没有匹配的模板', { exact: true }).waitFor()
  await page.getByLabel('搜索模板', { exact: true }).clear()
  await page.getByLabel('新增分节类型', { exact: true }).selectOption('mechanism')
  await page.getByRole('button', { name: '添加分节', exact: true }).click()
  await page.getByLabel('生成机制', { exact: true }).selectOption('seed_series')
  await page.getByLabel('机制图片数量', { exact: true }).fill('2')
  await page.getByLabel('机制种子', { exact: true }).fill('123')
  await tryoutSummary.click()
  const moreOptions = page.locator('summary').filter({ hasText: /^更多选项$/ })
  assert.equal(await moreOptions.evaluate(node => node.parentElement.open), false)
  await moreOptions.click()
  await page.getByLabel('试写输入 place', { exact: true }).fill('雨后车站')
  await page.getByLabel('试写用途', { exact: true }).selectOption('__custom__')
  await page.getByLabel('试写用途标识', { exact: true }).fill('custom-studio')
  await page.getByLabel('试写目标', { exact: true }).selectOption('workflow:workflow-a')
  await page.getByLabel('试写模式', { exact: true }).selectOption('text')
  await page.getByLabel('测试场景', { exact: true }).fill('【光线】\n窗外晨光\n\n【构图】\n主体靠左')
  await page.getByLabel('对照', { exact: true }).selectOption('saved')
  const draftResult = page.getByLabel('最终提示词', { exact: true })
  const baselineResult = page.getByLabel('已保存配置', { exact: true })
  await draftResult.waitFor()
  await draftResult.getByText('查看组装明细', { exact: true }).click()
  await draftResult.getByText('规划词条命中 1 条', { exact: true }).click()
  await draftResult.getByText('命中：晨光', { exact: true }).waitFor()
  assert.match(await draftResult.textContent(), /光线.*构图.*artist:fold_test.*柔和的水彩质感.*避免水印.*lowres/s)
  assert.doesNotMatch(await baselineResult.textContent(), /避免水印/)
  await page.getByRole('button', { name: '生成提示词', exact: true }).click()
  await page.getByLabel('模型原稿', { exact: true }).locator('summary').first().click()
  await page.getByLabel('模型原稿', { exact: true }).getByText('窗边晨光', { exact: true }).waitFor()
  assert.equal(calls.filter(call => call.path === '/prompt-tryout').length, 0)
  assert.equal(calls.filter(call => call.path === '/prompt-preview').at(-1).body.inputs.place, '雨后车站')
  const tryout = page.getByLabel('提示词试写台', { exact: true })
  await tryout.getByLabel('本次改选角色与服装', { exact: true }).check()
  await tryout.getByLabel('指定角色', { exact: true }).selectOption('person-a')
  await tryout.getByLabel('指定服装', { exact: true }).selectOption('outfit-a')
  await tryout.getByLabel('人物朝向', { exact: true }).selectOption('back')
  await tryout.getByLabel('本次状态', { exact: true }).fill('袖口沾着雨水')
  await draftResult.getByText('查看组装过程', { exact: true }).click()
  await draftResult.getByText('袖口沾着雨水', { exact: false }).waitFor()
  assert.equal(calls.filter(call => call.path === '/prompt-preview').at(-1).body.subjects[0].characterId, 'person-a')
  await tryout.getByLabel('本次改选角色与服装', { exact: true }).uncheck()
  await openPromptModule('画风')
  await styleModule.fill('未保存的金色背光')
  await draftResult.getByText('未保存的金色背光', { exact: false }).waitFor()
  assert.equal(state.config.promptPresets.find(item => item.name === '场景模板').structure.blocks.find(block => block.kind === 'style').text, '柔和的水彩质感')
  await styleModule.fill('柔和的水彩质感')
  await draftResult.getByText('未保存的金色背光', { exact: false }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '试出图' }).click()
  await page.getByRole('img', { name: '试出图结果' }).waitFor()
  assert.equal(calls.filter(call => call.path === '/prompt-tryout').length, 1)
  await page.setViewportSize({ width: 390, height: 760 })
  assert.equal(await draftResult.isVisible(), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'narrow prompt editor does not overflow horizontally')
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.getByLabel('提示词试写台', { exact: true }).screenshot({ path: join(tmpdir(), 'dsh-image-structure-editor.png') })
  await modules.screenshot({ path: join(tmpdir(), 'dsh-image-continuous-editor.png') })
  await page.getByLabel('筛选项目', { exact: true }).selectOption('')
  await page.getByRole('button', { name: /^模块化模板/ }).click()
  await openPromptModule('生成方式')
  await page.getByLabel('生成规则', { exact: true }).fill('用一个定格镜头交代主体。')
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/config') && response.request().postDataJSON()?.config?.promptDefault?.structure?.blocks?.some(block => block.kind === 'output')),
    page.getByRole('button', { name: '保存工作台', exact: true }).click(),
  ])
  assert.equal(state.config.promptDefault.structure.blocks[0].text, '用一个定格镜头交代主体。')
  await page.getByLabel('绑定目标', { exact: true }).selectOption('workflow:workflow-a')
  await page.getByRole('button', { name: '添加绑定', exact: true }).click()
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/config') && response.request().postDataJSON()?.config?.promptDefault?.structure?.targets?.some(target => target.id === 'workflow-a')),
    page.getByRole('button', { name: '保存工作台', exact: true }).click(),
  ])
  assert.deepEqual(state.config.promptDefault.structure.targets, [{ kind: 'workflow', id: 'workflow-a' }])

  // Share the editable default, then exercise custom module and template copies through files.
  const downloadJson = async button => {
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
    return JSON.parse(await readFile(await download.path(), 'utf8'))
  }
  const saveTemplates = () => Promise.all([
    page.waitForResponse(response => response.url().endsWith('/config') && Array.isArray(response.request().postDataJSON()?.config?.promptPresets)),
    page.getByRole('button', { name: '保存工作台', exact: true }).click(),
  ])
  await ensureDisclosure('管理模板')
  await ensureDisclosure('导入与导出')
  const sharedDefault = await downloadJson(page.getByRole('button', { name: '导出当前模板', exact: true }))
  assert.equal(sharedDefault[0].name, '模块化模板')
  assert.deepEqual(sharedDefault[0].structure, state.config.promptDefault.structure)
  await page.getByRole('button', { name: '复制模板', exact: true }).click()
  await page.getByLabel('预设名称', { exact: true }).fill('自制模块模板')
  const customTemplateId = await page.getByLabel('正在编辑的模板', { exact: true }).inputValue()
  await page.getByLabel('新增分节类型', { exact: true }).selectOption('extension')
  await page.getByRole('button', { name: '添加分节', exact: true }).click()
  const customRow = page.locator('[data-prompt-block="雨景增强"]')
  await page.getByLabel('分节名称', { exact: true }).last().fill('雨景增强')
  await customRow.getByLabel('加入正面提示词', { exact: true }).fill('{{scene}}，电影雨光')
  await customRow.getByLabel('加入负面提示词', { exact: true }).fill('雨滴模糊')
  await customRow.getByLabel('提示词生成要求', { exact: true }).fill('保留人物眼神')
  await customRow.getByLabel('触发关键词（留空始终使用）', { exact: true }).fill('雨')
  await customRow.getByText('高级参数', { exact: true }).click()
  await customRow.getByLabel('生成参数（JSON，可选）', { exact: true }).fill('{"steps":24,"cfg":5}')
  await customRow.getByLabel('节点参数（JSON，可选）', { exact: true }).fill('[{"node":"22","input":"caption","value":"雨景"}]')
  await saveTemplates()
  const savedCustomBlock = clone(state.config.promptPresets.find(item => item.id === customTemplateId).structure.blocks.at(-1))
  assert.equal(savedCustomBlock.moduleId, 'core.custom')
  await customRow.getByRole('button', { name: '复制模块', exact: true }).click()
  const copiedRow = page.locator('[data-prompt-block="雨景增强 副本"]')
  await copiedRow.getByLabel('加入正面提示词', { exact: true }).fill('副本独有雨光')
  await openPromptModule('雨景增强')
  assert.equal(await customRow.getByLabel('加入正面提示词', { exact: true }).inputValue(), '{{scene}}，电影雨光')
  const sharedModule = await downloadJson(customRow.getByRole('button', { name: '导出模块', exact: true }))
  assert.deepEqual(sharedModule.block, savedCustomBlock)
  await page.getByLabel('导入模块文件', { exact: true }).setInputFiles({ name: 'rain-module.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sharedModule)) })
  const importedRow = page.locator('[data-prompt-block="雨景增强 2"]')
  assert.equal(await importedRow.getByLabel('加入正面提示词', { exact: true }).inputValue(), '{{scene}}，电影雨光')
  await saveTemplates()
  const sourceTemplate = clone(state.config.promptPresets.find(item => item.id === customTemplateId))
  assert.deepEqual(sourceTemplate.structure.blocks.at(-1).values, savedCustomBlock.values)
  assert.equal(sourceTemplate.structure.blocks.at(-2).values.positive, '副本独有雨光')
  await ensureDisclosure('试写台')
  await page.getByLabel('测试场景', { exact: true }).fill('窗外下雨')
  await page.getByLabel('最终提示词', { exact: true }).getByText('窗外下雨，电影雨光', { exact: false }).waitFor()
  await page.getByRole('button', { name: '复制模板', exact: true }).click()
  await page.getByLabel('预设名称', { exact: true }).fill('自制模块模板副本')
  await openPromptModule('雨景增强')
  await customRow.getByLabel('加入正面提示词', { exact: true }).fill('模板副本独有雨光')
  await saveTemplates()
  assert.deepEqual(state.config.promptPresets.find(item => item.id === customTemplateId), sourceTemplate, 'editing copied templates preserves source fields')
  await ensureDisclosure('导入与导出')
  const sharedTemplate = await downloadJson(page.getByRole('button', { name: '导出当前模板', exact: true }))
  assert.deepEqual(sharedTemplate[0].structure.targets, [{ kind: 'workflow', id: 'workflow-a' }])
  sharedTemplate[0].name = '文件导入模板'
  sharedTemplate[0].structure.targets.push({ kind: 'channel', id: 'missing-on-this-installation' })
  await page.getByLabel('导入模板文件', { exact: true }).setInputFiles({ name: 'rain-template.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sharedTemplate)) })
  await page.waitForFunction(() => document.querySelector('[aria-label="预设名称"]')?.value === '文件导入模板')
  const importedTemplateId = await page.getByLabel('正在编辑的模板', { exact: true }).inputValue()
  await saveTemplates()
  const importedTemplate = state.config.promptPresets.find(item => item.id === importedTemplateId)
  assert.equal(importedTemplate.name, '文件导入模板')
  assert.deepEqual(importedTemplate.structure.targets, [{ kind: 'workflow', id: 'workflow-a' }])
  assert.deepEqual(importedTemplate.structure.blocks, sharedTemplate[0].structure.blocks)
  // Deletion is an explicit in-panel action: native dialogs may be disabled in the desktop host.
  await page.getByRole('button', { name: '保存并设为默认', exact: true }).click()
  await page.waitForFunction(id => window.document.querySelector('[aria-label="正在编辑的模板"]')?.value === id, importedTemplateId)
  assert.equal(state.config.activePromptPreset, importedTemplateId)
  const savedBeforeDelete = clone(state.config.promptPresets)
  const defaultBeforeDelete = clone(state.config.promptDefault)
  await page.getByRole('button', { name: '新建模板', exact: true }).click()
  await ensureDisclosure('管理模板')
  await page.getByLabel('预设名称', { exact: true }).fill('未完成的其他草稿')
  const unfinishedId = await page.getByLabel('正在编辑的模板', { exact: true }).inputValue()
  await page.getByLabel('新增分节类型', { exact: true }).selectOption('lora')
  await page.getByRole('button', { name: '添加分节', exact: true }).click()
  await page.getByLabel('正在编辑的模板', { exact: true }).selectOption(importedTemplateId)
  await page.evaluate(() => { window.__originalConfirm = window.confirm; window.confirm = () => false })
  const configPostCount = () => calls.filter(call => call.path === '/config' && call.method === 'POST').length
  const postsBeforeCancel = configPostCount()
  await page.getByRole('button', { name: '删除模板', exact: true }).click()
  const deletion = page.getByRole('group', { name: '确认删除模板', exact: true })
  await deletion.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(configPostCount(), postsBeforeCancel)
  assert.ok(state.config.promptPresets.some(item => item.id === importedTemplateId))
  await page.getByRole('button', { name: '删除模板', exact: true }).click()
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/config') && response.request().postDataJSON()?.config?.promptPresets?.every(item => item.id !== importedTemplateId)),
    deletion.getByRole('button', { name: '确认删除', exact: true }).click(),
  ])
  await page.getByText('已删除模板「文件导入模板」', { exact: true }).waitFor()
  assert.deepEqual(state.config.promptPresets, savedBeforeDelete.filter(item => item.id !== importedTemplateId))
  assert.equal(state.config.activePromptPreset, '')
  assert.deepEqual(state.config.promptDefault, defaultBeforeDelete)
  assert.equal(await page.getByLabel('正在编辑的模板', { exact: true }).locator('option[value="' + importedTemplateId + '"]').count(), 0)
  await page.getByLabel('正在编辑的模板', { exact: true }).selectOption(unfinishedId)
  assert.equal(await page.getByLabel('预设名称', { exact: true }).inputValue(), '未完成的其他草稿')
  assert.equal(await page.getByLabel('LoRA 文件', { exact: true }).count(), 1)
  const postsBeforeDraftDelete = configPostCount()
  await page.getByRole('button', { name: '删除模板', exact: true }).click()
  await deletion.getByRole('button', { name: '确认删除', exact: true }).click()
  await page.getByText('已删除模板草稿', { exact: true }).waitFor()
  assert.equal(configPostCount(), postsBeforeDraftDelete, 'deleting an unsaved draft never rewrites saved templates')
  await page.evaluate(() => { window.confirm = window.__originalConfirm; delete window.__originalConfirm })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '生图工作台', exact: true }).click()
  assert.equal(await page.getByLabel('正在编辑的模板', { exact: true }).locator('option[value="' + importedTemplateId + '"]').count(), 0, 'deleted templates stay absent when reopening the editor')
  await page.getByLabel('正在编辑的模板', { exact: true }).selectOption('')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('生图使用的模板', { exact: true }).selectOption('')
  await page.waitForFunction(() => document.querySelector('[aria-label="生图使用的模板"]')?.value === '')
  assert.equal(state.config.activePromptPreset, '')
  await page.getByRole('button', { name: '编辑模板', exact: true }).click()
  await page.getByRole('button', { name: '保存工作台', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '删除默认模板', exact: true }).count(), 0)
  assert.equal(await page.getByRole('option', { name: '不套模板', exact: true }).count(), 0)
  assert.equal(await page.getByText('旧版世界书条目', { exact: true }).count(), 0)
  assert.equal(await page.getByLabel('世界书格式', { exact: true }).count(), 0)
  const templatesBeforeModeSwitch = clone(state.config.promptPresets)
  await page.getByLabel('生图系统模式', { exact: true }).selectOption('worldbook')
  await page.getByLabel('世界书格式', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '生图工作台', exact: true }).count(), 0)
  await page.getByLabel('世界书格式', { exact: true }).selectOption('structured')
  await page.getByText('structured条目', { exact: true }).waitFor()
  const legacyEditor = page.getByRole('region', { name: '生图世界书', exact: true })
  await legacyEditor.getByText('structured条目', { exact: true }).click()
  await legacyEditor.getByLabel('世界书条目内容', { exact: true }).fill('用户自己的生图规则')
  await legacyEditor.getByText('适用渠道', { exact: true }).click()
  await legacyEditor.getByLabel('OpenAI 兼容', { exact: true }).check()
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/worldbook-entry')), legacyEditor.getByRole('button', { name: '保存条目', exact: true }).click()])
  assert.equal(worldbooks.structured[0].entries[0].content, '用户自己的生图规则')
  assert.deepEqual(worldbooks.structured[0].entries[0].backends, ['openai'])
  await legacyEditor.getByLabel('世界书条目内容', { exact: true }).fill('structured content')
  await legacyEditor.getByLabel('OpenAI 兼容', { exact: true }).uncheck()
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/worldbook-entry')), legacyEditor.getByRole('button', { name: '保存条目', exact: true }).click()])
  await page.getByLabel('生图系统模式', { exact: true }).selectOption('workbench')
  await page.getByRole('button', { name: '保存工作台', exact: true }).waitFor()
  assert.deepEqual(state.config.promptPresets, templatesBeforeModeSwitch)
  assert.equal(await page.getByRole('button', { name: '世界书', exact: true }).count(), 0)
  await page.getByRole('button', { name: '卡片世界书', exact: true }).waitFor()
  // Card workbench entries save one at a time, so switching buckets first flushes the pending write.
  const fillCardEntry = text => Promise.all([
    page.waitForResponse(response => response.url().includes('/dsh-tavern-gen/api/worldbook-entry') && response.request().method() === 'POST'),
    page.getByLabel('卡片条目内容 shared-entry', { exact: true }).fill(text),
  ])
  await page.getByRole('button', { name: '卡片世界书', exact: true }).click()
  await page.getByText('1. rules title', { exact: true }).waitFor()
  await page.getByRole('button', { name: '编辑', exact: true }).first().click()
  await fillCardEntry('rules draft')
  assert.equal(cardBook.buckets[0].entries[0].content, 'rules draft')
  assert.equal(cardBook.buckets[1].entries[0].content, 'examples original', '保存当前分册不动另一册')
  await page.getByRole('button', { name: '📖 examples（1 条）', exact: true }).click()
  await page.getByText('1. examples title', { exact: true }).waitFor()
  await page.getByRole('button', { name: '编辑', exact: true }).first().click()
  assert.equal(await page.getByLabel('卡片条目内容 shared-entry', { exact: true }).inputValue(), 'examples original', '同名条目 ID 不串册')
  await fillCardEntry('examples draft')
  assert.equal(cardBook.buckets[1].entries[0].content, 'examples draft')
  assert.equal(cardBook.buckets[0].entries[0].content, 'rules draft', '写另一册不动当前册')
  await page.getByRole('button', { name: '📖 rules（1 条）', exact: true }).click()
  await page.getByText('1. rules title', { exact: true }).waitFor()
  await page.getByRole('button', { name: '编辑', exact: true }).first().click()
  assert.equal(await page.getByLabel('卡片条目内容 shared-entry', { exact: true }).inputValue(), 'rules draft')
  failCardWrites = 1
  await fillCardEntry('conflicting draft')
  await page.getByText('保存失败：fixture rejected card write', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('卡片条目内容 shared-entry', { exact: true }).inputValue(), 'conflicting draft')
  assert.equal(cardBook.buckets[0].entries[0].content, 'rules draft', '失败不入库')
  await fillCardEntry('rules retry')
  assert.equal(cardBook.buckets[0].entries[0].content, 'rules retry')
  await page.getByRole('button', { name: '➕ 新条目', exact: true }).click()
  await page.getByLabel('卡片条目内容 added-entry', { exact: true }).waitFor()
  await page.getByLabel('卡片条目标题 added-entry', { exact: true }).fill('新增规则')
  await page.getByLabel('卡片条目内容 added-entry', { exact: true }).fill('新增规则正文')
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/worldbook-entry') && response.request().postDataJSON()?.patch?.mode === 'lookup'),
    page.getByLabel('卡片条目档位 added-entry', { exact: true }).selectOption('lookup'),
  ])
  assert.equal(cardBook.buckets[0].entries[1].title, '新增规则')
  assert.equal(cardBook.buckets[0].entries[1].content, '新增规则正文')
  assert.equal(cardBook.buckets[0].entries[1].mode, 'lookup')
  await page.screenshot({ path: join(tmpdir(), 'dsh-card-worldbook-review.png'), fullPage: true })

  // Two quick edits form one autosave batch. A failed first write must retain both edits.
  failCardWrites = 1
  await page.getByLabel('卡片条目内容 added-entry', { exact: true }).fill('新增规则第二版')
  await page.getByRole('button', { name: '编辑', exact: true }).first().click()
  await page.getByLabel('卡片条目内容 shared-entry', { exact: true }).fill('原规则第二版')
  await page.getByText('保存失败：fixture rejected card write', { exact: true }).waitFor()
  await page.getByRole('button', { name: '📖 examples（1 条）', exact: true }).click()
  await page.getByText('1. examples title', { exact: true }).waitFor()
  assert.equal(cardBook.buckets[0].entries[0].content, '原规则第二版')
  assert.equal(cardBook.buckets[0].entries[1].content, '新增规则第二版')
  await page.getByRole('button', { name: '📖 rules（2 条）', exact: true }).click()
  await page.getByText('2. 新增规则', { exact: true }).waitFor()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '删', exact: true }).nth(1).click()
  await page.getByRole('button', { name: '📖 rules（1 条）', exact: true }).waitFor()
  assert.equal(cardBook.buckets[0].entries.length, 1)
  await page.getByLabel('生图系统模式', { exact: true }).selectOption('workbench')
  await page.getByRole('button', { name: '生图工作台', exact: true }).click()
  await page.getByRole('button', { name: '人物库', exact: true }).click()
  await openDisclosure('从世界书生成角色')
  await page.getByLabel('选择要导入的卡').selectOption('cards/other.json')
  await page.getByRole('button', { name: '读取世界书并生成', exact: true }).click()
  await page.getByRole('button', { name: '确认导入 1 位', exact: true }).click()
  await page.getByLabel('导入预览', { exact: true }).waitFor({ state: 'hidden' })
  assert.deepEqual(calls.filter(call => call.path === '/import-characters').map(call => [call.body.card, call.body.dryRun || call.body.apply[0].name]),
    [['cards/other.json', true], ['cards/other.json', '车站管理员']])
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/dsh-tavern-gen/api/tools-enabled') && response.request().method() === 'POST'), page.getByLabel('启用卡片生图', { exact: true }).click()])
  await page.waitForFunction(() => !document.querySelector('[aria-label="启用卡片生图"]').disabled)
  assert.equal(cardEnabled, false)
  assert.equal(await page.getByRole('button', { name: '卡片世界书', exact: true }).count(), 0)
  assert.equal(await page.getByRole('region', { name: '卡片模式世界书', exact: true }).count(), 0)
  assert.equal(calls.some(call => call.path === '/dsh-tavern-gen/api/worldbook' && call.method === 'GET'), true)
  await page.getByRole('button', { name: '画廊', exact: true }).click()
  await page.getByRole('button', { name: '游玩画廊', exact: true }).click()
  await page.getByRole('button', { name: '查看提示词 剧情配图', exact: true }).click()
  await page.getByLabel('完整正面提示词', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('完整正面提示词', { exact: true }).inputValue(), '完整测试正面提示词：茶室门口的成年旅人')
  assert.ok(calls.some(call => call.path === '/jobs' && call.query.id === 'play-only'))
  await page.getByRole('button', { name: '查看负面词 剧情配图', exact: true }).click()
  await page.getByText('这张图没有记录负面提示词', { exact: true }).waitFor()
  await page.getByRole('button', { name: '图生图 剧情配图', exact: true }).click()
  await page.getByRole('dialog', { name: '图片编辑', exact: true }).waitFor()
  await page.getByRole('button', { name: '返回画廊', exact: true }).click()
  await page.getByLabel('收藏 剧情配图', { exact: true }).click()
  await page.getByLabel('取消收藏 剧情配图', { exact: true }).waitFor()
  await page.getByRole('button', { name: '收藏', exact: true }).click()
  await page.getByRole('img', { name: '剧情配图', exact: true }).waitFor()
  await page.getByLabel('回收 剧情配图', { exact: true }).click()
  await page.getByRole('img', { name: '剧情配图', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await page.getByLabel('恢复 剧情配图', { exact: true }).click()
  await page.getByRole('button', { name: '全部图片', exact: true }).click()
  await page.getByRole('img', { name: '剧情配图', exact: true }).waitFor()

  await page.getByRole('img', { name: '剧情配图', exact: true }).waitFor()
  assert.equal(await page.getByRole('img', { name: '卡片工作台', exact: true }).count(), 0)
  assert.ok(calls.some(call => call.path === '/history' && call.query.source === 'play'))
  await page.getByRole('img', { name: '剧情配图', exact: true }).click()
  const viewer = page.locator('dialog:modal')
  await viewer.waitFor()
  await page.keyboard.press('Escape')
  await viewer.waitFor({ state: 'hidden' })
  // Permanent deletion works even when the host disables native confirmation dialogs.
  await page.evaluate(() => { window.confirm = () => false })
  await page.getByLabel('回收 剧情配图', { exact: true }).click()
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await page.getByLabel('彻底删除 剧情配图', { exact: true }).click()
  const galleryDeletion = page.getByRole('group', { name: '确认彻底删除图片', exact: true })
  await galleryDeletion.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(calls.filter(call => call.path === '/gallery-delete').length, 0)
  await page.getByLabel('恢复 剧情配图', { exact: true }).waitFor()
  failGalleryDelete = true
  await page.getByLabel('彻底删除 剧情配图', { exact: true }).click()
  await galleryDeletion.getByRole('button', { name: '确认彻底删除', exact: true }).click()
  await page.getByText('已彻底删除 0 张图，1 张删除失败：测试文件被占用', { exact: true }).waitFor()
  await page.getByLabel('恢复 剧情配图', { exact: true }).waitFor()
  failGalleryDelete = false
  await page.getByRole('button', { name: '☑ 批量选择', exact: true }).click()
  await page.getByRole('button', { name: '全选', exact: true }).click()
  await page.getByRole('button', { name: '彻底删除（1）', exact: true }).click()
  await galleryDeletion.getByRole('button', { name: '确认彻底删除', exact: true }).click()
  await page.getByText('回收站是空的', { exact: true }).waitFor()
  assert.deepEqual(calls.filter(call => call.path === '/gallery-delete').at(-1).body, { ids: ['play-only'], all: false })
  // Refill only the stubbed gallery to exercise single delete and clearing all.
  for (const clearAll of [false, true]) {
    playDeleted = false
    await page.getByRole('button', { name: '🔄 刷新', exact: true }).click()
    await page.getByRole('img', { name: '剧情配图', exact: true }).waitFor()
    if (await page.getByRole('button', { name: '✖ 退出批量', exact: true }).count()) await page.getByRole('button', { name: '✖ 退出批量', exact: true }).click()
    if (clearAll) await page.getByRole('button', { name: '清空回收站', exact: true }).click()
    else await page.getByLabel('彻底删除 剧情配图', { exact: true }).click()
    await galleryDeletion.getByRole('button', { name: '确认彻底删除', exact: true }).click()
    await page.getByText('回收站是空的', { exact: true }).waitFor()
    assert.equal(calls.filter(call => call.path === '/gallery-delete').at(-1).body.all, clearAll)
  }
  await page.getByRole('button', { name: '🔄 刷新', exact: true }).click()
  await page.getByText('回收站是空的', { exact: true }).waitFor()
  await page.getByRole('button', { name: '卡片画廊', exact: true }).click()
  await page.getByRole('img', { name: '卡片专用图片', exact: true }).waitFor()
  assert.equal(await page.getByRole('img', { name: '剧情配图', exact: true }).count(), 0)
  await page.setViewportSize({ width: 375, height: 700 })
  const firstThumb = page.getByRole('img', { name: '卡片专用图片', exact: true })
  const nextThumb = page.getByRole('img', { name: '下一张卡片图', exact: true })
  const firstBox = await firstThumb.boundingBox()
  const nextBox = await nextThumb.boundingBox()
  assert.equal(firstBox.y, nextBox.y, 'card thumbnails share a row on a narrow screen')
  await firstThumb.click()
  await viewer.getByRole('img', { name: '卡片专用图片' }).waitFor()
  await viewer.getByTitle('放大', { exact: true }).click()
  assert.match(await viewer.getByRole('img').getAttribute('style'), /scale\(1\.25\)/)
  await viewer.getByTitle('重置缩放', { exact: true }).click()
  assert.equal(await viewer.getByTitle('重置缩放', { exact: true }).textContent(), '100%')
  const closeBox = await viewer.getByRole('button', { name: '关闭', exact: true }).boundingBox()
  assert.ok(closeBox.x + closeBox.width <= 375, 'preview controls fit the narrow viewport')
  await page.keyboard.press('ArrowRight')
  await viewer.getByRole('img', { name: '下一张卡片图' }).waitFor()
  await viewer.getByTitle('上一张（←）').click()
  await viewer.getByRole('img', { name: '卡片专用图片' }).waitFor()
  await viewer.getByRole('button', { name: '关闭', exact: true }).click()
  await viewer.waitFor({ state: 'hidden' })
  assert.deepEqual(errors, [])
  console.log('PASS Chromium full settings: collapsible image rules, prompt template bindings, channel and reference settings, and independent card workbench worldbook')
  console.log('SCREENSHOT ' + screenshotPath)
} finally { await browser.close() }

// Keep the CLI image URL regression in the existing image-only browser check.
await import('./bundled-image-card-render-browser-smoke.mjs')
