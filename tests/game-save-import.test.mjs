import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildGameSave } from '../tavern-plugin/lib/domain/game-save.js'
import { createGameSaveImporter } from '../tavern-plugin/lib/domain/game-save-import.js'
import { createConversationHandlers } from '../tavern-plugin/lib/rpc/conversations.js'
import { createUploads } from '../tavern-plugin/lib/domain/uploads.js'

function archive(world = null, historyMessages) {
  const state = { id: 'old-chat', sessionId: 'old-session', mode: 'story', cardPath: 'cards/a.json',
    cardDefinitionSnapshot: { name: 'A' }, messages: [{ role: 'assistant', turn: 1, text: '故事' }],
    timeline: { checkpoints: [{ beforeRevision: 7 }], operations: { old: {} } }, regenRecovery: { id: 'old' } }
  return { fileB64: buildGameSave({ chat: state, world, revisions: [{ revision: 7, state: { ...state, messages: historyMessages ?? state.messages, timeline: { branchId: 'branch-1', revision: 7 } } }],
    session: { header: { id: 'old-session' }, events: [{ seq: 0, type: 'turn/end', data: { turn: 1 } }] },
    plugins: { data: {}, media: {}, attachments: [] }, tavernVersion: '3.0.1' }).toString('base64') }
}
async function harness(t, fail = '', options = {}) {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'save-import-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  const calls = [], states = [], metadata = []
  let release
  const op = async name => { calls.push(name); if (name === fail) throw new Error('failed ' + name) }
  const run = createGameSaveImporter({ tavernVersion: '3.0.1', dataRoot,
    newChatId: () => 'new-chat', newSessionId: () => 'new-session',
    prepareGameSaveResources: async () => { await op('resources'); if (release) await release; return { cardPath: 'cards/new.json', rollback: () => op('rollback') } },
    readCard: async () => ({}), getAttachments: () => ({}), profileData: {},
    rawWriteChat: async (state, options) => { await op('write'); states.push(structuredClone(state)); metadata.push(options); return { ...state, _storageRevision: states.length } },
    conversationRegistry: { publish: () => op('publish'), remove: () => op('remove-chat') },
    sceneWorldbookArchive: { forgetChat: () => op('forget-scene') },
    pluginApi: { importGame: () => op('plugins') },
    sessions: { create: async input => { await op('create'); assert.equal(input.sessionId, 'new-session'); return { agent: { session: {} }, dispose: () => op('dispose') } },
      flush: () => op('flush'), attach: () => op('attach'), detach: () => op('detach'), remove: () => op('remove-session') },
    ...options
  })
  return { dataRoot, run, calls, states, metadata, hold(promise) { release = promise } }
}

test('import RPC reads a raw uploaded save and releases the upload', async t => {
  const h = await harness(t)
  const uploads = createUploads({ root: h.dataRoot })
  const { id } = await uploads.receive(Readable.from([Buffer.from(archive().fileB64, 'base64')]))
  const handlers = createConversationHandlers({ importGameSave: h.run, uploads })
  assert.equal((await handlers.importGameSave({ uploadId: id })).sessionId, 'new-session')
  await assert.rejects(uploads.take(id), { code: 'TAVERN_NOT_FOUND' })
})

for (const failure of ['create', 'flush', 'plugins', 'publish']) test('import compensates after ' + failure + ' failure and releases admission', async t => {
  const h = await harness(t, failure)
  await assert.rejects(h.run(archive()), /failed/)
  assert.ok(h.calls.includes('remove-chat'))
  assert.ok(h.calls.includes('rollback'))
  assert.equal(h.calls.includes('remove-session'), failure !== 'create')
  assert.equal(h.calls.includes('dispose'), failure !== 'create')
  if (failure !== 'publish') assert.equal(h.calls.includes('publish'), false)
  await assert.rejects(h.run(archive()), /failed/)
  assert.equal(h.calls.filter(name => name === 'resources').length, 2)
})

test('历史修订缺少可选舞台绑定时，保留正文、发布当前进度并报告跳过的位置', async t => {
  const h = await harness(t)
  const result = await h.run(archive(null, [{ role: 'assistant', text: '旧正文', stageDirectionAssetPacks: {} }]))
  assert.deepEqual(result.warnings, ['历史修订 7，第 1 条消息：已跳过无法绑定的演出记录。'])
  assert.deepEqual(h.states[0].messages, [{ role: 'assistant', text: '旧正文' }])
  assert.equal(h.states[1].messages[0].text, '故事')
  assert.ok(h.calls.includes('publish'))
})

test('same source import cannot overlap; completion allows another import', async t => {
  const h = await harness(t)
  let release
  h.hold(new Promise(resolve => { release = resolve }))
  const first = h.run(archive())
  await assert.rejects(h.run(archive()), /正在导入/)
  release()
  await first
  await h.run(archive())
})

test('导入把可选权威世界只用于当前 head，并拒绝非法来源坐标', async t => {
  const world = { position: null, swipe: 0, messageUid: 'deleted-source', world: { variables: { stat_data: { gold: 44 } } } }
  const h = await harness(t)
  await h.run(archive(world))
  assert.equal(h.metadata[0].worldSelection, undefined, '历史 revision 仍按各自 Chat 恢复')
  assert.deepEqual(h.metadata.at(-1).worldSelection, { selected: world })
  const invalid = await harness(t)
  await assert.rejects(invalid.run(archive({ ...world, position: 99 })), /世界状态不完整/)
})

test('旧存档在导入时一次性采用本机配置，发布后不再由读取方迁移改写', async t => {
  const h = await harness(t, '', { adoptConfiguration: chat => ({ ...chat, backgroundConfigVersion: 1, conversationFeaturesVersion: 1 }) })
  await h.run(archive())
  assert.equal(h.states.length, 2)
  for (const state of h.states) {
    assert.equal(state.backgroundConfigVersion, 1)
    assert.equal(state.conversationFeaturesVersion, 1)
  }
})

test('导入会把旧存档里残留的进行中 settleStatus 归位为 idle', async t => {
  const h = await harness(t)
  const state = {
    id: 'old-chat', sessionId: 'old-session', mode: 'story', cardPath: 'cards/a.json',
    cardDefinitionSnapshot: { name: 'A' }, settleStatus: 'running',
    messages: [{ role: 'assistant', turn: 1, text: '故事' }, { role: 'user', text: '未回复输入' }],
    timeline: { checkpoints: [], operations: { stale: { kind: 'agent', status: 'running' } } }
  }
  const fileB64 = buildGameSave({
    chat: state, world: null, revisions: [],
    session: { header: { id: 'old-session' }, events: [{ seq: 0, type: 'turn/end', data: { turn: 1 } }] },
    plugins: { data: {}, media: {}, attachments: [] }, tavernVersion: '3.0.1'
  }).toString('base64')
  await h.run({ fileB64 })
  assert.equal(h.states[0].settleStatus, 'idle')
  assert.deepEqual(h.states[0].timeline.operations, {})
  assert.equal(h.states[0].messages.at(-1).role, 'user')
})
