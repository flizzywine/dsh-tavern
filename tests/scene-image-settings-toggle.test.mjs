import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const component = source.slice(source.indexOf('function SceneImageSettings()'), source.indexOf('function TavernSettingsSection()'))
function fixture(initial = {}) {
  const slots = [], calls = []
  let cursor = 0, failure = false
  let saved = { provider: 'openai', activeProvider: 'openai', enabled: false, ready: false, model: 'image', baseURL: 'https://example.test/v1', style: { preset: 'default', custom: '' }, channels: [{ id: 'openai', fields: ['baseURL', 'model'], models: ['image'] }], ...initial }
  const context = vm.createContext({
    React: { createElement: (type, props, ...children) => ({ type, props, children }), useEffect() {}, useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] } },
    window: { dispatchEvent() {} }, CustomEvent: class {},
    rpc: async (method, args) => {
      calls.push({ method, args }); assert.equal(method, 'saveSceneImageSettings')
      if (failure) throw new Error('保存失败')
      saved = { ...saved, ...args, ready: true }
      return { settings: structuredClone(saved) }
    }
  })
  const Component = vm.runInContext(component + ';SceneImageSettings', context)
  const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flat(Infinity).flatMap(nodes)] : []
  const render = () => { cursor = 0; return nodes(Component()) }
  render(); slots[0] = structuredClone(saved)
  return { render, calls, slots, fail: () => { failure = true }, switch: () => render().find(n => n.props?.role === 'switch'),
    toggle: checked => render().find(n => n.props?.role === 'switch').props.onChange({ target: { checked } }),
    save: () => render().find(n => n.type === 'button' && n.children.includes('保存并启用')).props.onClick() }
}

test('disabled configuration starts collapsed; manual opening does not enable or generate before saving', async () => {
  const f = fixture({ enabled: false, migrationPending: true })
  assert.equal(f.switch().props.checked, false)
  assert.equal(f.render().some(n => n.type === 'select'), false)
  assert.equal(f.render().filter(n => n.props?.role === 'switch').length, 1)
  await f.toggle(true)
  assert.equal(f.switch().props.checked, false, 'opening incomplete configuration must not claim generation is enabled')
  assert.ok(f.render().some(n => n.type === 'select'))
  assert.equal(f.calls.length, 0)
  await f.save()
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[0].args.enabled, undefined)
  assert.equal(f.calls[1].args.enabled, true)
  assert.equal(f.switch().props.checked, true)
  assert.ok(f.render().some(n => n.children?.includes('已保存并启用')))
})

test('closing preserves drafts and disables the saved provider; reopening an unchanged saved config enables directly', async () => {
  const f = fixture({ ready: true, enabled: true })
  assert.equal(f.switch().props.checked, true)
  await f.toggle(false)
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)), { enabled: false })
  assert.equal(f.switch().props.checked, false)
  assert.equal(f.render().filter(n => n.type === 'select').length, 0)
  await f.toggle(true)
  assert.equal(f.calls[1].args.enabled, true)
  assert.equal(f.calls[1].args.apiKey, undefined)

  f.slots[0] = { ...f.slots[0], provider: 'preview-only' }; f.slots[1] = true; f.slots[2] = 'unsaved-key'
  await f.toggle(false)
  assert.equal(f.calls.at(-1).args.provider, undefined)
  assert.equal(f.slots[2], 'unsaved-key')
  await f.toggle(true)
  assert.equal(f.calls.length, 3, 'dirty preview only expands, never saves or enables it')
})

test('failed disable stays open and enabled; failed direct enable rolls switch back with visible error', async () => {
  const on = fixture({ ready: true, enabled: true }); on.fail()
  await on.toggle(false)
  assert.equal(on.switch().props.checked, true)
  assert.ok(on.render().some(n => n.props?.role === 'status' && n.children.includes('保存失败')))
  const off = fixture({ ready: true }); off.fail()
  await off.toggle(true)
  assert.equal(off.switch().props.checked, false)
  assert.ok(off.render().some(n => n.props?.role === 'status' && n.children.includes('保存失败')))
})
