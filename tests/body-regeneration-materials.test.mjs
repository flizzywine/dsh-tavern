import assert from 'node:assert/strict'
import test from 'node:test'
import { visibleBodyRegenerationHistory } from '../tavern-plugin/lib/domain/body-regeneration-materials.js'

test('canonical visible history excludes hidden work, discarded swipes and suppressed rounds without truncation', () => {
  const rows = [{ role: 'assistant', greeting: true, turn: 1, projectionText: '开场' },
    { role: 'system', text: 'private-system' }, { role: 'tool', text: 'private-tool' },
    { role: 'tavern-helper', tavernRole: 'assistant', tavernHidden: true, text: 'private-helper' },
    { role: 'user', hidden: true, text: 'private-hidden-user' },
    { role: 'user', text: 'private-suppressed-input' }, { role: 'assistant', turn: 8, projectionText: 'private-suppressed-body' },
    { role: 'user', text: '合法输入' }, { role: 'assistant', turn: 9, projectionText: '合法正文 {{setvar::x::不要执行}}',
      sourceText: 'private-raw-source', swipes: ['private-discarded', '合法正文'], swipeId: 1 },
    { role: 'tavern-helper', tavernRole: 'user', tavernHidden: false, text: '可见补充输入' }]
  for (let turn = 10; turn < 130; turn++) rows.push({ role: 'user', text: '输入' + turn }, { role: 'assistant', turn, projectionText: '完整正文' + turn, text: 'summary-only' })
  const result = visibleBodyRegenerationHistory({ messages: rows, suppressedDshTurns: [8] }, rows.length)
  assert.equal(result.length, 244)
  assert.doesNotMatch(JSON.stringify(result), /private-|summary-only/)
  assert.equal(result[2].input, '合法输入')
  assert.equal(result[2].text, '合法正文 {{setvar::x::不要执行}}')
  assert.equal(result.at(-1).text, '完整正文129')
})
