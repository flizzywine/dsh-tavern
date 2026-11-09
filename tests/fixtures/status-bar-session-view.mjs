import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createPluginHost } from './plugin-host.mjs'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { resolveTavernDataRoot } from '../../tavern-plugin/lib/domain/tavern-data.js'

const root = resolveTavernDataRoot()
await mkdir(join(root, 'resources', 'cards'), { recursive: true })
await writeFile(join(root, 'resources', 'cards', 'status.json'), JSON.stringify({ meta: { id: 'status' } }))
await writeFile(join(root, 'sessions.json'), JSON.stringify({ s: 'status-chat' }))
await createChatJournalStore({ dataRoot: root }).update('status-chat', () => ({
  id: 'status-chat', _storageRevision: 1, sessionId: 's', mode: 'story', cardPath: 'cards/status.json',
  backgroundConfigVersion: 1, conversationFeaturesVersion: 1,
  cardDefinitionSnapshot: { name: 'Status test', extensions: {} },
  statusBarPlacement: 'body', mvu: { enabled: true }, messages: [{ role: 'assistant', turn: 1, text: 'Opening' }]
}))
let host = await createPluginHost({ withTools: true })
try {
  const read = async () => (await host.rpc('getSession', { sessionId: 's' })).view
  // First read runs the full production projector and enables dirty history reuse.
  const first = await read()
  assert.equal(first.statusBarPlacement, 'sidebar', 'full projection default')
  assert.equal(first.tavernHelper.messages.length, 1)
  for (const placement of ['body', 'sidebar', 'body']) {
    await host.rpc('updateTavernSettings', { patch: { defaultPlaySettings: { statusBarPlacement: placement } } })
    assert.equal((await read()).statusBarPlacement, placement, 'dirty projection preserves saved placement')
    assert.equal((await read()).statusBarPlacement, placement, 'cached projection preserves saved placement')
  }
  await host.dispose()
  host = await createPluginHost({ withTools: true })
  assert.equal((await read()).statusBarPlacement, 'body', 'cold full projection restores persisted placement')
  assert.equal((await read()).statusBarPlacement, 'body', 'cold cache preserves persisted placement')
  console.log('status bar full/dirty/cached RPC projections passed')
} finally { await host.dispose() }
