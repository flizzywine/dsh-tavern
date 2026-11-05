import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { IMAGE_PROVIDERS } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-providers.js'

// Focused: node bin/test-tavern.mjs tests/bundled-image-atlascloud-ui.test.mjs
// Without the DSH integration preload: node --test tests/bundled-image-atlascloud-ui.test.mjs
const source = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-image-bundled/client.js', import.meta.url), 'utf8')
// No browser, parser package, or host installation is needed. Explicit adjacent
// function boundaries fail loudly if the source is reorganized; VM compilation
// then checks that the extracted bodies remain complete, executable JavaScript.
function between(input, start, next) {
  const from = input.indexOf(start)
  assert.notEqual(from, -1, `source contains boundary ${start.trim()}`)
  assert.equal(input.indexOf(start, from + start.length), -1, `unique boundary ${start.trim()}`)
  const to = input.indexOf(next, from + start.length)
  assert.ok(to > from, `source contains following boundary ${next.trim()}`)
  return input.slice(from, to)
}

// Scope the extraction: WorkflowGraphEditor has another function named save.
const settings = between(source, '\n    function SettingsPanel() {', '\n    function apply(ctx) {')
function binding(name) {
  const matches = [...settings.matchAll(new RegExp(`^      const ${name} = [^\\r\\n]+`, 'gm'))]
  assert.equal(matches.length, 1, `SettingsPanel declares exactly one single-line ${name}`)
  return matches[0][0]
}
const fragments = [
  ...['config', 'imageBackend', 'providers', 'selectedChannel'].map(binding),
  between(settings, '\n      function post(', '\n      function mergePluginUpdateLocalStatus('),
  between(settings, '\n      async function save(', '\n      async function saveDisplayWidth('),
  between(settings, '\n      function ComfyBackendCard(', '\n      function imageDisplayCard('),
  between(settings, '\n      function worldbookTab(', '\n      function galleryTab('),
].join('\n')
const clone = value => JSON.parse(JSON.stringify(value))
const tick = () => new Promise(resolve => setImmediate(resolve))

function walk(node, predicate, found = []) {
  if (Array.isArray(node)) { node.forEach(child => walk(child, predicate, found)); return found }
  if (!node || typeof node !== 'object') return found
  if (predicate(node)) found.push(node)
  node.children?.forEach(child => walk(child, predicate, found))
  return found
}

function text(node) {
  if (Array.isArray(node)) return node.map(text).join('')
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node !== 'object') return String(node)
  return text(node.children || [])
}

function only(tree, predicate, description) {
  const found = walk(tree, predicate)
  assert.equal(found.length, 1, `expected one ${description}, found ${found.length}`)
  return found[0]
}

function preset(provider = 'atlascloud') {
  const matches = IMAGE_PROVIDERS.filter(item => item.id === provider)
  assert.equal(matches.length, 1, `IMAGE_PROVIDERS must register ${provider} exactly once`)
  return matches[0]
}

function channel(provider, overrides = {}) {
  const defaults = preset(provider)
  return {
    id: `${provider}-existing`, name: `${defaults.label} 渠道`, provider,
    baseUrl: defaults.baseUrl, model: defaults.model, authMode: 'bearer',
    username: '', options: {}, ...overrides,
  }
}

/**
 * Execute the real component, its real derived bindings and save/post handlers.
 * Only the parent React state boundary and HTTP transport are simulated. Each
 * render captures a new lexical snapshot, just as SettingsPanel does in React.
 * The mock server keeps secrets privately and exposes only presence flags.
 */
