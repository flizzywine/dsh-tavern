import test from 'node:test'
import assert from 'node:assert/strict'
import { virtualWorldbookRestoreRefs, withVirtualWorldbook, withWorldbookFileInstructions } from '../tavern-plugin/lib/domain/worldbook-virtual-surface.js'

const state = () => ({ schemaVersion: 1, scope: '["game","card"]', entries: {
  first: { text: '晴天', renderHash: 'sun' }, second: { text: '港口开放', renderHash: 'port' }
} })
function message(ref, text, hash, scope = state().scope) {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin:dsh-tavern', virtualWorldbook: { scope, entries: { [ref]: hash } } } }
}
function session(messages) {
  return { events: messages.map((data, seq) => ({ seq, type: 'user/message', data })), surface: { nodes: messages.map((_, i) => i) } }
}

test('主动查阅提示只用于有检索工具的前台续写', () => {
  const instruction = sections => sections.find(section => section.name === 'tavern:worldbook-skills')?.text
  assert.match(instruction(withVirtualWorldbook([], '')), /优先用 read_lorebook.*续写前先判断/)
  assert.match(instruction(withVirtualWorldbook([], '')), /grep_lorebook.*list_lorebook/)
  assert.match(instruction(withVirtualWorldbook([], '', ['worldbook_grep'])), /玩家没提条目名/)
  assert.match(instruction(withVirtualWorldbook([], '', ['worldbook_grep', 'worldbook_list'])), /read_lorebook/)
  assert.equal(instruction(withVirtualWorldbook([], '', ['read_lorebook', 'worldbook_grep', 'worldbook_list'])), undefined)
  assert.equal(instruction(withVirtualWorldbook([], '', ['read_lorebook', 'grep_lorebook', 'list_lorebook'])), undefined)
  assert.match(instruction(withVirtualWorldbook([], '')), /需要正文时用 read_lorebook 按标题读取/)
  assert.doesNotMatch(instruction(withVirtualWorldbook([], '', ['read_lorebook'])), /\bread\b|行号|路径/)
  assert.doesNotMatch(instruction(withWorldbookFileInstructions([])), /续写前先判断/)
})

test('system assembly excludes dynamic recovery and stays byte-identical across dynamic updates', async () => {
  const { registerTurnLifecycleHooks } = await import('../tavern-plugin/lib/hooks/turn-lifecycle.js')
  const hooks = new Map(), calls = [], assembledInputs = []
  const nativeSession = { id: 'game', ...session([message('first', '晴天', 'sun')]) }
  const chat = { mode: 'story', worldbookStrategy: 'native-skills', worldBookVirtualState: state(), messages: [] }
  let background = false
  registerTurnLifecycleHooks({
    ctx: { on: (name, callback) => hooks.set(name, callback), tools: { schemas: (_agent, toolSet) => toolSet?.schemas } },
    backgroundAgentRunner: { owns: () => background }, hookChatForSession: async () => chat, foregroundHandoff: { awaitOpening: async () => {} },
    sessionStore: { flush: async () => assert.fail('assembly must not append restored snapshots to history') },
    turnOrchestrator: { modeFor: async () => 'story' }, ensureNativeSystemPrefix: async () => {},
    publishResourceWorkspace: async () => null, readChatCard: async () => ({}), runtimePrompt: () => '',
    foregroundStrategies: { assembleSystemPrompt: async (assembly, options) => { assembledInputs.push(options); return { ...assembly, sections: options.fixedSystemSections } } },
    nativeWorldBookTemplateContext: async (_chat, _card, options) => {
      calls.push(options)
      return { prefixContext: '  STATIC EXACT\n\n' }
    }
  })
  const initial = structuredClone(nativeSession)
  const assemble = hooks.get('system-prompt/assemble')
  const result = await assemble({}, { agent: { session: nativeSession } }, async () => ({ sections: [] }))
  assert.deepEqual(calls[0], { restore: false })
  assert.match(result.sections[0].text, /  STATIC EXACT\n\n/)
  assert.deepEqual(nativeSession, initial)
  chat.worldBookVirtualState.entries.second = { text: '港口关闭', renderHash: 'closed' }
  const changed = await assemble({}, { agent: { session: nativeSession } }, async () => ({ sections: [] }))
  assert.deepEqual(changed.sections, result.sections, 'dynamic state cannot rewrite the provider system prefix')
  assert.deepEqual(calls[1], { restore: false }, 'dynamic recovery never enters the system prefix')
  const schemas = [{ name: 'submit_story' }]
  await assemble({}, { agent: { session: nativeSession }, toolSet: { schemas } }, async () => ({ sections: [] }))
  assert.equal(assembledInputs.at(-1).toolDefinitions, schemas, 'hook forwards the actual host toolSet schemas')
  assert.equal(assembledInputs[0].toolDefinitions, undefined, 'legacy fixture has no separate toolSet')
  background = true
  await assemble({}, { agent: { session: nativeSession } }, async () => ({ sections: [] }))
  assert.equal(calls.length, 3)
})

test('missing dynamic context restores at the message tail and retries use pending evidence', async () => {
  const { appendWorldbookRecovery } = await import('../tavern-plugin/lib/hooks/request.js')
  const current = state(), native = session([])
  const chat = { worldbookStrategy: 'native-skills', worldBookVirtualState: current }
  const input = { role: 'user', content: [{ type: 'text', text: '继续' }] }
  const decision = { kind: 'enter', messages: [input] }
  const before = JSON.stringify(native)
  const project = async (_chat, options) => {
    assert.deepEqual(options.restoreRefs, ['first', 'second'])
    return { snapshots: '晴天\n\n港口开放' }
  }
  const payload = { agent: { session: native } }
  const result = await appendWorldbookRecovery({ chat, payload, decision, project })
  assert.equal(JSON.stringify(native), before)
  assert.equal(result.messages[0], input)
  assert.equal(result.messages[1].source.form, 'worldbook-recovery')
  assert.match(result.messages[1].content[0].text, /港口开放/)
  assert.equal(await appendWorldbookRecovery({ chat, payload, decision: result, project: () => assert.fail('already pending') }), result)
  const persisted = session(result.messages)
  assert.deepEqual(virtualWorldbookRestoreRefs(persisted, current), [])
  persisted.surface.nodes = [0]
  assert.deepEqual(virtualWorldbookRestoreRefs(persisted, current), ['first', 'second'])
})
