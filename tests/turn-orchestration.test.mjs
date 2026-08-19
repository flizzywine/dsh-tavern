import assert from 'node:assert/strict'
import test from 'node:test'

import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function script() {
  return {
    title: '银铃', importedAt: 1,
    chunks: [
      { id: 'chunk-1', order: 0, text: '两人在雨夜抵达旅店。' },
      { id: 'chunk-2', order: 1, text: '钟楼传来第三声铃响。' }
    ]
  }
}

function harness(mode) {
  const cards = createCardPreparation({ id: () => 'card-1', now: () => 1000 })
  const scripts = createScriptContinuity()
  let card = cards.create({ kind: 'import', payload: { name: '阿芙拉', description: '旧描述' } })
  let chat = {
    id: 'chat-1', cardId: card.id, cardName: card.name, mode,
    messages: [], posture: '站在窗边', guides: [], nativeCommits: {},
    scriptState: mode === 'script' ? scripts.start(script(), 0) : null,
    extract: mode === 'extract' ? { draft: { name: '' }, player: '', cursor: 0, prepared: null } : null
  }
  const settlements = []
  const plannerCalls = []
  const store = {
    async chatForSession() { return clone(chat) },
    async readCard() { return clone(card) },
    async readScript() { return mode === 'script' || mode === 'revision' ? clone(script()) : undefined },
    async writeChat(value) { chat = clone(value) },
    async updateCard(_cardId, fields, revision, worldBook) {
      const change = cards.update({ kind: 'card', card, patch: fields, revision, worldBookOperations: worldBook })
      card = clone(change.card)
      return clone(change)
    }
  }
  const orchestrator = createTurnOrchestrator({
    store,
    planner: {
      async plan(input) {
        plannerCalls.push(clone(input))
        return { text: 'context:' + input.purpose }
      }
    },
    scripts,
    cards,
    extract: {
      async prepare(value, turn) {
        value.extract.prepared = { nativeTurn: turn, cursorBefore: value.extract.cursor, total: 1, window: [{ title: '素材', text: '拔剑。' }] }
        return value.extract.prepared
      },
      commit(value, turn) {
        if (value.extract.prepared && value.extract.prepared.nativeTurn === turn) {
          value.extract.cursor = 1
          value.extract.prepared = null
        }
      }
    },
    queueSettlement: (chatId) => settlements.push(chatId),
    now: () => 2000
  })
  return {
    orchestrator,
    chat: () => clone(chat),
    card: () => clone(card),
    plannerCalls,
    settlements
  }
}

test('游玩回合由生命周期自动准备与提交，不再要求模型回传正文', async () => {
  const run = harness('story')
  const prepared = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '推开窗' })
  assert.equal(prepared.text, 'context:body')

  const saved = await run.orchestrator.finalize({ sessionId: 'session-1', turn: 2, userText: '推开窗', assistantText: '雨水扑进房间。' })
  assert.equal(saved.saved, true)
  assert.deepEqual(run.chat().messages.map((message) => [message.role, message.text]), [
    ['user', '推开窗'],
    ['assistant', '雨水扑进房间。']
  ])
  assert.deepEqual(run.settlements, ['chat-1'])

  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 2, userText: '推开窗', assistantText: '重复文本' })
  assert.equal(run.chat().messages.length, 2)
})

test('剧本参考在准备时锁定，正文提交后游标前进一块，失败回合可清理', async () => {
  const run = harness('script')
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 3, userText: '走进旅店' })
  assert.equal(run.chat().scriptState.prepared.nativeTurn, 3)
  assert.equal(run.chat().scriptState.recalledChunkIds.length, 0)

  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 3, userText: '走进旅店', assistantText: '门轴发出低响。' })
  assert.equal(run.chat().scriptState.prepared, null)
  assert.deepEqual(run.chat().scriptState.recalledChunkIds, ['chunk-1'])
  assert.equal(run.chat().scriptState.cursor, 1)

  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 4, userText: '停下脚步' })
  assert.equal(run.chat().scriptState.prepared.chunkId, 'chunk-2')
  assert.equal(await run.orchestrator.discard({ sessionId: 'session-1', turn: 4 }), true)
  assert.equal(run.chat().scriptState.prepared, null)
})

test('卡片修改先校验暂存，只在最终回复完成后写入', async () => {
  const run = harness('revision')
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 5, userText: '确认改成新描述' })
  const staged = await run.orchestrator.stageChanges({ sessionId: 'session-1', turn: 5, fields: { description: '新描述' } })
  assert.equal(staged.changed, true)
  assert.equal(run.card().description, '旧描述')

  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 5, userText: '确认改成新描述', assistantText: '已经改好了。' })
  assert.equal(run.card().description, '新描述')
  assert.equal(run.chat().nativeCommits['5'].changed, true)
  assert.deepEqual(await run.orchestrator.visibleTools('session-1'), ['tavern_read_script', 'tavern_read_worldbook', 'tavern_update_card'])
})

test('素材抽取通过同一修改工具更新草稿和玩家身份', async () => {
  const run = harness('extract')
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 6, userText: '确认角色和玩家' })
  await run.orchestrator.stageChanges({ sessionId: 'session-1', turn: 6, fields: { name: '阿芙拉', player: '旅行者' } })
  assert.equal(run.chat().extract.draft.name, '')

  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 6, userText: '确认角色和玩家', assistantText: '草稿已记录。' })
  assert.equal(run.chat().extract.draft.name, '阿芙拉')
  assert.equal(run.chat().extract.player, '旅行者')
  assert.equal(run.chat().extract.cursor, 1)
  assert.deepEqual(await run.orchestrator.visibleTools('session-1'), ['tavern_update_card'])
})
