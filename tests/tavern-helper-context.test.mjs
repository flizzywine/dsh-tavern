import assert from 'node:assert/strict'
import test from 'node:test'
import { projectOpeningCommit, projectRuntimeReplyHistory } from '../tavern-plugin/lib/domain/runtime-content-projection.js'

import {
  projectTavernHelperContext,
  replaceTavernHelperMessages,
  replaceTavernHelperVariables
} from '../tavern-plugin/lib/domain/tavern-helper-context.js'

function macroOpeningChat() {
  const source = '{{incvar::visits}}{{User}}看向{{Char}}。'
  const projection = projectOpeningCommit(source, { charName: '角色', macroState: { userName: '玩家', local: { visits: 0 } } })
  return {
    cardName: '角色', macroState: projection.macroState,
    messages: [{ role: 'assistant', greeting: true, turn: 1, swipeId: 0,
      swipes: [source, '{{USER}}离开{{char}}。'], variables: [{}, {}],
      sourceText: source, projectionText: projection.renderedText,
      text: projection.sessionText, sessionText: projection.sessionText,
      displayText: projection.displayText, displayMode: projection.displayMode }]
  }
}

test('MVU 数据写回不覆盖已解析正文，也不重新执行有副作用的宏', () => {
  for (const patch of [
    { data: { stat_data: { hp: 9 } } },
    { swipes_data: [{ stat_data: { hp: 9 } }, {}] },
    { swipe_id: 0, data: { stat_data: { hp: 9 } } }
  ]) {
    const chat = macroOpeningChat()
    const before = structuredClone(chat)
    replaceTavernHelperMessages(chat, [{ message_id: 0, ...patch }])
    assert.deepEqual(projectRuntimeReplyHistory(chat.messages), projectRuntimeReplyHistory(before.messages))
    assert.deepEqual(chat.macroState, before.macroState)
    assert.deepEqual({ ...chat.messages[0], variables: [] }, { ...before.messages[0], variables: [] })
    assert.equal(chat.messages[0].variables[0].stat_data.hp, 9)
  }
})

test('真正切换开场或编辑正文时才重新解析宏，保留原始 swipe', () => {
  const chat = macroOpeningChat()
  replaceTavernHelperMessages(chat, [{ message_id: 0, swipe_id: 1 }])
  assert.equal(chat.messages[0].text, '玩家离开角色。')
  assert.equal(chat.messages[0].sourceText, '{{USER}}离开{{char}}。')
  assert.equal(chat.messages[0].swipes[1], '{{USER}}离开{{char}}。')
  replaceTavernHelperMessages(chat, [{ message_id: 0, message: '{{incvar::visits}}{{User}}回来。' }])
  assert.equal(chat.messages[0].text, '2玩家回来。')
  assert.equal(chat.macroState.local.visits, 2)
  assert.equal(projectRuntimeReplyHistory(chat.messages).projections[0].text, '2玩家回来。')
  replaceTavernHelperMessages(chat, [{ message_id: 0, message: '' }])
  assert.equal(chat.messages[0].text, '')
})

test('Helper 上下文按当前 swipe 投影消息、变量和回合楼层', () => {
  const chat = {
    _storageRevision: 7,
    variables: { theme: 'red' },
    messages: [
      { role: 'assistant', greeting: true, turn: 1, swipeId: 1, swipes: ['开场甲', '开场乙'], variables: [{ stat_data: { hp: 1 } }, { stat_data: { hp: 2 } }] },
      { role: 'user', text: '继续' },
      { role: 'assistant', turn: 2, text: '正文', variables: [{ stat_data: { hp: 3 } }] }
    ]
  }

  const context = projectTavernHelperContext(chat)

  assert.equal(context.stateRevision, 7)
  assert.equal(context.messages[0].message, '开场乙')
  assert.equal(context.messages[0].variables.stat_data.hp, 2)
  assert.deepEqual(context.messages[0].swipes_data.map(item => item.stat_data.hp), [1, 2])
  assert.deepEqual(context.turnMessageIds, { 1: 0, 2: 2 })
  assert.deepEqual(context.chatVariables, { theme: 'red' })
})

