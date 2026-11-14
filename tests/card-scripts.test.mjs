import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCardScripts } from '../tavern-plugin/lib/card-scripts.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { projectTavernHelperScripts } from '../tavern-plugin/lib/domain/tavern-helper-scripts.js'
import { inspectCardExtensions, withGlobalRegexScripts } from '../tavern-plugin/lib/domain/card-extension-reading.js'
import { withModHidden } from '../tavern-plugin/lib/mod-tools.js'
import { createSessionViewReader } from '../tavern-plugin/lib/domain/session-view-reader.js'
import { createCardHandlers } from '../tavern-plugin/lib/rpc/cards.js'

const bgm = { id: 'bgm', name: 'BGM', type: 'script', enabled: true, content: 'new Audio("song.mp3").play()' }
const utility = { id: 'utility', name: 'Utility', type: 'script', content: 'console.log("ready")' }
const disabled = { id: 'disabled', type: 'script', enabled: false, content: '<audio src="sound.mp3">' }
const cardPath = 'cards/a.json'
const key = 'card-scripts/card-a.json'

const cardIdFor = async value => value === cardPath || value === 'cards/renamed.json' ? 'card-a' : 'card-b'
async function fixture(t) {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'fork-card-scripts-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  const profileData = createProfileDataStore({ dataRoot })
  return { profileData, store: createCardScripts({ profileData, cardIdFor }) }
}

test('atomic setMuted round trip is card-ID scoped, concurrent-safe, validated and bounded', async t => {
  const { store, profileData } = await fixture(t)
  await Promise.all([store.setMuted(cardPath, ' bgm ', true), store.setMuted(cardPath, 'utility', true)])
  // Concurrent additions guarantee membership, not insertion order.
  assert.deepEqual((await store.muted('cards/renamed.json')).sort(), ['bgm', 'utility'].sort())
  assert.deepEqual(await store.muted('cards/b.json'), [])
  const persisted = await profileData.readJson(key)
  assert.deepEqual({ ...persisted, muted: persisted.muted.sort() }, { version: 1, muted: ['bgm', 'utility'].sort() })
  await store.setMuted(cardPath, 'bgm', false)
  const reopened = createCardScripts({ profileData, cardIdFor })
  assert.deepEqual(await reopened.muted(cardPath), ['utility'])
  await assert.rejects(store.setMuted(cardPath, '', true), /Invalid script ID/)
  await assert.rejects(store.setMuted(cardPath, 'x'.repeat(65), true), /Invalid script ID/)
  await assert.rejects(store.setMuted(cardPath, 'bgm', 'false'), /boolean/)
  await profileData.writeJson(key, { muted: Array.from({ length: 50 }, (_, i) => `script-${i}`) })
  await assert.rejects(store.setMuted(cardPath, 'extra', true), /50 scripts/)
  await store.setMuted(cardPath, 'script-0', true)
  await store.setMuted(cardPath, 'script-0', false)
  await store.setMuted(cardPath, 'extra', true)
  assert.equal((await store.muted(cardPath)).length, 50)
  const invalid = createCardScripts({ profileData, cardIdFor: async () => '../escape' })
  await assert.rejects(invalid.muted(cardPath), /Invalid cardId/)
})

