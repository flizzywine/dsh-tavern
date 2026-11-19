import test from 'node:test'
import assert from 'node:assert/strict'

import { createTemplateHistoryWindow } from '../tavern-plugin/lib/vendor/st-prompt-template/host-build/history-window.js'

function windowOf(count, from) {
  const reads = []
  const row = id => ({ mes: 'm' + id, variables: id % 100 === 7 ? [{ id }] : [] })
  const history = createTemplateHistoryWindow({ window: { from, messageCount: count },
    rows: Array.from({ length: count - from }, (_, index) => row(from + index)),
    read: id => (reads.push(id), row(id)) })
  return { chat: history.chat, reads }
}

test('slice keeps native bounds and copy semantics', () => {
  const { chat } = windowOf(10, 0)
  for (const args of [[], [3], [-3], [2, 5], [5, 2], [-4, -1], [0, 99], [undefined, 4], [NaN, 2]])
    assert.deepEqual(chat.slice(...args).map(message => message.mes), Array.prototype.slice.apply(chat, args).map(message => message.mes), JSON.stringify(args))
  const copy = chat.slice(0, 3)
  copy[1] = { mes: 'replaced' }
  assert.equal(copy[1].mes, 'replaced')
  assert.equal(chat[1].mes, 'm1')
  assert.equal(Object.keys(chat).includes('slice'), false)
})
