import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginBodyGeneration, bodyGenerationRoute } from '../tavern-plugin/lib/domain/plugin-body-generation.js'
import { createBodyGenerationProviders } from '../tavern-plugin/lib/domain/body-generation-providers.js'
import { captureBodyRegenerationSource } from '../tavern-plugin/lib/domain/body-regeneration-materials.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { storySubmissionForTurn, createStorySubmissionTool } from '../tavern-plugin/lib/domain/story-tool-submission.js'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'
import { registerModelStreamHooks } from '../tavern-plugin/lib/hooks/model-stream.js'

const copy = structuredClone
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function fixture(generate = async () => ({ text: '插件完整正文' }), options = {}) {
  const timeline = createStoryTimeline()
  const before = { id: 'chat', sessionId: 'session', _storageRevision: 1, mode: 'story',
    messages: [{ role: 'assistant', greeting: true, turn: 1, projectionText: '完整开场', text: '压缩占位', variables: [{ hp: 10 }] }],
    cardContextSnapshot: '已解析人物设定', macroState: { userName: '玩家' }, variables: { hp: 10 }, posture: '起点' }
  const begun = timeline.apply({ chat: before, intent: { kind: 'body.begin', turn: 2, userText: '继续' } })
  const operation = begun.chat.timeline.operations[begun.value.operationId]
  const route = { mode: 'plugin-tool-call', provider: 'fixture:body' }
  const frame = { kind: 'foreground', chatId: 'chat', branchId: operation.basedOn.branchId, basedOnRevision: operation.basedOn.revision,
    turn: 2, operationId: operation.id, userInput: { sourceText: '继续', projectedText: '【输入】继续' },
    contributions: [{ slot: 'writingRules', text: '本轮规则' }], source: { ...captureBodyRegenerationSource({ chat: begun.chat, card: { name: '角色' } }), bodyGeneration: route } }
  let state = { ...begun.chat, foregroundFrames: { [operation.id]: frame } }, calls = 0, conclusions = 0, allowed = true
  let settings = { storyGenerationMode: 'plugin-tool-call', storyGenerationProvider: 'fixture:body' }
  const providers = createBodyGenerationProviders({ allowed: async () => allowed, timeoutMs: options.timeoutMs || 1000 })
  const dispose = providers.register('fixture', { name: 'body', title: '测试', generate: async input => { calls++; return generate(input) } })
  const deps = { chatForSession: async () => copy(state), readRevision: async (id, revision) => revision === 1 ? copy(before) : undefined,
    updateChat: async (id, mutate) => { const next = await mutate(copy(state)); if (next) state = next; return copy(state) },
    settings: async () => copy(settings), providers, isWorldbookPath: path => path.startsWith('/worldbook/'), regenerateWithProvider: options.regenerateWithProvider }
  const controller = createPluginBodyGeneration(deps)
  const session = { id: 'session', events: [{ type: 'turn/start', data: { turn: 2 } }] }
  const abort = new AbortController()
  const exec = { agent: { session }, signal: abort.signal, concludeTurn() { conclusions++ } }
  return { controller, deps, session, exec, abort, providers, dispose, operation,
    get calls() { return calls }, get conclusions() { return conclusions }, get state() { return copy(state) },
    mutate(fn) { fn(state) }, configure(value) { settings = value }, deny() { allowed = false },
    run: async () => {
      const value = await controller.tool.execute({}, exec), result = JSON.parse(value)
      if (result.status === 'failed') throw new Error(result.message)
      return value
    } }
}
function receipt(session, value, { error = false, name = 'tavern_generate_body' } = {}) {
  session.events.push({ type: 'assistant/message', data: { turn: 2, step: 1, message: { id: 'm', role: 'assistant', source: { kind: 'model' },
    content: [{ type: 'tool-call', id: 'c', name, arguments: '{}' }] } } },
    { type: 'tool/call', data: { turn: 2, callId: 'c', name, arguments: '{}' } },
    { type: 'tool/result', data: { turn: 2, message: { role: 'tool', toolCallId: 'c', isError: error, content: [{ type: 'text', text: value }] } } })
  return storySubmissionForTurn(session, 2)
}

