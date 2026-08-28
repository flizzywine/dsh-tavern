import assert from 'node:assert/strict'
import test from 'node:test'

import { createTavernMvuOpeningReconciler } from '../tavern-plugin/lib/domain/tavern-mvu-opening-reconciliation.js'
import { createTavernMvuRuntime, MVU_EVENTS } from '../tavern-plugin/lib/domain/tavern-mvu-runtime.js'

function fixture() {
  return {
    chat: {
      id: 'chat-1',
      sessionId: 'session-1',
      macroState: { userName: '王辰' },
      mvu: { enabled: true, openingInitialization: { version: 1, status: 'pending' } },
      messages: [{
        role: 'assistant',
        greeting: true,
        swipeId: 1,
        swipes: [
          '<initvar>角色:\n  姓名: "{{user}}"\n  体力: 3</initvar>',
          '<initvar>角色:\n  姓名: "{{user}}"\n  体力: 5</initvar>\n_.add("角色.体力", 2);'
        ],
        variables: []
      }],
      tavernHelperLifecycleRevision: 2
    },
    card: {
      name: '灯火阑珊',
      first_mes: '',
      alternate_greetings: [],
      character_book: { name: '风雪依稀秋白发', entries: [] }
    }
  }
}

test('Helper 就绪后按官方事件顺序重新结算全部开场 swipe 并原子替换快照', async function () {
  const state = fixture()
  const events = []
  let writes = 0
  const reconciler = createTavernMvuOpeningReconciler({
    runtime: createTavernMvuRuntime(),
    resolveChat: async function () { return structuredClone(state.chat) },
    readCard: async function () { return structuredClone(state.card) },
    dispatch: async function (event) {
      events.push(event.name)
      if (event.name === MVU_EVENTS.initialized) event.args[0].stat_data.角色.脚本默认值 = true
      if (event.name === MVU_EVENTS.updateEndedForZod) {
        event.args[0].schema = '没有用别管这个'
        delete event.args[0].display_data
        delete event.args[0].delta_data
      }
      return { handled: true, args: event.args }
    },
    updateChat: async function (_id, mutation) {
      writes += 1
      state.chat = await mutation(state.chat)
      return structuredClone(state.chat)
    },
    now: function () { return 123 }
  })

  const result = await reconciler.reconcile('session-1')

  assert.equal(result.status, 'complete')
  assert.equal(state.chat.messages[0].variables.length, 2)
  assert.deepEqual(state.chat.messages[0].variables[0].stat_data, { 角色: { 姓名: '王辰', 体力: 3, 脚本默认值: true } })
  assert.deepEqual(state.chat.messages[0].variables[1].stat_data, { 角色: { 姓名: '王辰', 体力: 7, 脚本默认值: true } })
  assert.equal(state.chat.messages[0].variables[1].schema, '没有用别管这个')
  assert.deepEqual(state.chat.messages[0].variables[1].initialized_lorebooks, { 风雪依稀秋白发: [] })
  assert.equal(state.chat.mvu.openingInitialization.status, 'complete')
  assert.equal(state.chat.mvu.openingInitialization.completedAt, 123)
  assert.equal(state.chat.tavernHelperLifecycleRevision, 3)
  assert.deepEqual(events.slice(0, 7), [
    MVU_EVENTS.initialized,
    MVU_EVENTS.updateStarted,
    MVU_EVENTS.commandParsed,
    MVU_EVENTS.commandParsedForZod,
    MVU_EVENTS.commandParsedEndedForZod,
    MVU_EVENTS.updateEnded,
    MVU_EVENTS.updateEndedForZod
  ])

  assert.equal((await reconciler.reconcile('session-1')).status, 'not-required')
  assert.equal(writes, 1)
})

test('任一 Helper 事件未交付时保留 provisional 快照和 pending 状态', async function () {
  const state = fixture()
  const before = structuredClone(state.chat)
  const reconciler = createTavernMvuOpeningReconciler({
    runtime: createTavernMvuRuntime(),
    resolveChat: async function () { return structuredClone(state.chat) },
    readCard: async function () { return structuredClone(state.card) },
    dispatch: async function (event) { return { handled: event.name !== MVU_EVENTS.commandParsed, args: event.args } },
    updateChat: async function () { throw new Error('运行时不完整时不应写入') }
  })

  const result = await reconciler.reconcile('session-1')
  assert.equal(result.status, 'runtime-unavailable')
  assert.deepEqual(state.chat, before)
})
