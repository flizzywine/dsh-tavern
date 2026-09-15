import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FAILED_TURN_NOTICE_MARKER,
  stripFailedNoticeText,
  cleanFailedNoticeMessages,
  failedNoticeEventTurns,
  applyFailedNoticeCleanup
} from '../tavern-plugin/lib/domain/failed-turn-notice.js'

const notice = FAILED_TURN_NOTICE_MARKER + 'Error: 模板读取版本已过期或聊天已切换 at about:srcdoc:10:338'

test('stripFailedNoticeText only matches a leading notice and keeps the player text', () => {
  assert.equal(stripFailedNoticeText(notice + '\r\n\n这个你看看啥情况'), '这个你看看啥情况')
  assert.equal(stripFailedNoticeText(notice), '')
  assert.equal(stripFailedNoticeText('普通消息'), null)
  assert.equal(stripFailedNoticeText('前缀 ' + FAILED_TURN_NOTICE_MARKER), null)
  assert.equal(stripFailedNoticeText(undefined), null)
})

test('cleanFailedNoticeMessages strips notices, keeps unrelated messages and collects turns', () => {
  const messages = [
    { role: 'user', text: notice + '\n这个你看看啥情况', turn: 10 },
    { role: 'assistant', text: '查到了', turn: 10 },
    { role: 'user', text: '还是一样', turn: 11 },
    { role: 'user', text: notice + '\n还是一样，你看看', turn: 11 }
  ]
  const result = cleanFailedNoticeMessages(messages)
  assert.deepEqual(result, { cleared: 2, turns: [10, 11] })
  assert.equal(messages[0].text, '这个你看看啥情况')
  assert.equal(messages[1].text, '查到了')
  assert.equal(messages[2].text, '还是一样')
  assert.equal(messages[3].text, '还是一样，你看看')
})

test('failedNoticeEventTurns maps inbox splices and user messages to the following turn', () => {
  const events = [
    { seq: 1, type: 'turn/end', data: { turn: 9, reason: { kind: 'completed' } } },
    { seq: 2, type: 'agent/inbox/spliced', data: { target: 'next-turn', inserted: [{ content: [{ type: 'text', text: notice + '\n这个你看看啥情况' }] }] } },
    { seq: 3, type: 'assistant/chunk', data: { turn: 10 } },
    { seq: 4, type: 'agent/inbox/spliced', data: { target: 'next-turn', inserted: [{ content: [{ type: 'text', text: notice + '\n还是一样' }] }] } },
    { seq: 5, type: 'user/message', data: { source: { kind: 'plugin', plugin: 'dsh-tavern' }, text: notice } },
    { seq: 6, type: 'assistant/message', data: { turn: 11 } }
  ]
  assert.deepEqual(failedNoticeEventTurns(events), [10, 11])
  assert.deepEqual(failedNoticeEventTurns([]), [])
})

test('applyFailedNoticeCleanup appends turns, respects replace and stays idempotent', () => {
  const chat = {
    messages: [{ role: 'user', text: notice + '\n这个你看看啥情况', turn: 10 }],
    suppressedDshTurns: [3]
  }
  const first = applyFailedNoticeCleanup(chat, {})
  assert.deepEqual(first, { cleared: 1, turns: [10], suppressedDshTurns: [3, 10] })
  assert.deepEqual(chat.clearedFailedNoticeTurns, [10])
  const second = applyFailedNoticeCleanup(chat, {})
  assert.deepEqual(second, { cleared: 0, turns: [10], suppressedDshTurns: [3, 10] })

  // replace = 精确替换：只保留 requested 与本次新发现的轮次（用于纠正历史误判）
  const replaced = applyFailedNoticeCleanup(chat, { requested: [7], replace: true })
  assert.deepEqual(replaced, { cleared: 0, turns: [7], suppressedDshTurns: [7] })
  assert.deepEqual(chat.suppressedDshTurns, [7])
  const recalled = applyFailedNoticeCleanup(chat, { requested: [7, 10], replace: true })
  assert.deepEqual(recalled.suppressedDshTurns, [7, 10])
})

test('applyFailedNoticeCleanup never touches unrelated chat state', () => {
  const chat = { messages: [{ role: 'user', text: '正常', turn: 2 }], timeline: { branchId: 'main' }, posture: '站着' }
  applyFailedNoticeCleanup(chat, {})
  assert.deepEqual(chat.messages, [{ role: 'user', text: '正常', turn: 2 }])
  assert.equal(chat.posture, '站着')
  assert.deepEqual(chat.timeline, { branchId: 'main' })
  assert.deepEqual(chat.suppressedDshTurns, [])
})
