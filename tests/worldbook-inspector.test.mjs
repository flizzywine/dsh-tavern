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
