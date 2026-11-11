import test from 'node:test'
import assert from 'node:assert/strict'
import { bodyGenerationWorldbookResults } from '../tavern-plugin/lib/domain/body-generation-worldbook.js'

function fixture() {
  const events = [], session = { snapshotEvents: () => events, surface: { nodes: [] } }
  const append = (type, data, visible = true) => {
    const seq = events.length + 100 // Surface refs are event seqs, not array indices.
    events.push({ seq, type, data })
    if (visible) session.surface.nodes.push(seq)
  }
  function lookup(name, args, text, options = {}) {
    const turn = options.turn ?? 2, id = String(events.length), argumentsText = JSON.stringify(args)
    append('assistant/message', { turn, message: { source: { kind: options.source || 'model' },
      content: [{ type: 'tool-call', id, name, arguments: argumentsText }] } }, options.callVisible !== false)
    append('tool/call', { turn, callId: id, name, arguments: options.arguments ?? argumentsText })
    const block = { toolCallId: id, isError: options.isError === true, content: [{ type: 'text', text }] }
    if (!options.pending) append('tool/result', { turn, error: options.error,
      message: options.legacy ? { role: 'user', content: [{ type: 'tool-result', ...block }] } : { role: 'tool', ...block } }, options.visible !== false)
  }
  return { session, events, append, lookup, read: () => bodyGenerationWorldbookResults(session, 2, path => path.startsWith('/worldbook/')) }
}

test('does not expose other turns, hidden results, errors, arbitrary reads or unmatched calls', () => {
  const f = fixture()
  f.append('turn/start', { turn: 1 }); f.lookup('worldbook_grep', {}, 'private-previous-turn', { turn: 1 })
  f.append('turn/end', { turn: 1 }); f.append('turn/start', { turn: 2 })
  f.lookup('worldbook_grep', {}, 'private-wrong-turn', { turn: 1 })
  for (const options of [{ isError: true }, { error: 'failed' }, { visible: false }, { callVisible: false },
    { pending: true }, { source: 'plugin' }, { arguments: '{"different":true}' }]) f.lookup('worldbook_grep', {}, 'private-excluded', options)
  f.lookup('read', { file_path: '/private/config' }, 'private-file')
  f.lookup('read', {}, 'private-missing-path')
  f.lookup('tavern_read_variables', {}, 'private-state')
  f.lookup('worldbook_grep', {}, '有效查询')
  f.append('tool/result', { turn: 2, message: { role: 'tool', toolCallId: 'unmatched', content: [{ type: 'text', text: 'private-orphan' }] } })
  f.append('turn/end', { turn: 2 }); f.lookup('worldbook_grep', {}, 'private-after-turn')
  assert.deepEqual(f.read(), [{ tool: 'worldbook_grep', text: '有效查询' }])
})
