import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorldbookInspectorHandlers } from '../tavern-plugin/lib/rpc/worldbook-inspector.js'
const call = (id, name, args) => ({ type: 'tool/call', seq: 1, data: { callId: id, name, arguments: JSON.stringify(args), turn: 2, step: 1 } })
const result = (id, isError = false) => ({ type: 'tool/result', data: { message: { toolCallId: id, isError, content: [{ type: 'text', text: 'result' }] }, meta: { totalLines: 2, lines: [{ number: 1, text: 'original' }] } } })
test('RPC validates loaded game, scopes reads and paginates without losing aggregate counts', async () => {
  const agent = { session: { id: 'one' } }
  const deps = { agentRegistry: { get: id => id === 'one' ? agent : undefined }, chatForSession: async id => id === 'one' ? { sessionId: id } : null,
    worldbookSkillProvider: { inspect: async ({ scope }) => { assert.equal(scope, agent); return { clusters: [] } }, readResource: async (path, { scope }) => { assert.equal(scope, agent); return path === 'allowed' ? ' exact\n' : undefined } },
    sessionDebugEvidence: () => ({ loaded: true, events: Array.from({ length: 45 }, (_, i) => [call(String(i), 'skill', { name: 'wb-a' }), result(String(i))]).flat() }) }
  const rpc = createWorldbookInspectorHandlers(deps)
  const page = await rpc.inspectWorldbookSkills({ sessionId: 'one', offset: 40 })
  assert.equal(page.records.length, 5); assert.equal(page.counts.skills, 45)
  await assert.rejects(rpc.inspectWorldbookSkills({ sessionId: 'other' }), /对局/)
  await assert.rejects(rpc.readWorldbookSkillSource({ sessionId: 'one', path: 'other-game' }), /不属于本局/)
  assert.equal((await rpc.readWorldbookSkillSource({ sessionId: 'one', path: 'allowed' })).content, ' exact\n')
})

test('关键词直读在排查面板按命中的条目记数', async () => {
  const agent = { session: { id: 'one' } }
  const finish = (id, data) => {
    const event = result(id)
    event.data.message.content[0].text = JSON.stringify(data)
    return event
  }
  const rpc = createWorldbookInspectorHandlers({
    agentRegistry: { get: () => agent }, chatForSession: async () => ({ sessionId: 'one' }),
    worldbookSkillProvider: { inspect: async () => ({ files: [{ title: '薛姨妈', lookupId: 'entry-id' }] }) },
    sessionDebugEvidence: () => ({ loaded: true, events: [
      call('legacy', 'worldbook_list', {}), result('legacy'),
      call('a', 'read_lorebook', { keyword: '薛姨妈' }), finish('a', { status: 'found', id: 'entry-id', title: '薛姨妈', text: '设定正文' }),
      call('b', 'read_lorebook', { keyword: '薛' }), finish('b', { status: 'multiple', total: 2 }),
    ] }),
  })
  const page = await rpc.inspectWorldbookSkills({ sessionId: 'one' })
  assert.equal(page.counts.entries, 1)
  assert.equal(page.catalog.files[0].readCount, 1)
  assert.equal(page.records[1].title, '薛姨妈')
  assert.equal(page.records[1].result, '设定正文')
  assert.equal(page.records[2].kind, 'list_lorebook')
})
