import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const extract = (name, next) => source.slice(source.indexOf('function ' + name + '('), source.indexOf('function ' + next + '('))

test('one repaint entry opens optional feedback; blank repaints and feedback adjusts without replacing old images', async () => {
  const slots = [], calls = []
  let cursor = 0, failure = false, requestId = 0
  const record = { key: 'turn-key', status: 'succeeded', enabled: true, versions: [{ id: 'old-picture' }] }
  const context = vm.createContext({
    React: {
      Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props, children }), useEffect() {},
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { slots[i] = v }] },
      useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial } }
    },
    URLSearchParams, useSceneImageRecord: () => record,
    sceneImagePurchaseConfirmation: () => undefined, sceneImageRequestId: () => 'request-' + (++requestId),
    window: { dispatchEvent() {} }, CustomEvent: class {},
    rpc: async (method, args) => { calls.push({ method, args }); if (failure) throw new Error('connection lost') }
  })
  const Component = vm.runInContext(extract('SceneIllustration', 'TavernAssistantNodeView') + ';SceneIllustration', context)
  const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flat(Infinity).flatMap(nodes)] : []
  const render = () => { cursor = 0; return nodes(Component({ sessionId: 'session', turn: 1 })) }
  const button = label => render().find(n => n.type === 'button' && n.children.includes(label))
  assert.equal(button('调整'), undefined)
  await button('重画').props.onClick()
  assert.equal(calls.length, 0, 'opening the form must not generate')
  assert.equal(button('开始重画').props.disabled, false)
  render().find(n => n.type === 'textarea').props.onChange({ target: { value: '  ' } })
  await button('开始重画').props.onClick()
  assert.equal(calls[0].args.kind, 'repaint')
  assert.equal(calls[0].args.instruction, '')
  assert.equal(calls[0].args.versionId, 'old-picture')
  assert.equal(button('开始重画'), undefined)
  await button('重画').props.onClick()
  render().find(n => n.type === 'textarea').props.onChange({ target: { value: '改成雨夜' } })
  failure = true
  await button('开始重画').props.onClick()
  assert.equal(render().find(n => n.type === 'textarea').props.value, '改成雨夜', 'keep feedback after errors')
  failure = false
  await button('开始重画').props.onClick()
  assert.equal(calls[1].args.kind, 'adjust')
  assert.equal(calls[1].args.instruction, '改成雨夜')
  assert.equal(calls[1].args.requestId, calls[2].args.requestId, 'transport retry keeps its request identity')
  assert.deepEqual(record.versions, [{ id: 'old-picture' }])
  await button('重画').props.onClick()
  await button('取消').props.onClick()
  assert.equal(button('开始重画'), undefined)
  assert.equal(calls.length, 3)
})

test('image action remains visible with an explanation until enabled and configured', async () => {
  const slots = [], calls = []
  let cursor = 0
  const context = vm.createContext({
    React: {
      Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props, children }),
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value }] },
      useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial } }, useEffect() {}
    },
    useSceneImageRecord: () => ({ key: 'turn', status: 'idle', versions: [] }),
    rpc: async (...args) => calls.push(args)
  })
  const Component = vm.runInContext(extract('SceneImageAction', 'SceneImageSettings') + ';SceneImageAction', context)
  const render = () => { cursor = 0; return Component({ sessionId: 'session', turn: 1 }) }
  render()
  for (const [settings, reason] of [
    [null, /加载生图配置/],
    [{ enabled: false, ready: false, migrationPending: true }, /迁移.*保存并启用/],
    [{ enabled: false, ready: true }, /未开启/],
    [{ enabled: true, ready: false }, /配置未完成/]
  ]) {
    slots[0] = settings
    const view = render()
    assert.ok(view, 'the image action must not disappear')
    assert.equal(view.children[0].props.disabled, true)
    assert.match(view.children[1].children.join(''), reason)
    await view.children[0].props.onClick()
  }
  assert.equal(calls.length, 0)
  slots[0] = { enabled: true, ready: true }
  assert.equal(Boolean(render().children[0].props.disabled), false)
})

