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

test('可选世界快照原样往返，脱离来源的变量和身份不依赖 Chat 重扫', () => {
  const chat = { id: 'chat-a', sessionId: 'session-a', mode: 'story', messages: [{ role: 'assistant', text: '保留正文' }] }
  const world = { position: null, swipe: 2, messageUid: 'source-uid', world: { variables: { stat_data: { gold: 44 } }, posture: '保留姿态' } }
  const session = { header: { id: 'session-a' }, events: [] }
  const read = readGameSave(buildGameSave({ chat, world, revisions: [], session, tavernVersion: '3.0.1' }))
  assert.deepEqual(read.world, world)
  assert.deepEqual(read.chat, chat)
})

test('导出时跳过已清理的早期历史版本', async () => {
  const current = { id: 'c', _storageRevision: 9, timeline: { checkpoints: [{ beforeRevision: 3 }, { beforeRevision: 7 }] } }
  const revisions = await collectSaveRevisions(current, async (id, revision) => {
    if (revision === 3) throw Object.assign(new Error('gone'), { code: 'DSH_TAVERN_REVISION_NOT_FOUND' })
    return { id, _storageRevision: revision }
  })
  assert.deepEqual(revisions.map(item => item.revision), [7])
})


test('导出拒绝读回不支持的存档大小，不返回无法导入的备份，并说明各部分大小', async () => {
  const { randomBytes } = await import('node:crypto')
  const limits = { maxArchiveBytes: 2 * 1024 * 1024, maxExpandedBytes: 6 * 1024 * 1024 }
  const input = { chat: { id: 'c', sessionId: 's', messages: [] }, revisions: [], session: { events: [] }, tavernVersion: '2.7.0',
    scene: { files: [], worldbooks: [], attachments: [{ attachmentId: 'a', mediaType: 'image/png', data: randomBytes(3 * 1024 * 1024) }] } }
  assert.throws(() => buildGameSave(input, limits), /存档包有 [0-9]+ MB，超过 2 MB（图片 3\.0 MB，/)
  const block = Buffer.alloc(3 * 1024 * 1024)
  input.scene.attachments = [1, 2, 3].map(id => ({ attachmentId: String(id), data: block }))
  assert.throws(() => buildGameSave(input, limits), /解压后 [0-9]+ MB，超过 6 MB（图片 9\.0 MB，/)
  input.scene.attachments = [{ attachmentId: 'small', data: Buffer.from('small') }]
  assert.equal(readGameSave(buildGameSave(input, limits), { limits }).scene.attachments[0].data.toString(), 'small')
})
