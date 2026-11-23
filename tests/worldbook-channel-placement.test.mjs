import test from 'node:test'
import assert from 'node:assert/strict'
import { worldbookPlacement } from '../tavern-plugin/lib/domain/worldbook-placement.js'
import { constantWorldBookContext } from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { activateWorldBook } from '../tavern-plugin/lib/domain/worldbook-activation.js'
import { inspectWorldBookDocument, updateWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'

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
      return [String(index), { uid: index, key: value.keys || [], keysecondary: [], comment: '条目' + index, content: value.content,
        disable: false, constant: value.constant === true, selective: true, order: 100, position: 0,
        extensions: value.extensions || {} }]
    }))
  }
}

test('旧世界书的整本与条目通道都按自动规则召回和放置', () => {
  const document = bookDocument({ tavern_channel: 'prefix' }, [
    { content: '甲设定', keys: ['钟楼'] },
    { content: '乙设定', constant: true, extensions: { tavern_channel: 'tail' } },
    { content: '丙设定', keys: ['港口'], extensions: { tavern_channel: 'prefix' } }
  ])
  const view = inspectWorldBookDocument(document)
  assert.deepEqual(channels(view.entries), { foreground: ['entry:0', 'entry:2'], prefix: ['entry:1'] })
  assert.deepEqual(stableRefs(view.entries), ['entry:1'])
  assert.deepEqual(select(view.entries).entries.map(item => item.ref), ['entry:1'])
  const matched = select(view.entries, { userText: '说说钟楼和港口' })
  assert.deepEqual(matched.entries.map(item => item.ref).sort(), ['entry:0', 'entry:1', 'entry:2'])
  assert.equal(matched.diagnostics.find(item => item.ref === 'entry:1').tokenCost, 0)
  assert.ok(matched.diagnostics.find(item => item.ref === 'entry:2').tokenCost > 0)
})

test('编辑旧书时保留原文件的扩展字段，并按条目类型处理动态常驻内容', () => {
  const document = bookDocument({ tavern_channel: 'tail', custom: true }, [
    { content: '<%= 1 + 1 %>', constant: true, extensions: { tavern_channel: 'prefix', custom: true } }
  ])
  const { document: updated, view } = updateWorldBookDocument(document, {
    channel: 'prefix',
    operations: [{ op: 'update', ref: 'entry:0', patch: { comment: '动态规则', channel: 'tail' } }]
  })
  assert.deepEqual(updated.extensions, document.extensions)
  assert.deepEqual(updated.entries[0].extensions, document.entries[0].extensions)
  assert.equal(view.entries[0].comment, '动态规则')
  assert.deepEqual(channels(view.entries), { foreground: ['entry:0'], prefix: [] })
})
