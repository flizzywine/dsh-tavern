import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const section = source.slice(source.indexOf('  async function stopChatForDeletion'), source.indexOf('  async function exportConversation'))
function setup() {
  const events = []
  const deletedChatIds = new Set()
  const workers = new Map(['a', 'background'].map(id => [id, { cancel: () => events.push('cancel:' + id), whenIdle: async () => events.push('idle:' + id) }]))
  const gameFootprint = {
    describe: async chat => ({ foregroundSessionId: chat.sessionId, items: [{ category: 'log', path: 'log-' + chat.id }, { category: 'subsession', sessionId: 'background', path: 'live' }, { category: 'subsession', sessionId: 'gone', path: 'gone-' + chat.id }] }),
    removeLeftovers: async footprint => { events.push('cleanup:' + footprint.items.map(item => item.path).join(',')); return { failures: [] } },
    deferSessionDeletion: async items => { events.push('defer:' + items.map(item => item.path).join(',')) }
  }
  const backgroundAgentRunner = { releaseFor: async id => { events.push('release:' + id) } }
  const api = new Function('readChat', 'str', 'storyTimeline', 'agentRegistry', 'cancelSettlement', 'conversationRegistry', 'deletedChatIds', 'gameFootprint', 'backgroundAgentRunner', 'deletedSessionIds', 'apiDiagnostics', 'pluginMedia', 'pluginData', 'pluginApi', section + '; return { deleteChats };')(
    async id => ({ id, sessionId: id }), String,
    { inspect: () => ({ participants: { worker: { sessionId: 'background' } } }) }, workers,
    async id => { events.push('settlement:' + id) },
    { remove: async id => { events.push('remove:' + id); if (id === 'bad') throw new Error('disk error') } }, deletedChatIds, gameFootprint, backgroundAgentRunner, new Set(), { forget: async id => { events.push('forget:' + id) } },
    { removeChat: async id => { events.push('media:' + id) } }, { removeChat: async () => {} }, { gameRemoved: id => events.push('removed:' + id) })
  return { ...api, events, deletedChatIds }
}
test('batch deletion stops foreground and background before removing, deduplicates, and continues after a failure', async () => {
  const api = setup()
  const result = await api.deleteChats(['a', 'bad', 'a', 'c'])
  assert.deepEqual(result.results, [{ chatId: 'a', ok: true }, { chatId: 'bad', ok: false, error: 'disk error' }, { chatId: 'c', ok: true }])
  assert.ok(api.events.indexOf('idle:a') < api.events.indexOf('remove:a'))
  assert.ok(api.events.indexOf('idle:background') < api.events.indexOf('remove:a'))
  assert.deepEqual([...api.deletedChatIds], ['a', 'c'])
  // Leftovers go only after the save is removed; a session DSH still holds live stays archived.
  assert.ok(api.events.indexOf('remove:a') < api.events.indexOf('release:a'))
  assert.ok(api.events.includes('cleanup:log-a,gone-a'))
  assert.ok(api.events.includes('defer:live'), '仍被 DSH 持有的会话下次启动时再删')
  assert.ok(api.events.includes('forget:a'), '已删局的调用诊断不再写回')
  assert.ok(api.events.includes('media:a') && api.events.includes('removed:a'), '清理插件媒体并通知插件')
  assert.ok(!api.events.includes('removed:bad'), '删除失败的局不通知')
  assert.ok(!api.events.some(event => event.startsWith('cleanup:log-bad')))
})