function harness({ providers = IMAGE_PROVIDERS, config = {}, worldbookBooks = [], saveError = null,
  probeResult = { ok: true, status: 'reachable', message: 'test probe', models: ['ui-test/discovered-model'] } } = {}) {
  const BASE = '/plugins/dsh-tavern-image'
  const calls = []
  const server = { imageProviders: clone(providers), worldbookBooks: clone(worldbookBooks),
    config: { imageBackend: 'comfyui', activeImageChannel: '', imageChannels: [], ...clone(config) } }
  function publicState() {
    const next = clone(server)
    for (const item of next.config.imageChannels) {
      item.hasApiKey = Boolean(item.apiKey)
      item.hasPassword = Boolean(item.password)
      delete item.apiKey
      delete item.password
    }
    return next
  }
  const state = {
    data: publicState(), note: '', channelSecretDrafts: {}, channelTestStatuses: {},
    comfySecretDrafts: { token: '', pass: '' }, comfyStatus: null,
    wbBook: 'main', wbEditing: -1, wbOpen: {}, wbImportOpen: false, wbPaste: '', wbNote: '', wbDrafts: {},
    wbFormat: 'tags', wbView: null, wbLoading: false,
  }
  const refs = {
    configSaveQueue: { current: Promise.resolve() }, libraryRevision: { current: 0 },
    channelDraftRevisions: { current: {} }, channelTestsInFlight: { current: {} },
    wbTimer: { current: null }, wbPending: { current: {} },
    wbWriteQueue: { current: Promise.resolve() }, wbDraftRevisions: { current: {} },
    wbTransition: { current: false }, wbReadEpoch: { current: 0 }, wbScope: { current: '' }, wbFlushing: { current: null }, wbActions: { current: new Set() },
  }
  const setters = Object.fromEntries(Object.keys(state).map(key => [
    `set${key[0].toUpperCase()}${key.slice(1)}`,
    update => { state[key] = typeof update === 'function' ? update(state[key]) : update },
  ]))
  const context = vm.createContext({
    BASE, ...refs, ...setters, WorldbookUpgradePanel: () => null,
    h(type, props, ...children) { return { type, props: props || {}, children } },
    S: { card: {}, input: {}, row: {}, tab: () => ({}) }, buttonStyle: {},
    window: { dispatchEvent() {} }, CustomEvent: function (type, init) { return { type, ...init } },
    confirm: () => true,
    receiveState(next) { if (next) state.data = next },
    async jsonFetch(url, init = {}) {
      const pathname = String(url).startsWith(BASE) ? String(url).slice(BASE.length) : String(url)
      const method = init.method || 'GET'
      const body = init.body === undefined ? undefined : JSON.parse(init.body)
      calls.push({ pathname, method, body })
      if (pathname === '/config' && method === 'POST') {
        if (saveError) throw saveError
        const patch = clone(body.config)
        if (patch.imageChannels) {
          patch.imageChannels = patch.imageChannels.map(item => {
            const previous = server.config.imageChannels.find(saved => saved.id === item.id)
            const next = { ...previous, ...item }
            if (next.clearApiKey) delete next.apiKey
            if (next.clearPassword) delete next.password
            delete next.clearApiKey
            delete next.clearPassword
            return next
          })
        }
        server.config = { ...server.config, ...patch }
        return { ok: true, state: publicState() }
      }
      if (pathname === '/image-channel-test' && method === 'POST') return clone(probeResult)
      if (pathname === '/worldbook-entry' && method === 'POST') {
        const book = server.worldbookBooks.find(item => item.key === body.book)
        const entry = book?.entries.find(item => item.index === body.index)
        assert.ok(entry, 'worldbook request addresses an existing fixture entry')
        Object.assign(entry, body.patch)
        return { ok: true }
      }
      if (pathname === '/worldbook?format=tags' && method === 'GET') return { ok: true, worldbookFormat: 'tags', worldbook: { name: '生图世界书', entries: server.worldbookBooks.flatMap(book => book.entries) }, worldbookBooks: clone(server.worldbookBooks) }
      if (pathname === '/state' && method === 'GET') return publicState()
      assert.fail(`unexpected request (generation is forbidden in these UI tests): ${method} ${pathname}`)
    },
    fetch(url) {
      calls.push({ pathname: String(url), method: 'direct-fetch' })
      assert.fail('the component must use the generic plugin transport, not a provider API directly')
    },
  })
  const renderComponent = vm.runInContext(`(function render(snapshot, view) {
    const { ${Object.keys(state).join(', ')} } = snapshot
    ${fragments}
    return view === 'worldbook' ? worldbookTab() : ComfyBackendCard()
  })`, context, { filename: 'bundled-image-atlascloud-ui.client-fragments.js' })
  let tree, view = 'backend'
  function render(nextView = view) { view = nextView; tree = renderComponent(state, view); return tree }
  async function act(action) {
    await action()
    // Selection handlers deliberately do not return save(); worldbook writes
    // also enter their queue after an await. Drain both, without timing sleeps.
    await tick()
    await refs.configSaveQueue.current
    await refs.wbWriteQueue.current
    render()
  }
  function control(type, label) {
    return only(tree, node => node.type === type && node.props['aria-label'] === label, `${type}[aria-label="${label}"]`)
  }
  function button(label) { return only(tree, node => node.type === 'button' && text(node) === label, `button ${label}`) }
  render()
  return {
    calls, state, render, act, control, button,
    get tree() { return tree },
    get savedConfig() { return clone(server.config) },
    click(label) { return act(() => button(label).props.onClick()) },
    change(type, label, value) { return act(() => control(type, label).props.onChange({ target: { value } })) },
    async chooseProvider(id) {
      const select = control('select', '生图提供商')
      only(select, node => node.type === 'option' && node.props.value === id, `selectable provider ${id}`)
      await act(() => select.props.onChange({ target: { value: id } }))
    },
  }
}

