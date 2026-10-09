import assert from 'node:assert/strict'
import { createPluginHost } from './plugin-host.mjs'

const host = await createPluginHost({ withTools: true })
try {
  assert.equal(typeof host.services.get('tavernSessionSignals')?.control, 'function')
  assert.ok(host.events.has('system-prompt/assemble'), 'apply must reach final registrations')
  for (const name of ['tavern_test_response', 'worldbook_search', 'tavern_user_profile_read',
    'tavern_read_skill_reference', 'tavern_read_variables',
    'tavern_copy_card', 'tavern_memory_search', 'tavern_validate_card', 'tavern_read_play_chat',
    'tavern_read_script', 'tavern_read_worldbook', 'tavern_update_preset', 'tavern_read_regex_library', 'tavern_restore_card']) {
    assert.equal(typeof host.registeredTools.get(name)?.execute, 'function', name + ' registered')
  }
  const tavern = host.services.get('tavern')
  assert.equal(tavern?.apiVersion, 2, 'public plugin service provided')
  assert.deepEqual((await host.rpc('pluginMediaTurns', { sessionId: 'missing-game' })).turns, [])
  assert.deepEqual((await host.rpc('pluginMediaForTurn', { sessionId: 'missing-game', turn: 1 })).items, [])
  console.log('plugin apply completed')
} finally { await host.dispose() }