test('scene request identifiers also work on LAN HTTP without crypto.randomUUID', () => {
  const context = vm.createContext({ window: {} })
  const make = vm.runInContext(extract('sceneImageRequestId', 'sceneImageStageLabel') + ';sceneImageRequestId', context)
  const ids = Array.from({ length: 1000 }, make)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.every(id => /^[a-zA-Z0-9_-]{8,100}$/.test(id)))
})

test('main image action preserves request ID on ambiguous transport errors and cannot regenerate over existing versions', async () => {
  const slots = [], calls = []
  let cursor = 0, fail = true
  const record = { key: 'target-key', status: 'idle', versions: [] }
  const context = vm.createContext({
    React: {
      Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props, children }),
      useState: initial => { const n = cursor++; if (!(n in slots)) slots[n] = initial; return [slots[n], value => { slots[n] = value }] },
      useRef: initial => { const n = cursor++; return slots[n] ||= { current: initial } },
      useEffect: () => {}
    },
    useSceneImageRecord: () => record, sceneImageStageLabel: () => 'working', sceneImagePurchaseConfirmation: () => undefined,
    window: { dispatchEvent() {} }, CustomEvent: class {},
    rpc: async (method, args) => { calls.push({ method, args }); if (fail) throw new Error('connection lost') }
  })
  const Component = vm.runInContext(extract('sceneImageRequestId', 'sceneImageStageLabel') + extract('SceneImageAction', 'SceneImageSettings') + ';SceneImageAction', context)
  function render() { cursor = 0; return Component({ sessionId: 'session', turn: 1, running: false }) }
  render(); slots[0] = { enabled: true, ready: true }
  await render().children[0].props.onClick()
  fail = false
  await render().children[0].props.onClick()
  assert.equal(calls[0].args.requestId, calls[1].args.requestId)
  assert.equal(calls[0].args.key, record.key)
  record.status = 'failed'; record.versions = [{ id: 'old-image' }]
  const button = render().children[0]
  assert.equal(button.props.disabled, true)
  await button.props.onClick()
  assert.equal(calls.length, 2)
  record.versions = []; record.recovery = 'save'
  const pending = render().children[0]
  assert.equal(pending.props.disabled, true)
  assert.ok(pending.children.includes('图片待保存'))
  await pending.props.onClick()
  assert.equal(calls.length, 2, 'must not send generation while bytes await saving')
})

test('received image can be saved from the renderer while generation is disabled', async () => {
  const slots = [], calls = []
  let cursor = 0
  const record = { key: 'frozen-key', requestId: 'original-image', status: 'failed', recovery: 'save', versions: [], enabled: false }
  const context = vm.createContext({
    React: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props, children }), useEffect() {},
      useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = initial; return [slots[n], value => { slots[n] = value }] },
      useRef(initial) { const n = cursor++; return slots[n] ||= { current: initial } }
    },
    useSceneImageRecord: () => record, sceneImageStageLabel: () => 'working', window: { dispatchEvent() {} }, CustomEvent: class {},
    rpc: async (method, args) => { calls.push({ method, args }) }
  })
  const Component = vm.runInContext(extract('SceneIllustration', 'TavernAssistantNodeView') + ';SceneIllustration', context)
  const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flat(Infinity).flatMap(nodes)] : []
  const render = () => { cursor = 0; return nodes(Component({ sessionId: 'session', turn: 1 })) }
  const controls = render()
  assert.equal(controls.filter(node => node.type === 'button').length, 1)
  await controls.find(node => node.type === 'button' && node.children.includes('重试保存')).props.onClick()
  assert.equal(calls[0].method, 'retrySceneImageSave')
  assert.equal(calls[0].args.requestId, record.requestId)
  assert.equal(calls[0].args.key, record.key)
  record.status = 'running'; record.recovery = undefined
  const cancel = render().find(node => node.type === 'button' && node.children.includes('取消生图'))
  assert.ok(cancel, 'cancellation remains available with generation disabled')
  await cancel.props.onClick()
  assert.equal(calls[1].method, 'cancelSceneImage')
  assert.equal(calls[1].args.requestId, record.requestId)
})

