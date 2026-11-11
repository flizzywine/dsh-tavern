import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatWrites } from '../tavern-plugin/lib/domain/chat-writes.js'

function fixture(persist = async () => saved) {
  const events = []
  const writes = createChatWrites({
    persistence: Object.fromEntries(['write', 'writeHeader', 'update', 'patch'].map(name => [name, persist])),
    isDeleted: id => id === 'deleted',
    candidatesChanged: (chat, metadata) => events.push(['candidates', chat, metadata]),
    syncSummary: async (chat, observation) => events.push(['summary', chat, observation]),
    publish: sessionId => events.push(['publish', sessionId]),
    syncTemplates: (chat, metadata) => events.push(['templates', chat, metadata]),
    queueCompaction: sessionId => events.push(['compaction', sessionId])
  })
  return { writes, events }
}
const saved = { id: 'chat', sessionId: 'session', _storageRevision: 2 }
const input = { ...saved, messages: [{ role: 'assistant', text: '正文' }] }
function commit(writes, kind, source) {
  const metadata = { source }
  if (kind === 'write') return writes.write(input, metadata)
  if (kind === 'header') return writes.writeHeader(input, {}, metadata)
  if (kind === 'update') return writes.update('chat', value => value, metadata)
  return writes.patch('chat', 1, [], metadata)
}

test('各类写入保留通知顺序与 mailbox、压缩、Skill 的原有豁免', async () => {
  const policies = {
    ordinary: { write: 'candidates summary publish templates compaction', header: 'candidates summary publish templates compaction', update: 'candidates summary publish templates compaction', patch: 'candidates summary publish templates compaction' },
    'candidate.mailbox.accept': { write: 'candidates publish templates compaction', header: 'candidates summary publish templates compaction', update: 'candidates summary publish templates compaction', patch: 'candidates publish templates compaction' },
    'compaction.commit': { write: 'candidates summary publish templates', header: 'candidates summary publish templates compaction', update: 'candidates summary publish templates', patch: 'candidates summary publish templates compaction' },
    'writing-skill.switch': { write: 'candidates summary publish templates compaction', header: 'candidates summary publish templates compaction', update: 'candidates summary publish', patch: 'candidates summary publish templates compaction' }
  }
  for (const [source, kinds] of Object.entries(policies)) {
    for (const [kind, expected] of Object.entries(kinds)) {
      const { writes, events } = fixture()
      assert.equal(await commit(writes, kind, source), saved)
      assert.equal(events.map(([name]) => name).join(' '), expected, `${kind}: ${source}`)
      const summary = events.find(([name]) => name === 'summary')
      if (summary) assert.equal(summary[1], kind === 'header' ? input : saved)
    }
  }
})