test('host RPCs use unfiltered snapshot, reject unknown IDs, and toggles invalidate the view cache', async t => {
  const { store: cardScripts, profileData } = await fixture(t)
  const host = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  await profileData.writeJson(key, {version:1, muted:['bgm']})
  const readerSource = host.slice(host.indexOf('  async function readCardExtensionSources('), host.indexOf('  function presetRegexScripts('))
  const snapshot = { spec: 'chara_card_v3', data: { extensions: { tavern_helper: { scripts: [bgm, utility, disabled, { ...utility, id: 'legacy-disabled', disabled: true }] } } } }
  const chat = { cardPath, cardName: 'Test card', cardDefinitionSnapshot: snapshot }
  const before = structuredClone(chat)
  let liveReads = 0
  const readCardExtensions = new Function('readCardWorkspace', 'cardPreparation', 'withGlobalRegexScripts', 'withModHidden', 'tavernExtensionSettings', 'cardScripts', `${readerSource}; return readCardExtensions`)(
    async () => { liveReads++; return { spec: 'chara_card_v3', data: { extensions: { tavern_helper: { scripts: [bgm] } } } } },
    { present: ({ card, as }) => { assert.equal(as, 'card-extensions'); return inspectCardExtensions(card) } },
    withGlobalRegexScripts, withModHidden, { read: async () => ({}) }, cardScripts)
  assert.deepEqual(projectTavernHelperScripts((await readCardExtensions(cardPath, chat)).helperScripts).scripts.map(script => script.id), ['utility'])
  // The production RPC handler; index.js routes getCardScripts to the same method.
  const handlers = createCardHandlers({ chatForSession: async id => id === 'session' ? chat : undefined, readCardExtensions, cardScripts, resolveCardId: cardIdFor, str: value => typeof value === 'string' ? value : '' })
  const rpc = (method, args) => handlers.setCardScriptMuted(args, method)
  assert.match(host, /rpcHandlers\.getCardScripts = rpcHandlers\.setCardScriptMuted/)
  const response = await rpc('getCardScripts', { sessionId: 'session' })
  assert.deepEqual(response, { cardName: 'Test card', cardId: 'card-a', ...await cardScripts.list(inspectCardExtensions(snapshot).helperScripts, cardPath) })
  assert.equal(response.scripts.length, 4)
  assert.equal(response.scripts[0].muted, true)
  assert.equal(response.scripts[3].enabled, false)
  assert.equal(response.scripts.some(script => 'content' in script), false)
  assert.equal(liveReads, 0, 'snapshot takes precedence over live card')
  await assert.rejects(rpc('getCardScripts', { sessionId: 'missing' }))
  await assert.rejects(rpc('setCardScriptMuted', { sessionId: 'session', id: 'unknown', muted: true }), /Unknown card script ID/)
  await assert.rejects(rpc('setCardScriptMuted', { sessionId: 'session', id: 'bgm', muted: 'false' }), /boolean/)
  const versionSource = host.slice(host.indexOf('    resourceVersion: async chat => {'), host.indexOf('    readChanges: chatPersistence.readChangedIndices,'))
  const resourceVersion = new Function('fileResources', 'profileData', 'cardScripts', 'stageRuntime', `return ({ ${versionSource} }).resourceVersion`)(
    { worldBookBindingForCard: async () => ({}) }, profileData, cardScripts, { status: () => 'ready' })
  const originalVersion = await resourceVersion(chat)
  let fullReads = 0
  const views = createSessionViewReader({
    readState: async () => chat, readChat: async () => chat, resourceVersion,
    project: { cached: async (_, view) => view, full: async () => { fullReads++; return { tavernHelperScripts: projectTavernHelperScripts((await readCardExtensions(cardPath, chat)).helperScripts).scripts } } },
    activity: () => ({}), trace: { stage: async (_, run) => run(), state() {} }, foregroundRunning: () => false
  })
  assert.deepEqual((await views.read('session')).tavernHelperScripts.map(script => script.id), ['utility'])
  await views.read('session')
  assert.equal(fullReads, 1)
  const toggled = await rpc('setCardScriptMuted', { sessionId: 'session', id: 'bgm', muted: false })
  assert.equal(toggled.scripts[0].muted, false)
  assert.notEqual(await resourceVersion(chat), originalVersion)
  assert.deepEqual((await views.read('session')).tavernHelperScripts.map(script => script.id), ['bgm', 'utility'])
  assert.equal(fullReads, 2, 'preference-only change forces full projection without changing chat revision')
  await rpc('setCardScriptMuted', { sessionId: 'session', id: 'bgm', muted: true })
  assert.deepEqual((await views.read('session')).tavernHelperScripts.map(script => script.id), ['utility'])
  assert.deepEqual(projectTavernHelperScripts((await readCardExtensions(cardPath)).helperScripts).scripts, [], 'opening previews honor mutes')
  assert.equal(liveReads, 1)
  assert.deepEqual(chat, before)
  assert.match(host, /hasScripts: async function \(chat\) \{ return hasTavernScriptRuntime\(chat, \(await readCardExtensions\(chat.cardPath, chat\)\)/)
  assert.match(host, /requiresBrowser: async chat => hasTavernScriptRuntime\(chat, \(await readCardExtensions\(chat.cardPath, chat\)\)/)
  const projection = await readFile(new URL('../tavern-plugin/lib/domain/session-view-projection.js', import.meta.url), 'utf8')
  assert.match(projection, /readCardExtensions\(chat.cardPath, chat, settings\)/)
  assert.match(projection, /hasTavernScriptRuntime\(chat, cardExtensions.helperScripts\)/)
})
