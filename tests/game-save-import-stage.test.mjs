import test from 'node:test'
import assert from 'node:assert/strict'
import { createGameSaveImportContent } from '../tavern-plugin/lib/domain/game-save-import-content.js'
import { captureStageTarget } from '../tavern-plugin/lib/domain/stage-incremental.js'
import { assetPackDigest } from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-asset-pack-catalogue.js'

import { createStageDirector } from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-director.js'
import { createStagePlayback, validateStagePlayback } from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-playback.js'

function playback(binding, digest, prefixRevision) {
  const token = { sourceKey: binding.target.sourceKey, branchId: binding.target.branchId, generation: 0, bindingKey: assetPackDigest(binding), digest, prefixRevision }
  return createStagePlayback({ token })
}

// A round directed in the source game: its record bound to the round, chained to the previous record, and the playback
// that quotes its keys, as the stage writes them.
function directed(chat, index, previous) {
  const target = { ...captureStageTarget(chat, index), predecessorDigest: previous?.digest || null }
  const binding = { cardRevision: 'r', target }
  const record = { format: 'asset-packs-v1', binding, baseline: { scene: 'roof' }, entries: [{ at: 1, ops: [] }], end: {} }
  record.digest = assetPackDigest({ binding, baseline: record.baseline, entries: record.entries, end: record.end })
  chat.messages[index].stageDirectionAssetPacks = record
  chat.messages[index].stagePlaybackV1 = playback(binding, record.digest, 1)
  return record
}

// What the stage reads: the accepted chain (stage-director recordsThrough) and the playback each round quotes.
function readable(chat) {
  let previous = null
  return chat.messages.flatMap((message, index) => {
    const record = message.stageDirectionAssetPacks
    if (!record) return []
    const target = record.binding.target, playback = message.stagePlaybackV1
    const valid = target.sourceKey === captureStageTarget(chat, index).sourceKey && target.predecessorDigest === (previous?.digest || null)
    if (valid) previous = record
    return [valid && playback.source.sourceKey === target.sourceKey && playback.acceptedPrefix.digest === record.digest && playback.source.bindingKey === assetPackDigest(record.binding)]
  })
}

function sourceGame() {
  const chat = { id: 'chat-source', sessionId: 'session-source', cardPath: 'cards/a.json', timeline: { branchId: 'branch-1', revision: 4 }, messages: [
    { role: 'assistant', greeting: true, text: '开场' },
    { role: 'user', turn: 2, text: '来一段' },
    { role: 'assistant', turn: 2, text: '屋顶上，微风吹动发梢。' },
    { role: 'user', turn: 3, text: '继续' },
    { role: 'assistant', turn: 3, text: '傍晚的街道。' },
  ] }
  const first = directed(chat, 2, null)
  directed(chat, 4, first)
  return { chat, revisions: [], session: { header: { id: chat.sessionId }, events: [] } }
}

for (const [label, ids] of [['new ids', { chatId: 'chat-imported', sessionId: 'session-imported' }], ['the source ids', { chatId: 'chat-source', sessionId: 'session-source' }]]) {
  test(`an imported game keeps every directed round readable under ${label}`, () => {
    const save = sourceGame()
    assert.deepEqual(readable(save.chat), [true, true])
    const imported = createGameSaveImportContent(save, { ...ids, cardPath: 'cards/a.json', replacedRefs: new Map() }).prepare(save.chat)
    assert.equal(imported.id, ids.chatId)
    assert.equal(imported.messages[2].stageDirectionAssetPacks.binding.target.chatId, ids.chatId)
    assert.deepEqual(readable(imported), [true, true])
    assert.deepEqual(readable(save.chat), [true, true], 'the source is not changed')
  })
}

function importChat(save) {
  return createGameSaveImportContent(save, { chatId: 'chat-imported', sessionId: 'session-imported', cardPath: save.chat.cardPath, replacedRefs: new Map() }).prepare(save.chat)
}

function stageReader(t) {
  const director = createStageDirector({ assets: { hasBindings: async () => true, subscribe: () => () => {} } })
  t.after(() => director.dispose())
  return (chat, turn) => director.get(chat, turn, null, { readOnly: true, generate: false })
}

test('old keys quoted in prose and snapshot content stay literal; the next round and its playback still authenticate', async t => {
  const save = sourceGame(), first = save.chat.messages[2].stageDirectionAssetPacks
  const literal = '引用旧键：' + first.binding.target.sourceKey
  save.chat.messages[3].text = literal
  directed(save.chat, 4, first)
  const record = save.chat.messages[4].stageDirectionAssetPacks
  record.end.note = literal
  const { binding, baseline, entries, end } = record
  record.digest = assetPackDigest({ binding, baseline, entries, end })
  save.chat.messages[4].stagePlaybackV1 = playback(binding, record.digest, 1)
  const imported = importChat(save), direction = await stageReader(t)(imported, 3)
  assert.equal(imported.messages[3].text, literal)
  assert.equal(direction.status, 'done')
  assert.equal(direction.record.end.note, literal)
  assert.equal(direction.record.digest, assetPackDigest({ binding: direction.binding, baseline, entries, end }))
  const saved = validateStagePlayback(imported.messages[4].stagePlaybackV1, direction)
  assert.equal(saved.acceptedPrefix.digest, direction.token.digest)
})

for (const partial of [false, true]) test(`失败回合保留错误${partial ? '和已封存的分段演出' : '（无分段演出）'}`, async t => {
  const save = sourceGame(), message = save.chat.messages[4], { binding, baseline, entries } = message.stageDirectionAssetPacks
  const sourceKey = binding.target.sourceKey, failure = { status: 'error', error: '中断：' + sourceKey, sourceKey }
  delete message.stageDirectionAssetPacks
  delete message.stagePlaybackV1
  if (partial) {
    const body = { binding, sourceKey, units: [message.text], baseline, entries, generation: 0, prefixRevision: 1, through: 1, complete: false }
    failure.preview = { ...body, prefixDigest: assetPackDigest(body) }
    message.stagePlaybackV1 = playback(binding, failure.preview.prefixDigest, 1)
  }
  message.stageDirectionAssetPacksFailure = failure
  const imported = importChat(save), direction = await stageReader(t)(imported, 3)
  assert.equal(direction.status, 'error')
  assert.equal(direction.error, failure.error)
  if (partial) {
    const { prefixDigest, ...body } = imported.messages[4].stageDirectionAssetPacksFailure.preview
    assert.equal(body.binding.target.predecessorDigest, imported.messages[2].stageDirectionAssetPacks.digest)
    assert.equal(prefixDigest, assetPackDigest(body))
    assert.equal(validateStagePlayback(imported.messages[4].stagePlaybackV1, direction).acceptedPrefix.digest, prefixDigest)
  }
})

test('a record the source game no longer read stays unread after import', () => {
  const save = sourceGame()
  save.chat.messages[2].text = '改写过的正文。'
  assert.deepEqual(readable(save.chat), [false, false])
  const imported = createGameSaveImportContent(save, { chatId: 'chat-imported', sessionId: 'session-imported', cardPath: 'cards/a.json', replacedRefs: new Map() }).prepare(save.chat)
  assert.deepEqual(readable(imported), [false, false])
})
