import assert from 'node:assert/strict'
import test from 'node:test'

import { ensureSessionVariableDirectory, sessionVariableDirectorySection, variableDirectoryOpen } from '../tavern-plugin/lib/domain/session-variable-directory.js'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'

function nativeSession(id = 's') {
  const events = []
  return { id, events, append(type, data) { const event = { seq: events.length, type, data }; events.push(event); return event } }
}
const mvuChat = statData => ({ mode: 'story', messages: [
  { role: 'assistant', greeting: true, swipeId: 0, variables: [{}] },
  { role: 'user', swipeId: 0, variables: [statData ? { stat_data: statData } : {}] }
] })

test('the variable directory freezes only before the first request: later stat_data never changes the system prompt', () => {
  const late = nativeSession()
  assert.equal(ensureSessionVariableDirectory(late, mvuChat(null)), null)
  late.append('request/header', { header: {} })
  // The opening variables arrive after the first reply was generated under a prompt without them.
  assert.equal(variableDirectoryOpen(late), false)
  assert.equal(ensureSessionVariableDirectory(late, mvuChat({ 特工: { 姓名: '' } })), null)
  assert.equal(sessionVariableDirectorySection(late), null)

  const early = nativeSession()
  assert.ok(ensureSessionVariableDirectory(early, mvuChat({ 特工: { 姓名: '' } })))
  assert.match(sessionVariableDirectorySection(early).text, /"\/特工\/姓名"/)
  assert.equal(variableDirectoryOpen(early), false)
})

test('the first system assembly waits for the MVU opening before it reads the chat; later ones do not wait', async () => {
  const hooks = new Map(), order = []
  const session = nativeSession()
  let saved = false
  registerTurnLifecycleHooks({
    ctx: { on: (name, callback) => hooks.set(name, callback), tools: { schemas: (_agent, toolSet) => toolSet?.schemas } },
    backgroundAgentRunner: { owns: () => false },
    // The card scripts save the opening variables while the first send waits.
    foregroundHandoff: { async awaitOpening(id) { assert.equal(id, 's'); order.push('awaitOpening'); saved = true } },
    hookChatForSession: async () => { order.push('readChat'); return mvuChat(saved ? { 特工: { 姓名: '' } } : null) },
    turnOrchestrator: { modeFor: async () => 'story' },
    ensureNativeSystemPrefix: async (agentSession, chat) => { ensureSessionVariableDirectory(agentSession, chat) },
    publishResourceWorkspace: async () => null, readChatCard: async () => ({}), runtimePrompt: () => '',
    foregroundStrategies: { assembleSystemPrompt: async (assembly, options) => ({ ...assembly, sections: options.fixedSystemSections }) },
    nativeWorldBookTemplateContext: async () => ({ prefixContext: '' })
  })
  const assemble = hooks.get('system-prompt/assemble')
  await assemble({}, { agent: { session } }, async () => ({ sections: [] }))
  assert.deepEqual(order, ['awaitOpening', 'readChat'])
  assert.ok(sessionVariableDirectorySection(session))
  session.append('request/header', { header: {} })
  order.length = 0
  await assemble({}, { agent: { session } }, async () => ({ sections: [] }))
  assert.deepEqual(order, ['readChat'])
})
