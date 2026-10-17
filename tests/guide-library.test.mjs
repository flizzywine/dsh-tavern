import assert from 'node:assert/strict'
import test from 'node:test'
import { appendGuides } from '../tavern-plugin/lib/domain/guide-content.js'
import { createGuideLibrary } from '../tavern-plugin/lib/domain/guide-library.js'

test('rename and edit keep identity and loaded game content, and reject stale edits', async () => {
  let value
  const store = { readJson: async () => structuredClone(value), updateJson: async (_, fn) => { value = await fn(structuredClone(value)); return structuredClone(value) } }
  const library = createGuideLibrary({ store })
  const original = await library.save('方案', [{ text: '原内容' }])
  const loaded = appendGuides([], original.guides, { deduplicate: true })
  const renamed = await library.update({ id: original.id, expected: original, name: '新名称' })
  assert.equal(renamed.id, original.id)
  assert.equal(renamed.name, '新名称')
  await assert.rejects(library.update({ id: original.id, expected: original, guides: ['过期修改'] }), /已被修改/)
  const edited = await library.update({ id: renamed.id, expected: renamed, guides: ['第一条', '第二条'] })
  assert.deepEqual(edited.guides, ['第一条', '第二条'])
  assert.equal(loaded[0].text, '原内容')
  await assert.rejects(library.update({ id: edited.id, expected: edited, guides: [''] }), /非空/)
  assert.deepEqual((await library.get(edited.id)).guides, edited.guides)
})

test('delete removes the whole plan and rejects stale deletes', async () => {
  let value
  const store = { readJson: async () => structuredClone(value), updateJson: async (_, fn) => { value = await fn(structuredClone(value)); return structuredClone(value) } }
  const library = createGuideLibrary({ store })
  const first = await library.save('甲', [{ text: '一' }])
  const second = await library.save('乙', [{ text: '二' }])
  await assert.rejects(library.remove({ id: first.id, expected: { ...first, name: '旧' } }), /已被修改/)
  await library.remove({ id: first.id, expected: first })
  assert.deepEqual((await library.list()).map(item => item.id), [second.id])
  await assert.rejects(library.remove({ id: first.id, expected: first }), /不存在/)
})
