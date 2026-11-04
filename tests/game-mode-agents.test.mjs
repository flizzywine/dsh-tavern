import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGameModeAgents } from '../tavern-plugin/lib/domain/game-mode-agents.js'
import { createPluginData } from '../tavern-plugin/lib/domain/plugin-data.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { registerPluginMember } from '../tavern-plugin/lib/domain/background-members.js'
import { createBackgroundNativeRuntime } from './fixtures/background-native-runtime.mjs'

test('fixed game actors reuse native children across restart and never read discarded future context', async t => {
  const root = await mkdtemp(join(tmpdir(), 'game-actors-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const data = createPluginData({ store: createProfileDataStore({ dataRoot: root }) })
  for (const name of ['npc-a', 'npc-b']) t.after(registerPluginMember({ owner: 'actor-test', name, title: name }))
  const native = await createBackgroundNativeRuntime(process.env.DSH_BOOT_MODULE, { modelResponse: () => [{ type: 'text', text: 'PRIVATE_FUTURE_RESULT' }] })
  t.after(() => native.dispose())
  const agent = createGameModeAgents({ data, resolveGame: async () => ({ chatId: 'test-chat' }), runTask: input => native.runBackground({
    ...input, sessionId: input.gameId, task: 'plugin', persistent: Boolean(input.member),
    selection: { provider: 'scene-fixture', model: 'fixture-text' }, ownPrefix: true,
    taskText: input.prompt, messages: [],
  }) })
  const call = (member, prompt) => agent({ owner: 'actor-test', gameId: 'scene-parent', id: member, member, system: 'Your assigned role only.', prompt })
  const first = await call('npc-a', 'FUTURE_SECRET')
  const other = await call('npc-b', 'OTHER_ROLE_SECRET')
  assert.equal(native.traceEvents(first.traceSessionId).find(e => e.type === 'turn/start').data.turn, 1)
  assert.notEqual(first.traceSessionId, other.traceSessionId)
  await native.restart()
  const repeated = await call('npc-a', 'REWOUND_PUBLIC_CONTEXT')
  assert.equal(repeated.traceSessionId, first.traceSessionId)
  const last = native.requests.at(-1)
  const text = JSON.stringify(last.messages)
  assert.match(text, /REWOUND_PUBLIC_CONTEXT/)
  assert.doesNotMatch(text, /FUTURE_SECRET|PRIVATE_FUTURE_RESULT|OTHER_ROLE_SECRET/)
  assert.equal((last.tools || []).length, 0)
  assert.equal((await native.backgroundChildren()).length, 2)
  assert.equal(await data.readModeAgent('test-chat', 'different-parent', 'plugin:actor-test:npc-a'), '', 'fork/import cannot borrow a child from another parent')
})
