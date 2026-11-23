import test from 'node:test'
import assert from 'node:assert/strict'
import { createGameSaveExporter } from '../tavern-plugin/lib/domain/game-save-export.js'
import { assertGameSaveExportable, createGameSaveSnapshot } from '../tavern-plugin/lib/domain/game-save-snapshot.js'
import { readGameSave } from '../tavern-plugin/lib/domain/game-save.js'
import { computeSceneTarget } from '../tavern-plugin/lib/domain/scene-illustration.js'

function fixture({ images = true, missing = false, pluginFailure = false, mutate = false, worldbook = false, boundWorldbook = worldbook, preset = false, presetPath = 'presets/play.json', world = null } = {}) {
  const chat = { id: 'chat-a', sessionId: 'session-a', cardPath: 'cards/a.json', cardName: '卡', mode: 'script',
    _storageRevision: 2, messages: [{ role: 'assistant', turn: 1, text: '正文' }],
    cardDefinitionSnapshot: { raw: { name: '卡' } }, timeline: { checkpoints: [{ turn: 2, beforeRevision: 1 }] },
    ...(preset ? { runtimePresetPath: presetPath, runtimePresetSnapshot: { presetPath, presetName: '默认', digest: 'digest-1',
      regexScripts: [{ scriptName: '去掉括号', findRegex: '/(\\()/g', replaceString: '（' }], front: [], middle: [], back: [] } } : {}),
    ...(worldbook ? { openingWorldbookSnapshot: { version: 1, libraryDigest: 'wb-digest', source: { kind: 'standalone', path: 'worldbooks/w.json' },
      document: { name: '书', entries: { '0': { uid: 0, key: ['a'], content: '很长的一本世界书'.repeat(50) } }, extensions: {} } } } : {}) }
  const old = { ...chat, _storageRevision: 1, timeline: { checkpoints: [] } }
  const image = id => ({ attachmentId: id, mediaType: 'image/gif' })
  const session = { header: { id: 'session-a' }, inheritedEventCount: 0,
    events: [{ seq: 0, type: 'session/title', data: { title: '旧名称' } }, { seq: 1, type: 'session/title', data: { title: ' 新 / 名称 ' } },
      { seq: 2, type: 'user/message', data: { image: image('message'), repeat: image('message') } }] }
  const reads = [], warnings = []
  const key = computeSceneTarget(chat, 1).key
  const files = [{ path: 'scene.json', content: Buffer.from(JSON.stringify({ image: image('scene'), deletedVersions: [image('deleted')] })) }]
  const exporter = createGameSaveExporter({
    chatForSession: async id => id === chat.sessionId ? chat : undefined,
    gameSaveSnapshot: createGameSaveSnapshot({ readChat: async () => structuredClone(chat), readSession: async () => structuredClone(session),
      readWorldSnapshot: world ? async () => structuredClone(world) : undefined, assertIdle() {} }),
    readChatRevision: async (id, revision) => { assert.equal(id, chat.id); assert.equal(revision, 1); return old },
    fileResources: { originalCardPayload: async () => { throw Error('source removed') }, scriptForCard: async () => 'materials/story.txt', readText: async () => '剧本' },
    gameFootprint: { readSceneFiles: async () => { assert.equal(images, true); return files } },
    sceneWorldbookArchive: { exportForSave: async states => { assert.deepEqual(states.map(s => s._storageRevision), [2, 1]); return [] } },
    getAttachments: () => ({
      readImage: async ref => { reads.push(ref.attachmentId); if (missing) throw Error('missing'); return { data: Buffer.from('GIF89a') } },
      async *readFileStream(ref) { reads.push(ref.attachmentId); yield Buffer.from('audio'); yield Buffer.from('-bytes') }
    }),
    exportPluginData: async () => {
      if (mutate) chat._storageRevision++
      if (pluginFailure) throw Error('plugin unavailable')
      return { data: { version: 1, owners: {} }, media: { version: 1, items: [
        { id: 'current', turn: 1, key, attachment: { attachmentId: 'audio', name: 'voice.mp3' } },
        { id: 'duplicate', turn: 1, key, attachment: { attachmentId: 'audio', name: 'voice.mp3' } },
        { id: 'stale', turn: 1, key: 'other-branch', attachment: image('stale') }
      ] } }
    }, tavernVersion: '3.0.1', hasBoundWorldbook: async () => boundWorldbook, warn: (...args) => warnings.push(args)
  })
  return { exporter, reads, warnings, session }
}

test('同包带走预设时存档不再内嵌预设快照，但保留 runtimePresetPath 供导入重新冻结', async () => {
  const { exporter } = fixture({ preset: true })
  const full = readGameSave(Buffer.from((await exporter('session-a')).base64, 'base64'))
  assert.ok(full.chat.runtimePresetSnapshot?.regexScripts, '单独导出照旧自带快照')

  const slim = readGameSave(Buffer.from((await exporter('session-a', { embedPreset: false })).base64, 'base64'))
  assert.equal(slim.chat.runtimePresetSnapshot, undefined)
  assert.equal(slim.chat.runtimePresetPath, 'presets/play.json', '记住这局用的是哪份预设')
  assert.equal(slim.revisions[0].state.runtimePresetSnapshot, undefined, '回退历史也不存')

  // 没有记下预设路径的局，导入端无从重新冻结，快照就必须留着。
  const noPath = fixture({ preset: true, presetPath: '' })
  const kept = readGameSave(Buffer.from((await noPath.exporter('session-a', { embedPreset: false })).base64, 'base64'))
  assert.ok(kept.chat.runtimePresetSnapshot)
})

test('导出存档只挡正在运行的前台生成或后台结算，不被历史残留状态或未回复输入阻塞', () => {
  const stale = {
    id: 'chat-stale', sessionId: 'session-stale', mode: 'story',
    regenInProgress: true, settleStatus: 'pending',
    mvu: { enabled: true, openingInitialization: { status: 'pending' } },
    timeline: {
      operations: {
        body: { kind: 'body', status: 'completed', background: { phase: 'pending' } },
        agent: { kind: 'agent', status: 'running' }
      }
    },
    messages: [{ role: 'assistant', turn: 1, text: '开场' }, { role: 'user', text: '尚未产生正文的输入' }]
  }
  assert.equal(assertGameSaveExportable(stale), true)
  assert.throws(() => assertGameSaveExportable(null), /找不到要导出的对话/)
  assert.throws(() => assertGameSaveExportable({ ...stale, mode: 'card' }), /只有游玩对话可以导出存档/)
  assert.throws(() => assertGameSaveExportable(stale, { agentRunning: true }), /当前正文仍在生成，请等待完成后再导出/)
  assert.throws(() => assertGameSaveExportable(stale, { settlementRunning: true }), /当前轮次正在状态结算，请等待完成后再导出/)
})
