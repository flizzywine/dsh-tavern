import test from 'node:test'
import assert from 'node:assert/strict'
import { virtualWorldbookRestoreRefs, withVirtualWorldbook } from '../tavern-plugin/lib/domain/worldbook-virtual-surface.js'
import { createForegroundFrameSessionAdapter } from '../tavern-plugin/lib/domain/foreground-frame-session-adapter.js'

const state = () => ({ schemaVersion: 1, scope: '["game","card"]', entries: {
  first: { text: '晴天', renderHash: 'sun' }, second: { text: '港口开放', renderHash: 'port' }
} })
function message(ref, text, hash, scope = state().scope) {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin:dsh-tavern', virtualWorldbook: { scope, entries: { [ref]: hash } } } }
}
function session(messages) {
  return { events: messages.map((data, seq) => ({ seq, type: 'user/message', data })), surface: { nodes: messages.map((_, i) => i) } }
}
test('native request prefix preserves original whitespace without modifying persisted sections', () => {
  const fixed = [{ name: 'tavern:constant-worldbook', text: 'stale' }, { name: 'card', text: 'card' }]
  const result = withVirtualWorldbook(fixed, '  exact\n\n')
  assert.equal(result[0].text, '【常驻世界书】\n  exact\n\n')
  assert.equal(result[1], fixed[1])
  assert.equal(fixed[0].text, 'stale')
})

test('前台工具关掉世界书检索后，提示不再教模型调用不存在的工具', () => {
  const sectionOf = sections => sections.find(section => section.name === 'tavern:worldbook-skills')
  const full = withVirtualWorldbook([], 'ctx')
  assert.match(sectionOf(full).text, /worldbook_grep/)
  assert.match(sectionOf(full).text, /再用 read 按返回的绝对路径和行号读取上下文/)
  assert.match(sectionOf(full).text, /worldbook_list/)
  assert.match(sectionOf(full).text, /片段截断时读取全文/)

  const bothOff = withVirtualWorldbook([], 'ctx', ['worldbook_list', 'worldbook_grep'])
  assert.equal(sectionOf(bothOff), undefined, '两个检索工具都关掉时整段指令消失')
  assert.equal(bothOff[0].text, '【常驻世界书】\nctx', '常驻世界书正文不受工具开关影响')

  const grepOnly = withVirtualWorldbook([], '', ['worldbook_list'])
  assert.match(sectionOf(grepOnly).text, /worldbook_grep/)
  assert.doesNotMatch(sectionOf(grepOnly).text, /worldbook_list/)

  const listOnly = withVirtualWorldbook([], '', ['worldbook_grep'])
  assert.match(sectionOf(listOnly).text, /worldbook_list/)
  assert.doesNotMatch(sectionOf(listOnly).text, /worldbook_grep/)

  const noRead = withVirtualWorldbook([], '', ['read'])
  assert.doesNotMatch(sectionOf(noRead).text, /\bread\b/, 'read 关掉后不再要求按路径读取')
  assert.match(sectionOf(noRead).text, /worldbook_grep/)
  assert.match(sectionOf(noRead).text, /不能读取文件正文/)
})