function providerOptions(h) {
  return walk(h.control('select', '生图提供商'), node => node.type === 'option')
    .map(node => ({ id: node.props.value, label: text(node) }))
}

function assertSelected(h, id) {
  assert.equal(h.state.data.config.imageBackend, 'custom')
  assert.equal(h.state.data.config.activeImageChannel, id)
  assert.equal(h.savedConfig.imageBackend, 'custom')
  assert.equal(h.savedConfig.activeImageChannel, id)
  assert.equal(h.control('select', '生图提供商').props.value, 'custom')
  assert.equal(h.control('select', '生图渠道').props.value, id)
}

function assertNoSecret(h, secret) {
  assert.equal(JSON.stringify(h.tree).includes(secret), false, 'no saved secret in rendered props or text')
  assert.equal(JSON.stringify(h.state.data).includes(secret), false, '/state exposes presence flags, never secrets')
}

test('AtlasCloud is an explicit custom API protocol and is not a standalone provider', () => {
  assert.equal(IMAGE_PROVIDERS.some(item => item.id === 'atlascloud'), false)
  const custom = preset('custom')
  assert.equal(custom.label, '自定义兼容渠道')
})

for (const [name, providers] of [['server registry', IMAGE_PROVIDERS], ['client fallback', []]]) {
  test(`AtlasCloud protocol is offered through custom online API (${name})`, async () => {
    const h = harness({ providers })
    assert.equal(h.button('本地部署').props['aria-pressed'], true)
    assert.deepEqual(providerOptions(h).map(item => item.id).sort(), ['comfyui', 'sdwebui'])
    await h.click('在线服务')
    assert.equal(h.button('在线服务').props['aria-pressed'], true)
    assert.equal(providerOptions(h).some(item => item.id === 'atlascloud'), false)
    assert.ok(providerOptions(h).some(item => item.id === 'custom'))
    assert.ok(providerOptions(h).every(item => !['comfyui', 'sdwebui'].includes(item.id)))
    await h.chooseProvider('custom')
    assert.equal(h.control('select', 'API 协议').props.value, 'openai')
    await h.change('select', 'API 协议', 'atlascloud')
    assert.equal(h.control('select', '尺寸参数格式').props.value, 'size')
    assert.equal(h.calls.every(call => call.pathname === '/config'), true, 'protocol selection saves configuration only')
  })
}

