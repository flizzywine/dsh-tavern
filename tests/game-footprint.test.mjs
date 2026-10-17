import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createGameFootprint } from '../tavern-plugin/lib/domain/game-footprint.js'

const sha = value => createHash('sha256').update(value).digest('hex')
const exists = target => access(target).then(() => true, () => false)

test('单局数据清单找出本局散落各处的数据，清理时不碰其他游戏', async t => {
  const profile = await mkdtemp(path.join(tmpdir(), 'tavern-footprint-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  const data = path.join(profile, 'data'), sessions = path.join(profile, 'sessions')
  const put = async (relative, content = '{}') => { await mkdir(path.dirname(path.join(profile, relative)), { recursive: true }); await writeFile(path.join(profile, relative), content) }
  const chat = { id: 'chat-a', sessionId: 'session-a', backgroundHistoryIds: ['background-old', 'background-foreign'],
    timeline: { participants: { background: { sessionId: 'background-now' } }, checkpoints: [], operations: {} } }
  const mine = [
    'data/model-requests/chat-a/index.json', 'data/worldbook-recalls/chat-a/index.json', 'data/scene-images/' + sha('chat-a') + '/plans.json',
    'data/diagnostics/scene-' + sha('chat-a') + '.json', 'data/diagnostics/mvu-' + sha('session-a') + '.json', 'data/diagnostics/mvu-' + sha('session-a') + '.jsonl',
    'data/diagnostics/api-calls-' + sha('background-now') + '.json', 'data/model-request-sessions/session-a.json',
    'data/template-work/' + sha('session-a') + '.json', 'data/session-prefixes/background-old.json',
    'sessions/--old-cwd--/session-a/session.v3.jsonl.zstd', 'sessions/--new-cwd--/background-now/session.v3.jsonl.zstd',
    'sessions/--new-cwd--/background-image/session.v3.jsonl.zstd'
  ]
  const others = ['sessions/--new-cwd--/background-foreign/session.v3.jsonl.zstd', 'data/diagnostics/mvu-' + sha('background-foreign') + '.json', 'data/model-requests/chat-b/index.json', 'data/diagnostics/mvu-' + sha('session-b') + '.json', 'sessions/--new-cwd--/session-b/session.v3.jsonl.zstd', 'data/chats/chat-a/head.json']
  for (const file of [...mine, ...others]) await put(file)
  await put('data/scene-images/' + sha('chat-a') + '/agent.json', JSON.stringify({ parentSessionId: 'session-a', sessionId: 'background-image' }))

  const footprint = createGameFootprint({ dataRoot: data })
  // An imported save may still name another game's background session: it is not ours.
  const described = await footprint.describe(chat, { ownsSession: async id => id !== 'background-foreign' })
  assert.deepEqual(described.backgroundSessionIds.sort(), ['background-image', 'background-now', 'background-old'])
  assert.deepEqual(described.items.filter(item => item.category === 'subsession').map(item => item.sessionId).sort(), ['background-image', 'background-now', 'session-a'])
  await footprint.removeLeftovers(described)
  for (const file of mine) assert.equal(await exists(path.join(profile, file)), false, file)
  for (const file of others) assert.equal(await exists(path.join(profile, file)), true, '其他游戏与存档本体不受影响：' + file)
  await assert.rejects(footprint.describe({ id: '../x' }), /无效/)

  // Sessions DSH still holds are removed on the next start, and only inside sessions/.
  await put('sessions/--new-cwd--/session-live/session.v3.jsonl.zstd')
  await footprint.deferSessionDeletion([{ path: path.join(sessions, '--new-cwd--', 'session-live') }, { path: path.join(profile, 'data') }])
  assert.equal(await createGameFootprint({ dataRoot: data }).processDeferredDeletions(), 1)
  assert.equal(await exists(path.join(sessions, '--new-cwd--', 'session-live')), false)
  assert.equal(await exists(path.join(profile, 'data', 'chats')), true)
  assert.equal(await createGameFootprint({ dataRoot: data }).processDeferredDeletions(), 0)
})

test('已删除游戏的进行中调用不会把诊断写回', async () => {
  const { createTavernApiDiagnostics } = await import('../tavern-plugin/lib/domain/tavern-api-diagnostics.js')
  const files = new Map()
  const storage = { updateJson: async (path, update) => { files.set(path, update(files.get(path))) }, remove: async path => { files.delete(path) } }
  const diagnostics = createTavernApiDiagnostics(storage)
  diagnostics.recordResourceSave('session-gone', { ok: true })
  await diagnostics.forget('session-gone')
  diagnostics.recordResourceSave('session-gone', { ok: true })
  await new Promise(resolve => setTimeout(resolve, 650))
  assert.equal(files.size, 0)
})

 test('并发删除全部进入延迟队列，处理队列时新入队项目仍保留', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-deletion-queue-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const footprint = createGameFootprint({ dataRoot: path.join(root, 'data') })
  const targets = Array.from({ length: 12 }, (_, i) => path.join(root, 'sessions', 'project', 'session-' + i))
  for (const target of targets) await mkdir(target, { recursive: true })
  await Promise.all(targets.map(target => footprint.deferSessionDeletion([{ path: target }])))
  const later = path.join(root, 'sessions', 'project', 'later')
  await mkdir(later, { recursive: true })
  const [removed] = await Promise.all([footprint.processDeferredDeletions(), footprint.deferSessionDeletion([{ path: later }])])
  assert.equal(removed, targets.length)
  for (const target of targets) assert.equal(await exists(target), false)
  assert.equal(await exists(later), true)
  assert.equal(await createGameFootprint({ dataRoot: path.join(root, 'data') }).processDeferredDeletions(), 1)
  assert.equal(await exists(later), false)
})
