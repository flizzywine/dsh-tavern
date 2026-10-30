import assert from 'node:assert/strict'
import { createPluginHost } from './plugin-host.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { resolveTavernDataRoot } from '../../tavern-plugin/lib/domain/tavern-data.js'

const root = resolveTavernDataRoot()
const card = { name: 'Stage test', first_mes: 'A quiet room.', extensions: {} }
await mkdir(root, { recursive: true })
await writeFile(join(root, 'sessions.json'), JSON.stringify({ 'stage-session': 'stage-chat' }))
await createChatJournalStore({ dataRoot: root }).update('stage-chat', () => ({
  id: 'stage-chat', _storageRevision: 1, sessionId: 'stage-session', mode: 'story', cardPath: 'cards/stage-test.json',
  backgroundConfigVersion: 1, conversationFeaturesVersion: 1, cardDefinitionSnapshot: card,
  timeline: { branchId: 'test-branch', revision: 0 },
  messages: [{ role: 'assistant', turn: 1, text: 'A quiet room.', sourceText: 'A quiet room.' }]
}))
const host = await createPluginHost({ withTools: true })
try {
  const imported = await host.rpc('importCard', { payload: { name: 'stage-test.json', text: JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: card }) } })
  await createChatJournalStore({ dataRoot: root }).update('stage-chat', chat => ({ ...chat, _storageRevision: 2, cardPath: imported.card.path }))
  assert.equal(typeof host.services.get('tavernSessionSignals')?.control, 'function')
  assert.ok(host.events.has('system-prompt/assemble'), 'apply must reach final registrations')
  assert.equal(host.registeredTools.has('worldbook_search'), false, 'upstream native worldbook skills do not restore the retired search tool')
  for (const name of ['tavern_test_response', 'tavern_recall_history', 'tavern_user_profile_read',
    'tavern_read_skill_reference', 'tavern_read_variables',
    'tavern_copy_card', 'tavern_set_card_cover', 'tavern_export_card_png', 'tavern_memory_search', 'tavern_validate_card', 'tavern_read_play_chat',
    'tavern_read_script', 'tavern_read_worldbook', 'tavern_update_preset', 'tavern_read_regex_library', 'tavern_restore_card',
    'submit_story']) {
    assert.equal(typeof host.registeredTools.get(name)?.execute, 'function', name + ' registered')
  }
  const tavern = host.services.get('tavern')
  assert.equal(tavern?.apiVersion, 6, 'public plugin service provided')
  assert.deepEqual((await host.rpc('pluginMediaTurns', { sessionId: 'missing-game' })).turns, [])
  assert.deepEqual((await host.rpc('pluginMediaForTurn', { sessionId: 'missing-game', turn: 1 })).items, [])
  assert.ok((await host.rpc('getTavernSettings', {})).settings)
  assert.deepEqual((await host.rpc('getFrameStorage', {})).values, {})
  assert.ok(await host.rpc('listCards', {}))
  host.services.get('sessions').set('stage-session', { id: 'stage-session', events: [] })
  const bubbles = await host.rpc('getDialogueBubbles', { sessionId: 'stage-session' })
  assert.equal(bubbles.cardPath, imported.card.path)
  assert.ok(bubbles.config)
  const direction = await host.rpc('getStageDirection', { sessionId: 'stage-session', turn: 1, readOnly: true })
  assert.equal(typeof direction.status, 'string')
  const modRpc = (method, args) => host.rpc(method, args, { origin: 'http://localhost:3081' })
  const mods = await modRpc('managedModsList', {})
  assert.equal(mods.mods.length, 5)
  assert.ok(mods.mods.every(mod => mod.switches.global === false && mod.switches.effective === false))
  const plan = await modRpc('managedModSwitchPlan', { revision: mods.revision, kind: 'mod', scope: 'global', id: 'dsh.dice', value: true })
  await modRpc('managedModApply', { token: plan.token, revision: plan.revision, answers: {} })
  const enabled = await modRpc('managedModsList', {})
  assert.deepEqual(enabled.mods.filter(mod => mod.switches.effective).map(mod => mod.id), ['dsh.dice'])
  console.log('plugin apply completed')
} finally { await host.dispose() }
