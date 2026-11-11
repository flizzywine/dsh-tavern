import assert from 'node:assert/strict'
import test from 'node:test'
import { projectOpeningCommit } from '../tavern-plugin/lib/domain/runtime-content-projection.js'
import { projectReplyHistory } from '../tavern-plugin/lib/domain/reply-presentation.js'

import { appendTavernHelperMessages, lastTavernHelperVariables, projectTavernHelperContext } from "../tavern-plugin/lib/domain/tavern-helper-context.js"

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