test('direct generation requires the same durable receipt as frontend-assisted generation', async () => {
  const f = fixture()
  f.mutate(chat => { Object.values(chat.foregroundFrames)[0].source.bodyGeneration.mode = 'plugin-direct' })
  await assert.rejects(f.controller.validateResult(f.session, 2, { text: 'unverified' }), /未通过/)
  await f.controller.validateResult(f.session, 2, receipt(f.session, await f.run()))
  f.deny()
  await assert.rejects(f.controller.validateResult(f.session, 2, { text: 'unverified' }), /不可用/)
})

test('production stream hook bypasses downstream model middleware for direct generation', async () => {
  const f = fixture()
  f.mutate(chat => { Object.values(chat.foregroundFrames)[0].source.bodyGeneration.mode = 'plugin-direct' })
  let handler
  registerModelStreamHooks({
    ctx: { on(name, fn) { if (name === 'llm/stream') handler = fn }, get() {} },
    pluginBodyGeneration: f.controller,
    agentRegistry: { get: () => ({ session: f.session }) }, sessionStore: { get: () => f.session },
    backgroundAgentRunner: { owns: () => false, requestContext: () => undefined },
    foregroundStrategies: { projectRequest: () => null }, requestCoordinates: new Map(),
    str: value => String(value || ''),
  })
  const chunks = []
  for await (const chunk of handler({ sessionId: f.session.id, signal: f.abort.signal }, () => {
    assert.fail('direct generation must not invoke downstream model middleware')
  })) chunks.push(chunk)
  assert.equal(chunks[0].block.name, 'tavern_generate_body')
  assert.equal(chunks[1].reason.kind, 'tool-calls')
})

test('current turn exports complete history and frozen state; successful duplicate/restart uses durable receipt', async () => {
  let observed
  const f = fixture(async ({ materials }) => { observed = materials; return { text: '<div>完整正文</div>', metadata: { once: 1 } } })
  const value = await f.run()
  assert.equal(observed.reason, 'normal')
  assert.deepEqual(observed.history.map(item => item.text), ['完整开场'])
  assert.equal(observed.input.text, '【输入】继续')
  assert.equal(observed.state.variables.hp, 10)
  const result = receipt(f.session, value)
  assert.equal(result.text, '<div>完整正文</div>')
  assert.equal(result.pluginBodyGeneration, true)
  await f.controller.validateResult(f.session, 2, result)
  assert.equal(await f.run(), value)
  assert.equal(await createPluginBodyGeneration(f.deps).tool.execute({}, f.exec), value)
  assert.equal(f.calls, 1)
  const tampered = fixture(); const bad = JSON.parse(value); bad.text = '截断或篡改'
  assert.equal(receipt(tampered.session, JSON.stringify(bad)), null)
  assert.equal(receipt(fixture().session, value, { error: true }), null)
})

test('concurrent tool dispatches share one provider invocation', async () => {
  const started = gate(), release = gate()
  const f = fixture(async () => { started.resolve(); await release.promise; return { text: '一次正文' } })
  const first = f.run(); await started.promise
  const second = f.run(); release.resolve()
  assert.deepEqual(await Promise.all([first, second]), [await first, await first])
  assert.equal(f.calls, 1)
})

