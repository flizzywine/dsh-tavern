import test from 'node:test'
import assert from 'node:assert/strict'

import { createWholeReadGuard } from '../tavern-plugin/lib/domain/whole-read-guard.js'

test('storage reports whole copies and whole rebuilds, not narrow reads of a cached native save', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createChatJournalStore } = await import('../tavern-plugin/lib/domain/chat-journal-store.js')
  const { createChatPersistence } = await import('../tavern-plugin/lib/domain/chat-persistence.js')
  const root = await mkdtemp(join(tmpdir(), 'whole-read-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const reported = []
  const guard = createWholeReadGuard({ mode: 'warn', minFloors: 0, logger: { warn: message => reported.push(message) } })
  const p = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true, wholeReadGuard: guard }) })
  await p.write({ id: 'c', sessionId: 's', mode: 'story', messages: [{ role: 'user', text: 'u' }, { role: 'assistant', text: 'a' }] }, { source: 'create' })
  await p.read('c')
  await guard.scope('结算', async () => {
    await p.readSlice('c', [1], ['mode'])
    await p.readBackgroundConfig('c')
    const revision = (await p.readSlice('c', [])).chat._storageRevision
    await p.patch('c', revision, [{ op: 'set', path: ['messages', 1, 'text'], value: 'b' }], { source: 'test' })
  })
  assert.deepEqual(reported, [])
  await guard.scope('结算', () => p.read('c'))
  assert.equal(reported.length, 1)
})
