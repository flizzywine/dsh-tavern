import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginBodyGeneration } from '../tavern-plugin/lib/domain/plugin-body-generation.js'
import { createBodyGenerationProviders } from '../tavern-plugin/lib/domain/body-generation-providers.js'
import { captureBodyRegenerationSource } from '../tavern-plugin/lib/domain/body-regeneration-materials.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { storySubmissionForTurn } from '../tavern-plugin/lib/domain/story-tool-submission.js'

const copy = structuredClone
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function fixture(generate = async () => ({ text: '插件完整正文' }), options = {}) {
  const timeline = createStoryTimeline()
  const userText = options.userText ?? '继续'
  const before = { id: 'chat', sessionId: 'session', _storageRevision: 1, mode: 'story',
    messages: [{ role: 'assistant', greeting: true, turn: 1, projectionText: '完整开场', text: '压缩占位', variables: [{ hp: 10 }] }],
    cardContextSnapshot: '已解析人物设定', macroState: { userName: '玩家' }, variables: { hp: 10 }, posture: '起点' }
  const begun = timeline.apply({ chat: before, intent: { kind: 'body.begin', turn: 2, userText } })
  const operation = begun.chat.timeline.operations[begun.value.operationId]
  const route = { mode: 'plugin-tool-call', provider: 'fixture:body' }
  const frame = { kind: 'foreground', chatId: 'chat', branchId: operation.basedOn.branchId, basedOnRevision: operation.basedOn.revision,
    turn: 2, operationId: operation.id, userInput: { sourceText: userText, projectedText: '【输入】' + userText },
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
function recordToolResult(session, name, args, value, { turn = 2, error = false } = {}) {
  const callId = 'call-' + session.events.length
  const argumentsText = JSON.stringify(args)
  session.events.push({ type: 'assistant/message', data: { turn, step: 1, message: { id: 'message-' + callId, role: 'assistant', source: { kind: 'model' },
    content: [{ type: 'tool-call', id: callId, name, arguments: argumentsText }] } } },
    { type: 'tool/call', data: { turn, callId, name, arguments: argumentsText } },
    { type: 'tool/result', data: { turn, message: { role: 'tool', toolCallId: callId, isError: error, content: [{ type: 'text', text: value }] } } })
}

function receipt(session, value, options) {
  recordToolResult(session, 'tavern_generate_body', {}, value, options)
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

test('正文生成使用全局设置，旧存档的覆盖项不生效，进行中的回合沿用已选路线', async () => {
  const f = fixture()
  f.mutate(chat => Object.assign(chat, {
    storyGenerationMode: 'plugin-direct', storyGenerationProvider: 'legacy:body', storyPluginOutputRegex: false
  }))
  f.configure({ storyGenerationMode: 'host', storyGenerationProvider: 'global:body', storyPluginOutputRegex: true })
  assert.deepEqual(await f.controller.route('session'), { mode: 'plugin-tool-call', provider: 'fixture:body' })
  assert.equal(await f.controller.regenerate('session'), null)
  f.mutate(chat => { chat.foregroundFrames = {} })
  assert.deepEqual(await f.controller.route('session'), { mode: 'host', provider: 'global:body', hostRegex: true })
  f.configure({ storyGenerationMode: 'plugin-tool-call', storyGenerationProvider: 'global:other', storyPluginOutputRegex: true })
  assert.deepEqual(await f.controller.route('session'), { mode: 'plugin-tool-call', provider: 'global:other', hostRegex: true })
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

test('前台补查静态世界书后，正文插件收到本轮查到的通行条件', async () => {
  let observed
  const f = fixture(async ({ materials }) => { observed = materials; return { text: '守卫放行' } },
    { userText: '我拿着通行证去北门过关' })
  const title = '北门通行规则'
  const oldRule = '北门旧规要求出示蓝印。'
  const rule = '北门只接受当日加盖银印的通行证。'
  f.mutate(chat => {
    Object.values(chat.foregroundFrames)[0].contributions.push({ slot: 'worldbookTitleHints', text: title })
  })
  const previous = { events: [{ type: 'turn/start', data: { turn: 1 } }] }
  recordToolResult(previous, 'read_lorebook', { keyword: title }, oldRule, { turn: 1 })
  f.session.events.unshift(...previous.events, { type: 'turn/end', data: { turn: 1 } })
  recordToolResult(f.session, 'grep_lorebook', { query: '北门' }, title)
  recordToolResult(f.session, 'read_lorebook', { keyword: title }, rule)

  await f.controller.validateResult(f.session, 2, receipt(f.session, await f.run()))
  const worldbook = observed.context.find(item => item.id === 'worldbook').text
  assert.ok(worldbook.includes(`<lookup tool="read_lorebook">\n${rule}\n</lookup>`))
  assert.ok(worldbook.includes('<lorebook_lookups>'))
  assert.ok(!worldbook.includes(oldRule))
  assert.equal(f.calls, 1)
})

test('已注入足够世界书正文时，前台可以直接交给插件生成', async () => {
  let observed
  const f = fixture(async ({ materials }) => { observed = materials; return { text: '守卫放行' } },
    { userText: '我拿着通行证去北门过关' })
  const rule = '北门只接受当日加盖银印的通行证。'
  f.mutate(chat => {
    Object.values(chat.foregroundFrames)[0].contributions.push({ slot: 'activeWorldbook', text: rule })
  })

  await f.controller.validateResult(f.session, 2, receipt(f.session, await f.run()))
  assert.equal(observed.context.find(item => item.id === 'worldbook').text, rule)
  assert.equal(f.calls, 1)
})

test('concurrent tool dispatches share one provider invocation', async () => {
  const started = gate(), release = gate()
  const f = fixture(async () => { started.resolve(); await release.promise; return { text: '一次正文' } })
  const first = f.run(); await started.promise
  const second = f.run(); release.resolve()
  assert.deepEqual(await Promise.all([first, second]), [await first, await first])
  assert.equal(f.calls, 1)
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

test('玩家取消插件正文生成时，指定正文版本的请求得到取消结果', async () => {
  const started = gate()
  const expectedReply = { turn: 2, textVersion: 'version-1' }
  const f = fixture(undefined, {
    async regenerateWithProvider({ signal, expectedReply: target }) {
      assert.deepEqual(target, expectedReply)
      started.resolve()
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    }
  })
  const regeneration = f.controller.regenerate('session', '修改意见', expectedReply)
  await started.promise
  assert.equal(await f.controller.cancelRegeneration('session'), true)
  assert.deepEqual(await regeneration, { aborted: true })
})
