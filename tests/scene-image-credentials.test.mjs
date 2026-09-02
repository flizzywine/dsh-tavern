import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { createImageGenerationModule } from '../tavern-plugin/packages/dsh-image-gen/src/module.js'
import { createModuleSceneImageSettings } from '../tavern-plugin/lib/domain/scene-image-module-settings.js'

function fixture({ source = 'env', writable = false, provider, failWrite = false } = {}) {
  const keys = new Map([['XAI_API_KEY', 'fixture-existing'], ['DSH_TAVERN_IMAGE_GROK_API_KEY', 'fixture-existing']])
  const keyWrites = [], configWrites = [], network = []
  const documents = new Map([['scene-images/settings.json', { version: 2, provider: 'grok', enabled: true,
    providers: { grok: { baseURL: 'https://api.x.ai/v1', model: 'fixture-model' } } }]])
  const store = {
    readJson: async path => structuredClone(documents.get(path)),
    updateJson: async (path, update) => { const next = await update(structuredClone(documents.get(path))); configWrites.push(path); documents.set(path, next); return next }
  }
  const credentials = () => ({
    resolve: async ref => provider && ref === 'XAI_API_KEY' ? provider.resolve(ref) : keys.has(ref) ? { value: keys.get(ref), source: ref === 'XAI_API_KEY' ? source : 'file' } : undefined,
    describe: async ref => provider && ref === 'XAI_API_KEY' ? provider.describe(ref) : { configured: keys.has(ref), writable, source },
    set: async (ref, value) => {
      keyWrites.push(ref)
      if (provider) return provider.set(ref, value)
      if (!writable || failWrite) throw new Error('private diagnostic: fixture-existing fixture-replacement')
      keys.set(ref, value)
    }
  })
  const imageModule = createImageGenerationModule({ store, credentials,
    fetchImpl: async (...args) => { network.push(args); throw new Error('unexpected network') } })
  return { setup: createModuleSceneImageSettings({ store, credentials, imageModule }), imageModule, keys, keyWrites, configWrites, network, documents }
}

test('same read-only key migrates and repeated saves reuse it without writes or network', async () => {
  const f = fixture()
  const saved = await f.setup.configure({ provider: 'grok', model: 'fixture-model' })
  assert.equal(saved.migrationPending, undefined)
  assert.equal(saved.ready, true)
  await f.setup.configure({ provider: 'grok', apiKey: ' fixture-existing ' })
  assert.equal((await f.setup.capture()).apiKey, 'fixture-existing')
  assert.deepEqual(f.keyWrites, [])
  assert.deepEqual(f.network, [])
  assert.ok(!JSON.stringify([...f.documents]).includes('fixture-existing'))
})

for (const source of ['env', 'custom-read-only']) {
  test(`different ${source} key is rejected before config changes, with safe actionable error`, async () => {
    const f = fixture({ source })
    const before = JSON.stringify([...f.documents])
    await assert.rejects(f.setup.configure({ provider: 'grok', model: 'new-model', apiKey: 'fixture-replacement' }), error => {
      assert.match(error.message, /只读/)
      assert.match(error.message, /不同|冲突/)
      assert.doesNotMatch(error.message, /fixture-existing|fixture-replacement|请重试/)
      return true
    })
    assert.equal(JSON.stringify([...f.documents]), before)
    assert.deepEqual(f.configWrites, [])
    assert.deepEqual(f.keyWrites, [])
    assert.deepEqual(f.network, [])
  })
}

test('writable keys can be replaced; empty input preserves the existing key', async () => {
  const f = fixture({ source: 'file', writable: true })
  await f.setup.configure({ provider: 'grok', apiKey: 'fixture-replacement' })
  await f.setup.configure({ provider: 'grok', apiKey: '' })
  assert.deepEqual(f.keyWrites, ['XAI_API_KEY'])
  assert.equal((await f.setup.capture()).apiKey, 'fixture-replacement')
})

test('storage failure is redacted and restores provider configuration', async () => {
  const f = fixture({ source: 'file', writable: true, failWrite: true })
  const before = await f.imageModule.describe('grok')
  await assert.rejects(f.setup.configure({ provider: 'grok', model: 'new-model', apiKey: 'fixture-replacement' }), error => {
    assert.match(error.message, /密钥保存失败.*回滚/)
    assert.doesNotMatch(error.message, /fixture-existing|fixture-replacement|请重试/)
    return true
  })
  assert.equal((await f.imageModule.describe('grok')).model, before.model)
})

test('installed DSH credential provider: same-key migration succeeds, different key stays read-only', { skip: !process.env.DSH_BOOT_MODULE }, async () => {
  const { LocalCredentialProvider } = await import(new URL('../../dsh-credentials-local/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
  // Run the real resolve/describe/set methods; fake only the inherited secret source.
  // The provider must never reach disk: read-only writes fail before the file queue.
  const provider = Object.create(LocalCredentialProvider.prototype)
  provider.inherited = ref => ref === 'XAI_API_KEY' ? 'fixture-existing' : undefined
  provider.isClosed = () => false
  await assert.rejects(provider.set('XAI_API_KEY', 'fixture-existing'), /read-only/)
  const f = fixture({ provider })
  await f.setup.configure({ provider: 'grok', model: 'fixture-model' })
  assert.equal((await f.setup.capture()).apiKey, 'fixture-existing')
  await assert.rejects(f.setup.configure({ provider: 'grok', apiKey: 'fixture-replacement' }), /只读/)
  assert.deepEqual(f.keyWrites, [])
  assert.deepEqual(f.network, [])
})
