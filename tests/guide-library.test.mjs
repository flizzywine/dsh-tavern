import assert from 'node:assert/strict'
import test from 'node:test'

import { createGuideLibrary } from '../tavern-plugin/lib/domain/guide-library.js'

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
