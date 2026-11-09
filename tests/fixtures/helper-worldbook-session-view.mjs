import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createPluginHost } from './plugin-host.mjs'
import { createCardPreparation } from '../../tavern-plugin/lib/domain/card-preparation.js'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { resolveTavernDataRoot } from '../../tavern-plugin/lib/domain/tavern-data.js'

const root = resolveTavernDataRoot()
await mkdir(join(root, 'resources', 'cards'), {recursive: true})
await writeFile(join(root, 'sessions.json'), JSON.stringify({s: 'worldbook-chat'}))
const book = {name: '回归世界书', entries: [{id: 7, comment: '站台', keys: ['车站'], content: '测试资料', enabled: true}]}
const card = {name: 'Worldbook test', extensions: {}, character_book: book}
const workspace = createCardPreparation().create({ kind: 'import', payload: card })
await writeFile(join(root, 'resources', 'cards', 'worldbook.json'), JSON.stringify(workspace))
await createChatJournalStore({dataRoot: root}).update('worldbook-chat', () => ({
  id: 'worldbook-chat', _storageRevision: 1, sessionId: 's', mode: 'story', cardPath: 'cards/worldbook.json',
  backgroundConfigVersion: 1, conversationFeaturesVersion: 1,
  cardDefinitionSnapshot: card,
  openingWorldbookSnapshot: {version: 1, source: {kind: 'card', cardPath: 'cards/worldbook.json'}, document: book},
  mvu: {enabled: true}, messages: [{role: 'assistant', turn: 1, text: 'Opening'}]
}))
const host = await createPluginHost()
try {
  for (const resourceSync of [1, undefined, 1]) {
    const {view} = await host.rpc('getSession', {sessionId: 's', resourceSync})
    assert.ok(view.tavernHelper.worldbook, JSON.stringify({resourceSync, diagnostics: view.tavernHelperScriptDiagnostics}));
    assert.equal(view.tavernHelper.worldbook.name, '回归世界书')
    assert.equal(view.tavernHelper.character.name, 'Worldbook test')
    assert.equal(view.tavernHelper.characterName, 'Worldbook test')
    assert.equal(view.tavernHelper.playerName, '你')
    assert.deepEqual(view.tavernHelper.regexScripts.preset, [])
    assert.deepEqual(view.tavernHelper.worldbook, view.tavernHelperWorldbook)
    if (resourceSync === 1) {
      assert.equal(view.tavernHelper.worldbook.resourceAccess.kind, 'worldbook')
      assert.equal(Object.hasOwn(view.tavernHelper.worldbook, 'entries'), false, 'descriptor must not eagerly copy the book')
    } else assert.equal(view.tavernHelper.worldbook.entries[0].uid, 7)
  }
  console.log('helper worldbook full/deferred/cached RPC projections passed')
} finally { await host.dispose() }
