import assert from 'node:assert/strict'
import { createPluginHost } from './plugin-host.mjs'
import { createProfileDataStore } from '../../tavern-plugin/lib/profile-data-store.js'
import { createSceneWorldbooks, bindSceneWorldbook } from '../../tavern-plugin/lib/domain/scene-worldbook.js'
import { computeSceneTarget } from '../../tavern-plugin/lib/domain/scene-illustration.js'
import { sceneSlotKey } from '../../tavern-plugin/lib/domain/scene-slots.js'
import { buildGameSave, readGameSave } from '../../tavern-plugin/lib/domain/game-save.js'

const host = await createPluginHost()
try {
  // Stub only the host's native session service; Tavern RPC and disk storage stay real.
  const sessions = new Map()
  host.services.get('sessions').flush = async () => {}
  host.services.get('agents').create = async ({ sessionId, seed, meta }) => {
    const session = { header: { id: sessionId, cwd: meta.cwd }, inheritedEventCount: seed.length, events: seed }
    sessions.set(sessionId, session)
    return { agent: { session }, dispose: async () => {} }
  }
  host.services.set('sessionPersistence', {
    open: async id => ({ ...sessions.get(id), read: async () => ({ events: sessions.get(id).events }), close: async () => {} })
  })
  const dataRoot = process.env.DSH_HOME + '/profile-data/tavern/data'
  const store = createProfileDataStore({ dataRoot }), books = createSceneWorldbooks({ store })
  const book = text => ({ view: { entries: [{ content: text, ref: 'entry:0' }] } })
  const opening = await books.capture({ worldBook: book('opening'), chat: { id: 'source' }, turn: 0 })
  const later = await books.capture({ worldBook: book('later'), chat: { id: 'source' }, turn: 1 })
  const chat = {
    id: 'source', sessionId: 'source-session', mode: 'story', cardPath: 'cards/hero.json', cardName: 'Hero',
    messages: [bindSceneWorldbook({ role: 'assistant', turn: 1, text: 'Hello' }, later)],
    sceneOpeningWorldbook: opening, timeline: { checkpoints: [] }
  }
  const base = computeSceneTarget(chat, 1).key
  const data = buildGameSave({
    chat, revisions: [], tavernVersion: '2.7.0',
    session: { header: { id: chat.sessionId }, events: [{ seq: 0, type: 'turn/end', data: { turn: 1 } }] },
    card: { payload: { kind: 'text', name: 'hero.json', text: '{"name":"Hero"}' } },
    scene: {
      attachments: [], worldbooks: await books.exportForSave([chat]),
      files: [0, 1, 5].map(slot => ({
        path: sceneSlotKey(base, slot) + '.json', content: JSON.stringify({ key: sceneSlotKey(base, slot), versions: [] })
      }))
    }
  })
  const imported = await host.rpc('importGameSave', { fileB64: data.toString('base64') })
  const exported = await host.rpc('exportGameSave', { sessionId: imported.sessionId })
  const saved = readGameSave(Buffer.from(exported.base64, 'base64'))
  const newBase = computeSceneTarget(saved.chat, 1).key
  for (const slot of [0, 1, 5]) assert.ok(saved.scene.files.some(file => file.path === sceneSlotKey(newBase, slot) + '.json'))
  assert.equal(saved.scene.worldbooks.length, 2)
  await books.forgetChat('source')
  assert.ok((await books.read(opening)).entries)
  assert.ok((await books.read(later)).entries)

  await host.rpc('importSource', { payload: { name: 'same.txt', text: 'OLD' } })
  const script = await host.rpc('importScript', { cardPath: imported.cardPath, payload: { name: 'same.txt', text: 'NEW STORY' } })
  assert.equal(script.script.sourceChars, 9)

  let nativeReads = 0
  const persistence = host.services.get('sessionPersistence'), open = persistence.open
  persistence.open = async id => {
    const handle = await open(id)
    return { ...handle, read: async () => {
      if (++nativeReads === 2) sessions.get(id).events.push({ seq: 1, type: 'turn/end', data: { turn: 2 } })
      return handle.read()
    } }
  }
  await assert.rejects(host.rpc('exportGameSave', { sessionId: imported.sessionId }), /导出期间游戏发生变化/)
  console.log('real RPC roundtrip passed')
} finally { await host.dispose() }
