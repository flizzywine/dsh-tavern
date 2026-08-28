import assert from 'node:assert/strict'
import test from 'node:test'

import {
  projectTavernHelperContext,
  replaceTavernHelperMessages,
  replaceTavernHelperVariables
} from '../tavern-plugin/lib/domain/tavern-helper-context.js'

test('Helper 上下文按当前 swipe 投影消息、变量和回合楼层', () => {
  const chat = {
    variables: { theme: 'red' },
    messages: [
      { role: 'assistant', greeting: true, turn: 1, swipeId: 1, swipes: ['开场甲', '开场乙'], variables: [{ stat_data: { hp: 1 } }, { stat_data: { hp: 2 } }] },
      { role: 'user', text: '继续' },
      { role: 'assistant', turn: 2, text: '正文', variables: [{ stat_data: { hp: 3 } }] }
    ]
  }

  const context = projectTavernHelperContext(chat)

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

  replaceTavernHelperMessages(chat, [{ message_id: 'latest', message: '自定义开场', data: { hp: 7 } }])
  assert.equal(chat.messages[0].swipes[1], '自定义开场')
  assert.equal(chat.messages[0].text, '自定义开场')
  assert.deepEqual(chat.messages[0].variables[1], { hp: 7 })
})
