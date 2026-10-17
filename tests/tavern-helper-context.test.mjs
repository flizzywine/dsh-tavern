import assert from 'node:assert/strict'
import test from 'node:test'
import { projectOpeningCommit } from '../tavern-plugin/lib/domain/runtime-content-projection.js'
import { projectReplyHistory } from '../tavern-plugin/lib/domain/reply-presentation.js'

import { appendTavernHelperMessages, lastTavernHelperVariables, projectTavernHelperContext, replaceTavernHelperMessages } from '../tavern-plugin/lib/domain/tavern-helper-context.js'

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
    assert.deepEqual(projectReplyHistory(chat.messages), projectReplyHistory(before.messages))
    assert.deepEqual(chat.macroState, before.macroState)
    assert.deepEqual({ ...chat.messages[0], variables: [] }, { ...before.messages[0], variables: [] })
    assert.equal(chat.messages[0].variables[0].stat_data.hp, 9)
  }
})

test('Helper 创建的新楼层只进入脚本历史，不冒充剧情回合', () => {
  const chat = macroOpeningChat()
  const storyProjection = projectReplyHistory(chat.messages)
  assert.deepEqual(appendTavernHelperMessages(chat, [{
    role: 'assistant', message: '<chat_history>手机记录</chat_history>',
    name: '手机', is_hidden: false, data: { phone: true }
  }]), [{ messageId: 1 }])

  assert.equal(chat.messages[1].role, 'tavern-helper')
  assert.equal(chat.messages[1].tavernRole, 'assistant')
  assert.equal(chat.messages[1].turn, undefined)
  const projected = projectTavernHelperContext(chat).messages[1]
  assert.equal(projected.role, 'assistant')
  assert.equal(projected.name, '手机')
  assert.equal(projected.is_hidden, false)
  assert.equal(projected.message, '<chat_history>手机记录</chat_history>')
  assert.deepEqual(projected.variables, { phone: true })
  assert.deepEqual(projectReplyHistory(chat.messages), storyProjection)
  assert.deepEqual(lastTavernHelperVariables(chat.messages), {})

  assert.throws(() => appendTavernHelperMessages(chat, [{ role: 'assistant', message: '插入' }], { insert_before: 0 }), /只支持追加/)
})

test('verified tail append visits only appended floors and preserves turn mappings', () => {
  for (const length of [1000, 10000]) {
    const rows = Array.from({length}, (_, i) => ({role:'assistant', turn:i + 1, text:'old', variables:[{hp:i}]}))
    const previous = projectTavernHelperContext({id:'append',messages:rows},{indexed:true})
    rows.push({role:'user',turn:length + 1,text:'input'}, {role:'assistant',turn:length + 1,text:'new',variables:[{hp:7}]})
    let reads = 0
    const messages = new Proxy(rows,{get(target,key,receiver){if(typeof key === 'string' && /^\d+$/.test(key)) reads++;return Reflect.get(target,key,receiver)}})
    const next = projectTavernHelperContext({id:'append',messages},{indexed:true,previousContext:previous,previousMessages:previous.messages,dirtyIndices:new Set([length,length + 1]),layoutChanged:true,layoutFrom:length})
    assert.ok(reads <= 4, `append visited ${reads} floors of ${length}`)
    assert.equal(next.messages[0],previous.messages[0])
    assert.equal(next.turnMessageIds[String(length + 1)],length + 1)
    assert.equal(previous.turnMessageIds[String(length + 1)],undefined)
    assert.deepEqual(JSON.parse(JSON.stringify(next)),JSON.parse(JSON.stringify(projectTavernHelperContext({id:'append',messages:rows}))))
  }
})