test('worldbook lookups reach the provider and persist across receipt replay and native log folding', async () => {
  let observed
  const f = fixture(async ({ materials }) => { observed = materials; return { text: '正文' } })
  const lookup = (name, args, text) => {
    const id = 'lookup-' + f.session.events.length, argumentsText = JSON.stringify(args)
    f.session.events.push({ type: 'assistant/message', data: { turn: 2, message: { source: { kind: 'model' },
      content: [{ type: 'tool-call', id, name, arguments: argumentsText }] } } },
    { type: 'tool/call', data: { turn: 2, callId: id, name, arguments: argumentsText } },
    { type: 'tool/result', data: { turn: 2, message: { role: 'tool', toolCallId: id, content: [{ type: 'text', text }] } } })
  }
  lookup('worldbook_grep', { query: '港口' }, '命中：港口夜间关闭')
  lookup('read', { file_path: '/worldbook/harbor.md' }, '完整设定：持令牌者可以通行')
  lookup('read', { file_path: '/private/config' }, 'private-file')
  const value = await f.run()
  assert.match(observed.context.find(item => item.id === 'worldbook').text, /命中：港口夜间关闭[\s\S]*完整设定：持令牌者可以通行/)
  assert.doesNotMatch(JSON.stringify(observed), /private-file/)
  const frozen = f.state.foregroundFrames[f.operation.id].source.bodyGenerationToolResults
  for (const item of frozen) assert.ok(observed.context.find(item => item.id === 'worldbook').text.includes(item.text))
  f.session.events.splice(1)
  await f.controller.validateResult(f.session, 2, receipt(f.session, value))
  lookup('worldbook_grep', {}, '生成之后的资料不能改变已有凭证')
  assert.equal(await createPluginBodyGeneration(f.deps).tool.execute({}, f.exec), value)
  assert.equal(f.calls, 1)
  f.mutate(state => { state.foregroundFrames[f.operation.id].source.bodyGenerationToolResults[0].text = '篡改查询结果' })
  await assert.rejects(f.controller.validateResult(f.session, 2, receipt(f.session, value)), /过期/)
})

test('cancellation and plugin unload reject late candidates and do not retry the same operation', async () => {
  for (const unload of [false, true]) {
    const started = gate(), release = gate()
    const f = fixture(async ({ signal }) => { started.resolve(signal); await release.promise; return { text: '迟到正文' } })
    const pending = f.run(); const signal = await started.promise
    const rejected = assert.rejects(pending, /取消|卸载/)
    if (unload) f.dispose(); else f.abort.abort(new Error('用户取消'))
    await rejected
    assert.equal(signal.aborted, true)
    release.resolve(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.state.timeline.operations[f.operation.id].bodyGeneration.status, 'failed')
    const restarted = createPluginBodyGeneration(f.deps)
    const stopped = JSON.parse(await restarted.tool.execute({}, { ...f.exec, signal: new AbortController().signal }))
    assert.equal(stopped.status, 'failed')
    assert.match(stopped.message, /取消|卸载/)
    assert.equal(f.calls, 1)
  }
})

test('branch changes, changed history and incomplete responses cannot commit', async () => {
  for (const mutate of [s => { s.timeline.revision++ }, s => { s.messages[0].projectionText = '改过的历史' }]) {
    const started = gate(), release = gate()
    const f = fixture(async () => { started.resolve(); await release.promise; return { text: '旧材料结果' } })
    const pending = f.run(); await started.promise; f.mutate(mutate); release.resolve()
    await assert.rejects(pending, /过期|变化/)
    assert.notEqual(f.state.timeline.operations[f.operation.id].bodyGeneration.status, 'ready')
  }
  for (const value of ['', ' ', 'x'.repeat(200001)]) {
    const f = fixture(async () => ({ text: value }))
    await assert.rejects(f.run(), /正文/)
    assert.equal(f.conclusions, 1)
  }
})

