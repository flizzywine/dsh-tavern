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
  assert.equal(first.showCharacterDesignPanel, false, 'existing games default to hiding character design')
  assert.equal(first.tavernHelper.messages.length, 1)
  for (const placement of ['body', 'sidebar', 'body']) {
    const showCharacterDesignPanel = placement === 'body'
    await host.rpc('updateTavernSettings', { patch: { defaultPlaySettings: { statusBarPlacement: placement }, showCharacterDesignPanel } })
    for (const projection of ['dirty', 'cached']) {
      const view = await read()
      assert.equal(view.statusBarPlacement, placement, projection + ' projection preserves saved placement')
      assert.equal(view.showCharacterDesignPanel, showCharacterDesignPanel, projection + ' projection uses current character design setting')
    }
  }
  await host.dispose()
  host = await createPluginHost({ withTools: true })
  for (const projection of ['full', 'cached']) {
    const view = await read()
    assert.equal(view.statusBarPlacement, 'body', 'cold ' + projection + ' projection restores persisted placement')
    assert.equal(view.showCharacterDesignPanel, true, 'cold ' + projection + ' projection restores persisted character design setting')
  }
  console.log('status bar full/dirty/cached RPC projections passed')
} finally { await host.dispose() }
