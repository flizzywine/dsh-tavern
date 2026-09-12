import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeWorldBooks } from '../tavern-plugin/lib/domain/worldbook-merge.js'

test('合并保留主书设置和所有条目，仅重编冲突编号，不修改原始书', () => {
  const records = [
    { source: { kind: 'standalone', path: 'worldbooks/a.json' }, document: { name: '主书', scan_depth: 2, entries: { 0: { uid: 0, comment: '[initvar]', content: 'hp: 100', disable: true }, 2: { uid: 2, content: '<%= value %>', extension: { custom: true } } } } },
    { source: { kind: 'standalone', path: 'worldbooks/b.json' }, document: { name: '附加', scan_depth: 9, entries: { 0: { uid: 0, comment: '[initvar]', content: 'hp: 50', disable: true }, 1: { uid: 1, content: '[mvu_update] rule' } } } }
  ]
  const before = structuredClone(records)
  const merged = mergeWorldBooks(records)
  assert.deepEqual(records, before)
  assert.equal(merged.document.name, '主书')
  assert.equal(merged.document.scan_depth, 2)
  assert.deepEqual(Object.values(merged.document.entries).map(entry => entry.uid), [0, 1, 2, 3])
  assert.equal(merged.document.entries[3].content, 'hp: 50')
  assert.equal(merged.document.entries[1].content, '[mvu_update] rule')
  assert.deepEqual(merged.sources[1].entries, [{ originalUid: 0, uid: 3 }, { originalUid: 1, uid: 1 }])
})

import { inspectWorldBookDocument, exportCharacterBook } from '../tavern-plugin/lib/domain/worldbook-resource.js'
import { constantWorldBookContext } from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { TavernPromptTemplateRuntime } from '../tavern-plugin/lib/domain/tavern-prompt-template-runtime.js'
import { createOpeningPreparation } from '../tavern-plugin/lib/domain/opening-preparation.js'

test('编号不控制合并书的显示顺序，导出再读取仍保留主书优先', () => {
  const merged = mergeWorldBooks([
    { document: { name: '主书', entries: { 9: { content: '主书正文', constant: true, displayIndex: 99 } } } },
    { document: { name: '附加书', entries: { 0: { uid: '0', content: '附加正文', constant: true } } } }
  ])
  for (const document of [merged.document, exportCharacterBook(merged.document)]) {
    const view = inspectWorldBookDocument(document)
    const context = constantWorldBookContext({ worldBook: { view } })
    assert.ok(context.context.indexOf('主书正文') < context.context.indexOf('附加正文'))
    assert.equal(view.entryCount, 2)
  }
  assert.equal(merged.document.entries[9].uid, 9)
})

for (const content of ['hp: 50', 'hp: <%= 25 * 2 %>']) test('同名初值不额外拦截开局，沿用现有初始化合并：' + content, async () => {
  const merged = mergeWorldBooks([
    { document: { name: '主书', entries: { 0: { uid: 0, comment: '[InitialVariables]', content: 'hp: 100' } } } },
    { document: { name: '附加书', entries: { 0: { uid: 0, comment: '[InitialVariables]', content } } } }
  ])
  const preparation = createOpeningPreparation({
    readCard: async () => ({ name: '示例卡', first_mes: '你来到旅店。' }),
    worldBooks: { bound: async () => ({ source: { kind: 'card', cardPath: 'card' }, view: inspectWorldBookDocument(merged.document) }) },
    templateRuntime: () => TavernPromptTemplateRuntime.create()
  })
  const draft = await preparation.create('card', { runtime: true })
  assert.equal(draft.worldbook.entries.length, 2)
  assert.deepEqual(draft.diagnostics, [])
  assert.equal(preparation.resolve(draft.id, 'card', 'primary').worldbookSnapshot.version, 1)
})
