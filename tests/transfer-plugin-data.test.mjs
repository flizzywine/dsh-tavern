import assert from 'node:assert/strict'
import test from 'node:test'

import { createTransferPluginData } from '../tavern-plugin/lib/domain/transfer-plugin-data.js'

const SPEC = 'dsh-tavern.transfer.plugin-data'

const PLUGINS = [
  { folder: 'alpha', name: 'Alpha 插件', enabled: true },
  { folder: 'beta', name: '', enabled: false },
  { folder: 'empty', name: '空插件', enabled: true }
]

/** 内存假 store：read 返回 JSON 往返后的副本，和真实 store 一样每次都是新对象。 */
function fakeStore(initial) {
  const files = new Map(Object.entries(initial).map(([plugin, data]) => [plugin, JSON.stringify(data)]))
  return {
    files,
    async read(plugin) {
      if (!files.has(plugin)) return null
      return JSON.parse(files.get(plugin))
    },
    async save(plugin, data) {
      if (data === null) { files.delete(plugin); return }
      files.set(plugin, JSON.stringify(data))
    }
  }
}

function fixture(data) {
  const store = fakeStore(data)
  const transfer = createTransferPluginData({ pluginDataStore: store, listPlugins: async () => PLUGINS })
  return { store, transfer }
}

function parseContent(item) {
  return JSON.parse(item.content.toString('utf8'))
}

test('collect 递归剥离凭据：嵌套对象、数组里的对象都换占位串并记点路径', async () => {
  const original = {
    apiKey: 'sk-live-1',
    keep: 'ok',
    nested: { token: 'tok-1', model: 'gpt', deeper: { password: 'p-1' } },
    list: [
      { name: 'A', api_key: 'k-2' },
      { name: 'B', deep: { authorization: 'Bearer zz' } },
      { plain: 1 }
    ],
    count: 3
  }
  const { transfer } = fixture({ alpha: original })

  const [item] = await transfer.collect(['alpha'])
  const parsed = parseContent(item)

  assert.equal(item.key, 'alpha')
  assert.equal(item.title, 'Alpha 插件')
  assert.equal(item.fileName, 'alpha.json')
  assert.equal(parsed.spec, SPEC)
  assert.equal(parsed.version, 1)
  assert.equal(parsed.plugin, 'alpha')
  assert.equal(parsed.redacted, true)
  assert.deepEqual(parsed.redactedKeys, [
    'apiKey',
    'nested.token',
    'nested.deeper.password',
    'list[0].api_key',
    'list[1].deep.authorization'
  ])
  assert.deepEqual(parsed.data, {
    apiKey: '[已移除]',
    keep: 'ok',
    nested: { token: '[已移除]', model: 'gpt', deeper: { password: '[已移除]' } },
    list: [
      { name: 'A', api_key: '[已移除]' },
      { name: 'B', deep: { authorization: '[已移除]' } },
      { plain: 1 }
    ],
    count: 3
  })
  assert.deepEqual(original, {
    apiKey: 'sk-live-1',
    keep: 'ok',
    nested: { token: 'tok-1', model: 'gpt', deeper: { password: 'p-1' } },
    list: [
      { name: 'A', api_key: 'k-2' },
      { name: 'B', deep: { authorization: 'Bearer zz' } },
      { plain: 1 }
    ],
    count: 3
  }, '不能改原对象')
})
