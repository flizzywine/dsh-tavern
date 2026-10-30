import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatWrites } from '../tavern-plugin/lib/domain/chat-writes.js'

function fixture(persist = async () => saved) {
  const events = []
  const writes = createChatWrites({
    persistence: Object.fromEntries(['write', 'writeHeader', 'update', 'patch'].map(name => [name, persist])),
    isDeleted: id => id === 'deleted',
    candidatesChanged: (chat, metadata) => events.push(['candidates', chat, metadata]),
    syncSummary: async chat => events.push(['summary', chat]),
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

test('存储提交前与提交失败时不通知；CAS 失败或对话消失不触发展示维护', async () => {
  for (const kind of ['write', 'header', 'update', 'patch']) {
    let reject
    const pending = new Promise((_, fail) => { reject = fail })
    const { writes, events } = fixture(() => pending)
    const result = commit(writes, kind, 'ordinary')
    assert.deepEqual(events, [])
    reject(new Error('storage conflict'))
    await assert.rejects(result, /storage conflict/)
    assert.deepEqual(events, [])
  }
  for (const [kind, result] of [['patch', null], ['patch', undefined], ['update', undefined]]) {
    const { writes, events } = fixture(async () => result)
    assert.equal(await commit(writes, kind, 'ordinary'), result)
    assert.equal(events.some(([name]) => ['publish', 'templates', 'compaction'].includes(name)), false)
  }
})

test('只回传部分字段的 patch：后续处理读存档头，调用方仍拿到自己要的字段', async () => {
  const projection = { styleReferences: [] }
  const head = { id: 'chat', sessionId: 'session', _storageRevision: 3, cardPath: 'cards/a.json', timeline: { branchId: 'b' }, messages: [] }
  const events = [], reads = []
  const writes = createChatWrites({
    persistence: { patch: async () => projection, readSlice: async (id, indices, fields) => { reads.push([id, indices, fields]); return { chat: head } } },
    isDeleted: () => false,
    candidatesChanged: chat => events.push(['candidates', chat]),
    syncSummary: async (chat, observation) => events.push(['summary', chat, observation]),
    publish: sessionId => events.push(['publish', sessionId]),
    syncTemplates: chat => events.push(['templates', chat]),
    queueCompaction: sessionId => events.push(['compaction', sessionId]),
    observePatch: async (chat, changes) => events.push(['observe', chat, changes])
  })
  const changes = [{ op: 'set', path: ['styleReferences'], value: [] }]
  assert.equal(await writes.patch('chat', 2, changes, { source: 'style', returnProjection: ['styleReferences'] }), projection)
  assert.equal(reads.length, 1)
  assert.equal(reads[0][0], 'chat')
  assert.ok(['id', 'sessionId', 'cardPath', 'cardName', 'timeline', 'settleStatus'].every(field => reads[0][2].includes(field)))
  assert.deepEqual(events.map(([name]) => name), ['candidates', 'summary', 'publish', 'templates', 'compaction', 'observe'])
  assert.ok(events.filter(([name]) => name !== 'publish' && name !== 'compaction').every(([, chat]) => chat === head))
  assert.deepEqual(events[1][2], { metadataOnly: true })
  assert.equal(events[2][1], 'session')
  assert.equal(events[5][2], changes)
})