test('uncertain purchase requires user confirmation, while original provider task queries do not', () => {
  let accepts = false, prompts = 0
  const context = vm.createContext({ window: { confirm: text => { assert.match(text, /可能已经计费.*再次产生费用/); prompts++; return accepts } } })
  const confirm = vm.runInContext(extract('sceneImagePurchaseConfirmation', 'useSceneImageRecord') + ';sceneImagePurchaseConfirmation', context)
  assert.equal(confirm({ outcome: 'not_requested' }), undefined)
  assert.equal(confirm({ outcome: 'rejected' }), undefined)
  assert.equal(confirm({ outcome: 'unconfirmed', providerTask: { promptId: 'existing' } }), undefined)
  assert.equal(prompts, 0)
  assert.equal(confirm({ outcome: 'unconfirmed', requestId: 'uncertain-original' }), false)
  accepts = true
  assert.equal(confirm({ outcome: 'unconfirmed', requestId: 'uncertain-original' }), 'uncertain-original')
  assert.equal(prompts, 2)
})

test('ComfyUI file chooser stores the parsed graph only on explicit save and has no JSON editor', async () => {
  const slots = [], calls = []
  let cursor = 0
  const context = vm.createContext({
    React: { createElement: (type, props, ...children) => ({ type, props, children }), useEffect() {}, useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = initial; return [slots[n], value => { slots[n] = typeof value === 'function' ? value(slots[n]) : value }] } },
    window: { dispatchEvent() {} }, CustomEvent: class {},
    rpc: async (method, args) => { calls.push({ method, args }); return { settings: slots[0] } }
  })
  const Component = vm.runInContext(extract('SceneImageSettings', 'TavernSettingsSection') + ';SceneImageSettings', context)
  const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flat(Infinity).flatMap(nodes)] : []
  const render = () => { cursor = 0; return nodes(Component()) }
  render()
  slots[0] = { provider: 'comfyui', baseURL: 'http://localhost:8188', authType: 'none', username: '', workflow: null, style: { preset: 'default', custom: '' }, ready: false, channels: [{ id: 'comfyui', label: 'ComfyUI', fields: ['baseURL', 'authType', 'username'] }] }
  await render().find(node => node.props?.role === 'switch').props.onChange({ target: { checked: true } })
  const file = render().find(node => node.type === 'input' && node.props.type === 'file')
  assert.ok(file)
  await file.props.onChange({ target: { files: [{ size: 80, text: async () => '{"1":{"class_type":"SaveImage","inputs":{}}}' }], value: 'file.json' } })
  assert.equal(calls.length, 0)
  assert.equal(slots[0].workflow['1'].class_type, 'SaveImage')
  assert.equal(render().filter(node => node.type === 'textarea').length, 1, 'only the optional style textarea')
  await render().find(node => node.type === 'button' && node.children.includes('保存并启用')).props.onClick()
  assert.equal(calls[0].method, 'saveSceneImageSettings')
  assert.equal(calls[0].args.workflow['1'].class_type, 'SaveImage')
  await file.props.onChange({ target: { files: [{ size: 512001 }], value: '' } })
  assert.match(slots[4], /500 KB/)
  assert.equal(calls.length, 1)
})