test('choosing custom creates one channel; AtlasCloud is selected as its API protocol', async () => {
  const other = channel('openai', { id: 'unrelated-channel', model: 'ui-test/keep-model' })
  const h = harness({ config: { imageChannels: [other] } })
  await h.click('在线服务')
  h.calls.length = 0
  await h.chooseProvider('custom')

  assert.deepEqual(h.calls.map(call => call.pathname), ['/config'])
  const patch = h.calls[0].body.config
  const created = patch.imageChannels.find(item => item.provider === 'custom')
  assert.ok(created?.id, 'selection creates a real channel id')
  assert.equal(created.baseUrl, '')
  assert.equal(created.model, '')
  assert.equal(created.authMode, 'bearer')
  assert.equal(created.name, '自定义兼容渠道 渠道')
  assert.equal(created.hasApiKey, false)
  assert.deepEqual(created.options, { apiProtocol: 'openai' })
  assert.deepEqual(patch.imageChannels.find(item => item.id === other.id), { ...other, hasApiKey: false, hasPassword: false }, 'unrelated channels keep their parameters')
  assertSelected(h, created.id)
  assert.equal(h.control('input', 'API 根地址').props.value, '')
  assert.equal(h.control('input', '模型').props.value, '')
  await h.change('select', 'API 协议', 'atlascloud')
  assert.equal(h.control('select', '尺寸参数格式').props.value, 'size')

  await h.chooseProvider('openai')
  await h.chooseProvider('custom')
  assertSelected(h, created.id)
  assert.equal(h.savedConfig.imageChannels.length, 2, 'switching away and back must not add duplicates')
  assert.equal(h.savedConfig.imageChannels.filter(item => item.provider === 'custom').length, 1)
  assert.ok(h.calls.every(call => call.pathname === '/config'))
})

test('an existing atlascloud channel is reused without resetting its custom parameters or saved Key', async () => {
  const oldKey = 'ui-test-server-only-existing-key'
  const existing = channel('custom', { id: 'atlas-personal', name: '我的渠道',
    baseUrl: 'https://atlas-proxy.example.invalid/api/v1', model: 'ui-test/existing-custom-model', apiKey: oldKey,
    options: { apiProtocol: 'atlascloud', size: '1024*1024' } })
  const other = channel('openai')
  const h = harness({ config: { imageBackend: 'openai', activeImageChannel: other.id, imageChannels: [other, existing] } })
  await h.chooseProvider('custom')
  assertSelected(h, existing.id)
  assert.equal(h.savedConfig.imageChannels.length, 2)
  assert.deepEqual(h.savedConfig.imageChannels.find(item => item.id === existing.id), {
    ...existing, hasApiKey: true, hasPassword: false,
  })
  const selected = h.calls[0].body.config.imageChannels.find(item => item.id === existing.id)
  assert.equal(Object.hasOwn(selected, 'apiKey'), false, 'selection must not resend saved secrets')
  assert.equal(h.control('input', '模型').props.value, existing.model)
  assert.equal(h.control('input', '渠道 API Key').props.value, '')
  assert.match(h.control('input', '渠道 API Key').props.placeholder, /已保存/)
  assertNoSecret(h, oldKey)
})

