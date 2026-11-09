import assert from 'node:assert/strict'
import test from 'node:test'

import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { replyProse, replyProseProblems } from '../tavern-plugin/lib/domain/reply-prose.js'
import { replaceTavernHelperMessages } from '../tavern-plugin/lib/domain/tavern-helper-context.js'

// Strips the status block from the model context only, the way card prompt regex does.
const regexScripts = [{ id: 'status', name: 'status', findRegex: '/<status>[\\s\\S]*?<\\/status>/g', replaceString: '',
  trimStrings: [], placement: [2], enabled: true, markdownOnly: false, promptOnly: true, runOnEdit: false, minDepth: null, maxDepth: null }]

function savedRound(source) {
  const reply = projectReplyLayers(source, { regexScripts, placement: 2, isEdit: false, depth: 0 })
  return { role: 'assistant', turn: 2, ...replyProse(source, reply), swipeId: 0, swipes: [reply.projectionText], variables: [{}] }
}

test('Helper 切换或改写 swipe 时，正文按保存时的提示词正则重新投影', () => {
  const row = savedRound('甲<status>hp=7</status>')
  row.swipes.push('乙<status>hp=3</status>')
  row.variables.push({})
  row.sessionText = row.text
  const chat = { cardName: '角色', macroState: {}, messages: [row] }

  replaceTavernHelperMessages(chat, [{ message_id: 0, swipe_id: 1 }], { regexScripts })
  assert.equal(row.text, '乙')
  assert.equal(row.sourceText, '乙<status>hp=3</status>')
  assert.equal(Object.hasOwn(row, 'sessionText'), false)
  assert.deepEqual(replyProseProblems(row, { regexScripts }), [])

  replaceTavernHelperMessages(chat, [{ message_id: 0, message: '丙<status>hp=1</status>' }], { regexScripts })
  assert.equal(row.text, '丙')
  assert.deepEqual(row.swipes, ['甲<status>hp=7</status>', '丙<status>hp=1</status>'])
  assert.deepEqual(replyProseProblems(row, { regexScripts }), [])
})
