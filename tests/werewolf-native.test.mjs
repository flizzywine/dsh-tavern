import test from 'node:test'
import assert from 'node:assert/strict'
import { createBackgroundNativeRuntime } from './fixtures/background-native-runtime.mjs'
import { createState, actionFor, gameMode } from '../examples/werewolf/plugin/rules.mjs'

test('six-seat game runs real DSH child agents with explicit context and no inherited tools', { timeout: 60000 }, async t => {
  const runtime = await createBackgroundNativeRuntime(process.env.DSH_BOOT_MODULE, {
    modelResponse: input => {
      const text = input.messages.filter(m => m.role === 'user').flatMap(m => m.content || []).filter(b => b.type === 'text').map(b => b.text).find(text => text.startsWith('{') || text.startsWith('['))
      let data
      try { data = JSON.parse(text) } catch { throw new Error('Expected isolated JSON prompt, received: ' + text) }
      const output = Array.isArray(data) ? '请继续下一阶段。' : JSON.stringify(data.action.kind === 'speak' ? { text: '请根据公开投票判断。' } : { target: data.action.targets[0] })
      return [{ type: 'text', text: output }]
    },
  })
  t.after(() => runtime.dispose())
  const s = createState({ seat: 6 })
  s.players.forEach((p, i) => { p.role = ['wolf', 'wolf', 'seer', 'villager', 'villager', 'villager'][i] })
  s.queue = [1, 2]
  const agent = ({ id, system, prompt }) => runtime.runBackground({ task: 'plugin', pluginName: 'werewolf/' + id,
    sessionId: 'scene-parent', selection: { provider: 'scene-fixture', model: 'fixture-text' },
    ownPrefix: true, system, taskText: prompt, messages: [], tools: [], persistent: false })
  for (let n = 0; n < 100 && !s.winner; n++) {
    const action = actionFor(s)
    await gameMode.advance({ state: s, agent, input: action.actor === 6 && action.kind !== 'confirm' ? action.kind === 'speak' ? { text: '我的发言。' } : { target: action.targets[0] } : null })
  }
  assert.ok(s.winner)
  assert.ok(runtime.requests.length > 5)
  for (const request of runtime.requests) assert.equal((request.tools || []).length, 0, 'no worldbook, file or history tools')
  assert.ok((await runtime.backgroundChildren()).length > 0)
  console.log('Native game completed:', s.winner, 'requests:', runtime.requests.length)
})
