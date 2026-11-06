// Mount the complete bundled client in real React; all plugin HTTP is stubbed.
// node tests/browser/bundled-image-reference-settings-browser-smoke.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { browserReactScript } from '../fixtures/browser-react.mjs'

const executablePath = [process.env.DSH_BROWSER_EXECUTABLE, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(path => path && existsSync(path)) || chromium.executablePath()
const screenshotPath = join(tmpdir(), 'dsh-tavern-pr421-image-settings.png')
const clientSource = await readFile(new URL('../../tavern-plugin/packages/dsh-tavern-image-bundled/client.js', import.meta.url), 'utf8')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jdbsAAAAASUVORK5CYII=', 'base64')
const clone = value => JSON.parse(JSON.stringify(value))
const calls = [], errors = []
let uploads = 0, libraryRevision = 1, cardEnabled = true
let cardBook = { version: 3, revision: 'card-1', buckets: ['rules', 'examples'].map(id => ({ id, label: id, entries: [{ id: 'shared-entry', title: id + ' title', content: id + ' original', enabled: true, mode: 'always' }] })) }
let cardRevision = 1
let failCardWrites = 0
const savedApiKeys = new Map()
const workflowDetail = { file: 'workflow-a.json', prompt: {
  '2': { class_type: 'LoadImage', inputs: { image: 'pose.png' }, _meta: { title: 'Pose input (not a character ref)' } },
  '15': { class_type: 'LoadImage', inputs: { image: 'character.png' }, _meta: { title: 'Character reference input' } },
  '18': { class_type: 'LoadImage', inputs: { image: 'outfit.png' }, _meta: { title: 'Outfit reference input' } },
}, bindings: { positive: [], negative: [], loras: [] } }
const books = format => [{ key: 'main', name: format + '规则', count: 1, entries: [{ index: 0, comment: format + '条目', content: format + ' content', enabled: true, activation: 'always' }] }, { key: 'outfits', name: format + '服装规则', count: 0, entries: [] }]
const worldbooks = Object.fromEntries(['tags', 'natural', 'mixed', 'structured'].map(format => [format, books(format)]))
const state = {
  referenceSupported: true, configurationWarning: '旧版 ComfyUI 简易模式已停用；原配置和数据已保留。', imageProvider: 'openai', config: { imageEnabled: true, imageBackend: 'openai', comfyMode: 'simple', comfySimple: { checkpoint: 'keep-legacy-checkpoint' }, generationMode: 'text', promptMode: 'tags', promptEffectiveFormat: 'tags', activeImageChannel: 'openai-channel',
    designPromptMode: 'auto', characterDesignRequirements: '', outfitDesignRequirements: '',
    imageChannels: [{ id: 'openai-channel', provider: 'openai', name: 'OpenAI 渠道', baseUrl: 'https://openai.mock.invalid/v1', model: 'keep-exact-model', options: {} }], stylePresets: [{ id: 'preset-fold', name: '折叠测试套', artist: 'artist:fold_test', negative: 'lowres', position: 'prefix', enabled: true }], promptPresets: [{ id: 'legacy-entry', name: '旧提示词条目', positive: 'legacy positive', negative: 'legacy negative', enabled: true }] },
  definitions: { revision: String(libraryRevision), characters: [{ id: 'person-a', name: '林月', match: 'Lin Yue', cards: [], traits: { face: 'keep original traits' }, outfits: [{ id: 'outfit-a', name: '白衬衫', upper: 'white shirt', enabled: true }] }], scenes: [], props: [] },
  outfits: [{ id: 'shared-a', name: '通用外套', upper: 'coat', enabled: true }],
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
    else if (path === '/config') {
      if (Array.isArray(body.config.imageChannels)) {
        for (const channel of body.config.imageChannels) {
          if (channel.apiKey) savedApiKeys.set(channel.id, channel.apiKey)
          delete channel.apiKey
          channel.hasApiKey = savedApiKeys.has(channel.id)
        }
      }
      Object.assign(state.config, body.config)
      state.referenceSupported = state.config.imageBackend === 'custom' ? ['openai', 'gemini', 'gemini-chat', 'atlascloud', 'seedream', 'grok', 'qwen', 'sdwebui'].includes(state.config.imageChannels.find(channel => channel.id === state.config.activeImageChannel)?.options?.apiProtocol || 'openai') : ['openai', 'atlascloud', 'comfyui'].includes(state.config.imageBackend)
      state.imageProvider = state.config.imageBackend
      if (body.config.comfyMode === 'workflow') state.configurationWarning = ''
      response = { ok: true, state: publicState() }
    }
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
      response = { ok: true, workflow: clone(workflowDetail) }
    }
    else if (path === '/workflow-values') response = { ok: true, values: { positive: '', negative: '' } }
    else if (path === '/loras-available') response = { ok: true, loras: [] }
    else if (path === '/history') response = { ok: true, jobs: [
      { id: 'play-only', source: 'play', label: '剧情配图', hasImage: true, state: 'done', gameId: 'play-session', createdAt: 2 },
      { id: 'card-only', source: 'card', label: '卡片工作台', hasImage: true, state: 'done', gameId: 'card-session', createdAt: 1 },
    ] }
    else if (path === '/jobs') response = { ok: true, job: {} }
    else if (path === '/tasks') response = { tasks: [] }
    else if (path === '/cards') response = { ok: true, cards: [] }
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
    let Settings, Overlay
    window.__plugin.apply({ slots: { inject(_name, install) { return install() }, register(spec, component) { if (spec.name === 'settings.section') Settings = component; if (spec.id === 'dsh-tavern-image-overlay') Overlay = component; return () => {} } }, inject() {} })
    if (!Settings) throw new Error('SettingsPanel not registered')
    const root = modules['react-dom/client'].createRoot(document.querySelector('#root'))
    const h = modules.react.createElement
    root.render(h(modules.react.Fragment, null, h(Settings), h(Overlay)))
  })
  // 画风预设每套默认收起，正文不进页面；选择栏的按钮负责整体展开与收起
  const presetArtist = page.getByPlaceholder('(@artist_a:1.1), (@artist_b:1.0), masterpiece, best quality')
  assert.equal(await presetArtist.count(), 0, '每套画风预设默认收起，正文不渲染')
  await page.getByRole('button', { name: '▸ 展开全部', exact: true }).click()
  await presetArtist.first().waitFor()
  assert.equal(await presetArtist.count(), 1, '展开后正文出现')
  await page.getByRole('button', { name: '▾ 收起全部', exact: true }).click()
  await presetArtist.first().waitFor({ state: 'detached' })
  assert.equal(await presetArtist.count(), 0, '收起后正文重新消失')
  await page.getByLabel('默认生图模式').selectOption('auto')
  await page.waitForFunction(() => document.querySelector('[aria-label="默认生图模式"]')?.value === 'auto')
  assert.equal(state.config.generationMode, 'auto')
  await page.getByLabel('默认生图模式').selectOption('reference')
  await page.waitForFunction(() => document.querySelector('[aria-label="默认生图模式"]')?.value === 'reference')
  await page.getByLabel('提示词格式', { exact: true }).selectOption('structured')
  await page.waitForFunction(() => document.querySelector('[aria-label="提示词格式"]')?.value === 'structured')
  assert.equal(state.config.generationMode, 'reference')
  assert.equal(state.config.promptMode, 'structured')
  assert.equal(state.config.imageChannels[0].model, 'keep-exact-model')
  assert.ok(calls.filter(call => call.path === '/config').every(call => !Object.hasOwn(call.body.config, 'imageChannels')), 'mode switches never alter model/channel configuration')

  const waitForConfigPatch = expected => page.waitForResponse(response => {
    if (!response.url().endsWith('/config') || response.request().method() !== 'POST') return false
    const patch = response.request().postDataJSON()?.config
    return Object.entries(expected).every(([key, value]) => patch?.[key] === value)
  })
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
  await page.getByRole('button', { name: '人物库', exact: true }).click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  assert.equal(await page.getByLabel('角色与服装生成写法', { exact: true }).inputValue(), 'chinese', 'the saved language mode survives leaving and reopening settings')
  assert.equal(await page.getByLabel('角色生成要求', { exact: true }).inputValue(), chineseCharacterRequirements)
  assert.equal(await page.getByLabel('服装生成要求', { exact: true }).inputValue(), chineseOutfitRequirements)

  const englishCharacterRequirements = 'Use concise English prose; preserve established character traits.'
  const englishOutfitRequirements = 'Use descriptive English tags with explicit colors and garment shapes.'
  await selectDesignMode('tags')
  await page.getByLabel('角色生成要求', { exact: true }).fill(englishCharacterRequirements)
  await page.getByLabel('服装生成要求', { exact: true }).fill(englishOutfitRequirements)
  await saveDesignRequirements(englishCharacterRequirements, englishOutfitRequirements)
  await page.getByRole('button', { name: '人物库', exact: true }).click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  assert.equal(await page.getByLabel('角色与服装生成写法', { exact: true }).inputValue(), 'tags', 'the English Tag mode survives leaving and reopening settings')
  assert.equal(await page.getByLabel('角色生成要求', { exact: true }).inputValue(), englishCharacterRequirements)
  assert.equal(await page.getByLabel('服装生成要求', { exact: true }).inputValue(), englishOutfitRequirements)
  assert.deepEqual(state.config.promptPresets, preservedPromptPresets, 'saving design instructions does not rewrite an existing prompt preset entry')
  assert.deepEqual(state.definitions.characters[0], preservedCharacterEntry, 'saving design instructions does not rewrite existing character/outfit records')
  assert.deepEqual(worldbooks, preservedWorldbooks, 'saving design instructions does not rewrite existing worldbook entries')

  await page.getByRole('button', { name: '人物库', exact: true }).click()
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

  await upload('通用服装「通用外套」上传参考图', 'coat.png')
  await page.getByLabel('通用服装「通用外套」一致性补充', { exact: true }).fill('保持袖口')
  await saveLibrary('保存服装库')
  assert.equal(state.outfits[0].referenceImage.name, 'coat.png')
  assert.equal(state.outfits[0].consistencyText, '保持袖口')
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
  await page.getByRole('button', { name: /编辑 \/ LoRA/ }).click()
  await page.getByLabel('参考图 1 接入节点').count().then(count => assert.equal(count, 0, 'multiple LoadImage nodes are never auto-selected'))
  assert.match(await page.getByText(/尚未保存明确映射/).textContent(), /多个接图节点时不会猜测/)
  await page.getByRole('button', { name: '＋ 添加接入节点' }).click()
  assert.equal(await page.getByLabel('参考图 1 接入节点').inputValue(), '', 'new mappings require an explicit node choice')
  await page.getByLabel('参考图 1 接入节点').selectOption('15')
  await page.getByRole('button', { name: '＋ 添加接入节点' }).click()
  await page.getByLabel('参考图 2 接入节点').selectOption('18')
  assert.deepEqual(workflowDetail.bindings.referenceImages, [{ node: '15', input: 'image' }, { node: '18', input: 'image' }])
  await page.getByRole('button', { name: '启用选定的完整工作流' }).click()
  await page.waitForFunction(() => window.__plugin && document.querySelector('[aria-label="生图提供商"]')?.value === 'comfyui')
  assert.equal(state.config.comfyMode, 'workflow')
  assert.equal(state.config.defaultWorkflow, 'workflow-a')
  assert.deepEqual(state.config.comfySimple, { checkpoint: 'keep-legacy-checkpoint' }, 'migration preserves the old settings as recovery data')
  assert.equal(state.configurationWarning, '')

  await page.getByRole('button', { name: '世界书', exact: true }).click()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByPlaceholder('条目内容（作为画图规则发给模型）').fill('tags pending draft')
  await page.getByLabel('世界书格式', { exact: true }).selectOption('structured')
  await page.getByText('1. structured条目', { exact: true }).waitFor()
  assert.equal(worldbooks.tags[0].entries[0].content, 'tags pending draft')
  assert.equal(worldbooks.structured[0].entries[0].content, 'structured content')
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByPlaceholder('条目内容（作为画图规则发给模型）').fill('中文结构化规则')
  await page.getByLabel('世界书格式', { exact: true }).selectOption('natural')
  await page.getByText('1. natural条目', { exact: true }).waitFor()
  assert.equal(worldbooks.structured[0].entries[0].content, '中文结构化规则')
  assert.equal(worldbooks.natural[0].entries[0].content, 'natural content')
  assert.equal(state.config.promptMode, 'structured', 'browsing worldbooks does not switch the active prompt format')
  // Card workbench entries save one at a time, so switching buckets first flushes the pending write.
  const fillCardEntry = text => Promise.all([
    page.waitForResponse(response => response.url().includes('/dsh-tavern-gen/api/worldbook-entry') && response.request().method() === 'POST'),
    page.getByLabel('卡片条目内容 shared-entry', { exact: true }).fill(text),
  ])
  await page.getByRole('button', { name: '卡片模式世界书', exact: true }).click()
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
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/dsh-tavern-gen/api/tools-enabled') && response.request().method() === 'POST'), page.getByLabel('启用工作台生图', { exact: true }).click()])
  await page.waitForFunction(() => !document.querySelector('[aria-label="启用工作台生图"]').disabled)
  assert.equal(cardEnabled, false)
  assert.equal(calls.some(call => call.path === '/dsh-tavern-gen/api/worldbook' && call.method === 'GET'), true)
  await page.getByRole('button', { name: '画廊', exact: true }).click()
  await page.getByRole('button', { name: '游玩画廊', exact: true }).click()
  await page.getByRole('img', { name: '剧情配图', exact: true }).waitFor()
  assert.equal(await page.getByRole('img', { name: '卡片工作台', exact: true }).count(), 0)
  assert.ok(calls.some(call => call.path === '/history' && call.query.source === 'play'))
  await page.getByRole('img', { name: '剧情配图', exact: true }).click()
  const viewer = page.locator('dialog:modal')
  await viewer.waitFor()
  await page.keyboard.press('Escape')
  await viewer.waitFor({ state: 'hidden' })
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
  console.log('PASS Chromium full settings: custom URL/model/key save and masking, protocol reference capability, character/nested/shared reference drafts and saving, ordered Comfy LoadImage mapping, recoverable simple-mode migration, local-only unlink, worldbook format isolation')
  console.log('SCREENSHOT ' + screenshotPath)
} finally { await browser.close() }

// Keep the CLI image URL regression in the existing image-only browser check.
await import('./bundled-image-card-render-browser-smoke.mjs')