test('route is frozen per turn; workbench remains host; bypass and invalid tool args are rejected', async () => {
  const f = fixture()
  f.configure({ storyGenerationMode: 'host' })
  assert.equal((await f.controller.route('session')).mode, 'plugin-tool-call')
  assert.equal(bodyGenerationRoute({ mode: 'card' }, { storyGenerationMode: 'plugin-tool-call' }).mode, 'host')
  const submit = createStorySubmissionTool({ chatForSession: f.deps.chatForSession, enabled: async () => true, pluginGeneration: async () => true })
  await assert.rejects(submit.execute({ content: '绕过插件' }, f.exec), /必须由插件/)
  await assert.rejects(f.controller.tool.execute({ text: '伪造输入' }, f.exec), /不接受参数/)
  await assert.rejects(f.controller.tool.execute({}, { ...f.exec, concludeTurn: undefined }), /不支持工具结束/)
  assert.equal(f.calls, 0)
  await assert.rejects(f.controller.validateResult(f.session, 2, { text: '模型自行输出' }), /未通过/)
})

test('timeout and disabled provider fail without fallback', async () => {
  const f = fixture(async () => new Promise(() => {}), { timeoutMs: 15 })
  await assert.rejects(f.run(), /超时/)
  const disabled = fixture(); disabled.deny()
  await assert.rejects(disabled.run(), /不可用/)
  assert.equal(disabled.calls, 0)
})

test('selected regeneration passes guidance, cancels before commit and never cancels committed settlement', async () => {
  const started = gate(), release = gate()
  const f = fixture(async () => '重生成正文', { regenerateWithProvider: async input => {
    started.resolve(input)
    await new Promise((resolve, reject) => { input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }); release.promise.then(resolve) })
    return { turn: 2 }
  } })
  const pending = f.controller.regenerate('session', '更详细'); const input = await started.promise
  const failed = assert.rejects(pending, /取消/)
  assert.equal(await f.controller.cancelRegeneration('session'), true); await failed
  assert.equal(input.signal.aborted, true)
  const after = gate()
  const committed = fixture(undefined, { regenerateWithProvider: async input => { input.onPhase('committed'); await after.promise; return { turn: 2 } } })
  const done = committed.controller.regenerate('session'); await new Promise(resolve => setImmediate(resolve))
  assert.equal(await committed.controller.cancelRegeneration('session'), true)
  after.resolve(); assert.deepEqual(await done, { turn: 2 })
})

test('lifecycle rejects direct model text before saving and passes processed flag for plugin receipt', async () => {
  const f = fixture(), handlers = new Map(), saved = [], failures = []
  registerTurnLifecycleHooks({ ctx: { on: (name, fn) => handlers.set(name, fn) }, pluginBodyGeneration: f.controller,
    clearRuntimePresetRequestState() {}, backgroundAgentRunner: { owns: () => false },
    userMessageForTurn: () => ({ role: 'user', content: [{ type: 'text', text: '继续' }] }),
    contentText: () => '继续', requestIdForTurn: () => 'req', turnOrchestrator: { recordFailure: async value => failures.push(value) },
    foregroundHandoff: { finalize: async value => { saved.push(value); return { reply: { sessionText: value.assistantText } } } }, replaceAssistantReply() {} })
  f.session.events.push({ type: 'assistant/message', data: { turn: 2, message: { source: { kind: 'model' }, content: [{ type: 'text', text: '绕过插件的正文' }] } } })
  const stop = () => handlers.get('agent/turn-stopping')({ agent: { session: f.session }, turn: 2 })
  await assert.rejects(stop(), /未通过/); assert.equal(saved.length, 0); assert.equal(failures.length, 1)
  receipt(f.session, await f.run())
  await stop(); assert.equal(saved.length, 1); assert.equal(saved[0].pluginBodyGeneration, true)
})


test('附件输入明确失败，失败回执保留具体原因且不调用生成插件', async () => {
  const f = fixture()
  f.session.events.push({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'image', url: 'image:test' }] } })
  const output = await f.controller.tool.execute({}, f.exec)
  const result = receipt(f.session, output)
  await assert.rejects(f.controller.validateResult(f.session, 2, result), /只支持文本输入/)
  assert.equal(f.calls, 0)
})
