import test from 'node:test'
import assert from 'node:assert/strict'
import { createGameSaveImportContent } from '../tavern-plugin/lib/domain/game-save-import-content.js'
import { captureStageTarget } from '../tavern-plugin/lib/domain/stage-incremental.js'
import { assetPackDigest } from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-asset-pack-catalogue.js'

// A round directed in the source game: its record bound to the round, chained to the previous record, and the playback
// that quotes its keys, as the stage writes them.
function directed(chat, index, previous) {
  const target = { ...captureStageTarget(chat, index), predecessorDigest: previous?.digest || null }
  const binding = { cardRevision: 'r', target }
  const record = { format: 'asset-packs-v1', binding, baseline: { scene: 'roof' }, entries: [{ at: 1, ops: [] }], end: {} }
  record.digest = assetPackDigest({ binding, baseline: record.baseline, entries: record.entries, end: record.end })
  const bindingKey = assetPackDigest(binding)
  chat.messages[index].stageDirectionAssetPacks = record
  chat.messages[index].stagePlaybackV1 = { version: 2, source: { sourceKey: target.sourceKey, bindingKey }, acceptedPrefix: { sourceKey: target.sourceKey, bindingKey, digest: record.digest } }
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

test('a record the source game no longer read stays unread after import', () => {
  const save = sourceGame()
  save.chat.messages[2].text = '改写过的正文。'
  assert.deepEqual(readable(save.chat), [false, false])
  const imported = createGameSaveImportContent(save, { chatId: 'chat-imported', sessionId: 'session-imported', cardPath: 'cards/a.json', replacedRefs: new Map() }).prepare(save.chat)
  assert.deepEqual(readable(imported), [false, false])
})
