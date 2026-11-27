import test from 'node:test'
import assert from 'node:assert/strict'
import { createCandidateWorldbookPreparation } from '../tavern-plugin/lib/domain/candidate-worldbook-preparation.js'

function harness() {
  const chat = { sessionId: 's', mode: 'story', _storageRevision: 1,
    cardDefinitionSnapshot: { name: 'Test' }, openingWorldbookSnapshot: { version: 1 } }
  const errors = [], resources = new Map()
  let calls = 0, project = async () => ({ prefixContext: 'fixed' })
  const cache = createCandidateWorldbookPreparation({
    readHeader: async () => chat,
    readCandidateChat: async () => chat,
    readCard: async value => value.cardDefinitionSnapshot,
    resourceVersion: async name => resources.get(name),
    projectPrefix: async (...args) => { calls++; return project(...args) },
    onError: error => errors.push(error)
  })
  return { cache, chat, errors, resources, get calls() { return calls }, set project(value) { project = value },
    change(source) { chat._storageRevision++; cache.changed(chat, { source }) } }
}

test('variables, body, resources, unknown revisions and rollback invalidate prepared state', async () => {
  const h = harness()
  await h.cache.warm('s')
  h.change('candidate.mailbox.preparing')
  assert.deepEqual(await h.cache.get('s'), { prefixContext: 'fixed' })
  assert.equal(h.calls, 1)
  for (const source of ['mvu.patch', 'body.commit', 'rollback', 'card.reload']) {
    h.change(source)
    await h.cache.get('s')
  }
  assert.equal(h.calls, 5)
  for (const resource of ['prompt-template-variables.json', 'tavern-extension-settings.json']) {
    h.resources.set(resource, 'changed')
    await h.cache.get('s')
  }
  assert.equal(h.calls, 7)
  h.chat._storageRevision++
  h.change('candidate.mailbox.preparing')
  await h.cache.get('s')
  assert.equal(h.calls, 8)
})

test('legacy, compatibility, and unsettled games skip prewarming and prepare fresh on demand', async () => {
  for (const fields of [{ openingWorldbookSnapshot: undefined }, { requestMode: 'sillytavern' },
    { settleStatus: 'running' }, { regenInProgress: true }]) {
    const h = harness()
    Object.assign(h.chat, fields)
    assert.equal(await h.cache.warm('s'), undefined)
    assert.equal(h.calls, 0)
    await h.cache.get('s')
    await h.cache.get('s')
    assert.equal(h.calls, 2)
  }
})

test('failed prefix projections are retried instead of cached as empty source', async () => {
  const h = harness()
  h.project = async () => ({ diagnostics: [{ code: 'worldbook-read-failed' }] })
  assert.equal(await h.cache.warm('s'), undefined)
  assert.match(h.errors[0].message, /候选世界书准备失败/)
  h.project = async (chat, card) => {
    assert.equal(chat, h.chat)
    assert.equal(card, h.chat.cardDefinitionSnapshot)
    return { prefixContext: 'fixed' }
  }
  assert.deepEqual(await h.cache.get('s'), { prefixContext: 'fixed' })
  assert.equal(h.calls, 2)
})
