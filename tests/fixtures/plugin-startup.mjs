import assert from 'node:assert/strict'
import { createPluginHost } from './plugin-host.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { registerRunningUserPlugin } from '../../tavern-plugin/lib/domain/user-plugins.js'
import { resolveTavernDataRoot } from '../../tavern-plugin/lib/domain/tavern-data.js'

const root = resolveTavernDataRoot()
const card = { name: 'Stage test', first_mes: 'A quiet room.', extensions: {} }
await mkdir(root, { recursive: true })
await writeFile(join(root, 'stage-preferences.json'), JSON.stringify({ enabled: false }))
await writeFile(join(root, 'sessions.json'), JSON.stringify({ 'stage-session': 'stage-chat', 'active-stage-session': 'active-stage-chat' }))
await createChatJournalStore({ dataRoot: root }).update('stage-chat', () => ({
  id: 'stage-chat', _storageRevision: 1, sessionId: 'stage-session', mode: 'story', cardPath: 'cards/stage-test.json',
  backgroundConfigVersion: 1, conversationFeaturesVersion: 1, cardDefinitionSnapshot: card,
  timeline: { branchId: 'test-branch', revision: 0 },
  messages: [{ role: 'assistant', turn: 1, text: 'A quiet room.', sourceText: 'A quiet room.' }]
}))
// The fake callers below stand in for managed plugins: a Tavern guard registers each one as a trusted global
// identity (user-plugins.js guardSource). An unregistered caller is refused by the access check (plugin-api.js accessScope).
const releaseIdentities = ['mode-smoke', 'identity-test-plugin'].map(name => registerRunningUserPlugin(name, { folder: name, sha256: '', bound: false, origin: 'global', cardIds: [], runtimeName: name }))
const host = await createPluginHost({ withTools: true })
try {
  const stageRuntime = await host.rpc('getStageRuntimeStatus')
  assert.equal(stageRuntime.installed, true)
  assert.equal(stageRuntime.status, 'disabled', 'the installed stage is idle before a game needs it')
  // Every registered deployment reporter (voice, background tasks) answers without throwing; nothing is in flight yet.
  assert.deepEqual((await host.rpc('getDeploymentActivity')).work, { version: 1, busy: false, reasons: [] })
  const imported = await host.rpc('importCard', { payload: { name: 'stage-test.json', text: JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: card }) } })
  await createChatJournalStore({ dataRoot: root }).update('stage-chat', chat => ({ ...chat, _storageRevision: 2, cardPath: imported.card.path }))
  assert.equal(typeof host.services.get('tavernSessionSignals')?.control, 'function')
  assert.ok(host.events.has('system-prompt/assemble'), 'apply must reach final registrations')
  assert.equal(host.registeredTools.has('worldbook_search'), false, 'upstream native worldbook skills do not restore the retired search tool')
  for (const name of ['tavern_test_response', 'tavern_recall_history', 'tavern_user_profile_read',
    'tavern_read_skill', 'tavern_read_skill_reference', 'tavern_read_variables',
    'tavern_copy_card', 'tavern_set_card_cover', 'tavern_export_card_png', 'tavern_memory_search', 'tavern_validate_card', 'tavern_read_play_chat',
    'tavern_read_script', 'tavern_read_lorebook', 'tavern_update_preset', 'tavern_read_regex_library', 'tavern_restore_card',
    'submit_story', 'tavern_generate_body']) {
    assert.equal(typeof host.registeredTools.get(name)?.execute, 'function', name + ' registered')
  }
  const tavern = host.services.get('tavern')
  assert.equal(tavern?.apiVersion, 8, 'public plugin service provided')
  const plugin = Object.create(tavern)
  plugin.ctx = { fiber: { name: 'mode-smoke' } }
  const unregister = plugin.gameMode({ name: 'counter', version: 1,
    create: () => ({ state: { count: 0, secret: 'private' } }),
    advance: ({ state }) => ({ state: { ...state, count: state.count + 1 } }),
    project: ({ state }) => ({ count: state.count }) })
  const modeArgs = { sessionId: 'stage-session' }
  assert.equal((await host.rpc('gameMode', { ...modeArgs, op: 'list' })).modes[0].key, 'mode-smoke:counter')
  assert.deepEqual((await host.rpc('gameMode', { ...modeArgs, op: 'create', key: 'mode-smoke:counter' })).mode.data, { count: 0 })
  assert.equal((await host.rpc('gameMode', { ...modeArgs, op: 'advance', revision: 1 })).mode.data.count, 1)
  assert.equal((await host.rpc('gameMode', { ...modeArgs, op: 'seek', revision: 2, cursor: 0 })).mode.data.count, 0)
  unregister()
  assert.deepEqual((await host.rpc('pluginMediaTurns', { sessionId: 'missing-game' })).turns, [])
  assert.deepEqual((await host.rpc('pluginMediaForTurn', { sessionId: 'missing-game', turn: 1 })).items, [])
  host.services.get('sessions').set('stage-session', { id: 'stage-session', events: [] })
  assert.equal((await host.rpc('prepareCardStage', { path: imported.card.path })).stage, false)
  assert.equal((await host.rpc('getSession', modeArgs)).view.stage.stage, false)
  assert.equal((await host.rpc('getDialogueBubbles', modeArgs)).config.enabled, false)
  assert.equal(JSON.parse(await host.services.get('tavernSessionSignals').control('getDialogueBubbles', modeArgs)).config.enabled, false)
  assert.equal((await host.rpc('getStageRuntimeStatus')).status, 'disabled', 'an ordinary card stays in chat mode')

  const stageCard = { ...card, name: 'Stage enabled', extensions: { dsh_tavern: {
    schemaVersion: 1, assetBindings: { boundPackIds: [] }, stage: { enabled: true }
  } } }
  const stageImport = await host.rpc('importCard', { payload: { name: 'stage-enabled.json', text: JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: stageCard }) } })
  const journal = createChatJournalStore({ dataRoot: root })
  await journal.update('active-stage-chat', () => ({
    id: 'active-stage-chat', _storageRevision: 1, sessionId: 'active-stage-session', mode: 'story', cardPath: stageImport.card.path,
    backgroundConfigVersion: 1, conversationFeaturesVersion: 1, cardDefinitionSnapshot: stageCard,
    messages: [{ role: 'assistant', turn: 1, text: 'A quiet room.', sourceText: 'A quiet room.' }]
  }))
  host.services.get('sessions').set('active-stage-session', { id: 'active-stage-session', events: [] })
  const stageView = await host.rpc('getSession', { sessionId: 'active-stage-session' })
  assert.deepEqual(stageView.view.stage, { dialogue: true, stage: true, isStageCard: true })
  const stageBubbles = (await host.rpc('getDialogueBubbles', { sessionId: 'active-stage-session' })).config
  assert.equal(stageBubbles.enabled, true)
  assert.equal(stageBubbles.voice.enabled, true)
  assert.equal((await host.rpc('prepareCardStage', { path: stageImport.card.path })).stage, true)
  assert.equal((await host.rpc('getStageRuntimeStatus')).status, 'ready')
  for (const name of ['tavern_assets_read', 'tavern_assets_patch', 'tavern_media_upload', 'tavern_assets_transfer', 'tavern_stage_read', 'tavern_stage_patch', 'tavern_mods_read', 'tavern_mods_patch', 'tavern_voice_read', 'tavern_voice_patch', 'tavern_asset_generation']) {
    assert.equal(typeof host.registeredTools.get(name)?.execute, 'function', name + ' registered by the stage')
  }
  assert.equal((await host.rpc('getSession', modeArgs)).view.stage.stage, false)
  // Fork RPCs share the extracted dispatcher, including former switch fallthrough aliases.
  assert.deepEqual((await host.rpc('getAssetVoiceServices', {})).services, [])
  assert.equal(typeof (await host.rpc('getDeploymentActivity', {})).work.busy, 'boolean')
  assert.ok(await host.rpc('getJudgeConfig', {}))
  assert.equal((await host.rpc('getLive2dRuntime', {})).installed, false, 'the stage registers the Live2D runtime; a fresh data directory has none')
  assert.ok((await host.rpc('getTavernSettings', {})).settings)
  assert.deepEqual((await host.rpc('bodyGenerationProviders', {})).providers, [])
  assert.equal(typeof tavern.bodyGenerator, 'function')
  assert.deepEqual((await host.rpc('getFrameStorage', {})).values, {})
  assert.ok(await host.rpc('listCards', {}))
  const signalsAbort = new AbortController()
  const signals = host.services.get('tavernSessionSignals').follow(['stage-session'], signalsAbort.signal)
  const identityPlugin = Object.assign(Object.create(tavern), { ctx: { fiber: { name: 'identity-test-plugin' } } })
  try {
    await signals.next()
    assert.equal((await host.rpc('getSession', { sessionId: 'stage-session' })).view.playerName, '你')
    const nextSignal = signals.next()
    const timeout = setTimeout(() => signalsAbort.abort(), 5000)
    try {
      assert.equal(await identityPlugin.setPlayerName({ gameId: 'stage-session', playerName: '旅人' }), '旅人')
      let update = await nextSignal
      while (!update.done && !update.value.signal.version.startsWith('player-name:')) update = await signals.next()
      assert.equal(update.done, false, 'plugin writes must wake the session view without a restart')
      assert.equal(update.value.signal.kind, 'tavern-state')
      assert.ok(update.value.signal.version.startsWith('player-name:'))
      assert.equal((await host.rpc('getSession', { sessionId: 'stage-session' })).view.playerName, '旅人')
      assert.equal(await identityPlugin.getPlayerName({ gameId: 'stage-session' }), '旅人')
    } finally { clearTimeout(timeout) }
  } finally {
    signalsAbort.abort()
    await signals.return()
  }
  const bubbles = await host.rpc('getDialogueBubbles', { sessionId: 'stage-session' })
  assert.equal(bubbles.cardPath, imported.card.path)
  assert.ok(bubbles.config)
  const direction = await host.rpc('getStageDirection', { sessionId: 'stage-session', turn: 1, readOnly: true })
  assert.equal(typeof direction.status, 'string')
  const modRpc = (method, args) => host.rpc(method, args, { origin: 'http://localhost:3081' })
  const stageSlots = async () => (await host.rpc('getConversationBackgroundConfig', modeArgs)).modModelSlots
    .filter(slot => slot.modId === 'dsh.stage').map(slot => slot.id)
  async function setCardStage(enabled) {
    const path = imported.card.path
    const binding = await modRpc('getCardAssetBindings', { path })
    await modRpc('saveCardAssetBindings', { path, expectedRevision: binding.revision,
      patch: { assetBindings: binding.extension?.assetBindings || { boundPackIds: [] }, stage: { enabled } } })
  }
  assert.deepEqual(await stageSlots(), [])
  await setCardStage(true)
  assert.deepEqual(await stageSlots(), ['director', 'judge'])
  await setCardStage(false)
  assert.deepEqual(await stageSlots(), [])
  const mods = await modRpc('managedModsList', {})
  // the five first-party mods (dice, phone, redaction, textcard, timer)
  assert.equal(mods.mods.length, 5)
  assert.ok(mods.mods.every(mod => mod.switches.global === false && mod.switches.effective === false))
  const plan = await modRpc('managedModSwitchPlan', { revision: mods.revision, kind: 'mod', scope: 'global', id: 'dsh.dice', value: true })
  await modRpc('managedModApply', { token: plan.token, revision: plan.revision, answers: {} })
  const enabled = await modRpc('managedModsList', {})
  assert.deepEqual(enabled.mods.filter(mod => mod.switches.effective).map(mod => mod.id), ['dsh.dice'])
  console.log('plugin apply completed')
} finally { releaseIdentities.forEach(release => release()); await host.dispose() }