// The identical driver runs an existing provider as a positive harness control.
// Atlas must use these same generic inputs/actions, not an Atlas-only mock UI.
for (const provider of ['openai', 'custom']) {
  test(`${provider}: generic API Key/custom-model editing saves before /image-channel-test, never generates or echoes secrets`, async () => {
    const initialKey = `ui-test-server-only-${provider}`
    const typedKey = `ui-test-new-key-${provider}`
    const customModel = `ui-test/custom-model-${provider}`
    const existing = channel(provider, { apiKey: initialKey, ...(provider === 'custom' ? { options: { apiProtocol: 'atlascloud' } } : {}) })
    const h = harness({ config: { imageBackend: provider, activeImageChannel: existing.id, imageChannels: [existing] } })
    for (const label of ['新增渠道', '复制渠道', '删除渠道', '保存并测试连接']) assert.ok(h.button(label))
    assert.equal(h.control('input', '模型').props.type, 'text', 'custom IDs use the shared model input')
    assert.equal(h.control('input', '渠道 API Key').props.type, 'password')
    assert.equal(h.control('input', '渠道 API Key').props.value, '')
    assertNoSecret(h, initialKey)

    await h.change('input', '渠道 API Key', typedKey)
    await h.change('input', '模型', customModel)
    assert.equal(h.control('input', '渠道 API Key').props.value, typedKey)
    assert.equal(h.control('input', '模型').props.value, customModel)
    assert.equal(h.savedConfig.imageChannels[0].model, existing.model, 'typing only edits local drafts')
    assert.deepEqual(h.calls, [], 'typing must not write, probe, or generate')

    await h.click('保存并测试连接')
    assert.deepEqual(h.calls.map(call => [call.method, call.pathname]), [['POST', '/config'], ['POST', '/image-channel-test']])
    const patch = h.calls[0].body.config
    assert.equal(patch.imageBackend, provider)
    assert.equal(patch.activeImageChannel, existing.id)
    assert.equal(patch.imageChannels[0].provider, provider)
    assert.equal(patch.imageChannels[0].model, customModel)
    assert.equal(patch.imageChannels[0].apiKey, typedKey)
    assert.deepEqual(h.calls[1].body, { id: existing.id }, 'probe uses the saved id, not raw credentials or a generation prompt')
    assert.equal(h.savedConfig.imageChannels[0].model, customModel)
    assert.equal(h.savedConfig.imageChannels[0].apiKey, typedKey)
    assert.equal(h.state.data.config.imageChannels[0].hasApiKey, true)
    assert.equal(h.control('input', '渠道 API Key').props.value, '', 'saved input draft is cleared')
    assert.match(h.control('input', '渠道 API Key').props.placeholder, /已保存/)
    assertNoSecret(h, initialKey)
    assertNoSecret(h, typedKey)
    assert.match(text(only(h.tree, node => node.props.role === 'status', 'connection status')), /连接可用/)
    const suggestions = walk(h.tree, node => node.type === 'datalist').flatMap(list =>
      walk(list, node => node.type === 'option').map(node => node.props.value))
    if (preset(provider).model) assert.ok(suggestions.includes(preset(provider).model))
    assert.ok(suggestions.includes('ui-test/discovered-model'))

    h.calls.length = 0
    await h.click('保存并测试连接')
    assert.deepEqual(h.calls.map(call => call.pathname), ['/config', '/image-channel-test'])
    assert.equal(Object.hasOwn(h.calls[0].body.config.imageChannels[0], 'apiKey'), false, 'blank saved Key is omitted, not cleared or echoed')
    assert.equal(h.savedConfig.imageChannels[0].apiKey, typedKey, 'saving with an empty draft retains the server-side Key')
    assertNoSecret(h, typedKey)
  })
}

test('custom Atlas protocol preserves drafts and does not probe or generate when the configuration save fails', async () => {
  const existing = channel('custom', { options: { apiProtocol: 'atlascloud' } })
  const h = harness({ saveError: new Error('fixture config save failed'),
    config: { imageBackend: 'custom', activeImageChannel: existing.id, imageChannels: [existing] } })
  await h.change('input', '渠道 API Key', 'ui-test-retry-key')
  await h.change('input', '模型', 'ui-test/retry-model')
  await h.click('保存并测试连接')
  assert.deepEqual(h.calls.map(call => call.pathname), ['/config'])
  assert.equal(h.control('input', '渠道 API Key').props.value, 'ui-test-retry-key')
  assert.equal(h.control('input', '模型').props.value, 'ui-test/retry-model')
  assert.equal(h.button('保存并测试连接').props.disabled, false, 'a failed save permits retry')
  assert.match(h.state.note, /保存失败/)
})

test('custom Atlas protocol dimension modes expose only the appropriate override and persist model-specific options', async () => {
  const existing = channel('custom', { options: { apiProtocol: 'atlascloud' } })
  const h = harness({ config: { imageBackend: 'custom', activeImageChannel: existing.id, imageChannels: [existing] } })
  assert.equal(h.control('select', '尺寸参数格式').props.value, 'size')
  await h.change('input', '尺寸覆盖（可选）', '2048x2048')
  await h.change('select', '尺寸参数格式', 'aspect_ratio')
  assert.equal(walk(h.tree, node => node.props['aria-label'] === '尺寸覆盖（可选）').length, 0)
  await h.change('input', '画面比例覆盖（可选）', '16:9')
  await h.click('保存并测试连接')
  assert.deepEqual(h.savedConfig.imageChannels[0].options, { apiProtocol: 'atlascloud', size: '2048x2048', sizeMode: 'aspect_ratio', aspectRatio: '16:9' })
  await h.change('select', '尺寸参数格式', 'none')
  assert.equal(walk(h.tree, node => ['尺寸覆盖（可选）', '画面比例覆盖（可选）'].includes(node.props['aria-label'])).length, 0)
  await h.click('保存并测试连接')
  assert.equal(h.savedConfig.imageChannels[0].options.sizeMode, 'none')
  assert.ok(h.calls.every(call => ['/config', '/image-channel-test'].includes(call.pathname)))
})