test('setup order, read-only draft checks, model selection and stale status clearing', async () => {
  const slots = [], calls = []
  let cursor = 0
  const context = vm.createContext({
    React: { createElement: (type, props, ...children) => ({ type, props, children }), useEffect() {}, useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = initial; return [slots[n], value => { slots[n] = typeof value === 'function' ? value(slots[n]) : value }] } },
    window: { dispatchEvent() {} }, CustomEvent: class {},
    rpc: async (method, args) => { calls.push({ method, args }); return method === 'testSceneImageConnection' ? { status: 'reachable', apiKeyStatus: 'unverified', httpStatus: 404, probePath: '/models', message: '连接成功，但服务暂时无法完成 Key 验证。可展开连接诊断查看状态。' } : { models: ['new-image'], message: '已获取' } }
  })
  const Component = vm.runInContext(extract('SceneImageSettings', 'TavernSettingsSection') + ';SceneImageSettings', context)
  const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flat(Infinity).flatMap(nodes)] : []
  const render = () => { cursor = 0; return nodes(Component()) }
  render()
  slots[0] = { provider: 'openai', baseURL: 'https://example.test/v1', model: 'image-default', size: '1024x1024', style: { preset: 'default', custom: '' }, channels: [{ id: 'openai', fields: ['baseURL', 'model', 'size'], models: ['image-default'], canListModels: true }] }
  await render().find(node => node.props?.role === 'switch').props.onChange({ target: { checked: true } })
  let tree = render()
  const labelIndex = name => tree.findIndex(node => node.type === 'label' && node.children[0] === name)
  const buttonIndex = name => tree.findIndex(node => node.type === 'button' && node.children.includes(name))
  assert.ok(labelIndex('提供商') < labelIndex('API Key'))
  assert.ok(labelIndex('API Key') < buttonIndex('测试连接与鉴权'))
  assert.ok(buttonIndex('测试连接与鉴权') < labelIndex('生图模型'))
  assert.ok(labelIndex('生图模型') < labelIndex('图片尺寸／分辨率'))
  tree.find(node => node.type === 'input' && node.props.type === 'password').props.onChange({ target: { value: 'draft-key' } })
  const button = name => render().find(node => node.type === 'button' && node.children.includes(name))
  await button('测试连接与鉴权').props.onClick()
  assert.equal(calls[0].method, 'testSceneImageConnection')
  assert.equal(calls[0].args.apiKey, 'draft-key')
  assert.equal(slots[2], 'draft-key', 'probe does not discard unsaved credential')
  assert.ok(render().some(node => node.props?.['data-connection-status'] === 'reachable'))
  const diagnostic = render().find(node => node.type === 'details' && node.children.some(child => child?.type === 'summary' && child.children.includes('连接诊断')))
  assert.ok(diagnostic)
  assert.ok(!diagnostic.props?.open, 'HTTP diagnostic is collapsed by default')
  assert.ok(diagnostic.children.some(child => child?.type === 'p' && child.children[0].includes('HTTP 404')))
  assert.ok(!render().find(node => node.props?.role === 'status').children[0].includes('404'))
  await button('获取模型列表').props.onClick()
  tree = render()
  assert.ok(tree.some(node => node.type === 'option' && node.props.value === 'new-image'))
  const modelInput = () => render().find(node => node.type === 'input' && node.props.list === 'dsh-tavern-image-models')
  assert.equal(tree.filter(node => node.type === 'input' && node.props.list).length, 1)
  assert.equal(tree.find(node => node.type === 'datalist').props.id, modelInput().props.list)
  modelInput().props.onChange({ target: { value: 'new-image' } })
  assert.equal(slots[0].model, 'new-image')
  modelInput().props.onChange({ target: { value: 'custom-image-model' } })
  assert.equal(modelInput().props.value, 'custom-image-model')
  assert.equal(render().filter(node => node.type === 'input' && node.props.value === 'custom-image-model').length, 1)
  assert.ok(!render().some(node => node.type === 'label' && node.children[0] === '生图模型名称'))
  render().find(node => node.type === 'input' && node.props.value === 'https://example.test/v1').props.onChange({ target: { value: 'https://another.test/v1' } })
  assert.ok(!render().some(node => node.props?.['data-connection-status']))
  assert.ok(!render().some(node => node.type === 'option' && node.props.value === 'new-image'))
  assert.deepEqual(calls.map(call => call.method), ['testSceneImageConnection', 'listSceneImageModels'])
})

