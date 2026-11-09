import test from 'node:test'
import assert from 'node:assert/strict'
import { createNetworkToolPolicy } from '../tavern-plugin/lib/domain/network-tools.js'

test('联网门禁实时读取会话，插件、原生搜索和网页读取共用开关，后台保留任务限制', async () => {
  const chat = { mode: 'story', webSearchEnabled: true, disabledForegroundTools: [] }
  let fetchEnabled = false, backgroundEnabled = true
  const policy = createNetworkToolPolicy({ readHeader: async id => id === 'play' ? chat : id === 'card' ? { mode: 'card' } : null,
    backgroundContext: id => id === 'background' ? { parentSessionId: 'play', webSearchEnabled: backgroundEnabled } : null,
    capabilityFor: name => name === 'plugin_search' ? 'search' : undefined, settings: () => ({ fetchEnabled }) })
  const tools = ['web_search', 'web_fetch', 'plugin_search', 'local'].map(name => ({ name }))
  const names = async id => (await policy.filter(tools, { id })).map(t => t.name)
  assert.deepEqual(await names('play'), tools.map(t => t.name))
  fetchEnabled = true
  assert.deepEqual(await names('play'), tools.map(t => t.name))
  chat.webSearchEnabled = false
  assert.match(await policy.denial('plugin_search', { id: 'play' }), /本局联网搜索已关闭/)
  assert.deepEqual(await names('play'), ['local'])
  assert.deepEqual(await names('background'), ['local'])
  assert.deepEqual(await names('card'), tools.map(t => t.name))
  chat.webSearchEnabled = true
  chat.disabledForegroundTools = ['plugin_search']
  assert.match(await policy.denial('plugin_search', { id: 'play' }), /前台工具/)
  assert.equal(await policy.denial('plugin_search', { id: 'background' }), undefined)
  backgroundEnabled = false
  assert.deepEqual(await names('background'), ['local'])
  assert.deepEqual(await names('unrelated'), tools.map(t => t.name), '不改变非酒馆会话')
  assert.equal(await policy.denial('plugin_search', { id: 'child', header: { parentSession: 'play' } }), undefined)
  chat.webSearchEnabled = false
  assert.match(await policy.denial('plugin_search', { id: 'child', header: { parentSession: 'play' } }), /本局联网搜索/)
})
