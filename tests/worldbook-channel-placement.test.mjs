import test from 'node:test'
import assert from 'node:assert/strict'
import { worldbookPlacement } from '../tavern-plugin/lib/domain/worldbook-placement.js'
import { constantWorldBookContext } from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { activateWorldBook } from '../tavern-plugin/lib/domain/worldbook-activation.js'
import { inspectWorldBookDocument, updateWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'

function entry(ref, patch = {}) {
  return { ref, enabled: true, constant: false, group: '', content: ref + '设定', ...patch }
}

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

test('默认自动通道：常驻静态进稳定前缀，非常驻进每轮尾部，含模板的常驻仍在尾部', () => {
  const entries = [
    entry('static', { constant: true }),
    entry('dynamic'),
    entry('templated', { constant: true, content: '甲设定<% if (true) { %>乙<% } %>' })
  ]
  assert.deepEqual(channels(entries), { foreground: ['dynamic', 'templated'], prefix: ['static'] })
  assert.deepEqual(stableRefs(entries), ['static'])
})

test('通道 prefix：非常驻条目也进稳定前缀，并且不按关键词/预算挑选', () => {
  const entries = [entry('pinned', { channel: 'prefix' })]
  assert.deepEqual(channels(entries), { foreground: [], prefix: ['pinned'] })
  assert.deepEqual(stableRefs(entries), ['pinned'])
  const result = select(entries)
  assert.deepEqual(result.entries.map(entry => entry.ref), ['pinned'])
  // 前缀条目像常驻一样不占预算
  assert.equal(result.diagnostics.find(item => item.ref === 'pinned').tokenCost, 0)
})

test('通道 tail：常驻条目搬到每轮尾部，不再进入稳定前缀，但仍然计入预算', () => {
  const entries = [entry('pinned', { constant: true, channel: 'tail', content: '甲设定'.repeat(400) })]
  assert.deepEqual(channels(entries), { foreground: ['pinned'], prefix: [] })
  assert.deepEqual(stableRefs(entries), [])
  const result = select(entries)
  assert.deepEqual(result.entries.map(entry => entry.ref), ['pinned'])
  assert.ok(result.diagnostics.find(item => item.ref === 'pinned').tokenCost > 0)
})

test('通道 prefix 遇到会变的正文仍留在每轮尾部', () => {
  const entries = [entry('ejs', { channel: 'prefix', content: '甲<% if (true) { %>乙<% } %>' })]
  assert.deepEqual(channels(entries), { foreground: ['ejs'], prefix: [] })
  assert.deepEqual(stableRefs(entries), [])
})

test('通道字段随世界书持久化，auto 会清掉扩展键', () => {
  const document = {
    entries: {
      0: {
        uid: 0, key: [], keysecondary: [], comment: '甲', content: '甲设定',
        disable: false, constant: true, selective: true, order: 100, position: 0, extensions: {}
      }
    }
  }
  const tail = updateWorldBookDocument(document, { operations: [{ op: 'update', ref: 'entry:0', patch: { channel: 'tail' } }] }).document
  assert.equal(tail.entries['0'].extensions.tavern_channel, 'tail')
  assert.equal(inspectWorldBookDocument(tail).entries[0].channel, 'tail')
  const back = updateWorldBookDocument(tail, { operations: [{ op: 'update', ref: 'entry:0', patch: { channel: 'auto' } }] }).document
  assert.equal(back.entries['0'].extensions.tavern_channel, undefined)
  assert.equal(inspectWorldBookDocument(back).entries[0].channel, 'auto')
})
