import assert from 'node:assert/strict'
import test from 'node:test'
import { createCardEditor } from '../tavern-plugin/lib/domain/card-editor.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'

test('并发编辑同一卡保留两个补丁，失败后队列仍可继续', async () => {
  const cardPreparation = createCardPreparation()
  let card = cardPreparation.create({ kind: 'import', payload: { name: 'A', description: 'old', personality: 'old' } })
  const names = []
  let fail = false
  const edit = createCardEditor({
    cardPreparation,
    readCardWorkspace: async () => structuredClone(card),
    fileResources: { async writeWorking(path, text) {
      await new Promise(resolve => setImmediate(resolve))
      if (fail) { fail = false; throw new Error('write failed') }
      card = JSON.parse(text)
    } },
    bumpCardProjectionRevision: async () => {},
    syncCardName: async (path, name) => { names.push(name) }
  })
  const results = await Promise.all([
    edit('cards/A.json', { description: 'new description', name: 'B' }),
    edit('cards/A.json', { personality: 'new personality', name: 'C' })
  ])
  assert.ok(results.every(result => result.changed))
  const saved = cardPreparation.project(card)
  assert.equal(saved.description, 'new description')
  assert.equal(saved.personality, 'new personality')
  assert.deepEqual(names, ['B', 'C'])
  fail = true
  await assert.rejects(edit('cards/A.json', { name: 'failed' }), /write failed/)
  await edit('cards/A.json', { name: 'D' })
  assert.equal(cardPreparation.project(card).name, 'D')
})