test('worldbook Atlas compatibility checkbox persists applicability for custom channels', async () => {
  const h = harness({ worldbookBooks: [{ key: 'main', name: '生图规则', count: 1,
    entries: [{ index: 0, comment: '渠道规则', content: 'test rule', enabled: true, backends: ['openai'] }] }] })
  h.render('worldbook')
  await h.click('编辑')
  function atlasCheckbox() {
    const label = only(h.tree, node => node.type === 'label' && text(node) === 'Atlas兼容（自定义）', 'worldbook Atlas compatibility label')
    return only(label, node => node.type === 'input' && node.props.type === 'checkbox', 'atlascloud applicability checkbox')
  }
  assert.match(text(h.tree), /适用于协议为 AtlasCloud 且后端支持的自定义渠道；它不是独立渠道/)
  assert.equal(atlasCheckbox().props.checked, false)
  await h.act(() => atlasCheckbox().props.onChange({ target: { checked: true } }))
  assert.deepEqual(h.calls.map(call => [call.method, call.pathname]), [['POST', '/worldbook-entry'], ['GET', '/worldbook?format=tags']])
  assert.deepEqual(h.calls[0].body, { format: 'tags', book: 'main', index: 0, patch: { backends: ['openai', 'atlascloud'] } })
  assert.equal(atlasCheckbox().props.checked, true, 'server refresh keeps the selected provider')

  h.calls.length = 0
  await h.act(() => atlasCheckbox().props.onChange({ target: { checked: false } }))
  assert.deepEqual(h.calls[0].body, { format: 'tags', book: 'main', index: 0, patch: { backends: ['openai'] } })
  assert.deepEqual(h.calls.map(call => call.pathname), ['/worldbook-entry', '/worldbook?format=tags'])
  assert.equal(atlasCheckbox().props.checked, false, 'unchecking removes only atlascloud')
})

for (const provider of ['openai', 'custom']) {
  test(`${provider}: OpenAI Images channel offers 画质 自动/低/中/高 and saves the choice in channel options`, async () => {
    const existing = channel(provider, provider === 'custom' ? { options: { apiProtocol: 'openai' } } : {})
    const h = harness({ config: { imageBackend: provider, activeImageChannel: existing.id, imageChannels: [existing] } })
    const quality = () => h.control('select', '画质')
    assert.equal(quality().props.value, '', 'a channel that never chose a quality shows 自动')
    assert.deepEqual(walk(quality(), node => node.type === 'option').map(node => [node.props.value, text(node)]),
      [['', '自动（默认）'], ['low', '低（最快）'], ['medium', '中'], ['high', '高（最慢）']])
    await h.change('select', '画质', 'low')
    assert.equal(quality().props.value, 'low')
    await h.click('保存并测试连接')
    assert.equal(h.savedConfig.imageChannels[0].options.quality, 'low')
    await h.change('select', '画质', '')
    await h.click('保存并测试连接')
    assert.equal(h.savedConfig.imageChannels[0].options.quality, '', 'back to 自动 saves the empty value the provider treats as unset')
  })
}

test('画质 keeps a previously typed value and is hidden for protocols without a quality parameter', () => {
  const typed = channel('openai', { options: { quality: 'auto' } })
  const kept = harness({ config: { imageBackend: 'openai', activeImageChannel: typed.id, imageChannels: [typed] } })
  assert.equal(kept.control('select', '画质').props.value, 'auto')
  for (const [provider, options] of [['gemini', {}], ['grok', {}], ['seedream', {}], ['qwen', {}], ['novelai', {}], ['custom', { apiProtocol: 'seedream' }], ['custom', { apiProtocol: 'atlascloud' }]]) {
    const existing = channel(provider, { options })
    const h = harness({ config: { imageBackend: provider, activeImageChannel: existing.id, imageChannels: [existing] } })
    assert.equal(walk(h.tree, node => node.props['aria-label'] === '画质').length, 0, `${provider} ${options.apiProtocol || ''}`)
  }
})
