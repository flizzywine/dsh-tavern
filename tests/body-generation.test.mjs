import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginBodyGeneration, bodyGenerationRoute } from '../tavern-plugin/lib/domain/plugin-body-generation.js'
import { createBodyGenerationProviders } from '../tavern-plugin/lib/domain/body-generation-providers.js'
import { captureBodyRegenerationSource } from '../tavern-plugin/lib/domain/body-regeneration-materials.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { storySubmissionForTurn, createStorySubmissionTool } from '../tavern-plugin/lib/domain/story-tool-submission.js'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'

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

test('current turn exports complete history and frozen state; successful duplicate/restart uses durable receipt', async () => {
  let observed
  const f = fixture(async ({ materials }) => { observed = materials; return { text: '<div>完整正文</div>', metadata: { once: 1 } } })
  const value = await f.run()
  assert.equal(observed.reason, 'normal')
  assert.equal(observed.outputProcessing, undefined, 'legacy prepared frames retain their original receipt materials')
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

test('lifecycle rejects direct model text before saving and passes processed flag for plugin receipt', async () => {
  const f = fixture(), handlers = new Map(), saved = [], failures = [], traced = []
  registerTurnLifecycleHooks({ ctx: { on: (name, fn) => handlers.set(name, fn) }, pluginBodyGeneration: f.controller,
    clearRuntimePresetRequestState() {}, backgroundAgentRunner: { owns: () => false },
    requestPerformance: { run: async (method, _id, operation) => { traced.push(method); return operation() } },
    userMessageForTurn: () => ({ role: 'user', content: [{ type: 'text', text: '继续' }] }),
    contentText: () => '继续', requestIdForTurn: () => 'req', turnOrchestrator: { recordFailure: async value => failures.push(value) },
    foregroundHandoff: { finalize: async value => { saved.push(value); return { reply: { sessionText: value.assistantText } } } }, replaceAssistantReply() {} })
  f.session.events.push({ type: 'assistant/message', data: { turn: 2, message: { source: { kind: 'model' }, content: [{ type: 'text', text: '绕过插件的正文' }] } } })
  const stop = () => handlers.get('agent/turn-stopping')({ agent: { session: f.session }, turn: 2 })
  await assert.rejects(stop(), /未通过/); assert.equal(saved.length, 0); assert.equal(failures.length, 1)
  receipt(f.session, await f.run())
  await stop(); assert.equal(saved.length, 1); assert.equal(saved[0].pluginBodyGeneration, true)
  assert.deepEqual(traced, ['generateCommit'])
})


for (const [code, category, message] of [
  ['STCONTEXT_CONTENT_FILTER', 'content-filter', '独立生成未完整完成：Provider finish_reason: content_filter'],
  ['STCONTEXT_CONTEXT_OVERFLOW', 'context-overflow', '服务商报告请求超过模型上下文容量'],
  ['STCONTEXT_OUTPUT_LIMIT', 'output-limit', '输出达到长度上限'],
  ['STCONTEXT_EMPTY', 'empty-response', '空响应'],
  ['STCONTEXT_REASONING_ONLY', 'reasoning-only', '只有思考'],
  ['ECONNRESET', 'network', '网络异常'],
  ['STCONTEXT_TIMEOUT', 'timeout', '插件超时'],
  ['STCONTEXT_PRESET', 'preset', '预设处理失败'],
]) test('failure contract survives receipt and restart: ' + category, async () => {
  for (const mode of ['plugin-direct', 'plugin-tool-call']) {
    const f = fixture(async () => { throw Object.assign(new Error(message), {code, stage: 'response', details: {httpStatus: 400, providerCode: 'context_length_exceeded', response: 'PRIVATE-STORY', apiKey: 'PRIVATE-KEY'}, cause: {prompt:'PRIVATE-PROMPT'}}) });
    f.mutate(chat => { Object.values(chat.foregroundFrames)[0].source.bodyGeneration.mode = mode });
    const output = await f.controller.tool.execute({}, f.exec);
    const result = receipt(f.session, output);
    assert.equal(result.failure.code, code);
    assert.equal(result.failure.category, category);
    assert.equal(result.failure.stage, 'response');
    assert.equal(result.text, '');
    const restored = createPluginBodyGeneration(f.deps);
    await assert.rejects(restored.validateResult(f.session, 2, result), error => {
      assert.equal(error.code, 'TAVERN_PLUGIN_BODY_GENERATION_FAILED');
      assert.deepEqual(error.failure, result.failure); return true;
    });
    const replay = JSON.parse(await restored.tool.execute({}, f.exec));
    assert.deepEqual(replay.failure, result.failure);
    assert.equal(f.calls, 1, 'failed operations must not repeat a paid request');
    assert.doesNotMatch(JSON.stringify(f.state) + output, /PRIVATE-STORY|PRIVATE-KEY|PRIVATE-PROMPT/);
    assert.equal(f.state.messages.at(-1).projectionText, '完整开场');
  }
});

test('normal generation persists projection metadata outside the model-visible receipt', async () => {
  const regexScripts = [{ findRegex: 'X', replaceString: 'Y', placement: [2], promptOnly: true }]
  const f = fixture(async () => ({ text: 'X', regexScripts }))
  const value = await f.run()
  assert.equal(JSON.parse(value).regexScripts, undefined)
  const generated = Object.values(f.state.timeline.operations).find(op => op.bodyGeneration)?.bodyGeneration
  assert.deepEqual(generated.regexScripts, regexScripts)
  assert.equal(await createPluginBodyGeneration(f.deps).tool.execute({}, f.exec), value)
  assert.equal(f.calls, 1)
})