test('Helper 变量写入只修改指定楼层 swipe 或聊天变量', () => {
  const chat = {
    variables: {},
    messages: [{ role: 'assistant', swipeId: 1, variables: [{ hp: 1 }, { hp: 2 }] }]
  }

  assert.deepEqual(replaceTavernHelperVariables(chat, { option: { type: 'message', message_id: 0 }, variables: { hp: 4 } }), { type: 'message', messageId: 0, swipeId: 1 })
  assert.deepEqual(chat.messages[0].variables, [{ hp: 1 }, { hp: 4 }])
  assert.deepEqual(replaceTavernHelperVariables(chat, { option: { type: 'chat' }, variables: { cache: true } }), { type: 'chat' })
  assert.deepEqual(chat.variables, { cache: true })
})

test('Helper 变量 latest 别名写入最后一条消息', () => {
  const chat = {
    messages: [
      { role: 'assistant', variables: [{ hp: 1 }] },
      { role: 'assistant', variables: [{ hp: 2 }] }
    ]
  }

  assert.deepEqual(
    replaceTavernHelperVariables(chat, { option: { type: 'message', message_id: 'latest' }, variables: { hp: 9 } }),
    { type: 'message', messageId: 1, swipeId: 0 }
  )
  assert.deepEqual(chat.messages[1].variables, [{ hp: 9 }])
})

test('Helper 脚本变量按脚本 ID 独立持久化并进入同步上下文', () => {
  const chat = { messages: [], tavernHelperScriptVariables: { existing: { enabled: true } } }
  assert.deepEqual(
    replaceTavernHelperVariables(chat, { option: { type: 'script', script_id: 'dynamic-worldbook' }, variables: { auto_apply: false } }),
    { type: 'script', scriptId: 'dynamic-worldbook' }
  )
  assert.deepEqual(projectTavernHelperContext(chat).scriptVariables, {
    existing: { enabled: true },
    'dynamic-worldbook': { auto_apply: false }
  })
  assert.throws(function () {
    replaceTavernHelperVariables(chat, { option: { type: 'script' }, variables: {} })
  }, /script_id/)
})

test('Helper 消息写入可切换开场 swipe 并修改当前正文', () => {
  const chat = {
    messages: [{
      role: 'assistant',
      swipeId: 0,
      swipes: ['开场甲', '开场乙'],
      variables: [{ hp: 1 }, { hp: 2 }],
      sourceText: '开场甲',
      text: '开场甲'
    }]
  }

  assert.deepEqual(replaceTavernHelperMessages(chat, [{ message_id: 0, swipe_id: 1 }]), [{ messageId: 0, swipeId: 1 }])
  assert.equal(chat.messages[0].swipeId, 1)
  assert.equal(chat.messages[0].text, '开场乙')
  assert.equal(chat.messages[0].sourceText, '开场乙')
  assert.equal(chat.messages[0].projectionText, '开场乙')

  replaceTavernHelperMessages(chat, [{ message_id: 'latest', message: '自定义开场', data: { hp: 7 } }])
  assert.equal(chat.messages[0].swipes[1], '自定义开场')
  assert.equal(chat.messages[0].text, '自定义开场')
  assert.equal(chat.messages[0].projectionText, '自定义开场')
  assert.deepEqual(chat.messages[0].variables[1], { hp: 7 })
})

test('官方 MVU 可以一次写回所有开场 swipe 的独立变量快照', () => {
  const chat = {
    messages: [{
      role: 'assistant',
      swipeId: 1,
      swipes: ['开场甲', '开场乙'],
      variables: [],
      sourceText: '开场乙',
      text: '开场乙'
    }]
  }

  replaceTavernHelperMessages(chat, [{
    message_id: 0,
    swipes_data: [
      { stat_data: { route: '甲' }, schema: { type: 'object', properties: {} } },
      { stat_data: { route: '乙' }, schema: { type: 'object', properties: {} } }
    ]
  }])

  assert.deepEqual(chat.messages[0].variables.map(item => item.stat_data.route), ['甲', '乙'])
  assert.equal(projectTavernHelperContext(chat).messages[0].variables.stat_data.route, '乙')
})