test('reference chooser never preselects a group member, freezes consent and permits per-person revocation while disabled', async () => {
  const slots = [], calls = []
  let cursor = 0
  const record = { key: 'body', status: 'succeeded', enabled: true,
    reference: { supported: true, service: 'Gemini local test', gateway: 'gateway-a', bindings: [] },
    versions: [{ id: 'picture', referencePeople: [{ id: 'left-id', name: '同名', description: '左侧黑发' }, { id: 'right-id', name: '同名', description: '右侧红发' }] }] }
  const context = vm.createContext({
    React: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props, children }), useEffect() {},
      useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = initial; return [slots[n], value => { slots[n] = value }] },
      useRef(initial) { const n = cursor++; return slots[n] ||= { current: initial } }
    },
    URLSearchParams, useSceneImageRecord: () => record, sceneImageStageLabel: () => '', window: { dispatchEvent() {}, confirm() { assert.fail('reference consent must be visible with the person chooser') } }, CustomEvent: class {},
    rpc: async (method, args) => { calls.push({ method, args }); record.reference.bindings = args.enabled ? [{ versionId: 'picture', personId: args.personId, name: '同名' }] : [] }
  })
  const Component = vm.runInContext(extract('SceneIllustration', 'TavernAssistantNodeView') + ';SceneIllustration', context)
  const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flat(Infinity).flatMap(nodes)] : []
  const render = () => { cursor = 0; return nodes(Component({ sessionId: 'session', turn: 1 })) }
  const button = name => render().find(node => node.type === 'button' && node.children.includes(name))
  const more = render().find(node => node.type === 'summary' && node.props?.['aria-label'] === '更多插图操作')
  assert.equal(more, undefined)
  assert.ok(!render().some(node => node.children?.some(text => ['⋯', '下载', '查看说明', '删除'].includes(text))))
  await button('用作造型参考').props.onClick()
  assert.equal(calls.length, 0)
  assert.equal(render().find(node => node.type === 'select').props.value, '')
  assert.equal(button('确认使用').props.disabled, true)
  assert.ok(render().some(node => node.type === 'p' && node.children[0].includes('整张图会发送给：Gemini local test')))
  assert.ok(render().some(node => node.type === 'option' && node.children[0].includes('右侧红发 · right-id')))
  render().find(node => node.type === 'select').props.onChange({ target: { value: 'right-id' } })
  assert.equal(button('确认使用').props.disabled, false)
  await button('确认使用').props.onClick()
  assert.equal(calls[0].method, 'setSceneImageReference')
  assert.equal(calls[0].args.personId, 'right-id')
  assert.equal(calls[0].args.consent, 'gateway-a')
  record.enabled = false; record.reference.supported = false
  await button('管理造型参考').props.onClick()
  assert.equal(button('确认使用'), undefined)
  await button('取消「同名」的参考').props.onClick()
  assert.equal(calls[1].args.personId, 'right-id')
  assert.equal(calls[1].args.enabled, false)
  assert.equal(button('用作造型参考'), undefined)
  record.enabled = true; record.reference.supported = true
  await button('用作造型参考').props.onClick()
  render().find(node => node.type === 'select').props.onChange({ target: { value: 'left-id' } })
  record.reference.gateway = 'gateway-b'; record.reference.service = 'another service'
  assert.equal(button('确认使用').props.disabled, true)
  assert.ok(render().some(node => node.type === 'p' && node.children[0].includes('渠道配置已变化')))
  await button('关闭参考设置').props.onClick()
  assert.equal(calls.length, 2)
  record.versions[0].referencePeople = [{ id: 'single-id', name: '单人' }]
  await button('用作造型参考').props.onClick()
  assert.equal(render().find(node => node.type === 'select').props.value, '', 'one identified candidate does not make a group image single-person')
  await button('关闭参考设置').props.onClick()
  record.versions[0].referenceSingle = true
  await button('用作造型参考').props.onClick()
  assert.equal(render().find(node => node.type === 'select').props.value, 'single-id')
  assert.equal(calls.length, 2, 'even a single person needs explicit confirmation')
  record.key = 'changed-body'
  assert.equal(button('确认使用'), undefined, 'a changed body cannot inherit an open consent draft')
})
