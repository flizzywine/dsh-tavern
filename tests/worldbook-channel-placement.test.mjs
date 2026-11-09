import test from 'node:test'
import assert from 'node:assert/strict'
import { worldbookPlacement } from '../tavern-plugin/lib/domain/worldbook-placement.js'
import { constantWorldBookContext } from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { activateWorldBook } from '../tavern-plugin/lib/domain/worldbook-activation.js'
import { inspectWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'

function channels(entries) {
  const { foregroundRefs, prefixRefs } = worldbookPlacement(entries, [])
  return { foreground: [...foregroundRefs].sort(), prefix: [...prefixRefs].sort() }
}

function stableRefs(entries) {
  return constantWorldBookContext({ worldBook: { view: { entries } } }).refs.slice().sort()
}

function select(entries, options = {}) {
  return activateWorldBook({
    worldBook: { view: { raw: {}, entries } },
    entries,
    chat: { messages: [] },
    turn: 1,
    userText: '继续',
    isCoolingDown: () => false,
    ...options
  })
}

function bookDocument(rootExtensions, entries) {
  return {
    name: '测试书',
    extensions: rootExtensions,
    entries: Object.fromEntries(entries.map(function (value, index) {
      return [String(index), { uid: index, key: [], keysecondary: [], comment: '条目' + index, content: value.content,
        disable: false, constant: value.constant === true, selective: true, order: 100, position: 0,
        extensions: value.extensions || {} }]
    }))
  }
}

test('整本默认通道：没有单独设过的条目跟随，单独设过的条目覆盖', () => {
  const document = bookDocument({ tavern_channel: 'prefix' }, [
    { content: '甲设定' },
    { content: '乙设定', extensions: { tavern_channel: 'tail' } }
  ])
  const view = inspectWorldBookDocument(document)
  assert.equal(view.channel, 'prefix')
  assert.equal(view.entries[0].channel, 'prefix')
  assert.equal(view.entries[0].channelInherited, true)
  assert.equal(view.entries[1].channel, 'tail')
  assert.equal(view.entries[1].channelInherited, false)
  // 整本默认直接决定放置与稳定前缀内容，不需要逐条写入。
  assert.deepEqual(channels(view.entries), { foreground: ['entry:1'], prefix: ['entry:0'] })
  assert.deepEqual(stableRefs(view.entries), ['entry:0'])
  const result = select(view.entries)
  assert.deepEqual(result.entries.map(item => item.ref).sort(), ['entry:0', 'entry:1'])
  assert.equal(result.diagnostics.find(item => item.ref === 'entry:0').tokenCost, 0)
  assert.ok(result.diagnostics.find(item => item.ref === 'entry:1').tokenCost > 0)
})