test('system assembly excludes dynamic recovery and stays byte-identical across dynamic updates', async () => {
  const { registerTurnLifecycleHooks } = await import('../tavern-plugin/lib/hooks/turn-lifecycle.js')
  const hooks = new Map(), calls = []
  const nativeSession = { id: 'game', ...session([message('first', '晴天', 'sun')]) }
  const chat = { mode: 'story', worldbookStrategy: 'native-skills', worldBookVirtualState: state(), messages: [] }
  let background = false
  registerTurnLifecycleHooks({
    ctx: { on: (name, callback) => hooks.set(name, callback) },
    backgroundAgentRunner: { owns: () => background }, hookChatForSession: async () => chat,
    sessionStore: { flush: async () => assert.fail('assembly must not append restored snapshots to history') },
    turnOrchestrator: { modeFor: async () => 'story' }, ensureNativeSystemPrefix: async () => {},
    publishResourceWorkspace: async () => null, readChatCard: async () => ({}), runtimePrompt: () => '',
    foregroundStrategies: { assembleSystemPrompt: async (assembly, options) => ({ ...assembly, sections: options.fixedSystemSections }) },
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
  background = true
  await assemble({}, { agent: { session: nativeSession } }, async () => ({ sections: [] }))
  assert.equal(calls.length, 2)
})

test('small entry edits append deltas while preserving base messages and restoration evidence', () => {
  const adapter = createForegroundFrameSessionAdapter({ id: () => crypto.randomUUID() })
  const scope = 'test-card', messages = []
  const body = value => '# 通用规则\n' + '不变的世界规则。\n'.repeat(100) + '\n关系：' + value + '\n结尾规则。'
  const append = value => {
    const text = body(value), frame = { kind: 'foreground', frameId: 'frame-' + value, contributions: [{ slot: 'activeWorldbook', text }], source: { worldBook: { virtualWorldbook: { scope, entries: { a: value }, texts: { a: text } } } } }
    const before = JSON.stringify(messages)
    const result = adapter.append({ frame, step: 1, messages: [], session: session(messages) }).messages
    assert.equal(JSON.stringify(messages), before, 'never mutate historical cache prefix')
    messages.push(...result)
    return result[0].content[0].text
  }
  assert.match(append('19'), /不变的世界规则/)
  const delta = append('22')
  assert.match(delta, /旧段落：\n关系：19\n新段落：\n关系：22/)
  assert.doesNotMatch(delta, /不变的世界规则/)
  append('25')
  const current = { schemaVersion: 1, scope, entries: { a: { text: body('25'), renderHash: '25' } } }
  assert.deepEqual(virtualWorldbookRestoreRefs(session(messages), current), [])
  assert.deepEqual(virtualWorldbookRestoreRefs(session(messages.slice(1)), current), ['a'], 'missing base restores full body')
  assert.deepEqual(virtualWorldbookRestoreRefs(session([messages[0], messages[2]]), current), ['a'], 'missing intermediate update restores full body')
  messages.splice(1)
  assert.match(append('26'), /关系：19/, 'rewind uses live base, not future state')
})

test('fixed platform rules persist once while current state and card tail instructions remain per turn', () => {
  const adapter = createForegroundFrameSessionAdapter({ id: () => crypto.randomUUID() })
  const frame = id => ({ kind: 'foreground', frameId: id, contributions: [
    { slot: 'writingRules', text: '固定写作原则', source: { stage: 'context-plan', sectionKind: 'base' } },
    { slot: 'currentStateProjection', text: '当前现场' },
    { slot: 'writingRules', text: '卡片尾部指令', source: { stage: 'context-plan', sectionKind: 'card-instruction' } }
  ] })
  const first = adapter.append({ frame: frame('one'), step: 1, messages: [] }).messages
  const second = adapter.append({ frame: frame('two'), step: 1, messages: [], session: session(first) }).messages
  const text = JSON.stringify(second.map(m => m.content))
  assert.doesNotMatch(text, /固定写作原则/)
  assert.match(text, /当前现场/)
  assert.match(text, /卡片尾部指令/)
  const restored = adapter.append({ frame: frame('three'), step: 1, messages: [], session: session(first.slice(1)) }).messages
  assert.match(JSON.stringify(restored.map(m => m.content)), /固定写作原则/)
})

test('delta falls back for ambiguous edits, insertions and markup; isolated cards never borrow a base', async () => {
  const { worldbookContextDelta } = await import('../tavern-plugin/lib/domain/worldbook-context-delta.js')
  const base = '# 规则\n' + '稳定内容\n'.repeat(100) + '重复行\n重复行\n<state>旧</state>'
  const marker = { scope: 'one', texts: { a: base } }
  const first = worldbookContextDelta(null, marker, base)
  const history = [{ content: [{ type: 'text', text: first.text }], source: { kind: 'plugin:dsh-tavern', virtualWorldbook: marker, worldbookEntrySnapshots: first.records } }]
  for (const next of [base.replace('重复行', '新行'), base + '\n新增', base.replace('<state>旧</state>', '<state>新</state>')]) {
    assert.equal(worldbookContextDelta(null, { scope: 'one', texts: { a: next } }, next, history).text, next)
  }
  const next = base.replace('# 规则', '# 新规则')
  assert.equal(worldbookContextDelta(null, { scope: 'other', texts: { a: next } }, next, history).text, next)
})

test('fixed rule changes append a replacement and retries preserve existing messages byte for byte', () => {
  const adapter = createForegroundFrameSessionAdapter({ id: () => crypto.randomUUID() })
  const frame = (id, text) => ({ kind: 'foreground', frameId: id, contributions: [{ slot: 'writingRules', text, source: { stage: 'context-plan', sectionKind: 'base' } }] })
  const one = adapter.append({ frame: frame('one', '旧原则'), step: 1, messages: [] }).messages
  const before = JSON.stringify(one)
  const two = adapter.append({ frame: frame('two', '新原则'), step: 1, messages: one }).messages
  assert.equal(JSON.stringify(one), before)
  assert.equal(two.length, 2)
  assert.match(two[1].content[0].text, /新原则/)
  assert.deepEqual(adapter.append({ frame: frame('two', '新原则'), step: 1, messages: two }).messages, two)
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
