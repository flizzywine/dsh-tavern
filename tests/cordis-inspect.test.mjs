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

test('多次挂载只注册一次，关闭原工作台后转向仍存活的查询实现', () => {
  const { registry, providers, calls } = fixture()
  const disposeA = registry.register(provider('A'))
  const disposeB = registry.register(provider('B'))
  assert.equal(calls(), 1)
  assert.equal(providers.get('Service').query(), 'A')
  disposeA()
  disposeA()
  assert.equal(providers.get('Service').query(), 'B')
  disposeB()
  assert.equal(providers.size, 0)
  const disposeC = registry.register(provider('C'))
  assert.equal(calls(), 2)
  assert.equal(providers.get('Service').query(), 'C')
  disposeC()
})

test('相同对象的多次注册也分别持有生命周期', () => {
  const { registry, providers } = fixture()
  const same = provider('shared')
  const first = registry.register(same)
  const second = registry.register(same)
  second()
  assert.equal(providers.size, 1)
  first()
  assert.equal(providers.size, 0)
})

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

test('官方同名但契约不同的注册仍报冲突，不替换现有服务', () => {
  const { registry, providers } = fixture()
  registry.register(provider('A'))
  const incompatible = provider('B')
  incompatible.manifest.description = 'another implementation'
  assert.throws(() => registry.register(incompatible), /already registered/)
  assert.equal(providers.get('Service').query(), 'A')
})

test('不放宽自创检查服务或冒用内置名称的冲突检查', () => {
  const { registry } = fixture()
  registry.register(provider('A', 'Custom'))
  assert.throws(() => registry.register(provider('B', 'Custom')), /already registered/)
  const other = provider('other')
  other.manifest.methods[0].name = 'customMethod'
  registry.register(other)
  assert.throws(() => registry.register(provider('official')), /already registered/)
})
