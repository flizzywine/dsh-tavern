import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadClient() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} })
}

const client = await loadClient()

test('消息 iframe 使用不透明来源沙箱、封闭 CSP 和受控高度协议', () => {
  const document = client.buildTavernFrameDocument({
    html: '<p>正文</p><style>p{color:red}</style>',
    token: 'height-token'
  })

  assert.match(document, /<p>正文<\/p><style>p\{color:red\}<\/style>/)
  assert.match(document, /default-src 'none'/)
  assert.match(document, /connect-src 'none'/)
  assert.match(document, /frame-src 'none'/)
  assert.match(document, /form-action 'none'/)
  assert.match(document, /ResizeObserver/)
  assert.match(document, /dsh-tavern-frame-height/)
  assert.match(document, /height-token/)
})

test('assistant renderer 以更低 priority 接管 DSH 正式 keyed slot', () => {
  const registrations = []
  const labels = []
  const feature = client.createTavernAssistantRendererFeatureModule()
  const slots = {
    inject(name, activate) {
      assert.equal(name, 'conversation.chat.node')
      return activate()
    },
    register(spec, component) {
      registrations.push({ spec, component })
      return function () {}
    }
  }
  const ctx = {
    effect(activate, label) {
      labels.push(label)
      return activate()
    }
  }

  feature.register({ ctx, slots })

  assert.deepEqual(Object.keys(feature), ['register'])
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].spec.name, 'conversation.chat.node')
  assert.equal(registrations[0].spec.key, 'assistant-step')
  assert.equal(registrations[0].spec.priority, -1)
  assert.equal(typeof registrations[0].component, 'function')
  assert.deepEqual(labels, ['dsh-tavern: inline assistant renderer'])
})
