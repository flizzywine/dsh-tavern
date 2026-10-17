import assert from 'node:assert/strict'
import test from 'node:test'
import { shareCordisInspectProviders } from '../tavern-plugin/lib/cordis-inspect.js'

function fixture() {
  const providers = new Map()
  let calls = 0
  const registry = { register(provider) {
    calls++
    const id = provider.manifest.id
    if (providers.has(id)) throw new Error(`Host Cordis inspect provider "${id}" is already registered`)
    providers.set(id, provider)
    return () => providers.delete(id)
  } }
  shareCordisInspectProviders(registry)
  return { registry, providers, calls: () => calls }
}

function provider(owner, id = 'Service') {
  return { manifest: { id, description: 'first party', methods: [{ name: 'listService' }] }, query: () => owner }
}

test('重载宿主适配器不会叠加拦截层或丢失已有挂载', () => {
  const { registry, providers, calls } = fixture()
  const first = registry.register(provider('A'))
  const register = registry.register
  shareCordisInspectProviders(registry)
  assert.equal(registry.register, register)
  const second = registry.register(provider('B'))
  assert.equal(calls(), 1)
  first()
  assert.equal(providers.get('Service').query(), 'B')
  second()
})
