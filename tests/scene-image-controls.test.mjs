import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const extract = (name, next) => source.slice(source.indexOf('function ' + name + '('), source.indexOf('function ' + next + '('))

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
  const file = render().find(node => node.type === 'input' && node.props.type === 'file')
  assert.ok(file)
  await file.props.onChange({ target: { files: [{ size: 80, text: async () => '{"1":{"class_type":"SaveImage","inputs":{}}}' }], value: 'file.json' } })
  assert.equal(calls.length, 0)
  assert.equal(slots[0].workflow['1'].class_type, 'SaveImage')
  assert.equal(render().filter(node => node.type === 'textarea').length, 1, 'only the optional style textarea')
  await render().find(node => node.type === 'button' && node.children.includes('保存生图设置')).props.onClick()
  assert.equal(calls[0].method, 'saveSceneImageSettings')
  assert.equal(calls[0].args.workflow['1'].class_type, 'SaveImage')
  await file.props.onChange({ target: { files: [{ size: 512001 }], value: '' } })
  assert.match(slots[4], /500 KB/)
  assert.equal(calls.length, 1)
})
