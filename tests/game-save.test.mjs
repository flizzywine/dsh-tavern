import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGameSave, collectSaveRevisions, readGameSave } from '../tavern-plugin/lib/domain/game-save.js'
import { writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'

const bigCard = { raw: { data: { name: '卡', description: 'x'.repeat(200000) } } }
function state(revision, checkpoints = []) {
  return { id: 'chat-a', sessionId: 'session-a', cardPath: 'cards/a.json', cardName: '卡', mode: 'story', _storageRevision: revision,
    cardDefinitionSnapshot: bigCard, messages: [{ role: 'assistant', turn: 1, text: '第' + revision + '版' }],
    timeline: { checkpoints: checkpoints.map(beforeRevision => ({ turn: beforeRevision + 1, beforeRevision })) } }
}

test('导出带上回退链上的全部历史状态，大快照只存一份，读回与原状态一致', async () => {
  const states = new Map([[3, state(3, [1])], [1, state(1)], [7, state(7, [3, 5])], [5, state(5)]])
  const current = state(9, [7])
  const reads = []
  const revisions = await collectSaveRevisions(current, async (id, revision) => { reads.push(revision); return states.get(revision) })
  assert.deepEqual(revisions.map(item => item.revision), [1, 3, 5, 7])
  const session = { header: { id: 'session-a', cwd: '/old/data/resources' }, inheritedEventCount: 0, events: [{ seq: 0, type: 'turn/start', data: { turn: 1 } }] }
  const buffer = buildGameSave({ chat: current, revisions, session, card: { path: current.cardPath, payload: { kind: 'text', name: 'a.json', text: '{}' } },
    scene: { files: [{ path: 'k.json', content: Buffer.from('{"key":"k"}') }], worldbooks: [], attachments: [{ attachmentId: 'sha256:x', mediaType: 'image/png', data: Buffer.from([1, 2]) }] },
    tavernVersion: '2.5.0', exportedAt: 1 })
  assert.ok(buffer.length < 200000 * 2, '五个状态共用一份 200KB 的卡片快照：' + buffer.length)
  const read = readGameSave(buffer, { tavernVersion: '2.5.0' })
  assert.deepEqual(read.chat, current)
  assert.equal(read.world, null)
  assert.deepEqual(read.revisions.map(item => item.state), [1, 3, 5, 7].map(revision => states.get(revision)))
  assert.deepEqual(read.session, session)
  assert.equal(read.card.payload.name, 'a.json')
  assert.deepEqual([...read.scene.attachments[0].data], [1, 2])
  assert.equal(read.manifest.source.turns, 1)
  assert.throws(() => readGameSave(buffer, { tavernVersion: '2.4.9' }), /更新版本的酒馆/)
  assert.throws(() => readGameSave(writeZipEntries([{ path: 'manifest.json', content: '{"format":"other"}' }])), /不是 DSH Tavern 存档包/)
})
